import http.client
import io
import json
import os
import tempfile
import threading
import time
import unittest
import urllib.error
from datetime import date, datetime, timedelta, timezone
from unittest import mock
from urllib.parse import parse_qs, urlparse

import dados
from tipos import Candle


def serie(inicio, n, preco=100.0, passo=1.0):
    """n candles de 5 min seguidos a partir de `inicio`, subindo `passo` por candle."""
    out = []
    for k in range(n):
        o = preco + k * passo
        out.append(Candle(inicio + timedelta(minutes=5 * k), o, o + 2, o - 1, o + passo, 10.0, 1.0))
    return out


class TestCsvEAgrupamento(unittest.TestCase):
    def test_csv_ida_e_volta(self):
        cs = serie(datetime(2026, 9, 1, 9, 0), 3)
        with tempfile.TemporaryDirectory() as d:
            caminho = os.path.join(d, "x.csv")
            dados.salvar_csv(cs, caminho)
            self.assertEqual(dados.ler_csv(caminho), cs)

    def test_agrupar_60(self):
        cs = serie(datetime(2026, 9, 1, 9, 0), 24)
        g = dados.agrupar(cs, 60)
        self.assertEqual(len(g), 2)
        a = g[0]
        self.assertEqual(a.t, datetime(2026, 9, 1, 9, 0))
        self.assertEqual(a.o, cs[0].o)
        self.assertEqual(a.c, cs[11].c)
        self.assertEqual(a.h, max(c.h for c in cs[:12]))
        self.assertEqual(a.l, min(c.l for c in cs[:12]))
        self.assertEqual(a.v, 120.0)
        self.assertEqual(a.delta, 12.0)

    def test_agrupar_nao_mistura_dias(self):
        cs = serie(datetime(2026, 9, 1, 17, 0), 12) + serie(datetime(2026, 9, 2, 9, 0), 12)
        g = dados.agrupar(cs, 60)
        self.assertEqual([c.t for c in g], [datetime(2026, 9, 1, 17, 0), datetime(2026, 9, 2, 9, 0)])

    def test_por_dia(self):
        cs = serie(datetime(2026, 9, 1, 17, 0), 3) + serie(datetime(2026, 9, 2, 9, 0), 2)
        d = dados.por_dia(cs)
        self.assertEqual(list(d), [date(2026, 9, 1), date(2026, 9, 2)])
        self.assertEqual(d[date(2026, 9, 2)], cs[3:])


class Mt5Falso:
    """Imita o pacote MetaTrader5: devolve candles de 5 min das 9:00 às 9:55 de cada dia útil pedido."""
    TIMEFRAME_M5 = 5

    def __init__(self, liga=True, simbolos=("WDO$", "WIN$")):
        self.liga, self.simbolos, self.baixadas, self.args_initialize, self.encerrou = liga, simbolos, 0, None, False

    def initialize(self, **kw):
        self.args_initialize = kw
        return self.liga

    def shutdown(self):
        self.encerrou = True

    def symbol_select(self, simbolo, ligar):
        return simbolo in self.simbolos

    def last_error(self):
        return (1, "erro falso")

    def copy_rates_range(self, simbolo, tf, de, ate):
        self.baixadas += 1
        de, ate = de.replace(tzinfo=None), ate.replace(tzinfo=None)
        out, dia = [], de
        while dia < ate:
            if dia.weekday() < 5:
                for k in range(12):
                    t = dia.replace(hour=9, minute=0) + timedelta(minutes=5 * k)
                    epoch = (t - datetime(1970, 1, 1)).total_seconds()
                    out.append({"time": epoch, "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5,
                                "real_volume": 7, "tick_volume": 3})
            dia += timedelta(days=1)
        return out


GENIAL = "C:\\Program Files\\Genial Investimentos MetaTrader 5\\terminal64.exe"
CFG = {"ativos": {
    "WDO": {"fonte": "mt5", "simbolo": "WDO$", "terminal": GENIAL, "sessao": {"dias": [0, 1, 2, 3, 4]}},
    "WIN": {"fonte": "mt5", "simbolo": "WIN$", "terminal": GENIAL, "sessao": {"dias": [0, 1, 2, 3, 4]}},
    "BTCUSDT": {"fonte": "binance", "simbolo": "BTCUSDT", "sessao": {"dias": [0, 1, 2, 3, 4, 5, 6]}},
}}


class TestHistoricoMt5(unittest.TestCase):
    def test_mt5_fechado(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(dados.ErroDados) as e:
                dados.historico("WDO", date(2026, 9, 1), date(2026, 9, 1), CFG, pasta=d, mt5=Mt5Falso(liga=False))
        self.assertIn("abra o MT5 e faça login", str(e.exception))

    def test_simbolo_inexistente(self):
        cfg = {"ativos": {"WDO": {"simbolo_mt5": "WDO$"}}}  # config antigo: sem fonte/simbolo/terminal
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(dados.ErroDados) as e:
                dados.historico("WDO", date(2026, 9, 1), date(2026, 9, 1), cfg, pasta=d, mt5=Mt5Falso(simbolos=()))
        self.assertIn("WDO$", str(e.exception))
        self.assertIn("trader/config.json", str(e.exception))

    def test_cache_evita_baixar_de_novo(self):
        mt5 = Mt5Falso()
        with tempfile.TemporaryDirectory() as d:
            a = dados.historico("WDO", date(2026, 9, 1), date(2026, 9, 4), CFG, pasta=d, mt5=mt5)
            b = dados.historico("WDO", date(2026, 9, 1), date(2026, 9, 4), CFG, pasta=d, mt5=mt5)
        self.assertEqual(mt5.baixadas, 1)
        self.assertEqual(len(a), 4 * 12)
        self.assertEqual(a, b)

    def test_download_parcial_nao_marca_dias_que_nao_vieram(self):
        class Parcial(Mt5Falso):  # o MT5 ainda sincronizando: só devolve até 02/09
            def copy_rates_range(self, simbolo, tf, de, ate):
                return [r for r in super().copy_rates_range(simbolo, tf, de, ate)
                        if r["time"] < (datetime(2026, 9, 3) - datetime(1970, 1, 1)).total_seconds()]
        mt5 = Parcial()
        with tempfile.TemporaryDirectory() as d:
            dados.historico("WDO", date(2026, 9, 1), date(2026, 9, 4), CFG, pasta=d, mt5=mt5)
            dados.historico("WDO", date(2026, 9, 1), date(2026, 9, 4), CFG, pasta=d, mt5=mt5)
        self.assertEqual(mt5.baixadas, 2)

    def test_simbolo_padrao_sem_config(self):
        mt5 = Mt5Falso()
        with tempfile.TemporaryDirectory() as d:
            cs = dados.historico("WIN", date(2026, 9, 1), date(2026, 9, 1), {"ativos": {"WIN": {}}}, pasta=d, mt5=mt5)
        self.assertEqual(len(cs), 12)

    def test_historico_recorta_intervalo(self):
        mt5 = Mt5Falso()
        with tempfile.TemporaryDirectory() as d:
            dados.historico("WDO", date(2026, 9, 1), date(2026, 9, 3), CFG, pasta=d, mt5=mt5)
            meio = dados.historico("WDO", date(2026, 9, 2), date(2026, 9, 2), CFG, pasta=d, mt5=mt5)
        self.assertEqual(mt5.baixadas, 1)
        self.assertEqual({k.t.date() for k in meio}, {date(2026, 9, 2)})
        self.assertEqual(meio[0].t, datetime(2026, 9, 2, 9, 0))
        self.assertEqual(meio[0].v, 7.0)


class BinanceFalso:
    """Imita api.binance.com/api/v3/klines: candles de 5 min seguidos, respeitando startTime, endTime e limit."""

    def __init__(self):
        self.pedidos = []

    def __call__(self, url, timeout=30):
        q = {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}
        self.pedidos.append(q)
        t, fim, limite = -(-int(q["startTime"]) // 300000) * 300000, int(q["endTime"]), int(q["limit"])
        ks = []
        while t <= fim and len(ks) < limite:
            ks.append([t, "100.5", "102.5", "99.5", "101.5", "3.25", t + 299999, "330.0", 9, "1.0", "100.0", "0"])
            t += 300000
        return io.BytesIO(json.dumps(ks).encode())


def erro_http(codigo, corpo=b"{}"):
    def abrir(url, timeout=30):
        raise urllib.error.HTTPError(url, codigo, "erro", {}, io.BytesIO(corpo))
    return abrir


class TestBinance(unittest.TestCase):
    def test_binance_pagina_e_converte_horario(self):
        falso = BinanceFalso()
        cs = dados.baixar_binance("BTCUSDT", date(2026, 10, 20), date(2026, 10, 23), abrir_url=falso)
        self.assertEqual(len(cs), 4 * 288)
        self.assertEqual(len(falso.pedidos), 2)  # 1000 + 152
        self.assertEqual(falso.pedidos[0]["symbol"], "BTCUSDT")
        self.assertEqual(falso.pedidos[0]["interval"], "5m")
        self.assertEqual(falso.pedidos[0]["limit"], "1000")
        ms_0300_utc = int((datetime(2026, 10, 20, 3) - datetime(1970, 1, 1)).total_seconds() * 1000)
        self.assertEqual(int(falso.pedidos[0]["startTime"]), ms_0300_utc)
        self.assertEqual(int(falso.pedidos[1]["startTime"]), ms_0300_utc + 1000 * 300000)
        # abertura 03:00 UTC = 00:00 em Brasília; volume base, delta 0
        self.assertEqual(cs[0], Candle(datetime(2026, 10, 20, 0, 0), 100.5, 102.5, 99.5, 101.5, 3.25, 0.0))
        self.assertEqual(cs[-1].t, datetime(2026, 10, 23, 23, 55))
        self.assertEqual([k.t for k in cs], sorted({k.t for k in cs}))

    def test_binance_429_vira_erro_dados(self):
        with tempfile.TemporaryDirectory() as d:
            ok = dados.historico("BTCUSDT", date(2026, 10, 20), date(2026, 10, 21), CFG, pasta=d,
                                 abrir_url=BinanceFalso(), hoje=date(2026, 10, 25))
            antes = {}
            for nome in ("BTCUSDT_M5.csv", "BTCUSDT_M5.cobertura.csv"):
                with open(os.path.join(d, nome), "rb") as f:
                    antes[nome] = f.read()
            with self.assertRaises(dados.ErroDados) as e:
                dados.historico("BTCUSDT", date(2026, 10, 20), date(2026, 10, 23), CFG, pasta=d,
                                abrir_url=erro_http(429), hoje=date(2026, 10, 25))
            self.assertIn("Binance indisponível agora (HTTP 429)", str(e.exception))
            self.assertIn("tente de novo em alguns minutos", str(e.exception))
            for nome, conteudo in antes.items():  # cache anterior intacto
                with open(os.path.join(d, nome), "rb") as f:
                    self.assertEqual(f.read(), conteudo)
            self.assertEqual(len(dados.ler_csv(os.path.join(d, "BTCUSDT_M5.csv"))), len(ok))

    def test_binance_outros_erros(self):
        with self.subTest("5xx"):
            with self.assertRaises(dados.ErroDados) as e:
                dados.baixar_binance("BTCUSDT", date(2026, 10, 20), date(2026, 10, 20), abrir_url=erro_http(503))
            self.assertIn("HTTP 503", str(e.exception))
        with self.subTest("rede"):
            def sem_rede(url, timeout=30):
                raise urllib.error.URLError("sem rede")
            with self.assertRaises(dados.ErroDados) as e:
                dados.baixar_binance("BTCUSDT", date(2026, 10, 20), date(2026, 10, 20), abrir_url=sem_rede)
            self.assertIn("Binance indisponível agora", str(e.exception))
        for rotulo, falha in (("conexão cortada", ConnectionResetError("reset")),
                              ("resposta incompleta", http.client.IncompleteRead(b"[[1")),
                              ("JSON cortado", None)):
            with self.subTest(rotulo):
                def corta(url, timeout=30, falha=falha):
                    if falha:
                        raise falha
                    return io.BytesIO(b"[[1, 2")
                with self.assertRaises(dados.ErroDados) as e:
                    dados.baixar_binance("BTCUSDT", date(2026, 10, 20), date(2026, 10, 20), abrir_url=corta)
                self.assertIn("Binance indisponível agora", str(e.exception))
        with self.subTest("4xx mostra a msg da Binance"):
            with self.assertRaises(dados.ErroDados) as e:
                dados.baixar_binance("XXX", date(2026, 10, 20), date(2026, 10, 20),
                                     abrir_url=erro_http(400, b'{"code":-1121,"msg":"Invalid symbol."}'))
            self.assertIn("Invalid symbol.", str(e.exception))
            self.assertIn("XXX", str(e.exception))


class UmCandle(Mt5Falso):
    """Devolve um único candle às 03:00 do dia 20/10 no relógio do servidor e guarda o intervalo pedido."""

    def copy_rates_range(self, simbolo, tf, de, ate):
        self.pedido = (de, ate)
        return [{"time": (datetime(2026, 10, 20, 3) - datetime(1970, 1, 1)).total_seconds(), "open": 1.0,
                 "high": 2.0, "low": 0.5, "close": 1.5, "real_volume": 0, "tick_volume": 3}]


class TestFontes(unittest.TestCase):
    def test_historico_escolhe_fonte(self):
        mt5, binance = Mt5Falso(), BinanceFalso()
        with tempfile.TemporaryDirectory() as d:
            # sábado e domingo: BTC conta todo dia, e o MT5 não é chamado
            fim_de_semana = dados.historico("BTCUSDT", date(2026, 10, 24), date(2026, 10, 25), CFG, pasta=d,
                                            mt5=mt5, abrir_url=binance, hoje=date(2026, 10, 26))
            self.assertEqual(len(fim_de_semana), 2 * 288)
            self.assertEqual(mt5.baixadas, 0)
            dados.historico("BTCUSDT", date(2026, 10, 24), date(2026, 10, 25), CFG, pasta=d,
                            mt5=mt5, abrir_url=binance, hoje=date(2026, 10, 26))
            self.assertEqual(len(binance.pedidos), 1)  # segunda chamada vem do cache
            # WDO vai para o MT5 e não toca na Binance
            wdo = dados.historico("WDO", date(2026, 9, 1), date(2026, 9, 1), CFG, pasta=d, mt5=mt5, abrir_url=binance)
            self.assertEqual((mt5.baixadas, len(wdo), len(binance.pedidos)), (1, 12, 1))

    def test_fonte_desconhecida(self):
        cfg = {"ativos": {"X": {"fonte": "bolsa-de-marte", "simbolo": "X"}}}
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(dados.ErroDados) as e:
                dados.historico("X", date(2026, 9, 1), date(2026, 9, 1), cfg, pasta=d)
        self.assertIn("bolsa-de-marte", str(e.exception))

    def test_mt5_terminal_e_deslocamento(self):
        terminal = "C:\\Program Files\\MetaTrader 5\\terminal64.exe"
        mt5 = UmCandle(simbolos=("EURUSD",))
        cs = dados.baixar_mt5("EURUSD", date(2026, 10, 20), date(2026, 10, 20), mt5, terminal=terminal, deslocamento_h=3)
        self.assertEqual(mt5.args_initialize, {"path": terminal})
        self.assertTrue(mt5.encerrou)  # solta o terminal para o próximo ativo poder usar outro
        self.assertEqual(cs[0].t, datetime(2026, 10, 20, 0, 0))  # 03:00 do servidor = 00:00 de Brasília
        # o dia 20/10 de Brasília vai de 03:00 do dia 20 a 02:59:59 do dia 21 no relógio do servidor, em UTC
        # explícito (sem fuso, o pacote usaria o horário do PC) e sem o candle das 03:00 do dia seguinte
        self.assertEqual(mt5.pedido, (datetime(2026, 10, 20, 3, tzinfo=timezone.utc),
                                      datetime(2026, 10, 21, 2, 59, 59, tzinfo=timezone.utc)))
        # sem terminal: initialize() sem argumentos, sem deslocamento
        mt5 = UmCandle(simbolos=("EURUSD",))
        cs = dados.baixar_mt5("EURUSD", date(2026, 10, 20), date(2026, 10, 20), mt5)
        self.assertEqual((mt5.args_initialize, cs[0].t), ({}, datetime(2026, 10, 20, 3, 0)))

    def test_historico_repassa_terminal_e_deslocamento_do_config(self):
        terminal = "C:\\Program Files\\MetaTrader 5\\terminal64.exe"
        cfg = {"ativos": {"EURUSD": {"fonte": "mt5", "simbolo": "EURUSD", "terminal": terminal, "deslocamento_h": 3}}}
        mt5 = UmCandle(simbolos=("EURUSD",))
        with tempfile.TemporaryDirectory() as d:
            cs = dados.historico("EURUSD", date(2026, 10, 20), date(2026, 10, 20), cfg, pasta=d, mt5=mt5)
        self.assertEqual(mt5.args_initialize, {"path": terminal})
        self.assertEqual([k.t for k in cs], [datetime(2026, 10, 20, 0, 0)])


def epoch(t):
    return (t - datetime(1970, 1, 1)).total_seconds()


class Mt5EmHorarios(Mt5Falso):
    """Devolve um candle em cada horário dado (relógio do servidor) e guarda o intervalo pedido."""

    def __init__(self, horarios, **kw):
        super().__init__(**kw)
        self.horarios = horarios

    def copy_rates_range(self, simbolo, tf, de, ate):
        self.pedido = (de, ate)
        return [{"time": epoch(h), "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "real_volume": 0, "tick_volume": 3}
                for h in self.horarios]


class TestFusoDoServidor(unittest.TestCase):
    """O servidor MetaQuotes usa o horário europeu: UTC+2 no inverno e UTC+3 no verão europeu; Brasília é UTC-3."""

    def converter(self, horarios, de=date(2026, 10, 20), ate=date(2026, 10, 26), fuso_servidor="europa"):
        mt5 = Mt5EmHorarios(horarios, simbolos=("EURUSD",))
        return [k.t for k in dados.baixar_mt5("EURUSD", de, ate, mt5, fuso_servidor=fuso_servidor)], mt5

    def test_europa_converte_por_instante(self):
        ts, mt5 = self.converter([datetime(2026, 10, 20, 15, 30), datetime(2026, 10, 26, 15, 30),
                                  datetime(2026, 1, 9, 15, 30)])
        self.assertEqual(ts, [datetime(2026, 10, 20, 9, 30),    # verão europeu: servidor 6 h à frente
                              datetime(2026, 10, 26, 10, 30),   # depois de 25/10: 5 h
                              datetime(2026, 1, 9, 10, 30)])    # inverno: 5 h
        # o pedido também é por instante: 20/10 00:00 Brasília = 06:00 do servidor (UTC+3);
        # 26/10 23:59:59 Brasília = 27/10 04:59:59 do servidor (UTC+2)
        self.assertEqual(mt5.pedido, (datetime(2026, 10, 20, 6, tzinfo=timezone.utc),
                                      datetime(2026, 10, 27, 4, 59, 59, tzinfo=timezone.utc)))

    def test_europa_nas_fronteiras_do_horario_de_verao(self):
        casos = [  # (relógio do servidor, Brasília); o horário de verão muda no último domingo, 01:00 UTC
            (datetime(2026, 3, 29, 2, 55), datetime(2026, 3, 28, 21, 55)),    # último candle do inverno (UTC+2)
            (datetime(2026, 3, 29, 4, 0), datetime(2026, 3, 28, 22, 0)),      # primeiro do verão (UTC+3): 03:xx não existe
            (datetime(2026, 10, 25, 2, 55), datetime(2026, 10, 24, 20, 55)),  # último candle do verão (UTC+3)
            (datetime(2026, 10, 25, 4, 0), datetime(2026, 10, 24, 23, 0)),    # primeiro do inverno (UTC+2)
        ]
        for servidor, brasilia in casos:
            with self.subTest(servidor=servidor):
                ts, _ = self.converter([servidor], de=date(2026, 3, 28), ate=date(2026, 3, 28))
                self.assertEqual(ts, [brasilia])

    def test_brasilia_e_o_padrao_e_nao_converte(self):
        mt5 = Mt5EmHorarios([datetime(2026, 10, 20, 15, 30)], simbolos=("WDO$",))
        cs = dados.baixar_mt5("WDO$", date(2026, 10, 20), date(2026, 10, 20), mt5)
        self.assertEqual(cs[0].t, datetime(2026, 10, 20, 15, 30))
        self.assertEqual(mt5.pedido, (datetime(2026, 10, 20, tzinfo=timezone.utc),
                                      datetime(2026, 10, 20, 23, 59, 59, tzinfo=timezone.utc)))

    def test_fuso_desconhecido(self):
        with self.assertRaises(dados.ErroDados) as e:
            self.converter([datetime(2026, 10, 20, 15, 30)], fuso_servidor="marte")
        self.assertIn("marte", str(e.exception))

    def test_historico_le_fuso_servidor_do_config_e_deslocamento_h_antigo_vence(self):
        europa = {"ativos": {"EURUSD": {"fonte": "mt5", "simbolo": "EURUSD", "fuso_servidor": "europa"}}}
        antigo = {"ativos": {"EURUSD": {"fonte": "mt5", "simbolo": "EURUSD", "fuso_servidor": "europa",
                                        "deslocamento_h": 3}}}
        for cfg, esperado in ((europa, datetime(2026, 10, 20, 9, 30)), (antigo, datetime(2026, 10, 20, 12, 30))):
            mt5 = Mt5EmHorarios([datetime(2026, 10, 20, 15, 30)], simbolos=("EURUSD",))
            with tempfile.TemporaryDirectory() as d:
                cs = dados.historico("EURUSD", date(2026, 10, 20), date(2026, 10, 20), cfg, pasta=d, mt5=mt5)
            self.assertEqual([k.t for k in cs], [esperado])


MT5_FALSO_FILHO = """import time
TIMEFRAME_M5 = 5
def initialize(**kw): return {inicializa}
def last_error(): return (1, "erro falso")
def symbol_select(simbolo, ligar): return True
def shutdown(): pass
def copy_rates_range(simbolo, tf, de, ate):
    time.sleep({dormir})
    return [{{"time": {hora}, "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "real_volume": 7, "tick_volume": 3}}]
"""


TERMINAL_FALSO = "C:\\MT5\\terminal64.exe"


class TestMt5EmProcessoFilho(unittest.TestCase):
    """Sem `mt5=`, o download roda num processo filho que o pai mata se o terminal pendurar. O filho importa
    `MetaTrader5` do PYTHONPATH, onde estes testes põem um módulo falso."""

    def baixar(self, timeout_s, **falso):
        falso = {**dict(inicializa=True, dormir=0, hora=epoch(datetime(2026, 10, 20, 15, 30))), **falso}
        with tempfile.TemporaryDirectory() as pasta:
            with open(os.path.join(pasta, "MetaTrader5.py"), "w", encoding="utf-8") as f:
                f.write(MT5_FALSO_FILHO.format(**falso))
            with mock.patch.dict(os.environ, {"PYTHONPATH": pasta}):
                return dados.baixar_mt5("EURUSD", date(2026, 10, 20), date(2026, 10, 20),
                                        terminal=TERMINAL_FALSO, fuso_servidor="europa", timeout_s=timeout_s)

    def test_filho_devolve_os_candles_convertidos(self):
        cs = self.baixar(timeout_s=60)
        self.assertEqual(cs, [Candle(datetime(2026, 10, 20, 9, 30), 1.0, 2.0, 0.5, 1.5, 7.0, 0.0)])

    def test_filho_repassa_erro_amigavel(self):
        with self.assertRaises(dados.ErroDados) as e:
            self.baixar(timeout_s=60, inicializa=False)
        self.assertIn("abra o MT5 e faça login", str(e.exception))

    def test_terminal_que_pendura_vira_erro_dados(self):
        inicio = time.monotonic()
        with self.assertRaises(dados.ErroDados) as e:
            self.baixar(timeout_s=0.5, dormir=60)
        self.assertLess(time.monotonic() - inicio, 30)  # o filho foi morto, não esperou os 60 s
        self.assertEqual(str(e.exception), f"o MT5 ({TERMINAL_FALSO}) não respondeu em 0.5 s; "
                                           "abra o terminal, confira o login e tente de novo")

    def test_historico_usa_timeout_s_do_config(self):
        cfg = {"ativos": {"EURUSD": {"fonte": "mt5", "simbolo": "EURUSD", "terminal": TERMINAL_FALSO,
                                     "timeout_s": 0.5}}}
        with tempfile.TemporaryDirectory() as pasta, tempfile.TemporaryDirectory() as cache:
            with open(os.path.join(pasta, "MetaTrader5.py"), "w", encoding="utf-8") as f:
                f.write(MT5_FALSO_FILHO.format(inicializa=True, dormir=60, hora=0))
            with mock.patch.dict(os.environ, {"PYTHONPATH": pasta}):
                with self.assertRaises(dados.ErroDados) as e:
                    dados.historico("EURUSD", date(2026, 10, 20), date(2026, 10, 20), cfg, pasta=cache)
        self.assertIn("não respondeu em 0.5 s", str(e.exception))


CFG_EUR = {"ativos": {"EURUSD": {"fonte": "mt5", "simbolo": "EURUSD", "sessao": {"dias": [0, 1, 2, 3, 4]}}}}


class MtDesde(Mt5Falso):
    """Como Mt5Falso (candles 09:00-09:55 em dias úteis), mas o histórico do servidor só começa em `desde`."""

    def __init__(self, desde, **kw):
        super().__init__(**kw)
        self.desde = epoch(desde)
        self.pedidos = []

    def copy_rates_range(self, simbolo, tf, de, ate):
        self.pedidos.append((de.replace(tzinfo=None), ate.replace(tzinfo=None)))
        return [r for r in super().copy_rates_range(simbolo, tf, de, ate) if r["time"] >= self.desde]


class TestCoberturaEFiltroDeDias(unittest.TestCase):
    def test_domingo_do_forex_nao_vira_dia_de_pregao(self):
        # EURUSD reabre domingo 18:00 em Brasília; sessao.dias é seg-sex, então o domingo não pode sair
        horarios = [datetime(2026, 10, dia, 10, 0) for dia in (19, 20, 21, 22, 23, 26, 27, 28, 29, 30)]
        horarios += [datetime(2026, 10, 25, 18, 0), datetime(2026, 10, 25, 18, 5), datetime(2026, 10, 18, 18, 0)]
        mt5 = Mt5EmHorarios(horarios, simbolos=("EURUSD",))
        with tempfile.TemporaryDirectory() as d:
            cs = dados.historico("EURUSD", date(2026, 10, 19), date(2026, 10, 30), CFG_EUR, pasta=d, mt5=mt5,
                                 hoje=date(2026, 10, 31))
        self.assertEqual(len(cs), 10)
        self.assertNotIn(6, {k.t.weekday() for k in cs})

    def test_cobertura_comeca_no_primeiro_dia_que_chegou(self):
        mt5 = MtDesde(datetime(2026, 10, 22), simbolos=("WDO$",))  # histórico começa em 22/10; pedido é 19-23
        with tempfile.TemporaryDirectory() as d:
            for _ in range(2):
                dados.historico("WDO", date(2026, 10, 19), date(2026, 10, 23), CFG, pasta=d, mt5=mt5,
                                hoje=date(2026, 10, 26))
            with open(os.path.join(d, "WDO_M5.cobertura.csv"), encoding="utf-8") as f:
                self.assertEqual(f.read(), "2026-10-22,2026-10-23\n")
        # 19-21 continuam sem cobertura e são pedidos de novo na segunda chamada
        self.assertEqual(len(mt5.pedidos), 2)
        self.assertEqual(mt5.pedidos[1], (datetime(2026, 10, 19), datetime(2026, 10, 21, 23, 59, 59)))

    def test_hoje_e_a_data_de_brasilia(self):
        brasilia = (datetime.now(timezone.utc) - timedelta(hours=3)).date()
        self.assertEqual(dados._hoje_brasilia(), brasilia)

    def test_duas_threads_no_mesmo_ativo_baixam_uma_vez(self):
        class Lento(Mt5Falso):
            def copy_rates_range(self, simbolo, tf, de, ate):
                time.sleep(0.3)
                return super().copy_rates_range(simbolo, tf, de, ate)
        mt5 = Lento()
        with tempfile.TemporaryDirectory() as d:
            threads = [threading.Thread(target=dados.historico, args=("WDO", date(2026, 9, 1), date(2026, 9, 4), CFG),
                                        kwargs=dict(pasta=d, mt5=mt5, hoje=date(2026, 9, 10))) for _ in range(2)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
        self.assertEqual(mt5.baixadas, 1)


class TestVolumeMt5(unittest.TestCase):
    def taxas(self, *volumes):
        """Um candle por (real_volume, tick_volume) dado."""
        class Fixo(Mt5Falso):
            def copy_rates_range(self, simbolo, tf, de, ate):
                return [{"time": epoch(datetime(2026, 10, 20, 10, 5 * k)), "open": 1.0, "high": 2.0, "low": 0.5,
                         "close": 1.5, "real_volume": real, "tick_volume": ticks}
                        for k, (real, ticks) in enumerate(volumes)]
        mt5 = Fixo(simbolos=("EURUSD",))
        return [k.v for k in dados.baixar_mt5("EURUSD", date(2026, 10, 20), date(2026, 10, 20), mt5)]

    def test_forex_sem_volume_real_usa_tick_volume(self):
        self.assertEqual(self.taxas((0, 120), (0, 80)), [120.0, 80.0])

    def test_com_volume_real_ele_vale_mesmo_num_candle_sem_negocio(self):
        # B3: um candle sem negócios (real 0) não ganha o volume de cotações
        self.assertEqual(self.taxas((7, 120), (0, 80)), [7.0, 0.0])


class TestCsvSeguro(unittest.TestCase):
    def test_escrita_atomica_nao_estraga_o_arquivo_antigo(self):
        antigos = serie(datetime(2026, 9, 1, 9, 0), 3)
        with tempfile.TemporaryDirectory() as d:
            caminho = os.path.join(d, "x.csv")
            dados.salvar_csv(antigos, caminho)
            quebrado = serie(datetime(2026, 9, 2, 9, 0), 3) + [object()]  # falha no meio da escrita
            with self.assertRaises(AttributeError):
                dados.salvar_csv(quebrado, caminho)
            self.assertEqual(dados.ler_csv(caminho), antigos)

    def test_csv_truncado_vira_erro_dados(self):
        with tempfile.TemporaryDirectory() as d:
            caminho = os.path.join(d, "WDO_M5.csv")
            dados.salvar_csv(serie(datetime(2026, 9, 1, 9, 0), 3), caminho)
            with open(caminho, "rb") as f:
                inteiro = f.read()
            for corte in (12, 30, 60):  # cortes no meio da última linha
                with self.subTest(corte=corte):
                    with open(caminho, "wb") as f:
                        f.write(inteiro[:-corte])
                    with self.assertRaises(dados.ErroDados) as e:
                        dados.ler_csv(caminho)
                    self.assertIn(f"cache corrompido em {caminho}", str(e.exception))
                    self.assertIn("apague-o e rode de novo", str(e.exception))

    def test_historico_com_cache_truncado_avisa_qual_arquivo(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "WDO_M5.csv"), "w", encoding="utf-8") as f:
                f.write("t,o,h,l,c,v,delta\n2026-09-01T09:00:00,100.0,102.0,99.0\n")
            with self.assertRaises(dados.ErroDados) as e:
                dados.historico("WDO", date(2026, 9, 1), date(2026, 9, 1), CFG, pasta=d, mt5=Mt5Falso())
        self.assertIn("WDO_M5.csv", str(e.exception))

    def test_cobertura_corrompida_avisa_qual_arquivo(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "WDO_M5.cobertura.csv"), "w", encoding="utf-8") as f:
                f.write("2026-09-01,2026-09\n")
            with self.assertRaises(dados.ErroDados) as e:
                dados.historico("WDO", date(2026, 9, 1), date(2026, 9, 1), CFG, pasta=d, mt5=Mt5Falso())
        self.assertIn("WDO_M5.cobertura.csv", str(e.exception))


if __name__ == "__main__":
    unittest.main()

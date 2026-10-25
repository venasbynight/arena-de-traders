import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest import mock

import motor
from tipos import Candle, Plano

EXEMPLO = os.path.join(os.path.dirname(__file__), "..", ".claude", "skills", "trader-budget", "config.example.json")
CFG = json.load(open(EXEMPLO, encoding="utf-8"))
T = datetime(2026, 9, 1, 10, 0)  # terça-feira, dentro da janela de entradas


def vela(k, o, h, l, c):
    return Candle(T + timedelta(minutes=5 * k), o, h, l, c)


COMPRA = Plano("compra", "limite", 5430.0, 5426.0, 5440.0, "teste")  # 4 pts: 2 contratos com perda máx R$ 100


def conta_comprada():
    """Conta com a compra de 2 contratos já executada a 5430."""
    c = motor.Conta("Teste", "WDO", CFG)
    c.colocar([COMPRA], T, "WDO$")
    c.executar_candle(vela(1, 5432, 5433, 5429.5, 5431), False)
    return c


class TestConta(unittest.TestCase):
    def test_limitada_precisa_passar_1_tick(self):
        c = motor.Conta("Teste", "WDO", CFG)
        ev = c.colocar([COMPRA], T, "WDO$")
        self.assertEqual([e["tipo"] for e in ev], ["ordem"])
        c.executar_candle(vela(1, 5432, 5433, 5430, 5431), False)
        self.assertIsNone(c.posicao)
        c.executar_candle(vela(2, 5431, 5432, 5429.5, 5431), False)
        self.assertEqual((c.posicao["entrada"], c.posicao["contratos"]), (5430.0, 2))

    def test_stop_paga_1_tick(self):
        c = conta_comprada()
        c.executar_candle(vela(2, 5428, 5429, 5425, 5427), False)
        self.assertEqual(c.operacoes[-1]["saida"], 5425.5)
        self.assertEqual(c.operacoes[-1]["motivo_saida"], "stop")

    def test_gap_alem_do_stop(self):
        c = conta_comprada()
        c.executar_candle(vela(2, 5424, 5425, 5420, 5422), False)
        self.assertEqual(c.operacoes[-1]["saida"], 5423.5)

    def test_stop_e_alvo_no_mesmo_candle_conta_stop(self):
        c = conta_comprada()
        c.executar_candle(vela(2, 5430, 5441, 5425, 5435), False)
        self.assertEqual(c.operacoes[-1]["motivo_saida"], "stop")

    def test_candle_da_entrada_so_confere_stop(self):
        c = motor.Conta("Teste", "WDO", CFG)
        c.colocar([COMPRA], T, "WDO$")
        c.executar_candle(vela(1, 5432, 5442, 5429.5, 5441), False)  # passou do alvo no mesmo candle
        self.assertIsNotNone(c.posicao)
        self.assertEqual(c.operacoes, [])

    def test_mercado_que_abre_alem_do_stop_sai_no_prejuizo(self):
        # venda: sinal fechou em 5000, stop 5004, a abertura seguinte já veio em 5006 → sai 1 tick pior que a entrada
        c = motor.Conta("Teste", "WDO", CFG)
        c.colocar([Plano("venda", "mercado", 5000.0, 5004.0, 4992.0, "teste")], T, "WDO$")
        c.executar_candle(vela(1, 5006, 5007, 5005, 5006), False)
        op = c.operacoes[-1]
        self.assertEqual((op["entrada"], op["saida"], op["motivo_saida"]), (5006, 5006.5, "stop"))
        self.assertLess(op["resultado_rs"], 0)
        # compra espelhada: sinal 5000, stop 4996, abertura 4994 → sai em 4993,5
        c = motor.Conta("Teste", "WDO", CFG)
        c.colocar([Plano("compra", "mercado", 5000.0, 4996.0, 5008.0, "teste")], T, "WDO$")
        c.executar_candle(vela(1, 4994, 4995, 4993, 4994), False)
        op = c.operacoes[-1]
        self.assertEqual((op["entrada"], op["saida"], op["motivo_saida"]), (4994, 4993.5, "stop"))
        self.assertLess(op["resultado_rs"], 0)

    def test_zeragem_no_ultimo_candle_existente(self):
        c = conta_comprada()
        ultimo = Candle(datetime(2026, 9, 1, 13, 55), 5431, 5432, 5430, 5431.5)
        c.executar_candle(ultimo, True)
        self.assertEqual((c.operacoes[-1]["saida"], c.operacoes[-1]["motivo_saida"]), (5431.0, "zeragem"))
        self.assertEqual(c.equity[-1][1], c.saldo)

    def test_tres_stops_encerram_o_dia(self):
        c = motor.Conta("Teste", "WDO", CFG)
        for k in range(3):
            c.colocar([COMPRA], T + timedelta(minutes=10 * k), "WDO$")
            c.executar_candle(vela(2 * k + 1, 5432, 5433, 5429.5, 5431), False)
            c.executar_candle(vela(2 * k + 2, 5428, 5429, 5425, 5427), False)
        ev = c.colocar([COMPRA], T + timedelta(minutes=40), "WDO$")
        self.assertEqual(ev[0]["tipo"], "block")
        self.assertTrue(any("3 stops" in m for m in ev[0]["motivos"]))

    def test_resultado_em_reais_com_custos(self):
        c = motor.Conta("Teste", "WDO", CFG)
        c.colocar([Plano("compra", "limite", 5430.0, 5426.0, 5438.5, "teste")], T, "WDO$")
        c.executar_candle(vela(1, 5432, 5433, 5429.5, 5431), False)
        c.executar_candle(vela(2, 5431, 5439, 5430, 5438), False)
        self.assertEqual(c.operacoes[-1]["resultado_rs"], 168.0)

    def test_conta_quebrada_nao_opera(self):
        c = motor.Conta("Teste", "WDO", CFG)
        c.saldo = 100.0  # menos que a margem de 1 contrato (R$ 150)
        ev = c.colocar([COMPRA], T, "WDO$")
        self.assertEqual(ev[0]["tipo"], "block")
        self.assertEqual(c.pendentes, [])

    def test_cria_config_na_primeira_vez(self):
        with tempfile.TemporaryDirectory() as d:
            caminho = os.path.join(d, "trader", "config.json")
            cfg = motor.carregar_config(caminho)
            self.assertTrue(os.path.exists(caminho))
            self.assertEqual(cfg["capital"], CFG["capital"])


    def test_config_regravado_com_o_arquivo_em_uso(self):
        """Windows: quem lê o config segura o arquivo; o os.replace tenta de novo e, se não der, não deixa .tmp."""
        real, chamadas = os.replace, []

        def ocupado_duas_vezes(a, b):
            chamadas.append(a)
            if len(chamadas) <= 2:
                raise PermissionError("em uso")
            return real(a, b)

        with tempfile.TemporaryDirectory() as d:
            caminho = os.path.join(d, "config.json")
            with open(caminho, "w", encoding="utf-8") as f:
                json.dump({"capital": 7000}, f)
            with mock.patch.object(motor.os, "replace", ocupado_duas_vezes), mock.patch.object(motor.time, "sleep"):
                cfg = motor.carregar_config(caminho)
            self.assertEqual(len(chamadas), 3)
            with open(caminho, encoding="utf-8") as f:
                self.assertEqual(json.load(f), cfg)
            # sempre em uso: 5 tentativas; o config em memória serve, o do disco fica como estava e o .tmp some
            with open(caminho, "w", encoding="utf-8") as f:
                json.dump({"capital": 7000}, f)
            sempre = mock.Mock(side_effect=PermissionError("em uso"))
            with mock.patch.object(motor.os, "replace", sempre), mock.patch.object(motor.time, "sleep"):
                self.assertEqual(motor.carregar_config(caminho), cfg)
            self.assertEqual(sempre.call_count, 5)
            self.assertEqual(os.listdir(d), ["config.json"])
            with open(caminho, encoding="utf-8") as f:
                self.assertEqual(json.load(f), {"capital": 7000})

    def test_preco_com_as_casas_do_tick(self):
        self.assertEqual([motor.size.decimais_do_tick(t) for t in (0.5, 5.0, 0.00001, 0.01, 0.25)], [1, 0, 5, 2, 2])
        self.assertEqual([motor.preco(v, t) for v, t in ((5432.5, 0.5), (128500.0, 5.0), (1.0861200000000002, 0.00001),
                                                         (111856.93, 0.01))],
                         ["5432.5", "128500", "1.08612", "111856.93"])
        self.assertEqual(motor.preco(1.1, None), "1.1")  # sem tick (estado antigo): como veio


class TestAtivos(unittest.TestCase):
    """Especificação e sessão vêm do config: WDO, WIN, EURUSD e BTCUSDT."""

    def test_btc_opera_no_domingo(self):
        c = motor.Conta("Teste", "BTCUSDT", CFG)
        domingo = datetime(2026, 10, 25, 10, 0)
        plano = Plano("compra", "limite", 65000.0, 64900.0, 65200.0, "teste")
        ev = c.colocar([plano], domingo, "BTCUSDT")
        self.assertEqual([e["tipo"] for e in ev], ["ordem"], ev)
        self.assertEqual(c.pendentes[0]["ativo"], "BTCUSDT")

    def test_wdo_domingo_continua_fechado(self):
        c = motor.Conta("Teste", "WDO", CFG)
        ev = c.colocar([COMPRA], datetime(2026, 10, 25, 10, 0), "WDO$")
        self.assertEqual(ev[0]["tipo"], "block")
        self.assertTrue(any("fora da sessão" in m for m in ev[0]["motivos"]))

    def test_eurusd_dimensiona_micro_lotes(self):
        plano = {"simbolo": "EURUSD", "ativo": "EURUSD", "lado": "compra", "entrada": 1.08500,
                 "stop": 1.08400, "alvo": 1.08700, "setup": "teste"}
        # 0,001 de risco x R$ 5.400 + 2 x R$ 0,05 = R$ 5,50 por contrato; R$ 100 / 5,50 = 18
        ordem, limites, decide = motor.size.dimensionar(plano, CFG, "2026-09-01")
        self.assertEqual(limites["perda máxima por trade"], 18)
        self.assertEqual((ordem["contratos"], decide), (5, "máximo de contratos"))
        self.assertAlmostEqual(ordem["plano"]["perda_max_rs"] / ordem["contratos"], 5.5)
        # e pela conta: 5 micro lotes passam no trader-risk
        c = motor.Conta("Teste", "EURUSD", CFG)
        ev = c.colocar([Plano("compra", "limite", 1.085, 1.084, 1.087, "teste")], T, "EURUSD")
        self.assertEqual([e["tipo"] for e in ev], ["ordem"], ev)
        self.assertEqual(ev[0]["contratos"], 5)

    def test_wdo_continua_igual(self):
        c = motor.Conta("Teste", "WDO", CFG)
        ev = c.colocar([Plano("compra", "limite", 5432.5, 5428.0, 5441.0, "smc-ob")], T, "WDOX26")
        self.assertEqual([e["tipo"] for e in ev], ["ordem"], ev)
        self.assertEqual((ev[0]["contratos"], c.pendentes[0]["plano"]["perda_max_rs"]), (2, 92.0))
        self.assertEqual((c.tick, c.ponto_rs, c.custo), (0.5, 10.0, 0.5))

    def test_size_e_check_leem_a_mesma_especificacao(self):
        """check.especificacao é uma cópia de size.especificacao (cada skill roda sozinha): não podem divergir."""
        self.assertGreaterEqual(len(CFG["ativos"]), 4)
        for a in CFG["ativos"]:
            self.assertEqual(motor.size.especificacao(a, CFG), motor.check.especificacao(a, CFG), a)

    def test_ativo_fora_do_config_e_recusado(self):
        with self.assertRaises(motor.size.Recusa):
            motor.Conta("Teste", "XYZ", CFG)


def dias_sinteticos(n_dias, semente=1):
    """Passeio aleatório de WDO, 114 candles de 5 min por dia a partir das 9:00, em dias úteis."""
    import random
    r, out, preco, dia = random.Random(semente), [], 5400.0, datetime(2026, 9, 1)
    while n_dias:
        if dia.weekday() < 5:
            for k in range(114):
                o = preco
                c = round((o + r.gauss(0, 2.5)) * 2) / 2
                out.append(Candle(dia.replace(hour=9) + timedelta(minutes=5 * k), o,
                                  max(o, c) + r.choice([0, 0.5, 1, 1.5]), min(o, c) - r.choice([0, 0.5, 1, 1.5]), c))
                preco = c
            n_dias -= 1
        dia += timedelta(days=1)
    return out


class TestBacktest(unittest.TestCase):
    def test_placar_basico(self):
        ops = [{"entrada_t": "2026-09-01T10:00:00", "resultado_rs": v} for v in (100.0, -50.0, 30.0)]
        p = motor.placar(ops)
        self.assertEqual((p["resultado"], p["trades"], p["fator_lucro"], p["confianca"]), (80.0, 3, 2.6, "baixa"))
        self.assertAlmostEqual(p["acerto"], 2 / 3)

    def test_placar_drawdown_e_pior_dia(self):
        ops = [{"entrada_t": f"2026-09-0{d}T10:00:00", "resultado_rs": v} for d, v in ((1, 200.0), (2, -150.0),
                                                                                        (3, -100.0), (4, 300.0))]
        p = motor.placar(ops)
        self.assertEqual((p["drawdown"], p["pior_dia"]), (-250.0, -150.0))

    def test_nao_ve_o_futuro(self):
        from traders import sofia_smc
        cs = dias_sinteticos(3)
        dia2 = cs[114].t.date()
        curto = motor.rodar_backtest("WDO", cs[:228], [sofia_smc], CFG)
        longo = motor.rodar_backtest("WDO", cs, [sofia_smc], CFG)
        so_dia2 = lambda r: [e for e in r["traders"]["Sofia SMC"]["eventos"] if e["t"].startswith(dia2.isoformat())]
        self.assertTrue(so_dia2(curto))
        self.assertEqual(so_dia2(curto), so_dia2(longo))

    def test_nao_ve_o_futuro_dentro_do_dia(self):
        """Cortar os dados no meio do dia 2 não muda nada do que aconteceu antes do corte."""
        from traders import sofia_smc
        cs = dias_sinteticos(3, semente=2)  # semente com 3 entradas no dia 2
        longo = motor.rodar_backtest("WDO", cs, [sofia_smc], CFG)["traders"]["Sofia SMC"]["eventos"]
        dia2 = cs[114].t.date().isoformat()
        self.assertTrue(any(e["tipo"] == "entrada" and e["t"].startswith(dia2) for e in longo))
        for k in range(5, 113, 7):
            # o candle k vira o último do dia: tudo até a abertura dele (inclusive a decisão tomada no
            # fechamento do k-1 e as execuções dentro do k) tem de bater; só a zeragem forçada difere
            corte = cs[114 + k].t.isoformat()
            curto = motor.rodar_backtest("WDO", cs[:114 + k + 1], [sofia_smc], CFG)["traders"]["Sofia SMC"]["eventos"]
            antes = lambda evs: [e for e in evs if e["t"] <= corte and e.get("motivo") != "zeragem"]
            self.assertEqual(antes(curto), antes(longo), f"corte no candle {k} do dia 2")

    def test_blocos_de_60_entregues_ja_fecharam(self):
        """Todo candle de 5 min de um bloco de 60 entregue ao trader já fechou na hora da decisão."""
        import types
        from tipos import Decisao
        cs, vistos = dias_sinteticos(3), []

        class Espiao:
            def __init__(self, ativo, tick, params=None, sessao=None):
                pass

            def decidir(self, hoje5, ontem5, fechados60):
                vistos.append((hoje5[-1].t, [b.t for b in fechados60]))
                return Decisao()

        motor.rodar_backtest("WDO", cs, [types.SimpleNamespace(NOME="Espião", ESTILO="", Trader=Espiao)], CFG)
        self.assertTrue(any(blocos for _, blocos in vistos))
        for agora, blocos in vistos:
            for b in blocos:
                membros = [k.t for k in cs if k.t.date() == b.date() and b <= k.t < b + timedelta(minutes=60)]
                self.assertLessEqual(max(membros), agora, f"bloco {b} entregue em {agora}")

    def test_simbolo_da_corretora_nao_afeta_o_risco(self):
        from traders import sofia_smc
        cfg = json.loads(json.dumps(CFG))
        cfg["ativos"]["WDO"]["simbolo_mt5"] = "#WDOFUT"
        evs = motor.rodar_backtest("WDO", dias_sinteticos(3), [sofia_smc], cfg)["traders"]["Sofia SMC"]["eventos"]
        self.assertFalse(any("ativos" in m for e in evs if e["tipo"] == "block" for m in e["motivos"]))
        self.assertTrue(any(e["tipo"] == "ordem" for e in evs))

    def test_eventos_ordenados_por_horario(self):
        from traders import sofia_smc
        r = motor.rodar_backtest("WDO", dias_sinteticos(2), [sofia_smc], CFG)
        ts = [e["t"] for e in r["traders"]["Sofia SMC"]["eventos"]]
        self.assertEqual(ts, sorted(ts))
        self.assertEqual(len(r["candles"]), 228)


if __name__ == "__main__":
    unittest.main()

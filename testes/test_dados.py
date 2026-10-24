import os
import tempfile
import unittest
from datetime import date, datetime, timedelta

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
        self.liga, self.simbolos, self.baixadas = liga, simbolos, 0

    def initialize(self):
        return self.liga

    def symbol_select(self, simbolo, ligar):
        return simbolo in self.simbolos

    def last_error(self):
        return (1, "erro falso")

    def copy_rates_range(self, simbolo, tf, de, ate):
        self.baixadas += 1
        out, dia = [], de
        while dia < ate:
            if dia.weekday() < 5:
                for k in range(12):
                    t = dia.replace(hour=9, minute=0) + timedelta(minutes=5 * k)
                    epoch = (t - datetime(1970, 1, 1)).total_seconds()
                    out.append({"time": epoch, "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5,
                                "real_volume": 7})
            dia += timedelta(days=1)
        return out


CFG = {"ativos": {"WDO": {"simbolo_mt5": "WDO$"}, "WIN": {"simbolo_mt5": "WIN$"}}}


class TestHistoricoMt5(unittest.TestCase):
    def test_mt5_fechado(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(dados.ErroDados) as e:
                dados.historico("WDO", date(2026, 9, 1), date(2026, 9, 1), CFG, pasta=d, mt5=Mt5Falso(liga=False))
        self.assertIn("abra o MT5 e faça login", str(e.exception))

    def test_simbolo_inexistente(self):
        cfg = {"ativos": {"WDO": {"simbolo_mt5": "WDO$"}}}
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


if __name__ == "__main__":
    unittest.main()

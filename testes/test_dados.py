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


if __name__ == "__main__":
    unittest.main()

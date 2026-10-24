import unittest
from datetime import datetime, timedelta

import estudos
from tipos import Candle, Pivo

T0 = datetime(2026, 9, 1, 9, 0)


def mk(hs, ls=None, cs=None, os_=None):
    """Candles a partir das máximas; mínima = máxima - 1 e fechamento = máxima - 0,5 por padrão."""
    ls = ls or [h - 1 for h in hs]
    cs = cs or [h - 0.5 for h in hs]
    os_ = os_ or [l + 0.5 for l in ls]
    return [Candle(T0 + timedelta(minutes=5 * k), o, h, l, c) for k, (o, h, l, c) in enumerate(zip(os_, hs, ls, cs))]


class TestPivos(unittest.TestCase):
    def test_pivo_topo_confirmado_depois_de_n(self):
        ps = estudos.pivos(mk([1, 2, 5, 3, 2, 1]))
        self.assertEqual(ps, [Pivo(i=2, conf=4, tipo="topo", preco=5)])

    def test_pivo_ignora_empate(self):
        self.assertEqual([p for p in estudos.pivos(mk([1, 5, 5, 1, 1])) if p.tipo == "topo"], [])

    def test_pivo_sem_vizinhos_suficientes(self):
        self.assertEqual([p for p in estudos.pivos(mk([1, 2, 3, 4, 9, 1])) if p.tipo == "topo"], [])


class TestTendencia(unittest.TestCase):
    def test_tendencia_alta_ao_romper_topo(self):
        cs = mk([1, 2, 5, 3, 2, 1, 2, 6], cs=[0.8, 1.8, 4.8, 2.8, 1.8, 0.8, 1.8, 5.5])
        self.assertEqual(estudos.tendencia(cs), "alta")

    def test_tendencia_vira_baixa(self):
        hs = [1, 2, 5, 3, 2, 1, 2, 6, 7, 6, 5, 4, 3, 0]
        ls = [h - 1 for h in hs[:-1]] + [-2]
        cs = [h - 0.5 for h in hs[:-1]] + [-1]
        self.assertEqual(estudos.tendencia(mk(hs, ls, cs)), "baixa")

    def test_tendencia_none_sem_rompimento(self):
        self.assertIsNone(estudos.tendencia(mk([1, 2, 3, 2, 1])))


if __name__ == "__main__":
    unittest.main()

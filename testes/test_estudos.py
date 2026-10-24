import unittest
from datetime import datetime, timedelta

import estudos
from tipos import Candle, Pivo, Zona

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

    def test_tendencia_segue_o_ultimo_rompimento(self):
        # topo 100 rompido; depois fundo 104 (máximas iguais, sem topo novo) rompido para baixo a 102
        cs = ohlc((95, 96, 94, 95.5), (95.5, 97, 95, 96.5), (96.5, 100, 96, 99), (99, 98, 96, 97), (97, 97, 95, 96),
                  (99, 101.5, 99, 101), (105, 106, 104.5, 105.5), (105.5, 106, 104.5, 105), (105, 106, 104, 105),
                  (105, 106, 104.5, 105.5), (105.5, 106, 104.5, 105), (105, 105, 101, 102))
        self.assertEqual(estudos.tendencia(cs), "baixa")

    def test_tendencia_none_sem_rompimento(self):
        self.assertIsNone(estudos.tendencia(mk([1, 2, 3, 2, 1])))


def ohlc(*linhas):
    return [Candle(T0 + timedelta(minutes=5 * k), o, h, l, c) for k, (o, h, l, c) in enumerate(linhas)]


class TestZonas(unittest.TestCase):
    def test_fvg_alta(self):
        cs = mk([10, 11, 15], ls=[9, 10, 12])
        self.assertEqual(estudos.fvgs(cs, 1.0), [Zona(criada=2, lado="alta", topo=12, fundo=10, tipo="fvg")])

    def test_fvg_baixa(self):
        cs = mk([15, 14, 10], ls=[13, 11, 8])
        self.assertEqual(estudos.fvgs(cs, 1.0), [Zona(criada=2, lado="baixa", topo=13, fundo=10, tipo="fvg")])

    def test_fvg_abaixo_do_minimo_ignorado(self):
        cs = mk([10, 11, 15], ls=[9, 10, 10.5])
        self.assertEqual(estudos.fvgs(cs, 1.0), [])

    PERNA = ohlc((5, 6, 4, 5.5), (5.5, 7, 5, 6.5), (6.5, 10, 6, 9),   # topo em 10
                 (9, 9.5, 7, 7.5), (7.5, 8, 5, 5.5),                   # dois candles de baixa
                 (5.5, 8, 5.5, 7.8), (7.8, 11, 7.5, 10.5),             # perna de alta fecha acima de 10
                 (10.5, 11.5, 10, 11))                                 # outro fechamento acima

    def test_ob_alta_ultimo_candle_de_baixa_antes_da_perna(self):
        obs = estudos.order_blocks(self.PERNA)
        self.assertEqual(obs, [Zona(criada=6, lado="alta", topo=8, fundo=5, tipo="ob")])

    def test_ob_um_por_topo_rompido(self):
        self.assertEqual(len([z for z in estudos.order_blocks(self.PERNA) if z.lado == "alta"]), 1)

    def test_ob_baixa_espelho(self):
        espelho = [Candle(k.t, -k.o, -k.l, -k.h, -k.c) for k in self.PERNA]
        self.assertEqual(estudos.order_blocks(espelho), [Zona(criada=6, lado="baixa", topo=-5, fundo=-8, tipo="ob")])


if __name__ == "__main__":
    unittest.main()

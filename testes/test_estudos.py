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


def hlc(*linhas):
    return [Candle(T0 + timedelta(minutes=5 * k), c, h, l, c) for k, (h, l, c) in enumerate(linhas)]


class TestIndicadores(unittest.TestCase):
    def test_media_simples(self):
        self.assertEqual(estudos.sma([1, 2, 3, 4, 5], 3), [None, None, 2.0, 3.0, 4.0])

    def test_didi_curta_e_longa_contra_a_media_do_meio(self):
        # médias de 1, 2 e 3: curta = fech − MA2, longa = MA3 − MA2
        curta, longa = estudos.didi([1, 2, 4, 7], 1, 2, 3)
        self.assertEqual(curta, [None, 0.5, 1.0, 1.5])
        self.assertEqual(longa[:2], [None, None])
        self.assertAlmostEqual(longa[2], 7 / 3 - 3)
        self.assertAlmostEqual(longa[3], 13 / 3 - 5.5)

    def test_didi_padrao_3_8_20(self):
        curta, longa = estudos.didi([10.0] * 20)
        self.assertEqual((curta[6], curta[7], longa[18], longa[19]), (None, 0.0, None, 0.0))

    def test_bollinger_desvio_populacional(self):
        sup, meio, inf = estudos.bollinger([2, 4, 2, 4, 4], 4, 2)
        self.assertEqual((sup[2], meio[3], sup[3], inf[3]), (None, 3.0, 5.0, 1.0))
        self.assertAlmostEqual(sup[4], 3.5 + 2 * 0.75 ** 0.5)  # janela 4, 2, 4, 4: desvio raiz de 0,75

    def test_adx_wilder_com_di(self):
        # n = 2, contas à mão: TR 3, 3, 4, 4; +DM 2, 1, 0, 0; −DM 0, 0, 2, 1
        cs = hlc((10, 8, 9), (12, 9, 11), (13, 10, 12), (12, 8, 9), (11, 7, 8))
        adx, mais, menos = estudos.adx(cs, 2)
        self.assertEqual((adx[:3], mais[:2], menos[:2]), ([None] * 3, [None] * 2, [None] * 2))
        for serie, esperado in ((mais[2:], [50, 150 / 7, 10]), (menos[2:], [0, 200 / 7, 80 / 3]),
                                (adx[3:], [400 / 7, (400 / 7 + 500 / 11) / 2])):
            for v, e in zip(serie, esperado):
                self.assertAlmostEqual(v, e)

    def test_adx_sem_movimento_e_zero(self):
        adx, mais, menos = estudos.adx(hlc(*[(10, 10, 10)] * 6), 2)
        self.assertEqual((adx[-1], mais[-1], menos[-1]), (0.0, 0.0, 0.0))

    def test_trix_ema_tripla_variacao_percentual(self):
        # n = 2 (α = 2/3), cada EMA começa na média dos 2 primeiros valores da anterior; contas à mão:
        # EMA1 2, 2, 14/3, 38/9, 182/27; EMA2 2, 34/9, 110/27, 158/27; EMA3 26/9, 298/81, 1246/243
        trix = estudos.trix([1, 3, 2, 6, 4, 8], 2)
        self.assertEqual(trix[:4], [None] * 4)
        self.assertAlmostEqual(trix[4], 100 * 64 / 234)  # 298/81 contra 26/9
        self.assertAlmostEqual(trix[5], 100 * 352 / 894)  # 1246/243 contra 298/81

    def test_trix_9_comeca_no_candle_25(self):
        trix = estudos.trix([10.0] * 30)
        self.assertEqual((trix[24], trix[25], trix[-1]), (None, 0.0, 0.0))


if __name__ == "__main__":
    unittest.main()

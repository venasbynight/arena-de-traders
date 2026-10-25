import json
import os
import unittest
from datetime import datetime, timedelta
from unittest import mock

import motor
from testes.test_motor import dias_sinteticos
from tipos import Candle, Plano
from traders import didi_agulhada

EXEMPLO = os.path.join(os.path.dirname(__file__), "..", ".claude", "skills", "trader-budget", "config.example.json")
CFG = json.load(open(EXEMPLO, encoding="utf-8"))
ONTEM = datetime(2026, 9, 1, 9, 0)
HOJE = datetime(2026, 9, 2, 9, 0)
PARADO = (5400, 5400.5, 5399.5, 5400)  # todas as médias em 5400, bandas fechadas, ADX zero


def velas(inicio, linhas):
    return [Candle(inicio + timedelta(minutes=5 * k), o, h, l, c) for k, (o, h, l, c) in enumerate(linhas)]


def espelho(cs):
    return [Candle(k.t, 10800 - k.o, 10800 - k.l, 10800 - k.h, 10800 - k.c) for k in cs]


ONTEM_PARADO = velas(ONTEM, [PARADO] * 20)
# depois do mercado parado, um candle forte de alta: MA3 cruza a MA8 para cima e a MA20 para baixo no mesmo candle
AGULHADA_COMPRA = velas(HOJE, [PARADO] * 5 + [(5400, 5403, 5399.5, 5402.5)])


class TestDidi(unittest.TestCase):
    def wdo(self, **params):
        return didi_agulhada.Trader("WDO", 0.5, params)

    def test_agulhada_de_compra_com_stop_1_tick_alem_e_alvo_3x(self):
        d = self.wdo().decidir(AGULHADA_COMPRA, ONTEM_PARADO, [])
        # gatilho 5403 + 0,5; stop 5399,5 − 0,5; risco 4,5 → alvo 5403,5 + 13,5
        self.assertEqual(d.planos, [Plano("compra", "stop", 5403.5, 5399.0, 5417.0, "didi-agulhada", 1)])
        self.assertIn({"tipo": "agulhada", "t": AGULHADA_COMPRA[-1].t.isoformat(), "lado": "compra"}, d.desenhos)
        self.assertFalse(d.sair)

    def test_agulhada_de_venda_espelho(self):
        d = self.wdo().decidir(espelho(AGULHADA_COMPRA), espelho(ONTEM_PARADO), [])
        self.assertEqual(d.planos, [Plano("venda", "stop", 5396.5, 5401.0, 5383.0, "didi-agulhada", 1)])
        self.assertTrue(any(x["tipo"] == "agulhada" and x["lado"] == "venda" for x in d.desenhos))

    def test_alvo_segue_alvo_x(self):
        self.assertEqual(self.wdo(alvo_x=2.0).decidir(AGULHADA_COMPRA, ONTEM_PARADO, []).planos[0].alvo, 5412.5)

    def test_desenho_dos_indicadores_em_toda_decisao(self):
        ind = [x for x in self.wdo().decidir(AGULHADA_COMPRA, ONTEM_PARADO, []).desenhos if x["tipo"] == "indicadores"]
        self.assertEqual(len(ind), 1)
        ind = ind[0]
        self.assertEqual(set(ind), {"tipo", "t", "bb_sup", "bb_meio", "bb_inf", "didi_curta", "didi_longa",
                                    "adx", "di_mais", "di_menos"})
        self.assertEqual((ind["t"], ind["bb_meio"]), (AGULHADA_COMPRA[-1].t.isoformat(), 5400.5))  # 5400,3125 no tick
        self.assertEqual((ind["didi_curta"], ind["didi_longa"]), (0.5208, -0.1875))
        self.assertEqual(ind["di_menos"], 0.0)
        self.assertGreater(ind["di_mais"], 0)
        parado = self.wdo().decidir(AGULHADA_COMPRA[:3], ONTEM_PARADO, [])  # sem agulhada, desenha igual
        self.assertEqual([x["tipo"] for x in parado.desenhos], ["indicadores"])

    def test_sem_adx_subindo_nao_entra(self):
        cs = ONTEM_PARADO + AGULHADA_COMPRA
        caindo = ([None] * (len(cs) - 2) + [30.0, 29.0], [None] * (len(cs) - 1) + [40.0], [None] * (len(cs) - 1) + [5.0])
        with mock.patch.object(didi_agulhada.estudos, "adx", return_value=caindo):
            d = self.wdo().decidir(AGULHADA_COMPRA, ONTEM_PARADO, [])
        self.assertEqual(d.planos, [])
        self.assertTrue(any("ADX" in p for p in d.pensamento))

    def test_sem_di_a_favor_nao_entra(self):
        cs = ONTEM_PARADO + AGULHADA_COMPRA
        contra = ([None] * (len(cs) - 2) + [20.0, 25.0], [None] * (len(cs) - 1) + [10.0], [None] * (len(cs) - 1) + [30.0])
        with mock.patch.object(didi_agulhada.estudos, "adx", return_value=contra):
            self.assertEqual(self.wdo().decidir(AGULHADA_COMPRA, ONTEM_PARADO, []).planos, [])

    def test_sem_bandas_abrindo_nao_entra(self):
        cs = ONTEM_PARADO + AGULHADA_COMPRA
        n = len(cs)
        fechando = ([None] * (n - 2) + [5410.0, 5405.0], [None] * (n - 2) + [5400.0, 5400.0],
                    [None] * (n - 2) + [5390.0, 5395.0])
        with mock.patch.object(didi_agulhada.estudos, "bollinger", return_value=fechando):
            d = self.wdo().decidir(AGULHADA_COMPRA, ONTEM_PARADO, [])
        self.assertEqual(d.planos, [])
        self.assertTrue(any("bandas" in p for p in d.pensamento))

    def test_pouco_historico_nao_opera(self):
        d = self.wdo().decidir(AGULHADA_COMPRA, [], [])
        self.assertEqual(d.planos, [])
        self.assertTrue(any("21" in p for p in d.pensamento))

    def test_sem_agulhada_sem_plano(self):
        self.assertEqual(self.wdo().decidir(velas(HOJE, [PARADO] * 6), ONTEM_PARADO, []).planos, [])

    def test_saida_quando_a_curta_volta_contra(self):
        queda = AGULHADA_COMPRA + velas(HOJE + timedelta(minutes=30), [(5402.5, 5402.5, 5395.5, 5396)])
        d = self.wdo().decidir(queda, ONTEM_PARADO, [])
        self.assertTrue(d.sair)
        self.assertTrue(any("sai" in p for p in d.pensamento))
        segue = AGULHADA_COMPRA + velas(HOJE + timedelta(minutes=30), [(5402.5, 5404, 5402, 5403.5)])
        self.assertFalse(self.wdo().decidir(segue, ONTEM_PARADO, []).sair)

    def test_tf_15_decide_so_no_fechamento_do_15(self):
        ontem = velas(ONTEM, [PARADO] * 60)  # 20 candles de 15
        subida = [(5400, 5401, 5399.5, 5401), (5401, 5402, 5400.5, 5402), (5402, 5403, 5401.5, 5402.5)]
        hoje = velas(HOJE, [PARADO] * 6 + subida)  # o 3º candle de 15 do dia fecha no último de 5
        didi = self.wdo(tf=15)
        d = didi.decidir(hoje, ontem, [])
        self.assertEqual(d.planos, [Plano("compra", "stop", 5403.5, 5399.0, 5417.0, "didi-agulhada", 3)])
        self.assertIn({"tipo": "agulhada", "t": hoje[6].t.isoformat(), "lado": "compra"}, d.desenhos)
        for corte in (7, 8):  # no meio do candle de 15 não decide nada
            d = didi.decidir(hoje[:corte], ontem, [])
            self.assertEqual(d.planos, [])
            self.assertTrue(any("15" in p for p in d.pensamento))
            self.assertEqual([x["tipo"] for x in d.desenhos], ["indicadores"])
        depois = hoje + velas(HOJE + timedelta(minutes=45), [(5402.5, 5403, 5402, 5402.5)])
        self.assertEqual(didi.decidir(depois, ontem, []).planos, [])

    def test_backtest_com_ordem_stop_e_saida_por_sinal(self):
        # agulhada no 6º candle, entrada no 7º; sobe e volta: a MA3 cruza a MA8 para baixo no fechamento em 5401
        dia2 = velas(HOJE, [PARADO] * 5 + [(5400, 5403, 5399.5, 5402.5), (5403, 5405, 5402.5, 5404.5),
                                           (5404.5, 5406.5, 5404, 5406), (5406, 5407.5, 5405.5, 5407),
                                           (5407, 5408, 5406.5, 5407.5), (5407.5, 5407.5, 5402.5, 5403),
                                           (5403, 5403.5, 5400.5, 5401), (5401.5, 5402, 5400.5, 5401)]
                     + [(5401, 5401.5, 5400.5, 5401)] * 3)
        r = motor.rodar_backtest("WDO", ONTEM_PARADO + dia2, [didi_agulhada], CFG)["traders"]["Didi Agulhada"]
        op = r["operacoes"][0]
        self.assertEqual((op["entrada"], op["saida"], op["motivo_saida"]), (5403.5, 5401.0, "sinal"))
        self.assertEqual(op["saida_t"], dia2[12].t.isoformat())  # na abertura do candle seguinte ao sinal
        tipos = [e["tipo"] for e in r["eventos"]]
        self.assertLess(tipos.index("ordem"), tipos.index("entrada"))

    def test_gerente_e_relatorio_aceitam_tf(self):
        import gerente
        import relatorio
        params, r = gerente.ajustar(didi_agulhada, "WDO", dias_sinteticos(3, 22), CFG)
        self.assertEqual(set(params), {"tf", "alvo_x"})
        self.assertIn(params["tf"], didi_agulhada.GRADE["tf"])
        self.assertIn("tf = ", relatorio._params(params))

    def test_nao_ve_o_futuro(self):
        """Cortar os dados no meio do dia 2 não muda nada do que o Didi fez antes do corte, em 5 e em 15."""
        for params, semente in (({}, 12), ({"tf": 15}, 22)):  # sementes com ordem do Didi no dia 2
            cs = dias_sinteticos(3, semente)
            dia2 = cs[114].t.date().isoformat()
            rodar = lambda dados: motor.rodar_backtest("WDO", dados, [(didi_agulhada, params)],
                                                       CFG)["traders"]["Didi Agulhada"]["eventos"]
            longo = rodar(cs)
            self.assertTrue(any(e["tipo"] == "ordem" and e["t"].startswith(dia2) for e in longo), params)
            for k in range(10, 113, 9):
                corte = cs[114 + k].t.isoformat()
                antes = lambda evs: [e for e in evs if e["t"] <= corte and e.get("motivo") != "zeragem"
                                     and not (e["tipo"] == "cancelada" and e["t"] == corte)]
                self.assertEqual(antes(rodar(cs[:114 + k + 1])), antes(longo), f"{params} corte no candle {k}")


if __name__ == "__main__":
    unittest.main()

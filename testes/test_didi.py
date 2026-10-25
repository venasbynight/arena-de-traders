import json
import os
import unittest
from datetime import datetime, timedelta
from unittest import mock

import motor
from testes.test_motor import dias_sinteticos
from tipos import Candle, Plano
from traders import didi_agulhada, sofia_smc

EXEMPLO = os.path.join(os.path.dirname(__file__), "..", ".claude", "skills", "trader-budget", "config.example.json")
CFG = json.load(open(EXEMPLO, encoding="utf-8"))
ONTEM = datetime(2026, 9, 1, 9, 0)
HOJE = datetime(2026, 9, 2, 9, 0)
PARADO = (5400, 5400.5, 5399.5, 5400)  # todas as médias em 5400, bandas fechadas, ADX zero


def velas(inicio, linhas):
    return [Candle(inicio + timedelta(minutes=5 * k), o, h, l, c) for k, (o, h, l, c) in enumerate(linhas)]


def espelho(cs):
    return [Candle(k.t, 10800 - k.o, 10800 - k.l, 10800 - k.h, 10800 - k.c) for k in cs]


ONTEM_PARADO = velas(ONTEM, [PARADO] * 30)
# depois do mercado parado, um candle forte de alta: MA3 cruza a MA8 para cima e a MA20 para baixo no mesmo candle,
# e as bandas (fechadas no parado) abrem nele
AGULHADA_COMPRA = velas(HOJE, [PARADO] * 5 + [(5400, 5403, 5399.5, 5402.5)])
A = len(ONTEM_PARADO) + 5  # índice da agulhada em ontem + hoje
DEPOIS = [(5402.5, 5403, 5402, 5402.5), (5402.5, 5403.5, 5401.5, 5403), (5403, 5403.5, 5402.5, 5403),
          (5403, 5404, 5402.5, 5403.5)]  # candles pequenos, sem outra agulhada
APOS = velas(HOJE + timedelta(minutes=30), DEPOIS)


def trix_extremo(lado):
    """TRIX falso: no fundo e virando para cima (compra) ou no topo e virando para baixo (venda)."""
    s = 1 if lado == "compra" else -1
    return lambda fech, n=9: [s * 1.0] * (len(fech) - 2) + [-s * 1.0, -s * 0.5]


def larguras(ws):
    """Bollinger falso com a largura ws[i] no candle i (o último valor se repete)."""
    def bb(fech, n=8, k=2):
        w = [ws[min(i, len(ws) - 1)] for i in range(len(fech))]
        return [5400 + x / 2 for x in w], [5400.0] * len(fech), [5400 - x / 2 for x in w]
    return bb


class TestDidi(unittest.TestCase):
    def setUp(self):
        self.lado_trix = "compra"
        p = mock.patch.object(didi_agulhada.estudos, "trix", side_effect=lambda f, n=9: trix_extremo(self.lado_trix)(f))
        p.start()
        self.addCleanup(p.stop)

    def wdo(self, **params):
        return didi_agulhada.Trader("WDO", 0.5, params)

    def test_agulhada_com_bandas_abrindo_entra_a_mercado_com_stop_1_tick_alem_e_alvo_3x(self):
        d = self.wdo().decidir(AGULHADA_COMPRA, ONTEM_PARADO, [])
        # referência no fechamento 5402,5; stop 5399,5 − 0,5; risco 3,5 → alvo 5402,5 + 10,5
        self.assertEqual(d.planos, [Plano("compra", "mercado", 5402.5, 5399.0, 5413.0, "didi-agulhada")])
        self.assertIn({"tipo": "agulhada", "t": AGULHADA_COMPRA[-1].t.isoformat(), "lado": "compra"}, d.desenhos)
        self.assertEqual(d.sair, False)  # a MA3 sai do zero exato: não conta como cruzamento para sair

    def test_agulhada_de_venda_espelho(self):
        self.lado_trix = "venda"
        d = self.wdo().decidir(espelho(AGULHADA_COMPRA), espelho(ONTEM_PARADO), [])
        self.assertEqual(d.planos, [Plano("venda", "mercado", 5397.5, 5401.0, 5387.0, "didi-agulhada")])
        self.assertTrue(any(x["tipo"] == "agulhada" and x["lado"] == "venda" for x in d.desenhos))

    def test_alvo_segue_alvo_x(self):
        self.assertEqual(self.wdo(alvo_x=2.0).decidir(AGULHADA_COMPRA, ONTEM_PARADO, []).planos[0].alvo, 5409.5)

    def test_bandas_abrindo_ate_3_candles_depois_entra_no_candle_que_abriu(self):
        hoje = AGULHADA_COMPRA + APOS
        with mock.patch.object(didi_agulhada.estudos, "bollinger", side_effect=larguras([10.0] * (A + 2) + [12.0])):
            for corte in (6, 7):  # na agulhada e no candle seguinte as bandas não abrem: espera
                d = self.wdo().decidir(hoje[:corte], ONTEM_PARADO, [])
                self.assertEqual(d.planos, [])
                self.assertTrue(any("bandas" in p for p in d.pensamento))
            d = self.wdo().decidir(hoje[:8], ONTEM_PARADO, [])
        # gatilho no 2º candle depois da agulhada: fechamento 5403, stop 1 tick abaixo da mínima 5401,5
        self.assertEqual(d.planos, [Plano("compra", "mercado", 5403.0, 5401.0, 5409.0, "didi-agulhada")])
        self.assertFalse(any(x["tipo"] == "agulhada" for x in d.desenhos))  # a seta fica no candle da agulhada

    def test_bandas_sem_abrir_em_3_candles_a_agulhada_expira(self):
        hoje = AGULHADA_COMPRA + APOS
        with mock.patch.object(didi_agulhada.estudos, "bollinger", side_effect=larguras([10.0] * (A + 4) + [12.0])):
            d = self.wdo().decidir(hoje[:9], ONTEM_PARADO, [])
            self.assertEqual(d.planos, [])
            self.assertTrue(any("expirou" in p for p in d.pensamento))
            self.assertEqual(self.wdo().decidir(hoje, ONTEM_PARADO, []).planos, [])  # abriu no 4º: tarde

    def test_so_o_primeiro_candle_que_abre_e_gatilho(self):
        hoje = AGULHADA_COMPRA + APOS
        with mock.patch.object(didi_agulhada.estudos, "bollinger", side_effect=larguras([0.0] * A + [5.0, 8.0])):
            self.assertEqual(len(self.wdo().decidir(hoje[:6], ONTEM_PARADO, []).planos), 1)
            self.assertEqual(self.wdo().decidir(hoje[:7], ONTEM_PARADO, []).planos, [])

    def test_trix_fora_da_extremidade_nao_entra(self):
        sobe = lambda f, n=9: [float(i) for i in range(len(f))]  # subindo, mas no topo dos últimos valores
        with mock.patch.object(didi_agulhada.estudos, "trix", side_effect=sobe):
            d = self.wdo().decidir(AGULHADA_COMPRA, ONTEM_PARADO, [])
        self.assertEqual(d.planos, [])
        self.assertTrue(any("TRIX" in p for p in d.pensamento))

    def test_trix_na_extremidade_mas_sem_virar_nao_entra(self):
        self.lado_trix = "venda"  # para a compra: no fundo, mas ainda caindo
        self.assertEqual(self.wdo().decidir(AGULHADA_COMPRA, ONTEM_PARADO, []).planos, [])

    def test_trix_extremo_e_percentil_dos_ultimos_120(self):
        # nos últimos 120 valores o TRIX atual (29) é o 30º menor: passa no percentil 30, não no 20;
        # os valores −1000 antes deles ficam fora da conta
        ultimos = [float(x) for x in range(120) if x not in (28, 29)] + [28.0, 29.0]
        ontem = velas(ONTEM, [PARADO] * 130)
        falso = lambda f, n=9: [-1000.0] * (len(f) - 120) + ultimos
        with mock.patch.object(didi_agulhada.estudos, "trix", side_effect=falso):
            self.assertEqual(self.wdo().decidir(AGULHADA_COMPRA, ontem, []).planos, [])
            self.assertEqual(len(self.wdo(trix_extremo=0.3).decidir(AGULHADA_COMPRA, ontem, []).planos), 1)

    def test_desenho_dos_indicadores_em_toda_decisao(self):
        ind = [x for x in self.wdo().decidir(AGULHADA_COMPRA, ONTEM_PARADO, []).desenhos if x["tipo"] == "indicadores"]
        self.assertEqual(len(ind), 1)
        ind = ind[0]
        self.assertEqual(set(ind), {"tipo", "t", "bb_sup", "bb_meio", "bb_inf", "didi_curta", "didi_longa",
                                    "adx", "di_mais", "di_menos", "trix"})
        self.assertEqual((ind["t"], ind["bb_meio"]), (AGULHADA_COMPRA[-1].t.isoformat(), 5400.5))  # 5400,3125 no tick
        self.assertEqual((ind["didi_curta"], ind["didi_longa"], ind["trix"]), (0.5208, -0.1875, -0.5))
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
        with mock.patch.object(didi_agulhada.estudos, "bollinger", side_effect=larguras([20.0] * A + [10.0])):
            d = self.wdo().decidir(AGULHADA_COMPRA, ONTEM_PARADO, [])
        self.assertEqual(d.planos, [])
        self.assertTrue(any("bandas" in p for p in d.pensamento))

    def test_pouco_historico_nao_opera(self):
        d = self.wdo().decidir(AGULHADA_COMPRA, ONTEM_PARADO[:20], [])
        self.assertEqual(d.planos, [])
        self.assertTrue(any("27" in p for p in d.pensamento))

    def test_sem_agulhada_sem_plano(self):
        self.assertEqual(self.wdo().decidir(velas(HOJE, [PARADO] * 6), ONTEM_PARADO, []).planos, [])

    def test_saida_quando_a_curta_volta_contra(self):
        queda = AGULHADA_COMPRA + velas(HOJE + timedelta(minutes=30), [(5402.5, 5402.5, 5395.5, 5396)])
        d = self.wdo().decidir(queda, ONTEM_PARADO, [])
        self.assertEqual(d.sair, "compra")  # só tira quem está comprado
        self.assertTrue(any("sai" in p for p in d.pensamento))
        self.lado_trix = "venda"
        self.assertEqual(self.wdo().decidir(espelho(queda), espelho(ONTEM_PARADO), []).sair, "venda")
        segue = AGULHADA_COMPRA + velas(HOJE + timedelta(minutes=30), [(5402.5, 5404, 5402, 5403.5)])
        self.assertEqual(self.wdo().decidir(segue, ONTEM_PARADO, []).sair, False)

    def test_saida_quando_as_bandas_fecham(self):
        hoje = AGULHADA_COMPRA + APOS[:1]
        with mock.patch.object(didi_agulhada.estudos, "bollinger", side_effect=larguras([0.0] * A + [5.0, 4.5])):
            d = self.wdo().decidir(hoje, ONTEM_PARADO, [])
        self.assertIs(d.sair, True)  # qualquer lado
        self.assertTrue(any("bandas" in p and "sai" in p for p in d.pensamento))

    def test_zero_com_folga_do_tick(self):
        # EURUSD: no penúltimo candle a MA3 é igual à MA8, mas em float dá −2,2e-16; no último ela fica acima.
        # Sem folga isso seria a MA3 cruzando para cima (saída de quem está vendido); do zero exato, não é
        ticks = [0] * 20 + [-5, 5, -1, 1, -2, -3, 5, 3]
        fech = [(102556 + v) / 100000 for v in ticks]
        self.assertLess(didi_agulhada.estudos.didi(fech)[0][-2], 0)
        cs = [Candle(HOJE + timedelta(minutes=5 * k), a, max(a, c), min(a, c), c)
              for k, (a, c) in enumerate(zip([fech[0]] + fech, fech))]
        d = didi_agulhada.Trader("EURUSD", 0.00001).decidir(cs, [], [])
        self.assertEqual(d.sair, False)

    def test_tf_15_decide_so_no_fechamento_do_15(self):
        ontem = velas(ONTEM, [PARADO] * 90)  # 30 candles de 15
        subida = [(5400, 5401, 5399.5, 5401), (5401, 5402, 5400.5, 5402), (5402, 5403, 5401.5, 5402.5)]
        hoje = velas(HOJE, [PARADO] * 6 + subida)  # o 3º candle de 15 do dia fecha no último de 5
        didi = self.wdo(tf=15)
        d = didi.decidir(hoje, ontem, [])
        self.assertEqual(d.planos, [Plano("compra", "mercado", 5402.5, 5399.0, 5413.0, "didi-agulhada")])
        self.assertIn({"tipo": "agulhada", "t": hoje[6].t.isoformat(), "lado": "compra"}, d.desenhos)
        for corte in (7, 8):  # no meio do candle de 15 não decide nada
            d = didi.decidir(hoje[:corte], ontem, [])
            self.assertEqual(d.planos, [])
            self.assertTrue(any("15" in p for p in d.pensamento))
            self.assertEqual([x["tipo"] for x in d.desenhos], ["indicadores"])
        depois = hoje + velas(HOJE + timedelta(minutes=45), [(5402.5, 5403, 5402, 5402.5)])
        self.assertEqual(didi.decidir(depois, ontem, []).planos, [])

    def test_backtest_entra_a_mercado_e_sai_por_sinal(self):
        # agulhada com as bandas abrindo no 6º candle, entrada na abertura do 7º; sai no 1º sinal (bandas fechando
        # ou MA3 cruzando a MA8 para baixo), na abertura do candle seguinte, 1 tick pior
        dia2 = velas(HOJE, [PARADO] * 5 + [(5400, 5403, 5399.5, 5402.5), (5403, 5405, 5402.5, 5404.5),
                                           (5404.5, 5406.5, 5404, 5406), (5406, 5407.5, 5405.5, 5407),
                                           (5407, 5408, 5406.5, 5407.5), (5407.5, 5407.5, 5402.5, 5403),
                                           (5403, 5403.5, 5400.5, 5401), (5401.5, 5402, 5400.5, 5401)]
                     + [(5401, 5401.5, 5400.5, 5401)] * 3)
        r = motor.rodar_backtest("WDO", ONTEM_PARADO + dia2, [didi_agulhada], CFG)["traders"]["Didi Agulhada"]
        op = r["operacoes"][0]
        tr = didi_agulhada.Trader("WDO", 0.5)
        sinal = next(i for i in range(6, len(dia2)) if tr.decidir(dia2[:i + 1], ONTEM_PARADO, []).sair)
        self.assertEqual((op["entrada"], op["entrada_t"]), (5403.0, dia2[6].t.isoformat()))
        self.assertEqual((op["saida"], op["saida_t"], op["motivo_saida"]),
                         (dia2[sinal + 1].o - 0.5, dia2[sinal + 1].t.isoformat(), "sinal"))
        tipos = [e["tipo"] for e in r["eventos"]]
        self.assertLess(tipos.index("ordem"), tipos.index("entrada"))


class TestDidiDeVerdade(unittest.TestCase):
    """Backtests com todos os estudos calculados de verdade, TRIX incluso."""

    def test_gerente_e_relatorio_aceitam_tf(self):
        import gerente
        import relatorio
        params, r = gerente.ajustar(didi_agulhada, "WDO", dias_sinteticos(3, 22), CFG)
        self.assertEqual(set(params), {"tf", "alvo_x", "trix_extremo"})
        self.assertIn(params["tf"], didi_agulhada.GRADE["tf"])
        self.assertIn("tf = ", relatorio._params(params))

    def test_indicadores_viram_serie_por_trader(self):
        """Os indicadores saem dos eventos: uma série por trader, em colunas, sem repetir o mesmo candle."""
        cs = dias_sinteticos(3, 12)
        for params, tf in (({}, 5), ({"tf": 15}, 15)):
            r = motor.rodar_backtest("WDO", cs, [(didi_agulhada, params)], CFG)
            didi = r["traders"]["Didi Agulhada"]
            self.assertFalse(any(x["tipo"] == "indicadores" for e in didi["eventos"] if e["tipo"] == "desenho"
                                 for x in e["desenhos"]))
            s = didi["indicadores"]
            self.assertEqual(set(s), {"k", "t", "bb_sup", "bb_meio", "bb_inf", "didi_curta", "didi_longa", "adx",
                                      "di_mais", "di_menos", "trix"})
            self.assertTrue(any(v is not None for v in s["trix"]))
            self.assertEqual({len(v) for v in s.values()}, {len(s["k"])})
            self.assertEqual(len(set(s["t"])), len(s["t"]), tf)  # o meio do candle de 15 não repete o anterior
            self.assertEqual(s["k"], sorted(s["k"]))
            for k, t in zip(s["k"], s["t"]):  # k = o candle de 5 em cujo fechamento o valor ficou conhecido
                fecha = datetime.fromisoformat(r["candles"][k][0]) + timedelta(minutes=5)
                fim = datetime.fromisoformat(t) + timedelta(minutes=tf)
                # em 15, o último candle de 15 do dia só aparece na 1ª decisão do dia seguinte (nunca antes)
                self.assertTrue(fim == fecha if tf == 5 else fim <= fecha, (tf, t, k))
            # o valor da série é o que o trader calculou naquela decisão
            k = s["k"][-1]  # dias de 114 candles: o último é do dia 3, com o dia 2 de ontem
            d = didi_agulhada.Trader("WDO", 0.5, params).decidir(cs[228:k + 1], cs[114:228], [])
            ind = d.desenhos[0]
            self.assertEqual([s[c][-1] for c in ("t", "bb_sup", "didi_curta", "adx", "di_menos", "trix")],
                             [ind[c] for c in ("t", "bb_sup", "didi_curta", "adx", "di_menos", "trix")])
        sofia = motor.rodar_backtest("WDO", cs, [sofia_smc], CFG)["traders"]["Sofia SMC"]
        self.assertNotIn("indicadores", sofia)

    def test_nao_ve_o_futuro(self):
        """Cortar os dados no meio do dia 2 não muda nada do que o Didi fez antes do corte, em 5 e em 15."""
        for params, semente in (({}, 143), ({"tf": 15}, 220)):  # sementes com ordem do Didi no dia 2
            cs = dias_sinteticos(3, semente)
            dia2 = cs[114].t.date().isoformat()
            rodar = lambda dados: motor.rodar_backtest("WDO", dados, [(didi_agulhada, params)],
                                                       CFG)["traders"]["Didi Agulhada"]
            longo = rodar(cs)
            self.assertTrue(any(e["tipo"] == "ordem" and e["t"].startswith(dia2) for e in longo["eventos"]), params)
            self.assertTrue(any(v is not None for v in longo["indicadores"]["trix"]))  # o TRIX entra no corte
            for k in range(10, 113, 9):
                corte = cs[114 + k].t.isoformat()
                antes = lambda evs: [e for e in evs if e["t"] <= corte and e.get("motivo") != "zeragem"
                                     and not (e["tipo"] == "cancelada" and e["t"] == corte)]
                curto = rodar(cs[:114 + k + 1])
                self.assertEqual(antes(curto["eventos"]), antes(longo["eventos"]), f"{params} corte no candle {k}")
                # a série dos indicadores até o corte é a mesma (o último candle do corte vira fim do dia)
                ate = lambda s: {c: [v for j, v in zip(s["k"], s[c]) if j < 114 + k] for c in s}
                self.assertEqual(ate(curto["indicadores"]), ate(longo["indicadores"]), f"{params} corte {k}")


if __name__ == "__main__":
    unittest.main()

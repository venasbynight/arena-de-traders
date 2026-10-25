import unittest
from datetime import datetime, timedelta

import traders
from tipos import Candle, Plano
from traders import rafa_rompimento, sofia_smc, vera_vwap

HOJE = datetime(2026, 9, 2, 9, 0)


def velas(linhas, inicio=HOJE):
    return [Candle(inicio + timedelta(minutes=5 * k), o, h, l, c) for k, (o, h, l, c) in enumerate(linhas)]


def dia_vera(fechamentos, volumes=None):
    """Candles de uma linha só (o = h = l = c), um por fechamento, com volumes opcionais."""
    volumes = volumes or [0.0] * len(fechamentos)
    return [Candle(HOJE + timedelta(minutes=5 * k), c, c, c, c, v) for k, (c, v) in enumerate(zip(fechamentos, volumes))]


# faixa dos 15 primeiros minutos: 100 a 104
FAIXA = velas([(101, 103, 100, 102), (102, 104, 101, 103), (103, 104, 101, 102)])
FECHA_ACIMA = (102, 105, 102, 104.5)
FECHA_ABAIXO = (102, 102, 99, 99.5)


class TestRafa(unittest.TestCase):
    def rafa(self, **params):
        return rafa_rompimento.Trader("WDO", 0.5, params)

    def test_rompe_maxima_compra_a_mercado(self):
        d = self.rafa().decidir(FAIXA + velas([FECHA_ACIMA], HOJE + timedelta(minutes=15)), [], [])
        self.assertEqual(d.planos, [Plano("compra", "mercado", 104.5, 100.0, 110.5, "rompimento")])
        self.assertEqual(d.desenhos, [{"tipo": "zona", "topo": 104, "fundo": 100, "de": HOJE.isoformat(),
                                       "rotulo": "faixa 15 min", "lado": "neutro"}])

    def test_rompe_minima_vende_a_mercado(self):
        d = self.rafa().decidir(FAIXA + velas([FECHA_ABAIXO], HOJE + timedelta(minutes=15)), [], [])
        self.assertEqual(d.planos, [Plano("venda", "mercado", 99.5, 104.0, 93.5, "rompimento")])

    def test_alvo_x_dos_params(self):
        d = self.rafa(alvo_x=2.0).decidir(FAIXA + velas([FECHA_ACIMA], HOJE + timedelta(minutes=15)), [], [])
        self.assertEqual(d.planos[0].alvo, 112.5)

    def test_padrao_e_grade_evitam_alvo_x_1(self):
        # com alvo_x 1.0 o R:R é sempre < 1 (risco passa da altura da faixa), e o rr_minimo de 1.0 recusa tudo
        self.assertEqual(rafa_rompimento.PARAMS["alvo_x"], 1.5)
        self.assertNotIn(1.0, rafa_rompimento.GRADE["alvo_x"])

    def test_um_por_lado_por_dia(self):
        hoje = FAIXA + velas([FECHA_ACIMA], HOJE + timedelta(minutes=15))
        # segundo fechamento acima da máxima: o lado da compra já foi usado
        hoje += velas([(104.5, 106, 104, 105)], HOJE + timedelta(minutes=20))
        self.assertEqual(self.rafa().decidir(hoje, [], []).planos, [])
        # o lado da venda continua livre
        hoje += velas([FECHA_ABAIXO], HOJE + timedelta(minutes=25))
        d = self.rafa().decidir(hoje, [], [])
        self.assertEqual(d.planos, [Plano("venda", "mercado", 99.5, 104.0, 93.5, "rompimento")])
        hoje += velas([(99.5, 99.5, 97, 98)], HOJE + timedelta(minutes=30))
        self.assertEqual(self.rafa().decidir(hoje, [], []).planos, [])

    def test_faixa_estreita_ignora(self):
        estreita = velas([(100.5, 101, 100, 100.5), (100.5, 101, 100, 100.5), (100.5, 101, 100, 100.5)])
        d = self.rafa().decidir(estreita + velas([(101, 102, 101, 101.5)], HOJE + timedelta(minutes=15)), [], [])
        self.assertEqual(d.planos, [])
        self.assertTrue(any("estreita" in p for p in d.pensamento))

    def test_sem_faixa_antes_de_15_min(self):
        d = self.rafa().decidir(FAIXA[:2], [], [])
        self.assertEqual((d.planos, d.desenhos), ([], []))
        # o terceiro candle fecha a faixa (mesmo estourando): ainda não é rompimento
        fecha_alto = velas([(101, 103, 100, 102), (102, 104, 101, 103), (103, 110, 101, 110)])
        self.assertEqual(self.rafa().decidir(fecha_alto, [], []).planos, [])


# 11 fechamentos alternando 5430/5440; o 12º fecha fora da banda, mas antes de 1 desvio além dela
ALTERNADOS = [5430, 5440] * 5 + [5430]
DIA_VENDA = ALTERNADOS + [5445]
DIA_COMPRA = [10870 - c for c in ALTERNADOS] + [10870 - 5445]


class TestVera(unittest.TestCase):
    def vera(self, **params):
        return vera_vwap.Trader("WDO", 0.5, params)

    def test_vende_acima_da_banda(self):
        d = self.vera().decidir(dia_vera(DIA_VENDA), [], [])
        self.assertEqual(d.planos, [Plano("venda", "mercado", 5445.0, 5446.5, 5435.5, "vwap")])
        self.assertEqual([(x["rotulo"], x["preco"]) for x in d.desenhos],
                         [("VWAP", 5435.5), ("banda +", 5441.0), ("banda −", 5430.0)])
        self.assertTrue(all(x["tipo"] == "linha" for x in d.desenhos))

    def test_compra_abaixo_da_banda(self):
        d = self.vera().decidir(dia_vera(DIA_COMPRA), [], [])
        self.assertEqual(d.planos, [Plano("compra", "mercado", 5425.0, 5423.5, 5434.5, "vwap")])

    def test_espera_12_candles(self):
        d = self.vera().decidir(dia_vera(DIA_VENDA[:11]), [], [])
        self.assertEqual((d.planos, d.desenhos), ([], []))
        self.assertEqual(len(self.vera().decidir(dia_vera(DIA_VENDA), [], []).planos), 1)

    def test_volume_zero_usa_peso_1(self):
        # v = 0 em todos os candles: VWAP é a média dos preços típicos, sem divisão por zero
        d = self.vera().decidir(dia_vera(DIA_VENDA, [0.0] * 12), [], [])
        self.assertEqual(d.desenhos[0], {"tipo": "linha", "preco": 5435.5, "rotulo": "VWAP"})

    def test_vwap_pesa_pelo_volume(self):
        d = self.vera().decidir(dia_vera(DIA_VENDA, [1.0] * 11 + [3.0]), [], [])
        self.assertEqual(d.desenhos[0]["preco"], 5437.0)  # sem volume seria 5435,5

    def test_nao_repete_enquanto_fica_fora(self):
        dia = dia_vera(DIA_VENDA + [5445])
        self.assertEqual(self.vera().decidir(dia, [], []).planos, [])
        # voltou para dentro da banda e saiu de novo: novo sinal
        dia = dia_vera(DIA_VENDA + [5435, 5445])
        self.assertEqual(len(self.vera().decidir(dia, [], []).planos), 1)

    def test_fechamento_alem_do_stop_nao_entra(self):
        # fecha tão longe da banda que o stop (1 desvio além dela) ficaria do lado errado
        d = self.vera().decidir(dia_vera(ALTERNADOS + [5460]), [], [])
        self.assertEqual(d.planos, [])
        self.assertTrue(any("stop" in p for p in d.pensamento))


class TestSalas(unittest.TestCase):
    def test_salas_tem_tres_traders(self):
        self.assertEqual(traders.TODOS, [sofia_smc, rafa_rompimento, vera_vwap])
        self.assertEqual(set(traders.SALAS), {"WDO", "WIN", "EURUSD", "BTCUSDT"})
        for sala in traders.SALAS.values():
            self.assertEqual(sala, traders.TODOS)

    def test_contrato_dos_traders(self):
        for m in traders.TODOS:
            self.assertTrue(m.NOME and m.ESTILO and m.PARAMS and m.GRADE)
            self.assertTrue(set(m.GRADE) <= set(m.PARAMS))
            for chave, valores in m.GRADE.items():
                self.assertIn(m.PARAMS[chave], valores)  # o padrão faz parte do que o gerente testa
            m.Trader("WDO", 0.5, None, {"inicio": "09:05"})  # sessao opcional


if __name__ == "__main__":
    unittest.main()

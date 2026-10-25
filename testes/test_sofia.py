import unittest
from datetime import datetime, timedelta

import traders
from tipos import Candle, Plano
from testes.robos_teste import ALFA, BETA
from traders import didi_agulhada, sofia_smc

ONTEM = datetime(2026, 9, 1, 9, 0)
HOJE = datetime(2026, 9, 2, 9, 0)


def velas(inicio, linhas):
    return [Candle(inicio + timedelta(minutes=5 * k), o, h, l, c) for k, (o, h, l, c) in enumerate(linhas)]


def tendencia_60(direcao):
    """Candles de 60 min que terminam com rompimento de topo (alta) ou de fundo (baixa)."""
    hs = [1, 2, 5, 3, 2, 1, 2, 6]
    cs = [0.8, 1.8, 4.8, 2.8, 1.8, 0.8, 1.8, 5.5]
    if direcao == "baixa":  # espelho: mínimas = 7 - máximas, fechamentos = 7 - fechamentos
        return [Candle(ONTEM + timedelta(hours=k), 7 - c, 8 - h, 7 - h, 7 - c) for k, (h, c) in enumerate(zip(hs, cs))]
    return [Candle(ONTEM + timedelta(hours=k), c, h, h - 1, c) for k, (h, c) in enumerate(zip(hs, cs))]


# ontem com um fundo em 5420 e um topo em 5442
ONTEM_WDO = velas(ONTEM, [(5428, 5430, 5425, 5426), (5426, 5427, 5423, 5424), (5424, 5425, 5420, 5422),
                          (5422, 5428, 5424, 5427), (5427, 5442, 5426, 5440), (5440, 5441, 5430, 5432),
                          (5432, 5433, 5431, 5432)])
# hoje: FVG de baixa entre 5431,5 e 5434,5
HOJE_FVG_BAIXA = velas(HOJE, [(5437, 5438, 5434.5, 5435), (5435, 5435, 5430, 5431), (5431, 5431.5, 5428, 5429)])


class TestSofia(unittest.TestCase):
    def wdo(self):
        return sofia_smc.Trader("WDO", 0.5)

    def test_sem_tendencia_sem_plano(self):
        d = self.wdo().decidir(HOJE_FVG_BAIXA, ONTEM_WDO, [])
        self.assertEqual(d.planos, [])

    def test_venda_no_meio_do_fvg(self):
        d = self.wdo().decidir(HOJE_FVG_BAIXA, ONTEM_WDO, tendencia_60("baixa"))
        self.assertEqual(d.planos, [Plano("venda", "limite", 5433.0, 5435.5, 5420.0, "smc-fvg")])
        self.assertTrue(any(x["tipo"] == "zona" and x["rotulo"] == "FVG" for x in d.desenhos))

    def test_win_compra_no_tick(self):
        ontem = velas(ONTEM, [(128450, 128500, 128440, 128490), (128490, 128550, 128480, 128540),
                              (128540, 128600, 128530, 128560), (128560, 128540, 128500, 128510),
                              (128510, 128520, 128480, 128500)])
        hoje = velas(HOJE, [(128380, 128400, 128350, 128390), (128390, 128520, 128385, 128510),
                            (128510, 128560, 128470, 128540)])
        d = sofia_smc.Trader("WIN", 5.0).decidir(hoje, ontem, tendencia_60("alta"))
        self.assertEqual(d.planos, [Plano("compra", "limite", 128435.0, 128390.0, 128600.0, "smc-fvg")])

    def test_meio_arredonda_ao_tick(self):
        ontem = velas(ONTEM, [(128450, 128500, 128440, 128490), (128490, 128550, 128480, 128540),
                              (128540, 128600, 128530, 128560), (128560, 128540, 128500, 128510),
                              (128510, 128520, 128480, 128500)])
        hoje = velas(HOJE, [(128380, 128400, 128350, 128390), (128390, 128520, 128385, 128510),
                            (128510, 128560, 128475, 128540)])
        d = sofia_smc.Trader("WIN", 5.0).decidir(hoje, ontem, tendencia_60("alta"))
        self.assertEqual(d.planos[0].entrada, 128440.0)

    def test_sem_alvo_nao_entra(self):
        sem_topo = velas(ONTEM, [(128000, 128010, 127990, 128000)] * 5)
        hoje = velas(HOJE, [(128380, 128400, 128350, 128390), (128390, 128520, 128385, 128510),
                            (128510, 128560, 128470, 128540)])
        d = sofia_smc.Trader("WIN", 5.0).decidir(hoje, sem_topo, tendencia_60("alta"))
        self.assertEqual(d.planos, [])
        self.assertTrue(any("sem alvo" in p for p in d.pensamento))

    def test_zona_invalidada_por_fechamento(self):
        hoje = HOJE_FVG_BAIXA + velas(HOJE + timedelta(minutes=15), [(5429, 5437, 5429, 5436)])
        d = self.wdo().decidir(hoje, ONTEM_WDO, tendencia_60("baixa"))
        self.assertEqual(d.planos, [])

    def test_zona_usada_nao_volta(self):
        # o candle seguinte passa 1 tick da entrada (5433) sem fechar acima da zona
        hoje = HOJE_FVG_BAIXA + velas(HOJE + timedelta(minutes=15), [(5429, 5433.5, 5428, 5430)])
        d = self.wdo().decidir(hoje, ONTEM_WDO, tendencia_60("baixa"))
        self.assertEqual(d.planos, [])

    def test_zona_de_ontem_nao_vale(self):
        ontem = ONTEM_WDO + velas(ONTEM + timedelta(minutes=35), [(5437, 5438, 5434.5, 5435),
                                                                  (5435, 5435, 5430, 5431),
                                                                  (5431, 5431.5, 5428, 5429)])
        hoje = velas(HOJE, [(5429, 5430, 5428, 5429)])
        d = self.wdo().decidir(hoje, ontem, tendencia_60("baixa"))
        self.assertEqual(d.planos, [])

    def test_btc_fvg_de_25_usd_opera_e_de_10_nao(self):
        # ontem deslocado para o nível do BTC: fundo em 64900 (alvo da venda)
        ontem = [Candle(k.t, k.o + 59480, k.h + 59480, k.l + 59480, k.c + 59480) for k in ONTEM_WDO]

        def hoje(maxima_do_3o):  # FVG de baixa entre a mínima do 1º candle (65030) e a máxima do 3º
            return velas(HOJE, [(65040, 65045, 65030, 65035), (65035, 65035, 65010, 65012),
                                (maxima_do_3o - 2, maxima_do_3o, 64990, 64995)])

        btc = sofia_smc.Trader("BTCUSDT", 0.01)
        d = btc.decidir(hoje(65005), ontem, tendencia_60("baixa"))
        self.assertEqual(len(d.planos), 1)
        self.assertEqual((d.planos[0].lado, d.planos[0].alvo), ("venda", 64900.0))
        self.assertAlmostEqual(d.planos[0].entrada, 65017.5)
        self.assertEqual(btc.decidir(hoje(65020), ontem, tendencia_60("baixa")).planos, [])

    def test_ativo_sem_fvg_minimo_usa_dois_ticks(self):
        # o FVG de 3 pontos do WDO passa de 2 ticks de 0,5 = 1 ponto; um ativo desconhecido não levanta erro
        xyz = sofia_smc.Trader("XYZ", 0.5)
        self.assertEqual(len(xyz.decidir(HOJE_FVG_BAIXA, ONTEM_WDO, tendencia_60("baixa")).planos), 1)
        # buraco de meio ponto (1 tick) é menor que 2 ticks: fica de fora
        pequeno = velas(HOJE, [(5437, 5438, 5434.5, 5435), (5435, 5435, 5432, 5433), (5433, 5434, 5431, 5432)])
        self.assertEqual(xyz.decidir(pequeno, ONTEM_WDO, tendencia_60("baixa")).planos, [])

    def test_arredondar_tick_sem_ruido_de_ponto_flutuante(self):
        self.assertEqual(sofia_smc.arredondar_tick(1.086124, 0.00001), 1.08612)  # sem o round de fora: 1.0861200000000002
        self.assertEqual(sofia_smc.arredondar_tick(128437.0, 5.0), 128435.0)


class TestSalas(unittest.TestCase):
    def test_sofia_e_didi_negociam(self):
        self.assertEqual(traders.TODOS, [sofia_smc, didi_agulhada])
        self.assertEqual(set(traders.SALAS), {"WDO", "WIN", "EURUSD", "BTCUSDT"})
        for sala in traders.SALAS.values():
            self.assertEqual(sala, traders.TODOS)

    def test_contrato_dos_traders(self):
        for m in traders.TODOS + [ALFA, BETA]:  # os robôs de teste seguem o mesmo contrato dos reais
            self.assertTrue(m.NOME and m.ESTILO and m.PARAMS and m.GRADE)
            self.assertTrue(set(m.GRADE) <= set(m.PARAMS))
            for chave, valores in m.GRADE.items():
                self.assertIn(m.PARAMS[chave], valores)  # o padrão faz parte do que o gerente testa
            m.Trader("WDO", 0.5, None, {"inicio": "09:05"})  # sessao opcional


if __name__ == "__main__":
    unittest.main()

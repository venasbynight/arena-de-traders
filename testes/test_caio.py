import json
import os
import random
import unittest
from unittest import mock
from dataclasses import replace
from datetime import datetime, timedelta

import motor
import traders
from testes.test_motor import dias_sinteticos
from tipos import Candle, Plano
from traders import caio_contrafluxo, didi_agulhada, sofia_smc

EXEMPLO = os.path.join(os.path.dirname(__file__), "..", ".claude", "skills", "trader-budget", "config.example.json")
EXEMPLO_CFG = json.load(open(EXEMPLO, encoding="utf-8"))
# mecânica do motor com os limites antigos (R:R 1, teto de 5): os planos daqui têm R:R 2–2,5; as regras do Diretor
# (R:R 3, sem teto de 5) estão em TestRegrasDoDiretor e nos autotestes das skills
CFG = {**EXEMPLO_CFG, "rr_minimo": 1.0, "max_contratos": 5}
HOJE = datetime(2026, 9, 2, 9, 0)


def velas(inicio, linhas, minutos=5):
    """(o, h, l, c, delta) por candle."""
    return [Candle(inicio + timedelta(minutes=minutos * k), o, h, l, c, 10.0, d)
            for k, (o, h, l, c, d) in enumerate(linhas)]


def espelho(cs):
    return [Candle(k.t, 10800 - k.o, 10800 - k.l, 10800 - k.h, 10800 - k.c, k.v,
                   None if k.delta is None else -k.delta) for k in cs]


# 60 min: fundo em 5395 confirmado e fechamento abaixo dele = tendência de baixa
BAIXA60 = velas(datetime(2026, 9, 1, 9, 0), [(5402, 5405, 5400, 5401, 0), (5401, 5404, 5399, 5400, 0),
                                             (5400, 5403, 5395, 5399, 0), (5399, 5404, 5397, 5400, 0),
                                             (5400, 5404, 5398, 5399, 0), (5399, 5400, 5393, 5394, 0)], 60)
ALTA60 = espelho(BAIXA60)
# 5 min: topo em 5405 (candle 2, confirmado no 4) e fundo em 5394 (candle 5, confirmado no 7)
BASE = [(5400, 5401, 5399, 5400, 0), (5400, 5403, 5399.5, 5402.5, 0), (5402.5, 5405, 5402, 5403, 0),
        (5403, 5404, 5398, 5398.5, 0), (5398.5, 5399, 5395, 5396, 0), (5396, 5397, 5394, 5395, 0),
        (5395, 5398, 5395.5, 5397.5, 0), (5397.5, 5401, 5397, 5400.5, 0)]
SINAL = (5400.5, 5404.5, 5400, 5401)  # a máxima chega a 1 ponto (2 ticks) do topo


def dia(*sinal, delta=600):
    return velas(HOJE, BASE + [(*(sinal or SINAL), delta)])


class TestCaio(unittest.TestCase):
    def wdo(self, **params):
        # os números destes testes são do stop de 2 ticks de antes do Plano 7; o padrão de 4 tem teste próprio
        return caio_contrafluxo.Trader("WDO", 0.5, {"limite": 500, "folga_ticks": 2, **params})

    def test_venda_na_resistencia_com_delta_comprador_em_tendencia_de_baixa(self):
        d = self.wdo().decidir(dia(), [], BAIXA60)
        # a mercado na abertura do próximo; stop 2 ticks acima do topo 5405; alvo o fundo 5394
        self.assertEqual(d.planos, [Plano("venda", "mercado", 5401.0, 5406.0, 5394.0, "caio-contrafluxo")])
        self.assertIn({"tipo": "indicadores", "t": dia()[-1].t.isoformat(), "delta": 600, "limite": 500}, d.desenhos)
        self.assertIn({"tipo": "linha", "preco": 5394.0, "rotulo": "fundo · alvo"}, d.desenhos)

    def test_stop_padrao_4_ticks_alem_do_extremo(self):
        # Plano 7: o Diretor pediu "um pouquinho mais" de stop (era 2 ticks)
        self.assertEqual(caio_contrafluxo.PARAMS["folga_ticks"], 4)
        d = caio_contrafluxo.Trader("WDO", 0.5, {"limite": 500}).decidir(dia(), [], BAIXA60)
        self.assertEqual(d.planos, [Plano("venda", "mercado", 5401.0, 5407.0, 5394.0, "caio-contrafluxo")])

    def test_stop_alem_da_maxima_do_sinal_quando_ela_passa_do_topo(self):
        d = self.wdo().decidir(dia(5400.5, 5407, 5400, 5401), [], BAIXA60)
        self.assertEqual(d.planos[0].stop, 5408.0)

    def test_compra_no_suporte_espelho(self):
        d = self.wdo().decidir(espelho(dia()), [], ALTA60)
        self.assertEqual(d.planos, [Plano("compra", "mercado", 5399.0, 5394.0, 5406.0, "caio-contrafluxo")])

    def test_zonas_de_suporte_e_resistencia_do_dia(self):
        zonas = [x for x in self.wdo().decidir(dia(delta=0), [], BAIXA60).desenhos if x["tipo"] == "zona"]
        self.assertEqual(zonas, [
            {"tipo": "zona", "lado": "baixa", "topo": 5405, "fundo": 5404.0, "de": dia()[2].t.isoformat(),
             "rotulo": "resistência"},
            {"tipo": "zona", "lado": "alta", "topo": 5395.0, "fundo": 5394, "de": dia()[5].t.isoformat(),
             "rotulo": "suporte"}])

    def test_delta_no_limite_nao_e_sinal(self):
        self.assertEqual(self.wdo().decidir(dia(delta=500), [], BAIXA60).planos, [])
        self.assertEqual(self.wdo(limite=400).decidir(dia(delta=500), [], BAIXA60).planos[0].lado, "venda")

    def test_delta_vendedor_na_resistencia_nao_e_sinal(self):
        self.assertEqual(self.wdo().decidir(dia(delta=-600), [], BAIXA60).planos, [])

    def test_tendencia_de_alta_nao_vende(self):
        self.assertEqual(self.wdo().decidir(dia(), [], ALTA60).planos, [])
        d = self.wdo().decidir(dia(), [], [])
        self.assertEqual(d.planos, [])
        self.assertIn("sem tendência", d.pensamento[0])

    def test_longe_da_resistencia_nao_e_sinal(self):
        # máxima a 1,5 ponto (3 ticks) do topo
        self.assertEqual(self.wdo().decidir(dia(5400.5, 5403.5, 5400, 5401), [], BAIXA60).planos, [])
        # candle inteiro acima do topo: já passou da região
        self.assertEqual(self.wdo().decidir(dia(5406, 5408, 5405.5, 5407), [], BAIXA60).planos, [])

    def test_sem_fundo_abaixo_nao_entra(self):
        cs = velas(HOJE, BASE[:5] + [(5396, 5404.5, 5395.5, 5397, 600)])  # o fundo de 5394 ainda não existe
        d = self.wdo().decidir(cs, [], BAIXA60)
        self.assertEqual(d.planos, [])
        self.assertTrue(any("sem fundo abaixo" in linha for linha in d.pensamento), d.pensamento)

    def test_topo_ainda_nao_confirmado_nao_e_resistencia(self):
        # o topo de 5405 confirma no fechamento do candle 4; o próprio candle 4 não pode ser o sinal
        cs = velas(HOJE, BASE[:4] + [(5398.5, 5404.5, 5395, 5396, 600)])
        self.assertEqual(self.wdo().decidir(cs, [], BAIXA60).planos, [])

    def test_cada_topo_gera_um_sinal_por_dia(self):
        caio = self.wdo()
        cs = dia()
        self.assertEqual(len(caio.decidir(cs, [], BAIXA60).planos), 1)
        de_novo = cs + velas(cs[-1].t + timedelta(minutes=5), [(5401, 5404.5, 5400.5, 5402, 900)])
        d = caio.decidir(de_novo, [], BAIXA60)
        self.assertEqual(d.planos, [])
        self.assertNotIn("resistência", [x.get("rotulo") for x in d.desenhos])  # a zona usada sai do gráfico
        # no dia seguinte o mesmo índice de candle é outro topo
        amanha = [replace(k, t=k.t + timedelta(days=1)) for k in cs]
        self.assertEqual(len(caio.decidir(amanha, cs, BAIXA60).planos), 1)

    def test_dia_sem_delta_nao_opera(self):
        d = self.wdo().decidir(dia(delta=None), [], BAIXA60)
        self.assertEqual(d.planos, [])
        self.assertIn("sem delta", d.pensamento[0])
        self.assertIn({"tipo": "indicadores", "t": dia()[-1].t.isoformat(), "delta": None, "limite": 500}, d.desenhos)

    def test_limite_padrao_por_ativo(self):
        self.assertEqual(caio_contrafluxo.Trader("WIN", 5.0)._limite(), 10000)
        self.assertEqual(caio_contrafluxo.Trader("WDO", 0.5)._limite(), caio_contrafluxo.PARAMS["limite"]["WDO"])
        self.assertIsNone(caio_contrafluxo.Trader("EURUSD", 0.00001)._limite())
        self.assertIn("sem limite de delta", caio_contrafluxo.Trader("EURUSD", 0.00001).decidir(
            dia(), [], BAIXA60).pensamento[0])

    def test_nao_ve_o_futuro(self):
        """Cortar os dados no meio do dia 2 não muda nada do que o Caio fez antes do corte."""
        rr = random.Random(3)
        cs = [replace(k, delta=float(rr.choice([0, 0, 0, 1, -1]) * rr.randint(0, 900))) for k in dias_sinteticos(3, 5)]
        for params in ({"limite": 300},
                       {"limite": 300, "limite_pct": 50, "tendencia": "dia", "alvo_rr": 2}):
            rodar = lambda dados: motor.rodar_backtest("WDO", dados, [(caio_contrafluxo, params)],
                                                       CFG)["traders"]["Caio Contrafluxo"]
            longo = rodar(cs)
            self.assertTrue(any(e["tipo"] == "entrada" for e in longo["eventos"]), params)
            for k in range(10, 113, 9):
                corte = cs[114 + k].t.isoformat()
                antes = lambda evs: [e for e in evs if e["t"] <= corte and e.get("motivo") != "zeragem"]
                curto = rodar(cs[:114 + k + 1])
                self.assertEqual(antes(curto["eventos"]), antes(longo["eventos"]), f"corte no candle {k}, {params}")
        s = longo["indicadores"]
        self.assertEqual(set(s), {"k", "t", "delta", "limite"})
        self.assertEqual(s["delta"][0], cs[0].delta)

    # --- chaves da pesquisa do Plano 6 (desligadas no padrão) ---

    def test_tendencia_do_dia_e_ambos(self):
        abre_acima = velas(HOJE, [(5402, 5402, 5399, 5400, 0)] + BASE[1:] + [(*SINAL, 600)])
        self.assertEqual(self.wdo(tendencia="dia").decidir(abre_acima, [], []).planos[0].lado, "venda")
        self.assertEqual(self.wdo(tendencia="dia").decidir(dia(), [], BAIXA60).planos, [])  # fecha acima da abertura
        self.assertEqual(self.wdo(tendencia="ambos").decidir(abre_acima, [], []).planos, [])
        self.assertEqual(self.wdo(tendencia="ambos").decidir(abre_acima, [], BAIXA60).planos[0].lado, "venda")

    def test_confirma_espera_o_candle_seguinte(self):
        caio = lambda: self.wdo(confirma=True)
        self.assertEqual(caio().decidir(dia(), [], BAIXA60).planos, [])
        seguinte = lambda *k: dia() + velas(dia()[-1].t + timedelta(minutes=5), [(*k, 0)])
        d = caio().decidir(seguinte(5401, 5402, 5399, 5399.5), [], BAIXA60)
        self.assertEqual(d.planos, [Plano("venda", "mercado", 5399.5, 5406.0, 5394.0, "caio-contrafluxo")])
        d = caio().decidir(seguinte(5401, 5403, 5400.5, 5402), [], BAIXA60)
        self.assertEqual(d.planos, [])
        self.assertTrue(any("não confirmou" in linha for linha in d.pensamento), d.pensamento)

    def test_alvo_por_risco_retorno(self):
        self.assertEqual(self.wdo(alvo_rr=2).decidir(dia(), [], BAIXA60).planos[0].alvo, 5391.0)  # 5401 − 2 × 5

    def test_horario(self):
        self.assertEqual(self.wdo(horario=["10:00", "17:00"]).decidir(dia(), [], BAIXA60).planos, [])  # sinal 09:40
        self.assertEqual(len(self.wdo(horario=["09:00", "10:00"]).decidir(dia(), [], BAIXA60).planos), 1)

    def test_limite_pelo_percentil_de_ontem_e_hoje(self):
        ontem = velas(HOJE - timedelta(days=1), [(5400, 5401, 5399, 5400, i) for i in range(1, 61)])
        caio = self.wdo(limite_pct=90)
        self.assertEqual(caio._limite(ontem + dia()[:-1]), 53)  # 8 zeros de hoje + 1..60 de ontem
        self.assertEqual(len(caio.decidir(dia(), ontem, BAIXA60).planos), 1)
        self.assertEqual(caio.decidir(dia(delta=53), ontem, BAIXA60).planos, [])
        d = self.wdo(limite_pct=90).decidir(dia(), [], BAIXA60)  # menos de 50 candles com delta
        self.assertEqual(d.planos, [])
        # com percentil, ativo sem limite fixo (BTCUSDT) também opera
        self.assertEqual(caio_contrafluxo.Trader("BTCUSDT", 0.01, {"limite_pct": 90})._limite(ontem), 54)
        self.assertIsNone(caio_contrafluxo.Trader("BTCUSDT", 0.01)._limite(ontem))

    def test_lado_agressor_e_so_diagnostico_e_inverte_o_trade(self):
        self.assertEqual(caio_contrafluxo.PARAMS["lado"], "contra")  # o Caio continua contra o agressor
        d = self.wdo(lado="agressor", alvo_rr=2).decidir(dia(), [], BAIXA60)
        # mesmo sinal (comprador forte na resistência, tendência de baixa): compra; stop 2 ticks abaixo da mínima
        self.assertEqual(d.planos, [Plano("compra", "mercado", 5401.0, 5399.0, 5405.0, "caio-agressor")])
        d = self.wdo(lado="agressor").decidir(espelho(dia()), [], ALTA60)
        self.assertEqual((d.planos[0].lado, d.planos[0].stop, d.planos[0].alvo), ("venda", 5401.0, 5395.0))

    def test_rejeicao_exige_passar_do_nivel_e_fechar_de_volta(self):
        self.assertEqual(self.wdo(rejeicao=True).decidir(dia(), [], BAIXA60).planos, [])  # máxima 5404,5 < 5405
        d = self.wdo(rejeicao=True).decidir(dia(5400.5, 5406, 5400, 5401), [], BAIXA60)
        self.assertEqual((d.planos[0].lado, d.planos[0].stop), ("venda", 5407.0))

    def test_gerente_testa_a_grade_do_ativo(self):
        import gerente
        rr = random.Random(1)
        cs = [replace(k, delta=float(rr.randint(-900, 900))) for k in dias_sinteticos(3, 22)]
        vistos = []
        real = gerente._rodar
        with mock.patch.object(gerente, "_rodar", lambda a, c, m, p, cfg: vistos.append(p) or real(a, c, m, p, cfg)):
            params, _ = gerente.ajustar(caio_contrafluxo, "WDO", cs, CFG)
        grade = caio_contrafluxo.GRADE["limite"]["WDO"]
        self.assertEqual([p["limite"] for p in vistos], [caio_contrafluxo.PARAMS["limite"]["WDO"]]
                         + [v for v in grade if v != caio_contrafluxo.PARAMS["limite"]["WDO"]])
        self.assertIn(params["limite"], grade)


class TestSalas(unittest.TestCase):
    def test_caio_so_no_wdo_e_no_win(self):
        self.assertEqual(traders.TODOS, [sofia_smc, didi_agulhada, caio_contrafluxo])
        self.assertEqual(traders.SALAS["WDO"], traders.TODOS)
        self.assertEqual(traders.SALAS["WIN"], traders.TODOS)
        self.assertEqual(traders.SALAS["EURUSD"], [sofia_smc, didi_agulhada])
        self.assertEqual(traders.SALAS["BTCUSDT"], [sofia_smc, didi_agulhada])


if __name__ == "__main__":
    unittest.main()

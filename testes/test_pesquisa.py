import csv
import json
import os
import tempfile
import unittest
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from unittest import mock

import dados
import motor
from pesquisa import harness
from testes.test_dados import Mt5Falso
from testes.robos_teste import ALFA
from testes.test_motor import CFG, COMPRA, T, vela
from tipos import Candle


def dias_uteis(de, n_dias, por_dia=12):
    """Candles de 5 min das 10:00 em `n_dias` dias úteis a partir de `de`, sobe e desce para o robô operar."""
    out, d = [], de
    while n_dias:
        if d.weekday() < 5:
            for k in range(por_dia):
                p = 5430.0 + (k % 4) * 2.0 - (d.day % 3)
                out.append(Candle(datetime(d.year, d.month, d.day, 10) + timedelta(minutes=5 * k), p, p + 3, p - 3, p + 1))
            n_dias -= 1
        d += timedelta(days=1)
    return out


class Mt5H1(Mt5Falso):
    TIMEFRAME_H1 = 16385

    def copy_rates_range(self, simbolo, tf, de, ate):
        self.pedidos = getattr(self, "pedidos", []) + [(tf, de.date(), ate.date())]
        return super().copy_rates_range(simbolo, tf, de, ate)


class TestHistoricoNovo(unittest.TestCase):
    def test_acao_no_60_vai_para_o_cache_h1_em_blocos_de_180_dias(self):
        cfg = {"ativos": {"PETR4": {"fonte": "mt5", "simbolo": "PETR4", "tf": 60, "sessao": {"dias": [0, 1, 2, 3, 4]}}}}
        mt5 = Mt5H1(simbolos=("PETR4",))
        with tempfile.TemporaryDirectory() as d:
            cs = dados.historico("PETR4", date(2024, 1, 2), date(2024, 12, 31), cfg, pasta=d, mt5=mt5,
                                 hoje=date(2026, 10, 26))
            self.assertTrue(os.path.exists(os.path.join(d, "PETR4_H1.csv")))
            self.assertFalse(os.path.exists(os.path.join(d, "PETR4_M5.csv")))
        self.assertEqual({tf for tf, _, _ in mt5.pedidos}, {16385})
        self.assertEqual([(a, b) for _, a, b in mt5.pedidos],
                         [(date(2024, 1, 2), date(2024, 6, 29)), (date(2024, 6, 30), date(2024, 12, 26)),
                          (date(2024, 12, 27), date(2024, 12, 31))])
        self.assertEqual(len({k.t.date() for k in cs}), 261)  # dias úteis de 2024 a partir de 02/01 (sem dia perdido entre blocos)


class TestEstresse(unittest.TestCase):
    def test_um_tick_pior_na_entrada_e_na_saida(self):
        def stopada(estresse):
            c = motor.Conta("Teste", "WDO", CFG, estresse_ticks=estresse)
            c.colocar([COMPRA], T, "WDO$")
            c.executar_candle(vela(1, 5432, 5433, 5429.5, 5431), False)
            c.executar_candle(vela(2, 5428, 5429, 5425, 5427), False)
            return c.operacoes[-1]
        normal, estresse = stopada(0), stopada(1)
        self.assertEqual(normal["resultado_rs"], -92.0)  # 4,5 pts x R$ 10 x 2 + R$ 2 de custo
        # 2 ticks de 0,5 (entrada e saída) x R$ 10 x 2 contratos = R$ 20 a mais de perda; preços iguais
        self.assertEqual(estresse["resultado_rs"], -112.0)
        self.assertEqual((estresse["entrada"], estresse["saida"]), (normal["entrada"], normal["saida"]))

    def test_backtest_com_estresse_tira_2_ticks_de_cada_operacao(self):
        cs = dias_uteis(date(2026, 9, 1), 5)
        sem = motor.rodar_backtest("WDO", cs, [ALFA], CFG)["traders"][ALFA.NOME]["operacoes"]
        com = motor.rodar_backtest("WDO", cs, [ALFA], CFG, estresse_ticks=1)["traders"][ALFA.NOME]["operacoes"]
        self.assertTrue(sem)
        self.assertEqual(len(sem), len(com))
        for a, b in zip(sem, com):
            self.assertAlmostEqual(a["resultado_rs"] - b["resultado_rs"], 2 * 0.5 * 10 * a["contratos"])


class TestGuardaDaValidacao(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.TemporaryDirectory()
        cs = dias_uteis(date(2026, 7, 1), 70)
        divisao = {"WDO": {"desenvolvimento": ["2026-07-01", "2026-08-31"], "validacao": ["2026-09-01", "2026-09-30"],
                           "tf": [5]}}
        for alvo, valor in (("PASTA", self.pasta.name), ("DIVISAO", divisao), ("_serie", lambda a, tf: cs),
                            ("config", lambda: CFG)):
            p = mock.patch.object(harness, alvo, valor)
            p.start()
            self.addCleanup(p.stop)

    def tearDown(self):
        self.pasta.cleanup()

    def test_desenvolvimento_roda(self):
        r = harness.avaliar(ALFA, None, "WDO", "2026-07-01", "2026-08-31")
        self.assertGreater(r["trades"], 0)
        self.assertTrue(all("2026-07-01" <= o["entrada_t"][:10] <= "2026-08-31" for o in r["operacoes"]))
        for chave in ("resultado", "acerto", "fator_lucro", "payoff", "drawdown", "pior_dia", "seq_perdas", "por_mes"):
            self.assertIn(chave, r)

    def test_encostar_na_validacao_e_recusado(self):
        for de, ate in (("2026-08-20", "2026-09-01"), ("2026-09-10", "2026-09-12"), ("2026-07-01", "2026-12-31")):
            with self.assertRaises(harness.EspiadaNaValidacao):
                harness.avaliar(ALFA, None, "WDO", de, ate)
        self.assertFalse(os.path.exists(os.path.join(self.pasta.name, "validacao.csv")))

    def test_validacao_explicita_fica_registrada_e_aceita_3_finalistas(self):
        for x in (1.5, 2.0, 2.5, 2.0):  # repetir um finalista não conta como novo
            harness.avaliar(ALFA, {"alvo_x": x}, "WDO", "2026-09-01", "2026-09-30", validacao=True)
        with self.assertRaises(harness.EspiadaNaValidacao):
            harness.avaliar(ALFA, {"alvo_x": 3.0}, "WDO", "2026-09-01", "2026-09-30", validacao=True)
        with open(os.path.join(self.pasta.name, "validacao.csv"), encoding="utf-8") as f:
            linhas = list(csv.DictReader(f))
        self.assertEqual([json.loads(l["parametros"])["alvo_x"] for l in linhas], [1.5, 2.0, 2.5, 2.0])
        self.assertEqual({l["trader"] for l in linhas}, {ALFA.NOME})

    def test_contrato_do_trader(self):
        with self.assertRaises(TypeError):
            harness.avaliar(SimpleNamespace(NOME="x", PARAMS={}), None, "WDO", "2026-07-01", "2026-07-31")
        sem_estilo = SimpleNamespace(NOME=ALFA.NOME, PARAMS=ALFA.PARAMS, GRADE=ALFA.GRADE, Trader=ALFA.Trader)
        self.assertGreater(harness.avaliar(sem_estilo, None, "WDO", "2026-07-01", "2026-08-31")["trades"], 0)


class TestDivisao(unittest.TestCase):
    def test_caio_tem_divisao_propria(self):
        self.assertEqual(harness.divisao("WDO")["validacao"][0], date(2026, 5, 1))
        caio = harness.divisao("WDO", "Caio Contrafluxo")
        self.assertEqual(caio["desenvolvimento"], (date(2026, 6, 29), date(2026, 9, 15)))
        self.assertEqual(caio["validacao"][0], date(2026, 9, 16))
        self.assertEqual(harness.divisao("WIN", "Caio Contrafluxo")["desenvolvimento"][0], date(2026, 8, 12))


class TestWalkForward(unittest.TestCase):
    def test_blocos_de_3_meses(self):
        self.assertEqual(harness.blocos("2024-01-02", "2024-12-31"),
                         [(date(2024, 1, 2), date(2024, 3, 31)), (date(2024, 4, 1), date(2024, 6, 30)),
                          (date(2024, 7, 1), date(2024, 9, 30)), (date(2024, 10, 1), date(2024, 12, 31))])
        self.assertEqual(harness.blocos("2025-06-23", "2026-04-30"),
                         [(date(2025, 6, 23), date(2025, 8, 31)), (date(2025, 9, 1), date(2025, 11, 30)),
                          (date(2025, 12, 1), date(2026, 2, 28)), (date(2026, 3, 1), date(2026, 4, 30))])

    def test_escolhe_nos_blocos_anteriores_e_testa_no_seguinte(self):
        # resultados por candidato (x) e bloco; cada lista são as operações do bloco
        tabela = {1: [[10, -1], [10, -1], [-5, 1], [-5, 1]], 2: [[-5, 1], [30, -1], [30, -1], [30, -1]]}
        bs = harness.blocos("2024-01-02", "2024-12-31")

        def falso(m, params, ativo, de, ate, estresse, tf):
            k = [i for i, _ in bs].index(de)
            return {"operacoes": [{"entrada_t": f"{de}T10:00:00", "resultado_rs": v} for v in tabela[params["x"]][k]]}

        modulo = SimpleNamespace(NOME="Falso", PARAMS={"x": 1, "y": "a"}, GRADE={})
        with mock.patch.object(harness, "avaliar", falso):
            wf = harness.walk_forward(modulo, {"x": [1, 2]}, "WDO", "2024-01-02", "2024-12-31", min_trades=1)
        self.assertEqual(wf["candidatos"], 2)
        # treino só no bloco 0 -> x=1 (PF 10); blocos 0-1 -> x=1 (PF 10 contra 5,2); blocos 0-2 -> x=2 (8,7 contra 3)
        self.assertEqual([b["params"]["x"] for b in wf["blocos"]], [1, 1, 2])
        self.assertEqual([b["teste"][0] for b in wf["blocos"]], ["2024-04-01", "2024-07-01", "2024-10-01"])
        self.assertEqual(wf["fora_da_amostra"]["resultado"], 10 - 1 - 5 + 1 + 30 - 1)
        self.assertEqual(wf["fora_da_amostra"]["trades"], 6)

    def test_candidatos_resolvem_valor_por_ativo(self):
        m = SimpleNamespace(PARAMS={"limite": {"WDO": 7500, "WIN": 10000}, "n": 2})
        self.assertEqual(harness.candidatos(m, {"limite": {"WDO": [5000, 7500]}}, "WDO"),
                         [{"limite": 5000, "n": 2}, {"limite": 7500, "n": 2}])


class TestRegistro(unittest.TestCase):
    def test_registrar_acrescenta_linhas(self):
        r = {"params": {"a": 1}, "ativo": "WDO", "tf": 5, "de": "2024-01-02", "ate": "2024-03-31", "trades": 120,
             "resultado": 50.0, "fator_lucro": 1.1, "drawdown": -30.0}
        lin = harness.linha("v1", r, {**r, "resultado": -5.0})
        self.assertEqual(lin["veredito"], "negativa")  # positiva sem estresse, negativa com: não conta
        with tempfile.TemporaryDirectory() as pasta, mock.patch.object(harness, "PASTA", pasta):
            harness.registrar("sofia", lin)
            harness.registrar("sofia", {**lin, "variante": "v2"})
            with open(os.path.join(pasta, "sofia", "registro.csv"), encoding="utf-8") as f:
                linhas = list(csv.DictReader(f))
            with self.assertRaises(ValueError):
                harness.registrar("sofia", {**lin, "coluna_errada": 1})
        self.assertEqual([l["variante"] for l in linhas], ["v1", "v2"])

    def test_veredito(self):
        r = {"trades": 99, "resultado": 10.0}
        self.assertEqual(harness.veredito(r, r), "inconclusivo")
        self.assertEqual(harness.veredito({**r, "trades": 100}, r), "positiva")
        self.assertEqual(harness.veredito({**r, "trades": 30}, r, validacao=True), "positiva")


if __name__ == "__main__":
    unittest.main()

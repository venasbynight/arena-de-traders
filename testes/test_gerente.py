import json
import os
import shutil
import tempfile
import unittest
from datetime import timedelta
from types import SimpleNamespace
from unittest import mock

import dados
import gerente
import motor
import relatorio
from testes.test_motor import CFG, dias_sinteticos
from tipos import Candle
from traders import TODOS, rafa_rompimento, vera_vwap


def escalar(candles, fator, casas):
    """Os dias sintéticos de WDO no nível de preço de outro ativo (o passo de 0,5 vira múltiplo do tick)."""
    return [Candle(k.t, round(k.o * fator, casas), round(k.h * fator, casas), round(k.l * fator, casas),
                   round(k.c * fator, casas)) for k in candles]


DIAS = dias_sinteticos(60)
SINTETICOS = {"EURUSD": escalar(DIAS, 0.0002, 5), "BTCUSDT": escalar(DIAS, 12, 2)}
HOJE = DIAS[-1].t.date() + timedelta(days=1)
DATAS = sorted({k.t.date() for k in DIAS})
# Sofia fica de fora só pelo tempo da suíte (o backtest dela já é coberto em test_motor e test_sofia)
SALAS = {"WDO": TODOS, "WIN": TODOS, "EURUSD": [rafa_rompimento, vera_vwap], "BTCUSDT": [rafa_rompimento]}


class HistoricoFalso:
    """WDO/WIN como a Genial hoje (ErroDados); EURUSD e BTCUSDT com 60 dias sintéticos."""

    def __init__(self):
        self.chamadas = []

    def __call__(self, ativo, de, ate, cfg):
        self.chamadas.append(ativo)
        if ativo in ("WDO", "WIN"):
            raise dados.ErroDados(f"o MT5 (Genial) não respondeu em 90 s ({ativo}$)")
        return [k for k in SINTETICOS[ativo] if de <= k.t.date() <= ate]


def placar(resultado, trades, fator, drawdown=-100.0):
    return {"resultado": resultado, "trades": trades, "acerto": 0.5, "fator_lucro": fator, "drawdown": drawdown,
            "pior_dia": drawdown, "confianca": "média"}


def curva(*saldos):
    return [[f"2026-10-{i + 1:02d}T23:55:00", s] for i, s in enumerate(saldos)]


SOBE = curva(5000, 5100, 5200, 5150, 5300)
DIAS_SALA = (62, 21)  # pregões de treino e de prova


class TestCiclo(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raiz = tempfile.mkdtemp()
        cls.historico = HistoricoFalso()
        cls.estado = gerente.ciclo(CFG, HOJE, historico_fn=cls.historico, salas=SALAS, raiz=cls.raiz)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.raiz)

    def test_divide_treino_e_prova_em_21_pregoes(self):
        sala = self.estado["salas"]["EURUSD"]
        self.assertEqual(sala["status"], "ok")
        self.assertEqual(sala["periodos"]["treino"], {"de": DATAS[0].isoformat(), "ate": DATAS[38].isoformat(),
                                                      "pregoes": 39})
        self.assertEqual(sala["periodos"]["prova"], {"de": DATAS[39].isoformat(), "ate": DATAS[-1].isoformat(),
                                                     "pregoes": 21})
        for t in sala["traders"]:
            self.assertEqual(len(t["equity"]), 22, t["nome"])  # ponto inicial + um por pregão da prova
            self.assertEqual(t["equity"][0], [f"{DATAS[39].isoformat()}T09:00:00", 5000.0])
            self.assertLessEqual(len(t["diario"]), 8)

        curto = [k for k in SINTETICOS["EURUSD"] if k.t.date() <= DATAS[29]]  # 30 pregões: prova = último terço
        treino, prova, aviso = gerente.dividir(curto)
        self.assertEqual(len({k.t.date() for k in prova}), 10)
        self.assertEqual(len({k.t.date() for k in treino}), 20)
        self.assertIn("último terço", aviso)
        self.assertEqual(gerente.dividir(SINTETICOS["EURUSD"])[2], "")

    def test_sala_sem_dados_vira_pendencia(self):
        for ativo in ("WDO", "WIN"):
            sala = self.estado["salas"][ativo]
            self.assertEqual((sala["status"], sala["traders"]), ("sem_dados", []))
            self.assertIn("não respondeu", sala["motivo"])
            self.assertIn(f"{ativo}: o MT5 (Genial) não respondeu em 90 s ({ativo}$)", self.estado["pendencias"])
            self.assertEqual(self.historico.chamadas.count(ativo), 1)  # uma tentativa por ciclo, sem repetir
        self.assertEqual(list(self.estado["salas"]), ["WDO", "WIN", "EURUSD", "BTCUSDT"])
        self.assertEqual(self.estado["salas"]["BTCUSDT"]["status"], "ok")
        nomes = [(r["sala"], r["nome"]) for r in self.estado["ranking"]]
        self.assertEqual(sorted(nomes), [("BTCUSDT", "Rafa Rompimento"), ("EURUSD", "Rafa Rompimento"),
                                         ("EURUSD", "Vera VWAP")])
        resultados = [r["prova_resultado"] for r in self.estado["ranking"]]
        self.assertEqual(resultados, sorted(resultados, reverse=True))

    def test_escreve_estado_e_relatorios(self):
        with open(os.path.join(self.raiz, "estado", "firma.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f), self.estado)
        with open(os.path.join(self.raiz, "estado", "parametros.json"), encoding="utf-8") as f:
            parametros = json.load(f)
        self.assertEqual(sorted(parametros), ["BTCUSDT", "EURUSD"])
        self.assertEqual(sorted(parametros["EURUSD"]), ["Rafa Rompimento", "Vera VWAP"])
        self.assertIn(parametros["EURUSD"]["Vera VWAP"]["desvios"], vera_vwap.GRADE["desvios"])
        self.assertEqual(sorted(os.listdir(os.path.join(self.raiz, "estado"))), ["firma.json", "parametros.json"])

        pasta = os.path.join(self.raiz, "relatorios", HOJE.isoformat())
        feitos = ["briefing.md", "btcusdt-rafa-rompimento.html", "eurusd-rafa-rompimento.html",
                  "eurusd-vera-vwap.html", "gerente.html"]
        self.assertEqual(sorted(os.listdir(pasta)), sorted(feitos + ["index.json"]))  # nenhum .tmp sobrando
        with open(os.path.join(pasta, "index.json"), encoding="utf-8") as f:
            self.assertEqual(sorted(json.load(f)["arquivos"]), feitos)
        with open(os.path.join(pasta, "briefing.md"), encoding="utf-8") as f:
            briefing = f.read().splitlines()
        self.assertLessEqual(len(briefing), 60)
        self.assertTrue(any("WDO" in l and "não respondeu" in l for l in briefing))
        with open(os.path.join(pasta, "eurusd-vera-vwap.html"), encoding="utf-8") as f:
            html = f.read()
        self.assertIn("lightweight-charts", html)
        self.assertIn("/web/estilo.css", html)
        with open(os.path.join(pasta, "gerente.html"), encoding="utf-8") as f:
            self.assertNotIn("<script", f.read())  # vai num iframe sem allow-scripts
        # pendências logo depois do resumo, antes do detalhe das salas
        self.assertLess(briefing.index("## Pendências"), briefing.index(next(l for l in briefing if l.startswith("## WDO"))))


class TestSemOperacoes(unittest.TestCase):
    def test_trader_sem_operacoes_vira_pendencia(self):
        cfg = {**CFG, "max_perda_por_trade": 1}  # nem 1 contrato cabe: toda ordem é recusada
        with tempfile.TemporaryDirectory() as raiz:
            estado = gerente.ciclo(cfg, HOJE, historico_fn=HistoricoFalso(), salas={"EURUSD": [rafa_rompimento]},
                                   raiz=raiz)
        t = estado["salas"]["EURUSD"]["traders"][0]
        self.assertEqual((t["treino"]["trades"], t["prova"]["trades"]), (0, 0))
        pend = [p for p in estado["pendencias"] if p.startswith("EURUSD · Rafa Rompimento: nenhuma operação")]
        self.assertEqual(len(pend), 1, estado["pendencias"])
        self.assertIn("(ordens recusadas: nem 1 contrato cabe (limite: perda máxima por trade)", pend[0])


class TestDecisoes(unittest.TestCase):
    def test_grade_escolhe_melhor_fator_lucro(self):
        modulo = SimpleNamespace(NOME="Teste", PARAMS={"x": 1, "y": 9}, GRADE={"x": [1, 2, 3]})
        placares = {1: (80, 1.1), 2: (60, 1.6), 3: (20, 3.0)}  # x=3 tem o melhor fator, mas só 20 trades
        vistos = []

        def rodar(ativo, candles, m, params, cfg):
            vistos.append(params)
            trades, fator = placares[params["x"]]
            return {"placar": placar(100.0, trades, fator)}

        with mock.patch.object(gerente, "_rodar", rodar):
            params, treino = gerente.ajustar(modulo, "EURUSD", [], CFG)
        self.assertEqual(params, {"x": 2})
        self.assertEqual(treino["placar"]["fator_lucro"], 1.6)
        self.assertEqual(vistos, [{"x": 1}, {"x": 2}, {"x": 3}])  # o padrão (x=1) só roda uma vez

        placares.update({1: (10, 1.1), 2: (49, 1.6)})  # ninguém com 50 trades: fica no padrão
        with mock.patch.object(gerente, "_rodar", rodar):
            params, treino = gerente.ajustar(modulo, "EURUSD", [], CFG)
        self.assertEqual((params, treino["placar"]["trades"]), ({"x": 1}, 10))

    def test_nao_promove_com_menos_de_50_trades(self):
        status, _, decisao = gerente.decidir(placar(3000.0, 40, 2.0), placar(2000.0, 60, 1.8), SOBE, *DIAS_SALA)
        self.assertEqual(status, "experiencia")
        self.assertIn("40 trades no treino", decisao)
        status, _, decisao = gerente.decidir(placar(3000.0, 200, 2.0), placar(2000.0, 38, 1.8), SOBE, *DIAS_SALA)
        self.assertEqual(status, "experiencia")
        self.assertIn("38 trades na prova", decisao)
        status, overfit, decisao = gerente.decidir(placar(3000.0, 200, 2.0), placar(2000.0, 60, 1.8), SOBE, *DIAS_SALA)
        self.assertEqual((status, overfit), ("promovido", False))
        self.assertIn("60 trades", decisao)

    def test_nao_promove_com_treino_negativo(self):
        # prova boa depois de um treino perdedor é sorte até provar o contrário (caso real: Sofia no WIN)
        status, overfit, decisao = gerente.decidir(placar(-3672.0, 169, 0.8), placar(1971.0, 50, 1.81), SOBE,
                                                   *DIAS_SALA)
        self.assertEqual((status, overfit), ("experiencia", False))
        self.assertIn("treino negativo (−R$ 3.672)", decisao)
        self.assertEqual(gerente.decidir(placar(0.0, 169, 1.0), placar(1971.0, 50, 1.81), SOBE, *DIAS_SALA)[0],
                         "experiencia")

    def test_marca_overfit(self):
        # o overfit compara o ganho por pregão: treino de 62 pregões, prova de 21
        treino = placar(3100.0, 200, 2.0)  # R$ 50 por pregão
        status, overfit, _ = gerente.decidir(treino, placar(1050.0, 60, 1.5), SOBE, 62, 21)  # R$ 50/pregão também
        self.assertEqual((status, overfit), ("promovido", False))  # pelo total (1.050 < 50% de 3.100) seria overfit
        status, overfit, decisao = gerente.decidir(treino, placar(350.0, 60, 1.5), SOBE, 62, 21)  # ~R$ 16,67: 1/3
        self.assertEqual((status, overfit), ("experiencia", True))
        self.assertIn("overfit: prova rende R$ 16,67 por pregão, menos de 50% dos R$ 50,00 do treino", decisao)
        self.assertFalse(gerente.decidir(treino, placar(525.0, 60, 1.5), SOBE, 62, 21)[1])  # R$ 25: 50% exato
        self.assertFalse(gerente.decidir(placar(-500.0, 200, 0.8), placar(-800.0, 60, 0.7), SOBE, 62, 21)[1])
        # prova sem nenhum trade: não promove, mas também não é overfit
        status, overfit, decisao = gerente.decidir(treino, placar(0.0, 0, None, 0.0), SOBE, 62, 21)
        self.assertEqual((status, overfit), ("experiencia", False))
        self.assertIn("sem trades na prova", decisao)
        self.assertNotIn("overfit", decisao)

    def test_pausa_por_drawdown(self):
        # pausa vence a promoção: mesmo com prova positiva, fator e trades bons
        status, _, decisao = gerente.decidir(placar(3000.0, 200, 2.0), placar(2000.0, 60, 1.8, -1600.0), SOBE,
                                             *DIAS_SALA)
        self.assertEqual(status, "pausado")
        self.assertIn("1.600", decisao)
        self.assertNotEqual(gerente.decidir(placar(3000.0, 200, 2.0), placar(2000.0, 60, 1.8, -1500.0), SOBE,
                                            *DIAS_SALA)[0], "pausado")
        bom = placar(3000.0, 200, 2.0), placar(1500.0, 60, 1.3)
        cinco = curva(5000, 4975, 4945, 4915, 4885, 4855, 5500)  # o 1º dia perde R$ 25 exatos: conta
        status, _, decisao = gerente.decidir(*bom, cinco, *DIAS_SALA)
        self.assertEqual(status, "pausado")
        self.assertIn("5 dias seguidos negativos na prova (perda de R$ 25 ou mais em cada)", decisao)
        quatro = curva(5000, 4970, 4940, 4910, 4880, 4880, 4850, 5500)  # dia parado quebra a sequência
        self.assertNotEqual(gerente.decidir(*bom, quatro, *DIAS_SALA)[0], "pausado")
        miudos = curva(5000, 4990, 4980, 4970, 4960, 4950, 4940, 4930)  # perdas de R$ 10 não contam
        self.assertNotEqual(gerente.decidir(*bom, miudos, *DIAS_SALA)[0], "pausado")
        quebra = curva(5000, 4970, 4940, 4930, 4900, 4870, 4840)  # um dia de −R$ 10 no meio quebra a sequência
        self.assertNotEqual(gerente.decidir(*bom, quebra, *DIAS_SALA)[0], "pausado")


class TestRobustez(unittest.TestCase):
    """Um trader, uma sala ou o relatório com bug não podem levar o ciclo inteiro junto."""

    def ciclo(self, salas, raiz):
        return gerente.ciclo(CFG, HOJE, historico_fn=HistoricoFalso(), salas=salas, raiz=raiz)

    def test_trader_que_quebra_nao_derruba_o_ciclo(self):
        class Quebra:
            def __init__(self, *a, **k):
                pass

            def decidir(self, *a):
                raise ZeroDivisionError("bug do trader")

        ruim = SimpleNamespace(NOME="Ruim", ESTILO="", PARAMS={}, GRADE={}, Trader=Quebra)
        with tempfile.TemporaryDirectory() as raiz:
            estado = self.ciclo({"EURUSD": [ruim, rafa_rompimento], "BTCUSDT": [rafa_rompimento]}, raiz)
            self.assertTrue(os.path.isfile(os.path.join(raiz, "estado", "firma.json")))
        self.assertIn("EURUSD · Ruim: erro no backtest: ZeroDivisionError: bug do trader", estado["pendencias"])
        self.assertEqual([t["nome"] for t in estado["salas"]["EURUSD"]["traders"]], ["Rafa Rompimento"])
        self.assertEqual(estado["salas"]["BTCUSDT"]["status"], "ok")

    def test_sala_que_quebra_vira_sem_dados(self):
        with tempfile.TemporaryDirectory() as raiz, \
                mock.patch.object(gerente, "dividir", side_effect=ValueError("sala torta")):
            estado = self.ciclo({"EURUSD": [rafa_rompimento]}, raiz)
        sala = estado["salas"]["EURUSD"]
        self.assertEqual((sala["status"], sala["traders"]), ("sem_dados", []))
        self.assertEqual(sala["motivo"], "erro ao processar a sala: ValueError: sala torta")
        self.assertIn("EURUSD: erro ao processar a sala: ValueError: sala torta", estado["pendencias"])

    def test_relatorio_que_quebra_vira_pendencia(self):
        with tempfile.TemporaryDirectory() as raiz:
            with mock.patch.object(relatorio, "escrever", side_effect=RuntimeError("html torto")):
                estado = self.ciclo({"BTCUSDT": [rafa_rompimento]}, raiz)
            with open(os.path.join(raiz, "estado", "firma.json"), encoding="utf-8") as f:
                gravado = json.load(f)
            self.assertTrue(os.path.isfile(os.path.join(raiz, "estado", "parametros.json")))
        self.assertIn("relatórios: erro ao escrever: RuntimeError: html torto", estado["pendencias"])
        self.assertEqual(gravado, estado)  # o estado gravado já traz a pendência


class TestRelatorio(unittest.TestCase):
    def test_relatorio_escapa_texto(self):
        nome = '<img src=x onerror="alert(1)">'
        t = {"nome": nome, "estilo": "<b>estilo</b>", "status": "experiencia", "parametros": {"x": "<i>1</i>"},
             "overfit": False, "treino": placar(10.0, 5, 1.1), "prova": placar(-5.0, 3, 0.9),
             "equity": [["2026-10-01T00:00:00", 5000.0], ["2026-10-01T23:55:00", 4995.0]],
             "diario": ["00:15 <script>alert(1)</script>"], "decisao": "segue <u>assim</u>"}
        estado = {"gerado_em": "2026-10-02T19:30:00", "dia": "2026-10-02", "premissas": {"usd_brl": 5.4},
                  "salas": {"EURUSD": {"status": "ok", "motivo": "<em>x</em>", "traders": [t]},
                            "WDO": {"status": "sem_dados", "motivo": "<script>x</script>", "traders": []}},
                  "ranking": [{"sala": "EURUSD", "nome": nome, "prova_resultado": -5.0}],
                  "pendencias": ["<script>p</script>"]}
        ops = {("EURUSD", nome): [{"entrada_t": "2026-10-01T10:00:00", "saida_t": "2026-10-01T10:30:00",
                                   "lado": "compra", "contratos": 1, "entrada": 1.1, "saida": 1.1,
                                   "resultado_rs": -5.0, "motivo_saida": "stop", "setup": "<s>x</s>"}]}
        with tempfile.TemporaryDirectory() as pasta:
            arquivos = relatorio.escrever(estado, ops, pasta)
            self.assertEqual(sorted(arquivos + ["index.json"]), sorted(os.listdir(pasta)))
            for a in arquivos:
                with open(os.path.join(pasta, a), encoding="utf-8") as f:
                    texto = f.read()
                if a.endswith(".html"):
                    for cru in ("<img", "<b>", "<i>", "<script>alert", "<script>x", "<script>p", "<u>", "<s>", "<em>"):
                        self.assertNotIn(cru, texto, a)
        self.assertEqual(relatorio.slug("Vera VWAP"), "vera-vwap")
        self.assertEqual(relatorio.slug("Caio Contrafluxo · ação"), "caio-contrafluxo-acao")


class TestMotorParaOGerente(unittest.TestCase):
    def test_backtest_aceita_parametros(self):
        cs = [k for k in SINTETICOS["EURUSD"] if k.t.date() <= DATAS[4]]
        alvos = lambda r: [e["alvo"] for e in r["traders"]["Rafa Rompimento"]["eventos"] if e["tipo"] == "ordem"]
        padrao = motor.rodar_backtest("EURUSD", cs, [rafa_rompimento], CFG)
        mesmo = motor.rodar_backtest("EURUSD", cs, [(rafa_rompimento, None)], CFG)
        longe = motor.rodar_backtest("EURUSD", cs, [(rafa_rompimento, {"alvo_x": 2.5})], CFG)
        self.assertTrue(alvos(padrao))
        self.assertEqual(alvos(padrao), alvos(mesmo))
        self.assertNotEqual(alvos(padrao), alvos(longe))

    def test_config_antigo_ganha_o_que_falta(self):
        antigo = {"capital": 7000, "ativos": {
            "WDO": {"margem_por_contrato": 150, "custo_por_contrato": 0.5, "simbolo_mt5": "WDO$"},
            "EURUSD": {"ponto_rs": 5400, "tick": 0.00001, "margem_por_contrato": 200, "custo_por_contrato": 0.07}}}
        with tempfile.TemporaryDirectory() as pasta:
            caminho = os.path.join(pasta, "config.json")
            with open(caminho, "w", encoding="utf-8") as f:
                json.dump(antigo, f)
            cfg = motor.carregar_config(caminho)
            with open(caminho, encoding="utf-8") as f:
                self.assertEqual(json.load(f), cfg)  # gravado no disco
            self.assertEqual(motor.carregar_config(caminho), cfg)  # segunda leitura não muda nada
        self.assertEqual((cfg["capital"], cfg["usd_brl"]), (7000, 5.4))
        self.assertEqual(sorted(cfg["ativos"]), ["BTCUSDT", "EURUSD", "WDO", "WIN"])
        with open(motor.EXEMPLO_CONFIG, encoding="utf-8") as f:
            exemplo = json.load(f)["ativos"]
        wdo = cfg["ativos"]["WDO"]  # o antigo ganha terminal, sessao etc. do modelo e guarda margem e custo
        self.assertEqual(wdo, {**exemplo["WDO"], "margem_por_contrato": 150, "custo_por_contrato": 0.5})
        self.assertEqual((wdo["terminal"], wdo["sessao"]), (exemplo["WDO"]["terminal"], exemplo["WDO"]["sessao"]))
        self.assertNotIn("simbolo_mt5", wdo)
        self.assertEqual(cfg["ativos"]["EURUSD"], {**exemplo["EURUSD"], "custo_por_contrato": 0.07})  # do usuário fica
        self.assertEqual(cfg["ativos"]["BTCUSDT"]["fonte"], "binance")


if __name__ == "__main__":
    unittest.main()

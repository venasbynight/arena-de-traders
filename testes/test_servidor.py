import json
import os
import tempfile
import threading
import unittest
from datetime import date, datetime
import urllib.error
import urllib.request
from unittest import mock

import motor
import servidor
from testes.robos_teste import BETA
from testes.test_motor import CFG, dias_sinteticos

UM_DIA = dias_sinteticos(1)


def historico_falso(ativo, de, ate, cfg):
    return [k for k in UM_DIA if de <= k.t.date() <= ate]


class TestServidor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pasta = tempfile.TemporaryDirectory()
        # sem os parâmetros reais do gerente (estado/parametros.json) mudando o backtest dos testes
        cls.sem_params = mock.patch.object(servidor, "PARAMETROS", os.path.join(cls.pasta.name, "parametros.json"))
        cls.sem_params.start()
        cls.srv = servidor.criar_servidor(0, historico_fn=historico_falso, cfg=CFG)
        cls.url = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        cls.sem_params.stop()
        cls.pasta.cleanup()

    def get(self, caminho):
        try:
            with urllib.request.urlopen(self.url + caminho) as r:
                return r.status, r.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8")

    def test_backtest_ok(self):
        status, corpo = self.get("/api/backtest?ativo=WDO&de=2026-09-01&ate=2026-09-01")
        self.assertEqual(status, 200)
        self.assertIn("Sofia SMC", json.loads(corpo)["traders"])

    def test_backtest_aplica_parametros_do_gerente(self):
        esperado = motor.rodar_backtest("WDO", UM_DIA, [(BETA, {"multiplo": 2.0})], CFG)
        ordens = lambda r: [[e["entrada"], e["alvo"]] for e in r["traders"]["Robô Beta"]["eventos"] if e["tipo"] == "ordem"]
        url = "/api/backtest?ativo=WDO&de=2026-09-01&ate=2026-09-01"
        with mock.patch.object(servidor.traders, "TODOS", [BETA]):  # robô de teste no lugar dos traders reais
            padrao = json.loads(self.get(url)[1])
            with open(servidor.PARAMETROS, "w", encoding="utf-8") as f:
                json.dump({"WDO": {"Robô Beta": {"multiplo": 2.0}}}, f)
            try:
                ajustado = json.loads(self.get(url)[1])
            finally:
                os.remove(servidor.PARAMETROS)
        self.assertTrue(ordens(esperado))
        self.assertEqual(ordens(ajustado), ordens(esperado))
        self.assertNotEqual(ordens(ajustado), ordens(padrao))

    def test_backtest_de_qualquer_ativo_do_config(self):
        for ativo in ("EURUSD", "BTCUSDT"):
            status, corpo = self.get(f"/api/backtest?ativo={ativo}&de=2026-09-01&ate=2026-09-01")
            self.assertEqual(status, 200, corpo)
            self.assertEqual(json.loads(corpo)["ativo"], ativo)
        status, corpo = self.get("/api/backtest?ativo=PETR4&de=2026-09-01&ate=2026-09-01")
        self.assertIn("PETR4", json.loads(corpo)["erro"])

    def test_periodo_sem_pregao(self):
        status, corpo = self.get("/api/backtest?ativo=WDO&de=2026-09-05&ate=2026-09-06")
        self.assertEqual(status, 400)
        self.assertIn("sem candles", json.loads(corpo)["erro"])

    def test_ativo_invalido(self):
        status, _ = self.get("/api/backtest?ativo=PETR4&de=2026-09-01&ate=2026-09-01")
        self.assertEqual(status, 400)

    def test_datas_invertidas(self):
        status, corpo = self.get("/api/backtest?ativo=WDO&de=2026-09-02&ate=2026-09-01")
        self.assertEqual(status, 400)

    def test_traders(self):
        status, corpo = self.get("/api/traders")
        self.assertEqual(json.loads(corpo)[0]["nome"], "Sofia SMC")

    def test_index(self):
        status, corpo = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn("<html", corpo)

    def test_erro_inesperado_vira_json(self):
        def quebra(ativo, de, ate, cfg):
            raise ValueError("CSV corrompido")
        srv = servidor.criar_servidor(0, historico_fn=quebra, cfg=CFG)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            url = f"http://127.0.0.1:{srv.server_address[1]}/api/backtest?ativo=WDO&de=2026-09-01&ate=2026-09-01"
            with self.assertRaises(urllib.error.HTTPError) as e:
                urllib.request.urlopen(url)
            self.assertEqual(e.exception.code, 500)
            self.assertIn("CSV corrompido", json.loads(e.exception.read().decode("utf-8"))["erro"])
        finally:
            srv.shutdown()
            srv.server_close()

    def test_firma_exemplo(self):
        with tempfile.TemporaryDirectory() as rel:
            os.makedirs(os.path.join(rel, "2026-10-25"))  # relatórios reais não se misturam com o exemplo
            with mock.patch.multiple(servidor, ESTADO_FIRMA="nao-existe/firma.json", RELATORIOS=rel):
                status, corpo = self.get("/api/firma")
        self.assertEqual(status, 200)
        estado = json.loads(corpo)
        self.assertTrue(estado["exemplo"])
        self.assertNotIn("relatorios", estado)
        salas = estado["salas"]
        self.assertEqual(sorted(salas), ["BTCUSDT", "EURUSD", "OPCOES", "WDO", "WIN"])
        self.assertEqual(salas["OPCOES"]["status"], "sem_tarefa")
        self.assertEqual(len(salas["OPCOES"]["pendencias"]), 5)
        self.assertEqual(len(salas["OPCOES"]["traders"]), 1)
        for ativo in ("WDO", "WIN"):
            self.assertEqual(salas[ativo]["status"], "sem_dados")
        for ativo in ("EURUSD", "BTCUSDT"):
            self.assertEqual(salas[ativo]["status"], "ok")
            self.assertEqual(len(salas[ativo]["traders"]), 1)
            for t in salas[ativo]["traders"]:
                self.assertEqual(len(t["requisitos"]), 8, t["nome"])
                self.assertEqual([set(r) for r in t["requisitos"]], [{"item", "ok", "valor"}] * 8, t["nome"])
                self.assertEqual(len(t["equity"]), 21, t["nome"])
                self.assertEqual(len(t["diario"]), 4, t["nome"])

    def _get_firma_com_estado(self, conteudo):
        with tempfile.TemporaryDirectory() as pasta:
            caminho = os.path.join(pasta, "firma.json")
            with open(caminho, "w", encoding="utf-8") as f:
                f.write(conteudo)
            with mock.patch.multiple(servidor, ESTADO_FIRMA=caminho, RELATORIOS=os.path.join(pasta, "nao-existe")):
                return self.get("/api/firma")

    def test_firma_estado_do_gerente_sem_mexer(self):
        estado = {"gerado_em": "2026-10-24T19:30:00", "salas": {"WDO": {"status": "sem_dados", "motivo": "x", "traders": []}},
                  "ranking": [], "pendencias": ["Genial sem dados"]}
        status, corpo = self._get_firma_com_estado(json.dumps(estado))
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(corpo), estado)  # servido como está, sem a chave "exemplo"

    def test_firma_estado_corrompido_vira_500(self):
        status, corpo = self._get_firma_com_estado('{"gerado_em": "2026-10-24T19:3')  # gravação pela metade
        self.assertEqual(status, 500)
        self.assertIn("firma.json", json.loads(corpo)["erro"])

    def test_api_firma(self):
        estado = {"gerado_em": "2026-10-25T19:30:00", "dia": "2026-10-25", "salas": {}, "ranking": [], "pendencias": []}
        with tempfile.TemporaryDirectory() as raiz:
            caminho = os.path.join(raiz, "estado", "firma.json")
            os.makedirs(os.path.dirname(caminho))
            with open(caminho, "w", encoding="utf-8") as f:
                json.dump(estado, f)
            rel = os.path.join(raiz, "relatorios")
            for dia, arquivos in (("2026-10-24", ["gerente.html"]),
                                  ("2026-10-25", ["gerente.html", "eurusd-sofia-smc.html", "velho.html"])):
                os.makedirs(os.path.join(rel, dia))
                for a in arquivos:
                    with open(os.path.join(rel, dia, a), "w", encoding="utf-8") as f:
                        f.write(f"<html>{dia} {a}</html>")
            os.makedirs(os.path.join(rel, "rascunho"))  # pasta que não é data fica de fora
            indice = os.path.join(rel, "2026-10-25", "index.json")  # velho.html sobrou de um ciclo anterior do dia
            with open(indice, "w", encoding="utf-8") as f:
                json.dump({"dia": "2026-10-25", "arquivos": ["eurusd-sofia-smc.html", "gerente.html"]}, f)
            with mock.patch.multiple(servidor, ESTADO_FIRMA=caminho, RELATORIOS=rel):
                status, corpo = self.get("/api/firma")
                self.assertEqual(status, 200)
                self.assertEqual(json.loads(corpo), {**estado, "relatorios": {
                    "dia": "2026-10-25", "arquivos": ["eurusd-sofia-smc.html", "gerente.html"]}})
                status, corpo = self.get("/relatorios/2026-10-25/gerente.html")
                self.assertEqual((status, corpo), (200, "<html>2026-10-25 gerente.html</html>"))
                for dia, esperado in (("2026-10-24", "2026-10-24"), ("2026-10-20", "2026-10-25")):
                    with open(caminho, "w", encoding="utf-8") as f:  # a pasta do dia do estado; sem ela, a mais nova
                        json.dump({**estado, "dia": dia}, f)
                    self.assertEqual(json.loads(self.get("/api/firma")[1])["relatorios"]["dia"], esperado, dia)
                with open(caminho, "w", encoding="utf-8") as f:
                    json.dump(estado, f)
                os.remove(indice)  # pasta sem index.json (de antes dele): vale a listagem da pasta
                self.assertEqual(json.loads(self.get("/api/firma")[1])["relatorios"]["arquivos"],
                                 ["eurusd-sofia-smc.html", "gerente.html", "velho.html"])
                for fora in ("/relatorios/..%2Festado%2Ffirma.json", "/relatorios/2026-10-25/..%2F..%2Festado%2Ffirma.json",
                             "/relatorios/2026-10-25/nao-existe.html", "/relatorios/2026-10-25"):
                    self.assertEqual(self.get(fora)[0], 404, fora)
            nada = os.path.join(raiz, "nao-existe.json")
            with mock.patch.multiple(servidor, ESTADO_FIRMA=nada, EXEMPLO_FIRMA=nada, RELATORIOS=rel):
                status, corpo = self.get("/api/firma")
            self.assertEqual(status, 404)
            self.assertEqual(json.loads(corpo), {"erro": "o gerente ainda não rodou; execute python gerente.py"})

    def test_ciclo_no_arranque_so_sem_estado_de_hoje(self):
        hoje = date(2026, 10, 25)
        with tempfile.TemporaryDirectory() as pasta:
            caminho = os.path.join(pasta, "firma.json")
            self.assertTrue(servidor.precisa_ciclo(caminho, hoje))
            for dia, precisa in (("2026-10-24", True), ("2026-10-25", False), ("2026-10-26", True)):  # dia diferente, não só anterior
                with open(caminho, "w", encoding="utf-8") as f:
                    json.dump({"dia": dia}, f)
                self.assertEqual(servidor.precisa_ciclo(caminho, hoje), precisa, dia)
            # às 19:30 o ciclo só repete no mesmo dia se alguma sala ficou sem dados
            for status_wdo, repete in (("sem_dados", True), ("ok", False)):
                with open(caminho, "w", encoding="utf-8") as f:
                    json.dump({"dia": "2026-10-25", "salas": {"WDO": {"status": status_wdo}, "EURUSD": {"status": "ok"}}}, f)
                self.assertFalse(servidor.precisa_ciclo(caminho, hoje))
                self.assertEqual(servidor.precisa_ciclo(caminho, hoje, refazer_sem_dados=True), repete, status_wdo)
            with open(caminho, "w", encoding="utf-8") as f:
                f.write("{corrompido")
            self.assertTrue(servidor.precisa_ciclo(caminho, hoje))

    def test_laco_do_gerente_roda_apos_a_meia_noite_e_repesca_as_19h(self):
        brt = motor.size.BRT
        horas = [datetime(2026, 10, 24, 23, 10, tzinfo=brt), datetime(2026, 10, 24, 23, 30, tzinfo=brt),
                 datetime(2026, 10, 25, 0, 30, tzinfo=brt), datetime(2026, 10, 25, 1, 30, tzinfo=brt),
                 datetime(2026, 10, 25, 19, 30, tzinfo=brt), datetime(2026, 10, 25, 20, 30, tzinfo=brt)]
        relogio, sonos, ciclos = iter(horas), [], []

        class Fim(Exception):
            pass

        def dormir(segundos):
            sonos.append(segundos)
            if len(sonos) == len(horas):
                raise Fim

        with tempfile.TemporaryDirectory() as pasta:
            caminho = os.path.join(pasta, "firma.json")

            def gravar(dia, wdo):
                with open(caminho, "w", encoding="utf-8") as f:
                    json.dump({"dia": dia, "salas": {"WDO": {"status": wdo}, "EURUSD": {"status": "ok"}}}, f)

            def rodar(hoje):
                ciclos.append(hoje)
                gravar(hoje.isoformat(), "sem_dados")  # o WDO segue sem dados: só a volta das 19h repesca

            gravar("2026-10-24", "ok")
            with mock.patch.object(servidor, "ESTADO_FIRMA", caminho), self.assertRaises(Fim):
                servidor.laco_do_gerente(rodar, lambda: next(relogio), dormir)
        self.assertEqual(ciclos, [date(2026, 10, 25)] * 2)  # 00:30 (dia novo) e 19:30 (repescagem)
        self.assertEqual(sonos, [1200, 3600, 3600, 3600, 3600, 3600])  # acorda nas meias horas cheias

    def test_ciclo_do_servidor_usa_caminhos_da_raiz(self):
        chamadas = []

        def historico(ativo, de, ate, cfg, **kw):
            chamadas.append(kw)
            return []

        with tempfile.TemporaryDirectory() as raiz, mock.patch.object(servidor.dados, "historico", historico):
            estado = servidor.ciclo_do_servidor(date(2026, 10, 25), raiz)
            self.assertTrue(os.path.isfile(os.path.join(raiz, "trader", "config.json")))
            self.assertTrue(os.path.isfile(os.path.join(raiz, "estado", "firma.json")))
        self.assertEqual(chamadas, [{"pasta": os.path.join(raiz, "dados")}] * 4)
        self.assertEqual({a: s["status"] for a, s in estado["salas"].items()},
                         {"WDO": "sem_dados", "WIN": "sem_dados", "EURUSD": "sem_dados", "BTCUSDT": "sem_dados",
                          "OPCOES": "sem_tarefa"})

    def test_opcoes_sem_tarefa_nao_repete_o_ciclo_das_19h(self):
        hoje = date(2026, 10, 25)
        with tempfile.TemporaryDirectory() as pasta:
            caminho = os.path.join(pasta, "firma.json")
            with open(caminho, "w", encoding="utf-8") as f:
                json.dump({"dia": "2026-10-25", "salas": {"WDO": {"status": "ok"}, "OPCOES": {"status": "sem_tarefa"}}}, f)
            self.assertFalse(servidor.precisa_ciclo(caminho, hoje, refazer_sem_dados=True))

    def test_atividade_ociosa_fora_do_ciclo(self):
        servidor.registrar_atividade(None, None)
        status, corpo = self.get("/api/atividade")
        self.assertEqual(status, 200)
        ativ = json.loads(corpo)
        self.assertEqual(sorted(ativ), ["atualizado", "gerente"])
        self.assertEqual(ativ["gerente"]["estado"], "ocioso")
        self.assertEqual((ativ["gerente"]["sala"], ativ["gerente"]["trader"]), (None, None))
        datetime.fromisoformat(ativ["gerente"]["desde"])
        datetime.fromisoformat(ativ["atualizado"])

    def test_atividade_trabalhando_com_o_callback_do_ciclo(self):
        vistos = []

        def ciclo_falso(cfg, hoje, historico_fn=None, raiz=None, ao_progresso=None):
            ao_progresso("WIN", "Robô Alfa")
            vistos.append(json.loads(self.get("/api/atividade")[1])["gerente"])
            ao_progresso(None, None)
            return {}

        with tempfile.TemporaryDirectory() as raiz, mock.patch.object(servidor.gerente, "ciclo", ciclo_falso):
            servidor.ciclo_do_servidor(date(2026, 10, 25), raiz)
        self.assertEqual({k: vistos[0][k] for k in ("estado", "sala", "trader")},
                         {"estado": "trabalhando", "sala": "WIN", "trader": "Robô Alfa"})
        self.assertEqual(json.loads(self.get("/api/atividade")[1])["gerente"]["estado"], "ocioso")

    def test_atividade_aguenta_leituras_e_escritas_ao_mesmo_tempo(self):
        def escreve():
            for i in range(200):
                servidor.registrar_atividade("WDO", f"t{i}") if i % 2 else servidor.registrar_atividade(None, None)

        t = threading.Thread(target=escreve)
        t.start()
        for _ in range(50):
            g = json.loads(self.get("/api/atividade")[1])["gerente"]
            self.assertEqual(g["estado"] == "trabalhando", g["sala"] is not None)  # nunca um estado pela metade
        t.join()
        servidor.registrar_atividade(None, None)

    def test_firma_html(self):
        status, corpo = self.get("/firma")
        self.assertEqual(status, 200)
        self.assertIn("<html", corpo)

    def test_nao_sai_da_pasta_web(self):
        status, _ = self.get("/web/..%2Fmotor.py")
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()

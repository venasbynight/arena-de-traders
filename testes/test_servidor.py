import json
import os
import tempfile
import threading
import unittest
from datetime import date
import urllib.error
import urllib.request
from unittest import mock

import servidor
from testes.test_motor import CFG, dias_sinteticos

UM_DIA = dias_sinteticos(1)


def historico_falso(ativo, de, ate, cfg):
    return [k for k in UM_DIA if de <= k.t.date() <= ate]


class TestServidor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = servidor.criar_servidor(0, historico_fn=historico_falso, cfg=CFG)
        cls.url = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

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
        with mock.patch.object(servidor, "ESTADO_FIRMA", "nao-existe/firma.json"):
            status, corpo = self.get("/api/firma")
        self.assertEqual(status, 200)
        estado = json.loads(corpo)
        self.assertTrue(estado["exemplo"])
        salas = estado["salas"]
        self.assertEqual(sorted(salas), ["BTCUSDT", "EURUSD", "WDO", "WIN"])
        for ativo in ("WDO", "WIN"):
            self.assertEqual(salas[ativo]["status"], "sem_dados")
        for ativo in ("EURUSD", "BTCUSDT"):
            self.assertEqual(salas[ativo]["status"], "ok")
            self.assertEqual(len(salas[ativo]["traders"]), 3)
            for t in salas[ativo]["traders"]:
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
            for dia, precisa in (("2026-10-24", True), ("2026-10-25", False)):
                with open(caminho, "w", encoding="utf-8") as f:
                    json.dump({"dia": dia}, f)
                self.assertEqual(servidor.precisa_ciclo(caminho, hoje), precisa, dia)
            with open(caminho, "w", encoding="utf-8") as f:
                f.write("{corrompido")
            self.assertTrue(servidor.precisa_ciclo(caminho, hoje))

    def test_firma_html(self):
        status, corpo = self.get("/firma")
        self.assertEqual(status, 200)
        self.assertIn("<html", corpo)

    def test_nao_sai_da_pasta_web(self):
        status, _ = self.get("/web/..%2Fmotor.py")
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()

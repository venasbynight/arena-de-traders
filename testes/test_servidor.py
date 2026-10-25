import json
import threading
import unittest
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
        self.assertEqual(sorted(estado["salas"]), ["BTCUSDT", "EURUSD", "WDO", "WIN"])

    def test_firma_html(self):
        status, corpo = self.get("/firma")
        self.assertEqual(status, 200)
        self.assertIn("<html", corpo)

    def test_nao_sai_da_pasta_web(self):
        status, _ = self.get("/web/..%2Fmotor.py")
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()

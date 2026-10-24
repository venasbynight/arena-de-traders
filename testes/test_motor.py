import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta

import motor
from tipos import Candle, Plano

EXEMPLO = os.path.join(os.path.dirname(__file__), "..", ".claude", "skills", "trader-budget", "config.example.json")
CFG = json.load(open(EXEMPLO, encoding="utf-8"))
T = datetime(2026, 9, 1, 10, 0)  # terça-feira, dentro da janela de entradas


def vela(k, o, h, l, c):
    return Candle(T + timedelta(minutes=5 * k), o, h, l, c)


COMPRA = Plano("compra", "limite", 5430.0, 5426.0, 5440.0, "teste")  # 4 pts: 2 contratos com perda máx R$ 100


def conta_comprada():
    """Conta com a compra de 2 contratos já executada a 5430."""
    c = motor.Conta("Teste", "WDO", CFG)
    c.colocar([COMPRA], T, "WDO$")
    c.executar_candle(vela(1, 5432, 5433, 5429.5, 5431), False)
    return c


class TestConta(unittest.TestCase):
    def test_limitada_precisa_passar_1_tick(self):
        c = motor.Conta("Teste", "WDO", CFG)
        ev = c.colocar([COMPRA], T, "WDO$")
        self.assertEqual([e["tipo"] for e in ev], ["ordem"])
        c.executar_candle(vela(1, 5432, 5433, 5430, 5431), False)
        self.assertIsNone(c.posicao)
        c.executar_candle(vela(2, 5431, 5432, 5429.5, 5431), False)
        self.assertEqual((c.posicao["entrada"], c.posicao["contratos"]), (5430.0, 2))

    def test_stop_paga_1_tick(self):
        c = conta_comprada()
        c.executar_candle(vela(2, 5428, 5429, 5425, 5427), False)
        self.assertEqual(c.operacoes[-1]["saida"], 5425.5)
        self.assertEqual(c.operacoes[-1]["motivo_saida"], "stop")

    def test_gap_alem_do_stop(self):
        c = conta_comprada()
        c.executar_candle(vela(2, 5424, 5425, 5420, 5422), False)
        self.assertEqual(c.operacoes[-1]["saida"], 5423.5)

    def test_stop_e_alvo_no_mesmo_candle_conta_stop(self):
        c = conta_comprada()
        c.executar_candle(vela(2, 5430, 5441, 5425, 5435), False)
        self.assertEqual(c.operacoes[-1]["motivo_saida"], "stop")

    def test_candle_da_entrada_so_confere_stop(self):
        c = motor.Conta("Teste", "WDO", CFG)
        c.colocar([COMPRA], T, "WDO$")
        c.executar_candle(vela(1, 5432, 5442, 5429.5, 5441), False)  # passou do alvo no mesmo candle
        self.assertIsNotNone(c.posicao)
        self.assertEqual(c.operacoes, [])

    def test_zeragem_no_ultimo_candle_existente(self):
        c = conta_comprada()
        ultimo = Candle(datetime(2026, 9, 1, 13, 55), 5431, 5432, 5430, 5431.5)
        c.executar_candle(ultimo, True)
        self.assertEqual((c.operacoes[-1]["saida"], c.operacoes[-1]["motivo_saida"]), (5431.0, "zeragem"))
        self.assertEqual(c.equity[-1][1], c.saldo)

    def test_tres_stops_encerram_o_dia(self):
        c = motor.Conta("Teste", "WDO", CFG)
        for k in range(3):
            c.colocar([COMPRA], T + timedelta(minutes=10 * k), "WDO$")
            c.executar_candle(vela(2 * k + 1, 5432, 5433, 5429.5, 5431), False)
            c.executar_candle(vela(2 * k + 2, 5428, 5429, 5425, 5427), False)
        ev = c.colocar([COMPRA], T + timedelta(minutes=40), "WDO$")
        self.assertEqual(ev[0]["tipo"], "block")
        self.assertTrue(any("3 stops" in m for m in ev[0]["motivos"]))

    def test_resultado_em_reais_com_custos(self):
        c = motor.Conta("Teste", "WDO", CFG)
        c.colocar([Plano("compra", "limite", 5430.0, 5426.0, 5438.5, "teste")], T, "WDO$")
        c.executar_candle(vela(1, 5432, 5433, 5429.5, 5431), False)
        c.executar_candle(vela(2, 5431, 5439, 5430, 5438), False)
        self.assertEqual(c.operacoes[-1]["resultado_rs"], 168.0)

    def test_cria_config_na_primeira_vez(self):
        with tempfile.TemporaryDirectory() as d:
            caminho = os.path.join(d, "trader", "config.json")
            cfg = motor.carregar_config(caminho)
            self.assertTrue(os.path.exists(caminho))
            self.assertEqual(cfg["capital"], CFG["capital"])


if __name__ == "__main__":
    unittest.main()

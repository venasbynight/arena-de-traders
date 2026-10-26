"""Validação dos finalistas do Didi, uma chamada por vez (em série: o harness acrescenta em pesquisa/validacao.csv).

Escolhidos pelo desenvolvimento (etapa plato15) antes de olhar a validação: o candidato 5 dos amplos (sem ADX,
cruzamentos em até 2 candles, a favor da tendência do 60) no 15. Só o NZDUSD passou todos os critérios no
desenvolvimento; GBPUSD e USDJPY entram como diagnóstico (platô incompleto) e não podem virar padrão.
"""
import json
import os
import sys

PASTA = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PASTA)

import rodar  # noqa: E402
from pesquisa import harness  # noqa: E402
from traders import didi_agulhada  # noqa: E402

FINAL = rodar._amplos()[5]
for ativo in ("NZDUSD", "GBPUSD", "USDJPY"):
    de, ate = harness.divisao(ativo, didi_agulhada.NOME)["validacao"]
    r0 = harness.avaliar(didi_agulhada, FINAL, ativo, de, ate, 0, 15, validacao=True)
    r1 = harness.avaliar(didi_agulhada, FINAL, ativo, de, ate, 1, 15, validacao=True)
    nota = "finalista" if ativo == "NZDUSD" else "diagnóstico: platô incompleto no desenvolvimento, não vira padrão"
    harness.registrar("didi", harness.linha("validação amplo #5", r0, r1, nota, validacao=True))
    print(ativo, json.dumps({k: r0[k] for k in ("trades", "resultado", "fator_lucro", "drawdown")}),
          json.dumps({k: r1[k] for k in ("trades", "resultado", "fator_lucro")}), harness.veredito(r0, r1, True),
          r0["por_mes"])

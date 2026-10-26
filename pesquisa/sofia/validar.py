"""Validação (uma vez por finalista, em série: o harness acrescenta em pesquisa/validacao.csv).

    python pesquisa/sofia/validar.py '<params json>' "<variante>" ATIVO:TF [ATIVO:TF ...]
"""
import json
import os
import sys

PASTA = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(PASTA))
import harness  # noqa: E402
from traders import sofia_smc  # noqa: E402

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    params, variante = json.loads(sys.argv[1]), sys.argv[2]
    for alvo in sys.argv[3:]:
        ativo, tf = alvo.split(":")
        de, ate = harness.divisao(ativo)["validacao"]
        r = [harness.avaliar(sofia_smc, params, ativo, de, ate, e, int(tf), validacao=True) for e in (0, 1)]
        lin = harness.linha(variante, r[0], r[1], nota="VALIDAÇÃO", validacao=True)
        harness.registrar("sofia", lin)
        print(ativo, tf, lin["trades"], lin["resultado"], "PF", lin["fator_lucro"], "| est", lin["resultado_estresse"],
              "PF", lin["fator_lucro_estresse"], lin["veredito"], r[0]["por_mes"])

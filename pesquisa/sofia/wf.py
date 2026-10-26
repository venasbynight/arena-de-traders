"""Walk-forward ancorado (blocos de 3 meses) da Sofia no desenvolvimento, com e sem estresse, para o registro.

    python pesquisa/sofia/wf.py '<grade json>' ATIVO:TF [ATIVO:TF ...]
"""
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

PASTA = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(PASTA))
import harness  # noqa: E402


def _wf(grade, ativo, tf, estresse):
    from traders import sofia_smc
    de, ate = harness.divisao(ativo)["desenvolvimento"]
    return harness.walk_forward(sofia_smc, grade, ativo, de, ate, tf=tf, estresse_ticks=estresse)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    grade = json.loads(sys.argv[1])
    alvos = [(a, int(tf)) for a, tf in (x.split(":") for x in sys.argv[2:])]
    tarefas = [(grade, a, tf, e) for a, tf in alvos for e in (0, 1)]
    with ProcessPoolExecutor(4) as ex:
        res = list(ex.map(_wf, *zip(*tarefas)))
    for i, (a, tf) in enumerate(alvos):
        r0, r1 = res[2 * i], res[2 * i + 1]
        de, ate = r0["blocos"][0]["teste"][0], r0["blocos"][-1]["teste"][1]
        fora = [{"ativo": a, "tf": tf, "de": de, "ate": ate, "params": grade, **r["fora_da_amostra"]} for r in (r0, r1)]
        escolhas = [(b["teste"][0], {k: b["params"][k] for k in grade}) for b in r0["blocos"]]
        lin = harness.linha("walk-forward " + json.dumps(grade), fora[0], fora[1],
                            nota=f"fora da amostra; escolhas {escolhas}; blocos "
                                 f"{[b['placar_teste']['resultado'] for b in r0['blocos']]}")
        harness.registrar("sofia", lin)
        print(a, tf, lin["trades"], lin["resultado"], "PF", lin["fator_lucro"], "| est", lin["resultado_estresse"],
              "PF", lin["fator_lucro_estresse"], lin["veredito"], lin["nota"])

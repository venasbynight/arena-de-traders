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


def _ops(params, ativo, tf, ini, fim, estresse):
    from traders import sofia_smc
    return harness.avaliar(sofia_smc, params, ativo, ini, fim, estresse, tf)["operacoes"]


def wf_carteira(grade, grupo, tf, estresse, min_trades=harness.gerente.MIN_TRADES):
    """Walk-forward ancorado como o do harness, com as operações das ações do grupo somadas em cada bloco."""
    from rodar import GRUPOS
    from traders import sofia_smc
    membros = GRUPOS[grupo]
    cands = harness.candidatos(sofia_smc, grade, membros[0])
    bs = harness.blocos(*harness.divisao(membros[0])["desenvolvimento"])
    tarefas = [(c, m, tf, i, f, estresse) for c in cands for i, f in bs for m in membros]
    with ProcessPoolExecutor(4) as ex:
        res = iter(ex.map(_ops, *zip(*tarefas)))
    por = [[[o for _ in membros for o in next(res)] for _ in bs] for _ in cands]
    saida, oos = [], []
    for k in range(1, len(bs)):
        treinos = [harness.metricas([o for ops in por[j][:k] for o in ops]) for j in range(len(cands))]
        validos = [j for j in range(len(cands)) if treinos[j]["trades"] >= min_trades]
        j = max(validos, key=lambda j: harness.gerente._fator(treinos[j])) if validos else 0
        oos += por[j][k]
        saida.append({"teste": (bs[k][0].isoformat(), bs[k][1].isoformat()), "params": cands[j],
                      "placar_teste": harness.metricas(por[j][k])})
    return {"blocos": saida, "fora_da_amostra": harness.metricas(oos)}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    grade = json.loads(sys.argv[1])
    alvos = [(a, int(tf)) for a, tf in (x.split(":") for x in sys.argv[2:])]
    from rodar import GRUPOS
    if any(a in GRUPOS for a, _ in alvos):  # carteira: um alvo por vez, os processos ficam dentro dela
        res = [wf_carteira(grade, a, tf, e) for a, tf in alvos for e in (0, 1)]
    else:
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

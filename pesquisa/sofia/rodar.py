"""Triagem da Sofia (Plano 6): cada variante roda no desenvolvimento em blocos de 3 meses (conta nova por bloco,
como no walk-forward), com e sem 1 tick de estresse, e vai para pesquisa/sofia/registro.csv.

    python pesquisa/sofia/rodar.py variantes.json     # [{"variante", "params", "alvos": [[ativo, tf], ...]}]
"""
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor

PASTA = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(PASTA))
import harness  # noqa: E402

PROCESSOS = 4  # o brief: no máximo 4 em paralelo
# carteira: cada ação roda na sua conta e as operações das 12 entram juntas nas métricas
GRUPOS = {"ACOES12": ["PETR4", "VALE3", "ITUB4", "BBDC4", "AXIA3", "BBAS3", "SBSP3", "PETR3", "EMBJ3", "PRIO3",
                      "RENT3", "EQTL3"]}


def _bloco(params, ativo, tf, ini, fim, estresse):
    from traders import sofia_smc
    return harness.avaliar(sofia_smc, params, ativo, ini, fim, estresse, tf)["operacoes"]


def triagem(variantes, nota=""):
    tarefas, chaves = [], []
    for v in variantes:
        for ativo, tf in v["alvos"]:
            for membro in GRUPOS.get(ativo, [ativo]):
                for b, (ini, fim) in enumerate(harness.blocos(*harness.divisao(membro)["desenvolvimento"])):
                    for e in (0, 1):
                        tarefas.append((v["params"], membro, tf, ini, fim, e))
                        chaves.append(((v["variante"], ativo, tf, e), b, membro))
    with ProcessPoolExecutor(PROCESSOS) as ex:
        res = list(ex.map(_bloco, *zip(*tarefas)))
    junto, por_bloco, por_membro = {}, {}, {}
    for (k, b, membro), ops in zip(chaves, res):
        junto.setdefault(k, []).extend(ops)
        soma = sum(o["resultado_rs"] for o in ops)
        lista = por_bloco.setdefault(k, [])
        lista += [0] * (b + 1 - len(lista))
        lista[b] = round(lista[b] + soma)
        por_membro.setdefault(k, {})[membro] = round(por_membro.get(k, {}).get(membro, 0) + soma)
    if os.environ.get("SOFIA_OPS"):  # operações para análise (hora, setup), fora do repositório
        with open(os.environ["SOFIA_OPS"], "w", encoding="utf-8") as f:
            json.dump({"|".join(map(str, k)): ops for k, ops in junto.items()}, f)
    saida = []
    for v in variantes:
        for ativo, tf in v["alvos"]:
            de, ate = harness.divisao(GRUPOS.get(ativo, [ativo])[0])["desenvolvimento"]
            r = [{"ativo": ativo, "tf": tf, "de": de.isoformat(), "ate": ate.isoformat(), "params": v["params"],
                  **harness.metricas(junto[(v["variante"], ativo, tf, e)])} for e in (0, 1)]
            blocos = por_bloco[(v["variante"], ativo, tf, 0)]
            membros = por_membro[(v["variante"], ativo, tf, 0)] if ativo in GRUPOS else ""
            lin = harness.linha(v["variante"], r[0], r[1],
                                nota=(nota + " blocos " + str(blocos) + (f" por ação {membros}" if membros else "")).strip())
            harness.registrar("sofia", lin)
            saida.append(lin)
            print(f"{v['variante'][:40]:<40} {ativo:<7} {tf:>2} {lin['trades']:>5} {lin['resultado']:>9.0f} "
                  f"PF {lin['fator_lucro']} | est {lin['resultado_estresse']:>9.0f} PF {lin['fator_lucro_estresse']} "
                  f"{lin['veredito']} {blocos} {membros}", flush=True)
    return saida


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    with open(sys.argv[1], encoding="utf-8") as f:
        vs = json.load(f)
    t = time.time()
    triagem(vs, sys.argv[2] if len(sys.argv) > 2 else "")
    print(f"{time.time() - t:.0f} s")

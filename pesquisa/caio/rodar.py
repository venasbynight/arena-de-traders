"""Pesquisa do Caio (Plano 6): roda variantes no desenvolvimento, com e sem estresse, e grava no registro.

    python pesquisa/caio/rodar.py <grupo>     # grupos em GRUPOS; cada variante é (nome, ativo, params)
"""
import os
import sys
from concurrent.futures import ProcessPoolExecutor

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, RAIZ)

from pesquisa import harness as H  # noqa: E402
from traders import caio_contrafluxo as C  # noqa: E402


def _params(ativo, extra):
    return {**{k: (v.get(ativo) if isinstance(v, dict) else v) for k, v in C.PARAMS.items()}, **extra}


def _um(ativo, params, estresse, de=None, ate=None):
    d0, d1 = H.divisao(ativo, C.NOME)["desenvolvimento"]
    return H.avaliar(C, params, ativo, de or d0, ate or d1, estresse)


def rodar(variantes, nota=""):
    """[(nome, ativo, extra)] -> linhas do registro, já gravadas."""
    tarefas = [(a, _params(a, x), e) for _, a, x in variantes for e in (0, 1)]
    with ProcessPoolExecutor(max_workers=4) as ex:  # brief: no máximo 4 processos
        rs = list(ex.map(_um, *zip(*tarefas)))
    out = []
    for i, (nome, ativo, extra) in enumerate(variantes):
        r, re_ = rs[2 * i], rs[2 * i + 1]
        lin = H.linha(nome, r, re_, nota=nota)
        H.registrar("caio", lin)
        out.append(lin)
        print(f"{ativo} {nome:<34} {r['trades']:>4} tr  {r['resultado']:>9.0f}  PF {r['fator_lucro']}  "
              f"acerto {r['acerto']:.2f}  | est {re_['resultado']:>9.0f} PF {re_['fator_lucro']}  {lin['veredito']}")
    return out


def ablacao():
    """Uma mudança por vez sobre os PARAMS atuais."""
    v = []
    for a, lims in (("WDO", [5000, 10500, 14500]), ("WIN", [18000, 25000, 32000, 42000])):
        v += [(f"limite {x}", a, {"limite": x}) for x in lims]
    v += [(f"folga {x}", "WDO", {"folga_ticks": x}) for x in (4, 6, 8)]
    v += [(f"folga {x}", "WIN", {"folga_ticks": x}) for x in (10, 20, 40)]
    for a in ("WDO", "WIN"):
        v += [("confirma", a, {"confirma": True})]
        v += [(f"tendencia {x}", a, {"tendencia": x}) for x in ("dia", "ambos")]
        v += [(f"limite_pct {x}", a, {"limite_pct": x}) for x in (90, 95, 98)]
        v += [(f"horario {x[0]}-{x[1]}", a, {"horario": x}) for x in (["10:00", "17:00"], ["09:05", "12:00"])]
        v += [(f"alvo_rr {x}", a, {"alvo_rr": x}) for x in (1.5, 2, 3)]
    return v


def rodada2():
    """Rejeição sozinha e combinações do que melhorou o PF na ablação (WIN: folga, confirma, ambos; WDO: folga,
    tendência do dia, alvo_rr), com limites mais baixos para compensar os filtros."""
    v = []
    for a, lims in (("WDO", [3000, 5000, 7500]), ("WIN", [5000, 10000])):
        v += [(f"rejeicao limite {x}", a, {"rejeicao": True, "limite": x}) for x in lims]
    for f in (6, 8):
        for t in ("60", "dia"):
            for lim in (5000, 7500):
                for rr in (None, 1.5):
                    v.append((f"folga {f} tend {t} lim {lim} rr {rr}", "WDO",
                              {"folga_ticks": f, "tendencia": t, "limite": lim, "alvo_rr": rr}))
    for f in (20, 40):
        for t in ("60", "ambos"):
            for c in (False, True):
                for lim in (5000, 10000):
                    v.append((f"folga {f} tend {t} conf {int(c)} lim {lim}", "WIN",
                              {"folga_ticks": f, "tendencia": t, "confirma": c, "limite": lim}))
    return v


def rodada3():
    """Platô em volta do melhor do WIN (folga 40, ambos, limite 10000) e stops ainda mais largos no WDO."""
    v = [(f"folga {f} tend ambos lim {lim}", "WIN", {"folga_ticks": f, "tendencia": "ambos", "limite": lim})
         for f in (30, 40, 50, 60) for lim in (7500, 10000, 12500)]
    v += [(f"folga {f} tend dia lim {lim}", "WDO", {"folga_ticks": f, "tendencia": "dia", "limite": lim})
          for f in (10, 12) for lim in (3000, 5000)]
    return v


GRUPOS = {"ablacao": ablacao, "rodada2": rodada2, "rodada3": rodada3}
# grade do walk-forward: as dimensões que mexeram no PF (ablação e rodadas 2-3), no máximo 3 valores cada
GRADE_WF = {"WDO": {"folga_ticks": [2, 6, 10], "tendencia": ["60", "dia"], "limite": [5000, 7500]},
            "WIN": {"folga_ticks": [2, 20, 40], "tendencia": ["60", "ambos"], "limite": [7500, 10000]}}


def _wf(ativo, meses, estresse):
    de, ate = H.divisao(ativo, C.NOME)["desenvolvimento"]
    return H.walk_forward(C, GRADE_WF[ativo], ativo, de, ate, bloco_meses=meses, estresse_ticks=estresse, min_trades=20)


def walk_forward():
    """WDO em blocos de 3 meses (1 bloco de teste: 01-15/09) e WIN em blocos de 1 mês (3 meses não dá teste)."""
    tarefas = [(a, m, e) for a, m in (("WDO", 3), ("WIN", 1)) for e in (0, 1)]
    with ProcessPoolExecutor(max_workers=4) as ex:
        rs = list(ex.map(_wf, *zip(*tarefas)))
    for i in range(0, len(rs), 2):
        (ativo, meses, _), w, we = tarefas[i], rs[i], rs[i + 1]
        cab = lambda x: {**x["fora_da_amostra"], "params": [b["params"] for b in x["blocos"]], "ativo": ativo,
                         "tf": 5, "de": x["blocos"][0]["teste"][0], "ate": x["blocos"][-1]["teste"][1]}
        lin = H.linha(f"walk-forward {meses} meses, {w['candidatos']} candidatos", cab(w), cab(we),
                      nota=f"min_trades 20; fora da amostra só {len(w['blocos'])} bloco(s)")
        H.registrar("caio", lin)
        for b in w["blocos"]:
            print(ativo, "treino", b["treino"], "teste", b["teste"], b["params"],
                  "treino:", {k: b["placar_treino"][k] for k in ("trades", "resultado", "fator_lucro")},
                  "teste:", {k: b["placar_teste"][k] for k in ("trades", "resultado", "fator_lucro")})
        print(ativo, "fora da amostra", lin["trades"], lin["resultado"], lin["fator_lucro"],
              "| estresse", lin["resultado_estresse"], lin["fator_lucro_estresse"], lin["veredito"])


# finalistas escolhidos pelo desenvolvimento (nenhum passou na regra; vão para a validação só para o relatório ter
# o número fora da amostra): o padrão atual e o de melhor resultado com estresse no desenvolvimento
FINALISTAS = [("baseline (PARAMS atuais)", "WDO", None),
              ("folga 10 tend dia lim 5000", "WDO", {"folga_ticks": 10, "tendencia": "dia", "limite": 5000}),
              ("baseline (PARAMS atuais)", "WIN", None),
              ("folga 40 tend ambos lim 7500", "WIN", {"folga_ticks": 40, "tendencia": "ambos", "limite": 7500})]


def _val(ativo, params, estresse):
    de, ate = H.divisao(ativo, C.NOME)["validacao"]
    return H.avaliar(C, params, ativo, de, ate, estresse, validacao=True)


def validacao():
    """Uma vez por finalista (com e sem estresse); não se ajusta nada depois."""
    # em série: o harness grava pesquisa/validacao.csv a cada chamada e 4 processos perderam linhas (Windows)
    rs = [_val(a, None if x is None else _params(a, x), e) for _, a, x in FINALISTAS for e in (0, 1)]
    for i, (nome, ativo, _) in enumerate(FINALISTAS):
        r, re_ = rs[2 * i], rs[2 * i + 1]
        lin = H.linha(f"VALIDAÇÃO {nome}", r, re_, nota="validacao", validacao=True)
        H.registrar("caio", lin)
        print(ativo, nome, r["trades"], r["resultado"], r["fator_lucro"], round(r["acerto"], 2), r["drawdown"],
              "| est", re_["resultado"], re_["fator_lucro"], lin["veredito"])


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if sys.argv[1] == "walk_forward":
        walk_forward()
    elif sys.argv[1] == "validacao":
        validacao()
    else:
        rodar(GRUPOS[sys.argv[1]](), nota=sys.argv[1])

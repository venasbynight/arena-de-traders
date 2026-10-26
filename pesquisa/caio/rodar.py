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


# BTCUSDT (delta = taker buy da Binance, desde 2024): tick de US$ 0,01, então região e folga precisam de outra
# escala (candle de 5 min mediano: US$ 109). Base: limite pelo percentil 95, região US$ 30, folga US$ 10.
BTC = {"limite_pct": 95, "regiao_ticks": 3000, "folga_ticks": 1000}


def btc1():
    """Base do BTC e uma mudança por vez (as mesmas hipóteses do WDO/WIN, menos horário)."""
    v = [("btc base", "BTCUSDT", BTC)]
    v += [(f"btc limite_pct {x}", "BTCUSDT", {**BTC, "limite_pct": x}) for x in (90, 98)]
    v += [("btc regiao 1000", "BTCUSDT", {**BTC, "regiao_ticks": 1000})]
    v += [(f"btc folga {x}", "BTCUSDT", {**BTC, "folga_ticks": x}) for x in (5000, 10000)]
    v += [(f"btc tendencia {x}", "BTCUSDT", {**BTC, "tendencia": x}) for x in ("dia", "ambos")]
    v += [("btc confirma", "BTCUSDT", {**BTC, "confirma": True}), ("btc rejeicao", "BTCUSDT", {**BTC, "rejeicao": True})]
    v += [(f"btc alvo_rr {x}", "BTCUSDT", {**BTC, "alvo_rr": x}) for x in (2, 3)]
    return v


def btc2():
    """O custo fixo (R$ 1 por trade com 5 contratos) come o pouco que sobra; stop e alvo mais longos diluem o custo."""
    v = [("btc folga 10000 alvo_rr 3", "BTCUSDT", {**BTC, "folga_ticks": 10000, "alvo_rr": 3})]
    v += [("btc folga 20000", "BTCUSDT", {**BTC, "folga_ticks": 20000})]
    v += [("btc folga 20000 alvo_rr 3", "BTCUSDT", {**BTC, "folga_ticks": 20000, "alvo_rr": 3})]
    v += [("btc folga 20000 alvo_rr 3 pct 98", "BTCUSDT", {**BTC, "folga_ticks": 20000, "alvo_rr": 3, "limite_pct": 98})]
    return v


# Diagnóstico para o Diretor (não é o Caio): o mesmo sinal, operado a favor do agressor. Grade: folga pequena,
# média e grande do ativo × alvo no topo/fundo do dia ou R:R 1,5 / 3.
AGRESSOR = {"WDO": ({}, (2, 6, 10)), "WIN": ({}, (2, 20, 40)), "BTCUSDT": (BTC, (1000, 10000, 20000))}


GRADE_WF_AGR = {"WDO": {"lado": ["agressor"], "folga_ticks": [2, 6, 10], "alvo_rr": [None, 1.5, 3]},
                "WIN": {"lado": ["agressor"], "folga_ticks": [2, 20, 40], "alvo_rr": [None, 1.5, 3]},
                # BTC: sem o alvo no topo/fundo (100–500 trades em 28 meses), para caber no tempo
                "BTCUSDT": {"lado": ["agressor"], "limite_pct": [95], "regiao_ticks": [3000],
                            "folga_ticks": [1000, 10000, 20000], "alvo_rr": [1.5, 3]}}


def agressor():
    return [(f"agressor folga {f} rr {rr}", a, {**base, "lado": "agressor", "folga_ticks": f, "alvo_rr": rr})
            for a in ("BTCUSDT", "WDO", "WIN") for base, folgas in [AGRESSOR[a]] for f in folgas
            for rr in (None, 1.5, 3)]


GRUPOS = {"ablacao": ablacao, "rodada2": rodada2, "rodada3": rodada3, "btc1": btc1, "btc2": btc2,
          "agressor": agressor}
# grade do walk-forward: as dimensões que mexeram no PF (ablação e rodadas 2-3), no máximo 3 valores cada
GRADE_WF = {"WDO": {"folga_ticks": [2, 6, 10], "tendencia": ["60", "dia"], "limite": [5000, 7500]},
            "WIN": {"folga_ticks": [2, 20, 40], "tendencia": ["60", "ambos"], "limite": [7500, 10000]},
            "BTCUSDT": {"regiao_ticks": [3000], "folga_ticks": [1000, 10000, 20000], "alvo_rr": [None, 3],
                        "limite_pct": [95, 98]}}


def _wf(ativo, meses, estresse, agressor=False):
    de, ate = H.divisao(ativo, C.NOME)["desenvolvimento"]
    grade = GRADE_WF_AGR[ativo] if agressor else GRADE_WF[ativo]
    mt = 20 if ativo in ("WDO", "WIN") else 50  # WDO/WIN nunca chegam aos 50 do gerente
    return H.walk_forward(C, grade, ativo, de, ate, bloco_meses=meses, estresse_ticks=estresse, min_trades=mt)


def walk_forward(ativos=(("WDO", 3), ("WIN", 1)), agressor=False):
    """WDO em blocos de 3 meses (1 bloco de teste: 01-15/09) e WIN em blocos de 1 mês (3 meses não dá teste)."""
    tarefas = [(a, m, e, agressor) for a, m in ativos for e in (0, 1)]
    with ProcessPoolExecutor(max_workers=4) as ex:
        rs = list(ex.map(_wf, *zip(*tarefas)))
    for i in range(0, len(rs), 2):
        (ativo, meses, _, _), w, we = tarefas[i], rs[i], rs[i + 1]
        cab = lambda x: {**x["fora_da_amostra"], "params": [b["params"] for b in x["blocos"]], "ativo": ativo,
                         "tf": 5, "de": x["blocos"][0]["teste"][0], "ate": x["blocos"][-1]["teste"][1]}
        lin = H.linha(f"{'agressor ' if agressor else ''}walk-forward {meses} meses, {w['candidatos']} candidatos",
                      cab(w), cab(we),
                      nota=f"min_trades {20 if ativo in ('WDO', 'WIN') else 50}; "
                           f"fora da amostra: {len(w['blocos'])} bloco(s)")
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


FINALISTAS_BTC = [("btc base", "BTCUSDT", BTC),
                  ("btc folga 10000 alvo_rr 3", "BTCUSDT", {**BTC, "folga_ticks": 10000, "alvo_rr": 3})]


def _val(ativo, params, estresse):
    de, ate = H.divisao(ativo, C.NOME)["validacao"]
    return H.avaliar(C, params, ativo, de, ate, estresse, validacao=True)


def validacao(finalistas=FINALISTAS):
    """Uma vez por finalista (com e sem estresse); não se ajusta nada depois."""
    # em série: o harness grava pesquisa/validacao.csv a cada chamada e 4 processos perderam linhas (Windows)
    rs = [_val(a, None if x is None else _params(a, x), e) for _, a, x in finalistas for e in (0, 1)]
    for i, (nome, ativo, _) in enumerate(finalistas):
        r, re_ = rs[2 * i], rs[2 * i + 1]
        lin = H.linha(f"VALIDAÇÃO {nome}", r, re_, nota="validacao", validacao=True)
        H.registrar("caio", lin)
        print(ativo, nome, r["trades"], r["resultado"], r["fator_lucro"], round(r["acerto"], 2), r["drawdown"],
              "| est", re_["resultado"], re_["fator_lucro"], lin["veredito"])


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if sys.argv[1] == "walk_forward":
        walk_forward()
    elif sys.argv[1] == "walk_forward_agressor":
        walk_forward((("BTCUSDT", 3), ("WDO", 3), ("WIN", 1)), agressor=True)
    elif sys.argv[1] == "walk_forward_btc":
        walk_forward((("BTCUSDT", 3),))
    elif sys.argv[1] == "validacao":
        validacao()
    elif sys.argv[1] == "validacao_btc":
        validacao(FINALISTAS_BTC)
    else:
        rodar(GRUPOS[sys.argv[1]](), nota=sys.argv[1])

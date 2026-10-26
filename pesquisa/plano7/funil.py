"""Funil do Didi no desenvolvimento (blocos de 3 meses, como em rodar.py): agulhadas → bandas abriram → ADX → TRIX →
plano → ordem (passou no dimensionamento e no risco, sem posição aberta) → trades. Conta cada decisão pelo que o
Didi pensou nela.

    python pesquisa/plano7/funil.py [ativo] [tf]       # padrão: WDO 5; grava pesquisa/plano7/funil_<ativo>_<tf>.json
"""
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from datetime import timedelta

PASTA = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(PASTA)))

import motor  # noqa: E402
from pesquisa import harness  # noqa: E402
from pesquisa.plano7 import rodar as R  # noqa: E402
from traders import didi_agulhada  # noqa: E402

ETAPAS = ["agulhadas", "bandas_abriram", "passou_adx", "passou_trix", "plano", "ordem", "trades"]


def _etapa(d):
    """Até onde a decisão chegou no funil (None = nem chegou às bandas abrindo)."""
    txt = d.pensamento[-1] if d.pensamento else ""  # a última linha é a da entrada (a da saída vem antes)
    if d.planos:
        return "plano"
    if "sem topo acima" in txt or "sem fundo abaixo" in txt or "tendência" in txt:
        return "passou_trix"
    if "TRIX" in txt:
        return "passou_adx"
    if "ADX" in txt or " DI " in txt:
        return "bandas_abriram"
    return None


def _bloco(params, cfg_extra, ativo, tf, ini, fim):
    cont = dict.fromkeys(ETAPAS, 0)
    original = didi_agulhada.Trader.decidir

    def decidir(self, hoje, ontem, f60):
        d = original(self, hoje, ontem, f60)
        if hoje[-1].t.date() >= ini:
            cont["agulhadas"] += any(x["tipo"] == "agulhada" for x in d.desenhos)
            e = _etapa(d)
            if e:
                for x in ETAPAS[1:ETAPAS.index(e) + 1]:
                    cont[x] += 1
        return d

    didi_agulhada.Trader.decidir = decidir
    try:
        cfg = {**harness.config(), **cfg_extra}
        cs = [k for k in harness._serie(ativo, tf)
              if ini - timedelta(days=harness.AQUECIMENTO_DIAS) <= k.t.date() <= fim]
        r = motor.rodar_backtest(ativo, cs, [(didi_agulhada, params)], cfg, minutos=tf)["traders"]["Didi Agulhada"]
    finally:
        didi_agulhada.Trader.decidir = original
    cont["ordem"] = sum(e["tipo"] == "ordem" and e["t"][:10] >= ini.isoformat() for e in r["eventos"])
    cont["trades"] = sum(o["entrada_t"][:10] >= ini.isoformat() for o in r["operacoes"])
    cont["sessoes"] = len({k.t.date() for k in cs if k.t.date() >= ini})
    return cont


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    ativo = sys.argv[1] if len(sys.argv) > 1 else "WDO"
    tf = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    variantes = {"antes (Plano 6)": (R._params("didi", ativo, R.DIDI_ANTES), R.ANTES_CFG),
                 "depois (Diretor)": (R._params("didi", ativo, {}), R.DEPOIS_CFG),
                 "depois, TRIX 0,2": (R._params("didi", ativo, {"trix_extremo": 0.2}), R.DEPOIS_CFG),
                 "depois, TRIX 1,0": (R._params("didi", ativo, {"trix_extremo": 1.0}), R.DEPOIS_CFG)}
    janelas = R._janelas("didi", ativo)
    tarefas = [(n, p, c, m, ini, fim) for n, (p, c) in variantes.items() for m, ini, fim in janelas]
    with ProcessPoolExecutor(R.PROCESSOS) as ex:
        res = list(ex.map(_bloco, *zip(*[(p, c, m, tf, ini, fim) for _, p, c, m, ini, fim in tarefas])))
    saida = {}
    for (n, *_), c in zip(tarefas, res):
        s = saida.setdefault(n, dict.fromkeys(ETAPAS + ["sessoes"], 0))
        for k, v in c.items():
            s[k] += v
    for n, s in saida.items():
        s["trades_por_sessao"] = round(s["trades"] / s["sessoes"], 3)
        print(n, " → ".join(f"{k} {s[k]}" for k in ETAPAS), f"| {s['sessoes']} sessões, {s['trades_por_sessao']} tr/sessão")
    with open(os.path.join(PASTA, f"funil_{ativo}_{tf}.json"), "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, indent=1)

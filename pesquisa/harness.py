"""Harness da pesquisa dos operacionais (Plano 6). Só biblioteca padrão.

    avaliar(trader, params, ativo, de, ate, estresse_ticks=0, tf=5)    # um backtest, com as métricas
    walk_forward(trader, grade, ativo, de, ate, bloco_meses=3, tf=5)   # escolhe nos blocos anteriores, testa no seguinte
    registrar("sofia", linha(...))                                     # pesquisa/sofia/registro.csv

`trader` é qualquer módulo (ou classe) com o contrato dos traders: NOME, PARAMS, GRADE e Trader(ativo, tick, params,
sessao).decidir(hoje, ontem, fechados60). Variantes de regra entram como módulos/classes diferentes.

A divisão desenvolvimento/validação de cada ativo está em pesquisa/divisao.json. Qualquer janela que encoste na
validação é recusada (EspiadaNaValidacao) sem validacao=True; as chamadas com validacao=True ficam em
pesquisa/validacao.csv e cada trader × ativo × tf aceita no máximo 3 variantes (parâmetros) na validação.

    python pesquisa/harness.py --baseline    # PARAMS atuais de Sofia, Didi e Caio no desenvolvimento, com e sem estresse
"""
import copy
import csv
import functools
import itertools
import json
import os
import sys
import time
import types
from datetime import date, datetime, timedelta

PASTA = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(PASTA)
if RAIZ not in sys.path:
    sys.path.insert(0, RAIZ)

import dados  # noqa: E402
import gerente  # noqa: E402
import motor  # noqa: E402

with open(os.path.join(PASTA, "divisao.json"), encoding="utf-8") as _f:
    DIVISAO = json.load(_f)["ativos"]
AQUECIMENTO_DIAS = 30  # dias-calendário antes de `de` para o 60 e o "ontem" já existirem; trades daí não contam
MAX_FINALISTAS = 3
MIN_DEV, MIN_VAL = 100, 30  # operações para chamar de resultado (abaixo: inconclusivo)
COLUNAS = ["quando", "variante", "parametros", "ativo", "tf", "de", "ate", "trades", "resultado", "fator_lucro",
           "drawdown", "trades_estresse", "resultado_estresse", "fator_lucro_estresse", "drawdown_estresse",
           "veredito", "nota"]


class EspiadaNaValidacao(ValueError):
    """Janela dentro da validação sem validacao=True, ou finalistas demais."""


def _data(d):
    return d if isinstance(d, date) else date.fromisoformat(d)


def divisao(ativo, nome_trader=None):
    """{"desenvolvimento": (de, ate), "validacao": (de, ate), "tf": [...]} do ativo, com o caso especial do trader."""
    base = DIVISAO[ativo]
    esp = base.get("por_trader", {}).get(nome_trader, {})
    out = {**base, **esp}
    return {**out, "desenvolvimento": tuple(map(_data, out["desenvolvimento"])),
            "validacao": tuple(map(_data, out["validacao"]))}


@functools.lru_cache(maxsize=1)
def config():
    """Config do usuário sem baixar delta: o harness só lê o delta que já está no cache."""
    cfg = copy.deepcopy(motor.carregar_config(os.path.join(RAIZ, "trader", "config.json")))
    for e in cfg["ativos"].values():
        e["delta"] = False
    return cfg


@functools.lru_cache(maxsize=8)
def _serie(ativo, tf):
    """Todos os candles do ativo no histórico da divisão, como candles base de `tf` minutos."""
    cfg, d = config(), DIVISAO[ativo]
    base = cfg["ativos"][ativo].get("tf", 5)
    cs = dados.historico(ativo, _data(d["desenvolvimento"][0]), _data(d["validacao"][1]), cfg,
                         pasta=os.path.join(RAIZ, "dados"))
    if tf == base:
        return cs
    if tf % base:
        raise ValueError(f"{ativo}: tf {tf} não é múltiplo dos candles base de {base} min")
    return dados.agrupar(cs, tf)  # blocos ancorados no primeiro candle de cada dia, como o 60 do motor


def _contrato(m):
    falta = [a for a in ("NOME", "PARAMS", "GRADE", "Trader") if not hasattr(m, a)]
    if falta:
        raise TypeError(f"{m!r} não segue o contrato dos traders: falta {', '.join(falta)}")
    if hasattr(m, "ESTILO"):
        return m
    return types.SimpleNamespace(NOME=m.NOME, PARAMS=m.PARAMS, GRADE=m.GRADE, Trader=m.Trader, ESTILO="")


def _guarda(m, ativo, de, ate, tf, params, estresse_ticks, validacao):
    vi, vf = divisao(ativo, m.NOME)["validacao"]
    if not (de <= vf and ate >= vi):
        return
    if not validacao:
        raise EspiadaNaValidacao(f"{m.NOME} em {ativo}: {de}..{ate} encosta na validação ({vi}..{vf}); "
                                 "só finalistas, com validacao=True")
    caminho = os.path.join(PASTA, "validacao.csv")
    chave = json.dumps(params, sort_keys=True, default=str)
    vistas = set()
    if os.path.exists(caminho):
        with open(caminho, newline="", encoding="utf-8") as f:
            vistas = {r["parametros"] for r in csv.DictReader(f)
                      if (r["trader"], r["ativo"], r["tf"]) == (m.NOME, ativo, str(tf))}
    if chave not in vistas and len(vistas) >= MAX_FINALISTAS:
        raise EspiadaNaValidacao(f"{m.NOME} em {ativo} tf {tf}: já são {MAX_FINALISTAS} finalistas na validação")
    novo = not os.path.exists(caminho)
    with open(caminho, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if novo:
            w.writerow(["quando", "trader", "ativo", "tf", "parametros", "de", "ate", "estresse_ticks"])
        w.writerow([datetime.now().isoformat(timespec="seconds"), m.NOME, ativo, tf, chave, de, ate, estresse_ticks])


def metricas(ops):
    """Placar do motor + payoff, maior sequência de perdas e resultado por mês (pela data de entrada)."""
    p = motor.placar(ops)
    rs = [o["resultado_rs"] for o in ops]
    ganhos, perdas = [v for v in rs if v > 0], [-v for v in rs if v < 0]
    seq = pior = 0
    for v in rs:
        seq = seq + 1 if v < 0 else 0
        pior = max(pior, seq)
    por_mes = {}
    for o in ops:
        por_mes[o["entrada_t"][:7]] = round(por_mes.get(o["entrada_t"][:7], 0.0) + o["resultado_rs"], 2)
    p.update(payoff=round((sum(ganhos) / len(ganhos)) / (sum(perdas) / len(perdas)), 2) if ganhos and perdas else None,
             seq_perdas=pior, por_mes=por_mes)
    return p


def avaliar(modulo_trader, params, ativo, de, ate, estresse_ticks=0, tf=5, validacao=False):
    """Backtest de um trader num ativo de `de` a `ate` (inclusive) com candles base de `tf` minutos.

    `params` None = os PARAMS do trader. `estresse_ticks` = ticks extras de deslizamento em cada entrada e saída.
    Roda com AQUECIMENTO_DIAS antes de `de`; só contam as operações com entrada a partir de `de`.
    """
    m = _contrato(modulo_trader)
    de, ate = _data(de), _data(ate)
    _guarda(m, ativo, de, ate, tf, params, estresse_ticks, validacao)
    ini = de - timedelta(days=AQUECIMENTO_DIAS)
    cs = [k for k in _serie(ativo, tf) if ini <= k.t.date() <= ate]
    ops = []
    if cs:
        r = motor.rodar_backtest(ativo, cs, [(m, params)], config(), minutos=tf, estresse_ticks=estresse_ticks)
        ops = [o for o in r["traders"][m.NOME]["operacoes"] if o["entrada_t"][:10] >= de.isoformat()]
    return {"trader": m.NOME, "ativo": ativo, "tf": tf, "de": de.isoformat(), "ate": ate.isoformat(),
            "params": params, "estresse_ticks": estresse_ticks, **metricas(ops), "operacoes": ops}


def blocos(de, ate, meses=3):
    """[(ini, fim)] consecutivos de `meses` meses-calendário: o 1º vai de `de` ao fim do mês `de.month + meses - 1`,
    os outros começam no dia 1; o último é cortado em `ate`."""
    de, ate = _data(de), _data(ate)
    out, ini = [], de
    while ini <= ate:
        m = ini.month - 1 + meses
        prox = date(ini.year + m // 12, m % 12 + 1, 1)
        out.append((ini, min(ate, prox - timedelta(days=1))))
        ini = prox
    return out


def candidatos(modulo_trader, grade, ativo):
    """Produto cartesiano da `grade` ({param: [valores]}) sobre os PARAMS; valor por ativo ({ativo: ...}) resolvido."""
    do_ativo = lambda v: v.get(ativo) if isinstance(v, dict) else v
    padrao = {k: do_ativo(v) for k, v in modulo_trader.PARAMS.items()}
    chaves = list(grade)
    return [{**padrao, **dict(zip(chaves, vs))} for vs in itertools.product(*(do_ativo(grade[k]) for k in chaves))]


def walk_forward(modulo_trader, grade, ativo, de, ate, bloco_meses=3, tf=5, estresse_ticks=0,
                 min_trades=gerente.MIN_TRADES):
    """Walk-forward ancorado: para cada bloco a partir do 2º, escolhe nos blocos anteriores (todos) o candidato da
    `grade` de maior fator de lucro com ≥ `min_trades` (ninguém chega: o primeiro candidato) e testa nele.

    Cada candidato roda uma vez por bloco. Devolve os blocos e o fora da amostra concatenado.
    """
    cands = candidatos(modulo_trader, grade, ativo)
    bs = blocos(de, ate, bloco_meses)
    por = [[avaliar(modulo_trader, c, ativo, i, f, estresse_ticks, tf)["operacoes"] for i, f in bs] for c in cands]
    saida, oos = [], []
    for k in range(1, len(bs)):
        treinos = [metricas([o for ops in por[j][:k] for o in ops]) for j in range(len(cands))]
        validos = [j for j in range(len(cands)) if treinos[j]["trades"] >= min_trades]
        j = max(validos, key=lambda j: gerente._fator(treinos[j])) if validos else 0
        oos += por[j][k]
        saida.append({"treino": (bs[0][0].isoformat(), bs[k - 1][1].isoformat()),
                      "teste": (bs[k][0].isoformat(), bs[k][1].isoformat()), "params": cands[j],
                      "placar_treino": {x: v for x, v in treinos[j].items() if x != "por_mes"},
                      "placar_teste": {x: v for x, v in metricas(por[j][k]).items() if x != "por_mes"}})
    return {"trader": modulo_trader.NOME, "ativo": ativo, "tf": tf, "estresse_ticks": estresse_ticks,
            "candidatos": len(cands), "blocos": saida, "fora_da_amostra": metricas(oos), "operacoes": oos}


def veredito(r, r_estresse, validacao=False):
    """Regras 4 e 5 do plano: positiva só se continua positiva com o estresse; poucas operações = inconclusivo."""
    if r["trades"] < (MIN_VAL if validacao else MIN_DEV):
        return "inconclusivo"
    return "positiva" if r["resultado"] > 0 and r_estresse["resultado"] > 0 else "negativa"


def linha(variante, r, r_estresse, nota="", validacao=False):
    """Linha do registro a partir de duas avaliações (sem e com estresse) da mesma janela."""
    return {"quando": datetime.now().isoformat(timespec="seconds"), "variante": variante,
            "parametros": json.dumps(r["params"], ensure_ascii=False, sort_keys=True, default=str),
            "ativo": r["ativo"], "tf": r["tf"], "de": r["de"], "ate": r["ate"], "trades": r["trades"],
            "resultado": r["resultado"], "fator_lucro": r["fator_lucro"], "drawdown": r["drawdown"],
            "trades_estresse": r_estresse["trades"], "resultado_estresse": r_estresse["resultado"],
            "fator_lucro_estresse": r_estresse["fator_lucro"], "drawdown_estresse": r_estresse["drawdown"],
            "veredito": veredito(r, r_estresse, validacao), "nota": nota}


def registrar(trader, linha):
    """Acrescenta `linha` (chaves de COLUNAS) em pesquisa/<trader>/registro.csv."""
    pasta = os.path.join(PASTA, trader)
    os.makedirs(pasta, exist_ok=True)
    caminho = os.path.join(pasta, "registro.csv")
    novo = not os.path.exists(caminho)
    with open(caminho, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, COLUNAS, extrasaction="raise")
        if novo:
            w.writeheader()
        w.writerow(linha)


# --- baseline ---------------------------------------------------------------------------------------------------

def _tarefa(nome_modulo, ativo, tf, estresse):
    import importlib
    m = importlib.import_module(nome_modulo)
    de, ate = divisao(ativo, m.NOME)["desenvolvimento"]
    t = time.time()
    r = avaliar(m, None, ativo, de, ate, estresse, tf)
    return {**r, "segundos": round(time.time() - t, 1)}


def baseline():
    """PARAMS atuais de cada trader em cada ativo/tf em que ele roda sem mudar código, no desenvolvimento."""
    from concurrent.futures import ProcessPoolExecutor
    trs = {"sofia": "traders.sofia_smc", "didi": "traders.didi_agulhada", "caio": "traders.caio_contrafluxo"}
    tarefas = []
    for slug, nome in trs.items():
        for ativo, d in DIVISAO.items():
            if slug == "caio" and ativo not in ("WDO", "WIN"):
                continue
            if d["tf"] == [60]:
                continue  # ações no 60: o contexto maior (diário) e o histórico de aquecimento precisam de código novo
            tarefas += [(slug, nome, ativo, tf, e) for tf in d["tf"] for e in (0, 1)]
    with ProcessPoolExecutor(max_workers=max(1, (os.cpu_count() or 2) - 2)) as ex:
        res = list(ex.map(_tarefa, *zip(*[(n, a, tf, e) for _, n, a, tf, e in tarefas])))
    pares = {}
    for (slug, _, ativo, tf, e), r in zip(tarefas, res):
        pares.setdefault((slug, ativo, tf), {})[e] = r
    linhas = []
    for (slug, ativo, tf), rr in pares.items():
        lin = linha("baseline (PARAMS atuais)", rr[0], rr[1], nota=f"{rr[0]['segundos']} s")
        registrar(slug, lin)
        linhas.append({"trader": rr[0]["trader"], **lin, "payoff": rr[0]["payoff"], "acerto": round(rr[0]["acerto"], 3),
                       "seq_perdas": rr[0]["seq_perdas"], "pior_dia": rr[0]["pior_dia"]})
    cols = ["trader", "ativo", "tf", "de", "ate", "trades", "resultado", "fator_lucro", "drawdown", "acerto", "payoff",
            "seq_perdas", "pior_dia", "trades_estresse", "resultado_estresse", "fator_lucro_estresse",
            "drawdown_estresse", "veredito", "nota"]
    with open(os.path.join(PASTA, "baseline.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(linhas)
    return linhas


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if "--baseline" in sys.argv:
        t0 = time.time()
        for l in baseline():
            print(f"{l['trader']:<17} {l['ativo']:<8} {l['tf']:>3}  {l['trades']:>5} trades  {l['resultado']:>11.2f}  "
                  f"PF {l['fator_lucro']}  | estresse {l['resultado_estresse']:>11.2f} PF {l['fator_lucro_estresse']}  "
                  f"{l['veredito']}  ({l['nota']})")
        print(f"baseline em {time.time() - t0:.0f} s")

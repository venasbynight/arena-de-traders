"""Plano 7 (risco do Diretor): padrão do Plano 6 × padrão novo, no desenvolvimento, pelo método do Plano 6.

Cada variante roda no desenvolvimento em blocos de 3 meses (conta nova por bloco, como a triagem da Sofia e do Didi),
com e sem 1 tick de estresse. As 12 ações entram juntas como a carteira ACOES12 (cada uma na sua conta). Cada
variante leva o seu config de risco: "antes" = R:R 1 e teto de 5 contratos; "depois" = o config do usuário (R:R 3, 50).

    python pesquisa/plano7/rodar.py <etapa>      # etapas em ETAPAS; saída em pesquisa/plano7/<etapa>.json e registro.csv
    python pesquisa/plano7/rodar.py validar <trader> <ativo> <tf> <variante>   # uma finalista, em série
"""
import hashlib
import json
import os
import pickle
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor
from datetime import timedelta

PASTA = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(PASTA))
sys.path.insert(0, RAIZ)

import motor  # noqa: E402
from pesquisa import harness  # noqa: E402

PROCESSOS = 6
CACHE = os.environ.get("PLANO7_CACHE", os.path.join(tempfile.gettempdir(), "plano7_cache"))
FOREX = ["EURUSD", "USDJPY", "GBPUSD", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD"]
ACOES = ["PETR4", "VALE3", "ITUB4", "BBDC4", "AXIA3", "BBAS3", "SBSP3", "PETR3", "EMBJ3", "PRIO3", "RENT3", "EQTL3"]
GRUPOS = {"ACOES12": ACOES}
MODULOS = {"sofia": "traders.sofia_smc", "didi": "traders.didi_agulhada", "caio": "traders.caio_contrafluxo"}
MERCADOS = {"sofia": [("WDO", 5), ("WIN", 5), ("BTCUSDT", 5)] + [(a, tf) for tf in (5, 15) for a in FOREX]
                     + [("ACOES12", 60)]}
MERCADOS["didi"] = MERCADOS["sofia"]
MERCADOS["caio"] = [("WDO", 5), ("WIN", 5), ("BTCUSDT", 5)]
ANTES_CFG = {"rr_minimo": 1.0, "max_contratos": 5}  # config do Plano 6
DEPOIS_CFG = {}  # o config do usuário (rr_minimo 3, max_contratos 50)
# Caio no BTC (Plano 6, sem padrão no PARAMS): limite pelo percentil 95, região US$ 30, folga US$ 10 (1.000 ticks).
# Plano 7: o stop dobra (2 → 4 ticks no WDO/WIN), então no BTC a folga vai de US$ 10 para US$ 20.
CAIO_BTC = {"limite_pct": 95, "regiao_ticks": 3000}
# padrão do Didi no Plano 6 (entrada e saída), sobre o código novo
DIDI_ANTES = {"folga_stop_ticks": 1, "alvo_x": 3.0, "saida": "bandas", "agulhada_n": 0, "janela_bandas": 3,
              "adx": "sobe", "trix_extremo": 0.2}


def _modulo(slug):
    import importlib
    return importlib.import_module(MODULOS[slug])


def _params(slug, ativo, extra):
    """PARAMS resolvidos para o ativo + extra; o Caio no BTC parte da base da pesquisa do Plano 6."""
    m = _modulo(slug)
    base = {k: (v.get(ativo) if isinstance(v, dict) else v) for k, v in m.PARAMS.items()}
    if slug == "caio" and ativo == "BTCUSDT":
        base.update(CAIO_BTC)
    return {**base, **extra}


def _bloco(slug, params, cfg_extra, ativo, tf, ini, fim, est, validacao=False):
    """Operações e contagem de ordens/recusas de um bloco (com AQUECIMENTO_DIAS antes, como harness.avaliar)."""
    chave = hashlib.sha1(json.dumps([slug, params, cfg_extra, ativo, tf, str(ini), str(fim), est], sort_keys=True,
                                    default=str).encode()).hexdigest()[:20]
    caminho = os.path.join(CACHE, chave + ".pkl")
    m = harness._contrato(_modulo(slug))
    if validacao:
        harness._guarda(m, ativo, ini, fim, tf, params, est, True)
    if os.path.exists(caminho):
        with open(caminho, "rb") as f:
            return pickle.load(f)
    cfg = {**harness.config(), **cfg_extra}
    cs = [k for k in harness._serie(ativo, tf) if ini - timedelta(days=harness.AQUECIMENTO_DIAS) <= k.t.date() <= fim]
    ops, cont = [], {"ordem": 0, "block_rr": 0, "block_tamanho": 0, "block_outro": 0}
    sessoes = len({k.t.date() for k in cs if k.t.date() >= ini})
    if cs:
        r = motor.rodar_backtest(ativo, cs, [(m, params)], cfg, minutos=tf, estresse_ticks=est)["traders"][m.NOME]
        ops = [o for o in r["operacoes"] if o["entrada_t"][:10] >= ini.isoformat()]
        stops = {e["t"]: e["stop"] for e in r["eventos"] if e["tipo"] == "entrada"}
        for o in ops:  # R realizado (bruto, em pontos): quanto o trade andou em múltiplos do risco de entrada
            risco = abs(o["entrada"] - stops[o["entrada_t"]])
            o["r"] = round((o["saida"] - o["entrada"]) * (1 if o["lado"] == "compra" else -1) / risco, 3) if risco else None
        for e in r["eventos"]:
            if e["t"][:10] < ini.isoformat() or e["tipo"] not in ("ordem", "block"):
                continue
            if e["tipo"] == "ordem":
                cont["ordem"] += 1
            else:
                txt = " ".join(e["motivos"])
                cont["block_rr" if "risco:retorno" in txt else
                     "block_tamanho" if "nem 1 contrato" in txt or "acima do limite por trade" in txt else
                     "block_outro"] += 1
    custo = sum(2 * cfg["ativos"][ativo]["custo_por_contrato"] * o["contratos"] for o in ops)
    out = {"ops": ops, "sessoes": sessoes, "custo": custo, **cont}
    os.makedirs(CACHE, exist_ok=True)
    with open(caminho, "wb") as f:
        pickle.dump(out, f)
    return out


def _janelas(slug, ativo, parte="desenvolvimento"):
    m = _modulo(slug)
    return [(membro, ini, fim) for membro in GRUPOS.get(ativo, [ativo])
            for ini, fim in harness.blocos(*harness.divisao(membro, m.NOME)[parte])]


def resumo(partes, ativo):
    """Métricas do conjunto de blocos (sem e com estresse) + frequência, contratos e custo."""
    ops = [o for p in partes for o in p["ops"]]
    met = {k: v for k, v in harness.metricas(ops).items() if k != "por_mes"}
    sessoes = sum(p["sessoes"] for p in partes)
    saidas = {}
    for o in ops:
        saidas[o["motivo_saida"]] = saidas.get(o["motivo_saida"], 0) + 1
    rr = [o["r"] for o in ops if o.get("r") is not None]
    return {**met, "sessoes": sessoes,
            "r_medio": round(sum(rr) / len(rr), 2) if rr else None,
            "pct_3r": round(sum(x >= 3 for x in rr) / len(rr), 3) if rr else None,
            "r_ganho_medio": round(sum(x for x in rr if x > 0) / max(1, sum(x > 0 for x in rr)), 2) if rr else None,
            "r_perda_media": round(sum(x for x in rr if x <= 0) / max(1, sum(x <= 0 for x in rr)), 2) if rr else None, "trades_por_sessao": round(len(ops) / sessoes, 3) if sessoes else None,
            "contratos_medio": round(sum(o["contratos"] for o in ops) / len(ops), 2) if ops else None,
            "custo": round(sum(p["custo"] for p in partes), 2), "saidas": saidas,
            **{k: sum(p[k] for p in partes) for k in ("ordem", "block_rr", "block_tamanho", "block_outro")}}


def rodar(variantes, nome_etapa, parte="desenvolvimento", validacao=False):
    """variantes: [(nome, slug, extra_params, cfg_extra, [(ativo, tf), ...])]."""
    tarefas, chaves = [], []
    for nome, slug, extra, cfg_extra, mercados in variantes:
        for ativo, tf in mercados:
            for membro, ini, fim in _janelas(slug, ativo, parte):
                for e in (0, 1):
                    tarefas.append((slug, _params(slug, membro, extra), cfg_extra, membro, tf, ini, fim, e, validacao))
                    chaves.append((slug, nome, ativo, tf, e))
    # os mais pesados (BTC) primeiro, para dividir a carga
    ordem = sorted(range(len(tarefas)), key=lambda i: tarefas[i][3] != "BTCUSDT")
    res = [None] * len(tarefas)
    if validacao:  # em série: o validacao.csv do harness perde linhas com escrita concorrente
        for i in ordem:
            res[i] = _bloco(*tarefas[i])
    else:
        with ProcessPoolExecutor(PROCESSOS) as ex:
            for i, r in zip(ordem, ex.map(_bloco, *zip(*[tarefas[i] for i in ordem]), chunksize=1)):
                res[i] = r
    grupos = {}
    for k, r in zip(chaves, res):
        grupos.setdefault(k, []).append(r)
    saida = []
    for nome, slug, extra, cfg_extra, mercados in variantes:
        for ativo, tf in mercados:
            r0, r1 = (resumo(grupos[(slug, nome, ativo, tf, e)], ativo) for e in (0, 1))
            m = _modulo(slug)
            de, ate = harness.divisao(GRUPOS.get(ativo, [ativo])[0], m.NOME)[parte]
            lin = harness.linha(f"{slug}: {nome}", {**r0, "ativo": ativo, "tf": tf, "de": de.isoformat(),
                                                    "ate": ate.isoformat(), "params": {**extra, **cfg_extra}},
                                {**r1}, nota=f"{nome_etapa} {parte}", validacao=validacao)
            harness.registrar("plano7", lin)
            saida.append({"etapa": nome_etapa, "parte": parte, "variante": nome, "trader": slug, "ativo": ativo,
                          "tf": tf, "params": extra, "cfg": cfg_extra, "veredito": lin["veredito"],
                          "sem": r0, "com": r1})
            print(f"{slug:<5} {nome:<22} {ativo:<8}{tf:>3} {r0['trades']:>5} tr {r0['resultado']:>10.2f} "
                  f"PF {r0['fator_lucro']} payoff {r0['payoff']} acerto {r0['acerto']:.2f} | est "
                  f"{r1['resultado']:>10.2f} PF {r1['fator_lucro']} | tr/sessão {r0['trades_por_sessao']} "
                  f"contr {r0['contratos_medio']} rr-bloq {r0['block_rr']} {lin['veredito']}", flush=True)
    with open(os.path.join(PASTA, f"{nome_etapa}.json"), "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, indent=1, default=str)
    return saida


def _todos(slug):
    return MERCADOS[slug]


def antes_depois():
    v = [("antes", "sofia", {}, ANTES_CFG, _todos("sofia")), ("depois", "sofia", {}, DEPOIS_CFG, _todos("sofia")),
         ("antes", "didi", DIDI_ANTES, ANTES_CFG, _todos("didi")), ("depois", "didi", {}, DEPOIS_CFG, _todos("didi")),
         ("antes", "caio", {"folga_ticks": 2}, ANTES_CFG, [("WDO", 5), ("WIN", 5)]),
         ("depois", "caio", {}, DEPOIS_CFG, [("WDO", 5), ("WIN", 5)]),
         ("antes", "caio", {"folga_ticks": 1000}, ANTES_CFG, [("BTCUSDT", 5)]),
         ("depois", "caio", {"folga_ticks": 2000}, DEPOIS_CFG, [("BTCUSDT", 5)])]
    return v


def sensibilidade():
    """Stop do Didi 2–5 e do Caio 3–6 (vizinhos do padrão novo), e a frequência do Didi com o TRIX 0,2 e 1,0."""
    v = [(f"stop {x}", "didi", {"folga_stop_ticks": x}, DEPOIS_CFG, _todos("didi")) for x in (2, 4, 5)]
    # frequência: o TRIX do Plano 6 (0,2), o do Diretor (0,3, o padrão) e só a direção (1,0)
    v += [(f"trix {x}", "didi", {"trix_extremo": x}, DEPOIS_CFG, _todos("didi")) for x in (0.2, 1.0)]
    v += [("saida bb ou adx", "didi", {"saida": "bb_ou_adx"}, DEPOIS_CFG, _todos("didi"))]
    v += [(f"stop {x}", "caio", {"folga_ticks": x}, DEPOIS_CFG, [("WDO", 5), ("WIN", 5)]) for x in (3, 5, 6)]
    v += [(f"stop {x // 500}", "caio", {"folga_ticks": x}, DEPOIS_CFG, [("BTCUSDT", 5)]) for x in (1500, 2500, 3000)]
    return v


def plato():
    """Vizinhos de ±1 passo de quem passou nas regras do desenvolvimento (Sofia no EURUSD 15: folga_ticks 1 e 3)."""
    return [(f"folga {x}", "sofia", {"folga_ticks": x}, DEPOIS_CFG, [("EURUSD", 15)]) for x in (1, 3)]


ETAPAS = {"antes_depois": antes_depois, "sensibilidade": sensibilidade, "plato": plato}

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    t = time.time()
    if sys.argv[1] == "validar":
        slug, ativo, tf, nome = sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5]
        todas = {(n, s): (e, c) for n, s, e, c, _ in antes_depois() + sensibilidade() + plato()}
        extra, cfg_extra = todas[(nome, slug)]
        rodar([(nome, slug, extra, cfg_extra, [(ativo, tf)])], f"validacao_{slug}_{ativo}_{tf}", "validacao", True)
    else:
        rodar(ETAPAS[sys.argv[1]](), sys.argv[1])
    print(f"{time.time() - t:.0f} s")

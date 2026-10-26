"""Pesquisa do Didi (Plano 6): roda candidatos × blocos de 3 meses × estresse 0/1 em até 4 processos, guarda as
operações em cache (pesquisa/didi/cache/, fora do git) e monta o desenvolvimento inteiro (soma dos blocos) e o
walk-forward (mesmo critério do harness) a partir dos blocos.

    python pesquisa/didi/rodar.py <etapa>      # etapas em ETAPAS, no fim do arquivo
"""
import hashlib
import json
import os
import pickle
import sys
from concurrent.futures import ProcessPoolExecutor

PASTA = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(PASTA)))

import gerente  # noqa: E402
from pesquisa import harness  # noqa: E402
from traders import didi_agulhada  # noqa: E402

CACHE = os.path.join(PASTA, "cache")
FOREX = ["EURUSD", "USDJPY", "GBPUSD", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD"]
ACOES = ["PETR4", "VALE3", "ITUB4", "BBDC4", "AXIA3", "BBAS3", "SBSP3", "PETR3", "EMBJ3", "PRIO3", "RENT3", "EQTL3"]


def _chave(params, ativo, tf, de, ate, est):
    regras = harness.config()["ativos"][ativo]
    dorme = [regras.get("zerar_no_dia", True), regras.get("max_pregoes")]  # posição de vários dias muda o resultado
    s = json.dumps([params, ativo, tf, str(de), str(ate), est] + ([] if dorme == [True, None] else [dorme]),
                   sort_keys=True)
    return hashlib.sha1(s.encode()).hexdigest()[:16]


def _rodar(args):
    params, ativo, tf, de, ate, est = args
    caminho = os.path.join(CACHE, _chave(*args) + ".pkl")
    if os.path.exists(caminho):
        with open(caminho, "rb") as f:
            return pickle.load(f)
    ops = harness.avaliar(didi_agulhada, params, ativo, de, ate, est, tf)["operacoes"]
    with open(caminho, "wb") as f:
        pickle.dump(ops, f)
    return ops


def blocos(ativo):
    de, ate = harness.divisao(ativo, didi_agulhada.NOME)["desenvolvimento"]
    return harness.blocos(de, ate, 3)


def rodar(cands, mercados):
    """{(i_cand, ativo, tf, est): [ops por bloco]} para cada candidato (dict de params completos)."""
    os.makedirs(CACHE, exist_ok=True)
    tarefas = [(c, a, tf, b0, b1, e) for c in cands for a, tf in mercados for b0, b1 in blocos(a) for e in (0, 1)]
    with ProcessPoolExecutor(max_workers=4) as ex:
        res = list(ex.map(_rodar, tarefas, chunksize=1))
    out = {}
    for (c, a, tf, _, _, e), ops in zip(tarefas, res):
        out.setdefault((cands.index(c), a, tf, e), []).append(ops)
    return out


def completo(params):
    return {**{k: (v.get("WDO") if isinstance(v, dict) else v) for k, v in didi_agulhada.PARAMS.items()}, **params}


def walk_forward(por_bloco, n_cands, min_trades=gerente.MIN_TRADES):
    """O mesmo critério de harness.walk_forward: para o bloco k, o candidato de maior fator de lucro nos blocos 0..k-1
    com ≥ min_trades (ninguém chega: o 1º). por_bloco[j] = lista de ops por bloco do candidato j."""
    oos, escolhas = [], []
    for k in range(1, len(por_bloco[0])):
        treinos = [harness.metricas([o for ops in por_bloco[j][:k] for o in ops]) for j in range(n_cands)]
        validos = [j for j in range(n_cands) if treinos[j]["trades"] >= min_trades]
        j = max(validos, key=lambda j: gerente._fator(treinos[j])) if validos else 0
        escolhas.append(j)
        oos += por_bloco[j][k]
    return oos, escolhas


def registrar(variante, params, ativo, tf, ops0, ops1, nota=""):
    de, ate = harness.divisao(ativo, didi_agulhada.NOME)["desenvolvimento"]
    r = {"params": params, "ativo": ativo, "tf": tf, "de": str(de), "ate": str(ate), **harness.metricas(ops0)}
    r1 = harness.metricas(ops1)
    harness.registrar("didi", harness.linha(variante, r, r1, nota))
    return r, r1


def etapa(nome, cands, mercados, wf=True):
    """Roda, registra cada candidato no desenvolvimento inteiro (soma dos blocos) e o walk-forward; grava a tabela."""
    res = rodar(cands, mercados)
    linhas = []
    for a, tf in mercados:
        for j, c in enumerate(cands):
            o0 = [o for ops in res[(j, a, tf, 0)] for o in ops]
            o1 = [o for ops in res[(j, a, tf, 1)] for o in ops]
            r, r1 = registrar(f"{nome} #{j}", c, a, tf, o0, o1, "dev = soma dos blocos de 3 meses")
            linhas.append((a, tf, f"#{j}", r["trades"], r["resultado"], r["fator_lucro"], r1["resultado"],
                           r1["fator_lucro"]))
        if wf and len(cands) > 1:
            oos0, esc = walk_forward([res[(j, a, tf, 0)] for j in range(len(cands))], len(cands))
            # o fora da amostra com estresse usa as mesmas escolhas (feitas sem estresse)
            oos1 = [o for k, j in enumerate(esc, 1) for o in res[(j, a, tf, 1)][k]]
            r, r1 = registrar(f"{nome} walk-forward", {"escolhas": esc}, a, tf, oos0, oos1,
                              "fora da amostra do walk-forward (blocos 2..n), escolhido pelo PF dos anteriores")
            linhas.append((a, tf, "WF", r["trades"], r["resultado"], r["fator_lucro"], r1["resultado"],
                           r1["fator_lucro"], esc))
    with open(os.path.join(PASTA, f"etapa_{nome}.txt"), "w", encoding="utf-8") as f:
        for i, c in enumerate(cands):
            f.write(f"#{i} {json.dumps(c, sort_keys=True)}\n")
        for l in linhas:
            f.write("  ".join(str(x) for x in l) + "\n")
    return res, linhas


ETAPAS = {}


def _etapa(f):
    ETAPAS[f.__name__] = f
    return f


@_etapa
def diag():
    """Quantos trades cada afrouxamento libera (WDO, WIN, EURUSD 5)."""
    base = completo({})
    cands = [base, {**base, "trix_extremo": 1.0}, {**base, "adx": "di"}, {**base, "trix_extremo": 1.0, "adx": "di"},
             {**base, "trix_extremo": 1.0, "adx": "nao"}, {**base, "trix_extremo": 1.0, "adx": "nao", "agulhada_n": 2}]
    etapa("diag", cands, [("WDO", 5), ("WIN", 5), ("EURUSD", 5)], wf=False)


@_etapa
def recuo():
    """H: entrar no recuo (Fibonacci) do candle que abriu as bandas, como nas notas do Diretor, em vez de comprar
    no fechamento do candle esticado (metade dos trades a mercado parava no próprio candle de entrada)."""
    base = completo({"trix_extremo": 1.0})
    cands = [{**base, "recuo": r, "agulhada_n": n, "adx": a}
             for a in ("sobe", "nao") for n in (0, 2) for r in (0, 0.382, 0.5, 0.618)]
    etapa("recuo", cands, [("WDO", 5), ("WIN", 5), ("EURUSD", 5)])


@_etapa
def contexto():
    """H1: só a favor da tendência do 60 (contexto maior) corta as agulhadas contra o fluxo. H2: exigir compressão
    (ADX ≤ 20 antes da agulhada e subindo nela, notas do Diretor) separa rompimento de ruído. H3: sair só com a MA3
    voltando (sem a saída das bandas fechando) deixa o movimento correr até o alvo."""
    base = completo({"trix_extremo": 1.0})
    cands = [{**base, "agulhada_n": n, "adx": a, "tendencia": t, "saida": s}
             for t in (False, True) for a in ("nao", "baixo") for s in ("bandas", "ma3") for n in (0, 2)]
    etapa("contexto", cands, [("WDO", 5), ("WIN", 5), ("EURUSD", 5)])


def _amplos():
    """Os mesmos 7 candidatos em todos os mercados: o padrão e os afrouxamentos mais fiéis às notas do Diretor."""
    b = completo({"trix_extremo": 1.0})
    return [completo({}),                                                   # 0 padrão (TRIX 20/80, ADX subindo)
            {**b, "adx": "sobe"},                                           # 1 TRIX só direção
            {**b, "adx": "nao"},                                            # 2 + sem ADX
            {**b, "adx": "nao", "agulhada_n": 2},                           # 3 + cruzamentos em até 2 candles
            {**b, "adx": "nao", "tendencia": True},                         # 4 sem ADX, a favor do contexto
            {**b, "adx": "nao", "agulhada_n": 2, "tendencia": True},        # 5 idem com folga de 2
            {**b, "adx": "sobe", "agulhada_n": 2, "tendencia": True, "saida": "ma3"}]  # 6 ADX sobe, contexto, MA3


@_etapa
def acoes_forex15():
    etapa("acoes_forex15", _amplos(), [(a, 60) for a in ACOES] + [(a, 15) for a in FOREX])


@_etapa
def forex5_btc():
    etapa("forex5_btc", _amplos(), [(a, 5) for a in FOREX[1:]] + [("BTCUSDT", 5)])


def vizinhos(c):
    """O candidato e os vizinhos de ±1 passo de agulhada_n, janela_bandas e alvo_x (platô)."""
    out = [c]
    for k, passo in (("agulhada_n", 1), ("janela_bandas", 1), ("alvo_x", 1.0)):
        out += [{**c, k: c[k] - passo}, {**c, k: c[k] + passo}]
    return out


@_etapa
def plato15():
    """Platô do candidato 5 (sem ADX, folga de 2, a favor do 60) nos pares em que ele passou de PF 1,15 no 15."""
    etapa("plato15", vizinhos(_amplos()[5]), [(a, 15) for a in ("NZDUSD", "GBPUSD", "USDJPY")], wf=False)


def carteira(nome, cands, wf=True):
    """As 12 ações no 60 como uma carteira (cada ação sozinha não chega a 100 trades em 2,3 anos): registra cada ação e
    a soma ("ACOES12"), com o walk-forward feito sobre a carteira."""
    res = rodar(cands, [(a, 60) for a in ACOES])
    nb = len(blocos(ACOES[0]))
    assert all(len(blocos(a)) == nb for a in ACOES)
    pool = {(j, e): [[o for a in ACOES for o in res[(j, a, 60, e)][k]] for k in range(nb)]
            for j in range(len(cands)) for e in (0, 1)}
    linhas = []
    for j, c in enumerate(cands):
        for a in ACOES:
            registrar(f"{nome} #{j}", c, a, 60, [o for b in res[(j, a, 60, 0)] for o in b],
                      [o for b in res[(j, a, 60, 1)] for o in b], "posição de vários dias (máx. 10 pregões)")
        o0, o1 = [o for b in pool[(j, 0)] for o in b], [o for b in pool[(j, 1)] for o in b]
        r, r1 = _registrar_carteira(f"{nome} #{j}", c, o0, o1, "carteira das 12 ações, posição de vários dias")
        pos = sum(harness.metricas([o for b in res[(j, a, 60, 1)] for o in b])["resultado"] > 0 for a in ACOES)
        linhas.append(("ACOES12", 60, f"#{j}", r["trades"], r["resultado"], r["fator_lucro"], r1["resultado"],
                       r1["fator_lucro"], f"{pos}/12 ações + c/ estresse"))
    if wf and len(cands) > 1:
        oos0, esc = walk_forward([pool[(j, 0)] for j in range(len(cands))], len(cands))
        oos1 = [o for k, j in enumerate(esc, 1) for o in pool[(j, 1)][k]]
        r, r1 = _registrar_carteira(f"{nome} walk-forward", {"escolhas": esc}, oos0, oos1,
                                    "carteira: fora da amostra do walk-forward, escolhido pelo PF dos anteriores")
        linhas.append(("ACOES12", 60, "WF", r["trades"], r["resultado"], r["fator_lucro"], r1["resultado"],
                       r1["fator_lucro"], esc))
    with open(os.path.join(PASTA, f"etapa_{nome}.txt"), "w", encoding="utf-8") as f:
        for i, c in enumerate(cands):
            f.write(f"#{i} {json.dumps(c, sort_keys=True)}\n")
        for l in linhas:
            f.write("  ".join(str(x) for x in l) + "\n")


def _registrar_carteira(variante, params, ops0, ops1, nota):
    de, ate = harness.divisao(ACOES[0], didi_agulhada.NOME)["desenvolvimento"]
    r = {"params": params, "ativo": "ACOES12", "tf": 60, "de": str(de), "ate": str(ate), **harness.metricas(ops0)}
    r1 = harness.metricas(ops1)
    harness.registrar("didi", harness.linha(variante, r, r1, nota))
    return r, r1


@_etapa
def acoes_dorme():
    """H: com a posição dormindo (até 10 pregões, como a opção comprada com ≥ 15 dias), a agulhada do 60 tem tempo de
    chegar ao alvo; a saída só pela MA3 deve aproveitar mais do que a das bandas fechando."""
    b = completo({"trix_extremo": 1.0})
    cands = [completo({})] + [{**b, "agulhada_n": n, "adx": a, "tendencia": t, "saida": s}
                              for t in (False, True) for a in ("sobe", "nao") for s in ("bandas", "ma3") for n in (0, 2)]
    carteira("acoes_dorme", cands)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    ETAPAS[sys.argv[1]]()
    print(open(os.path.join(PASTA, f"etapa_{sys.argv[1]}.txt"), encoding="utf-8").read())

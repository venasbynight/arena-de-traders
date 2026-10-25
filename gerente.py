"""Gerente da firma: um ciclo por dia baixa o histórico de cada sala, ajusta os parâmetros de cada trader no
treino, confere na prova, decide o status (promovido, pausado, experiência) e grava o estado e os relatórios.

    python gerente.py                    # ciclo de hoje (o histórico vai até ontem)
    python gerente.py --dia 2026-10-24   # ciclo como se hoje fosse esse dia
"""
import argparse
import json
import os
import queue
import sys
import threading
import time
from datetime import date, datetime, timedelta

import dados
import motor
import relatorio
import traders
from relatorio import brl, num

JANELA_DIAS = 120  # histórico de cada ciclo: os 120 dias-calendário até ontem
PROVA_PREGOES = 21
MIN_TRADES = 50
FATOR_MIN = 1.2
DRAWDOWN_PAUSA = -1500.0
DIAS_NEGATIVOS_PAUSA = 5
DIARIO_LINHAS = 8
TRAVA = threading.Lock()  # dois ciclos nunca rodam ao mesmo tempo (servidor: arranque e 19:30 na mesma thread)


def ler_json(caminho):
    """Conteúdo do JSON, ou {} se o arquivo não existe ou não se lê."""
    try:
        with open(caminho, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _gravar_json(caminho, obj):
    """Grava inteiro ou nada (arquivo temporário + os.replace): o servidor pode ler a qualquer momento."""
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    tmp = caminho + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    for _ in range(20):
        try:
            return os.replace(tmp, caminho)
        except PermissionError:  # Windows: o servidor está com o arquivo aberto neste instante
            time.sleep(0.05)
    os.replace(tmp, caminho)


def dividir(candles):
    """(treino, prova, aviso): prova = últimos 21 pregões presentes nos dados, treino = o resto.

    Com menos de 42 pregões a prova fica com o último terço e o aviso diz isso.
    """
    datas = sorted({k.t.date() for k in candles})
    n = PROVA_PREGOES if len(datas) >= 2 * PROVA_PREGOES else max(1, len(datas) // 3)
    corte = datas[-n]
    aviso = "" if n == PROVA_PREGOES else (f"histórico curto ({len(datas)} pregões): a prova usa o último terço "
                                           f"({n} pregões) em vez de {PROVA_PREGOES}")
    return [k for k in candles if k.t.date() < corte], [k for k in candles if k.t.date() >= corte], aviso


def _rodar(ativo, candles, modulo, params, cfg):
    return motor.rodar_backtest(ativo, candles, [(modulo, params)], cfg)["traders"][modulo.NOME]


def _fator(p):
    """Fator de lucro para comparar: sem perdas e com lucro vale infinito; sem trades, zero."""
    if p["fator_lucro"] is not None:
        return p["fator_lucro"]
    return float("inf") if p["resultado"] > 0 else 0.0


def ajustar(modulo, ativo, treino, cfg):
    """Testa a GRADE do trader no treino, um parâmetro por vez com os outros no padrão.

    Devolve (params, placar no treino) do melhor fator de lucro com ≥ 50 trades; se ninguém chega a 50, o padrão.
    """
    padrao = {k: modulo.PARAMS[k] for k in modulo.GRADE}
    candidatos = [padrao]
    for k, valores in modulo.GRADE.items():
        for v in valores:
            if {**padrao, k: v} not in candidatos:
                candidatos.append({**padrao, k: v})
    testados = [(c, _rodar(ativo, treino, modulo, c, cfg)["placar"]) for c in candidatos]
    validos = [x for x in testados if x[1]["trades"] >= MIN_TRADES]
    return max(validos, key=lambda x: _fator(x[1])) if validos else testados[0]


def _negativos_seguidos(equity):
    """Maior sequência de dias com saldo em queda; dia parado quebra a sequência."""
    pior = seguidos = 0
    for (_, antes), (_, depois) in zip(equity, equity[1:]):
        seguidos = seguidos + 1 if depois < antes else 0
        pior = max(pior, seguidos)
    return pior


def decidir(treino, prova, equity):
    """(status, overfit, decisão em uma linha). A pausa vence a promoção: risco primeiro."""
    overfit = treino["resultado"] > 0 and prova["resultado"] < 0.5 * treino["resultado"]
    nota = f"overfit: prova {brl(prova['resultado'])} é menos de 50% do treino {brl(treino['resultado'])}"
    pausa = []
    if prova["drawdown"] < DRAWDOWN_PAUSA:
        pausa.append(f"drawdown da prova {brl(prova['drawdown'])}, pior que {brl(DRAWDOWN_PAUSA)}")
    seguidos = _negativos_seguidos(equity)
    if seguidos >= DIAS_NEGATIVOS_PAUSA:
        pausa.append(f"{seguidos} dias seguidos negativos na prova")
    if pausa:
        return "pausado", overfit, "pausado: " + "; ".join(pausa + ([nota] if overfit else []))

    faltas = []
    if not prova["trades"]:
        faltas.append("nenhum trade na prova")
    else:
        if prova["resultado"] <= 0:
            faltas.append(f"prova {brl(prova['resultado'])} (precisa ser positiva)")
        if _fator(prova) < FATOR_MIN:
            faltas.append(f"fator {num(prova['fator_lucro'])} na prova (mínimo {num(FATOR_MIN, 1)})")
        if prova["trades"] < MIN_TRADES:
            faltas.append(f"só {prova['trades']} trades na prova (mínimo {MIN_TRADES})")
    if treino["trades"] < MIN_TRADES:
        faltas.append(f"só {treino['trades']} trades no treino (mínimo {MIN_TRADES})")
    if overfit:
        faltas.append(nota)
    if faltas:
        return "experiencia", overfit, "segue em experiência: " + "; ".join(faltas)
    return "promovido", False, (f"promovido: prova {brl(prova['resultado'])}, fator {num(prova['fator_lucro'])} "
                                f"com {prova['trades']} trades e sem overfit")


def _diario(eventos, dia):
    """Linhas de pensamento do dia, com a hora e sem repetir; as últimas 8."""
    linhas, vistas = [], set()
    for e in eventos:
        if e["tipo"] == "pensamento" and e["t"].startswith(dia):
            for l in e["linhas"]:
                if l not in vistas:
                    vistas.add(l)
                    linhas.append(f"{e['t'][11:16]} {l}")
    return linhas[-DIARIO_LINHAS:]


def _avaliar(modulo, ativo, treino, prova, cfg):
    """(registro do trader para o estado, operações da prova)."""
    params, placar_treino = ajustar(modulo, ativo, treino, cfg)
    r = _rodar(ativo, prova, modulo, params, cfg)
    equity = [[prova[0].t.isoformat(), float(cfg["capital"])]] + r["equity"]
    status, overfit, decisao = decidir(placar_treino, r["placar"], equity)
    return ({"nome": modulo.NOME, "estilo": modulo.ESTILO, "status": status, "parametros": params,
             "overfit": overfit, "treino": placar_treino, "prova": r["placar"], "equity": equity,
             "diario": _diario(r["eventos"], prova[-1].t.date().isoformat()), "decisao": decisao},
            r["operacoes"])


def _periodo(candles):
    datas = sorted({k.t.date() for k in candles})
    return {"de": datas[0].isoformat() if datas else "", "ate": datas[-1].isoformat() if datas else "",
            "pregoes": len(datas)}


def _baixar(ativos, historico_fn, de, ate, cfg):
    """Baixa as salas uma a uma numa thread e entrega (ativo, candles, erro) assim que cada uma chega.

    O cálculo de uma sala corre enquanto a próxima baixa (a Genial sem feed leva 90 s para desistir).
    Uma tentativa por sala; erro vira texto para a pendência, nunca repetição.
    """
    fila = queue.Queue()

    def baixar():
        for ativo in ativos:
            try:
                fila.put((ativo, historico_fn(ativo, de, ate, cfg), None))
            except dados.ErroDados as e:
                fila.put((ativo, None, str(e)))
            except Exception as e:  # a thread não pode morrer calada: o ciclo esperaria para sempre
                fila.put((ativo, None, f"erro inesperado ao baixar {ativo}: {e!r}"))

    threading.Thread(target=baixar, daemon=True, name="gerente-downloads").start()
    for _ in ativos:
        yield fila.get()


def ciclo(cfg, hoje, historico_fn=dados.historico, salas=traders.SALAS, raiz=".", log=None):
    """Um ciclo do gerente para o dia `hoje` (histórico até ontem). Grava estado e relatórios; devolve o estado."""
    log = log or (lambda msg: None)
    with TRAVA:
        de, ate = hoje - timedelta(days=JANELA_DIAS), hoje - timedelta(days=1)
        pasta_estado = os.path.join(raiz, "estado")
        anterior = ler_json(os.path.join(pasta_estado, "firma.json")).get("salas", {})
        # quem respondeu no ciclo anterior baixa primeiro; a espera de quem falhou corre junto com o cálculo
        ordem = sorted(salas, key=lambda a: anterior.get(a, {}).get("status") != "ok")
        feitas, operacoes = {}, {}
        for ativo, candles, erro in _baixar(ordem, historico_fn, de, ate, cfg):
            if not candles:
                motivo = erro or f"sem candles entre {de:%d/%m/%Y} e {ate:%d/%m/%Y}"
                feitas[ativo] = {"status": "sem_dados", "motivo": motivo, "traders": []}
                log(f"{ativo}: sem dados ({motivo})")
                continue
            treino, prova, aviso = dividir(candles)
            sala = {"status": "ok", "motivo": aviso, "periodos": {"treino": _periodo(treino), "prova": _periodo(prova)},
                    "traders": []}
            log(f"{ativo}: {len(candles)} candles; treino {sala['periodos']['treino']['pregoes']} pregões, "
                f"prova {sala['periodos']['prova']['pregoes']}")
            for m in salas[ativo]:
                t, ops = _avaliar(m, ativo, treino, prova, cfg)
                sala["traders"].append(t)
                operacoes[(ativo, m.NOME)] = ops
                log(f"  {m.NOME}: {t['status']}")
            feitas[ativo] = sala

        salas_estado = {a: feitas[a] for a in salas}
        ranking = sorted(({"sala": a, "nome": t["nome"], "prova_resultado": t["prova"]["resultado"]}
                          for a, s in salas_estado.items() for t in s["traders"]),
                         key=lambda r: -r["prova_resultado"])
        pendencias = [f"{a}: {s['motivo']}" for a, s in salas_estado.items() if s["status"] != "ok"]
        pendencias += [f"{t['nome']} ({a}) {t['decisao']}" for a, s in salas_estado.items()
                       for t in s["traders"] if t["status"] == "pausado"]
        estado = {"gerado_em": datetime.now(motor.size.BRT).replace(tzinfo=None).isoformat(timespec="seconds"),
                  "dia": hoje.isoformat(),
                  "premissas": {"capital": cfg["capital"], "usd_brl": cfg.get("usd_brl"), "janela_dias": JANELA_DIAS,
                                "prova_pregoes": PROVA_PREGOES},
                  "salas": salas_estado, "ranking": ranking, "pendencias": pendencias}

        relatorio.escrever(estado, operacoes, os.path.join(raiz, "relatorios", hoje.isoformat()))
        caminho_params = os.path.join(pasta_estado, "parametros.json")
        parametros = ler_json(caminho_params)  # sala sem dados hoje fica com os parâmetros do último ciclo bom
        for a, s in salas_estado.items():
            if s["status"] == "ok":
                parametros[a] = {t["nome"]: t["parametros"] for t in s["traders"]}
        _gravar_json(caminho_params, parametros)
        _gravar_json(os.path.join(pasta_estado, "firma.json"), estado)
        return estado


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="Roda um ciclo do gerente da firma.")
    ap.add_argument("--dia", type=date.fromisoformat, help="AAAA-MM-DD (padrão: hoje em Brasília)")
    hoje = ap.parse_args().dia or datetime.now(motor.size.BRT).date()
    inicio = time.time()
    estado = ciclo(motor.carregar_config(), hoje, log=lambda msg: print(msg, flush=True))
    print()
    for ativo, sala in estado["salas"].items():
        if sala["status"] != "ok":
            print(f"{ativo}: sem dados — {sala['motivo']}")
            continue
        print(f"{ativo}:" + (f" ({sala['motivo']})" if sala["motivo"] else ""))
        for t in sala["traders"]:
            tr, pr = t["treino"], t["prova"]
            print(f"  {t['nome']}: {t['status']} · treino {brl(tr['resultado'])} em {tr['trades']} trades · "
                  f"prova {brl(pr['resultado'])} em {pr['trades']} trades · {t['decisao']}")
    print("\nPendências:" if estado["pendencias"] else "\nPendências: nenhuma")
    for p in estado["pendencias"]:
        print(f"  - {p}")
    print(f"\nCiclo de {hoje} em {time.time() - inicio:.0f} s; estado em estado/firma.json, relatórios em relatorios/{hoje}/")


if __name__ == "__main__":
    main()

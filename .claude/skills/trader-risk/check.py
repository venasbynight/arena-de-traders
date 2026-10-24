#!/usr/bin/env python3
"""trader-risk para os mini contratos da B3 (WDO e WIN). Só biblioteca padrão, sem rede.

Confere cada ordem de trader/orders.json contra as regras (trader/config.json)
e o que já aconteceu hoje (trader/state/dia.json). Cada ordem recebe PASS ou
BLOCK com o motivo. As ordens são conferidas em sequência, como se cada PASS
tivesse executado, para pegar um lote que estoura um limite junto.

    python check.py                          # grava trader/state/risk.json
    python check.py --now "2026-10-24 10:15" # fixa o relógio (horário de Brasília)
    python check.py --json --no-write
    python check.py --teste                  # autoteste

Entrada x saída: uma ENTRADA abre posição. Uma SAÍDA ("saida": true) só zera
o que existe. Sair tem que ser sempre possível, então a saída só é conferida
no formato; nenhum limite do dia bloqueia uma saída.

Código 0 quando tudo passa, 1 quando alguma ordem é bloqueada.
Adaptado de github.com/Jakeschincariol/day-trader-skill (licença MIT).
"""
import argparse
import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# valor do ponto por contrato e menor variação (tick) de cada mini contrato da B3
ATIVOS = {"WDO": {"ponto_rs": 10.0, "tick": 0.5}, "WIN": {"ponto_rs": 0.20, "tick": 5.0}}
# ponytail: Brasil sem horário de verão desde 2019, então UTC-3 fixo dispensa o pacote tzdata.
BRT = timezone(timedelta(hours=-3))
DIA_VAZIO = {"trades": 0, "stops": 0, "resultado": 0.0, "posicao_aberta": False}


def ler_json(caminho, padrao=None):
    p = Path(caminho)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else padrao


def impressao(ordem):
    return hashlib.sha256(json.dumps(ordem, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def no_tick(preco, tick):
    return abs(preco / tick - round(preco / tick)) < 1e-9


def hhmm(texto):
    return datetime.strptime(texto, "%H:%M").time() if texto else None


def janela(agora, cfg):
    """Motivo do bloqueio pelo horário, ou None."""
    if agora.weekday() >= 5:
        return "mercado fechado (fim de semana)"
    if agora.date().isoformat() in cfg.get("feriados", []):
        return "mercado fechado (feriado na B3)"
    antes, depois = hhmm(cfg.get("sem_entrada_antes")), hhmm(cfg.get("sem_entrada_depois"))
    hora = agora.time()
    if antes and hora < antes:
        return f"antes de {cfg['sem_entrada_antes']}, sem entradas"
    if depois and hora > depois:
        return f"depois de {cfg['sem_entrada_depois']}, sem entradas"
    return None


def formato(o, tick):
    erros = []
    if not str(o.get("simbolo", "")).strip():
        erros.append("ordem sem símbolo")
    if o.get("lado") not in ("compra", "venda"):
        erros.append("lado deve ser 'compra' ou 'venda'")
    if not isinstance(o.get("contratos"), int) or o["contratos"] < 1:
        erros.append("contratos deve ser um número inteiro de 1 para cima")
    if o.get("tipo") not in ("mercado", "limite"):
        erros.append("tipo deve ser 'mercado' ou 'limite'")
    for campo in ("entrada", "stop", "alvo"):
        v = o.get(campo)
        if v is not None and (not isinstance(v, (int, float)) or (tick and not no_tick(v, tick))):
            erros.append(f"{campo} {v} fora do tick de {tick:g} ponto(s)")
    return erros


def checar(ordens, cfg, dia, agora):
    hoje = agora.date().isoformat()
    if not dia or dia.get("data") != hoje:
        dia = dict(DIA_VAZIO, data=hoje)
    trades, stops, posicao = dia["trades"], dia["stops"], dia["posicao_aberta"]
    perda_dia = max(0.0, -float(dia["resultado"]))  # só o que já se perdeu hoje
    resultados = []

    for n, o in enumerate(ordens, 1):
        raiz = str(o.get("simbolo", "")).upper()[:3]
        spec, regras = ATIVOS.get(raiz), cfg.get("ativos", {}).get(raiz)
        motivos, avisos, info = formato(o, spec and spec["tick"]), [], {}
        if o.get("saida"):
            if not motivos:
                posicao = False
            resultados.append({"n": n, "ordem": o, "ok": not motivos, "motivos": motivos,
                               "avisos": avisos, "info": info, "impressao": impressao(o)})
            continue

        if not spec or not regras:
            motivos.append(f"{o.get('simbolo')} não está em 'ativos' do config")
        if o.get("stop") is None:
            motivos.append("ordem sem stop")
        if o.get("alvo") is None:
            motivos.append("ordem sem alvo")

        if not motivos:
            sinal = 1 if o["lado"] == "compra" else -1
            risco_pts = (o["entrada"] - o["stop"]) * sinal
            ganho_pts = (o["alvo"] - o["entrada"]) * sinal
            perda = o["contratos"] * (risco_pts * spec["ponto_rs"] + 2 * regras["custo_por_contrato"])
            info = {"risco_pts": risco_pts, "perda_max_rs": round(perda, 2)}
            if risco_pts <= 0:
                motivos.append("stop do lado errado da entrada")
            elif ganho_pts <= 0:
                motivos.append("alvo do lado errado da entrada")
            else:
                rr = ganho_pts / risco_pts
                info["rr"] = round(rr, 2)
                if rr < cfg["rr_minimo"]:
                    motivos.append(f"risco:retorno {rr:.2f} abaixo do mínimo {cfg['rr_minimo']}")
                if perda > cfg["max_perda_por_trade"]:
                    motivos.append(f"perda no stop R$ {perda:.2f} acima do limite por trade "
                                   f"R$ {cfg['max_perda_por_trade']:.2f}")
                if perda_dia + perda > cfg["max_perda_dia"]:
                    motivos.append(f"perda do dia iria a R$ {perda_dia + perda:.2f}, "
                                   f"acima do limite diário R$ {cfg['max_perda_dia']:.2f}")
            if o["contratos"] > cfg["max_contratos"]:
                motivos.append(f"{o['contratos']} contratos acima do máximo {cfg['max_contratos']}")
            margem = o["contratos"] * regras["margem_por_contrato"]
            if margem > cfg["capital"]:
                motivos.append(f"margem R$ {margem:.2f} acima do capital R$ {cfg['capital']:.2f}")

        if posicao:
            motivos.append("já existe posição aberta; uma operação por vez")
        if stops >= cfg["max_stops_dia"]:
            motivos.append(f"já foram {stops} stops hoje (limite {cfg['max_stops_dia']}); dia encerrado")
        if trades >= cfg["max_trades_dia"]:
            motivos.append(f"já foram {trades} trades hoje (limite {cfg['max_trades_dia']})")
        motivo_hora = janela(agora, cfg)
        if motivo_hora:
            motivos.append(motivo_hora)
        if not cfg.get("simulado", True):
            avisos.append("CONTA REAL: simulado está false no config")
        avisos.append("stop é ordem, não promessa: em mercado rápido pode executar pior")

        info.update({"trades_antes": trades, "stops_antes": stops, "perda_dia_antes": round(perda_dia, 2)})
        if not motivos:
            trades += 1
            posicao = True
            perda_dia += info.get("perda_max_rs", 0.0)  # pior caso para o resto do lote
        resultados.append({"n": n, "ordem": o, "ok": not motivos, "motivos": motivos,
                           "avisos": avisos, "info": info, "impressao": impressao(o)})
    return resultados


def relatorio(resultados, cfg, agora):
    linhas = []
    for r in resultados:
        o, i = r["ordem"], r["info"]
        tipo = "saída" if o.get("saida") else "entrada"
        linhas.append(f"{'PASS ' if r['ok'] else 'BLOCK'} #{r['n']} {o.get('lado')} "
                      f"{o.get('contratos')} {o.get('simbolo')}, {tipo}")
        if "perda_max_rs" in i:
            linhas.append(f"          entrada {o['entrada']:g}, stop {o['stop']:g}, alvo {o['alvo']:g}: "
                          f"{i['risco_pts']:g} pontos de risco")
            linhas.append(f"          perda máxima R$ {i['perda_max_rs']:.2f} "
                          f"(limite R$ {cfg['max_perda_por_trade']:.2f}), risco:retorno {i.get('rr', '-')} "
                          f"(mínimo {cfg['rr_minimo']})")
        if "trades_antes" in i:
            linhas.append(f"          hoje antes desta: {i['trades_antes']} de {cfg['max_trades_dia']} trades, "
                          f"{i['stops_antes']} de {cfg['max_stops_dia']} stops, "
                          f"R$ {i['perda_dia_antes']:.2f} de R$ {cfg['max_perda_dia']:.2f} de perda")
        linhas += [f"        - {m}" for m in r["motivos"]]
        linhas += [f"        ! {a}" for a in r["avisos"]]
    ok = sum(r["ok"] for r in resultados)
    linhas.append(f"\n{ok} passou(aram), {len(resultados) - ok} bloqueada(s) em "
                  f"{agora:%Y-%m-%d %H:%M} (Brasília).")
    return "\n".join(linhas)


def teste():
    cfg = {"capital": 5000, "max_contratos": 5,
           "ativos": {"WDO": {"margem_por_contrato": 150, "custo_por_contrato": 0.5},
                      "WIN": {"margem_por_contrato": 100, "custo_por_contrato": 0.25}},
           "max_perda_por_trade": 100, "max_perda_dia": 300, "max_trades_dia": 10, "max_stops_dia": 3,
           "rr_minimo": 1.0, "sem_entrada_antes": "09:05", "sem_entrada_depois": "18:00",
           "feriados": ["2026-11-20"], "simulado": True}
    sexta = datetime(2026, 10, 23, 10, 15, tzinfo=BRT)
    ordem = {"simbolo": "WDOX26", "lado": "compra", "contratos": 2, "tipo": "limite",
             "entrada": 5432.5, "stop": 5428.0, "alvo": 5441.0}
    r = checar([ordem], cfg, None, sexta)[0]
    assert r["ok"] and r["info"]["perda_max_rs"] == 92.0, r

    def bloqueia(ordens, trecho, dia=None, agora=sexta):
        r = checar(ordens, cfg, dia, agora)[-1]
        assert not r["ok"] and any(trecho in m for m in r["motivos"]), (trecho, r["motivos"])

    bloqueia([dict(ordem, contratos=3)], "acima do limite por trade")
    bloqueia([dict(ordem, stop=5433.0)], "stop do lado errado")
    bloqueia([dict(ordem, alvo=5434.0)], "risco:retorno")
    bloqueia([dict(ordem, stop=None)], "sem stop")
    bloqueia([dict(ordem, entrada=5432.3)], "fora do tick")
    bloqueia([dict(ordem, simbolo="PETR4")], "não está em 'ativos'")
    win = {"simbolo": "WINZ26", "lado": "venda", "contratos": 4, "tipo": "limite",
           "entrada": 128500.0, "stop": 128600.0, "alvo": 128300.0}
    r = checar([win], cfg, None, sexta)[0]
    assert r["ok"] and r["info"]["perda_max_rs"] == 82.0, r  # 4 x (100 x 0,20 + 0,50)
    bloqueia([dict(win, entrada=128502.0)], "fora do tick")
    bloqueia([dict(ordem, contratos=1)], "3 stops hoje",
             dia={"data": "2026-10-23", "trades": 3, "stops": 3, "resultado": -138, "posicao_aberta": False})
    bloqueia([dict(ordem)], "limite diário",
             dia={"data": "2026-10-23", "trades": 2, "stops": 2, "resultado": -250, "posicao_aberta": False})
    bloqueia([ordem, dict(ordem, lado="venda", stop=5437.0, alvo=5424.0)], "posição aberta")
    bloqueia([ordem], "antes de 09:05", agora=sexta.replace(hour=9, minute=0))
    bloqueia([ordem], "fim de semana", agora=datetime(2026, 10, 24, 10, 15, tzinfo=BRT))
    bloqueia([ordem], "feriado", agora=datetime(2026, 11, 20, 10, 15, tzinfo=BRT))
    # dia de ontem não conta hoje
    assert checar([ordem], cfg, {"data": "2026-10-22", "trades": 9, "stops": 3, "resultado": -300,
                                 "posicao_aberta": True}, sexta)[0]["ok"]
    # saída nunca é bloqueada por limite do dia nem por horário
    saida = {"simbolo": "WDOX26", "lado": "venda", "contratos": 2, "tipo": "mercado", "saida": True}
    assert checar([saida], cfg, {"data": "2026-10-23", "trades": 9, "stops": 3, "resultado": -500,
                                 "posicao_aberta": True}, sexta.replace(hour=18, minute=20))[0]["ok"]
    print("trader-risk: autoteste ok")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Confere ordens de WDO/WIN contra os seus limites.")
    ap.add_argument("--orders", default="trader/orders.json")
    ap.add_argument("--config", default="trader/config.json")
    ap.add_argument("--dia", default="trader/state/dia.json")
    ap.add_argument("--saida", default="trader/state/risk.json")
    ap.add_argument("--now", help='fixa o relógio, "AAAA-MM-DD HH:MM" (horário de Brasília)')
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--no-write", action="store_true", help="confere sem gravar os veredictos")
    ap.add_argument("--teste", action="store_true", help="roda o autoteste")
    a = ap.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")  # console do Windows não é UTF-8
    if a.teste:
        teste()
        return 0

    agora = (datetime.strptime(a.now, "%Y-%m-%d %H:%M").replace(tzinfo=BRT) if a.now else datetime.now(BRT))
    cfg, ordens = ler_json(a.config), ler_json(a.orders)
    if cfg is None or ordens is None:
        print(f"faltou arquivo: {a.config if cfg is None else a.orders}")
        return 1
    if isinstance(ordens, dict):
        ordens = [ordens]
    resultados = checar(ordens, cfg, ler_json(a.dia), agora)

    if not a.no_write:
        Path(a.saida).parent.mkdir(parents=True, exist_ok=True)
        Path(a.saida).write_text(json.dumps(
            {"data": agora.date().isoformat(),
             "veredictos": [{"impressao": r["impressao"], "ok": r["ok"], "motivos": r["motivos"]}
                            for r in resultados]},
            ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(resultados, ensure_ascii=False, indent=2) if a.json else relatorio(resultados, cfg, agora))
    return 0 if all(r["ok"] for r in resultados) else 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""trader-budget para os mini contratos da B3 (WDO e WIN) e ativos extras do config (EURUSD, BTCUSDT). Só biblioteca padrão, sem rede.

Lê o plano (trader/plan.json) e as regras (trader/config.json), calcula
quantos contratos cabem nos seus limites e propõe UMA ordem em
trader/orders.json. Não manda ordem para lugar nenhum.

    python size.py                         # mostra o cálculo
    python size.py --write                 # grava trader/orders.json
    python size.py --limite 5432.5 --json  # ordem limitada nesse preço
    python size.py --now "2026-10-24 10:15"
    python size.py --teste                 # autoteste

Adaptado de github.com/Jakeschincariol/day-trader-skill (licença MIT).
"""
import argparse
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# padrões do valor do ponto por contrato e do tick de WDO e WIN; o config (ativos) sobrescreve e acrescenta outros
ATIVOS = {"WDO": {"ponto_rs": 10.0, "tick": 0.5}, "WIN": {"ponto_rs": 0.20, "tick": 5.0}}
# sessão padrão (horário de Brasília) quando o ativo não traz "sessao": a da B3, que respeita os feriados do config
SESSAO_B3 = {"dias": [0, 1, 2, 3, 4], "inicio": "09:05", "fim": "18:00", "feriados_b3": True}
# ponytail: Brasil sem horário de verão desde 2019, então UTC-3 fixo dispensa o pacote tzdata.
# Se o horário de verão voltar, troque por zoneinfo.ZoneInfo("America/Sao_Paulo").
BRT = timezone(timedelta(hours=-3))


class Recusa(Exception):
    pass


def ler_json(caminho, obrigatorio=True):
    p = Path(caminho)
    if not p.exists():
        if obrigatorio:
            raise Recusa(f"arquivo não encontrado: {caminho}")
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def no_tick(preco, tick):
    # tolerância de 1e-6 tick: com 1e-9, preços de BTC (~1e5, tick 0,01) falham por erro de ponto flutuante
    return abs(preco / tick - round(preco / tick)) < 1e-6


def decimais_do_tick(tick):
    """Casas decimais do tick (0,5 → 1; 5 → 0; 0,00001 → 5; 0,01 → 2): o preço escrito sem ruído nem corte."""
    return next((d for d in range(10) if round(tick, d) == tick), 10)


def especificacao(ativo, cfg):
    """Especificação do ativo: ponto_rs, tick, margem, custo e sessão. WDO/WIN têm padrão em ATIVOS;
    o config sobrescreve. Recusa o ativo que o config não traz."""
    regras = cfg.get("ativos", {}).get(ativo)
    base = {**ATIVOS.get(ativo, {}), **(regras or {})}
    if regras is None or "ponto_rs" not in base or "tick" not in base:
        raise Recusa(f"ativo {ativo or 'sem nome'} não está em 'ativos' do config")
    # sem "sessao": a da B3, com os horários antigos sem_entrada_antes/depois do config se existirem
    sessao = base.get("sessao") or dict(SESSAO_B3, inicio=cfg.get("sem_entrada_antes", SESSAO_B3["inicio"]),
                                        fim=cfg.get("sem_entrada_depois", SESSAO_B3["fim"]))
    return {"ponto_rs": float(base["ponto_rs"]), "tick": float(base["tick"]),
            "margem_por_contrato": base["margem_por_contrato"],
            "custo_por_contrato": base["custo_por_contrato"], "sessao": sessao}


def dimensionar(plano, cfg, hoje, limite=None):
    """Devolve (ordem, limites, quem_decide) ou levanta Recusa."""
    lado = plano.get("lado")
    if lado not in ("compra", "venda"):
        raise Recusa("lado deve ser 'compra' ou 'venda'")
    simbolo = str(plano.get("simbolo", "")).upper()
    # o motor sempre manda plano["ativo"]; sem ele, WDO/WIN saem das 3 primeiras letras do símbolo
    ativo = str(plano.get("ativo") or simbolo[:3]).upper()
    if simbolo[:3] in ATIVOS and simbolo[:3] != ativo:  # plano escrito à mão: símbolo de um ativo, tamanho de outro
        raise Recusa(f"símbolo {simbolo} é do {simbolo[:3]}, mas o plano diz ativo {ativo}")
    spec = especificacao(ativo, cfg)
    if plano.get("data") and plano["data"] != hoje:
        raise Recusa(f"o plano é de {plano['data']}, não de hoje ({hoje}); faça um plano novo")

    entrada = float(limite if limite is not None else plano["entrada"])
    stop, alvo = float(plano["stop"]), float(plano["alvo"])
    for nome, valor in (("entrada", entrada), ("stop", stop), ("alvo", alvo)):
        if not no_tick(valor, spec["tick"]):
            raise Recusa(f"{nome} {valor} fora do tick de {spec['tick']:g} ponto(s) do {ativo}")

    sinal = 1 if lado == "compra" else -1
    risco_pts = (entrada - stop) * sinal
    ganho_pts = (alvo - entrada) * sinal
    if risco_pts <= 0:
        raise Recusa("stop do lado errado da entrada")
    if ganho_pts <= 0:
        raise Recusa("alvo do lado errado da entrada (o movimento já aconteceu?)")
    rr = ganho_pts / risco_pts
    if rr < cfg["rr_minimo"]:
        raise Recusa(f"risco:retorno {rr:.2f} abaixo do mínimo {cfg['rr_minimo']}")

    perda_contrato = risco_pts * spec["ponto_rs"] + 2 * spec["custo_por_contrato"]
    limites = {
        "perda máxima por trade": math.floor(cfg["max_perda_por_trade"] / perda_contrato),
        "margem do capital": math.floor(cfg["capital"] / spec["margem_por_contrato"]),
        "máximo de contratos": int(cfg["max_contratos"]),
    }
    decide = min(limites, key=limites.get)
    contratos = limites[decide]
    if contratos < 1:
        raise Recusa(
            f"nem 1 contrato cabe (limite: {decide}); 1 contrato perderia "
            f"R$ {perda_contrato:.2f} no stop, com {risco_pts:g} pontos de risco"
        )

    perda_max = round(contratos * perda_contrato, 2)
    tipo = "limite" if limite is not None or plano.get("tipo") == "limite" else "mercado"
    ordem = {
        "simbolo": simbolo,
        "ativo": ativo,
        "lado": lado,
        "contratos": contratos,
        "tipo": tipo,
        "entrada": entrada,
        "stop": stop,
        "alvo": alvo,
        "saida": False,
        "porque": (
            f"{plano.get('setup', 'setup')} em {simbolo}: {contratos} contrato(s), "
            f"limitado por {decide} ({contratos} x R$ {perda_contrato:.2f} = R$ {perda_max:.2f} no stop)"
        ),
        "plano": {
            "risco_pts": risco_pts,
            "perda_max_rs": perda_max,
            "rr": round(rr, 2),
            "setup": plano.get("setup"),
            "zerar_ate": cfg.get("zerar_ate"),
            "data": hoje,
        },
    }
    return ordem, limites, decide


def agora_brt(texto=None):
    if texto:
        return datetime.strptime(texto, "%Y-%m-%d %H:%M").replace(tzinfo=BRT)
    return datetime.now(BRT)


def teste():
    cfg = {"capital": 5000, "max_contratos": 5, "max_perda_por_trade": 100, "rr_minimo": 1.0,
           "ativos": {"WDO": {"margem_por_contrato": 150, "custo_por_contrato": 0.5},
                      "WIN": {"margem_por_contrato": 100, "custo_por_contrato": 0.25}}}
    plano = {"simbolo": "WDOX26", "lado": "compra", "entrada": 5432.5, "stop": 5428.0,
             "alvo": 5441.0, "setup": "smc-ob", "data": "2026-10-24"}
    # 4.5 pts x R$10 + R$1 de custo = R$46 por contrato; R$100 / 46 = 2 contratos
    ordem, limites, decide = dimensionar(plano, cfg, "2026-10-24")
    assert ordem["contratos"] == 2 and decide == "perda máxima por trade", (ordem, decide)
    assert ordem["plano"]["perda_max_rs"] == 92.0
    # venda espelhada
    venda = dict(plano, lado="venda", entrada=5432.5, stop=5437.0, alvo=5424.0)
    assert dimensionar(venda, cfg, "2026-10-24")[0]["contratos"] == 2
    # recusas
    for ruim, trecho in (
        (dict(plano, stop=5433.0), "stop do lado errado"),
        (dict(plano, alvo=5434.0), "risco:retorno"),
        (dict(plano, entrada=5432.3), "fora do tick"),
        (dict(plano, stop=5410.0, alvo=5480.0), "nem 1 contrato"),
        (dict(plano, simbolo="PETR4"), "não está em 'ativos'"),
        (dict(plano, simbolo="WINZ26", entrada=128502.0, stop=128400.0, alvo=128700.0), "fora do tick"),
        (dict(plano, data="2026-10-23"), "não de hoje"),
    ):
        try:
            dimensionar(ruim, cfg, "2026-10-24")
            raise AssertionError(f"devia recusar: {trecho}")
        except Recusa as e:
            assert trecho in str(e), (trecho, str(e))
    # margem decide quando o capital é pequeno
    assert dimensionar(plano, dict(cfg, capital=200), "2026-10-24")[2] == "margem do capital"
    # WIN: 100 pts x R$0,20 + R$0,50 de custo = R$20,50 por contrato; R$100 / 20,5 = 4 contratos
    win = {"simbolo": "WINZ26", "lado": "compra", "entrada": 128500.0, "stop": 128400.0,
           "alvo": 128700.0, "setup": "didi"}
    ordem, _, decide = dimensionar(win, cfg, "2026-10-24")
    assert ordem["contratos"] == 4 and decide == "perda máxima por trade", (ordem, decide)
    # EURUSD: o config traz ponto_rs e tick; o ativo vem de plano["ativo"], não do símbolo
    cfg["ativos"]["EURUSD"] = {"ponto_rs": 5400, "tick": 0.00001, "margem_por_contrato": 200,
                               "custo_por_contrato": 0.05}
    eur = {"simbolo": "EURUSD", "ativo": "EURUSD", "lado": "compra", "entrada": 1.085, "stop": 1.084,
           "alvo": 1.087, "setup": "teste"}
    # 0,001 x R$ 5.400 + R$ 0,10 de custo = R$ 5,50 por contrato; R$ 100 / 5,50 = 18, mas o máximo é 5
    ordem, limites, decide = dimensionar(eur, cfg, "2026-10-24")
    assert limites["perda máxima por trade"] == 18 and ordem["contratos"] == 5, (limites, ordem)
    assert decide == "máximo de contratos" and ordem["ativo"] == "EURUSD", (ordem, decide)
    assert ordem["plano"]["perda_max_rs"] == 27.5, ordem
    for ruim, trecho in ((dict(eur, ativo="XYZ"), "não está em 'ativos'"),
                         (dict(eur, entrada=1.085004), "fora do tick"),
                         (dict(plano, ativo="WIN"), "mas o plano diz ativo WIN"),  # WDOX26 não dimensiona como WIN
                         (dict(eur, simbolo="WDOX26"), "mas o plano diz ativo EURUSD")):
        try:
            dimensionar(ruim, cfg, "2026-10-24")
            raise AssertionError(f"devia recusar: {trecho}")
        except Recusa as e:
            assert trecho in str(e), (trecho, str(e))
    # especificação: padrão de WDO/WIN, config sobrescreve, sessão padrão da B3 quando ausente
    s = especificacao("WDO", cfg)
    assert (s["ponto_rs"], s["tick"], s["custo_por_contrato"]) == (10.0, 0.5, 0.5), s
    assert s["sessao"] == {"dias": [0, 1, 2, 3, 4], "inicio": "09:05", "fim": "18:00", "feriados_b3": True}, s
    assert especificacao("EURUSD", cfg)["ponto_rs"] == 5400
    cfg["ativos"]["WDO"]["tick"] = 1.0
    assert especificacao("WDO", cfg)["tick"] == 1.0
    # preço grande de BTC não pode falhar no tick por erro de ponto flutuante
    assert all(no_tick(round(p / 0.01) * 0.01, 0.01) for p in range(60000, 120000, 7))
    assert no_tick(111856.93, 0.01)  # erro de 1,9e-9 em tick: reprovava com a tolerância antiga de 1e-9
    assert not no_tick(111856.935, 0.01)  # meio tick continua fora
    # preços escritos com as casas do tick (o :g cortava o BTC em 6 algarismos: 111856.93 virava 111857)
    assert [decimais_do_tick(t) for t in (0.5, 5.0, 0.00001, 0.01)] == [1, 0, 5, 2]
    print("trader-budget: autoteste ok")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Calcula contratos de WDO/WIN dentro dos seus limites.")
    ap.add_argument("--plan", default="trader/plan.json")
    ap.add_argument("--config", default="trader/config.json")
    ap.add_argument("--orders", default="trader/orders.json")
    ap.add_argument("--limite", type=float, help="ordem limitada neste preço")
    ap.add_argument("--now", help='fixa o relógio, "AAAA-MM-DD HH:MM" (horário de Brasília)')
    ap.add_argument("--write", action="store_true", help="grava trader/orders.json")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--teste", action="store_true", help="roda o autoteste")
    a = ap.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")  # console do Windows não é UTF-8
    if a.teste:
        teste()
        return 0

    hoje = agora_brt(a.now).date().isoformat()
    try:
        cfg = ler_json(a.config)
        ordem, limites, decide = dimensionar(ler_json(a.plan), cfg, hoje, a.limite)
    except (Recusa, KeyError, ValueError) as e:
        print(f"SEM ORDEM: {e}")
        return 1

    if a.write:
        Path(a.orders).parent.mkdir(parents=True, exist_ok=True)
        Path(a.orders).write_text(json.dumps([ordem], ensure_ascii=False, indent=2), encoding="utf-8")
    if a.json:
        print(json.dumps(ordem, ensure_ascii=False, indent=2))
        return 0
    for nome, n in limites.items():
        print(f"  {nome:<24} {n:>3} contrato(s){'  <- decide' if nome == decide else ''}")
    p, d = ordem["plano"], decimais_do_tick(especificacao(ordem["ativo"], cfg)["tick"])
    print(f"{ordem['lado']} {ordem['contratos']} {ordem['simbolo']} ({ordem['tipo']}) "
          f"entrada {ordem['entrada']:.{d}f}, stop {ordem['stop']:.{d}f}, alvo {ordem['alvo']:.{d}f}")
    print(f"perda máxima no stop: R$ {p['perda_max_rs']:.2f}, risco:retorno {p['rr']}")
    print("Stop é uma ordem, não uma promessa: em mercado rápido pode executar pior.")
    if a.write:
        print(f"gravado em {a.orders}; agora rode o trader-risk")
    return 0


if __name__ == "__main__":
    sys.exit(main())

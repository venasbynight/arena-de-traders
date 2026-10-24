#!/usr/bin/env python3
"""trader-budget para os mini contratos da B3 (WDO e WIN). Só biblioteca padrão, sem rede.

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

# valor do ponto por contrato e menor variação (tick) de cada mini contrato da B3
ATIVOS = {"WDO": {"ponto_rs": 10.0, "tick": 0.5}, "WIN": {"ponto_rs": 0.20, "tick": 5.0}}
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
    return abs(preco / tick - round(preco / tick)) < 1e-9


def ativo_de(simbolo, cfg):
    """'WDOX26' -> ('WDO', especificação, regras do config), ou Recusa."""
    raiz = simbolo[:3]
    if raiz not in ATIVOS or raiz not in cfg.get("ativos", {}):
        raise Recusa(f"{simbolo or 'plano sem símbolo'} não está em 'ativos' do config")
    return raiz, ATIVOS[raiz], cfg["ativos"][raiz]


def dimensionar(plano, cfg, hoje, limite=None):
    """Devolve (ordem, limites, quem_decide) ou levanta Recusa."""
    lado = plano.get("lado")
    if lado not in ("compra", "venda"):
        raise Recusa("lado deve ser 'compra' ou 'venda'")
    simbolo = str(plano.get("simbolo", "")).upper()
    raiz, spec, regras = ativo_de(simbolo, cfg)
    if plano.get("data") and plano["data"] != hoje:
        raise Recusa(f"o plano é de {plano['data']}, não de hoje ({hoje}); faça um plano novo")

    entrada = float(limite if limite is not None else plano["entrada"])
    stop, alvo = float(plano["stop"]), float(plano["alvo"])
    for nome, valor in (("entrada", entrada), ("stop", stop), ("alvo", alvo)):
        if not no_tick(valor, spec["tick"]):
            raise Recusa(f"{nome} {valor} fora do tick de {spec['tick']:g} ponto(s) do {raiz}")

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

    perda_contrato = risco_pts * spec["ponto_rs"] + 2 * regras["custo_por_contrato"]
    limites = {
        "perda máxima por trade": math.floor(cfg["max_perda_por_trade"] / perda_contrato),
        "margem do capital": math.floor(cfg["capital"] / regras["margem_por_contrato"]),
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
        ordem, limites, decide = dimensionar(ler_json(a.plan), ler_json(a.config), hoje, a.limite)
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
    p = ordem["plano"]
    print(f"{ordem['lado']} {ordem['contratos']} {ordem['simbolo']} ({ordem['tipo']}) "
          f"entrada {ordem['entrada']:g}, stop {ordem['stop']:g}, alvo {ordem['alvo']:g}")
    print(f"perda máxima no stop: R$ {p['perda_max_rs']:.2f}, risco:retorno {p['rr']}")
    print("Stop é uma ordem, não uma promessa: em mercado rápido pode executar pior.")
    if a.write:
        print(f"gravado em {a.orders}; agora rode o trader-risk")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Linha de comando da arena.

    python arena.py backtest --ativo WDO --de 2026-09-01 --ate 2026-09-30
"""
import argparse
import sys
from datetime import date

import motor
import traders
from dados import ErroDados, historico


def main(argv=None):
    sys.stdout.reconfigure(encoding="utf-8")  # console do Windows não é UTF-8
    ap = argparse.ArgumentParser(description="Arena de Traders")
    sub = ap.add_subparsers(dest="cmd", required=True)
    bt = sub.add_parser("backtest", help="roda todos os traders num período e mostra o ranking")
    bt.add_argument("--ativo", choices=["WDO", "WIN"], required=True)
    bt.add_argument("--de", type=date.fromisoformat, required=True)
    bt.add_argument("--ate", type=date.fromisoformat, required=True)
    a = ap.parse_args(argv)

    try:
        cfg = motor.carregar_config()
        candles = historico(a.ativo, a.de, a.ate, cfg)
    except ErroDados as e:
        print(f"Erro: {e}")
        return 1
    except (OSError, ValueError, KeyError) as e:
        print(f"Erro ao ler a configuração ou o cache de dados: {e!r}")
        return 1
    if not candles:
        print(f"Sem candles de {a.ativo} entre {a.de} e {a.ate} (fim de semana, feriado ou fora do histórico).")
        return 1
    r = motor.rodar_backtest(a.ativo, candles, traders.TODOS, cfg)
    print(f"{a.ativo} de {a.de} a {a.ate}: {len(candles)} candles de 5 min\n")
    print(f"{'Trader':<20}{'Resultado':>12}{'Trades':>8}{'Acerto':>8}{'Fator':>7}{'Drawdown':>11}  Confiança")
    linhas = sorted(r["traders"].items(), key=lambda kv: -kv[1]["placar"]["resultado"])
    for nome, t in linhas:
        p = t["placar"]
        fator = f"{p['fator_lucro']:.2f}" if p["fator_lucro"] is not None else "-"
        print(f"{nome:<20}{p['resultado']:>12.2f}{p['trades']:>8}{p['acerto']:>8.0%}{fator:>7}"
              f"{p['drawdown']:>11.2f}  {p['confianca']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

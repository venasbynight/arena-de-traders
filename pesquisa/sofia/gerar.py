"""Gera o arquivo de variantes de uma rodada da triagem: python pesquisa/sofia/gerar.py saida.json '<python>'

O segundo argumento é uma expressão Python que devolve [(variante, params, alvos)].
"""
import json
import sys

FX = ["EURUSD", "USDJPY", "GBPUSD", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD"]
ACOES = ["PETR4", "VALE3", "ITUB4", "BBDC4", "AXIA3", "BBAS3", "SBSP3", "PETR3", "EMBJ3", "PRIO3", "RENT3", "EQTL3"]
vs = eval(sys.argv[2])
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump([{"variante": n, "params": p, "alvos": a} for n, p, a in vs], f, ensure_ascii=False)
print(len(vs), "variantes")

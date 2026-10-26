"""Tabela do resumo a partir do registro: por ativo × tf, o padrão (blocos) e a melhor variante com ≥ 100 trades."""
import collections
import csv
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
rs = list(csv.DictReader(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "registro.csv"),
                              encoding="utf-8")))
tri = [r for r in rs if not r["variante"].startswith(("baseline", "walk-forward")) and r["nota"] != "VALIDAÇÃO"]
print("linhas de triagem", len(tri), "| variantes (regra+parâmetros)", len({r["parametros"] for r in tri}),
      "| combinações variante × ativo × tf", len(tri))
grupos = collections.defaultdict(list)
for r in tri:
    grupos[(r["ativo"], r["tf"])].append(r)
f = lambda r: (f"{r['trades']} | {float(r['resultado']):.0f} | {r['fator_lucro']} | {float(r['resultado_estresse']):.0f}"
               f" | {r['fator_lucro_estresse']}") if r else "— | — | — | — | —"
for k in sorted(grupos, key=lambda k: (int(k[1]), k[0])):
    ok = [r for r in grupos[k] if int(r["trades"]) >= 100]
    b = max(ok, key=lambda r: float(r["fator_lucro"] or 0)) if ok else None
    v0 = next((r for r in grupos[k] if r["variante"].startswith("v0")), None)
    print(f"| {k[0]} | {k[1]} | {f(v0)} | {b['variante'] if b else '(nenhuma com ≥ 100)'} | {f(b)} | "
          f"{b['veredito'] if b else 'inconclusivo'} |")

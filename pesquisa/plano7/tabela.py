"""Tabelas em Markdown a partir de pesquisa/plano7/<etapa>.json.

    python pesquisa/plano7/tabela.py antes_depois sensibilidade [validacao_*]  > tabelas.md
"""
import glob
import json
import os
import sys

PASTA = os.path.dirname(os.path.abspath(__file__))


def num(v, casas=0):
    if v is None:
        return "—"
    s = f"{v:,.{casas}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return s.replace("-", "−")


def pf(v):
    return "s.p." if v is None else num(v, 2)


def celula(r, estresse):
    return (f"{r['trades']} | {num(r['resultado'])} | {pf(r['fator_lucro'])} | {num(r['payoff'], 2)} | "
            f"{num(100 * r['acerto'])}% | {num(estresse['resultado'])} ({pf(estresse['fator_lucro'])})")


def linhas(etapa):
    with open(os.path.join(PASTA, f"{etapa}.json"), encoding="utf-8") as f:
        return json.load(f)


def antes_depois(ls):
    pares = {}
    for l in ls:
        pares.setdefault((l["trader"], l["ativo"], l["tf"]), {})[l["variante"]] = l
    print("| Trader | Mercado | tf | Antes: trades \\| R$ \\| PF \\| payoff \\| acerto \\| c/ estresse (PF) "
          "| Depois: trades \\| R$ \\| PF \\| payoff \\| acerto \\| c/ estresse (PF) | tr/sessão antes → depois "
          "| contratos médios antes → depois | custo R$ antes → depois | recusas por R:R depois | veredito depois |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for (t, a, tf), v in pares.items():
        an, de = v["antes"], v["depois"]
        print(f"| {t} | {a} | {tf} | {celula(an['sem'], an['com'])} | {celula(de['sem'], de['com'])} | "
              f"{num(an['sem']['trades_por_sessao'], 3)} → {num(de['sem']['trades_por_sessao'], 3)} | "
              f"{num(an['sem']['contratos_medio'], 1)} → {num(de['sem']['contratos_medio'], 1)} | "
              f"{num(an['sem']['custo'])} → {num(de['sem']['custo'])} | {de['sem']['block_rr']} | {de['veredito']} |")


def simples(ls):
    print("| Trader | Variante | Mercado | tf | trades \\| R$ \\| PF \\| payoff \\| acerto \\| c/ estresse (PF) "
          "| tr/sessão | veredito |")
    print("|---|---|---|---|---|---|---|")
    for l in ls:
        print(f"| {l['trader']} | {l['variante']} | {l['ativo']} | {l['tf']} | {celula(l['sem'], l['com'])} | "
              f"{num(l['sem']['trades_por_sessao'], 3)} | {l['veredito']} |")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    for etapa in sys.argv[1:]:
        for caminho in sorted(glob.glob(os.path.join(PASTA, f"{etapa}.json"))):
            nome = os.path.basename(caminho)[:-5]
            print(f"\n### {nome}\n")
            (antes_depois if nome == "antes_depois" else simples)(linhas(nome))

"""Raio-x das operações de uma etapa já rodada (cache): motivo de saída, duração, ganho médio. Só leitura.

    python pesquisa/didi/olhar.py '<json dos params>' ATIVO TF
"""
import collections
import json
import sys
from datetime import datetime

import rodar

params, ativo, tf = json.loads(sys.argv[1]), sys.argv[2], int(sys.argv[3])
ops = [o for b0, b1 in rodar.blocos(ativo) for o in rodar._rodar((params, ativo, tf, b0, b1, 0))]
por = collections.defaultdict(list)
for o in ops:
    por[o["motivo_saida"]].append(o)
for m, os_ in por.items():
    dur = [(datetime.fromisoformat(o["saida_t"]) - datetime.fromisoformat(o["entrada_t"])).total_seconds() / 60 for o in os_]
    rs = [o["resultado_rs"] for o in os_]
    print(f"{m:8} n={len(os_):4} soma={sum(rs):10.2f} média={sum(rs)/len(rs):8.2f} acerto={sum(r > 0 for r in rs)/len(rs):.2f} "
          f"duração média={sum(dur)/len(dur):6.1f} min")
hora = collections.defaultdict(list)
for o in ops:
    hora[o["entrada_t"][11:13]].append(o["resultado_rs"])
print("por hora:", {h: (len(v), round(sum(v), 1)) for h, v in sorted(hora.items())})

"""Candles: arquivo CSV, agrupamento por tempo gráfico e histórico do MT5."""
import csv
from datetime import datetime

from tipos import Candle

CAMPOS = ["t", "o", "h", "l", "c", "v", "delta"]


def salvar_csv(candles, caminho):
    with open(caminho, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(CAMPOS)
        for k in candles:
            w.writerow([k.t.isoformat(), k.o, k.h, k.l, k.c, k.v, k.delta])


def ler_csv(caminho):
    with open(caminho, newline="", encoding="utf-8") as f:
        return [Candle(datetime.fromisoformat(r["t"]), float(r["o"]), float(r["h"]), float(r["l"]),
                       float(r["c"]), float(r["v"]), float(r["delta"])) for r in csv.DictReader(f)]


def por_dia(candles):
    dias = {}
    for k in candles:
        dias.setdefault(k.t.date(), []).append(k)
    return dias


def agrupar(candles, minutos):
    """Agrupa em blocos de `minutos`, ancorados no primeiro candle de cada dia."""
    out = []
    for dia in por_dia(candles).values():
        inicio = dia[0].t
        blocos = {}
        for k in dia:
            n = int((k.t - inicio).total_seconds() // (minutos * 60))
            blocos.setdefault(n, []).append(k)
        for b in blocos.values():
            out.append(Candle(b[0].t, b[0].o, max(k.h for k in b), min(k.l for k in b), b[-1].c,
                              sum(k.v for k in b), sum(k.delta for k in b)))
    return out

"""Estudos de preço usados pelos traders. Funções puras sobre listas de candles já fechados."""
from tipos import Pivo


def pivos(candles, n=2):
    """Topos e fundos com n candles de cada lado; cada um só vale a partir de i + n."""
    out = []
    for i in range(n, len(candles) - n):
        viz = candles[i - n:i] + candles[i + 1:i + n + 1]
        if all(candles[i].h > k.h for k in viz):
            out.append(Pivo(i, i + n, "topo", candles[i].h))
        if all(candles[i].l < k.l for k in viz):
            out.append(Pivo(i, i + n, "fundo", candles[i].l))
    return out


def tendencia(candles, n=2):
    """'alta' após fechamento acima do último topo confirmado, 'baixa' após fechamento abaixo do último fundo."""
    ps = sorted(pivos(candles, n), key=lambda p: p.conf)
    estado, topo, fundo, k = None, None, None, 0
    for j, c in enumerate(candles):
        while k < len(ps) and ps[k].conf <= j:
            if ps[k].tipo == "topo":
                topo = ps[k].preco
            else:
                fundo = ps[k].preco
            k += 1
        if topo is not None and c.c > topo:
            estado = "alta"
        elif fundo is not None and c.c < fundo:
            estado = "baixa"
    return estado

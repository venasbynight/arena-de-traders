"""Estudos de preço usados pelos traders. Funções puras sobre listas de candles já fechados."""
from tipos import Pivo, Zona


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
        # cada topo/fundo só rompe uma vez: assim manda o rompimento mais recente
        if topo is not None and c.c > topo:
            estado, topo = "alta", None
        if fundo is not None and c.c < fundo:
            estado, fundo = "baixa", None
    return estado


def fvgs(candles, minimo):
    """Buracos de três candles: alta quando a mínima do 3º passa da máxima do 1º; baixa é o espelho."""
    out = []
    for i in range(2, len(candles)):
        a, c = candles[i - 2], candles[i]
        if c.l > a.h and c.l - a.h >= minimo:
            out.append(Zona(i, "alta", c.l, a.h, "fvg"))
        elif c.h < a.l and a.l - c.h >= minimo:
            out.append(Zona(i, "baixa", a.l, c.h, "fvg"))
    return out


def order_blocks(candles, n=2):
    """Último candle contrário antes da perna que rompeu (fechamento além) o último topo ou fundo confirmado."""
    ps = sorted(pivos(candles, n), key=lambda p: p.conf)
    out, topo, fundo, k = [], None, None, 0
    for j, c in enumerate(candles):
        while k < len(ps) and ps[k].conf <= j:
            if ps[k].tipo == "topo":
                topo = ps[k]
            else:
                fundo = ps[k]
            k += 1
        if topo and c.c > topo.preco:
            trecho = range(topo.i, j + 1)
            base = min(trecho, key=lambda i: candles[i].l)
            ob = next((i for i in range(base, topo.i - 1, -1) if candles[i].c < candles[i].o), None)
            if ob is not None:
                out.append(Zona(j, "alta", candles[ob].h, candles[ob].l, "ob"))
            topo = None  # cada topo rompido gera um só order block
        if fundo and c.c < fundo.preco:
            trecho = range(fundo.i, j + 1)
            base = max(trecho, key=lambda i: candles[i].h)
            ob = next((i for i in range(base, fundo.i - 1, -1) if candles[i].c > candles[i].o), None)
            if ob is not None:
                out.append(Zona(j, "baixa", candles[ob].h, candles[ob].l, "ob"))
            fundo = None
    return out

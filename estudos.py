"""Estudos de preço usados pelos traders. Funções puras sobre listas de candles já fechados."""
from tipos import Pivo, Zona


def pivos(candles, n=2):
    """Topos e fundos com n candles de cada lado; cada um só vale a partir de i + n."""
    out, hs, ls = [], [k.h for k in candles], [k.l for k in candles]
    for i in range(n, len(candles) - n):
        # maior que o máximo dos vizinhos = maior que cada um; os dois do lado primeiro, que quase sempre já
        # decidem (o all() com gerador era 75% do tempo da Sofia)
        h, l = hs[i], ls[i]
        if h > hs[i - 1] and h > hs[i + 1] and h > max(hs[i - n:i]) and h > max(hs[i + 1:i + n + 1]):
            out.append(Pivo(i, i + n, "topo", h))
        if l < ls[i - 1] and l < ls[i + 1] and l < min(ls[i - n:i]) and l < min(ls[i + 1:i + n + 1]):
            out.append(Pivo(i, i + n, "fundo", l))
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


def sma(valores, n):
    """Média aritmética simples; None enquanto não há n valores."""
    return [None if i < n - 1 else sum(valores[i - n + 1:i + 1]) / n for i in range(len(valores))]


def didi(fechamentos, n_curta=3, n_meio=8, n_longa=20):
    """Didi Index: (curta, longa) = (MA3 − MA8, MA20 − MA8); a MA8 é o zero."""
    curta, meio, longa = (sma(fechamentos, n) for n in (n_curta, n_meio, n_longa))
    menos = lambda a, b: None if a is None or b is None else a - b
    return [menos(a, m) for a, m in zip(curta, meio)], [menos(b, m) for b, m in zip(longa, meio)]


def bollinger(fechamentos, n=8, k=2):
    """(superior, centro, inferior): média de n ± k desvios populacionais."""
    sup, meio, inf = [], sma(fechamentos, n), []
    for i, m in enumerate(meio):
        # desvio na mão: statistics.pstdev é exato (frações) e deixava o backtest 10× mais lento
        d = None if m is None else k * (sum((x - m) ** 2 for x in fechamentos[i - n + 1:i + 1]) / n) ** 0.5
        sup.append(None if d is None else m + d)
        inf.append(None if d is None else m - d)
    return sup, meio, inf


def adx(candles, n=8):
    """ADX de Wilder com (adx, di+, di−). DI vale a partir do candle n; ADX, de 2n − 1 (média dos n primeiros DX)."""
    vazio = [None] * len(candles)
    adx_, mais, menos = vazio[:], vazio[:], vazio[:]
    s_tr = s_mais = s_menos = 0.0
    dxs = []
    for i in range(1, len(candles)):
        a, c = candles[i - 1], candles[i]
        tr = max(c.h - c.l, abs(c.h - a.c), abs(c.l - a.c))
        sobe, desce = c.h - a.h, a.l - c.l
        dm_mais = sobe if sobe > desce and sobe > 0 else 0.0
        dm_menos = desce if desce > sobe and desce > 0 else 0.0
        if i <= n:  # os n primeiros somam; depois, alisamento de Wilder
            s_tr, s_mais, s_menos = s_tr + tr, s_mais + dm_mais, s_menos + dm_menos
            if i < n:
                continue
        else:
            s_tr, s_mais, s_menos = (s_tr - s_tr / n + tr, s_mais - s_mais / n + dm_mais,
                                     s_menos - s_menos / n + dm_menos)
        mais[i] = 100 * s_mais / s_tr if s_tr else 0.0
        menos[i] = 100 * s_menos / s_tr if s_tr else 0.0
        soma = mais[i] + menos[i]
        dxs.append(100 * abs(mais[i] - menos[i]) / soma if soma else 0.0)
        if len(dxs) == n:
            adx_[i] = sum(dxs) / n
        elif len(dxs) > n:
            adx_[i] = (adx_[i - 1] * (n - 1) + dxs[-1]) / n
    return adx_, mais, menos


def ema(valores, n):
    """Média exponencial (α = 2/(n+1)) que começa na média dos n primeiros valores; None antes e nos None."""
    out, ini = [None] * len(valores), next((i for i, v in enumerate(valores) if v is not None), len(valores))
    for i in range(ini + n - 1, len(valores)):
        out[i] = (sum(valores[ini:i + 1]) / n if i == ini + n - 1
                  else out[i - 1] + 2 / (n + 1) * (valores[i] - out[i - 1]))
    return out


def trix(fechamentos, n=9):
    """TRIX: variação % de um candle da EMA tripla do fechamento. Vale a partir do candle 3(n − 1) + 1."""
    e3 = ema(ema(ema(fechamentos, n), n), n)
    return [None if a is None or b is None else 100 * (b - a) / a for a, b in zip([None] + e3, e3)]

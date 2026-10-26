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


# Indicadores candle a candle: cada classe recebe um valor (ou candle) por chamada e devolve o valor do indicador
# nesse ponto, com as mesmas contas, na mesma ordem, das funções de lista abaixo (que só alimentam as classes).
# O Didi guarda uma instância por série e só manda os candles novos: o dia deixa de custar O(n²).

class Media:
    """Média aritmética simples de n; None enquanto não há n valores."""
    def __init__(self, n):
        self.n, self.janela = n, []

    def __call__(self, x):
        self.janela.append(x)
        if len(self.janela) > self.n:
            del self.janela[0]
        return sum(self.janela) / self.n if len(self.janela) == self.n else None


class Bandas:
    """Bollinger: (superior, centro, inferior) = média de n ± k desvios populacionais."""
    def __init__(self, n=8, k=2):
        self.n, self.k, self.media = n, k, Media(n)

    def __call__(self, x):
        m = self.media(x)
        if m is None:
            return None, None, None
        # desvio na mão: statistics.pstdev é exato (frações) e deixava o backtest 10× mais lento
        d = self.k * (sum((v - m) ** 2 for v in self.media.janela) / self.n) ** 0.5
        return m + d, m, m - d


class Adx:
    """ADX de Wilder: (adx, di+, di−). DI vale a partir do candle n; ADX, de 2n − 1 (média dos n primeiros DX)."""
    def __init__(self, n=8):
        self.n, self.i, self.ant, self.valor = n, -1, None, None
        self.s_tr = self.s_mais = self.s_menos = 0.0
        self.dxs = []

    def __call__(self, c):
        n, a, self.ant = self.n, self.ant, c
        self.i += 1
        if a is None:
            return None, None, None
        tr = max(c.h - c.l, abs(c.h - a.c), abs(c.l - a.c))
        sobe, desce = c.h - a.h, a.l - c.l
        dm_mais = sobe if sobe > desce and sobe > 0 else 0.0
        dm_menos = desce if desce > sobe and desce > 0 else 0.0
        if self.i <= n:  # os n primeiros somam; depois, alisamento de Wilder
            self.s_tr, self.s_mais, self.s_menos = self.s_tr + tr, self.s_mais + dm_mais, self.s_menos + dm_menos
            if self.i < n:
                return None, None, None
        else:
            self.s_tr, self.s_mais, self.s_menos = (self.s_tr - self.s_tr / n + tr, self.s_mais - self.s_mais / n
                                                    + dm_mais, self.s_menos - self.s_menos / n + dm_menos)
        mais = 100 * self.s_mais / self.s_tr if self.s_tr else 0.0
        menos = 100 * self.s_menos / self.s_tr if self.s_tr else 0.0
        soma = mais + menos
        self.dxs.append(100 * abs(mais - menos) / soma if soma else 0.0)
        if len(self.dxs) == n:
            self.valor = sum(self.dxs) / n
        elif len(self.dxs) > n:
            self.valor = (self.valor * (n - 1) + self.dxs[-1]) / n
            del self.dxs[0]  # só o tamanho importa daqui em diante
        return self.valor, mais, menos


class Mme:
    """Média exponencial (α = 2/(n+1)) que começa na média dos n primeiros valores; None antes e nos None do início."""
    def __init__(self, n):
        self.n, self.inicio, self.valor = n, [], None

    def __call__(self, x):
        if self.valor is not None:
            self.valor = self.valor + 2 / (self.n + 1) * (x - self.valor)
        elif x is not None or self.inicio:
            self.inicio.append(x)
            if len(self.inicio) == self.n:
                self.valor = sum(self.inicio) / self.n
        return self.valor


class Trix:
    """TRIX: variação % de um candle da MME tripla do fechamento. Vale a partir do candle 3(n − 1) + 1."""
    def __init__(self, n=9):
        self.e1, self.e2, self.e3, self.ant = Mme(n), Mme(n), Mme(n), None

    def __call__(self, x):
        a, b = self.ant, self.e3(self.e2(self.e1(x)))
        self.ant = b
        return None if a is None or b is None else 100 * (b - a) / a


def sma(valores, n):
    """Média aritmética simples; None enquanto não há n valores."""
    m = Media(n)
    return [m(v) for v in valores]


def didi(fechamentos, n_curta=3, n_meio=8, n_longa=20):
    """Didi Index: (curta, longa) = (MA3 − MA8, MA20 − MA8); a MA8 é o zero."""
    curta, meio, longa = (sma(fechamentos, n) for n in (n_curta, n_meio, n_longa))
    menos = lambda a, b: None if a is None or b is None else a - b
    return [menos(a, m) for a, m in zip(curta, meio)], [menos(b, m) for b, m in zip(longa, meio)]


def bollinger(fechamentos, n=8, k=2):
    """(superior, centro, inferior): média de n ± k desvios populacionais."""
    b = Bandas(n, k)
    return tuple(map(list, zip(*[b(x) for x in fechamentos]))) if fechamentos else ([], [], [])


def adx(candles, n=8):
    """ADX de Wilder com (adx, di+, di−). DI vale a partir do candle n; ADX, de 2n − 1 (média dos n primeiros DX)."""
    a = Adx(n)
    return tuple(map(list, zip(*[a(c) for c in candles]))) if candles else ([], [], [])


def ema(valores, n):
    """Média exponencial (α = 2/(n+1)) que começa na média dos n primeiros valores; None antes e nos None."""
    m = Mme(n)
    return [m(v) for v in valores]


def trix(fechamentos, n=9):
    """TRIX: variação % de um candle da EMA tripla do fechamento. Vale a partir do candle 3(n − 1) + 1."""
    t = Trix(n)
    return [t(x) for x in fechamentos]

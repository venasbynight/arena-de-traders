"""Didi Agulhada: médias 3, 8 e 20 se cruzando no mesmo candle; entra quando as bandas de Bollinger abrem, com ADX
subindo e TRIX numa extremidade, e sai quando as bandas fecham ou a MA3 volta contra."""
import statistics
from datetime import timedelta

import estudos
from dados import agrupar
from motor import preco
from tipos import Decisao, Plano
from traders.sofia_smc import arredondar_tick

NOME = "Didi Agulhada"
ESTILO = "agulhada 3·8·20 · Bollinger abrindo · ADX e TRIX"
# agulhada_n: candles entre os dois cruzamentos (0 = no mesmo candle); janela_bandas: candles depois da agulhada em
# que as bandas ainda podem abrir; adx: "sobe" (ADX subindo e DI a favor), "di" (só o DI a favor) ou "nao";
# adx "baixo": ADX subindo agora e ≤ ADX_BAIXO no candle antes da agulhada (compressão), com o DI a favor;
# tendencia: só a favor da tendência (estudos.tendencia) do 60 (entrada no 5/15) ou do diário (entrada no 60);
# trix_extremo: percentil (0,2 = os 20% mais baixos dos últimos 120 para a compra); 1 = só o TRIX virando a favor
# recuo: 0 = a mercado na abertura seguinte; r > 0 = limitada no recuo r (Fibonacci) do candle que abriu as bandas
PARAMS = {"tf": 5, "alvo_x": 3.0, "trix_extremo": 0.2, "agulhada_n": 0, "janela_bandas": 3, "adx": "sobe",
          "recuo": 0, "saida": "bandas", "tendencia": False}
# saida: "bandas" (sai quando as bandas fecham ou a MA3 volta contra) ou "ma3" (só quando a MA3 volta)
GRADE = {"tf": [5],  # o 15 não fez operação em nenhum ativo real e custava 2× o tempo do gerente
          "alvo_x": [2.0, 3.0, 4.0], "trix_extremo": [0.1, 0.2, 0.3]}
MINIMO = 27  # TRIX(9) no candle anterior (índice 25); MA20, bandas e ADX de 8 já valem antes
N_TRIX = 120  # valores do TRIX para o percentil da extremidade
ADX_BAIXO = 20  # notas do Diretor: na compressão o ADX fica perto de 20 ou menos


def _r(v, casas=4):
    return None if v is None else round(v, casas)


class _Serie:
    """Os estudos do Didi sobre uma lista de candles que só cresce (ontem + hoje no mesmo dia): guarda o estado das
    médias, bandas, ADX e TRIX e calcula só os candles novos. Outra lista (dia novo, janela que andou) recomeça do
    zero, então o valor é sempre o mesmo das funções de lista de `estudos` sobre a lista inteira."""

    def __init__(self):
        self.cs, self.ind = [], {c: [] for c in ("curta", "longa", "sup", "meio", "inf", "adx", "mais", "menos", "trix")}
        self.m3, self.m8, self.m20 = estudos.Media(3), estudos.Media(8), estudos.Media(20)
        self.bb, self.dmi, self.tx = estudos.Bandas(8, 2), estudos.Adx(8), estudos.Trix(9)

    def estudos(self, cs):
        if cs[:len(self.cs)] != self.cs:
            self.__init__()
        menos = lambda a, b: None if a is None or b is None else a - b
        for k in cs[len(self.cs):]:
            a, m, b = self.m3(k.c), self.m8(k.c), self.m20(k.c)
            for nome, v in zip(self.ind, (menos(a, m), menos(b, m), *self.bb(k.c), *self.dmi(k), self.tx(k.c))):
                self.ind[nome].append(v)
            self.cs.append(k)
        return self.ind


class Trader:
    def __init__(self, ativo, tick, params=None, sessao=None):
        self.ativo, self.tick, self.p = ativo, tick, {**PARAMS, **(params or {})}
        self.sessao = sessao
        self.serie = _Serie()

    def _estudos(self, cs):
        """{curta, longa, sup, meio, inf, adx, mais, menos, trix}: listas alinhadas com `cs` (não alterar)."""
        return self.serie.estudos(cs)

    def decidir(self, hoje5, ontem5, fechados60):
        tf, tick = int(self.p["tf"]), self.tick
        de60 = bool(fechados60) and fechados60[-1].t == hoje5[-1].t
        if de60:
            # candles base de 60 (ações): ontem + hoje são só 14 candles; os 200 blocos de 60 fechados que o motor
            # entrega já terminam no candle que acabou de fechar e dão o histórico das médias e do TRIX
            cs = list(fechados60)
        else:
            cs = ontem5 + hoje5
        fechou = True
        if tf != 5:
            cs = agrupar(cs, tf)
            # o candle de tf fecha quando o de 5 que acabou de fechar é o último dele
            fechou = (hoje5[-1].t + timedelta(minutes=5) - hoje5[0].t) % timedelta(minutes=tf) == timedelta(0)
            if not fechou:
                cs = cs[:-1]  # o candle de tf em formação ainda não existe
        if not cs:
            return Decisao(pensamento=[f"sem candles de {tf} min fechados; não opero"])

        e = self._estudos(cs)
        curta, longa, sup, meio, inf = e["curta"], e["longa"], e["sup"], e["meio"], e["inf"]
        adx, mais, menos, trix = e["adx"], e["mais"], e["menos"], e["trix"]
        tk = lambda v: None if v is None else arredondar_tick(v, tick)
        d = Decisao(desenhos=[{"tipo": "indicadores", "t": cs[-1].t.isoformat(), "bb_sup": tk(sup[-1]),
                               "bb_meio": tk(meio[-1]), "bb_inf": tk(inf[-1]), "didi_curta": _r(curta[-1]),
                               "didi_longa": _r(longa[-1]), "adx": _r(adx[-1]), "di_mais": _r(mais[-1]),
                               "di_menos": _r(menos[-1]), "trix": _r(trix[-1], 6)}])
        if not fechou:
            d.pensamento.append(f"decido só no fechamento do candle de {tf} min")
            return d
        n = len(cs)
        if n < MINIMO:
            d.pensamento.append(f"só {n} candles de {tf} min; preciso de {MINIMO} para médias, bandas, ADX e TRIX; "
                                f"não opero")
            return d

        # zero e empate com folga de 1/1000 de tick: soma de preços em float (EURUSD, BTC) deixa resto de 1e-16
        eps = tick / 1000
        sg = lambda v: (v > eps) - (v < -eps)
        largura = [None if s is None else s - i for s, i in zip(sup, inf)]
        abriu = lambda j: largura[j] - largura[j - 1] > eps

        c0, c1 = sg(curta[-2]), sg(curta[-1])
        contra = "compra" if c0 > 0 >= c1 else "venda" if c0 < 0 <= c1 else None  # quem essa virada tira
        if self.p["saida"] == "bandas" and largura[-1] - largura[-2] < -eps:
            d.sair = True
            d.pensamento.append("as bandas fecharam: se estou posicionado, saio na abertura do próximo candle")
        elif contra:
            d.sair = contra
            d.pensamento.append(f"MA3 cruzou a MA8 para {'baixo' if contra == 'compra' else 'cima'}: se estou "
                                f"{'comprado' if contra == 'compra' else 'vendido'}, saio na abertura do próximo candle")

        def cruzou(linha, j, para):  # +1: de ≤ 0 para > 0; −1: de ≥ 0 para < 0
            return linha[j - 1] is not None and sg(linha[j - 1]) * para <= 0 < sg(linha[j]) * para

        def agulhada(j):
            """MA3 e MA20 cruzam a MA8 em sentidos opostos; com agulhada_n > 0 o 1º cruzamento pode ter vindo até n
            candles antes, desde que as duas estejam de lados opostos agora e o 2º seja neste candle."""
            ini = max(1, j - int(self.p["agulhada_n"]))
            for lado, s in (("compra", 1), ("venda", -1)):
                if not (sg(curta[j]) * s > 0 > sg(longa[j]) * s):
                    continue
                c = [x for x in range(ini, j + 1) if cruzou(curta, x, s)]
                l = [x for x in range(ini, j + 1) if cruzou(longa, x, -s)]
                if c and l and j in (c[-1], l[-1]):
                    return lado

        janela = int(self.p["janela_bandas"])
        a = next((j for j in range(n - 1, n - 2 - janela, -1) if agulhada(j)), None)  # a mais recente
        if a is None:
            d.pensamento.append("sem agulhada")
            return d
        lado, depois = agulhada(a), n - 1 - a
        if not depois:
            d.desenhos.append({"tipo": "agulhada", "t": cs[a].t.isoformat(), "lado": lado})
        if any(abriu(j) for j in range(a, n - 1)):
            d.pensamento.append(f"as bandas já abriram depois da agulhada de {lado}; espero a próxima")
            return d
        if not abriu(n - 1):
            d.pensamento.append(f"as bandas não abriram em {janela} candles: a agulhada de {lado} expirou"
                                if depois == janela else f"agulhada de {lado}; espero as bandas abrirem")
            return d

        k = cs[-1]
        compra = lado == "compra"
        modo_adx = self.p["adx"]
        if modo_adx in ("sobe", "baixo") and not adx[-1] > adx[-2]:
            d.pensamento.append(f"bandas abriram na agulhada de {lado}, mas o ADX não sobe; não entro")
            return d
        if modo_adx == "baixo" and not (adx[a - 1] is not None and adx[a - 1] <= ADX_BAIXO):
            d.pensamento.append(f"bandas abriram na agulhada de {lado}, mas o ADX não vinha baixo (≤ {ADX_BAIXO}) "
                                f"antes dela: não houve compressão; não entro")
            return d
        if modo_adx != "nao" and not (mais[-1] > menos[-1] if compra else menos[-1] > mais[-1]):
            d.pensamento.append(f"bandas abriram na agulhada de {lado}, mas o DI {'+' if compra else '−'} não manda; "
                                f"não entro")
            return d
        q = self.p["trix_extremo"]
        corte = None
        if q < 1:  # 1 = só a direção: o TRIX virando a favor, em qualquer nível
            valores = [v for v in trix[-N_TRIX:] if v is not None]
            # percentil linear (o mesmo do numpy); q em centésimos
            corte = statistics.quantiles(valores, n=100, method="inclusive")[round((q if compra else 1 - q) * 100) - 1]
        no_nivel = corte is None or (trix[-1] <= corte if compra else trix[-1] >= corte)
        if not (no_nivel and (trix[-1] > trix[-2] if compra else trix[-1] < trix[-2])):
            onde = "" if corte is None else f"{'no fundo (≤ ' if compra else 'no topo (≥ '}{corte:.4f}) "
            d.pensamento.append(f"bandas abriram na agulhada de {lado}, mas o TRIX ({trix[-1]:.4f}) não está "
                                f"{onde}virando a favor; não entro")
            return d

        if self.p["tendencia"]:
            # contexto maior: o 60 para o 5 e o 15; o diário (pregões já fechados) para o 60
            ctx = [x for x in agrupar(fechados60, 24 * 60) if x.t.date() < k.t.date()] if de60 else fechados60
            tend = estudos.tendencia(ctx, 2)
            if tend != ("alta" if compra else "baixa"):
                d.pensamento.append(f"bandas abriram na agulhada de {lado}, mas a tendência do "
                                    f"{'diário' if de60 else '60'} é {tend or 'indefinida'}; não entro")
                return d

        sinal = 1 if compra else -1
        ref = arredondar_tick(k.c, tick)
        stop = arredondar_tick((k.l if compra else k.h) - sinal * tick, tick)
        # recuo: limitada no Fibonacci `recuo` do candle que abriu as bandas, só no candle seguinte (as notas do
        # Diretor: entrada no pullback de 0,382 a 0,618 do impulso, ou direto no rompimento)
        r = self.p["recuo"]
        nivel = arredondar_tick(k.h - r * (k.h - k.l) if compra else k.l + r * (k.h - k.l), tick)
        limitada = r > 0 and (nivel < ref if compra else nivel > ref)
        entrada = nivel if limitada else ref
        alvo = arredondar_tick(entrada + sinal * self.p["alvo_x"] * abs(entrada - stop), tick)
        d.planos.append(Plano(lado, "limite" if limitada else "mercado", entrada, stop, alvo, "didi-agulhada"))
        conf = {"sobe": ", ADX subindo", "baixo": ", ADX saindo de baixo", "di": ", DI a favor", "nao": ""}[modo_adx]
        conf += ", a favor da tendência" if self.p["tendencia"] else ""
        conf += ", TRIX virando a favor" if corte is None else " e TRIX na extremidade"
        como = (f"limitada em {preco(entrada, tick)} (recuo de {r:g} do candle) no próximo candle" if limitada else
                f"a mercado na abertura do próximo candle (fechou em {preco(ref, tick)})")
        d.pensamento.append(f"agulhada de {lado}, bandas abrindo{conf}: {lado} {como}; stop {preco(stop, tick)}, "
                            f"alvo {preco(alvo, tick)}")
        return d

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
PARAMS = {"tf": 5, "alvo_x": 3.0, "trix_extremo": 0.2}
GRADE = {"tf": [5, 15], "alvo_x": [2.0, 3.0, 4.0], "trix_extremo": [0.1, 0.2, 0.3]}
MINIMO = 27  # TRIX(9) no candle anterior (índice 25); MA20, bandas e ADX de 8 já valem antes
JANELA = 3  # candles depois da agulhada em que as bandas ainda podem abrir
N_TRIX = 120  # valores do TRIX para o percentil da extremidade


def _r(v, casas=4):
    return None if v is None else round(v, casas)


class Trader:
    def __init__(self, ativo, tick, params=None, sessao=None):
        self.ativo, self.tick, self.p = ativo, tick, {**PARAMS, **(params or {})}
        self.sessao = sessao

    def decidir(self, hoje5, ontem5, fechados60):
        tf, tick = int(self.p["tf"]), self.tick
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

        fech = [k.c for k in cs]
        curta, longa = estudos.didi(fech)
        sup, meio, inf = estudos.bollinger(fech, 8, 2)
        adx, mais, menos = estudos.adx(cs, 8)
        trix = estudos.trix(fech, 9)
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
        if largura[-1] - largura[-2] < -eps:
            d.sair = True
            d.pensamento.append("as bandas fecharam: se estou posicionado, saio na abertura do próximo candle")
        elif contra:
            d.sair = contra
            d.pensamento.append(f"MA3 cruzou a MA8 para {'baixo' if contra == 'compra' else 'cima'}: se estou "
                                f"{'comprado' if contra == 'compra' else 'vendido'}, saio na abertura do próximo candle")

        def agulhada(j):
            c0, c1, l0, l1 = (sg(v) for v in (curta[j - 1], curta[j], longa[j - 1], longa[j]))
            if c0 <= 0 < c1 and l0 >= 0 > l1:
                return "compra"
            if c0 >= 0 > c1 and l0 <= 0 < l1:
                return "venda"

        a = next((j for j in range(n - 1, n - 2 - JANELA, -1) if agulhada(j)), None)  # a mais recente
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
            d.pensamento.append(f"as bandas não abriram em {JANELA} candles: a agulhada de {lado} expirou"
                                if depois == JANELA else f"agulhada de {lado}; espero as bandas abrirem")
            return d

        k = cs[-1]
        compra = lado == "compra"
        if not adx[-1] > adx[-2]:
            d.pensamento.append(f"bandas abriram na agulhada de {lado}, mas o ADX não sobe; não entro")
            return d
        if not (mais[-1] > menos[-1] if compra else menos[-1] > mais[-1]):
            d.pensamento.append(f"bandas abriram na agulhada de {lado}, mas o DI {'+' if compra else '−'} não manda; "
                                f"não entro")
            return d
        q = self.p["trix_extremo"]
        valores = [v for v in trix[-N_TRIX:] if v is not None]
        # percentil linear (o mesmo do numpy); q em centésimos
        corte = statistics.quantiles(valores, n=100, method="inclusive")[round((q if compra else 1 - q) * 100) - 1]
        if not (trix[-1] <= corte and trix[-1] > trix[-2] if compra else trix[-1] >= corte and trix[-1] < trix[-2]):
            d.pensamento.append(f"bandas abriram na agulhada de {lado}, mas o TRIX ({trix[-1]:.4f}) não está "
                                f"{'no fundo (≤ ' if compra else 'no topo (≥ '}{corte:.4f}) virando a favor; não entro")
            return d

        sinal = 1 if compra else -1
        ref = arredondar_tick(k.c, tick)
        stop = arredondar_tick((k.l if compra else k.h) - sinal * tick, tick)
        alvo = arredondar_tick(ref + sinal * self.p["alvo_x"] * abs(ref - stop), tick)
        d.planos.append(Plano(lado, "mercado", ref, stop, alvo, "didi-agulhada"))
        d.pensamento.append(f"agulhada de {lado}, bandas abrindo, ADX subindo e TRIX na extremidade: {lado} a mercado "
                            f"na abertura do próximo candle (fechou em {preco(ref, tick)}); stop {preco(stop, tick)}, "
                            f"alvo {preco(alvo, tick)}")
        return d

"""Didi Agulhada: médias 3, 8 e 20 se cruzando no mesmo candle, com ADX subindo e bandas de Bollinger abrindo."""
from datetime import timedelta

import estudos
from dados import agrupar
from motor import preco
from tipos import Decisao, Plano
from traders.sofia_smc import arredondar_tick

NOME = "Didi Agulhada"
ESTILO = "agulhada 3·8·20 · ADX e Bollinger"
PARAMS = {"tf": 5, "alvo_x": 3.0}
GRADE = {"tf": [5, 15], "alvo_x": [2.0, 3.0, 4.0]}
MINIMO = 21  # MA20 no candle anterior (índice 19) e ADX de 8 no anterior (índice 15)


def _r(v):
    return None if v is None else round(v, 4)


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
        tk = lambda v: None if v is None else arredondar_tick(v, tick)
        d = Decisao(desenhos=[{"tipo": "indicadores", "t": cs[-1].t.isoformat(), "bb_sup": tk(sup[-1]),
                               "bb_meio": tk(meio[-1]), "bb_inf": tk(inf[-1]), "didi_curta": _r(curta[-1]),
                               "didi_longa": _r(longa[-1]), "adx": _r(adx[-1]), "di_mais": _r(mais[-1]),
                               "di_menos": _r(menos[-1])}])
        if not fechou:
            d.pensamento.append(f"decido só no fechamento do candle de {tf} min")
            return d
        if len(cs) < MINIMO:
            d.pensamento.append(f"só {len(cs)} candles de {tf} min; preciso de {MINIMO} para médias, ADX e bandas; "
                                f"não opero")
            return d

        c0, c1, l0, l1 = curta[-2], curta[-1], longa[-2], longa[-1]
        d.sair = c0 > 0 >= c1 or c0 < 0 <= c1  # a curta mudou de sinal: contra quem estiver posicionado
        if d.sair:
            d.pensamento.append("MA3 cruzou a MA8: se estou posicionado, saio na abertura do próximo candle")
        if c0 <= 0 < c1 and l0 >= 0 > l1:
            lado = "compra"
        elif c0 >= 0 > c1 and l0 <= 0 < l1:
            lado = "venda"
        else:
            d.pensamento.append("sem agulhada")
            return d

        k = cs[-1]
        d.desenhos.append({"tipo": "agulhada", "t": k.t.isoformat(), "lado": lado})
        compra = lado == "compra"
        if not adx[-1] > adx[-2]:
            d.pensamento.append(f"agulhada de {lado}, mas o ADX não sobe; não entro")
            return d
        if not (mais[-1] > menos[-1] if compra else menos[-1] > mais[-1]):
            d.pensamento.append(f"agulhada de {lado}, mas o DI {'+' if compra else '−'} não manda; não entro")
            return d
        if not sup[-1] - inf[-1] > sup[-2] - inf[-2]:
            d.pensamento.append(f"agulhada de {lado}, mas as bandas não abrem; não entro")
            return d

        sinal = 1 if compra else -1
        gatilho = arredondar_tick((k.h if compra else k.l) + sinal * tick, tick)
        stop = arredondar_tick((k.l if compra else k.h) - sinal * tick, tick)
        alvo = arredondar_tick(gatilho + sinal * self.p["alvo_x"] * abs(gatilho - stop), tick)
        d.planos.append(Plano(lado, "stop", gatilho, stop, alvo, "didi-agulhada", tf // 5))
        d.pensamento.append(f"agulhada de {lado} com ADX subindo e bandas abrindo: {lado} stop em "
                            f"{preco(gatilho, tick)} só no próximo candle; stop {preco(stop, tick)}, "
                            f"alvo {preco(alvo, tick)}")
        return d

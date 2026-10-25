"""Rafa Rompimento: faixa dos primeiros 15 minutos do dia; entra a mercado no fechamento além dela."""
from tipos import Decisao, Plano
from traders.sofia_smc import arredondar_tick

NOME = "Rafa Rompimento"
ESTILO = "rompimento da faixa de abertura"
# alvo_x 1.0 fica de fora: o alvo parte do fechamento, que já está além da borda, então o risco (até o outro
# lado da faixa) passa da altura e o R:R fica abaixo de 1; com rr_minimo = 1.0 o size.dimensionar recusa sempre
PARAMS = {"minutos_faixa": 15, "alvo_x": 1.5, "faixa_min_ticks": 4}
GRADE = {"alvo_x": [1.5, 2.0, 2.5]}


class Trader:
    def __init__(self, ativo, tick, params=None, sessao=None):
        self.ativo, self.tick, self.p = ativo, tick, {**PARAMS, **(params or {})}
        # a faixa começa no primeiro candle de hoje5 (B3 às 09:00; Forex e BTC às 00:00), então a sessão não faz falta
        self.sessao = sessao

    def decidir(self, hoje5, ontem5, fechados60):
        minutos, tick = self.p["minutos_faixa"], self.tick
        n = minutos // 5
        if len(hoje5) < n:
            return Decisao(pensamento=[f"a faixa dos {minutos} primeiros minutos ainda não fechou"])
        faixa = hoje5[:n]
        topo, fundo = max(k.h for k in faixa), min(k.l for k in faixa)
        altura = topo - fundo
        d = Decisao(desenhos=[{"tipo": "zona", "topo": topo, "fundo": fundo, "de": faixa[0].t.isoformat(),
                               "rotulo": f"faixa {minutos} min", "lado": "neutro"}],
                    pensamento=[f"faixa dos {minutos} primeiros minutos: {fundo:g} a {topo:g}"])
        ticks = round(altura / tick)
        if ticks < self.p["faixa_min_ticks"]:
            d.pensamento.append(f"faixa de {ticks} ticks é estreita (mínimo {self.p['faixa_min_ticks']}); não opero hoje")
            return d

        # só o primeiro fechamento além de cada lado vale; os seguintes já são continuação
        idx = range(n, len(hoje5))
        acima = next((j for j in idx if hoje5[j].c > topo), None)
        abaixo = next((j for j in idx if hoje5[j].c < fundo), None)
        ultimo, c = len(hoje5) - 1, hoje5[-1].c
        for lado, primeiro, borda, nome in (("compra", acima, topo, "máxima"), ("venda", abaixo, fundo, "mínima")):
            if primeiro is None:
                continue
            if primeiro < ultimo:
                if (c > topo if lado == "compra" else c < fundo):
                    d.pensamento.append(f"já rompi a {nome} hoje; só um rompimento por lado")
                continue
            sinal = 1 if lado == "compra" else -1
            stop = arredondar_tick(fundo if lado == "compra" else topo, tick)
            alvo = arredondar_tick(c + sinal * self.p["alvo_x"] * altura, tick)
            # entrada = fechamento do sinal: só referência de tamanho e risco; a mercado enche na abertura seguinte
            d.planos.append(Plano(lado, "mercado", arredondar_tick(c, tick), stop, alvo, "rompimento"))
            d.pensamento.append(f"fechou além da {nome} da faixa ({borda:g}): {lado} a mercado; stop {stop:g}, alvo {alvo:g}")
        return d

"""Vera VWAP: reversão à VWAP do dia quando o fechamento sai das bandas de desvio-padrão."""
from statistics import pstdev

from tipos import Decisao, Plano
from traders.sofia_smc import arredondar_tick

NOME = "Vera VWAP"
ESTILO = "reversão à VWAP · bandas de desvio"
PARAMS = {"desvios": 1.0, "candles_min": 12}
GRADE = {"desvios": [1.0, 1.5, 2.0]}


def vwap_e_desvio(candles):
    """VWAP pelo preço típico (máx+mín+fech)/3 e desvio-padrão populacional dos preços típicos; v = 0 em todos → peso 1."""
    tipicos = [(k.h + k.l + k.c) / 3 for k in candles]
    pesos = [k.v for k in candles] if any(k.v for k in candles) else [1.0] * len(candles)
    return sum(p * w for p, w in zip(tipicos, pesos)) / sum(pesos), pstdev(tipicos)


class Trader:
    def __init__(self, ativo, tick, params=None, sessao=None):
        self.ativo, self.tick, self.p = ativo, tick, {**PARAMS, **(params or {})}
        self.sessao = sessao  # o dia vem inteiro em hoje5; a sessão não faz falta aqui

    def _leitura(self, candles):
        """(vwap, desvio, lado) do último candle: 'venda' acima da banda de cima, 'compra' abaixo da de baixo, senão None."""
        if len(candles) < self.p["candles_min"]:
            return None
        vwap, dp = vwap_e_desvio(candles)
        c, banda = candles[-1].c, self.p["desvios"] * dp
        lado = "venda" if c > vwap + banda else "compra" if c < vwap - banda else None
        return vwap, dp, lado if dp else None  # sem dispersão não há banda

    def decidir(self, hoje5, ontem5, fechados60):
        leitura = self._leitura(hoje5)
        if leitura is None:
            return Decisao(pensamento=[f"VWAP do dia só vale com {self.p['candles_min']} candles; tenho {len(hoje5)}"])
        vwap, dp, lado = leitura
        tick, dev = self.tick, self.p["desvios"]
        sup, inf = vwap + dev * dp, vwap - dev * dp
        d = Decisao(desenhos=[{"tipo": "linha", "preco": arredondar_tick(p, tick), "rotulo": r}
                              for p, r in ((vwap, "VWAP"), (sup, "banda +"), (inf, "banda −"))],
                    pensamento=[f"VWAP do dia com bandas de {dev:g} desvio; vendo acima, compro abaixo"])
        if lado is None:
            return d
        anterior = self._leitura(hoje5[:-1])
        if anterior and anterior[2] == lado:  # já estava fora da banda no candle anterior: o sinal saiu lá
            d.pensamento.append("segue fora da banda; não repito o sinal")
            return d
        c = hoje5[-1].c
        stop = arredondar_tick(sup + dp if lado == "venda" else inf - dp, tick)
        alvo = arredondar_tick(vwap, tick)
        if not (alvo < c < stop if lado == "venda" else stop < c < alvo):
            d.pensamento.append(f"fechou em {c:g}, além do stop de {stop:g}; não entro")
            return d
        # entrada = fechamento do sinal: só referência de tamanho e risco; a mercado enche na abertura seguinte
        d.planos.append(Plano(lado, "mercado", arredondar_tick(c, tick), stop, alvo, "vwap"))
        d.pensamento.append(f"fechou {'acima' if lado == 'venda' else 'abaixo'} da banda: {lado} a mercado; "
                            f"stop {stop:g}, alvo {alvo:g} (VWAP)")
        return d

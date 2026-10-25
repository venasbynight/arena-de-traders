"""Robôs de teste: módulos mínimos no formato dos traders, rápidos e determinísticos, para os testes do gerente e do
servidor não dependerem da estratégia de nenhum trader real. Cada um faz no máximo uma operação por dia."""
from types import SimpleNamespace

from motor import preco
from tipos import Decisao, Plano
from traders.sofia_smc import arredondar_tick


def _fabricar(nome, estilo, chave, grade, n_candles, olha):
    """Módulo com um Trader que, depois de `n_candles` candles do dia, entra a mercado no sentido do último candle
    contra a abertura da janela de `olha` candles; stop do outro lado da janela, alvo a `chave` alturas da janela."""
    params = {chave: grade[chave][0]}

    class Trader:
        def __init__(self, ativo, tick, params=None, sessao=None):
            self.ativo, self.tick, self.p = ativo, tick, {**modulo.PARAMS, **(params or {})}
            self.sessao = sessao

        def decidir(self, hoje5, ontem5, fechados60):
            if len(hoje5) != n_candles:
                return Decisao(pensamento=[f"{nome}: espero o candle {n_candles} do dia; tenho {len(hoje5)}"])
            janela, tick = hoje5[-olha:], self.tick
            topo, fundo = max(k.h for k in janela), min(k.l for k in janela)
            altura, c = topo - fundo, hoje5[-1].c
            if altura <= 0:
                return Decisao(pensamento=[f"{nome}: janela sem altura; não opero"])
            lado, sinal = ("compra", 1) if c >= janela[0].o else ("venda", -1)
            stop = arredondar_tick(fundo if sinal > 0 else topo, tick)
            alvo = arredondar_tick(c + sinal * self.p[chave] * altura, tick)
            d = Decisao(pensamento=[f"{nome}: {lado} a mercado; stop {preco(stop, tick)}, alvo {preco(alvo, tick)}"])
            d.planos.append(Plano(lado, "mercado", arredondar_tick(c, tick), stop, alvo, "teste"))
            return d

    modulo = SimpleNamespace(NOME=nome, ESTILO=estilo, PARAMS=params, GRADE=grade, Trader=Trader)
    return modulo


ALFA = _fabricar("Robô Alfa", "robô de teste · janela curta", "alvo_x", {"alvo_x": [1.5, 2.0, 2.5]}, 4, 3)
BETA = _fabricar("Robô Beta", "robô de teste · janela longa", "multiplo", {"multiplo": [1.5, 2.0, 2.5]}, 8, 6)

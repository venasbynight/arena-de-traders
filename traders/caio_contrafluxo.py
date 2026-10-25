"""Caio Contrafluxo: vende quem comprou forte contra a tendência na resistência (delta), e o espelho no suporte."""
import estudos
from motor import preco
from tipos import Decisao, Plano
from traders.sofia_smc import arredondar_tick

NOME = "Caio Contrafluxo"
ESTILO = "delta contra a tendência · S/R do dia"
# limite do delta (contratos) por ativo. Grade = percentis 80, 90, 95 e 98 do |delta| por candle de 5 min, medidos
# em 25/10/2026: WDO 5134, 7706, 10507, 14301 (83 pregões, 29/06 a 23/10); WIN 17949, 24943, 32326, 42248 (51
# pregões, 12/08 a 23/10), arredondados. WIN parte dos 10.000 da regra; WDO, do percentil 90.
PARAMS = {"n": 2, "limite": {"WDO": 7500, "WIN": 10000}, "regiao_ticks": 2, "folga_ticks": 2}
GRADE = {"limite": {"WDO": [5000, 7500, 10500, 14500], "WIN": [10000, 18000, 25000, 32000, 42000]}}


class Trader:
    def __init__(self, ativo, tick, params=None, sessao=None):
        self.ativo, self.tick, self.p = ativo, tick, {**PARAMS, **(params or {})}
        self.sessao = sessao
        self.usados = set()  # (dia, índice do candle do topo/fundo): cada um gera no máximo um sinal por dia

    def _limite(self):
        lim = self.p["limite"]
        return lim.get(self.ativo) if isinstance(lim, dict) else lim

    def decidir(self, hoje5, ontem5, fechados60):
        k, tick, n, lim = hoje5[-1], self.tick, self.p["n"], self._limite()
        d = Decisao(desenhos=[{"tipo": "indicadores", "t": k.t.isoformat(), "delta": k.delta, "limite": lim}])
        if lim is None:
            d.pensamento.append(f"sem limite de delta para {self.ativo}; não opero")
            return d
        if k.delta is None:
            d.pensamento.append("sem delta: o MT5 não tem os negócios deste dia; não opero")
            return d
        tend = estudos.tendencia(fechados60, n)
        if tend is None:
            d.pensamento.append("sem tendência definida no 60; não opero")
            return d
        venda = tend == "baixa"
        d.pensamento.append(f"tendência do 60: {tend}; só {'venda na resistência' if venda else 'compra no suporte'}")

        dia, regiao = k.t.date(), self.p["regiao_ticks"] * tick
        pivos = [p for p in estudos.pivos(hoje5, n) if p.conf < len(hoje5) - 1]  # confirmado antes deste candle
        livres = [p for p in pivos if (dia, p.i) not in self.usados]
        for p in livres:
            topo = p.tipo == "topo"
            d.desenhos.append({"tipo": "zona", "lado": "baixa" if topo else "alta",
                               "topo": p.preco if topo else p.preco + regiao,
                               "fundo": p.preco - regiao if topo else p.preco,
                               "de": hoje5[p.i].t.isoformat(), "rotulo": "resistência" if topo else "suporte"})
        for p in livres:
            if p.tipo != ("topo" if venda else "fundo"):
                continue
            # chegou na região: a 2 ticks do nível ou além, sem estar o candle inteiro do outro lado
            if not (k.h >= p.preco - regiao and k.l <= p.preco if venda else k.l <= p.preco + regiao and k.h >= p.preco):
                continue
            nome = f"{'na resistência' if venda else 'no suporte'} {preco(p.preco, tick)}"
            if not (k.delta > lim if venda else k.delta < -lim):
                d.pensamento.append(f"{nome} com delta {k.delta:+.0f} (limite ±{lim:g}): sem sinal")
                continue
            self.usados.add((dia, p.i))
            if venda:
                stop = arredondar_tick(max(p.preco, k.h) + self.p["folga_ticks"] * tick, tick)
                alvos = [q.preco for q in pivos if q.tipo == "fundo" and q.preco < k.c]
                alvo = max(alvos) if alvos else None
            else:
                stop = arredondar_tick(min(p.preco, k.l) - self.p["folga_ticks"] * tick, tick)
                alvos = [q.preco for q in pivos if q.tipo == "topo" and q.preco > k.c]
                alvo = min(alvos) if alvos else None
            lado = "venda" if venda else "compra"
            if alvo is None:
                d.pensamento.append(f"sinal {nome} (delta {k.delta:+.0f}), mas sem "
                                    f"{'fundo abaixo' if venda else 'topo acima'} para alvo; não entro")
                break
            d.planos.append(Plano(lado, "mercado", k.c, stop, alvo, "caio-contrafluxo"))
            d.desenhos.append({"tipo": "linha", "preco": alvo, "rotulo": f"{'fundo' if venda else 'topo'} · alvo"})
            d.pensamento.append(f"delta {k.delta:+.0f} {nome}: {lado} a mercado na abertura; "
                                f"stop {preco(stop, tick)}, alvo {preco(alvo, tick)}")
            break
        return d

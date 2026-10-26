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
# Pesquisa (Plano 6), todos desligados no padrão:
#   limite_pct  percentil do |delta| de ontem + hoje antes do sinal, no lugar do limite fixo (None = fixo)
#   tendencia   "60" (regra da Sofia no 60), "dia" (fechamento contra a abertura do dia) ou "ambos"
#   confirma    espera o candle seguinte ao sinal fechar abaixo do nível e do fechamento do sinal (venda; espelho)
#   alvo_rr     alvo = risco × alvo_rr a partir do fechamento (None = topo/fundo oposto do dia)
#   horario     ["HH:MM", "HH:MM"]: só sinais com o candle de decisão nessa janela (None = o pregão todo)
#   rejeicao    o candle do sinal passa do nível e fecha de volta do lado de cá (absorção)
# Nenhum passou na pesquisa (pesquisa/caio/resumo.md); ficam para refazer quando houver mais meses de delta.
PARAMS = {"n": 2, "limite": {"WDO": 7500, "WIN": 10000}, "regiao_ticks": 2, "folga_ticks": 2,
          "limite_pct": None, "tendencia": "60", "confirma": False, "alvo_rr": None, "horario": None,
          "rejeicao": False}
GRADE = {"limite": {"WDO": [5000, 7500, 10500, 14500], "WIN": [10000, 18000, 25000, 32000, 42000]}}
MIN_AMOSTRA_PCT = 50  # candles com delta para o percentil valer


class Trader:
    def __init__(self, ativo, tick, params=None, sessao=None):
        self.ativo, self.tick, self.p = ativo, tick, {**PARAMS, **(params or {})}
        self.sessao = sessao
        self.usados = set()  # (dia, índice do candle do topo/fundo): cada um gera no máximo um sinal por dia

    def _limite(self, anteriores=()):
        lim = self.p["limite"]
        lim = lim.get(self.ativo) if isinstance(lim, dict) else lim
        pct = self.p["limite_pct"]
        if pct is None:
            return lim  # None: ativo sem limite de delta, não opera
        vs = sorted(abs(k.delta) for k in anteriores if k.delta is not None)
        return vs[int(pct / 100 * (len(vs) - 1))] if len(vs) >= MIN_AMOSTRA_PCT else None

    def _tendencia(self, hoje5, fechados60):
        t60 = estudos.tendencia(fechados60, self.p["n"]) if self.p["tendencia"] != "dia" else None
        c, o = hoje5[-1].c, hoje5[0].o
        tdia = "alta" if c > o else "baixa" if c < o else None
        return {"60": t60, "dia": tdia, "ambos": t60 if t60 == tdia else None}[self.p["tendencia"]]

    def decidir(self, hoje5, ontem5, fechados60):
        k, tick, n = hoje5[-1], self.tick, self.p["n"]
        conf = self.p["confirma"]
        j = len(hoje5) - 1 - conf  # candle do sinal: o último, ou o anterior quando espera confirmação
        s = hoje5[j] if j >= 0 else None
        lim = self._limite(ontem5 + hoje5[:max(j, 0)])
        d = Decisao(desenhos=[{"tipo": "indicadores", "t": k.t.isoformat(), "delta": k.delta, "limite": lim}])
        if lim is None:
            d.pensamento.append(f"sem limite de delta para {self.ativo}; não opero")
            return d
        if s is None or s.delta is None:
            d.pensamento.append("sem delta: o MT5 não tem os negócios deste dia; não opero")
            return d
        tend = self._tendencia(hoje5, fechados60)
        if tend is None:
            d.pensamento.append(f"sem tendência definida ({self.p['tendencia']}); não opero")
            return d
        venda = tend == "baixa"
        d.pensamento.append(f"tendência ({self.p['tendencia']}): {tend}; "
                            f"só {'venda na resistência' if venda else 'compra no suporte'}")
        h = self.p["horario"]
        if h and not h[0] <= k.t.strftime("%H:%M") < h[1]:
            d.pensamento.append(f"fora do horário {h[0]}–{h[1]}; não opero")
            return d

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
            if p.tipo != ("topo" if venda else "fundo") or p.conf >= j:  # confirmado antes do candle do sinal
                continue
            # chegou na região: a 2 ticks do nível ou além, sem estar o candle inteiro do outro lado
            if not (s.h >= p.preco - regiao and s.l <= p.preco if venda else s.l <= p.preco + regiao and s.h >= p.preco):
                continue
            if self.p["rejeicao"] and not (s.h >= p.preco > s.c if venda else s.l <= p.preco < s.c):
                continue
            nome = f"{'na resistência' if venda else 'no suporte'} {preco(p.preco, tick)}"
            if not (s.delta > lim if venda else s.delta < -lim):
                d.pensamento.append(f"{nome} com delta {s.delta:+.0f} (limite ±{lim:g}): sem sinal")
                continue
            self.usados.add((dia, p.i))
            if conf and not (k.c < min(p.preco, s.c) if venda else k.c > max(p.preco, s.c)):
                d.pensamento.append(f"delta {s.delta:+.0f} {nome}, mas o candle seguinte não confirmou; não entro")
                break
            if venda:
                stop = arredondar_tick(max(p.preco, s.h, k.h) + self.p["folga_ticks"] * tick, tick)
                alvos = [q.preco for q in pivos if q.tipo == "fundo" and q.preco < k.c]
                alvo = max(alvos) if alvos else None
            else:
                stop = arredondar_tick(min(p.preco, s.l, k.l) - self.p["folga_ticks"] * tick, tick)
                alvos = [q.preco for q in pivos if q.tipo == "topo" and q.preco > k.c]
                alvo = min(alvos) if alvos else None
            if self.p["alvo_rr"]:
                alvo = arredondar_tick(k.c - self.p["alvo_rr"] * (stop - k.c), tick)
            lado = "venda" if venda else "compra"
            if alvo is None:
                d.pensamento.append(f"sinal {nome} (delta {s.delta:+.0f}), mas sem "
                                    f"{'fundo abaixo' if venda else 'topo acima'} para alvo; não entro")
                break
            d.planos.append(Plano(lado, "mercado", k.c, stop, alvo, "caio-contrafluxo"))
            d.desenhos.append({"tipo": "linha", "preco": alvo, "rotulo": f"{'fundo' if venda else 'topo'} · alvo"})
            d.pensamento.append(f"delta {s.delta:+.0f} {nome}: {lado} a mercado na abertura; "
                                f"stop {preco(stop, tick)}, alvo {preco(alvo, tick)}")
            break
        return d

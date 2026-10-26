"""Sofia SMC: tendência no 60 minutos, entrada no meio de order block ou FVG do 5 minutos.

No 60 minutos (ações) a tendência vem do diário, montado dos candles de 60 já fechados.
"""
from datetime import timedelta

import estudos
from motor import preco
from tipos import Candle, Decisao, Pivo, Plano

NOME = "Sofia SMC"
ESTILO = "OB/FVG · tendência 60→5"
# zona_min_atr: altura mínima da zona em amplitudes médias (0 = qualquer); alvo_r: o alvo é a primeira liquidez
# (topo/fundo) além de alvo_r vezes o risco (0 = a mais próxima); horario: entradas só nessa janela (None = sempre);
# entrada_frac: onde fica a limitada, da borda de perto (0) à de longe (1) da zona, 0,5 = meio; desconto: compra só
# na parte de baixo do dia (entrada até mínima + desconto × amplitude do dia), venda no espelho (1 = em qualquer lugar);
# gatilho: em vez da limitada, espera o 1º toque na zona fechar rejeitando (de volta para fora dela) e entra com ordem
# stop no rompimento da máxima (compra) ou mínima (venda) desse candle; dias_zona: as zonas valem pelos últimos
# dias_zona pregões (no 5 e no 15 no máximo 2, ontem e hoje; no 60 os candles de 60 fechados)
PARAMS = {"n": 2, "fvg_min": {"WDO": 1.0, "WIN": 50.0, "EURUSD": 0.0002, "BTCUSDT": 20.0}, "folga_ticks": 2,
          "zona_min_atr": 0.0, "alvo_r": 0.0, "horario": None, "entrada_frac": 0.5, "desconto": 1.0,
          "gatilho": False, "dias_zona": 1}
GRADE = {"folga_ticks": [1, 2, 3]}
N_AMPLITUDE = 14  # candles da amplitude média (máxima − mínima)


def arredondar_tick(preco, tick):
    return round(round(preco / tick) * tick, 10)  # o round de fora tira o ruído de ponto flutuante (1.0861200000000002)


def diarios(candles60, antes_de):
    """Candles diários dos dias completos (anteriores a `antes_de`) a partir dos de 60 minutos."""
    dias = {}
    for k in candles60:
        if k.t.date() < antes_de:
            dias.setdefault(k.t.date(), []).append(k)
    return [Candle(ks[0].t, ks[0].o, max(k.h for k in ks), min(k.l for k in ks), ks[-1].c) for ks in dias.values()]


class Trader:
    def __init__(self, ativo, tick, params=None, sessao=None):
        self.ativo, self.tick, self.p = ativo, tick, {**PARAMS, **(params or {})}
        self.sessao = sessao  # a Sofia não depende do horário da sessão; fica para os traders que dependerem
        self._piv, self._tend = (None, None, []), (None, None)  # caches: mesmo resultado, sem refazer o dia todo

    def _pivos(self, base):
        """estudos.pivos(base); quando base é a anterior + 1 candle, só calcula o pivô novo (i = len − n − 1)."""
        n, (ini, fim, ps) = self.p["n"], self._piv
        if not (ini == base[0].t and len(base) >= 2 and fim == (len(base) - 1, base[-2].t)):
            ps = estudos.pivos(base, n)
        elif len(base) - n - 1 >= n:
            i = len(base) - n - 1
            ps = ps + [Pivo(p.i + i - n, p.conf + i - n, p.tipo, p.preco)
                       for p in estudos.pivos(base[i - n:i + n + 1], n)]
        self._piv = (base[0].t, (len(base), base[-1].t), ps)
        return ps

    def _tendencia(self, contexto):
        chave = (len(contexto), contexto[0].t, contexto[-1].t) if contexto else None
        if self._tend[0] != chave:
            self._tend = (chave, estudos.tendencia(contexto, self.p["n"]))
        return self._tend[1]

    def _do_ativo(self, chave):
        """Valor do parâmetro para este ativo: aceita {ativo: valor} (PARAMS) ou o valor já resolvido (harness)."""
        v = self.p[chave]
        return v.get(self.ativo) if isinstance(v, dict) else v

    def _valida(self, z, hoje5, entrada):
        """Zona ainda serve: ninguém fechou do outro lado dela nem passou 1 tick da entrada depois de criada."""
        for k in hoje5[z.criada + 1:]:
            if z.lado == "alta" and (k.c < z.fundo or k.l <= entrada - self.tick):
                return False
            if z.lado == "baixa" and (k.c > z.topo or k.h >= entrada + self.tick):
                return False
        return True

    def _gatilho(self, z, hoje5):
        """Preço do gatilho se o último candle é o 1º a tocar a zona e fechou rejeitando-a; senão None."""
        alta = z.lado == "alta"
        toque = next((j for j in range(z.criada + 1, len(hoje5))
                      if (hoje5[j].l <= z.topo if alta else hoje5[j].h >= z.fundo)), None)
        k = hoje5[-1]
        if toque != len(hoje5) - 1 or not (k.c > z.topo if alta else k.c < z.fundo):
            return None
        return k.h if alta else k.l

    def decidir(self, hoje5, ontem5, fechados60):
        n, tick = self.p["n"], self.tick
        base = ontem5 + hoje5
        horario = self._do_ativo("horario")
        if horario and not horario[0] <= hoje5[-1].t.strftime("%H:%M") < horario[1]:
            return Decisao(pensamento=[f"fora do meu horário ({horario[0]}–{horario[1]}); não opero"])
        par = hoje5[-2:] if len(hoje5) >= 2 else ontem5[-2:]  # dois candles do mesmo dia: o tempo gráfico
        no_60 = len(par) == 2 and par[1].t - par[0].t >= timedelta(minutes=60)
        contexto = diarios(fechados60, hoje5[-1].t.date()) if no_60 else fechados60
        nome_ctx = "diário" if no_60 else "60"
        tend = self._tendencia(contexto)
        if tend is None:
            return Decisao(pensamento=[f"sem tendência definida no {nome_ctx}; não opero"])
        lado = "compra" if tend == "alta" else "venda"
        d = Decisao(pensamento=[f"tendência do {nome_ctx}: {tend}; só {lado}"])

        ultimos = base[-N_AMPLITUDE:]
        amplitude = sum(k.h - k.l for k in ultimos) / len(ultimos)
        zona_min = (self._do_ativo("zona_min_atr") or 0.0) * amplitude
        alvo_r = self._do_ativo("alvo_r") or 0.0
        frac, desconto, gatilho = (self._do_ativo(k) for k in ("entrada_frac", "desconto", "gatilho"))
        maxima, minima = max(k.h for k in hoje5), min(k.l for k in hoje5)
        # zonas dos últimos dias_zona pregões (1 = só de hoje: vencem no fim do dia)
        velas, nd = hoje5, self._do_ativo("dias_zona") or 1
        if no_60 or nd > 1:
            fonte = fechados60 if no_60 else base
            dias = sorted({k.t.date() for k in fonte})[-nd:]
            if dias and dias[-1] == hoje5[-1].t.date():
                velas = [k for k in fonte if k.t.date() >= dias[0]]
        zonas = estudos.fvgs(velas, self._do_ativo("fvg_min") or 2 * tick) + estudos.order_blocks(velas, n)
        pivos = self._pivos(base)
        for z in (z for z in zonas if z.lado == tend):
            if z.topo - z.fundo < zona_min:
                continue
            if gatilho:
                entrada = self._gatilho(z, velas)
                if entrada is None:
                    continue
            else:
                perto, longe = (z.topo, z.fundo) if z.lado == "alta" else (z.fundo, z.topo)
                entrada = arredondar_tick(perto + frac * (longe - perto), tick)
                if not self._valida(z, velas, entrada):
                    continue
            if (entrada - minima if z.lado == "alta" else maxima - entrada) > desconto * (maxima - minima):
                continue
            rotulo = z.tipo.upper()
            d.desenhos.append({"tipo": "zona", "lado": z.lado, "topo": z.topo, "fundo": z.fundo,
                               "de": velas[z.criada].t.isoformat(), "rotulo": rotulo})
            if lado == "compra":
                stop = z.fundo - self.p["folga_ticks"] * tick
                minimo = entrada + alvo_r * (entrada - stop)
                acima = [p.preco for p in pivos if p.tipo == "topo" and p.preco > minimo]
                alvo = min(acima) if acima else None
            else:
                stop = z.topo + self.p["folga_ticks"] * tick
                minimo = entrada - alvo_r * (stop - entrada)
                abaixo = [p.preco for p in pivos if p.tipo == "fundo" and p.preco < minimo]
                alvo = max(abaixo) if abaixo else None
            if alvo is None:
                d.pensamento.append(f"{rotulo} {preco(z.fundo, tick)}–{preco(z.topo, tick)}: sem alvo à frente; não entro")
                continue
            d.planos.append(Plano(lado, "stop" if gatilho else "limite", entrada, stop, alvo, f"smc-{z.tipo}"))
            d.desenhos.append({"tipo": "linha", "preco": alvo, "rotulo": "liquidez · alvo"})
            onde = (f"stop no rompimento do candle que rejeitou o {rotulo}" if gatilho
                    else f"limitada no {'meio do ' if frac == 0.5 else ''}{rotulo}")
            d.pensamento.append(f"{lado} {onde} em {preco(entrada, tick)}; "
                                f"stop {preco(stop, tick)}, alvo {preco(alvo, tick)}")
        return d

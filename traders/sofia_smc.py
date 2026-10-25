"""Sofia SMC: tendência no 60 minutos, entrada no meio de order block ou FVG do 5 minutos."""
import estudos
from tipos import Decisao, Plano

NOME = "Sofia SMC"
ESTILO = "OB/FVG · tendência 60→5"
PARAMS = {"n": 2, "fvg_min": {"WDO": 1.0, "WIN": 50.0, "EURUSD": 0.0002, "BTCUSDT": 20.0}, "folga_ticks": 2}
GRADE = {"folga_ticks": [1, 2, 3]}


def arredondar_tick(preco, tick):
    return round(preco / tick) * tick


class Trader:
    def __init__(self, ativo, tick, params=None, sessao=None):
        self.ativo, self.tick, self.p = ativo, tick, {**PARAMS, **(params or {})}
        self.sessao = sessao  # a Sofia não depende do horário da sessão; fica para os traders que dependerem

    def _valida(self, z, hoje5, entrada):
        """Zona ainda serve: ninguém fechou do outro lado dela nem passou 1 tick da entrada depois de criada."""
        for k in hoje5[z.criada + 1:]:
            if z.lado == "alta" and (k.c < z.fundo or k.l <= entrada - self.tick):
                return False
            if z.lado == "baixa" and (k.c > z.topo or k.h >= entrada + self.tick):
                return False
        return True

    def decidir(self, hoje5, ontem5, fechados60):
        n, tick = self.p["n"], self.tick
        tend = estudos.tendencia(fechados60, n)
        if tend is None:
            return Decisao(pensamento=["sem tendência definida no 60; não opero"])
        lado = "compra" if tend == "alta" else "venda"
        d = Decisao(pensamento=[f"tendência do 60: {tend}; só {lado}"])

        # zonas só de hoje: vencem no fim do dia
        zonas = estudos.fvgs(hoje5, self.p["fvg_min"].get(self.ativo, 2 * self.tick)) + estudos.order_blocks(hoje5, n)
        pivos = estudos.pivos(ontem5 + hoje5, n)
        for z in (z for z in zonas if z.lado == tend):
            entrada = arredondar_tick((z.topo + z.fundo) / 2, tick)
            if not self._valida(z, hoje5, entrada):
                continue
            rotulo = z.tipo.upper()
            d.desenhos.append({"tipo": "zona", "lado": z.lado, "topo": z.topo, "fundo": z.fundo,
                               "de": hoje5[z.criada].t.isoformat(), "rotulo": rotulo})
            if lado == "compra":
                stop = z.fundo - self.p["folga_ticks"] * tick
                acima = [p.preco for p in pivos if p.tipo == "topo" and p.preco > entrada]
                alvo = min(acima) if acima else None
            else:
                stop = z.topo + self.p["folga_ticks"] * tick
                abaixo = [p.preco for p in pivos if p.tipo == "fundo" and p.preco < entrada]
                alvo = max(abaixo) if abaixo else None
            if alvo is None:
                d.pensamento.append(f"{rotulo} {z.fundo:g}–{z.topo:g}: sem alvo à frente; não entro")
                continue
            d.planos.append(Plano(lado, "limite", entrada, stop, alvo, f"smc-{z.tipo}"))
            d.desenhos.append({"tipo": "linha", "preco": alvo, "rotulo": "liquidez · alvo"})
            d.pensamento.append(f"{lado} limitada em {entrada:g} no meio do {rotulo}; stop {stop:g}, alvo {alvo:g}")
        return d

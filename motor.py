"""Contas simuladas dos traders: dimensiona e confere cada ordem pelas skills e executa candle a candle."""
import importlib.util
import json
import os
import shutil

AQUI = os.path.dirname(os.path.abspath(__file__))
SKILLS = os.path.join(AQUI, ".claude", "skills")
EXEMPLO_CONFIG = os.path.join(SKILLS, "trader-budget", "config.example.json")


def _skill(caminho, nome):
    spec = importlib.util.spec_from_file_location(nome, os.path.join(SKILLS, caminho))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


size = _skill("trader-budget/size.py", "skill_size")    # dimensionar(), ATIVOS, Recusa
check = _skill("trader-risk/check.py", "skill_check")  # checar()


def carregar_config(caminho="trader/config.json"):
    """Lê as regras; na primeira vez copia o modelo da skill trader-budget."""
    if not os.path.exists(caminho):
        os.makedirs(os.path.dirname(caminho) or ".", exist_ok=True)
        shutil.copy(EXEMPLO_CONFIG, caminho)
    with open(caminho, encoding="utf-8") as f:
        return json.load(f)


class Conta:
    def __init__(self, nome, ativo, cfg):
        self.nome, self.ativo, self.cfg = nome, ativo, cfg
        self.tick = size.ATIVOS[ativo]["tick"]
        self.ponto_rs = size.ATIVOS[ativo]["ponto_rs"]
        self.custo = cfg["ativos"][ativo]["custo_por_contrato"]
        self.saldo = float(cfg["capital"])
        self.pendentes, self.posicao = [], None
        self.dia = {"data": None, "trades": 0, "stops": 0, "resultado": 0.0, "posicao_aberta": False}
        self.operacoes, self.equity = [], []

    def _ev(self, t, tipo, **extra):
        return {"t": t.isoformat(), "trader": self.nome, "tipo": tipo, **extra}

    def _novo_dia(self, d):
        if self.dia["data"] != d.isoformat():
            self.dia = {"data": d.isoformat(), "trades": 0, "stops": 0, "resultado": 0.0,
                        "posicao_aberta": self.posicao is not None}

    def colocar(self, planos, agora, simbolo):
        """Troca as ordens pendentes pelos planos que passarem no trader-budget e no trader-risk."""
        self._novo_dia(agora.date())
        if self.posicao:
            return []
        self.pendentes, eventos = [], []
        for p in planos:
            plano = {"simbolo": simbolo, "lado": p.lado, "tipo": p.tipo, "entrada": p.entrada,
                     "stop": p.stop, "alvo": p.alvo, "setup": p.setup}
            try:
                ordem, _, _ = size.dimensionar(plano, self.cfg, agora.date().isoformat())
            except size.Recusa as e:
                eventos.append(self._ev(agora, "block", plano=plano, motivos=[str(e)]))
                continue
            r = check.checar([ordem], self.cfg, dict(self.dia), agora)[0]
            if not r["ok"]:
                eventos.append(self._ev(agora, "block", plano=plano, motivos=r["motivos"]))
                continue
            self.pendentes.append(ordem)
            eventos.append(self._ev(agora, "ordem", lado=p.lado, tipo_ordem=p.tipo, contratos=ordem["contratos"],
                                    entrada=p.entrada, stop=p.stop, alvo=p.alvo, setup=p.setup))
        return eventos

    def executar_candle(self, c, ultimo_do_dia):
        self._novo_dia(c.t.date())
        eventos = []
        if self.posicao is None and self.pendentes:
            eventos += self._tentar_entrada(c)
        elif self.posicao:
            eventos += self._conferir_saida(c, candle_da_entrada=False)
        if ultimo_do_dia:
            if self.posicao:
                sinal = 1 if self.posicao["lado"] == "compra" else -1
                eventos += self._sair(c.c - sinal * self.tick, c.t, "zeragem")
            self.pendentes = []
            self.equity.append((c.t, round(self.saldo, 2)))
        return eventos

    def _tentar_entrada(self, c):
        tick, cand = self.tick, []
        for o in self.pendentes:
            if o["tipo"] == "mercado":
                cand.append((0.0, o, c.o))
            elif o["lado"] == "compra" and c.l <= o["entrada"] - tick:
                cand.append((abs(o["entrada"] - c.o), o, o["entrada"]))
            elif o["lado"] == "venda" and c.h >= o["entrada"] + tick:
                cand.append((abs(o["entrada"] - c.o), o, o["entrada"]))
        if not cand:
            return []
        _, o, preco = min(cand, key=lambda x: x[0])  # a mais perto da abertura foi tocada primeiro
        self.pendentes = []
        self.posicao = {"lado": o["lado"], "contratos": o["contratos"], "entrada": preco, "stop": o["stop"],
                        "alvo": o["alvo"], "entrada_t": c.t, "setup": o["plano"]["setup"]}
        self.dia["trades"] += 1
        self.dia["posicao_aberta"] = True
        eventos = [self._ev(c.t, "entrada", lado=o["lado"], contratos=o["contratos"], preco=preco,
                            stop=o["stop"], alvo=o["alvo"])]
        return eventos + self._conferir_saida(c, candle_da_entrada=True)

    def _conferir_saida(self, c, candle_da_entrada):
        p, tick = self.posicao, self.tick
        if p["lado"] == "compra":
            if not candle_da_entrada and c.o <= p["stop"]:
                return self._sair(c.o - tick, c.t, "stop")
            if c.l <= p["stop"]:
                return self._sair(p["stop"] - tick, c.t, "stop")
            if not candle_da_entrada and c.h >= p["alvo"] + tick:
                return self._sair(p["alvo"], c.t, "alvo")
        else:
            if not candle_da_entrada and c.o >= p["stop"]:
                return self._sair(c.o + tick, c.t, "stop")
            if c.h >= p["stop"]:
                return self._sair(p["stop"] + tick, c.t, "stop")
            if not candle_da_entrada and c.l <= p["alvo"] - tick:
                return self._sair(p["alvo"], c.t, "alvo")
        return []

    def _sair(self, preco, t, motivo):
        p = self.posicao
        sinal = 1 if p["lado"] == "compra" else -1
        resultado = round((preco - p["entrada"]) * sinal * self.ponto_rs * p["contratos"]
                          - 2 * self.custo * p["contratos"], 2)
        self.operacoes.append({"entrada_t": p["entrada_t"].isoformat(), "saida_t": t.isoformat(), "lado": p["lado"],
                               "contratos": p["contratos"], "entrada": p["entrada"], "saida": preco,
                               "resultado_rs": resultado, "motivo_saida": motivo, "setup": p["setup"]})
        self.saldo += resultado
        self.dia["resultado"] += resultado
        self.dia["stops"] += motivo == "stop"
        self.dia["posicao_aberta"] = False
        self.posicao = None
        return [self._ev(t, "saida", motivo=motivo, preco=preco, resultado_rs=resultado)]

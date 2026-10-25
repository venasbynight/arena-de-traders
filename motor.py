"""Contas simuladas dos traders: dimensiona e confere cada ordem pelas skills e executa candle a candle."""
import importlib.util
import json
import os
import shutil
import threading
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
SKILLS = os.path.join(AQUI, ".claude", "skills")
EXEMPLO_CONFIG = os.path.join(SKILLS, "trader-budget", "config.example.json")


def _skill(caminho, nome):
    spec = importlib.util.spec_from_file_location(nome, os.path.join(SKILLS, caminho))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


size = _skill("trader-budget/size.py", "skill_size")    # especificacao(), dimensionar(), Recusa
check = _skill("trader-risk/check.py", "skill_check")  # checar()


def preco(v, tick):
    """Preço com as casas do tick (WDO 5432.5, WIN 128500, EURUSD 1.08612, BTCUSDT 111856.93); sem tick, como veio."""
    return f"{v:.{size.decimais_do_tick(tick)}f}" if tick else f"{v:g}"


def carregar_config(caminho="trader/config.json"):
    """Lê as regras; na primeira vez copia o modelo da skill trader-budget.

    Config antigo ganha do modelo o que falta (usd_brl, ativos que ele não tem e as chaves que faltam nos que
    ele tem), sem mexer nos valores do usuário, e o simbolo_mt5 do Plano 1 vira simbolo + fonte "mt5"; havendo
    mudança, o arquivo é regravado.
    """
    if not os.path.exists(caminho):
        os.makedirs(os.path.dirname(caminho) or ".", exist_ok=True)
        shutil.copy(EXEMPLO_CONFIG, caminho)
    with open(caminho, encoding="utf-8") as f:
        cfg = json.load(f)
    with open(EXEMPLO_CONFIG, encoding="utf-8") as f:
        exemplo = json.load(f)
    antes = json.dumps(cfg, sort_keys=True)
    cfg.setdefault("usd_brl", exemplo["usd_brl"])
    ativos = cfg.setdefault("ativos", {})
    for espec in ativos.values():  # antes de completar, para o símbolo do usuário vencer o do modelo
        if "simbolo_mt5" in espec and "simbolo" not in espec:
            espec["simbolo"] = espec.pop("simbolo_mt5")
            espec.setdefault("fonte", "mt5")
    for ativo, modelo in exemplo["ativos"].items():
        espec = ativos.setdefault(ativo, {})
        for chave, valor in modelo.items():  # terminal, sessao, tick... que faltarem
            espec.setdefault(chave, valor)
    if json.dumps(cfg, sort_keys=True) != antes:
        tmp = f"{caminho}.{os.getpid()}.{threading.get_ident()}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        for tentativa in range(5):  # inteiro ou nada: o config do usuário nunca fica pela metade
            try:
                os.replace(tmp, caminho)
                break
            except PermissionError:  # Windows: quem lê está com o arquivo aberto neste instante
                if tentativa == 4:
                    # não deu em 1 s: o disco fica com o config anterior e o completo vale nesta leitura
                    os.remove(tmp)
                    break
                time.sleep(0.25)
    return cfg


class Conta:
    def __init__(self, nome, ativo, cfg):
        self.nome, self.ativo, self.cfg = nome, ativo, cfg
        spec = size.especificacao(ativo, cfg)  # Recusa se o ativo não está em cfg["ativos"]
        self.tick, self.ponto_rs, self.custo = spec["tick"], spec["ponto_rs"], spec["custo_por_contrato"]
        self.saldo = float(cfg["capital"])
        self.pendentes, self.posicao, self.sair = [], None, False
        self.dia = {"data": None, "trades": 0, "stops": 0, "resultado": 0.0, "posicao_aberta": False}
        self.operacoes, self.equity = [], []

    def _ev(self, t, tipo, **extra):
        return {"t": t.isoformat(), "trader": self.nome, "tipo": tipo, **extra}

    def _novo_dia(self, d):
        if self.dia["data"] != d.isoformat():
            self.dia = {"data": d.isoformat(), "trades": 0, "stops": 0, "resultado": 0.0,
                        "posicao_aberta": self.posicao is not None}

    def colocar(self, planos, agora, simbolo, sair=False):
        """Troca as ordens pendentes pelos planos que passarem no trader-budget e no trader-risk.

        Ordem stop ainda na validade fica (vence sozinha em executar_candle). `sair` com posição aberta = sai a
        mercado na abertura do próximo candle.
        """
        self._novo_dia(agora.date())
        self.sair = bool(sair and self.posicao)
        if self.posicao:
            return []
        # ponytail: stops vivos somam aos planos novos; o Didi nunca manda outro antes de o anterior vencer
        self.pendentes, eventos = [o for o in self.pendentes if o["tipo"] == "stop"], []
        cfg = {**self.cfg, "capital": self.saldo}  # margem e tamanho pelo saldo atual, não pelo inicial
        for p in planos:
            plano = {"simbolo": simbolo, "ativo": self.ativo, "lado": p.lado, "tipo": p.tipo, "entrada": p.entrada,
                     "stop": p.stop, "alvo": p.alvo, "setup": p.setup}
            try:
                ordem, _, _ = size.dimensionar(plano, cfg, agora.date().isoformat())
            except size.Recusa as e:
                eventos.append(self._ev(agora, "block", plano=plano, motivos=[str(e)]))
                continue
            r = check.checar([ordem], cfg, dict(self.dia), agora)[0]  # stop vira mercado ao disparar: confere assim
            if not r["ok"]:
                eventos.append(self._ev(agora, "block", plano=plano, motivos=r["motivos"]))
                continue
            if p.tipo == "stop":
                ordem = {**ordem, "tipo": "stop", "validade": p.validade}
            self.pendentes.append(ordem)
            eventos.append(self._ev(agora, "ordem", lado=p.lado, tipo_ordem=p.tipo, contratos=ordem["contratos"],
                                    entrada=p.entrada, stop=p.stop, alvo=p.alvo, setup=p.setup))
        return eventos

    def executar_candle(self, c, ultimo_do_dia):
        self._novo_dia(c.t.date())
        eventos = []
        if self.posicao is None and self.pendentes:
            eventos += self._tentar_entrada(c) + self._vencer_stops(c)
        elif self.posicao and self.sair:
            eventos += self._sair_no_sinal(c)
        elif self.posicao:
            eventos += self._conferir_saida(c, candle_da_entrada=False)
        if ultimo_do_dia:
            if self.posicao:
                sinal = 1 if self.posicao["lado"] == "compra" else -1
                eventos += self._sair(c.c - sinal * self.tick, c.t, "zeragem")
            eventos += [self._cancelada(o, c.t) for o in self.pendentes if o["tipo"] == "stop"]
            self.pendentes = []
            self.equity.append((c.t, round(self.saldo, 2)))
        return eventos

    def _tentar_entrada(self, c):
        tick, cand = self.tick, []
        for o in self.pendentes:
            if o["tipo"] == "mercado":
                cand.append((0.0, o, c.o))
            elif o["tipo"] == "stop":  # dispara 1 tick além do gatilho; gap executa na abertura, nunca melhor
                if o["lado"] == "compra" and c.h >= o["entrada"] + tick:
                    cand.append((abs(o["entrada"] - c.o), o, max(o["entrada"], c.o)))
                elif o["lado"] == "venda" and c.l <= o["entrada"] - tick:
                    cand.append((abs(o["entrada"] - c.o), o, min(o["entrada"], c.o)))
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

    def _vencer_stops(self, c):
        """Ordem stop que não executou perde um candle de validade; zerou, cancela."""
        eventos, ficam = [], []
        for o in self.pendentes:
            if o["tipo"] == "stop":
                o["validade"] -= 1
                if o["validade"] <= 0:
                    eventos.append(self._cancelada(o, c.t))
                    continue
            ficam.append(o)
        self.pendentes = ficam
        return eventos

    def _cancelada(self, o, t):
        return self._ev(t, "cancelada", lado=o["lado"], tipo_ordem=o["tipo"], entrada=o["entrada"])

    def _sair_no_sinal(self, c):
        """Saída a mercado na abertura, 1 tick pior; se a abertura já passou do stop, é stop."""
        p = self.posicao
        sinal = 1 if p["lado"] == "compra" else -1
        alem_do_stop = (c.o - p["stop"]) * sinal <= 0
        return self._sair(c.o - sinal * self.tick, c.t, "stop" if alem_do_stop else "sinal")

    def _conferir_saida(self, c, candle_da_entrada):
        p, tick = self.posicao, self.tick
        if p["lado"] == "compra":
            if not candle_da_entrada and c.o <= p["stop"]:
                return self._sair(c.o - tick, c.t, "stop")
            if c.l <= p["stop"]:  # a mercado que abriu abaixo do stop sai 1 tick abaixo da entrada, nunca no lucro
                return self._sair(min(p["stop"], p["entrada"]) - tick, c.t, "stop")
            if not candle_da_entrada and c.h >= p["alvo"] + tick:
                return self._sair(p["alvo"], c.t, "alvo")
        else:
            if not candle_da_entrada and c.o >= p["stop"]:
                return self._sair(c.o + tick, c.t, "stop")
            if c.h >= p["stop"]:
                return self._sair(max(p["stop"], p["entrada"]) + tick, c.t, "stop")
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
        self.posicao, self.sair = None, False
        return [self._ev(t, "saida", motivo=motivo, preco=preco, resultado_rs=resultado)]


def placar(operacoes):
    """Números do ranking a partir das operações fechadas."""
    rs = [o["resultado_rs"] for o in operacoes]
    ganhos, perdas = sum(v for v in rs if v > 0), -sum(v for v in rs if v < 0)
    por_dia = {}
    for o in operacoes:
        por_dia[o["entrada_t"][:10]] = por_dia.get(o["entrada_t"][:10], 0.0) + o["resultado_rs"]
    acum, pico, drawdown = 0.0, 0.0, 0.0
    for d in sorted(por_dia):
        acum += por_dia[d]
        pico = max(pico, acum)
        drawdown = min(drawdown, acum - pico)
    n = len(rs)
    return {"resultado": round(sum(rs), 2), "trades": n,
            "acerto": sum(v > 0 for v in rs) / n if n else 0.0,
            "fator_lucro": round(ganhos / perdas, 2) if perdas else None,
            "drawdown": round(drawdown, 2), "pior_dia": round(min(por_dia.values()), 2) if por_dia else 0.0,
            "confianca": "baixa" if n < 50 else "média" if n < 200 else "alta"}


def rodar_backtest(ativo, candles5, modulos_traders, cfg):
    """Roda os traders candle a candle; cada um só vê candles já fechados.

    Cada item de `modulos_traders` é o módulo do trader ou `(módulo, params)`; params None = os PARAMS do módulo.
    """
    from datetime import timedelta
    from dados import agrupar, por_dia

    espec = size.especificacao(ativo, cfg)
    simbolo = ativo  # as skills leem o ativo de plano["ativo"]; o símbolo da corretora não importa aqui
    c60 = agrupar(candles5, 60)
    pares = [m if isinstance(m, tuple) else (m, None) for m in modulos_traders]
    mesa = [(m, m.Trader(ativo, espec["tick"], params, espec["sessao"]), Conta(m.NOME, ativo, cfg))
            for m, params in pares]
    eventos = {m.NOME: [] for m, _ in pares}
    ultimo = {m.NOME: {} for m, _ in pares}  # para não repetir o mesmo estudo/ordem a cada candle

    def novo(nome, chave, valor):
        if ultimo[nome].get(chave) == valor:
            return False
        ultimo[nome][chave] = valor
        return True

    # desenhos "indicadores" (um por candle) viram colunas: k = índice do candle em cujo fechamento ficou conhecido
    series = {m.NOME: {} for m, _ in pares}
    ontem5, k60, n = [], 0, -1
    for hoje in por_dia(candles5).values():
        for i, c in enumerate(hoje):
            n += 1
            fim_do_dia = i == len(hoje) - 1
            for m, _, conta in mesa:
                eventos[m.NOME] += conta.executar_candle(c, fim_do_dia)
            if fim_do_dia:
                continue
            # bloco de 60 fechado: já passou o último candle de 5 min dele, ou é de um dia anterior
            while k60 < len(c60) and (c60[k60].t + timedelta(minutes=55) <= c.t or c60[k60].t.date() < c.t.date()):
                k60 += 1
            fechados60 = c60[max(0, k60 - 200):k60]  # ponytail: 200 candles de 60 bastam para a estrutura
            agora = c.t + timedelta(minutes=5)
            for m, trader, conta in mesa:
                d = trader.decidir(hoje[:i + 1], ontem5, fechados60)
                evs = conta.colocar(d.planos, agora, simbolo, d.sair)
                desenhos = []
                for x in d.desenhos:
                    if x.get("tipo") != "indicadores":
                        desenhos.append(x)
                    elif novo(m.NOME, "indicadores", x):
                        for chave, v in {"k": n, **x}.items():
                            if chave != "tipo":
                                series[m.NOME].setdefault(chave, []).append(v)
                if novo(m.NOME, "estudo", desenhos):
                    eventos[m.NOME].append(conta._ev(agora, "desenho", desenhos=desenhos))
                if novo(m.NOME, "pensamento", d.pensamento):
                    eventos[m.NOME].append(conta._ev(agora, "pensamento", linhas=d.pensamento))
                if novo(m.NOME, "ordens", [{k: v for k, v in e.items() if k != "t"} for e in evs]):
                    eventos[m.NOME] += evs
        ontem5 = hoje

    return {"ativo": ativo,
            "candles": [[k.t.isoformat(), k.o, k.h, k.l, k.c] for k in candles5],
            "traders": {m.NOME: {"estilo": m.ESTILO, "eventos": eventos[m.NOME], "placar": placar(conta.operacoes),
                                 "equity": [[t.isoformat(), s] for t, s in conta.equity],
                                 "operacoes": conta.operacoes,
                                 **({"indicadores": series[m.NOME]} if series[m.NOME] else {})}
                        for m, _, conta in mesa}}

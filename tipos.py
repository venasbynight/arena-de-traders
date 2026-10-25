"""Tipos compartilhados pela arena."""
from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True)
class Candle:
    t: datetime  # abertura do candle, horário de Brasília, sem tzinfo
    o: float
    h: float
    l: float
    c: float
    v: float = 0.0
    delta: float | None = None  # agressão de compra − venda (ticks do MT5); None = sem ticks, não é zero


@dataclass
class Zona:
    criada: int  # índice do candle que confirmou a zona
    lado: str    # "alta" | "baixa"
    topo: float
    fundo: float
    tipo: str    # "fvg" | "ob"


@dataclass(frozen=True)
class Pivo:
    i: int
    conf: int    # índice em que o pivô passa a valer
    tipo: str    # "topo" | "fundo"
    preco: float


@dataclass
class Plano:
    lado: str    # "compra" | "venda"
    tipo: str    # "limite" | "mercado" | "stop" (entrada stop: executa 1 tick além do gatilho em `entrada`)
    entrada: float | None
    stop: float
    alvo: float
    setup: str
    validade: int = 1  # ordem stop: candles de 5 min em que vale; não executou, cancela


@dataclass
class Decisao:
    planos: list = field(default_factory=list)
    desenhos: list = field(default_factory=list)
    pensamento: list = field(default_factory=list)
    sair: bool = False  # fecha a posição aberta na abertura do candle seguinte

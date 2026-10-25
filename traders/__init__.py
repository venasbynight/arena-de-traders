"""Todos os traders da arena, na ordem em que aparecem, e quem trabalha em cada sala."""
from traders import caio_contrafluxo, didi_agulhada, sofia_smc

TODOS = [sofia_smc, didi_agulhada, caio_contrafluxo]
# o Caio precisa do delta (agressor dos negócios): só a B3 tem; EURUSD não tem agressor real e BTC fica para depois
SALAS = {"WDO": TODOS, "WIN": TODOS, "EURUSD": TODOS[:2], "BTCUSDT": TODOS[:2]}

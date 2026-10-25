"""Todos os traders da arena, na ordem em que aparecem, e quem trabalha em cada sala."""
from traders import didi_agulhada, sofia_smc

TODOS = [sofia_smc, didi_agulhada]
SALAS = {"WDO": TODOS, "WIN": TODOS, "EURUSD": TODOS, "BTCUSDT": TODOS}

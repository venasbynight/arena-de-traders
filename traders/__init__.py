"""Todos os traders da arena, na ordem em que aparecem, e quem trabalha em cada sala."""
from traders import sofia_smc

TODOS = [sofia_smc]
SALAS = {"WDO": TODOS, "WIN": TODOS, "EURUSD": TODOS, "BTCUSDT": TODOS}

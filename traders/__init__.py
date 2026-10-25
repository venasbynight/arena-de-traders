"""Todos os traders da arena, na ordem em que aparecem, e quem trabalha em cada sala."""
from traders import sofia_smc, rafa_rompimento, vera_vwap

TODOS = [sofia_smc, rafa_rompimento, vera_vwap]
SALAS = {"WDO": TODOS, "WIN": TODOS, "EURUSD": TODOS, "BTCUSDT": TODOS}

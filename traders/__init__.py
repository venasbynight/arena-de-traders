"""Todos os traders da arena, na ordem em que aparecem, e quem trabalha em cada sala."""
from traders import caio_contrafluxo, didi_agulhada, sofia_smc

TODOS = [sofia_smc, didi_agulhada, caio_contrafluxo]
# o Caio precisa do delta (agressor dos negócios): só a B3 tem; EURUSD não tem agressor real e BTC fica para depois
SEM_DELTA = TODOS[:2]  # quem opera sem o agressor: os demais ativos do config (ações, forex, cripto) no backtest
SALAS = {"WDO": TODOS, "WIN": TODOS, "EURUSD": SEM_DELTA, "BTCUSDT": SEM_DELTA}

# Dois grupos de trabalho, como no config.example.json: Brasil = ativos da B3 (sessao.feriados_b3), Global = forex e cripto
GRUPOS = {
    "Brasil": ["WDO", "WIN", "PETR4", "VALE3", "ITUB4", "BBDC4", "AXIA3", "BBAS3", "SBSP3", "PETR3", "EMBJ3", "PRIO3",
               "RENT3", "EQTL3"],
    "Global": ["EURUSD", "BTCUSDT", "ETHUSDT", "USDJPY", "GBPUSD", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD"],
}


def grupo_do_ativo(ativo):
    """"Brasil" para os ativos da B3; qualquer outro (forex, cripto, desconhecido) é "Global"."""
    return "Brasil" if ativo in GRUPOS["Brasil"] else "Global"

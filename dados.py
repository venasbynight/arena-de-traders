"""Candles: arquivo CSV, agrupamento por tempo gráfico e histórico do MT5."""
import csv
import os
from datetime import date, datetime, timedelta, timezone

from tipos import Candle


class ErroDados(Exception):
    """Problema com os dados, com mensagem pronta para o usuário."""

CAMPOS = ["t", "o", "h", "l", "c", "v", "delta"]


def salvar_csv(candles, caminho):
    with open(caminho, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(CAMPOS)
        for k in candles:
            w.writerow([k.t.isoformat(), k.o, k.h, k.l, k.c, k.v, k.delta])


def ler_csv(caminho):
    with open(caminho, newline="", encoding="utf-8") as f:
        return [Candle(datetime.fromisoformat(r["t"]), float(r["o"]), float(r["h"]), float(r["l"]),
                       float(r["c"]), float(r["v"]), float(r["delta"])) for r in csv.DictReader(f)]


def por_dia(candles):
    dias = {}
    for k in candles:
        dias.setdefault(k.t.date(), []).append(k)
    return dias


def agrupar(candles, minutos):
    """Agrupa em blocos de `minutos`, ancorados no primeiro candle de cada dia."""
    out = []
    for dia in por_dia(candles).values():
        inicio = dia[0].t
        blocos = {}
        for k in dia:
            n = int((k.t - inicio).total_seconds() // (minutos * 60))
            blocos.setdefault(n, []).append(k)
        for b in blocos.values():
            out.append(Candle(b[0].t, b[0].o, max(k.h for k in b), min(k.l for k in b), b[-1].c,
                              sum(k.v for k in b), sum(k.delta for k in b)))
    return out


def baixar_mt5(simbolo, de, ate, mt5=None):
    """Candles de 5 min de `de` até `ate` (inclusive) do MT5 aberto e logado pelo usuário."""
    if mt5 is None:
        try:
            import MetaTrader5 as mt5
        except ImportError:
            raise ErroDados("pacote MetaTrader5 não instalado: rode  python -m pip install MetaTrader5")
    if not mt5.initialize():
        raise ErroDados(f"não consegui falar com o MetaTrader 5: abra o MT5 e faça login ({mt5.last_error()})")
    if not mt5.symbol_select(simbolo, True):
        raise ErroDados(f"símbolo {simbolo} não encontrado no MT5; ajuste 'simbolo_mt5' em trader/config.json")
    inicio = datetime(de.year, de.month, de.day)
    taxas = mt5.copy_rates_range(simbolo, mt5.TIMEFRAME_M5, inicio, inicio + timedelta(days=(ate - de).days + 1))
    if taxas is None:
        raise ErroDados(f"o MT5 não devolveu candles de {simbolo}: {mt5.last_error()}")
    # O MT5 grava o horário do servidor como se fosse UTC; nas corretoras da B3 ele é o de Brasília.
    return [Candle(datetime.fromtimestamp(int(r["time"]), timezone.utc).replace(tzinfo=None),
                   float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"]), float(r["real_volume"]))
            for r in taxas]


def _dias_uteis(de, ate):
    return {de + timedelta(days=k) for k in range((ate - de).days + 1) if (de + timedelta(days=k)).weekday() < 5}


def historico(ativo, de, ate, cfg, pasta="dados", mt5=None, hoje=None):
    """Candles de 5 min do ativo no intervalo, do cache em `pasta` ou baixados do MT5."""
    os.makedirs(pasta, exist_ok=True)
    arq = os.path.join(pasta, f"{ativo}_M5.csv")
    arq_cob = os.path.join(pasta, f"{ativo}_M5.cobertura.csv")
    candles = ler_csv(arq) if os.path.exists(arq) else []
    cobertos = set()
    if os.path.exists(arq_cob):
        with open(arq_cob, encoding="utf-8") as f:
            for linha in f:
                a, b = linha.strip().split(",")
                cobertos |= _dias_uteis(date.fromisoformat(a), date.fromisoformat(b))

    faltam = _dias_uteis(de, ate) - cobertos
    if faltam:
        novos = baixar_mt5(cfg["ativos"][ativo]["simbolo_mt5"], min(faltam), max(faltam), mt5)
        unicos = {k.t: k for k in candles}
        unicos.update({k.t: k for k in novos})
        candles = sorted(unicos.values(), key=lambda k: k.t)
        salvar_csv(candles, arq)
        # o dia de hoje ainda está acontecendo: não conta como coberto
        fim = min(max(faltam), (hoje or date.today()) - timedelta(days=1))
        if fim >= min(faltam):
            with open(arq_cob, "a", encoding="utf-8") as f:
                f.write(f"{min(faltam).isoformat()},{fim.isoformat()}\n")
    return [k for k in candles if de <= k.t.date() <= ate]

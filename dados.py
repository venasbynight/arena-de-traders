"""Candles: arquivo CSV, agrupamento por tempo gráfico e histórico do MT5 e da Binance."""
import csv
import json
import os
import urllib.error
import urllib.parse
import urllib.request
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


def baixar_binance(simbolo, de, ate, abrir_url=None):
    """Candles de 5 min de `de` até `ate` (inclusive) da Binance, com `t` em horário de Brasília (UTC-3).

    `abrir_url` substitui urllib.request.urlopen (os testes injetam um falso).
    """
    abrir = abrir_url or urllib.request.urlopen
    brasilia = timedelta(hours=3)
    # o dia de Brasília começa 03:00 UTC; a Binance conta em milissegundos desde 1970 (UTC)
    inicio = int((datetime(de.year, de.month, de.day) + brasilia - datetime(1970, 1, 1)).total_seconds() * 1000)
    fim = inicio + ((ate - de).days + 1) * 86400000 - 1
    out = []
    while inicio <= fim:
        url = "https://api.binance.com/api/v3/klines?" + urllib.parse.urlencode(
            {"symbol": simbolo, "interval": "5m", "startTime": inicio, "endTime": fim, "limit": 1000})
        try:
            with abrir(url, timeout=30) as r:
                klines = json.loads(r.read())
        except urllib.error.HTTPError as e:
            with e:  # fecha a resposta de erro
                if e.code in (418, 429) or e.code >= 500:  # 418: IP bloqueado após muitos 429
                    raise ErroDados(f"Binance indisponível agora (HTTP {e.code}); tente de novo em alguns minutos")
                try:
                    msg = json.loads(e.read()).get("msg", e.reason)
                except ValueError:
                    msg = e.reason
                raise ErroDados(f"a Binance recusou o pedido de {simbolo} (HTTP {e.code}): {msg}")
        except (urllib.error.URLError, TimeoutError) as e:
            raise ErroDados(f"Binance indisponível agora ({getattr(e, 'reason', e)}); tente de novo em alguns minutos")
        for k in klines:
            out.append(Candle(datetime.fromtimestamp(k[0] / 1000, timezone.utc).replace(tzinfo=None) - brasilia,
                              float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5]), 0.0))
        if len(klines) < 1000:
            break
        inicio = klines[-1][0] + 300000  # próxima página começa depois do último candle recebido
    return out


def baixar_mt5(simbolo, de, ate, mt5=None, terminal=None, deslocamento_h=0):
    """Candles de 5 min de `de` até `ate` (inclusive) do MT5 aberto e logado pelo usuário.

    `terminal` é o terminal64.exe a usar (vários MT5 podem estar abertos); `deslocamento_h` é quantas horas
    o relógio do servidor da corretora está à frente de Brasília (0 na Genial).
    """
    if mt5 is None:
        try:
            import MetaTrader5 as mt5
        except ImportError:
            raise ErroDados("pacote MetaTrader5 não instalado: rode  python -m pip install MetaTrader5")
    if not (mt5.initialize(path=terminal) if terminal else mt5.initialize()):
        raise ErroDados(f"não consegui falar com o MetaTrader 5: abra o MT5 e faça login ({mt5.last_error()})")
    try:
        if not mt5.symbol_select(simbolo, True):
            raise ErroDados(f"símbolo {simbolo} não encontrado no MT5; ajuste 'simbolo' em trader/config.json")
        desloc = timedelta(hours=deslocamento_h)
        # o pedido também é feito no relógio do servidor; o pacote lê datetime sem fuso como horário do PC
        # (UTC-3 aqui, o que cortava as 3 primeiras horas do dia), então vai com tzinfo=UTC; o fim é inclusivo
        inicio = datetime(de.year, de.month, de.day, tzinfo=timezone.utc) + desloc
        fim = inicio + timedelta(days=(ate - de).days + 1) - timedelta(seconds=1)
        taxas = mt5.copy_rates_range(simbolo, mt5.TIMEFRAME_M5, inicio, fim)
        if taxas is None:
            raise ErroDados(f"o MT5 não devolveu candles de {simbolo}: {mt5.last_error()}")
    finally:
        mt5.shutdown()  # solta este terminal; o próximo ativo pode usar outro
    # O MT5 grava o horário do servidor como se fosse UTC; tira o deslocamento para chegar em Brasília.
    # Medido em 25/10/2026: o servidor MetaQuotes-Demo é UTC+3 no horário de verão da Europa (6 h à frente de
    # Brasília: NFP de 02/10 às 15:30 do servidor = 09:30 em Brasília) e UTC+2 no inverno (5 h). A Genial é 0.
    return [Candle(datetime.fromtimestamp(int(r["time"]), timezone.utc).replace(tzinfo=None) - desloc,
                   float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"]), float(r["real_volume"]))
            for r in taxas]


def _dias_de_sessao(de, ate, dias=(0, 1, 2, 3, 4)):
    """Dias do intervalo em que o ativo opera (`dias`: 0 = segunda ... 6 = domingo)."""
    return {de + timedelta(days=k) for k in range((ate - de).days + 1) if (de + timedelta(days=k)).weekday() in dias}


def historico(ativo, de, ate, cfg, pasta="dados", mt5=None, hoje=None, abrir_url=None):
    """Candles de 5 min do ativo no intervalo, do cache em `pasta` ou baixados da fonte do ativo (MT5 ou Binance)."""
    espec = cfg["ativos"].get(ativo, {})
    fonte = espec.get("fonte", "mt5")
    if fonte not in ("mt5", "binance"):
        raise ErroDados(f"fonte '{fonte}' desconhecida em {ativo}; use 'mt5' ou 'binance' em trader/config.json")
    dias = espec.get("sessao", {}).get("dias", (0, 1, 2, 3, 4))
    os.makedirs(pasta, exist_ok=True)
    arq = os.path.join(pasta, f"{ativo}_M5.csv")
    arq_cob = os.path.join(pasta, f"{ativo}_M5.cobertura.csv")
    candles = ler_csv(arq) if os.path.exists(arq) else []
    cobertos = set()
    if os.path.exists(arq_cob):
        with open(arq_cob, encoding="utf-8") as f:
            for linha in f:
                a, b = linha.strip().split(",")
                cobertos |= _dias_de_sessao(date.fromisoformat(a), date.fromisoformat(b), dias)

    faltam = _dias_de_sessao(de, ate, dias) - cobertos
    if faltam:
        simbolo = espec.get("simbolo") or espec.get("simbolo_mt5") or f"{ativo}$"  # simbolo_mt5: config antigo
        if fonte == "binance":
            novos = baixar_binance(simbolo, min(faltam), max(faltam), abrir_url)
        else:
            novos = baixar_mt5(simbolo, min(faltam), max(faltam), mt5, espec.get("terminal"),
                               espec.get("deslocamento_h", 0))
        unicos = {k.t: k for k in candles}
        unicos.update({k.t: k for k in novos})
        candles = sorted(unicos.values(), key=lambda k: k.t)
        salvar_csv(candles, arq)
        # cobre só até o último dia que veio de fato (o MT5 pode ainda estar sincronizando);
        # o dia de hoje ainda está acontecendo e nunca conta como coberto
        fim = min(max(k.t.date() for k in novos) if novos else min(faltam) - timedelta(days=1),
                  (hoje or date.today()) - timedelta(days=1))
        if fim >= min(faltam):
            with open(arq_cob, "a", encoding="utf-8") as f:
                f.write(f"{min(faltam).isoformat()},{fim.isoformat()}\n")
    return [k for k in candles if de <= k.t.date() <= ate]

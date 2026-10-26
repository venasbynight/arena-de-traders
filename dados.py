"""Candles: arquivo CSV, agrupamento por tempo gráfico e histórico do MT5 e da Binance."""
import csv
import functools
import http.client
import json
import os
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import replace
from datetime import date, datetime, time, timedelta, timezone

from tipos import Candle


class ErroDados(Exception):
    """Problema com os dados, com mensagem pronta para o usuário."""

CAMPOS = ["t", "o", "h", "l", "c", "v", "delta"]


def salvar_csv(candles, caminho):
    """Grava num arquivo temporário e troca no fim: queda no meio da escrita não deixa o cache pela metade."""
    temporario = f"{caminho}.{os.getpid()}.{threading.get_ident()}.tmp"  # único por processo e thread
    with open(temporario, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(CAMPOS)
        for k in candles:
            w.writerow([k.t.isoformat(), k.o, k.h, k.l, k.c, k.v, "" if k.delta is None else k.delta])
    os.replace(temporario, caminho)


def ler_csv(caminho):
    try:
        with open(caminho, newline="", encoding="utf-8") as f:
            return [Candle(datetime.fromisoformat(r["t"]), float(r["o"]), float(r["h"]), float(r["l"]),
                           float(r["c"]), float(r["v"]), None if r["delta"] == "" else float(r["delta"]))
                    for r in csv.DictReader(f)]
    except (TypeError, ValueError, KeyError):  # linha cortada: campo faltando (None) ou número/data pela metade
        raise ErroDados(f"cache corrompido em {caminho}; apague-o e rode de novo")


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
                              sum(k.v for k in b), None if any(k.delta is None for k in b) else sum(k.delta for k in b)))
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
        except (OSError, http.client.HTTPException, ValueError) as e:  # rede, resposta cortada, JSON ruim
            raise ErroDados(f"Binance indisponível agora ({getattr(e, 'reason', e)}); tente de novo em alguns minutos")
        for k in klines:
            out.append(Candle(datetime.fromtimestamp(k[0] / 1000, timezone.utc).replace(tzinfo=None) - brasilia,
                              float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])))
        if len(klines) < 1000:
            break
        inicio = klines[-1][0] + 300000  # próxima página começa depois do último candle recebido
    return out


@functools.lru_cache(maxsize=None)
def _verao_europeu(ano):
    """Início e fim (UTC) do horário de verão europeu: último domingo de março e de outubro, 01:00 UTC."""
    def ultimo_domingo(mes):  # março e outubro têm 31 dias
        d = date(ano, mes, 31)
        return datetime.combine(d - timedelta(days=(d.weekday() + 1) % 7), time(1))
    return ultimo_domingo(3), ultimo_domingo(10)


def _conversores(fuso_servidor, deslocamento_h):
    """(Brasília -> servidor, servidor -> Brasília) sobre datetimes sem fuso; Brasília é UTC-3 fixo.

    "brasilia": o servidor já marca Brasília (Genial). "europa": o servidor MetaQuotes marca UTC+2 e, no verão
    europeu, UTC+3; a regra vale para o relógio do próprio candle, então a história inteira sai certa.
    `deslocamento_h` (config antigo), quando informado, vale no lugar: horas fixas do servidor à frente de Brasília.
    """
    if deslocamento_h is not None:
        d = timedelta(hours=deslocamento_h)
        return (lambda b: b + d), (lambda s: s - d)
    if fuso_servidor == "brasilia":
        return (lambda b: b), (lambda s: s)
    if fuso_servidor == "europa":
        def verao(utc):
            ini, fim = _verao_europeu(utc.year)
            return ini <= utc < fim

        def para_servidor(brasilia):
            utc = brasilia + timedelta(hours=3)
            return utc + timedelta(hours=3 if verao(utc) else 2)

        def para_brasilia(servidor):
            utc = servidor - timedelta(hours=2)  # supõe inverno; se cair no verão, o servidor estava 1 h mais à frente
            if verao(utc):
                utc -= timedelta(hours=1)
            return utc - timedelta(hours=3)
        # na virada de outono o relógio repete 03:00-03:59 (domingo, sem pregão): vale a leitura de inverno
        return para_servidor, para_brasilia
    raise ErroDados(f"fuso_servidor '{fuso_servidor}' desconhecido; use 'brasilia' ou 'europa' em trader/config.json")


BLOCO_DIAS_MT5 = 180  # 300 dias de 5 min passaram no teste de 26/10/2026; 365 não
TEMPOS_MT5 = {5: ("M5", "TIMEFRAME_M5"), 60: ("H1", "TIMEFRAME_H1")}  # tf em minutos: sufixo do cache, constante do MT5


def _consultar_mt5(mt5, simbolo, inicio, fim, terminal, tf=5):
    """Fala com o MT5 (`mt5` é o módulo MetaTrader5 ou um falso) e devolve as taxas como lista de dicts."""
    if not (mt5.initialize(path=terminal) if terminal else mt5.initialize()):
        raise ErroDados(f"não consegui falar com o MetaTrader 5: abra o MT5 e faça login ({mt5.last_error()})")
    try:
        if not mt5.symbol_select(simbolo, True):
            raise ErroDados(f"símbolo {simbolo} não encontrado no MT5; ajuste 'simbolo' em trader/config.json")
        out, de = [], inicio
        while de <= fim:  # em blocos: a Genial responde "Invalid params" a um ano de 5 min de uma vez
            ate = min(fim, de + timedelta(days=BLOCO_DIAS_MT5, seconds=-1))
            taxas = mt5.copy_rates_range(simbolo, getattr(mt5, TEMPOS_MT5[tf][1]), de, ate)
            if taxas is None:
                raise ErroDados(f"o MT5 não devolveu candles de {simbolo}: {mt5.last_error()}")
            out += [{c: float(r[c]) for c in ("time", "open", "high", "low", "close", "real_volume", "tick_volume")}
                    for r in taxas]
            de = ate + timedelta(seconds=1)
        return out
    finally:
        mt5.shutdown()  # solta este terminal; o próximo ativo pode usar outro


def _importar_mt5():
    try:
        import MetaTrader5
    except ImportError:
        raise ErroDados("pacote MetaTrader5 não instalado: rode  python -m pip install MetaTrader5")
    return MetaTrader5


TICK_FLAG_BUY, TICK_FLAG_SELL = 32, 64  # marcas de agressor do pacote MetaTrader5
MESES_B3 = "FGHJKMNQUVXZ"  # letra do mês de vencimento: WINZ26 = dezembro de 2026
BLOCO_TICKS = 500_000      # o WIN tem ~3 milhões de negócios por dia: lista Python em pedaços, não de uma vez


def somar_delta(acc, tempos_ms, flags, volumes):
    """Soma em `acc` {candle de 5 min (ms // 300000): agressão de compra − venda} dos negócios do MT5.

    Negócio com os dois agressores marcados ou com nenhum (leilão, direto) não conta.
    """
    for t, f, v in zip(tempos_ms, flags, volumes):
        compra = f & TICK_FLAG_BUY
        if bool(compra) != bool(f & TICK_FLAG_SELL):
            acc[t // 300000] = acc.get(t // 300000, 0) + (v if compra else -v)
    return acc


def _candidatos(simbolo, dia):
    """Série contínua (WIN$) e os vencimentos do mês e dos 2 seguintes: na Genial a WIN$ só tem ticks recentes."""
    if not simbolo.endswith("$"):
        return [simbolo]
    meses = [dia.month - 1 + k for k in range(3)]
    return [simbolo] + [f"{simbolo[:-1]}{MESES_B3[m % 12]}{(dia.year + m // 12) % 100:02d}" for m in meses]


def _lista(coluna):
    return coluna.tolist() if hasattr(coluna, "tolist") else list(coluna)  # numpy do MT5 ou lista do teste


def _consultar_delta(mt5, simbolo, volumes, terminal, fuso_servidor, deslocamento_h):
    """{dia: [símbolo, {candle (Brasília, iso): delta}]} dos dias de `volumes` ({dia iso: volume dos candles}).

    Vale o primeiro candidato cujos negócios do dia somam pelo menos metade do volume dos candles (um vencimento de
    trás tem poucos negócios e daria um delta falso); sem nenhum, o dia fica de fora.
    """
    para_servidor, para_brasilia = _conversores(fuso_servidor, deslocamento_h)
    if not (mt5.initialize(path=terminal) if terminal else mt5.initialize()):
        raise ErroDados(f"não consegui falar com o MetaTrader 5: abra o MT5 e faça login ({mt5.last_error()})")
    try:
        ligados, out = {}, {}
        for dia_iso, vol_candles in volumes.items():
            dia = date.fromisoformat(dia_iso)
            ini = para_servidor(datetime(dia.year, dia.month, dia.day))  # o pacote lê o relógio do servidor como UTC
            de, ate = (x.replace(tzinfo=timezone.utc) for x in (ini, ini + timedelta(days=1, seconds=-1)))
            for s in _candidatos(simbolo, dia):
                if s not in ligados:
                    ligados[s] = mt5.symbol_select(s, True)
                ticks = mt5.copy_ticks_range(s, de, ate, mt5.COPY_TICKS_TRADE) if ligados[s] else None
                if ticks is None:
                    continue
                acc, vol = {}, 0
                for i in range(0, len(ticks["time_msc"]), BLOCO_TICKS):
                    t, f, v = (_lista(ticks[c][i:i + BLOCO_TICKS]) for c in ("time_msc", "flags", "volume"))
                    somar_delta(acc, t, f, v)
                    vol += sum(v)
                if vol and 2 * vol >= vol_candles:
                    out[dia_iso] = [s, {para_brasilia(datetime(1970, 1, 1) + timedelta(seconds=300 * b)).isoformat(): d
                                        for b, d in sorted(acc.items())}]
                    break
        return out
    finally:
        mt5.shutdown()


def baixar_delta_mt5(simbolo, volumes, mt5=None, terminal=None, deslocamento_h=None, fuso_servidor="brasilia",
                     timeout_s=600):
    """Delta por candle de 5 min dos dias de `volumes` ({date: volume dos candles do dia}), dos ticks de negócio.

    Os ticks são somados no processo filho e nunca vão para o disco. Com `mt5` (falso dos testes), aqui mesmo.
    """
    vols = {d.isoformat(): v for d, v in volumes.items()}
    if mt5 is not None:
        return _consultar_delta(mt5, simbolo, vols, terminal, fuso_servidor, deslocamento_h)
    return _consultar_mt5_isolado({"tipo": "delta", "simbolo": simbolo, "volumes": vols, "terminal": terminal,
                                   "fuso_servidor": fuso_servidor, "deslocamento_h": deslocamento_h}, timeout_s)


def _filho_mt5(pasta):
    """Corpo do processo filho: lê pedido.json, consulta o MT5 e grava saida.json (resultado ou erro)."""
    with open(os.path.join(pasta, "pedido.json"), encoding="utf-8") as f:
        p = json.load(f)
    try:
        mt5 = _importar_mt5()
        if p.get("tipo") == "delta":
            r = _consultar_delta(mt5, p["simbolo"], p["volumes"], p["terminal"], p["fuso_servidor"],
                                 p["deslocamento_h"])
        else:
            r = _consultar_mt5(mt5, p["simbolo"], datetime.fromisoformat(p["inicio"]),
                               datetime.fromisoformat(p["fim"]), p["terminal"], p.get("tf", 5))
        saida = {"resultado": r}
    except ErroDados as e:
        saida = {"erro": str(e)}
    except Exception as e:
        saida = {"erro": f"falha ao falar com o MetaTrader 5: {type(e).__name__}: {e}"}
    with open(os.path.join(pasta, "saida.json"), "w", encoding="utf-8") as f:
        json.dump(saida, f)


def _consultar_mt5_isolado(pedido, timeout_s):
    """`pedido` (candles ou delta) num processo filho: um terminal que pendura (a Genial sem o feed liberado
    bloqueia `initialize` e `copy_rates_range` por minutos) é morto em vez de travar o programa.

    O filho não usa pipes (o terminal pode herdá-los e segurar a espera depois do kill); fala por arquivos.
    """
    with tempfile.TemporaryDirectory() as pasta:
        with open(os.path.join(pasta, "pedido.json"), "w", encoding="utf-8") as f:
            json.dump(pedido, f)
        terminal = pedido["terminal"]
        filho = subprocess.Popen([sys.executable, os.path.abspath(__file__), "--mt5-filho", pasta],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))  # sem janela de console
        try:
            filho.wait(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            filho.kill()
            filho.wait()
            raise ErroDados(f"o MT5 ({terminal or 'terminal padrão'}) não respondeu em {timeout_s:g} s; "
                            "abra o terminal, confira o login e tente de novo")
        try:
            with open(os.path.join(pasta, "saida.json"), encoding="utf-8") as f:
                saida = json.load(f)
        except (OSError, ValueError):
            raise ErroDados(f"o MT5 fechou sem responder (código {filho.returncode}); "
                            "abra o terminal, confira o login e tente de novo")
    if "erro" in saida:
        raise ErroDados(saida["erro"])
    return saida["resultado"]


def baixar_mt5(simbolo, de, ate, mt5=None, terminal=None, deslocamento_h=None, fuso_servidor="brasilia",
               timeout_s=90, tf=5):
    """Candles de `tf` min (5 ou 60) de `de` até `ate` (inclusive) do MT5 aberto e logado pelo usuário, em horário de Brasília.

    `terminal` é o terminal64.exe a usar (vários MT5 podem estar abertos). `fuso_servidor` diz como o servidor
    da corretora marca a hora ("brasilia" na Genial, "europa" no MetaQuotes) e `deslocamento_h` é o config
    antigo (horas fixas à frente de Brasília) e vence quando informado.
    Sem `mt5` o download roda num processo filho com prazo de `timeout_s`; com `mt5` (os testes injetam um falso)
    roda neste processo, sem prazo.
    """
    para_servidor, para_brasilia = _conversores(fuso_servidor, deslocamento_h)
    # o pedido também é feito no relógio do servidor; o pacote lê datetime sem fuso como horário do PC
    # (UTC-3 aqui, o que cortava as 3 primeiras horas do dia), então vai com tzinfo=UTC; o fim é inclusivo
    brasilia = datetime(de.year, de.month, de.day)
    inicio = para_servidor(brasilia).replace(tzinfo=timezone.utc)
    fim = para_servidor(brasilia + timedelta(days=(ate - de).days + 1) - timedelta(seconds=1)).replace(tzinfo=timezone.utc)
    if mt5 is None:
        taxas = _consultar_mt5_isolado({"simbolo": simbolo, "inicio": inicio.isoformat(), "fim": fim.isoformat(),
                                        "terminal": terminal, "tf": tf}, timeout_s)
    else:
        taxas = _consultar_mt5(mt5, simbolo, inicio, fim, terminal, tf)
    # O MT5 grava o horário do servidor como se fosse UTC. Medido em 25/10/2026: o MetaQuotes-Demo é UTC+3 no
    # verão europeu (NFP de 02/10 às 15:30 do servidor = 09:30 em Brasília) e UTC+2 no inverno; a Genial é Brasília.
    # Forex não tem volume real (tudo 0): aí vale o volume de ticks. Com volume real na série (B3) ele vale
    # sempre, inclusive 0 num candle sem negócios.
    campo_volume = "real_volume" if any(r["real_volume"] for r in taxas) else "tick_volume"
    return [Candle(para_brasilia(datetime.fromtimestamp(int(r["time"]), timezone.utc).replace(tzinfo=None)),
                   float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"]), float(r[campo_volume]))
            for r in taxas]


def no_tick(candles, tick):
    """Preços arredondados ao tick do ativo (sem tick no config, nada muda).

    A série contínua da B3 (WDO$, WIN$) vem ajustada pela rolagem, com preços fora do tick, e o trader-budget
    recusa toda ordem fora do tick. O round() do Python empata para o par: 5432,25 com tick 0,5 vira 5432,0.
    Máxima e mínima continuam cobrindo abertura e fechamento depois do arredondamento.
    """
    if not tick:
        return candles
    r = lambda p: round(round(p / tick) * tick, 10)
    out = []
    for k in candles:
        o, c = r(k.o), r(k.c)
        out.append(Candle(k.t, o, max(r(k.h), o, c), min(r(k.l), o, c), c, k.v, k.delta))
    return out


def _dias_de_sessao(de, ate, dias=(0, 1, 2, 3, 4)):
    """Dias do intervalo em que o ativo opera (`dias`: 0 = segunda ... 6 = domingo)."""
    return {de + timedelta(days=k) for k in range((ate - de).days + 1) if (de + timedelta(days=k)).weekday() in dias}


def _hoje_brasilia():
    return datetime.now(timezone(timedelta(hours=-3))).date()


_trava = threading.Lock()  # o servidor HTTP é multithread: ler cache, baixar e gravar não pode se cruzar


def historico(ativo, de, ate, cfg, pasta="dados", mt5=None, hoje=None, abrir_url=None):
    """Candles de 5 min do ativo no intervalo, do cache em `pasta` ou baixados da fonte do ativo (MT5 ou Binance).

    Só devolve os dias em que o ativo opera (`sessao.dias`): o forex reabre domingo à noite, mas EURUSD é seg-sex.
    """
    with _trava:
        return _historico(ativo, de, ate, cfg, pasta, mt5, hoje, abrir_url)


def _historico(ativo, de, ate, cfg, pasta, mt5, hoje, abrir_url):
    espec = cfg["ativos"].get(ativo, {})
    fonte = espec.get("fonte", "mt5")
    if fonte not in ("mt5", "binance"):
        raise ErroDados(f"fonte '{fonte}' desconhecida em {ativo}; use 'mt5' ou 'binance' em trader/config.json")
    dias = espec.get("sessao", {}).get("dias", (0, 1, 2, 3, 4))
    tf = espec.get("tf", 5)  # ações da sala de opções: 60 (cache <ativo>_H1.csv)
    os.makedirs(pasta, exist_ok=True)
    arq = os.path.join(pasta, f"{ativo}_{TEMPOS_MT5[tf][0]}.csv")
    arq_cob = os.path.join(pasta, f"{ativo}_{TEMPOS_MT5[tf][0]}.cobertura.csv")
    candles = ler_csv(arq) if os.path.exists(arq) else []
    cobertos = set()
    if os.path.exists(arq_cob):
        try:
            with open(arq_cob, encoding="utf-8") as f:
                for linha in f:
                    a, b = linha.strip().split(",")
                    cobertos |= _dias_de_sessao(date.fromisoformat(a), date.fromisoformat(b), dias)
        except ValueError:
            raise ErroDados(f"cache corrompido em {arq_cob}; apague-o e rode de novo")

    faltam = _dias_de_sessao(de, ate, dias) - cobertos
    if faltam:
        simbolo = espec.get("simbolo") or espec.get("simbolo_mt5") or f"{ativo}$"  # simbolo_mt5: config antigo
        if fonte == "binance":
            novos = baixar_binance(simbolo, min(faltam), max(faltam), abrir_url)
        else:
            novos = baixar_mt5(simbolo, min(faltam), max(faltam), mt5, espec.get("terminal"),
                               espec.get("deslocamento_h"), espec.get("fuso_servidor", "brasilia"),
                               espec.get("timeout_s", 90), tf)
        novos = no_tick(novos, espec.get("tick"))
        unicos = {k.t: k for k in candles}
        unicos.update({k.t: k for k in novos})
        candles = sorted(unicos.values(), key=lambda k: k.t)
        salvar_csv(candles, arq)
        # cobre só do primeiro ao último dia que vieram de fato (o histórico do servidor pode começar depois
        # do pedido, ou o MT5 pode ainda estar sincronizando); o dia de hoje (Brasília) ainda está acontecendo
        # e nunca conta como coberto
        if novos:
            ini = max(min(faltam), min(k.t.date() for k in novos))
            fim = min(max(k.t.date() for k in novos), (hoje or _hoje_brasilia()) - timedelta(days=1))
            if fim >= ini:
                with open(arq_cob, "a", encoding="utf-8") as f:
                    f.write(f"{ini.isoformat()},{fim.isoformat()}\n")
    candles = _completar_delta(ativo, espec, candles, de, ate, pasta, arq, mt5, hoje)
    # o cache de antes do arredondamento também sai no tick (no tick, no_tick não muda nada)
    return no_tick([k for k in candles if de <= k.t.date() <= ate and k.t.weekday() in dias], espec.get("tick"))


DIAS_POR_PROCESSO = 10  # dias de ticks por processo filho: um prazo que estoura perde só esse bloco


def _completar_delta(ativo, espec, candles, de, ate, pasta, arq_csv, mt5, hoje):
    """Candles com o delta dos dias que já têm ticks somados; com `"delta": true` no ativo, baixa os que faltam.

    `<ativo>_M5.delta.csv` guarda, por dia, o símbolo de onde veio o delta (vazio = o MT5 não tem os negócios
    daquele dia). Dia fora dele fica com delta ausente, inclusive o 0.0 do cache de antes do delta existir.
    """
    arq = os.path.join(pasta, f"{ativo}_M5.delta.csv")
    feitos = {}
    if os.path.exists(arq):
        try:
            with open(arq, encoding="utf-8") as f:
                for linha in f:
                    d, s = linha.rstrip("\n").split(",")
                    feitos[date.fromisoformat(d)] = s
        except ValueError:
            raise ErroDados(f"cache corrompido em {arq}; apague-o e rode de novo")
    dias = {d: [k if feitos.get(d) else replace(k, delta=None) for k in ks] for d, ks in por_dia(candles).items()}
    hoje = hoje or _hoje_brasilia()
    faltam = sorted(d for d in dias if de <= d <= ate and d < hoje and d not in feitos) if espec.get("delta") else []
    for i in range(0, len(faltam), DIAS_POR_PROCESSO):
        bloco = faltam[i:i + DIAS_POR_PROCESSO]
        try:
            achados = baixar_delta_mt5(espec.get("simbolo") or f"{ativo}$", {d: sum(k.v for k in dias[d]) for d in bloco},
                                       mt5, espec.get("terminal"), espec.get("deslocamento_h"),
                                       espec.get("fuso_servidor", "brasilia"))
        except ErroDados:
            break  # ponytail: MT5 fora do ar não derruba os candles; o delta desses dias fica para a próxima chamada
        for d in bloco:
            simbolo, deltas = achados.get(d.isoformat(), ["", {}])
            dias[d] = [replace(k, delta=float(deltas.get(k.t.isoformat(), 0)) if simbolo else None) for k in dias[d]]
            feitos[d] = simbolo
        candles = [k for ks in dias.values() for k in ks]
        salvar_csv(candles, arq_csv)
        with open(arq, "a", encoding="utf-8") as f:
            f.writelines(f"{d.isoformat()},{feitos[d]}\n" for d in bloco)
    return [k for ks in dias.values() for k in ks]


if __name__ == "__main__" and len(sys.argv) == 3 and sys.argv[1] == "--mt5-filho":
    _filho_mt5(sys.argv[2])  # processo filho de _consultar_mt5_isolado

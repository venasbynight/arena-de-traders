"""Servidor local da arena: entrega as telas e o backtest em JSON.

    python servidor.py                  # abre http://localhost:8765 no navegador
    python servidor.py --sem-navegador  # só o servidor
    python servidor.py --sem-gerente    # sem o ciclo do gerente (arranque, 00:30 e repescagem às 19:30)
"""
import functools
import json
import mimetypes
import os
import re
import threading
import time
from dataclasses import replace
import webbrowser
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

import dados
import estudos
import gerente
import motor
import traders

RAIZ = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(RAIZ, "web")
CONFIG = os.path.join(RAIZ, "trader", "config.json")
ESTADO_FIRMA = os.path.join(RAIZ, "estado", "firma.json")  # escrito pelo gerente
PARAMETROS = os.path.join(RAIZ, "estado", "parametros.json")  # parâmetros escolhidos pelo gerente
EXEMPLO_FIRMA = os.path.join(WEB, "firma.exemplo.json")
RELATORIOS = os.path.join(RAIZ, "relatorios")
DADOS = os.path.join(RAIZ, "dados")  # cache de candles; a página inicial só lê daqui
NOMES_ATIVOS = {"WDO": "Mini-dólar", "WIN": "Mini-índice", "EURUSD": "Euro / Dólar", "BTCUSDT": "Bitcoin"}
LOCK_ATIVIDADE = threading.Lock()
# o que o gerente faz agora; escrito pela thread do ciclo, lido pelas requisições (sempre com o lock)
ATIVIDADE = {"estado": "ocioso", "sala": None, "trader": None, "desde": ""}


def _agora():
    return datetime.now(motor.size.BRT).replace(tzinfo=None).isoformat(timespec="seconds")


def registrar_atividade(sala, trader):
    """Callback `ao_progresso` do ciclo: (sala, trader) = trabalhando nele; (None, None) = ocioso."""
    novo = {"estado": "trabalhando" if sala else "ocioso", "sala": sala or None, "trader": trader if sala else None}
    with LOCK_ATIVIDADE:
        if any(ATIVIDADE[k] != v for k, v in novo.items()) or not ATIVIDADE["desde"]:
            ATIVIDADE.update(novo, desde=_agora())


def atividade():
    with LOCK_ATIVIDADE:
        if not ATIVIDADE["desde"]:  # ocioso desde o arranque do servidor
            ATIVIDADE["desde"] = _agora()
        return {"gerente": dict(ATIVIDADE), "atualizado": _agora()}


class Arena(BaseHTTPRequestHandler):
    def log_message(self, *args):  # silencioso
        pass

    def _enviar(self, status, corpo, tipo="application/json; charset=utf-8"):
        if isinstance(corpo, (dict, list)):
            corpo = json.dumps(corpo, ensure_ascii=False)
        if isinstance(corpo, str):
            corpo = corpo.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def _arquivo(self, nome, base=WEB):
        base = os.path.normpath(base)
        caminho = os.path.normpath(os.path.join(base, unquote(nome)))
        if not caminho.startswith(base + os.sep) or not os.path.isfile(caminho):
            return self._enviar(404, {"erro": "não encontrado"})
        tipo = mimetypes.guess_type(caminho)[0] or "application/octet-stream"
        with open(caminho, "rb") as f:
            self._enviar(200, f.read(), tipo + ("; charset=utf-8" if tipo.startswith("text/") else ""))

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/":
            return self._arquivo("index.html")
        if url.path == "/firma":
            return self._arquivo("firma.html")
        if url.path.startswith("/web/"):
            return self._arquivo(url.path[len("/web/"):])
        if url.path.startswith("/relatorios/"):
            return self._arquivo(url.path[len("/relatorios/"):], RELATORIOS)
        if url.path == "/api/traders":
            return self._traders()
        if url.path == "/api/ativos":
            return self._ativos()
        if url.path == "/api/aovivo":
            q = parse_qs(url.query)
            return self._ao_vivo(q.get("ativo", [""])[0], q.get("tf", ["5"])[0])
        if url.path == "/api/cotacoes":
            return self._cotacoes()
        if url.path == "/api/firma":
            return self._firma()
        if url.path == "/api/painel":
            try:
                return self._enviar(200, painel())
            except Exception as e:  # nunca deixar a página inicial esperando sem resposta
                return self._enviar(500, {"erro": f"erro inesperado no painel: {e!r}"})
        if url.path == "/api/atividade":
            return self._enviar(200, atividade())
        if url.path == "/api/backtest":
            return self._backtest(parse_qs(url.query))
        self._enviar(404, {"erro": "não encontrado"})

    def _firma(self):
        # sem estado do gerente, a firma mostra o exemplo versionado (marcado como exemplo)
        exemplo = not os.path.isfile(ESTADO_FIRMA)
        caminho = EXEMPLO_FIRMA if exemplo else ESTADO_FIRMA
        if not os.path.isfile(caminho):
            return self._enviar(404, {"erro": "o gerente ainda não rodou; execute python gerente.py"})
        try:
            with open(caminho, encoding="utf-8") as f:
                estado = json.load(f)
        except (OSError, ValueError) as e:  # gravação pela metade, arquivo apagado no meio, JSON inválido
            return self._enviar(500, {"erro": f"não consegui ler {os.path.basename(caminho)}: {e}"})
        if exemplo:
            estado["exemplo"] = True  # o exemplo não ganha relatórios: os reais são de outro estado
        else:
            rel = relatorios_do_dia(estado.get("dia"))
            if rel:
                estado["relatorios"] = rel
        self._enviar(200, estado)

    def _cfg(self):
        try:
            return self.server.cfg or motor.carregar_config(CONFIG)
        except (OSError, ValueError) as e:
            self._enviar(500, {"erro": f"não consegui ler trader/config.json: {e}"})

    def _traders(self):
        """Os operacionais e os ativos de backtest de cada um: as salas da firma e, fora delas, todo ativo do config
        (sem o Caio, que precisa do delta)."""
        cfg = self._cfg()
        if cfg is None:
            return
        self._enviar(200, [{"nome": m.NOME, "estilo": m.ESTILO, "explica": getattr(m, "EXPLICA", []),
                            "salas": [a for a in cfg.get("ativos", {}) if m in traders.SALAS.get(a, traders.SEM_DELTA)]}
                           for m in traders.TODOS])

    def _ativos(self):
        """Cada ativo do config com o tempo dos candles do backtest, a fonte e o período já guardado no cache."""
        cfg = self._cfg()
        if cfg is None:
            return
        out = []
        for a, e in cfg.get("ativos", {}).items():
            tf = e.get("tf", 5)
            desde, ate = periodo_do_cache(os.path.join(DADOS, f"{a}_{dados.TEMPOS_MT5[tf][0]}.csv"))
            out.append({"ativo": a, "tf": tf, "fonte": "binance" if e.get("fonte") == "binance" else "mt5",
                        "desde": desde, "ate": ate, "delta": bool(e.get("delta"))})
        self._enviar(200, out)

    def _backtest(self, q):
        try:
            cfg = self.server.cfg or motor.carregar_config(CONFIG)
        except (OSError, ValueError) as e:
            return self._enviar(500, {"erro": f"não consegui ler trader/config.json: {e}"})
        ativo = q.get("ativo", [""])[0]
        if ativo not in cfg.get("ativos", {}):
            return self._enviar(400, {"erro": f"ativo {ativo or '(vazio)'} não está em trader/config.json"})
        try:
            de, ate = date.fromisoformat(q["de"][0]), date.fromisoformat(q["ate"][0])
        except (KeyError, ValueError):
            return self._enviar(400, {"erro": "datas inválidas; use AAAA-MM-DD"})
        if de > ate:
            return self._enviar(400, {"erro": "a data inicial é depois da final"})
        try:
            resultado = calcular_backtest(self.server, ativo, de, ate, cfg)
            if resultado is None:
                return self._enviar(400, {"erro": f"sem candles entre {de:%d/%m/%Y} e {ate:%d/%m/%Y} "
                                                  "(fim de semana, feriado ou fora do histórico)"})
        except dados.ErroDados as e:
            return self._enviar(400, {"erro": str(e)})
        except Exception as e:  # nunca deixar a tela esperando sem resposta
            return self._enviar(500, {"erro": f"erro inesperado no backtest: {e!r}"})
        self._enviar(200, resultado)

    def _cotacoes(self):
        try:
            cfg = self.server.cfg or motor.carregar_config(CONFIG)
        except (OSError, ValueError) as e:
            return self._enviar(500, {"erro": f"não consegui ler trader/config.json: {e}"})
        try:
            return self._enviar(200, cotacoes(cfg, self.server.cotacoes_fn))
        except Exception as e:
            return self._enviar(500, {"erro": f"erro inesperado nas cotações: {e!r}"})

    def _ao_vivo(self, ativo, tf):
        try:
            cfg = self.server.cfg or motor.carregar_config(CONFIG)
        except (OSError, ValueError) as e:
            return self._enviar(500, {"erro": f"não consegui ler trader/config.json: {e}"})
        if ativo not in cfg.get("ativos", {}):  # qualquer ativo do config: o ao vivo só acompanha, não opera
            return self._enviar(400, {"erro": f"ativo {ativo or '(vazio)'} não tem gráfico ao vivo"})
        if not tf.isdigit() or int(tf) not in DIAS_AO_VIVO:
            return self._enviar(400, {"erro": f"tempo gráfico {tf} inválido; use {', '.join(map(str, DIAS_AO_VIVO))} (minutos)"})
        try:
            candles = ao_vivo(ativo, cfg, self.server.vivo_fn, tf=int(tf))
        except dados.ErroDados as e:
            return self._enviar(503, {"erro": str(e)})
        except Exception as e:
            return self._enviar(500, {"erro": f"erro inesperado no ao vivo: {e!r}"})
        self._enviar(200, {"ativo": ativo, "tf": int(tf), "atualizado": _agora(),
                           "candles": [[k.t.isoformat(), k.o, k.h, k.l, k.c] for k in candles]})


# tempo gráfico (min) -> dias corridos pedidos à fonte: algumas centenas de candles; no 5 min a segunda-feira ainda
# mostra quinta e sexta
DIAS_AO_VIVO = {1: 3, 5: 4, 15: 10, 30: 20, 60: 45, 240: 180, 1440: 900}
VIVO_TTL_S = 4    # várias abas (ou o polling) dentro desse prazo levam a mesma leitura
_vivo = {}        # (ativo, tf) -> (instante, candles)
_travas_vivo = {}  # uma para o MT5 e uma para a Binance: dois processos falando com terminais do MT5 ao mesmo tempo
                  # se atrapalham (medido em 26/10/2026: a Genial parou de responder enquanto o MetaQuotes atendia)
_trava_travas = threading.Lock()


def periodo_do_cache(caminho):
    """(primeiro dia, último dia) iso do CSV do cache, lendo só o começo e o fim; (None, None) sem arquivo ou vazio."""
    try:
        with open(caminho, "rb") as f:
            f.readline()
            primeira = f.readline()
            f.seek(max(0, os.path.getsize(caminho) - 4096))
            ultima = f.read().rstrip().rsplit(b"\n", 1)[-1]
    except OSError:
        return None, None
    if not primeira.strip():
        return None, None
    return primeira[:10].decode(), ultima[:10].decode()


def baixar_vivo(ativo, cfg, hoje, tf=5):
    """Candles de `tf` min dos últimos dias direto da fonte, sem o cache: o dia de hoje ainda está acontecendo."""
    espec = cfg["ativos"][ativo]
    de = hoje - timedelta(days=DIAS_AO_VIVO[tf])
    simbolo = espec.get("simbolo") or f"{ativo}$"
    if espec.get("fonte") == "binance":
        novos = dados.baixar_binance(simbolo, de, hoje, tf=tf)
    else:  # prazo curto: um terminal travado não segura o gráfico por minuto e meio
        novos = dados.baixar_mt5(simbolo, de, hoje, terminal=espec.get("terminal"), deslocamento_h=espec.get("deslocamento_h"),
                                 fuso_servidor=espec.get("fuso_servidor", "brasilia"), timeout_s=20, tf=tf)
    if tf == 1440:  # o diário abre à meia-noite da fonte (18h/19h ou 21h de Brasília na véspera): volta para o dia certo
        novos = [replace(k, t=datetime.combine((k.t + timedelta(hours=12)).date(), datetime.min.time())) for k in novos]
    return dados.no_tick(novos, espec.get("tick"))


def _trava(espec):
    chave = "binance" if espec.get("fonte") == "binance" else "mt5"
    with _trava_travas:
        return _travas_vivo.setdefault(chave, threading.Lock())


def ao_vivo(ativo, cfg, baixar=None, relogio=time.monotonic, tf=5):
    with _trava(cfg["ativos"][ativo]):
        visto = _vivo.get((ativo, tf))
        if visto and relogio() - visto[0] < VIVO_TTL_S:
            return visto[1]
        candles = (baixar or baixar_vivo)(ativo, cfg, dados._hoje_brasilia(), tf)
        _vivo[(ativo, tf)] = (relogio(), candles)
        return candles


COTACOES_TTL_S = 10
_cotacoes = [0.0, None]  # [instante, resposta]: a lista de ativos de várias abas cabe numa leitura só
_trava_cotacoes = threading.Lock()


def cotacoes(cfg, buscar=None, relogio=time.monotonic):
    """{"cotacoes": {ativo: {preco, ref}}, "erros": {fonte: msg}} de todos os ativos do config, uma conversa por fonte.

    `ref` é o fechamento do dia anterior (MT5) ou o preço de 24 h atrás (Binance). Uma fonte fora do ar vira um erro
    dela e não apaga as outras. `buscar(fonte, terminal, simbolos)` substitui as fontes nos testes.
    """
    with _trava_cotacoes:
        if _cotacoes[1] is not None and relogio() - _cotacoes[0] < COTACOES_TTL_S:
            return _cotacoes[1]
        grupos = {}  # (fonte, terminal) -> {símbolo: ativo}
        for a, e in cfg.get("ativos", {}).items():
            fonte = "binance" if e.get("fonte") == "binance" else "mt5"
            grupos.setdefault((fonte, e.get("terminal") if fonte == "mt5" else None), {})[e.get("simbolo") or f"{a}$"] = a

        def um(chave):
            fonte, terminal = chave
            simbolos = list(grupos[chave])
            if buscar:
                return buscar(fonte, terminal, simbolos)
            with _trava(cfg["ativos"][next(iter(grupos[chave].values()))]):
                return dados.cotacoes_binance(simbolos) if fonte == "binance" else dados.cotacoes_mt5(simbolos, terminal)

        out, erros = {}, {}
        for chave in grupos:  # um terminal de cada vez (veja _travas_vivo)
            try:
                for simbolo, (preco, ref) in um(chave).items():
                    if simbolo in grupos[chave]:
                        out[grupos[chave][simbolo]] = {"preco": preco, "ref": ref}
            except dados.ErroDados as e:
                erros[chave[1] or chave[0]] = str(e)
        _cotacoes[:] = [relogio(), {"atualizado": _agora(), "cotacoes": out, "erros": erros}]
        return _cotacoes[1]


@functools.lru_cache(maxsize=8)
def _mercado_do_cache(caminho, versao):
    """Cartão de mercado de um ativo a partir do cache; `versao` (mtime, tamanho) renova a memória quando o cache muda."""
    candles = dados.ler_csv(caminho)
    if not candles:
        raise dados.ErroDados(f"cache vazio em {caminho}")
    dias = list(dados.por_dia(candles).values())
    ultimo, anterior = dias[-1], (dias[-2] if len(dias) > 1 else None)
    # tendência do 60 pela regra da Sofia, com os mesmos 200 candles de 60 que o motor entrega a ela
    tend = estudos.tendencia(dados.agrupar(candles, 60)[-200:], traders.sofia_smc.PARAMS["n"])
    ref = anterior[-1].c if anterior else None
    return {"desde": dias[0][0].t.date().isoformat(),  # período do cache: o que o backtest roda sem baixar nada
            "ultimo": ultimo[-1].c, "dia": ultimo[0].t.date().isoformat(), "tendencia60": tend or "indefinida",
            "variacao_pct": round((ultimo[-1].c / ref - 1) * 100, 2) if ref else None,  # 0 = linha ruim no cache
            "fechamento_anterior": ref,
            "candles": [{"t": k.t.isoformat(), "o": k.o, "h": k.h, "l": k.l, "c": k.c} for k in ultimo],
            # gráfico grande da sala de replay antes do Rodar: os 5 últimos pregões, compactos
            "pregoes": [[k.t.isoformat(), k.o, k.h, k.l, k.c, k.v] for d in dias[-5:] for k in d]}


def _delta_desde(caminho):
    """Primeiro dia com delta dos ticks (linhas "dia,símbolo"; símbolo vazio = sem negócios no MT5), ou None."""
    try:
        with open(caminho, encoding="utf-8") as f:
            return min((d for d, _, s in (linha.strip().partition(",") for linha in f) if s), default=None)
    except OSError:
        return None


AGUARDANDO = {"status": "aguardando", "prova_resultado": None, "requisitos_ok": 0, "requisitos_total": 0,
              "curva": [], "faltam": []}


def _celula(sala, nome):
    """Placar de um trader numa sala do estado do gerente; quem o gerente ainda não avaliou fica "aguardando".

    Uma célula num formato estranho (gerente de outra versão, arquivo mexido à mão) também fica "aguardando":
    ela não derruba a página inicial inteira.
    """
    try:
        sala = sala or {}
        t = next((t for t in sala.get("traders") or [] if isinstance(t, dict) and t.get("nome") == nome), {})
        reqs = t.get("requisitos") or []
        return {"status": t.get("status") or ("sem_dados" if sala.get("status") == "sem_dados" else "aguardando"),
                "prova_resultado": (t.get("prova") or {}).get("resultado"),
                "requisitos_ok": sum(1 for r in reqs if r.get("ok")), "requisitos_total": len(reqs),
                "curva": [p[1] for p in t.get("equity") or []],
                "faltam": [f"{r['item']}: {r['valor']}" if r.get("valor") else r["item"] for r in reqs if not r.get("ok")]}
    except Exception:
        return dict(AGUARDANDO)


def painel():
    """Página inicial: mercado do cache em DADOS e placar do estado do gerente. Nunca baixa nada."""
    mercado = []
    for ativo in traders.SALAS:
        cartao = {"ativo": ativo, "nome": NOMES_ATIVOS.get(ativo, ativo)}
        caminho = os.path.join(DADOS, f"{ativo}_M5.csv")
        try:
            st = os.stat(caminho)
            cartao.update(_mercado_do_cache(caminho, (st.st_mtime_ns, st.st_size)))
        except (OSError, dados.ErroDados):  # sem cache ou cache corrompido: o cartão diz que não há dados
            cartao["sem_dados"] = True
        cartao["delta_desde"] = _delta_desde(os.path.join(DADOS, f"{ativo}_M5.delta.csv"))
        mercado.append(cartao)
    estado = gerente.ler_json(ESTADO_FIRMA)  # {} sem arquivo ou com JSON pela metade
    salas = estado.get("salas") if isinstance(estado, dict) else None
    salas = salas if isinstance(salas, dict) else {}
    return {"mercado": mercado,
            "traders": [{"nome": m.NOME, "estilo": m.ESTILO,
                         "por_ativo": {a: _celula(salas.get(a), m.NOME) if m in sala else {**AGUARDANDO, "status": "nao_opera"}
                                       for a, sala in traders.SALAS.items()}}
                        for m in traders.TODOS],
            "ciclo": estado.get("dia") if isinstance(estado, dict) and isinstance(estado.get("dia"), str) else None}


def relatorios_do_dia(dia=None):
    """{"dia", "arquivos"} da pasta relatorios/<dia> (a do dia do estado); sem ela, da mais recente; ou None.

    A lista vem do index.json do último ciclo; pasta sem ele (de antes dele existir), a listagem da pasta.
    """
    try:
        dias = [d for d in os.listdir(RELATORIOS)
                if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d) and os.path.isdir(os.path.join(RELATORIOS, d))]
        if dias:
            dia = dia if dia in dias else max(dias)
            pasta = os.path.join(RELATORIOS, dia)
            arquivos = gerente.ler_json(os.path.join(pasta, "index.json")).get("arquivos") or sorted(os.listdir(pasta))
            return {"dia": dia, "arquivos": arquivos}
    except OSError:
        pass
    return None


def historico(ativo, de, ate, cfg, raiz=RAIZ):
    """dados.historico com o cache em <raiz>/dados, não na pasta de onde o servidor foi aberto."""
    return dados.historico(ativo, de, ate, cfg, pasta=os.path.join(raiz, "dados"))


def precisa_ciclo(caminho, hoje, refazer_sem_dados=False):
    """Roda um ciclo se não há estado do gerente ou se ele não é de hoje.

    Com `refazer_sem_dados` (a volta das 19h), também quando alguma sala do estado de hoje ficou sem dados.
    """
    try:
        with open(caminho, encoding="utf-8") as f:
            estado = json.load(f)
        if estado.get("dia") != hoje.isoformat():
            return True
        return refazer_sem_dados and any(s.get("status") not in ("ok", "sem_tarefa") for s in estado.get("salas", {}).values())
    except (OSError, ValueError, AttributeError, TypeError):
        return True


def _log(msg):
    try:
        print(msg, flush=True)
    except Exception:  # console sem a codificação ou fechado: a thread do gerente nunca cai por um print
        pass


def ciclo_do_servidor(hoje, raiz=RAIZ):
    """Ciclo do gerente com os caminhos da raiz do projeto: o servidor funciona aberto de qualquer pasta."""
    cfg = motor.carregar_config(os.path.join(raiz, "trader", "config.json"))
    return gerente.ciclo(cfg, hoje, historico_fn=functools.partial(historico, raiz=raiz), raiz=raiz,
                         ao_progresso=registrar_atividade)


def laco_do_gerente(rodar, relogio, dormir=time.sleep):
    """Confere no arranque e a cada meia hora cheia (xx:30): roda `rodar(hoje)` se o estado não é de hoje.

    O dia novo roda às 00:30, com o anterior completo em todos os ativos; a volta das 19h (19:30) também
    repete quando alguma sala do ciclo de hoje ficou sem dados. Nunca retorna.
    """
    while True:
        agora = relogio()
        if precisa_ciclo(ESTADO_FIRMA, agora.date(), refazer_sem_dados=agora.hour == 19):
            rodar(agora.date())
        alvo = agora.replace(minute=30, second=0, microsecond=0)
        if alvo <= agora:
            alvo += timedelta(hours=1)
        dormir((alvo - agora).total_seconds())  # sono de no máximo 1 h: PC suspenso só atrasa até a próxima volta


def gerente_diario():
    """Thread do gerente (horário de Brasília). O ciclo roda nesta thread e grava o estado de uma vez,
    então nenhuma requisição espera por ele."""
    brt = motor.size.BRT

    def rodar(hoje):
        _log(f"gerente: ciclo de {hoje} começou")
        try:
            estado = ciclo_do_servidor(hoje)
            _log(f"gerente: ciclo de {hoje} pronto; pendências: {len(estado['pendencias'])}")
        except Exception as e:  # a thread segue viva para a próxima volta
            _log(f"gerente: o ciclo de {hoje} falhou: {e!r}")

    threading.Thread(target=laco_do_gerente, args=(rodar, lambda: datetime.now(brt)), daemon=True,
                     name="gerente").start()


BACKTESTS_GUARDADOS = 40


def calcular_backtest(srv, ativo, de, ate, cfg):
    """Resultado do /api/backtest (None sem candles). Os mesmos candles, parâmetros e config dão o mesmo backtest:
    fica guardado (os últimos BACKTESTS_GUARDADOS) e abrir a tela de novo não espera de 1 a 3 s por ativo."""
    candles = srv.historico_fn(ativo, de, ate, cfg)
    if not candles:
        return None
    params = gerente.ler_json(PARAMETROS).get(ativo, {})  # os escolhidos pelo gerente, quando houver
    sala = traders.SALAS.get(ativo, traders.SEM_DELTA)  # o Caio só nas salas com delta (WDO e WIN)
    chave = (ativo, de, ate, tuple(map(id, sala)), json.dumps(params, sort_keys=True),
             json.dumps(cfg, sort_keys=True, default=str), hash(tuple(candles)))
    with srv.trava_backtests:
        if chave in srv.backtests:
            return srv.backtests[chave]
    resultado = motor.rodar_backtest(ativo, candles, [(m, params.get(m.NOME)) for m in sala], cfg)
    with srv.trava_backtests:
        srv.backtests[chave] = resultado
        while len(srv.backtests) > BACKTESTS_GUARDADOS:
            srv.backtests.pop(next(iter(srv.backtests)))
    return resultado


def aquecer_backtests(srv, ativos=("WDO", "WIN", "EURUSD", "BTCUSDT")):
    """Em segundo plano, ao subir: a semana que a tela de backtest abre (ontem e 8 dias atrás, nas datas UTC que o
    navegador usa) já fica calculada para os ativos dos gráficos padrão."""
    def aquecer():
        hoje = datetime.now(timezone.utc).date()
        try:
            cfg = srv.cfg or motor.carregar_config(CONFIG)
        except (OSError, ValueError):
            return
        for ativo in ativos:
            try:
                calcular_backtest(srv, ativo, hoje - timedelta(days=8), hoje - timedelta(days=1), cfg)
            except Exception as e:  # o pedido de verdade mostra o erro; aqui só registra
                _log(f"aquecimento do backtest de {ativo}: {e!r}")
    threading.Thread(target=aquecer, daemon=True, name="aquecer-backtests").start()


def criar_servidor(porta=8765, historico_fn=None, cfg=None, vivo_fn=None, cotacoes_fn=None):
    srv = ThreadingHTTPServer(("127.0.0.1", porta), Arena)
    srv.historico_fn = historico_fn or historico
    srv.vivo_fn = vivo_fn
    srv.cotacoes_fn = cotacoes_fn
    srv.cfg = cfg
    srv.backtests, srv.trava_backtests = {}, threading.Lock()
    return srv


if __name__ == "__main__":
    import sys
    if sys.stdout:  # pythonw não tem console
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    srv = criar_servidor()
    aquecer_backtests(srv)
    print("TradeQuarters em http://localhost:8765  (Ctrl+C para parar)", flush=True)
    if "--sem-gerente" not in sys.argv:
        gerente_diario()
    if "--sem-navegador" not in sys.argv:
        webbrowser.open("http://localhost:8765")
    srv.serve_forever()

"""Servidor local da arena: entrega as telas e o backtest em JSON.

    python servidor.py                  # abre http://localhost:8765 no navegador
    python servidor.py --sem-navegador  # só o servidor
    python servidor.py --sem-gerente    # sem o ciclo do gerente (arranque e 19:30)
"""
import json
import mimetypes
import os
import re
import threading
import time
import webbrowser
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

import dados
import gerente
import motor
import traders

RAIZ = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(RAIZ, "web")
ESTADO_FIRMA = os.path.join(RAIZ, "estado", "firma.json")  # escrito pelo gerente
PARAMETROS = os.path.join(RAIZ, "estado", "parametros.json")  # parâmetros escolhidos pelo gerente
EXEMPLO_FIRMA = os.path.join(WEB, "firma.exemplo.json")
RELATORIOS = os.path.join(RAIZ, "relatorios")


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
            return self._enviar(200, [{"nome": m.NOME, "estilo": m.ESTILO} for m in traders.TODOS])
        if url.path == "/api/firma":
            return self._firma()
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
            estado["exemplo"] = True
        rel = relatorios_do_dia()
        if rel:
            estado["relatorios"] = rel
        self._enviar(200, estado)

    def _backtest(self, q):
        ativo = q.get("ativo", [""])[0]
        if ativo not in ("WDO", "WIN"):
            return self._enviar(400, {"erro": "ativo deve ser WDO ou WIN"})
        try:
            de, ate = date.fromisoformat(q["de"][0]), date.fromisoformat(q["ate"][0])
        except (KeyError, ValueError):
            return self._enviar(400, {"erro": "datas inválidas; use AAAA-MM-DD"})
        if de > ate:
            return self._enviar(400, {"erro": "a data inicial é depois da final"})
        try:
            cfg = self.server.cfg or motor.carregar_config()
        except (OSError, ValueError) as e:
            return self._enviar(500, {"erro": f"não consegui ler trader/config.json: {e}"})
        try:
            candles = self.server.historico_fn(ativo, de, ate, cfg)
            if not candles:
                return self._enviar(400, {"erro": f"sem candles entre {de:%d/%m/%Y} e {ate:%d/%m/%Y} "
                                                  "(fim de semana, feriado ou fora do histórico)"})
            params = gerente.ler_json(PARAMETROS).get(ativo, {})  # os escolhidos pelo gerente, quando houver
            resultado = motor.rodar_backtest(ativo, candles, [(m, params.get(m.NOME)) for m in traders.TODOS], cfg)
        except dados.ErroDados as e:
            return self._enviar(400, {"erro": str(e)})
        except Exception as e:  # nunca deixar a tela esperando sem resposta
            return self._enviar(500, {"erro": f"erro inesperado no backtest: {e!r}"})
        self._enviar(200, resultado)


def relatorios_do_dia():
    """{"dia", "arquivos"} da pasta de relatórios mais recente (relatorios/AAAA-MM-DD), ou None."""
    try:
        dias = [d for d in os.listdir(RELATORIOS)
                if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d) and os.path.isdir(os.path.join(RELATORIOS, d))]
        if dias:
            return {"dia": max(dias), "arquivos": sorted(os.listdir(os.path.join(RELATORIOS, max(dias))))}
    except OSError:
        pass
    return None


def precisa_ciclo(caminho, hoje):
    """No arranque roda um ciclo se não há estado do gerente, ou se ele é de um dia anterior."""
    try:
        with open(caminho, encoding="utf-8") as f:
            return json.load(f).get("dia", "") < hoje.isoformat()
    except (OSError, ValueError, AttributeError, TypeError):
        return True


def gerente_diario():
    """Thread do gerente: ciclo no arranque se ainda não houve o de hoje, depois todo dia às 19:30 (Brasília).

    O ciclo roda nesta thread e grava o estado de uma vez, então nenhuma requisição espera por ele.
    """
    brt = motor.size.BRT

    def rodar():
        hoje = datetime.now(brt).date()
        print(f"gerente: ciclo de {hoje} começou", flush=True)
        try:
            estado = gerente.ciclo(motor.carregar_config(), hoje, raiz=RAIZ)
            print(f"gerente: ciclo de {hoje} pronto; pendências: {len(estado['pendencias'])}", flush=True)
        except Exception as e:  # a thread segue viva para o ciclo de amanhã
            print(f"gerente: o ciclo de {hoje} falhou: {e!r}", flush=True)

    def laco():
        if precisa_ciclo(ESTADO_FIRMA, datetime.now(brt).date()):
            rodar()
        while True:
            agora = datetime.now(brt)
            alvo = agora.replace(hour=19, minute=30, second=0, microsecond=0)
            if alvo <= agora:
                alvo += timedelta(days=1)
            # ponytail: um sleep longo; com o PC suspenso o ciclo sai atrasado, no acordar
            time.sleep((alvo - agora).total_seconds())
            rodar()

    threading.Thread(target=laco, daemon=True, name="gerente").start()


def criar_servidor(porta=8765, historico_fn=None, cfg=None):
    srv = ThreadingHTTPServer(("127.0.0.1", porta), Arena)
    srv.historico_fn = historico_fn or dados.historico
    srv.cfg = cfg
    return srv


if __name__ == "__main__":
    import sys
    srv = criar_servidor()
    print("Arena de Traders em http://localhost:8765  (Ctrl+C para parar)", flush=True)
    if "--sem-gerente" not in sys.argv:
        gerente_diario()
    if "--sem-navegador" not in sys.argv:
        webbrowser.open("http://localhost:8765")
    srv.serve_forever()

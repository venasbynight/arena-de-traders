"""Servidor local da arena: entrega as telas e o backtest em JSON.

    python servidor.py                  # abre http://localhost:8765 no navegador
    python servidor.py --sem-navegador  # só o servidor
"""
import json
import mimetypes
import os
import webbrowser
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

import dados
import motor
import traders

RAIZ = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(RAIZ, "web")
ESTADO_FIRMA = os.path.join(RAIZ, "estado", "firma.json")  # escrito pelo gerente


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

    def _arquivo(self, nome):
        caminho = os.path.normpath(os.path.join(WEB, unquote(nome)))
        if not caminho.startswith(WEB + os.sep) or not os.path.isfile(caminho):
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
        caminho = os.path.join(WEB, "firma.exemplo.json") if exemplo else ESTADO_FIRMA
        try:
            with open(caminho, encoding="utf-8") as f:
                estado = json.load(f)
        except (OSError, ValueError) as e:  # gravação pela metade, arquivo apagado no meio, JSON inválido
            return self._enviar(500, {"erro": f"não consegui ler {os.path.basename(caminho)}: {e}"})
        if exemplo:
            estado["exemplo"] = True
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
            resultado = motor.rodar_backtest(ativo, candles, traders.TODOS, cfg)
        except dados.ErroDados as e:
            return self._enviar(400, {"erro": str(e)})
        except Exception as e:  # nunca deixar a tela esperando sem resposta
            return self._enviar(500, {"erro": f"erro inesperado no backtest: {e!r}"})
        self._enviar(200, resultado)


def criar_servidor(porta=8765, historico_fn=None, cfg=None):
    srv = ThreadingHTTPServer(("127.0.0.1", porta), Arena)
    srv.historico_fn = historico_fn or dados.historico
    srv.cfg = cfg
    return srv


if __name__ == "__main__":
    import sys
    srv = criar_servidor()
    print("Arena de Traders em http://localhost:8765  (Ctrl+C para parar)", flush=True)
    if "--sem-navegador" not in sys.argv:
        webbrowser.open("http://localhost:8765")
    srv.serve_forever()

"""Atalho da área de trabalho: sobe o servidor do TradeQuarters (se ainda não estiver no ar) e abre como app (PWA) no Chrome:
janela própria, sem abas nem barra de endereço. Sem Chrome, abre no Opera ou no navegador padrão.

Roda com pythonw (sem janela). Nunca sobe um segundo servidor: no Windows dois processos conseguem abrir a mesma porta.
"""
import os
import socket
import subprocess
import sys
import time
import webbrowser

RAIZ = os.path.dirname(os.path.abspath(__file__))
URL = "http://127.0.0.1:8765/"
OPERA = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Opera", "opera.exe")
CHROMES = [os.path.join(os.environ.get(v, ""), "Google", "Chrome", "Application", "chrome.exe")
           for v in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA")]


def no_ar():
    try:
        with socket.create_connection(("127.0.0.1", 8765), timeout=0.5):
            return True
    except OSError:
        return False


if not no_ar():
    pythonw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    subprocess.Popen([pythonw if os.path.exists(pythonw) else sys.executable, "servidor.py", "--sem-navegador"],
                     cwd=RAIZ, creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
                     close_fds=True)
    for _ in range(40):  # até 10 s para o servidor responder
        if no_ar():
            break
        time.sleep(0.25)

chrome = next((c for c in CHROMES if os.path.exists(c)), None)
if chrome:
    subprocess.Popen([chrome, f"--app={URL}"], close_fds=True)
elif os.path.exists(OPERA):
    subprocess.Popen([OPERA, URL], close_fds=True)
else:
    webbrowser.open(URL)

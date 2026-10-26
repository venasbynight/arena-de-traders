"""Instala o TradeQuarters neste computador: as dependências do Python e o atalho "TradeQuarters" na área de trabalho.

O atalho roda abrir_arena.pyw com o pythonw (sem janela preta) e usa o ícone do prédio. Rode pelo instalar.bat.
Um argumento opcional troca a pasta do atalho (os testes usam uma pasta temporária no lugar da área de trabalho).
"""
import os
import subprocess
import sys

RAIZ = os.path.dirname(os.path.abspath(__file__))


def criar_atalho(pasta=None):
    pythonw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    if not os.path.exists(pythonw):
        pythonw = sys.executable
    aspas = lambda s: "'" + s.replace("'", "''") + "'"  # texto entre aspas simples do PowerShell
    destino = aspas(pasta) if pasta else "([Environment]::GetFolderPath('Desktop'))"  # a do OneDrive, se for o caso
    ps = (f"$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path {destino} 'TradeQuarters.lnk'));"
          f"$s.TargetPath = {aspas(pythonw)};"
          f"$s.Arguments = {aspas(chr(34) + os.path.join(RAIZ, 'abrir_arena.pyw') + chr(34))};"
          f"$s.WorkingDirectory = {aspas(RAIZ)};"
          f"$s.IconLocation = {aspas(os.path.join(RAIZ, 'web', 'tradequarters.ico') + ',0')};"
          "$s.Description = 'TradeQuarters'; $s.Save()")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True)


if __name__ == "__main__":
    print("Instalando as dependências (MetaTrader5)...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", os.path.join(RAIZ, "requirements.txt")])
    criar_atalho(sys.argv[1] if len(sys.argv) > 1 else None)
    print("Pronto: o atalho TradeQuarters está na área de trabalho. Abra o programa por ele.")

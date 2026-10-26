@echo off
rem Dois cliques aqui: instala o que o TradeQuarters precisa e cria o atalho na área de trabalho (ver INSTALAR.md).
chcp 65001 >nul
cd /d "%~dp0"
set PY=
py -3 --version >nul 2>nul && set PY=py -3
if not defined PY python --version >nul 2>nul && set PY=python
if not defined PY (
  echo Não achei o Python. Instale o Python 3.14 em https://www.python.org/downloads/
  echo marcando "Add python.exe to PATH" e rode este arquivo de novo.
  pause
  exit /b 1
)
%PY% instalar.py
if errorlevel 1 (
  echo Algo deu errado na instalação. Veja a mensagem acima e o INSTALAR.md.
  pause
  exit /b 1
)
pause

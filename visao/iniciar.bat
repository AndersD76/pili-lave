@echo off
rem Programa das cameras da loja.
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  py -3.10 -m venv .venv
  .venv\Scripts\python -m pip install --disable-pip-version-check -q -r requirements.txt
)
.venv\Scripts\python baixar_modelos.py
.venv\Scripts\python principal.py %*
pause

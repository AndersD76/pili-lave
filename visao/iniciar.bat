@echo off
rem Programa das cameras da loja. Usa o Python 3.10 que ja tem o YOLO instalado.
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  py -3.10 -m venv .venv --system-site-packages
  .venv\Scripts\python -m pip install -q "lap>=0.5.12" pytest
)
.venv\Scripts\python principal.py %*
pause

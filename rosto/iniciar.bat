@echo off
rem Sobe o servico de reconhecimento facial da loja em 127.0.0.1:3200.
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  python -m venv .venv || exit /b 1
  .venv\Scripts\python -m pip install --disable-pip-version-check -r requirements.txt || exit /b 1
)
.venv\Scripts\python baixar_modelos.py || exit /b 1
.venv\Scripts\python app.py

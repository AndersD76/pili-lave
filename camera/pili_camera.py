#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PILI LAVE — Câmera da máquina (equipamento definitivo)
=======================================================
Roda num mini-PC/Raspberry Pi ao lado da máquina, com uma webcam USB ou
câmera IP (RTSP) apontada para a chegada dos carros.

O que faz (mesmo contrato da página /camera de teste):
  1. Captura frames e reconhece a placa (Plate Recognizer, free ~2500/mês).
  2. Envia à nuvem: POST {API}/api/lpr/read  (header x-device-key).
  3. Log das mensagens ao motorista (cadastrado / sem saldo / desconhecido)
     — plugue aqui um monitor/letreiro se quiser.
  4. Faz polling de {API}/api/machine/next; quando o motorista paga:
     LIGA A SAÍDA (luz verde/relé) e confirma com /api/machine/ack.
     Saída via porta serial (ex.: placa relé/ESP32 em COMx ou /dev/ttyUSB0)
     — envia a linha "START <programId>\\n". Os TEMPOS são do IoT da máquina.

Config (variáveis de ambiente ou edite abaixo):
  PILI_API        ex.: https://pili-lave.up.railway.app
  PILI_DEVICE_KEY chave DEVICE_KEY do servidor
  PILI_CAMERA     0 (webcam) ou rtsp://usuario:senha@ip:554/...
  PILI_PR_TOKEN   token do platerecognizer.com (Snapshot API, plano free)
  PILI_SERIAL     opcional: COM5 ou /dev/ttyUSB0 (9600 baud)

Instalar:  pip install -r requirements.txt
Rodar:     python pili_camera.py
"""
import os
import sys
import time
import threading

import cv2  # opencv-python
import requests

API = os.environ.get("PILI_API", "http://localhost:3000").rstrip("/")
DEVICE_KEY = os.environ.get("PILI_DEVICE_KEY", "")
CAMERA = os.environ.get("PILI_CAMERA", "0")
PR_TOKEN = os.environ.get("PILI_PR_TOKEN", "")
SERIAL_PORT = os.environ.get("PILI_SERIAL", "")

CAPTURE_EVERY_S = 1.5     # intervalo entre tentativas de leitura
RESEND_COOLDOWN_S = 30    # não repete a mesma placa antes disso
POLL_EVERY_S = 2.0        # polling da liberação
GREEN_HOLD_S = 10         # quanto tempo mantém a "luz verde" ligada

HDRS = {"x-device-key": DEVICE_KEY, "Content-Type": "application/json"}
_serial = None
if SERIAL_PORT:
    try:
        import serial  # pyserial
        _serial = serial.Serial(SERIAL_PORT, 9600, timeout=1)
        print(f"[serial] conectado em {SERIAL_PORT}")
    except Exception as e:  # noqa: BLE001
        print(f"[serial] indisponível ({e}) — seguindo só com log")


def luz_verde(program_id: int, plate: str) -> None:
    """Aciona a saída física. Adapte aqui p/ GPIO do RPi se preferir."""
    print(f"\n===== LUZ VERDE ===== lavagem {program_id} liberada p/ {plate}\n")
    if _serial:
        _serial.write(f"START {program_id}\n".encode())
    time.sleep(GREEN_HOLD_S)
    if _serial:
        _serial.write(b"STOP\n")


def reconhecer_placa(frame) -> str | None:
    """Plate Recognizer Snapshot API (region br)."""
    if not PR_TOKEN:
        return None
    ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        return None
    try:
        r = requests.post(
            "https://api.platerecognizer.com/v1/plate-reader/",
            headers={"Authorization": f"Token {PR_TOKEN}"},
            data={"regions": "br"},
            files={"upload": ("frame.jpg", jpg.tobytes(), "image/jpeg")},
            timeout=15,
        )
        results = r.json().get("results", [])
        if results and results[0].get("score", 0) > 0.7:
            return results[0]["plate"].upper()
    except Exception as e:  # noqa: BLE001
        print(f"[pr] erro: {e}")
    return None


def enviar_placa(plate: str) -> None:
    try:
        r = requests.post(f"{API}/api/lpr/read", json={"plate": plate}, headers=HDRS, timeout=10)
        d = r.json()
        if r.status_code != 200:
            print(f"[nuvem] {plate}: {d.get('error')}")
            return
        if d.get("dedup"):
            return
        if d.get("status") == "NO_MATCH":
            print(f"[tela] {plate} NÃO CADASTRADA → 'Baixe o app, cadastre-se e insira saldo'")
        elif d.get("saldoOk"):
            nome = d.get("clientName") or "cliente"
            print(f"[tela] Olá {nome}! ({plate}) → 'Abra o app e toque em Solicitar lavagem'")
        else:
            print(f"[tela] {plate} SEM SALDO → 'Adicione saldo no app para liberar'")
    except Exception as e:  # noqa: BLE001
        print(f"[nuvem] falha: {e}")


def thread_maquina() -> None:
    """Polling da liberação — independente da câmera."""
    while True:
        try:
            r = requests.get(f"{API}/api/machine/next", headers=HDRS, timeout=10)
            job = r.json().get("job")
            if job:
                requests.post(f"{API}/api/machine/ack", json={"arrivalId": job["arrivalId"]},
                              headers=HDRS, timeout=10)
                luz_verde(job["programId"], job.get("plate", ""))
        except Exception as e:  # noqa: BLE001
            print(f"[maquina] falha no polling: {e}")
        time.sleep(POLL_EVERY_S)


def main() -> None:
    if not DEVICE_KEY:
        sys.exit("Defina PILI_DEVICE_KEY (mesmo valor do servidor).")
    threading.Thread(target=thread_maquina, daemon=True).start()

    src = int(CAMERA) if CAMERA.isdigit() else CAMERA
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        sys.exit(f"Não abriu a câmera: {CAMERA}")
    print(f"[camera] capturando de {CAMERA} — Ctrl+C para sair")

    ultimo: dict[str, float] = {}
    while True:
        okf, frame = cap.read()
        if not okf:
            time.sleep(1)
            cap.release()
            cap = cv2.VideoCapture(src)
            continue
        plate = reconhecer_placa(frame)
        if plate:
            agora = time.time()
            if agora - ultimo.get(plate, 0) > RESEND_COOLDOWN_S:
                ultimo[plate] = agora
                print(f"[camera] placa lida: {plate}")
                enviar_placa(plate)
        time.sleep(CAPTURE_EVERY_S)


if __name__ == "__main__":
    main()

"""Teste manual pela webcam, direto no motor (não precisa do serviço no ar).

  python teste_webcam.py cadastrar giovani   -> tecla ESPAÇO tira a foto
  python teste_webcam.py identificar         -> mostra quem é e o score, ao vivo
  python teste_webcam.py remover giovani

Usa a mesma base cifrada do serviço (dados/). ESC sai.
"""
import sys

import cv2

import config
from base import Base
from cofre import Cofre
from motor import ErroRosto, Motor

acao = sys.argv[1] if len(sys.argv) > 1 else "identificar"
base = Base(Cofre(config.DADOS))
if acao == "remover":
    print("removido:", base.remover(sys.argv[2]))
    sys.exit()

motor = Motor()
cam = cv2.VideoCapture(0)
while True:
    ok, quadro = cam.read()
    if not ok:
        sys.exit("Sem imagem da webcam")
    texto = "ESPACO = cadastrar" if acao == "cadastrar" else ""
    if acao == "identificar":
        try:
            r = base.identificar(motor.extrair(quadro, False), config.LIMIAR_GERAL, config.MARGEM)
            texto = f"{r.cliente_id or 'NAO RECONHECIDO'}  score {r.score:.2f}"
        except ErroRosto as e:
            texto = e.codigo
    cv2.putText(quadro, texto, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
    cv2.imshow("rosto", quadro)
    tecla = cv2.waitKey(30) & 0xFF
    if tecla == 27:
        break
    if tecla == 32 and acao == "cadastrar":
        try:
            base.cadastrar(sys.argv[2], motor.extrair(quadro, True))
            print("cadastrado:", sys.argv[2])
            break
        except ErroRosto as e:
            print(e.codigo)

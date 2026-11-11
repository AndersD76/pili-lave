"""Da imagem para a assinatura do rosto: YuNet (detecção) + SFace (assinatura).

Os dois modelos são do OpenCV Zoo, rodam em CPU e têm licença que permite uso
comercial (YuNet: MIT; SFace: Apache 2.0).
"""
import base64
import binascii
import threading

import cv2
import numpy as np

import config

DETECTOR = "face_detection_yunet_2023mar.onnx"
RECONHECEDOR = "face_recognition_sface_2021dec.onnx"
LADO_MAXIMO = 1280


class ErroRosto(Exception):
    """codigo: IMAGEM_INVALIDA | SEM_ROSTO | MAIS_DE_UM_ROSTO"""

    def __init__(self, codigo: str):
        super().__init__(codigo)
        self.codigo = codigo


def decodificar_base64(texto: str) -> np.ndarray:
    if "," in texto[:64]:
        texto = texto.split(",", 1)[1]
    try:
        bruto = base64.b64decode(texto, validate=False)
    except (binascii.Error, ValueError):
        raise ErroRosto("IMAGEM_INVALIDA")
    return decodificar_bytes(bruto)


def decodificar_bytes(bruto: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(bruto, dtype=np.uint8), cv2.IMREAD_COLOR) if bruto else None
    if img is None:
        raise ErroRosto("IMAGEM_INVALIDA")
    return img


class Motor:
    def __init__(self):
        for nome in (DETECTOR, RECONHECEDOR):
            if not (config.MODELOS / nome).exists():
                raise FileNotFoundError(f"Falta o modelo {nome}: rode `python baixar_modelos.py`")
        self._det = cv2.FaceDetectorYN.create(str(config.MODELOS / DETECTOR), "", (320, 320), config.CONFIANCA_DETECCAO, 0.3, 50)
        self._rec = cv2.FaceRecognizerSF.create(str(config.MODELOS / RECONHECEDOR), "")
        self._trava = threading.Lock()

    def extrair(self, img: np.ndarray, exigir_unico: bool) -> np.ndarray:
        """Assinatura (128 números, normalizada) do maior rosto da imagem."""
        h, w = img.shape[:2]
        escala = LADO_MAXIMO / max(h, w)
        if escala < 1:
            img = cv2.resize(img, (round(w * escala), round(h * escala)), interpolation=cv2.INTER_AREA)
            h, w = img.shape[:2]
        with self._trava:
            self._det.setInputSize((w, h))
            _, rostos = self._det.detect(img)
            if rostos is None:
                raise ErroRosto("SEM_ROSTO")
            rostos = [r for r in rostos if min(r[2], r[3]) >= config.ROSTO_MINIMO_PX]
            if not rostos:
                raise ErroRosto("SEM_ROSTO")
            rostos.sort(key=lambda r: r[2] * r[3], reverse=True)
            if exigir_unico and len(rostos) > 1:
                maior = rostos[0][2] * rostos[0][3]
                if rostos[1][2] * rostos[1][3] >= maior * config.FRACAO_SEGUNDO_ROSTO:
                    raise ErroRosto("MAIS_DE_UM_ROSTO")
            alinhado = self._rec.alignCrop(img, rostos[0])
            emb = self._rec.feature(alinhado).reshape(-1).astype(np.float32)
        return emb / np.linalg.norm(emb)

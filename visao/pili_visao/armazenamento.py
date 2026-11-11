"""Imagens e clipes dos eventos em dados/eventos/AAAA-MM-DD, com limpeza por idade."""
import re
import time
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np


LARGURA_MAXIMA = 1280
BYTES_MAXIMO = 300_000  # a loja aceita até 400 KB por imagem


def codificar(quadro: np.ndarray, qualidade: int = 70) -> bytes:
    """JPEG reduzido: no máximo 1280 px de largura e 300 KB."""
    if quadro.shape[1] > LARGURA_MAXIMA:
        quadro = cv2.resize(quadro, (LARGURA_MAXIMA, round(quadro.shape[0] * LARGURA_MAXIMA / quadro.shape[1])))
    while True:
        ok, buf = cv2.imencode(".jpg", quadro, [cv2.IMWRITE_JPEG_QUALITY, qualidade])
        if not ok:
            return b""
        if len(buf) <= BYTES_MAXIMO or qualidade <= 30:
            return buf.tobytes()
        qualidade -= 15


def decodificar(jpeg: bytes) -> np.ndarray:
    return cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)


class Armazenamento:
    def __init__(self, pasta_dados: Path, dias_guardar: float = 7):
        self.pasta = Path(pasta_dados)
        self.eventos = self.pasta / "eventos"
        self.referencias = self.pasta / "referencias"
        self.fila = self.pasta / "fila"
        for p in (self.eventos, self.referencias, self.fila):
            p.mkdir(parents=True, exist_ok=True)
        self.dias_guardar = dias_guardar
        self._ultima_limpeza = 0.0
        self._seq = 0

    def _caminho(self, camera: str, rotulo: str, agora: float, ext: str) -> Path:
        momento = datetime.fromtimestamp(agora)
        pasta = self.eventos / momento.strftime("%Y-%m-%d")
        pasta.mkdir(parents=True, exist_ok=True)
        self._seq += 1
        limpo = re.sub(r"[^A-Za-z0-9_-]+", "_", f"{camera}_{rotulo}")
        return (pasta / f"{momento.strftime('%H%M%S')}_{self._seq:05d}_{limpo}.{ext}").resolve()

    def salvar_jpeg(self, camera: str, rotulo: str, imagem, agora: float) -> str:
        caminho = self._caminho(camera, rotulo, agora, "jpg")
        caminho.write_bytes(imagem if isinstance(imagem, bytes) else codificar(imagem))
        return str(caminho)

    def salvar_clipe(self, camera: str, rotulo: str, quadros_jpeg: list[bytes], fps: float, agora: float) -> str | None:
        if not quadros_jpeg:
            return None
        caminho = self._caminho(camera, rotulo, agora, "mp4")
        primeiro = decodificar(quadros_jpeg[0])
        alt, larg = primeiro.shape[:2]
        video = cv2.VideoWriter(str(caminho), cv2.VideoWriter_fourcc(*"mp4v"), max(1.0, fps), (larg, alt))
        if not video.isOpened():
            return None
        for jpeg in quadros_jpeg:
            video.write(decodificar(jpeg))
        video.release()
        return str(caminho)

    def limpar(self, agora_real: float | None = None, forcar: bool = False) -> int:
        agora_real = time.time() if agora_real is None else agora_real
        if not forcar and agora_real - self._ultima_limpeza < 3600:
            return 0
        self._ultima_limpeza = agora_real
        limite = agora_real - self.dias_guardar * 86400
        apagados = 0
        for arquivo in self.eventos.rglob("*"):
            if arquivo.is_file() and arquivo.stat().st_mtime < limite:
                arquivo.unlink()
                apagados += 1
        for pasta in self.eventos.iterdir():
            if pasta.is_dir() and not any(pasta.iterdir()):
                pasta.rmdir()
        return apagados

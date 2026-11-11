"""Rastreamento de pessoas. A interface é só `atualizar(quadro) -> [Rastro]`."""
from dataclasses import dataclass


@dataclass
class Rastro:
    id: int
    caixa: tuple[float, float, float, float]  # x1, y1, x2, y2 em pixels
    confianca: float = 1.0


class RastreadorYolo:
    """YOLO (classe pessoa) + ByteTrack do Ultralytics. Um por câmera: o
    ByteTrack guarda o histórico dentro do modelo."""

    def __init__(self, pesos="yolo11n.pt", dispositivo="auto", imgsz=480, confianca=0.35):
        import torch
        from ultralytics import YOLO

        if dispositivo == "auto":
            dispositivo = 0 if torch.cuda.is_available() else "cpu"
        self.dispositivo = dispositivo
        self.imgsz = imgsz
        self.confianca = confianca
        self.modelo = YOLO(pesos)

    def atualizar(self, quadro) -> list[Rastro]:
        r = self.modelo.track(
            quadro,
            persist=True,
            classes=[0],
            tracker="bytetrack.yaml",
            imgsz=self.imgsz,
            conf=self.confianca,
            device=self.dispositivo,
            verbose=False,
        )[0]
        if r.boxes is None or r.boxes.id is None:
            return []
        ids = r.boxes.id.int().cpu().tolist()
        caixas = r.boxes.xyxy.cpu().tolist()
        confs = r.boxes.conf.cpu().tolist()
        return [Rastro(i, tuple(c), f) for i, c, f in zip(ids, caixas, confs)]


class RastreadorRoteiro:
    """Rastros prontos, um conjunto por quadro — para testes e simulação."""

    def __init__(self, roteiro: list[list[Rastro]]):
        self.roteiro = roteiro
        self.i = 0

    def atualizar(self, quadro) -> list[Rastro]:
        rastros = self.roteiro[self.i] if self.i < len(self.roteiro) else []
        self.i += 1
        return rastros

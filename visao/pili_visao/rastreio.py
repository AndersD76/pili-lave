"""Rastreamento de pessoas. A interface é só `atualizar(quadro) -> [Rastro]`."""
from dataclasses import dataclass


@dataclass
class Rastro:
    id: int
    caixa: tuple[float, float, float, float]  # x1, y1, x2, y2 em pixels
    confianca: float = 1.0


class RastreadorYolo:
    """YOLO (classe pessoa) + ByteTrack do Ultralytics. Um por câmera: o
    ByteTrack guarda o histórico dentro do modelo.

    ATENÇÃO À LICENÇA: o Ultralytics é AGPL-3.0 (uso comercial fechado pede a
    licença Enterprise). Fica aqui só para comparação; o padrão do programa é
    o RastreadorYolox (Apache-2.0)."""

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


# ---------------------------------------------------------------------------
# YOLOX (Apache-2.0) em ONNX Runtime + associação no estilo do ByteTrack
# ---------------------------------------------------------------------------

def _iou(a, b):
    """IoU de cada caixa de `a` (N×4) com cada caixa de `b` (M×4)."""
    import numpy as np

    a, b = np.asarray(a, np.float32).reshape(-1, 4), np.asarray(b, np.float32).reshape(-1, 4)
    x1 = np.maximum(a[:, None, 0], b[None, :, 0])
    y1 = np.maximum(a[:, None, 1], b[None, :, 1])
    x2 = np.minimum(a[:, None, 2], b[None, :, 2])
    y2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area_a = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1])
    area_b = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    return inter / np.maximum(area_a[:, None] + area_b[None, :] - inter, 1e-6)


class AssociadorCaixas:
    """Dá um id estável a cada pessoa, quadro a quadro, do jeito do ByteTrack:
    primeiro casa os rastros com as detecções de confiança alta, depois tenta
    as de confiança baixa (pessoa meio encoberta) com os rastros que sobraram.
    Rastro sem detecção é guardado por `quadros_perdido` quadros antes de
    morrer. Sem filtro de Kalman: a previsão é só o último deslocamento."""

    def __init__(self, alta=0.5, iou_alta=0.2, iou_baixa=0.4, quadros_perdido=30):
        self.alta, self.iou_alta, self.iou_baixa = alta, iou_alta, iou_baixa
        self.quadros_perdido = quadros_perdido
        self.rastros: dict[int, dict] = {}
        self.proximo = 1

    @staticmethod
    def _casar(rastros: list, dets: list, iou_minimo: float):
        import lap
        import numpy as np

        if not rastros or not dets:
            return [], list(range(len(rastros))), list(range(len(dets)))
        custo = 1.0 - _iou([r["prevista"] for r in rastros], [d[0] for d in dets])
        _, x, _ = lap.lapjv(custo, extend_cost=True, cost_limit=1.0 - iou_minimo)
        pares = [(i, int(j)) for i, j in enumerate(x) if j >= 0]
        usados_r, usados_d = {i for i, _ in pares}, {j for _, j in pares}
        return (pares, [i for i in range(len(rastros)) if i not in usados_r],
                [j for j in range(len(dets)) if j not in usados_d])

    def atualizar(self, deteccoes: list[tuple]) -> list[Rastro]:
        """deteccoes = [((x1, y1, x2, y2), confianca)]. Devolve só os rastros vistos neste quadro."""
        for r in self.rastros.values():
            r["idade"] += 1
            r["prevista"] = tuple(c + v for c, v in zip(r["caixa"], r["vel"])) if r["idade"] == 1 else r["caixa"]
        altas = [d for d in deteccoes if d[1] >= self.alta]
        baixas = [d for d in deteccoes if d[1] < self.alta]
        lista = list(self.rastros.values())
        vistos = []

        def aplicar(r, det):
            r["vel"] = tuple(n - a for n, a in zip(det[0], r["caixa"])) if r["idade"] == 1 else (0.0,) * 4
            r["caixa"], r["conf"], r["idade"] = tuple(det[0]), det[1], 0
            vistos.append(r)

        pares, sobra_r, sobra_d = self._casar(lista, altas, self.iou_alta)
        for i, j in pares:
            aplicar(lista[i], altas[j])
        restantes = [lista[i] for i in sobra_r]
        pares2, _, _ = self._casar(restantes, baixas, self.iou_baixa)
        for i, j in pares2:
            aplicar(restantes[i], baixas[j])
        for j in sobra_d:
            r = {"id": self.proximo, "caixa": tuple(altas[j][0]), "prevista": tuple(altas[j][0]),
                 "vel": (0.0,) * 4, "conf": altas[j][1], "idade": 0}
            self.rastros[self.proximo] = r
            self.proximo += 1
            vistos.append(r)
        for id_ in [i for i, r in self.rastros.items() if r["idade"] > self.quadros_perdido]:
            del self.rastros[id_]
        return [Rastro(r["id"], r["caixa"], r["conf"]) for r in vistos]


class DetectorYolox:
    """Pessoas com o YOLOX oficial (Megvii, Apache-2.0) em ONNX Runtime."""

    def __init__(self, pesos: str, confianca_minima=0.1, nms=0.45):
        import onnxruntime as ort

        disponiveis = ort.get_available_providers()
        provedores = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in disponiveis]
        self.sessao = ort.InferenceSession(str(pesos), providers=provedores)
        self.dispositivo = 0 if self.sessao.get_providers()[0].startswith("CUDA") else "cpu"
        entrada = self.sessao.get_inputs()[0]
        self.entrada = entrada.name
        self.alt, self.larg = int(entrada.shape[2]), int(entrada.shape[3])
        self.confianca_minima, self.nms = confianca_minima, nms
        self._grade = None

    def _grades(self):
        import numpy as np

        if self._grade is None:
            grades, passos = [], []
            for passo in (8, 16, 32):
                h, w = self.alt // passo, self.larg // passo
                xv, yv = np.meshgrid(np.arange(w), np.arange(h))
                grades.append(np.stack((xv, yv), 2).reshape(-1, 2))
                passos.append(np.full((h * w, 1), passo))
            self._grade = (np.concatenate(grades).astype(np.float32), np.concatenate(passos).astype(np.float32))
        return self._grade

    def detectar(self, quadro) -> list[tuple]:
        """[((x1, y1, x2, y2), confianca)] das pessoas, em pixels do quadro."""
        import cv2
        import numpy as np

        r = min(self.alt / quadro.shape[0], self.larg / quadro.shape[1])
        tela = np.full((self.alt, self.larg, 3), 114, np.uint8)
        menor = cv2.resize(quadro, (round(quadro.shape[1] * r), round(quadro.shape[0] * r)), interpolation=cv2.INTER_LINEAR)
        tela[:menor.shape[0], :menor.shape[1]] = menor
        blob = tela.transpose(2, 0, 1)[None].astype(np.float32)   # BGR, 0–255, sem normalizar
        saida = self.sessao.run(None, {self.entrada: blob})[0][0]
        grade, passo = self._grades()
        pontos = saida[:, 4] * saida[:, 5]                        # objeto × classe 0 (pessoa)
        manter = pontos >= self.confianca_minima
        if not manter.any():
            return []
        saida, pontos, grade, passo = saida[manter], pontos[manter], grade[manter], passo[manter]
        centro = (saida[:, :2] + grade) * passo
        tam = np.exp(saida[:, 2:4]) * passo
        xywh = np.concatenate((centro - tam / 2, tam), 1) / r
        idx = cv2.dnn.NMSBoxes(xywh.tolist(), pontos.tolist(), self.confianca_minima, self.nms)
        dets = []
        for i in np.array(idx).reshape(-1):
            x, y, w, h = xywh[i]
            dets.append(((float(x), float(y), float(x + w), float(y + h)), float(pontos[i])))
        return dets


class RastreadorYolox:
    """YOLOX + AssociadorCaixas. Um por câmera."""

    def __init__(self, pesos, confianca=0.35, fps=5):
        self.detector = DetectorYolox(pesos)
        self.dispositivo = self.detector.dispositivo
        self.confianca = confianca
        # detecção abaixo de `confianca` só serve pra segurar um rastro que já existe
        self.associador = AssociadorCaixas(alta=confianca, quadros_perdido=max(5, int(fps * 6)))

    def atualizar(self, quadro) -> list[Rastro]:
        return self.associador.atualizar(self.detector.detectar(quadro))


def criar_rastreador(p: dict, raiz=None):
    """Rastreador de pessoas conforme a seção "pessoas" do config."""
    from pathlib import Path

    pesos = Path(p["pesos"])
    if not pesos.is_absolute() and raiz is not None:
        pesos = Path(raiz) / pesos
    if p.get("detector", "yolox") == "ultralytics":
        return RastreadorYolo(str(pesos if pesos.exists() else p["pesos"]), p["dispositivo"], p["imgsz"], p["confianca"])
    if not pesos.exists():
        raise SystemExit(f"Modelo {pesos} não encontrado. Rode: python baixar_modelos.py")
    return RastreadorYolox(pesos, p["confianca"], p["fpsAlvo"])

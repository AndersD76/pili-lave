"""Fonte de vídeo (RTSP, webcam ou arquivo) e vigia de câmera caída/desalinhada."""
import threading
import time

import cv2
import numpy as np


class FonteVideo:
    """Fonte ao vivo lê numa thread e entrega sempre o quadro mais novo
    (RTSP acumula atraso se ninguém esvazia o buffer). Arquivo é lido em ordem."""

    def __init__(self, fonte, reconectar_segundos: float = 5.0):
        self.fonte = int(fonte) if isinstance(fonte, str) and fonte.isdigit() else fonte
        self.ao_vivo = isinstance(self.fonte, int) or str(self.fonte).lower().startswith(("rtsp://", "http://", "https://"))
        self.reconectar_segundos = reconectar_segundos
        self._cap = None
        self._quadro = None
        self._novo = False
        self._trava = threading.Lock()
        self._parar = False
        self._ultima_tentativa = 0.0
        if self.ao_vivo:
            threading.Thread(target=self._laco, daemon=True).start()
        else:
            self._abrir()

    def _abrir(self) -> bool:
        self._ultima_tentativa = time.time()
        if self._cap is not None:
            self._cap.release()
        self._cap = cv2.VideoCapture(self.fonte)
        return self._cap.isOpened()

    def _laco(self):
        while not self._parar:
            if self._cap is None or not self._cap.isOpened():
                if time.time() - self._ultima_tentativa < self.reconectar_segundos or not self._abrir():
                    time.sleep(0.2)
                    continue
            ok, quadro = self._cap.read()
            if not ok:
                self._cap.release()
                time.sleep(0.2)
                continue
            with self._trava:
                self._quadro, self._novo = quadro, True

    def ler(self) -> np.ndarray | None:
        if self.ao_vivo:
            with self._trava:
                if not self._novo:
                    return None
                self._novo = False
                return self._quadro
        if self._cap is None or not self._cap.isOpened():
            return None
        ok, quadro = self._cap.read()
        return quadro if ok else None

    def fechar(self):
        self._parar = True
        if self._cap is not None:
            self._cap.release()


def _miniatura(quadro: np.ndarray) -> np.ndarray:
    cinza = cv2.cvtColor(quadro, cv2.COLOR_BGR2GRAY) if quadro.ndim == 3 else quadro
    return cv2.GaussianBlur(cv2.resize(cinza, (320, 180)), (5, 5), 0)


class VigiaCamera:
    """Devolve avisos ("CAIU", "VOLTOU", "DESALINHADA", "TAPADA", "ALINHADA")
    para virarem eventos CAMERA. Cada situação avisa uma vez só."""

    def __init__(self, referencia: np.ndarray | None, segundos_sem_quadro=10, intervalo=30, desvio_maximo=0.02, repeticoes=3):
        self.ref = _miniatura(referencia) if referencia is not None else None
        self.segundos_sem_quadro = segundos_sem_quadro
        self.intervalo = intervalo
        self.desvio_maximo = desvio_maximo
        self.repeticoes = repeticoes
        self._ultimo_quadro: float | None = None
        self._caida = False
        self._ultima_checagem = -1e18
        self._suspeitas = {"DESALINHADA": 0, "TAPADA": 0}
        self._estado = None

    def definir_referencia(self, quadro: np.ndarray) -> None:
        self.ref = _miniatura(quadro)

    def sem_quadro(self, agora: float) -> str | None:
        if self._ultimo_quadro is None:
            self._ultimo_quadro = agora
        if not self._caida and agora - self._ultimo_quadro >= self.segundos_sem_quadro:
            self._caida = True
            return "CAIU"
        return None

    def com_quadro(self, agora: float) -> str | None:
        self._ultimo_quadro = agora
        if self._caida:
            self._caida = False
            return "VOLTOU"
        return None

    def desvio(self, quadro: np.ndarray) -> float:
        atual = _miniatura(quadro)
        (dx, dy), resposta = cv2.phaseCorrelate(self.ref.astype(np.float32), atual.astype(np.float32), cv2.createHanningWindow((320, 180), cv2.CV_32F))
        if resposta < 0.25:  # sem textura suficiente para medir: não acusa
            return 0.0
        return float(np.hypot(dx / 320, dy / 180))

    @property
    def problema(self) -> str | None:
        return self._estado

    def conferir(self, quadro: np.ndarray, agora: float, forcar: bool = False) -> str | None:
        """Chamar só com a cena vazia (sem pessoas no quadro)."""
        if not forcar and agora - self._ultima_checagem < self.intervalo:
            return None
        self._ultima_checagem = agora
        if self.ref is None:
            return None
        problema = None
        if float(_miniatura(quadro).std()) < 6 and float(self.ref.std()) >= 12:
            problema = "TAPADA"
        elif self.desvio(quadro) > self.desvio_maximo:
            problema = "DESALINHADA"
        for nome in self._suspeitas:
            self._suspeitas[nome] = self._suspeitas[nome] + 1 if nome == problema else 0
        if problema and self._suspeitas[problema] >= self.repeticoes and self._estado != problema:
            self._estado = problema
            return problema
        if problema is None and self._estado is not None:
            self._estado = None
            return "ALINHADA"
        return None

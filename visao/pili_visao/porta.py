"""Sirene e barreira de luz da porta. O hardware é do Giovani (ESP32): aqui
ficam a interface e uma versão simulada, que só registra no log."""
import logging

log = logging.getLogger("visao.porta")


class Sirene:
    ligada = False

    def ligar(self) -> None:
        raise NotImplementedError

    def desligar(self) -> None:
        raise NotImplementedError


class SireneSimulada(Sirene):
    def ligar(self):
        if not self.ligada:
            log.warning("SIRENE LIGADA (simulada)")
        self.ligada = True

    def desligar(self):
        if self.ligada:
            log.warning("sirene desligada (simulada)")
        self.ligada = False


class BarreiraLuz:
    def cruzou_recentemente(self, agora: float) -> bool:
        raise NotImplementedError


class BarreiraSimulada(BarreiraLuz):
    """Sem o sensor ligado, confirma sempre (vale só a câmera)."""

    def __init__(self, confirma: bool = True):
        self.confirma = confirma

    def cruzou_recentemente(self, agora):
        return self.confirma


class MonitorPorta:
    """Invasão liga a sirene; ela desliga N segundos depois de o invasor
    sair do campo de visão. Se ele voltar antes, a contagem recomeça."""

    def __init__(self, sirene: Sirene, barreira: BarreiraLuz, segundos: float = 30, exigir_barreira: bool = True):
        self.sirene = sirene
        self.barreira = barreira
        self.segundos = segundos
        self.exigir_barreira = exigir_barreira
        self._sumiu_em: float | None = None
        self._visiveis: dict[str, bool] = {}

    def confirma_invasao(self, agora: float) -> bool:
        return not self.exigir_barreira or self.barreira.cruzou_recentemente(agora)

    def invasao(self, agora: float) -> None:
        self.sirene.ligar()
        self._sumiu_em = None

    def atualizar(self, camera: str, intruso_visivel: bool, agora: float) -> None:
        self._visiveis[camera] = intruso_visivel
        if not self.sirene.ligada:
            return
        if any(self._visiveis.values()):
            self._sumiu_em = None
        elif self._sumiu_em is None:
            self._sumiu_em = agora
        elif agora - self._sumiu_em >= self.segundos:
            self.sirene.desligar()
            self._sumiu_em = None

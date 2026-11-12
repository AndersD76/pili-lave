"""Liga cada rastro de pessoa (câmera, id) a uma visita aberta na loja.

Heurística simples: quem nasce na zona da porta recebe a visita ativa mais
recente que ainda não tem rastro naquela câmera. Não confere rosto — duas
pessoas entrando coladas podem ficar trocadas.
"""

INTRUSO = "__INTRUSO__"
ESPERA_SEM_RESPOSTA = 15.0


class VinculoVisitas:
    def __init__(self, buscar_ativas, intervalo: float = 2.0):
        self.buscar_ativas = buscar_ativas
        self.intervalo = intervalo
        self.ativas: list[dict] = []
        self.vinculos: dict[tuple, str] = {}
        self._ultima_busca = -1e18
        self._sem_resposta_ate = -1e18   # loja fora do ar: so tenta de novo depois disso

    def atualizar(self, agora: float, forcar: bool = False) -> None:
        if agora < self._sem_resposta_ate or (not forcar and agora - self._ultima_busca < self.intervalo):
            return
        self._ultima_busca = agora
        lista = self.buscar_ativas()
        if lista is None:
            # a loja nao respondeu: cada tentativa trava o quadro ate o tempo
            # limite da chamada, entao espera um pouco antes de insistir
            self._sem_resposta_ate = agora + ESPERA_SEM_RESPOSTA
            return
        self.ativas = sorted(lista, key=lambda v: str(v.get("entrouEm", "")), reverse=True)
        abertas = {v["visitaId"] for v in self.ativas}
        for chave, visita in list(self.vinculos.items()):
            if visita != INTRUSO and visita not in abertas:
                del self.vinculos[chave]

    def loja_respondendo(self, agora: float) -> bool:
        return agora >= self._sem_resposta_ate

    def vincular_entrada(self, chave: tuple, agora: float) -> str | None:
        self.atualizar(agora, forcar=agora - self._ultima_busca >= 0.5)
        camera = chave[0]
        ocupadas = {v for c, v in self.vinculos.items() if c[0] == camera}
        for visita in self.ativas:
            if visita["visitaId"] not in ocupadas:
                self.vinculos[chave] = visita["visitaId"]
                return visita["visitaId"]
        return None

    def vincular_unica(self, chave: tuple) -> str | None:
        """Loja com uma visita só: qualquer rastro é dela."""
        if len(self.ativas) == 1:
            self.vinculos[chave] = self.ativas[0]["visitaId"]
            return self.vinculos[chave]
        return None

    def herdar(self, nova: tuple, antiga: tuple) -> None:
        if antiga in self.vinculos:
            self.vinculos[nova] = self.vinculos.pop(antiga)

    def marcar_intruso(self, chave: tuple) -> None:
        self.vinculos[chave] = INTRUSO

    def eh_intruso(self, chave: tuple) -> bool:
        return self.vinculos.get(chave) == INTRUSO

    def visita_de(self, chave: tuple) -> str | None:
        visita = self.vinculos.get(chave)
        return None if visita == INTRUSO else visita

    def soltar(self, chave: tuple) -> None:
        self.vinculos.pop(chave, None)

"""Conversa com o programa da loja (porta 3100) e fila em disco dos eventos."""
import json
import logging
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("visao.loja")


class EventoRejeitado(Exception):
    """A loja respondeu que o evento é inválido: repetir não adianta."""


class ClienteLoja:
    def __init__(self, url: str, token: str | None, timeout: float = 2.0):
        self.url = url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def _pedir(self, caminho: str, corpo: dict | None = None):
        dados = json.dumps(corpo).encode("utf-8") if corpo is not None else None
        req = urllib.request.Request(self.url + caminho, data=dados, method="POST" if dados else "GET")
        req.add_header("content-type", "application/json")
        if self.token:
            req.add_header("x-loja-token", self.token)
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            texto = resp.read().decode("utf-8")
            return json.loads(texto) if texto.strip() else None

    def visitas_ativas(self) -> list[dict] | None:
        """None = a loja não respondeu (quem chama mantém a última lista)."""
        try:
            lista = self._pedir("/api/visitas/ativas")
            if isinstance(lista, dict):
                lista = lista.get("visitas", [])
            return lista or []
        except Exception as e:
            log.debug("visitas ativas: %s", e)
            return None

    def enviar_evento(self, evento: dict) -> bool:
        try:
            self._pedir("/api/visao/eventos", evento)
            return True
        except urllib.error.HTTPError as e:
            if e.code in (400, 413, 422):
                raise EventoRejeitado(f"HTTP {e.code}") from e
            log.debug("envio de evento: %s", e)
            return False
        except Exception as e:
            log.debug("envio de evento: %s", e)
            return False


def novo_evento(tipo, zona, agora: float, delta=0, visitas=(), imagens=(), **extra) -> dict:
    return {
        "id": uuid.uuid4().hex,
        "tipo": tipo,
        "zona": zona,
        "delta": delta,
        "visitasNaZona": list(visitas),
        "imagens": [str(i) for i in imagens],
        "ocorridoEm": datetime.fromtimestamp(agora, timezone.utc).isoformat().replace("+00:00", "Z"),
        **extra,
    }


class Emissor:
    """Todo evento passa pela fila em disco: grava, depois tenta mandar em
    ordem. Se a loja não responde, fica guardado até a próxima tentativa."""

    def __init__(self, enviar, pasta_fila: Path):
        self.enviar = enviar
        self.pasta = Path(pasta_fila)
        self.pasta.mkdir(parents=True, exist_ok=True)
        self._seq = 0

    def emitir(self, evento: dict) -> None:
        self._seq += 1
        nome = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f')}-{self._seq:06d}-{evento['id'][:8]}.json"
        (self.pasta / nome).write_text(json.dumps(evento, ensure_ascii=False), encoding="utf-8")
        log.info("evento %s zona=%s delta=%s visitas=%s", evento["tipo"], evento["zona"], evento["delta"], evento["visitasNaZona"])
        self.descarregar()

    def pendentes(self) -> list[Path]:
        return sorted(self.pasta.glob("*.json"))

    def descarregar(self) -> int:
        enviados = 0
        for arquivo in self.pendentes():
            try:
                evento = json.loads(arquivo.read_text(encoding="utf-8"))
            except Exception:
                arquivo.rename(arquivo.with_suffix(".invalido"))
                continue
            try:
                if not self.enviar(evento):
                    break
            except EventoRejeitado as e:
                log.error("evento %s recusado pela loja (%s): guardado como .rejeitado", evento.get("id"), e)
                arquivo.rename(arquivo.with_suffix(".rejeitado"))
                continue
            arquivo.unlink()
            enviados += 1
        return enviados

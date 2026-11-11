"""PROVISÓRIO — adaptador da catraca Control iD (iDBlock Next Facial), modo Enterprise.

Escrito SÓ a partir da documentação pública da Access API, sem o equipamento
na mão e antes das respostas do fabricante ao questionário de 09/11/2026:
  https://www.controlid.com.br/docs/access-api-en/operating-modes/online-identification-events/
  https://www.controlid.com.br/docs/access-api-en/actions/remote_access_authorization

Tudo o que depende do formato do equipamento está neste arquivo. Pontos a
confirmar com a catraca real (marcados com CONFIRMAR abaixo):
  - formato do corpo de new_biometric_image.fcgi quando a biometria é FACIAL;
  - se a resposta do evento já libera o giro (é o que a doc descreve);
  - qual sentido (clockwise/anticlockwise) é "entrar" na instalação;
  - tempo máximo que a catraca espera a resposta.

Segurança: a catraca não manda o x-loja-token. Estas rotas só respondem se
CONTROLID_IP estiver configurado e a chamada vier desse IP (e, se
CONTROLID_DEVICE_ID estiver preenchido, desse device_id). Para a catraca
alcançar o serviço, ROSTO_HOST precisa ser o IP do computador na rede da loja.
"""
from typing import Callable

import cv2
import httpx
import numpy as np
from fastapi import APIRouter, Request

import config

EVENTO_NAO_IDENTIFICADO = 3
EVENTO_NEGADO = 6
EVENTO_LIBERADO = 7


def decodificar_imagem(corpo: bytes, largura: int, altura: int) -> np.ndarray | None:
    """CONFIRMAR: a doc descreve o corpo como tons de cinza crus, 1 byte por
    pixel (texto herdado da digital). Aceita também JPEG/PNG e BGR cru."""
    if not corpo:
        return None
    img = cv2.imdecode(np.frombuffer(corpo, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is not None:
        return img
    if largura > 0 and altura > 0:
        if len(corpo) == largura * altura:
            cinza = np.frombuffer(corpo, dtype=np.uint8).reshape(altura, largura)
            return cv2.cvtColor(cinza, cv2.COLOR_GRAY2BGR)
        if len(corpo) == largura * altura * 3:
            return np.frombuffer(corpo, dtype=np.uint8).reshape(altura, largura, 3).copy()
    return None


def resposta(evento: int, mensagem: str, portal_id: int = 1, liberar: bool = False) -> dict:
    r = {"event": evento, "user_image": False, "portal_id": portal_id, "actions": [], "message": mensagem[:60]}
    if liberar:
        r["actions"] = [{"action": "catra", "parameters": f"allow={config.CONTROLID_SENTIDO}"}]
    return {"result": r}


async def autorizar_na_loja(cliente_id: str) -> dict:
    """Pergunta ao programa da loja (lotação, bloqueio, reposição…)."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as http:
            r = await http.post(
                f"{config.URL_LOJA}/api/entrada/autorizar",
                json={"nuvemUserId": cliente_id, "origem": "CATRACA"},
                headers={"x-loja-token": config.token_local() or ""},
            )
            r.raise_for_status()
            return r.json()
    except (httpx.HTTPError, ValueError):
        return {"liberado": False, "motivo": "LOJA_INDISPONIVEL", "mensagem": "Sistema indisponível. Tente de novo."}


def criar_rotas(identificar_imagem: Callable[..., dict]) -> APIRouter:
    rotas = APIRouter()

    def origem_valida(req: Request) -> bool:
        if not config.CONTROLID_IP or not req.client or req.client.host != config.CONTROLID_IP:
            return False
        esperado = config.CONTROLID_DEVICE_ID
        return not esperado or req.query_params.get("device_id") == esperado

    def inteiro(req: Request, nome: str, padrao: int = 0) -> int:
        try:
            return int(req.query_params.get(nome, padrao))
        except ValueError:
            return padrao

    @rotas.post("/new_biometric_image.fcgi")
    async def nova_imagem(req: Request):
        portal = inteiro(req, "portal_id", 1)
        if not origem_valida(req):
            return resposta(EVENTO_NEGADO, "Equipamento não autorizado", portal)
        img = decodificar_imagem(await req.body(), inteiro(req, "width"), inteiro(req, "height"))
        if img is None:
            return resposta(EVENTO_NAO_IDENTIFICADO, "Imagem não reconhecida", portal)
        achado = identificar_imagem(img)
        if not achado["encontrado"]:
            return resposta(EVENTO_NAO_IDENTIFICADO, "Rosto não reconhecido. Abra o app Pili.", portal)
        decisao = await autorizar_na_loja(achado["clienteId"])
        if decisao.get("liberado"):
            return resposta(EVENTO_LIBERADO, decisao.get("mensagem") or "Bem-vindo!", portal, liberar=True)
        return resposta(EVENTO_NEGADO, decisao.get("mensagem") or "Entrada não liberada", portal)

    @rotas.post("/new_biometric_template.fcgi")
    async def novo_template(req: Request):
        # O template é Innovatrics (proprietário): só o motor deles compara.
        # A catraca precisa estar com extract_template DESLIGADO.
        return resposta(EVENTO_NEGADO, "Configuração: desligar extract_template", inteiro(req, "portal_id", 1))

    @rotas.post("/new_user_identified.fcgi")
    async def usuario_identificado(req: Request):
        # Modo Pro (identifica na catraca, limite de ~3 mil rostos): não usamos.
        return resposta(EVENTO_NEGADO, "Configuração: desligar local_identification")

    @rotas.post("/device_is_alive.fcgi")
    async def vivo():
        return {}

    return rotas

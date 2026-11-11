"""Serviço local de reconhecimento facial da loja (127.0.0.1:3200)."""
import hmac
from functools import lru_cache

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import config
import controlid
from base import Base
from cofre import Cofre
from motor import ErroRosto, Motor, decodificar_base64

app = FastAPI(title="Pili — reconhecimento facial", docs_url=None, redoc_url=None, openapi_url=None)


@lru_cache(maxsize=1)
def motor() -> Motor:
    return Motor()


@lru_cache(maxsize=1)
def base() -> Base:
    return Base(Cofre(config.DADOS))


def exigir_token(x_loja_token: str | None = Header(default=None)) -> None:
    esperado = config.token_local()
    if not esperado:
        raise HTTPException(503, "Token local não configurado")
    if not x_loja_token or not hmac.compare_digest(x_loja_token.encode(), esperado.encode()):
        raise HTTPException(401, "Token inválido")


class Cadastro(BaseModel):
    clienteId: str = Field(min_length=1, max_length=64)
    imagemBase64: str = Field(min_length=1)


class Identificacao(BaseModel):
    imagemBase64: str = Field(min_length=1)
    candidatos: list[str] | None = None


def identificar_imagem(img, candidatos: list[str] | None = None) -> dict:
    try:
        emb = motor().extrair(img, exigir_unico=False)
    except ErroRosto as e:
        return {"encontrado": False, "score": 0.0, "motivo": e.codigo}
    limiar = config.LIMIAR_CANDIDATOS if candidatos is not None else config.LIMIAR_GERAL
    r = base().identificar(emb, limiar, config.MARGEM, candidatos)
    if r.encontrado:
        return {"encontrado": True, "clienteId": r.cliente_id, "score": round(r.score, 4)}
    return {"encontrado": False, "score": round(r.score, 4), "motivo": "NAO_RECONHECIDO"}


@app.get("/saude", dependencies=[Depends(exigir_token)])
def saude():
    return {"ok": True, "clientes": len(base())}


@app.post("/cadastrar", dependencies=[Depends(exigir_token)])
def cadastrar(c: Cadastro):
    try:
        emb = motor().extrair(decodificar_base64(c.imagemBase64), exigir_unico=True)
    except ErroRosto as e:
        return JSONResponse({"ok": False, "erro": e.codigo}, status_code=422)
    base().cadastrar(c.clienteId, emb)
    return {"ok": True, "clienteId": c.clienteId}


@app.delete("/clientes/{cliente_id}", dependencies=[Depends(exigir_token)])
def remover(cliente_id: str):
    return {"ok": True, "removido": base().remover(cliente_id)}


@app.post("/identificar", dependencies=[Depends(exigir_token)])
def identificar(i: Identificacao):
    try:
        img = decodificar_base64(i.imagemBase64)
    except ErroRosto as e:
        return JSONResponse({"encontrado": False, "score": 0.0, "motivo": e.codigo}, status_code=422)
    return identificar_imagem(img, i.candidatos)


app.include_router(controlid.criar_rotas(identificar_imagem))

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.HOST, port=config.PORTA)

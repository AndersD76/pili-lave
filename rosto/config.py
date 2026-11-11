"""Configuração do serviço de reconhecimento facial (tudo por variável de ambiente)."""
import os
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
MODELOS = RAIZ / "modelos"
DADOS = Path(os.environ.get("ROSTO_DADOS", RAIZ / "dados"))

HOST = os.environ.get("ROSTO_HOST", "127.0.0.1")
PORTA = int(os.environ.get("ROSTO_PORTA", "3200"))

ARQUIVO_TOKEN = RAIZ.parent / "loja" / "dados" / "token-local.txt"
URL_LOJA = os.environ.get("LOJA_URL", "http://127.0.0.1:3100")

# Semelhança de cosseno mínima para aceitar (SFace: 0,363 é o ponto de
# verificação 1:1 do autor do modelo). Aqui o erro caro é identificar a pessoa
# ERRADA, então os padrões ficam bem acima disso. Ver "Calibrar" no LEIAME.
LIMIAR_GERAL = float(os.environ.get("ROSTO_LIMIAR_GERAL", "0.50"))
LIMIAR_CANDIDATOS = float(os.environ.get("ROSTO_LIMIAR_CANDIDATOS", "0.42"))
# O melhor precisa ganhar do segundo colocado por pelo menos isto.
MARGEM = float(os.environ.get("ROSTO_MARGEM", "0.05"))

CONFIANCA_DETECCAO = float(os.environ.get("ROSTO_CONFIANCA_DETECCAO", "0.80"))
ROSTO_MINIMO_PX = int(os.environ.get("ROSTO_MINIMO_PX", "60"))
# No cadastro, um segundo rosto só conta se tiver ao menos esta fração da área
# do maior (ignora gente pequena ao fundo, pôster etc.).
FRACAO_SEGUNDO_ROSTO = 0.25

# Catraca Control iD (PROVISÓRIO). Vazio = rotas da catraca desligadas.
CONTROLID_IP = os.environ.get("CONTROLID_IP", "")
CONTROLID_DEVICE_ID = os.environ.get("CONTROLID_DEVICE_ID", "")
CONTROLID_SENTIDO = os.environ.get("CONTROLID_SENTIDO", "clockwise")


def token_local() -> str | None:
    try:
        t = ARQUIVO_TOKEN.read_text(encoding="utf-8").strip()
        if t:
            return t
    except OSError:
        pass
    return os.environ.get("LOJA_TOKEN_LOCAL") or None

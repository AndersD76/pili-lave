"""Leitura e gravação do config.json (coordenadas das zonas sempre de 0 a 1)."""
import copy
import json
import os
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CAMINHO_PADRAO = RAIZ / "config.json"

PADRAO = {
    "loja": {
        "url": "http://127.0.0.1:3100",
        "tokenArquivo": "../loja/dados/token-local.txt",
        "intervaloVisitasSegundos": 2,
    },
    "pessoas": {
        # "yolox" = YOLOX oficial em ONNX (Apache-2.0), o padrão.
        # "ultralytics" = YOLO da Ultralytics (AGPL-3.0), só para comparação.
        "detector": "yolox",
        "pesos": "modelos/yolox_tiny.onnx",
        "dispositivo": "auto",
        "imgsz": 480,
        "confianca": 0.35,
        "fpsAlvo": 5,
    },
    "prateleira": {
        "detector": "diferenca",
        "pesosSku": None,
        "confiancaSku": 0.3,
        "quadrosEstaveis": 5,
        "limiarPixel": 30,
        "fracaoMinima": 0.02,
        "fracaoMaxima": 0.6,
        "margemPessoa": 0.03,
        "reconferirSegundos": 30,
    },
    "porta": {
        "toleranciaSegundos": 5,
        "sireneSegundos": 30,
        "exigirBarreira": True,
    },
    "camera": {
        "segundosSemQuadro": 10,
        "intervaloAlinhamentoSegundos": 30,
        "desvioMaximo": 0.02,
    },
    # planta baixa (metros) para seguir a pessoa de uma câmera para a outra;
    # cada câmera entra na conta quando tem "chao" calibrado (calibrar_chao.py)
    "planta": {"largura": 6.0, "profundidade": 2.4, "raioMetros": 0.8, "raioPerdidoMetros": 1.5, "segundosPerdido": 15},
    "trajeto": {"pontoSegundos": 0.5, "fotoSegundos": 2.0, "fotoNaPrateleiraSegundos": 1.0},
    "dados": {"pasta": "dados", "diasGuardar": 7},
    "cameras": [],
}


def carregar(caminho=None) -> dict:
    caminho = Path(caminho) if caminho else CAMINHO_PADRAO
    cfg = copy.deepcopy(PADRAO)
    if caminho.exists():
        lido = json.loads(caminho.read_text(encoding="utf-8"))
        for chave, valor in lido.items():
            if isinstance(valor, dict) and isinstance(cfg.get(chave), dict):
                cfg[chave].update(valor)
            else:
                cfg[chave] = valor
    return cfg


def salvar(cfg: dict, caminho=None) -> None:
    caminho = Path(caminho) if caminho else CAMINHO_PADRAO
    caminho.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def pasta_dados(cfg: dict) -> Path:
    pasta = Path(cfg["dados"]["pasta"])
    if not pasta.is_absolute():
        pasta = RAIZ / pasta
    return pasta


def token_loja(cfg: dict) -> str | None:
    token = os.environ.get("LOJA_TOKEN_LOCAL")
    if token:
        return token.strip()
    arquivo = Path(cfg["loja"]["tokenArquivo"])
    if not arquivo.is_absolute():
        arquivo = RAIZ / arquivo
    if arquivo.exists():
        return arquivo.read_text(encoding="utf-8").strip() or None
    return None

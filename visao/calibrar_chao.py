"""Calibra o chão de uma câmera, para o programa seguir a pessoa de uma câmera
para a outra. Uso: python calibrar_chao.py NOME_DA_CAMERA [--config config.json]

1. Marque no chão da loja 4 pontos (ou mais) que a câmera enxergue, bem
   espalhados, e meça onde cada um fica: X = metros a partir da parede esquerda,
   Y = metros a partir da parede do fundo (o mesmo canto para TODAS as câmeras).
2. Clique nos pontos na imagem, na ordem. Botão direito desfaz. ENTER termina.
3. Digite no terminal o X e o Y de cada ponto, na mesma ordem.
"""
import argparse

import cv2

from pili_visao import config as cfgmod
from pili_visao.camera import FonteVideo
from pili_visao.planta import Planta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("camera")
    ap.add_argument("--config", default=None)
    args = ap.parse_args()
    cfg = cfgmod.carregar(args.config)
    cam = next((c for c in cfg["cameras"] if c["nome"] == args.camera), None)
    if cam is None:
        raise SystemExit(f"Câmera '{args.camera}' não está no config.json.")
    fonte = FonteVideo(cam["fonte"])
    quadro = None
    for _ in range(30):
        quadro = fonte.ler()
        if quadro is not None:
            break
    fonte.fechar()
    if quadro is None:
        raise SystemExit("Não consegui ler um quadro dessa câmera.")
    alt, larg = quadro.shape[:2]
    pontos: list[tuple[int, int]] = []

    def clique(evento, x, y, *_):
        if evento == cv2.EVENT_LBUTTONDOWN:
            pontos.append((x, y))
        elif evento == cv2.EVENT_RBUTTONDOWN and pontos:
            pontos.pop()

    janela = f"chao - {args.camera} (clique os pontos, ENTER termina)"
    cv2.namedWindow(janela)
    cv2.setMouseCallback(janela, clique)
    while True:
        tela = quadro.copy()
        for i, p in enumerate(pontos):
            cv2.circle(tela, p, 6, (0, 0, 255), -1)
            cv2.putText(tela, str(i + 1), (p[0] + 8, p[1] - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
        cv2.imshow(janela, tela)
        tecla = cv2.waitKey(30) & 0xFF
        if tecla in (13, 10) and len(pontos) >= 4:
            break
        if tecla == 27:
            raise SystemExit("Cancelado.")
    cv2.destroyAllWindows()

    planta = []
    for i in range(len(pontos)):
        x = float(input(f"Ponto {i + 1} - X em metros (da parede esquerda): ").replace(",", "."))
        y = float(input(f"Ponto {i + 1} - Y em metros (da parede do fundo): ").replace(",", "."))
        planta.append([x, y])
    cam["chao"] = {"imagem": [[round(x / larg, 4), round(y / alt, 4)] for x, y in pontos], "planta": planta}

    teste = Planta({"planta": cfg.get("planta"), "cameras": [cam]})
    if not teste.calibrada(cam["nome"]):
        raise SystemExit("Com esses pontos não dá para calcular (estão em linha?). Nada foi gravado.")
    pior = 0.0
    for img, pl in zip(cam["chao"]["imagem"], planta):
        x, y = teste.para_planta(cam["nome"], img)
        pior = max(pior, ((x - pl[0]) ** 2 + (y - pl[1]) ** 2) ** 0.5)
    cfgmod.salvar(cfg, args.config)
    print(f"Gravado no config. Maior erro nos pontos marcados: {pior * 100:.0f} cm"
          + ("  <- alto: confira as medidas" if pior > 0.3 else ""))


if __name__ == "__main__":
    main()

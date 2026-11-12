"""Trajeto de cada visita dentro da loja: por onde andou (pontos na planta ou
na imagem), em que prateleiras parou e fotos periódicas. Fica em
dados/trajetos/<visita>/ e é compilado (mapa + folhas de fotos) quando a loja
pede, depois de uma divergência de estoque.
"""
import json
import re
import shutil
import time
import unicodedata
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from .armazenamento import codificar

LARGURA_FOTO = 480
FOTOS_POR_FOLHA = 12
MAX_FOLHAS = 2
MINI = (320, 180)


def _ascii(texto: str) -> str:
    """As fontes do OpenCV não têm acento."""
    return unicodedata.normalize("NFKD", str(texto)).encode("ascii", "ignore").decode()


def _hora(t: float) -> str:
    return datetime.fromtimestamp(t).strftime("%H:%M:%S")


def _duracao(seg: float) -> str:
    seg = int(round(seg))
    return f"{seg // 60} min {seg % 60:02d} s" if seg >= 60 else f"{seg} s"


class Trajetos:
    def __init__(self, pasta_dados: Path, planta=None, cfg: dict | None = None, dias_guardar: float = 7):
        cfg = cfg or {}
        self.pasta = Path(pasta_dados) / "trajetos"
        self.pasta.mkdir(parents=True, exist_ok=True)
        self.planta = planta
        self.ponto_seg = float(cfg.get("pontoSegundos", 0.5))
        self.foto_seg = float(cfg.get("fotoSegundos", 2.0))
        self.foto_zona_seg = float(cfg.get("fotoNaPrateleiraSegundos", 1.0))
        self.dias_guardar = dias_guardar
        self._ultimo_ponto: dict[tuple, float] = {}
        self._ultima_foto: dict[str, float] = {}
        self._zona: dict[str, tuple] = {}
        self._ultima_limpeza = 0.0

    def _pasta_visita(self, visita: str) -> Path:
        p = self.pasta / re.sub(r"[^A-Za-z0-9_-]+", "_", visita)
        p.mkdir(parents=True, exist_ok=True)
        return p

    def marcar_zona(self, visita: str, zona: str, agora: float) -> None:
        self._zona[visita] = (zona, agora)

    def registrar(self, visita: str, camera: str, agora: float, pos, pe, quadro, caixa) -> None:
        """Chamado a cada quadro para cada pessoa com visita conhecida."""
        if agora - self._ultimo_ponto.get((visita, camera), -1e18) < self.ponto_seg:
            return
        self._ultimo_ponto[(visita, camera)] = agora
        marca = self._zona.get(visita)
        zona = marca[0] if marca and agora - marca[1] <= 1.0 else None
        pasta = self._pasta_visita(visita)
        foto = None
        espera = self.foto_zona_seg if zona else self.foto_seg
        if quadro is not None and agora - self._ultima_foto.get(visita, -1e18) >= espera:
            self._ultima_foto[visita] = agora
            foto = f"{int(agora * 10):013d}_{re.sub(r'[^A-Za-z0-9_-]+', '_', camera)}.jpg"
            (pasta / foto).write_bytes(self._foto(quadro, caixa))
        ponto = {"t": round(agora, 2), "c": camera, "u": round(pe[0], 4), "v": round(pe[1], 4)}
        if pos is not None:
            ponto["x"], ponto["y"] = round(pos[0], 3), round(pos[1], 3)
        if zona:
            ponto["z"] = zona
        if foto:
            ponto["f"] = foto
        with open(pasta / "pontos.jsonl", "a", encoding="utf-8") as arq:
            arq.write(json.dumps(ponto) + "\n")

    @staticmethod
    def _foto(quadro, caixa) -> bytes:
        escala = LARGURA_FOTO / quadro.shape[1]
        img = cv2.resize(quadro, (LARGURA_FOTO, round(quadro.shape[0] * escala)))
        x1, y1, x2, y2 = (int(round(v * escala)) for v in caixa)
        cv2.rectangle(img, (x1, y1), (x2, y2), (0, 0, 255), 2)
        return codificar(img, 60)

    # ---------- compilação ----------

    def pontos(self, visita: str, inicio: float | None = None, fim: float | None = None) -> list[dict]:
        arquivo = self._pasta_visita(visita) / "pontos.jsonl"
        if not arquivo.exists():
            return []
        lidos = []
        for linha in arquivo.read_text(encoding="utf-8").splitlines():
            try:
                p = json.loads(linha)
            except ValueError:
                continue
            if (inicio is None or p["t"] >= inicio) and (fim is None or p["t"] <= fim):
                lidos.append(p)
        return sorted(lidos, key=lambda p: p["t"])

    @staticmethod
    def _zonas(pontos: list[dict], passo_maximo: float = 3.0) -> dict[str, float]:
        """Segundos em cada prateleira (soma dos intervalos entre pontos seguidos na mesma zona)."""
        tempo: dict[str, float] = {}
        por_camera: dict[str, dict] = {}
        for p in pontos:
            ant = por_camera.get(p["c"])
            if ant and ant.get("z") and ant.get("z") == p.get("z") and p["t"] - ant["t"] <= passo_maximo:
                tempo[p["z"]] = tempo.get(p["z"], 0.0) + p["t"] - ant["t"]
            elif p.get("z"):
                tempo.setdefault(p["z"], 0.0)
            por_camera[p["c"]] = p
        return tempo

    def compilar(self, visita: str, nome: str, inicio: float | None = None, fim: float | None = None,
                 rotulo: str = "compilado") -> dict:
        """Monta o material pro dono: [mapa do percurso, folhas de fotos] e um
        resumo em texto. Sem nenhum registro, devolve imagens vazias."""
        pontos = self.pontos(visita, inicio, fim)
        if not pontos:
            return {"imagens": [], "resumo": "As câmeras não têm registro dessa pessoa no período."}
        zonas = self._zonas(pontos)
        t0, t1 = pontos[0]["t"], pontos[-1]["t"]
        cameras = sorted({p["c"] for p in pontos})
        partes = [f"Acompanhado(a) das {_hora(t0)} às {_hora(t1)} ({_duracao(t1 - t0)}) por {len(cameras)} câmera(s)"]
        if zonas:
            partes.append("prateleiras: " + ", ".join(f"{z} ({_duracao(s)})" for z, s in sorted(zonas.items(), key=lambda i: -i[1])))
        else:
            partes.append("não foi visto(a) junto a nenhuma prateleira")
        resumo = "; ".join(partes) + "."

        saida = self._pasta_visita(visita) / re.sub(r"[^A-Za-z0-9_-]+", "_", rotulo)
        saida.mkdir(parents=True, exist_ok=True)
        imagens = []
        mapa = saida / "1_mapa.jpg"
        mapa.write_bytes(codificar(self._mapa(pontos, nome, zonas), 80))
        imagens.append(str(mapa.resolve()))
        com_foto = self._escolher_fotos([p for p in pontos if p.get("f")], FOTOS_POR_FOLHA * MAX_FOLHAS)
        for i in range(0, len(com_foto), FOTOS_POR_FOLHA):
            folha = saida / f"{2 + i // FOTOS_POR_FOLHA}_fotos.jpg"
            folha.write_bytes(codificar(self._folha(visita, com_foto[i:i + FOTOS_POR_FOLHA]), 75))
            imagens.append(str(folha.resolve()))
        return {"imagens": imagens, "resumo": resumo}

    @staticmethod
    def _escolher_fotos(fotos: list[dict], limite: int) -> list[dict]:
        """Todas as fotos junto a prateleira primeiro; o resto, espalhado no tempo."""
        if len(fotos) <= limite:
            return fotos
        na_zona = [p for p in fotos if p.get("z")]
        if len(na_zona) >= limite:
            idx = np.linspace(0, len(na_zona) - 1, limite).round().astype(int)
            return [na_zona[i] for i in sorted(set(idx))]
        outras = [p for p in fotos if not p.get("z")]
        falta = limite - len(na_zona)
        idx = np.linspace(0, len(outras) - 1, falta).round().astype(int)
        return sorted(na_zona + [outras[i] for i in sorted(set(idx))], key=lambda p: p["t"])

    def _folha(self, visita: str, fotos: list[dict]) -> np.ndarray:
        colunas, faixa = 4, 24
        linhas = (len(fotos) + colunas - 1) // colunas
        folha = np.full((linhas * (MINI[1] + faixa), colunas * MINI[0], 3), 30, np.uint8)
        pasta = self._pasta_visita(visita)
        for i, p in enumerate(fotos):
            x, y = (i % colunas) * MINI[0], (i // colunas) * (MINI[1] + faixa)
            img = cv2.imread(str(pasta / p["f"]))
            if img is not None:
                folha[y + faixa:y + faixa + MINI[1], x:x + MINI[0]] = cv2.resize(img, MINI)
            legenda = _ascii(f"{_hora(p['t'])} {p['c']}" + (f"  PRATELEIRA {p['z']}" if p.get("z") else ""))
            cor = (80, 220, 255) if p.get("z") else (220, 220, 220)
            cv2.putText(folha, legenda, (x + 6, y + 17), cv2.FONT_HERSHEY_SIMPLEX, 0.5, cor, 1, cv2.LINE_AA)
        return folha

    def _mapa(self, pontos: list[dict], nome: str, zonas: dict[str, float]) -> np.ndarray:
        na_planta = [p for p in pontos if "x" in p]
        topo, rodape, larg = 70, 60, 1000
        if self.planta is not None and len(na_planta) >= 2:
            escala = (larg - 80) / self.planta.largura
            alt_area = round(self.planta.profundidade * escala)
            img = np.full((topo + alt_area + rodape + 40, larg, 3), 255, np.uint8)
            ox, oy = 40, topo + 20

            def px(p):
                return (round(ox + min(max(p["x"], 0), self.planta.largura) * escala),
                        round(oy + min(max(p["y"], 0), self.planta.profundidade) * escala))

            cv2.rectangle(img, (ox, oy), (ox + round(self.planta.largura * escala), oy + alt_area), (60, 60, 60), 2)
            for m in range(1, int(self.planta.largura)):
                cv2.line(img, (ox + round(m * escala), oy), (ox + round(m * escala), oy + alt_area), (225, 225, 225), 1)
            self._desenhar_percurso(img, [(px(p), p) for p in na_planta])
            sub = f"planta da loja ({self.planta.largura:g} m x {self.planta.profundidade:g} m)"
        else:
            # sem calibração do chão: o percurso vai sobre o quadro de cada câmera
            cameras = sorted({p["c"] for p in pontos})[:3]
            lado = (larg - 40 - 20 * (len(cameras) - 1)) // len(cameras)
            alt_area = round(lado * 9 / 16)
            img = np.full((topo + alt_area + rodape + 40, larg, 3), 255, np.uint8)
            for i, cam in enumerate(cameras):
                ox, oy = 20 + i * (lado + 20), topo + 20
                cv2.rectangle(img, (ox, oy), (ox + lado, oy + alt_area), (60, 60, 60), 2)
                cv2.putText(img, _ascii(cam), (ox + 6, oy + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (90, 90, 90), 1, cv2.LINE_AA)
                self._desenhar_percurso(img, [((round(ox + p["u"] * lado), round(oy + p["v"] * alt_area)), p)
                                              for p in pontos if p["c"] == cam])
            sub = "posicao na imagem de cada camera (chao ainda nao calibrado)"
        t0, t1 = pontos[0]["t"], pontos[-1]["t"]
        cv2.putText(img, _ascii(f"Trajeto de {nome}"), (20, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (20, 20, 20), 2, cv2.LINE_AA)
        cv2.putText(img, _ascii(f"{datetime.fromtimestamp(t0).strftime('%d/%m/%Y')}  {_hora(t0)} a {_hora(t1)}  ({_duracao(t1 - t0)})  -  {sub}"),
                    (20, 56), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (70, 70, 70), 1, cv2.LINE_AA)
        base = img.shape[0] - rodape + 10
        legenda = "Prateleiras: " + (", ".join(f"{z} ({_duracao(s)})" for z, s in sorted(zonas.items(), key=lambda i: -i[1])) or "nenhuma")
        cv2.putText(img, _ascii(legenda)[:110], (20, base), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (20, 20, 20), 1, cv2.LINE_AA)
        cv2.putText(img, "E = primeiro registro   S = ultimo registro   linha: azul (inicio) -> vermelho (fim)   circulo amarelo = junto a prateleira",
                    (20, base + 26), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (90, 90, 90), 1, cv2.LINE_AA)
        return img

    @staticmethod
    def _desenhar_percurso(img, itens: list) -> None:
        if not itens:
            return
        n = max(1, len(itens) - 1)
        for i in range(1, len(itens)):
            (a, pa), (b, pb) = itens[i - 1], itens[i]
            if pb["t"] - pa["t"] > 5:      # ficou sem ser visto: não liga os pontos
                continue
            f = i / n
            cv2.line(img, a, b, (round(255 * (1 - f)), 40, round(255 * f)), 3, cv2.LINE_AA)
        rotulados = set()
        for ponto, p in itens:
            if p.get("z"):
                cv2.circle(img, ponto, 9, (0, 200, 255), 2, cv2.LINE_AA)
                if p["z"] not in rotulados:
                    rotulados.add(p["z"])
                    cv2.putText(img, _ascii(p["z"]), (ponto[0] + 12, ponto[1] - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 120, 200), 2, cv2.LINE_AA)
        for (ponto, _), letra, cor in ((itens[0], "E", (200, 60, 0)), (itens[-1], "S", (0, 0, 200))):
            cv2.circle(img, ponto, 13, cor, -1, cv2.LINE_AA)
            cv2.putText(img, letra, (ponto[0] - 6, ponto[1] + 6), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)

    # ---------- limpeza ----------

    def limpar(self, agora_real: float | None = None, forcar: bool = False) -> int:
        agora_real = time.time() if agora_real is None else agora_real
        if not forcar and agora_real - self._ultima_limpeza < 3600:
            return 0
        self._ultima_limpeza = agora_real
        limite = agora_real - self.dias_guardar * 86400
        apagadas = 0
        for pasta in self.pasta.iterdir():
            if pasta.is_dir() and max((a.stat().st_mtime for a in pasta.rglob("*") if a.is_file()), default=0) < limite:
                shutil.rmtree(pasta, ignore_errors=True)
                apagadas += 1
        return apagadas

"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "./client";

type Frame = { id: string; at: string; plate: string | null; clientName: string | null } | null;

/**
 * Câmera do pátio ao vivo, na parte de baixo da tela, enquanto a lavagem do
 * cliente está em andamento. A ESP32-CAM manda uma foto a cada ~8s: a tela
 * pergunta qual é a última e troca a imagem quando o id muda (não é vídeo).
 */
export default function CameraAoVivo({ titulo }: { titulo?: string }) {
  const [frame, setFrame] = useState<Frame>(null);
  const [erro, setErro] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const load = () =>
      api<{ frame: Frame }>("/api/lpr/ao-vivo")
        .then((r) => { setFrame(r.frame); setErro(false); })
        .catch(() => setErro(true));
    load();
    timer.current = setInterval(load, 4000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  if (erro) return null;   // sem lavagem em andamento: não mostra nada

  return (
    <div className="camviva">
      <div className="camviva-cab">
        <span className="ponto" aria-hidden /> {titulo ?? "Câmera da máquina · ao vivo"}
      </div>
      {frame ? (
        <img
          src={`/api/lpr/ao-vivo?img=${frame.id}`}
          alt="Imagem da câmera da máquina"
          className="camviva-img"
        />
      ) : (
        <div className="camviva-vazio">Aguardando imagem da câmera…</div>
      )}
    </div>
  );
}

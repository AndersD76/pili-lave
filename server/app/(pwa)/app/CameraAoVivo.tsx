"use client";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, getToken } from "./client";

type Frame = { id: string; at: string; plate: string | null; clientName: string | null } | null;

/**
 * Câmera do pátio ao vivo, na parte de baixo da tela, enquanto a lavagem do
 * cliente está em andamento. A ESP32-CAM manda uma foto a cada ~8s: a tela
 * pergunta qual é a última e troca a imagem quando o id muda (não é vídeo).
 *
 * A imagem é buscada por fetch com o token e exibida como blob — uma tag
 * <img src="/api/..."> não envia o cabeçalho Authorization e levaria 401.
 */
export default function CameraAoVivo({ titulo }: { titulo?: string }) {
  const [url, setUrl] = useState<string>("");
  const [erro, setErro] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const atual = useRef<string>("");     // id da captura já exibida
  const urlRef = useRef<string>("");    // blob atual (para liberar depois)

  useEffect(() => {
    let vivo = true;

    const load = async () => {
      try {
        const r = await api<{ frame: Frame }>("/api/lpr/ao-vivo");
        if (!vivo) return;
        setErro(false);
        const f = r.frame;
        if (!f || f.id === atual.current) return;   // nada novo

        // baixa o JPEG (fetch direto: o helper api() faz res.json() e
        // quebraria numa imagem). Falha aqui NÃO esconde a câmera — só
        // mantém o quadro anterior até a próxima tentativa.
        try {
          const res = await fetch(`/api/lpr/ao-vivo?img=${f.id}`, {
            headers: { Authorization: `Bearer ${getToken() ?? ""}` },
          });
          if (!res.ok || !vivo) return;
          const blob = await res.blob();
          if (!vivo) return;
          const novo = URL.createObjectURL(blob);
          if (urlRef.current) URL.revokeObjectURL(urlRef.current);
          urlRef.current = novo;
          atual.current = f.id;
          setUrl(novo);
        } catch { /* rede instável: tenta de novo no próximo ciclo */ }
      } catch (e) {
        // só esconde quando o servidor diz que não há lavagem (403);
        // qualquer outra falha mantém a câmera visível.
        if (vivo && e instanceof ApiError && e.status === 403) setErro(true);
      }
    };

    load();
    timer.current = setInterval(load, 4000);
    return () => {
      vivo = false;
      if (timer.current) clearInterval(timer.current);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  if (erro) return null;   // sem lavagem em andamento: não mostra nada

  return (
    <div className="camviva">
      <div className="camviva-cab">
        <span className="ponto" aria-hidden /> {titulo ?? "Câmera da máquina · ao vivo"}
      </div>
      {url ? (
        <img src={url} alt="Imagem da câmera da máquina" className="camviva-img" />
      ) : (
        <div className="camviva-vazio">Aguardando imagem da câmera…</div>
      )}
    </div>
  );
}

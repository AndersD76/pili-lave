"use client";
import { useEffect, useState } from "react";
import { api } from "./client";

export type Saude = { disponivel: boolean; motivo: string | null; cameraOffline: boolean };

/**
 * Status da máquina, sempre visível na tela inicial.
 *
 * Antes este aviso só existia na tela de compra — o cliente abria o app,
 * via tudo normal e só descobria que a máquina estava parada ao tentar
 * pagar (ou pior, ao chegar no pátio). Agora é a primeira coisa que ele vê.
 */
export function StatusMaquina({ compacto = false }: { compacto?: boolean }) {
  const [s, setS] = useState<Saude | null>(null);

  useEffect(() => {
    const ver = () => api<Saude>("/api/saude", { auth: false }).then(setS).catch(() => {});
    ver();
    const t = setInterval(ver, 20000);
    return () => clearInterval(t);
  }, []);

  if (!s) return null;

  if (!s.disponivel)
    return (
      <div className="card" style={{ borderColor: "var(--erro)", borderWidth: 2 }}>
        <div className="lab" style={{ color: "var(--erro)" }}>● Máquina não disponível</div>
        <p className="sub">{s.motivo ?? "Tente novamente em alguns minutos."}</p>
      </div>
    );

  if (s.cameraOffline)
    return (
      <div className="card" style={{ borderColor: "var(--atencao)" }}>
        <div className="lab" style={{ color: "var(--atencao)" }}>● Máquina disponível — câmera fora do ar</div>
        <p className="sub">Sua placa não será reconhecida sozinha. Ao chegar, use &quot;Já estou na máquina&quot;.</p>
      </div>
    );

  if (compacto) return null;   // tudo certo: não ocupa espaço à toa
  return (
    <div className="statusbar ok">
      <span className="ponto" aria-hidden /> Máquina disponível agora
    </div>
  );
}

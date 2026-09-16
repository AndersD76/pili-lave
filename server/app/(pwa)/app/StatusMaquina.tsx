"use client";
import { useEffect, useState } from "react";
import { api } from "./client";

export type Saude = {
  disponivel: boolean;
  estado: "LIVRE" | "LAVANDO" | "PARADA";
  liberaEmSeg: number | null;
  naFila: number;
  motivo: string | null;
  cameraOffline: boolean;
};

/** "7 min" / "1 min" / "menos de 1 min" — sem segundos, que oscilam. */
function tempo(seg: number): string {
  const min = Math.ceil(seg / 60);
  if (min <= 0) return "menos de 1 min";
  return `${min} min`;
}

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

  /* Lavando: o cliente precisa saber que a máquina está OK (não parada) e
   * quando ela libera — senão ele não sabe se vale a pena vir agora. */
  if (s.estado === "LAVANDO")
    return (
      <div className="card" style={{ borderColor: "var(--atencao)" }}>
        <div className="lab" style={{ color: "var(--atencao)" }}>● Máquina lavando outro carro</div>
        <p className="sub">
          {s.liberaEmSeg !== null
            ? `Libera em aproximadamente ${tempo(s.liberaEmSeg)}.`
            : "Libera em alguns minutos."}
          {s.naFila > 0
            ? ` ${s.naFila} ${s.naFila === 1 ? "pessoa já pagou e espera" : "pessoas já pagaram e esperam"} a vez.`
            : " Ninguém na fila — você é o próximo."}
        </p>
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

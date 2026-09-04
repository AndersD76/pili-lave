"use client";
import { useEffect } from "react";

/** As etapas que o cliente acompanha, na ordem em que acontecem. */
export type Etapa =
  | "reserva"      // reserva confirmada
  | "pagamento"    // pagamento confirmado
  | "reconhecido"  // a câmera leu a placa
  | "iniciada"     // a máquina começou a lavar
  | "finalizada"   // ciclo encerrado
  | "obrigado"     // agradecimento
  | "falha";       // maquina falhou -> estorno

const ORDEM: Etapa[] = ["reserva", "pagamento", "reconhecido", "iniciada", "finalizada"];

const TEXTOS: Record<Etapa, { ic: string; ok?: boolean; titulo: string; msg: string }> = {
  reserva:     { ic: "1", titulo: "Reserva confirmada",   msg: "Sua lavagem está reservada." },
  pagamento:   { ic: "$", titulo: "Pagamento confirmado", msg: "Valor debitado do seu saldo." },
  reconhecido: { ic: "@", titulo: "Carro reconhecido",    msg: "A câmera identificou sua placa. Pode entrar." },
  iniciada:    { ic: ">", titulo: "Lavagem iniciada",     msg: "A máquina começou a lavar o seu carro." },
  finalizada:  { ic: "OK", ok: true, titulo: "Lavagem finalizada", msg: "Seu carro está pronto." },
  obrigado:    { ic: "♥", ok: true, titulo: "Obrigado!",  msg: "Volte sempre à Pili Lave." },
  falha:       { ic: "!", titulo: "Lavagem interrompida", msg: "A máquina apresentou falha. O valor foi devolvido ao seu saldo." },
};

/**
 * Aviso em modal de cada etapa. Fecha sozinho (o cliente está dirigindo —
 * não deve precisar tocar na tela), e também no toque.
 */
export default function EtapaModal({
  etapa, detalhe, onFechar, segundos = 4,
}: {
  etapa: Etapa;
  detalhe?: string;
  onFechar: () => void;
  segundos?: number;
}) {
  useEffect(() => {
    const t = setTimeout(onFechar, segundos * 1000);
    return () => clearTimeout(t);
  }, [etapa, segundos, onFechar]);

  const t = TEXTOS[etapa];
  const idx = ORDEM.indexOf(etapa);

  return (
    <div className="etapa-fundo" onClick={onFechar} role="dialog" aria-live="polite">
      <div className="etapa" onClick={(e) => e.stopPropagation()}>
        <div className={`ic${t.ok ? " ok" : ""}`}>{t.ic}</div>
        <h2>{t.titulo}</h2>
        <p>{detalhe ?? t.msg}</p>
        {idx >= 0 && (
          <div className="passos" aria-hidden>
            {ORDEM.map((e, i) => <i key={e} className={i <= idx ? "on" : ""} />)}
          </div>
        )}
      </div>
    </div>
  );
}

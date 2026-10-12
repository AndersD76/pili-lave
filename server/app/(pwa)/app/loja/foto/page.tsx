"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, getToken, type Me } from "../../client";
import { Logo } from "../../Logo";

const LADO_MAX = 640;

/** Reduz a foto pra no máximo 640px e devolve o JPEG em base64 (sem o
 *  prefixo "data:") — foto de celular crua passa fácil de 3 MB. */
async function reduzir(arquivo: File): Promise<{ base64: string; previa: string }> {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const previa = canvas.toDataURL("image/jpeg", 0.85);
  return { base64: previa.slice(previa.indexOf(",") + 1), previa };
}

/**
 * Foto do rosto pra loja de conveniência. Usa o seletor de arquivo com
 * capture="user" (abre a câmera frontal no celular) em vez de getUserMedia:
 * funciona sem HTTPS na rede local e sem pedir permissão de câmera pro site.
 */
export default function FotoRosto() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [foto, setFoto] = useState<{ base64: string; previa: string } | null>(null);
  const [autorizo, setAutorizo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getToken()) { router.replace("/app/cadastro"); return; }
    api<Me>("/api/me")
      .then((m) => {
        if (!m.termosAceitos) { router.replace("/app/termos"); return; }
        setPronto(true);
      })
      .catch(() => router.replace("/app/login"));
  }, [router]);

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setError("");
    try {
      setFoto(await reduzir(arquivo));
    } catch {
      setError("Não foi possível ler essa imagem. Tente tirar a foto de novo.");
    }
  }

  async function enviar() {
    if (!foto) return;
    setError(""); setLoading(true);
    try {
      await api("/api/me/foto", { body: { jpegBase64: foto.base64, consentimento: true } });
      router.replace("/app/loja");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar a foto");
    } finally {
      setLoading(false);
    }
  }

  if (!pronto) return <p className="sub">Carregando…</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Logo />
        <h1>Sua foto</h1>
        <p className="sub">
          Para usar a loja, tire uma foto do seu rosto. É por ela que o caixa reconhece você na hora de pagar.
          Fique de frente, em lugar claro, sem boné nem óculos escuros.
        </p>
      </div>
      {foto && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={foto.previa} alt="Sua foto" style={{ width: "100%", borderRadius: 12 }} />
      )}
      <label className={foto ? "btn ghost" : "btn"} style={{ cursor: "pointer", textAlign: "center" }}>
        {foto ? "Tirar outra" : "Tirar foto"}
        <input type="file" accept="image/*" capture="user" onChange={escolher} style={{ display: "none" }} />
      </label>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={autorizo} onChange={(e) => setAutorizo(e.target.checked)} />
        <span>Autorizo o uso da imagem do meu rosto para me reconhecer no caixa da loja de conveniência.</span>
      </label>
      {error && <p className="err">{error}</p>}
      <button className="btn" onClick={enviar} disabled={loading || !foto || !autorizo}>
        {loading ? "Enviando…" : "Enviar foto"}
      </button>
      <button className="btn ghost" onClick={() => router.replace("/app/escolha")}>Agora não</button>
    </div>
  );
}

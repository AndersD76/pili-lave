import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, adminOpen, checarCredenciaisAdmin, createAdminCookie } from "@/lib/admin";

// Nunca cachear/pré-renderizar: adminOpen() lê env var em tempo real — uma
// versão cacheada de quando ADMIN_PASSWORD não existia travava todo mundo
// num loop de redirecionamento (/admin -> /admin/login -> /admin -> ...).
export const dynamic = "force-dynamic";

async function login(formData: FormData) {
  "use server";
  const usuario = String(formData.get("usuario") ?? "");
  const senha = String(formData.get("password") ?? "");
  if (!checarCredenciaisAdmin(usuario, senha)) redirect("/admin/login?erro=1");
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, await createAdminCookie(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 3600,
    path: "/",
  });
  redirect("/admin");
}

export default async function AdminLogin({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  if (adminOpen()) redirect("/admin");   // fase de teste: painel aberto
  const { erro } = await searchParams;
  return (
    <main>
      <form action={login} className="login-card">
        <div className="admin-nav" style={{ border: 0, padding: 0, marginBottom: 4 }}>
          <span className="logo">PILI CLEAN<span>.</span> Painel</span>
        </div>
        <input
          className="field"
          type="text"
          name="usuario"
          placeholder="Usuário"
          autoFocus
          autoComplete="username"
          required
        />
        <input
          className="field"
          type="password"
          name="password"
          placeholder="Senha do painel"
          autoComplete="current-password"
          required
        />
        {erro && <p className="err-msg">Senha incorreta.</p>}
        <button className="btn" type="submit">Entrar</button>
      </form>
    </main>
  );
}

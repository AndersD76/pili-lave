import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, createAdminCookie } from "@/lib/admin";

async function login(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD)
    redirect("/admin/login?erro=1");
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
  const { erro } = await searchParams;
  return (
    <main>
      <form action={login} className="login-card">
        <div className="admin-nav" style={{ border: 0, padding: 0, marginBottom: 4 }}>
          <span className="logo">PILI LAVE<span>.</span> Painel</span>
        </div>
        <input
          className="field"
          type="password"
          name="password"
          placeholder="Senha do painel"
          autoFocus
          required
        />
        {erro && <p className="err-msg">Senha incorreta.</p>}
        <button className="btn" type="submit">Entrar</button>
      </form>
    </main>
  );
}

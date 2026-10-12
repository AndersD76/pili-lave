import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/admin";
import { AdminNav } from "../nav";
import { criarLoja, salvarLoja } from "./actions";

export const dynamic = "force-dynamic";

const ROTULO: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--aco-d)" };
const CAMPO: React.CSSProperties = { width: "100%", height: 36, fontSize: 14, padding: "0 10px", marginTop: 4 };

type Dono = { id: string; name: string | null; phone: string };
type LojaForm = {
  id: string; name: string; address: string; city: string; state: string;
  capacidade: number; donoId: string | null; active: boolean;
};

/** Mesmo formulário pra criar (sem loja) e editar (com loja). */
function Campos({ loja, donos }: { loja?: LojaForm; donos: Dono[] }) {
  return (
    <>
      <label style={ROTULO}>
        Nome
        <input className="field" style={CAMPO} name="name" defaultValue={loja?.name} maxLength={60} required />
      </label>
      <label style={ROTULO}>
        Endereço
        <input className="field" style={CAMPO} name="address" defaultValue={loja?.address} maxLength={120} />
      </label>
      <div style={{ display: "flex", gap: 10 }}>
        <label style={{ ...ROTULO, flex: 1 }}>
          Cidade
          <input className="field" style={CAMPO} name="city" defaultValue={loja?.city} maxLength={60} />
        </label>
        <label style={{ ...ROTULO, width: 70 }}>
          UF
          <input className="field" style={CAMPO} name="state" defaultValue={loja?.state ?? "RS"} maxLength={2} />
        </label>
        <label style={{ ...ROTULO, width: 110 }}>
          Capacidade
          <input
            className="field" style={CAMPO} name="capacidade" type="number" min={1} max={50}
            defaultValue={loja?.capacidade ?? 3}
          />
        </label>
      </div>
      <label style={ROTULO}>
        Dono
        <select className="field" style={CAMPO} name="donoId" defaultValue={loja?.donoId ?? ""}>
          <option value="">— sem dono definido —</option>
          {donos.map((d) => (
            <option key={d.id} value={d.id}>{d.name ?? "Sem nome"} · {d.phone}</option>
          ))}
        </select>
      </label>
    </>
  );
}

export default async function AdminLojas() {
  await requireAdminPage();
  const [lojas, donos] = await Promise.all([
    prisma.loja.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        _count: {
          select: { bloqueios: { where: { removidoEm: null } }, mensagens: { where: { respondidaEm: null } } },
        },
      },
    }),
    prisma.user.findMany({
      where: { solicitacoes: { some: { tipo: "DONO_LOJA", status: "APROVADA" } } },
      select: { id: true, name: true, phone: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <main className="admin-wrap">
      <AdminNav />
      <h2 className="section-title" style={{ marginTop: 0 }}>Lojas de conveniência</h2>
      <p style={{ color: "var(--aco-d)", fontSize: 14, marginBottom: 20 }}>
        Cadastro das lojas e de quem é o dono de cada uma. Uma loja nova normalmente aparece aqui sozinha, fechada e
        sem dono, quando o computador dela é ligado pela primeira vez e o técnico escolhe o endereço — aí é só definir o
        dono e marcar como aberta. Só aparece na lista de donos quem teve o pedido de
        Dono de loja aprovado em Usuários. Estoque e produtos ficam no computador de cada loja, não aqui. O bloqueio
        de clientes e as respostas do suporte são feitos pelo dono, no app.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {lojas.map((l) => (
          <form
            key={l.id} action={salvarLoja} className="card"
            style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 560 }}
          >
            <input type="hidden" name="id" value={l.id} />
            <Campos loja={l} donos={donos} />
            <label style={{ ...ROTULO, display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" name="active" defaultChecked={l.active} />
              Loja aberta (aparece no app)
            </label>
            <p style={{ color: "var(--aco-d)", fontSize: 13 }}>
              {l.deviceKey ? "Computador da loja vinculado" : "Sem computador vinculado"} ·{" "}
              {l._count.bloqueios} cliente(s) bloqueado(s) · {l._count.mensagens} mensagem(ns) de suporte sem resposta
            </p>
            <button className="btn ghost" type="submit" style={{ height: 36, alignSelf: "flex-start" }}>Salvar</button>
          </form>
        ))}

        <form
          action={criarLoja} className="card"
          style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 560 }}
        >
          <b>Nova loja</b>
          <Campos donos={donos} />
          <button className="btn" type="submit" style={{ height: 36, alignSelf: "flex-start" }}>Cadastrar loja</button>
        </form>
      </div>
    </main>
  );
}

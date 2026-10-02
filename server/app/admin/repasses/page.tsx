import { prisma } from "@/lib/prisma";
import { adminOpen, requireAdminPage } from "@/lib/admin";
import { asaasConfigurado, saldoAsaasCents } from "@/lib/asaas";
import { saldosAPagar, sincronizarRepasse } from "@/lib/repasse";
import { AdminNav } from "../nav";
import { PagarForm } from "./PagarForm";

export const dynamic = "force-dynamic";

function money(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

const LABEL_TIPO: Record<string, string> = {
  LAVADOR: "Lavador",
  COMISSAO1: "Comissão 1",
  COMISSAO2: "Comissão 2",
  ALUGUEL: "Aluguel",
};

const LABEL_PIX: Record<string, string> = {
  CPF: "CPF",
  CNPJ: "CNPJ",
  EMAIL: "E-mail",
  PHONE: "Telefone",
  EVP: "Aleatória",
};

export default async function AdminRepasses() {
  await requireAdminPage();

  // Status das transferências em andamento direto do Asaas — a tela fica
  // certa mesmo que os eventos de transferência do webhook não estejam ligados.
  if (asaasConfigurado()) {
    const andamento = await prisma.repasse.findMany({
      where: { status: { in: ["PENDENTE", "APROVADO"] }, asaasTransferId: { not: null } },
      take: 20,
    });
    await Promise.all(andamento.map((r) => sincronizarRepasse(r.id).catch(() => {})));
  }

  const [saldos, historico, saldoAsaas] = await Promise.all([
    saldosAPagar(),
    prisma.repasse.findMany({ include: { user: true }, orderBy: { criadoEm: "desc" }, take: 100 }),
    asaasConfigurado() ? saldoAsaasCents().catch(() => null) : Promise.resolve(null),
  ]);

  const bloqueado = adminOpen()
    ? "Painel sem senha (ADMIN_PASSWORD) — pagamentos bloqueados."
    : !asaasConfigurado()
      ? "Chave do Asaas não configurada."
      : null;
  const totalAPagar = saldos.reduce((s, p) => s + p.aPagarCents, 0);

  return (
    <main>
      <AdminNav />

      <div className="stats">
        <div className="stat">
          <div className="lab">Saldo na conta Asaas</div>
          <div className="val">{saldoAsaas === null ? "—" : money(saldoAsaas)}</div>
          <div className="sub">disponível para pagar</div>
        </div>
        <div className={totalAPagar > 0 ? "stat alerta" : "stat"}>
          <div className="lab">Total a pagar</div>
          <div className="val">{money(totalAPagar)}</div>
          <div className="sub">{saldos.filter((s) => s.aPagarCents > 0).length} pessoa(s)</div>
        </div>
      </div>

      {bloqueado && <p className="err-msg" style={{ marginTop: 16 }}>{bloqueado}</p>}

      <h2 className="section-title">A pagar</h2>
      <p style={{ color: "var(--aco-d)", fontSize: 13, marginBottom: 14 }}>
        Parte de cada participante no que entrou <b>pelo app</b> (esse dinheiro fica com você). O presencial em
        espécie fica com o lavador, que acerta direto com cada um. O saldo é corrido: tudo que já foi devido menos
        tudo que já foi pago. O PIX sai da conta Asaas para a chave que a pessoa cadastrou no Perfil.
      </p>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Quem</th><th>Máquinas</th><th>Chave PIX</th><th>Devido</th><th>Já pago</th><th>A pagar</th><th>Pagar</th></tr>
          </thead>
          <tbody>
            {saldos.map((s) => (
              <tr key={s.userId}>
                <td>{s.nome}</td>
                <td style={{ fontSize: 12 }}>
                  {s.vinculos.map((v, i) => (
                    <div key={i}>
                      {v.maquina} — {LABEL_TIPO[v.tipo] ?? v.tipo} {v.percentual}% ({money(v.parteCents)})
                    </div>
                  ))}
                </td>
                <td style={{ fontSize: 12 }}>
                  {s.pixChave ? (
                    <>
                      <span style={{ color: "var(--aco-d)" }}>{LABEL_PIX[s.pixTipo ?? ""] ?? s.pixTipo}:</span> {s.pixChave}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{money(s.devidoCents)}</td>
                <td>{money(s.repassadoCents)}</td>
                <td style={{ fontWeight: 700 }}>{money(s.aPagarCents)}</td>
                <td>
                  <PagarForm
                    userId={s.userId}
                    nome={s.nome}
                    chave={s.pixChave}
                    aPagarCents={s.aPagarCents}
                    bloqueado={bloqueado}
                  />
                </td>
              </tr>
            ))}
            {saldos.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: "var(--aco-d)" }}>
                  Nenhum participante vinculado a máquinas. Cadastre em Máquinas → participantes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">Histórico de pagamentos</h2>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Quando</th><th>Quem</th><th>Valor</th><th>Chave</th><th>Status</th></tr>
          </thead>
          <tbody>
            {historico.map((r) => (
              <tr key={r.id}>
                <td>{r.criadoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                <td>{r.user.name ?? r.user.email ?? r.user.phone}</td>
                <td>{money(r.valorCents)}</td>
                <td style={{ fontSize: 12 }}>{r.pixChave}</td>
                <td>
                  {r.status === "PENDENTE" && <span className="chip at">Enviando</span>}
                  {r.status === "APROVADO" && <span className="chip at">Autorizado</span>}
                  {r.status === "CONCLUIDO" && <span className="chip ok">Pago</span>}
                  {r.status === "FALHOU" && <span className="chip err">Falhou</span>}
                </td>
              </tr>
            ))}
            {historico.length === 0 && (
              <tr><td colSpan={5} style={{ color: "var(--aco-d)" }}>Nenhum pagamento feito ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

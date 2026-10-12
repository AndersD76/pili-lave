import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { api, type LojaDoDono } from "@/lib/api";
import { Btn, Card, ErrText, Input, Label, Screen, Sub } from "@/ui";
import { C, F } from "@/theme";

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

type Mensagem = LojaDoDono["mensagens"][number];

/** Mensagem de suporte recebida, com o campo de resposta do dono. */
function MensagemSuporte({ m, onMudou }: { m: Mensagem; onMudou: () => void }) {
  const [resposta, setResposta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  async function responder() {
    setError("");
    setEnviando(true);
    try {
      await api(`/api/dono/mensagens/${m.id}`, { body: { resposta } });
      setResposta("");
      onMudou();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível responder");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <View style={{ paddingTop: 10, marginTop: 10, borderTopWidth: 1, borderTopColor: C.linha, gap: 6 }}>
      <Sub>
        {m.cliente.nome ?? "Cliente"} · código {m.cliente.codigo}
        {m.cliente.bloqueado ? " · bloqueado" : ""} · {dataHora(m.criadaEm)}
      </Sub>
      <Text style={{ fontFamily: F.body, fontSize: 16, color: C.cromo }}>{m.texto}</Text>
      {m.resposta ? (
        <Sub>Sua resposta: {m.resposta}</Sub>
      ) : (
        <>
          <Input
            placeholder="Responder ao cliente" multiline maxLength={1000}
            style={{ minHeight: 70, textAlignVertical: "top" }} value={resposta} onChangeText={setResposta}
          />
          <ErrText>{error}</ErrText>
          <Btn title="Responder" kind="ghost" onPress={responder} loading={enviando} disabled={resposta.trim().length < 2} />
        </>
      )}
    </View>
  );
}

function PainelLoja({ loja, onMudou }: { loja: LojaDoDono; onMudou: () => void }) {
  const [codigo, setCodigo] = useState("");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [error, setError] = useState("");

  async function bloquear() {
    setError("");
    setSalvando(true);
    try {
      await api(`/api/dono/lojas/${loja.id}/bloqueios`, { body: { codigoCliente: codigo, motivo } });
      setCodigo("");
      setMotivo("");
      onMudou();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível bloquear");
    } finally {
      setSalvando(false);
    }
  }

  function desbloquear(id: string, nome: string) {
    Alert.alert("Desbloquear?", `Liberar a entrada de ${nome} de novo?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Desbloquear",
        onPress: async () => {
          try {
            await api(`/api/dono/bloqueios/${id}`, { method: "DELETE" });
            onMudou();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Não foi possível desbloquear");
          }
        },
      },
    ]);
  }

  const semResposta = loja.mensagens.filter((m) => !m.resposta).length;

  return (
    <>
      <Card>
        <Label>{loja.name}{loja.active ? "" : " · fechada"}</Label>
        <Sub>{[loja.address, `${loja.city}/${loja.state}`].filter(Boolean).join(" · ")}</Sub>
        <Sub>Capacidade: {loja.capacidade} pessoas por vez.</Sub>
      </Card>

      <Card>
        <Label>Mensagens de clientes{semResposta > 0 ? ` · ${semResposta} sem resposta` : ""}</Label>
        {loja.mensagens.length === 0 ? (
          <Sub>Nenhuma mensagem recebida.</Sub>
        ) : (
          loja.mensagens.map((m) => <MensagemSuporte key={m.id} m={m} onMudou={onMudou} />)
        )}
      </Card>

      <Card style={{ gap: 10 }}>
        <Label>Clientes bloqueados</Label>
        {loja.bloqueios.length === 0 ? <Sub>Ninguém bloqueado nesta loja.</Sub> : null}
        {loja.bloqueios.map((b) => (
          <View key={b.id} style={{ gap: 6 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.cromo }}>
              {b.cliente.nome ?? "Cliente"} · código {b.cliente.codigo}
            </Text>
            <Sub>{b.motivo} · desde {dataHora(b.criadoEm)}</Sub>
            <Btn title="Desbloquear" kind="ghost" onPress={() => desbloquear(b.id, b.cliente.nome ?? "este cliente")} />
          </View>
        ))}
        <Sub>
          Para bloquear a entrada de alguém por problema de conduta, informe o código do cliente e o motivo. O
          cliente não vê o motivo, só que está bloqueado e o caminho do suporte.
        </Sub>
        <Input
          placeholder="Código do cliente" keyboardType="number-pad"
          value={codigo} onChangeText={(v) => setCodigo(v.replace(/\D/g, ""))}
        />
        <Input placeholder="Motivo (fica só com você)" maxLength={300} value={motivo} onChangeText={setMotivo} />
        <ErrText>{error}</ErrText>
        <Btn
          title="Bloquear cliente" kind="danger" onPress={bloquear} loading={salvando}
          disabled={!codigo || motivo.trim().length < 3}
        />
      </Card>
    </>
  );
}

/**
 * Área do dono de loja — só mostra as lojas em que a pessoa é o dono (o
 * admin faz esse vínculo em /admin/lojas, depois de aprovar o pedido de
 * Dono de loja). Aqui ele responde o suporte e bloqueia/desbloqueia clientes.
 */
export default function MinhaLoja() {
  const [lojas, setLojas] = useState<LojaDoDono[] | null>(null);
  const [error, setError] = useState("");

  const carregar = useCallback(() => {
    api<{ lojas: LojaDoDono[] }>("/api/dono/lojas")
      .then((r) => { setLojas(r.lojas); setError(""); })
      .catch(() => setError("Não foi possível carregar suas lojas. Confira sua conexão."));
  }, []);

  useFocusEffect(carregar);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingVertical: 16 }}>
        <ErrText>{error}</ErrText>
        {lojas === null ? (
          error ? null : <Sub>Carregando…</Sub>
        ) : lojas.length === 0 ? (
          <Sub>
            Nenhuma loja está vinculada a você ainda. Depois que seu pedido de Dono de loja é aprovado, o
            administrador vincula a loja ao seu cadastro.
          </Sub>
        ) : (
          lojas.map((l) => <PainelLoja key={l.id} loja={l} onMudou={carregar} />)
        )}
      </ScrollView>
    </Screen>
  );
}

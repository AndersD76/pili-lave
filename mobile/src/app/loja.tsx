import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { api, type Loja } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Btn, Card, ErrText, H1, Input, Label, Screen, Sub } from "@/ui";
import { C, F, money } from "@/theme";

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Uma loja na lista: situação do cliente nela (liberado/bloqueado) e o
 *  canal de suporte — é por ele que quem foi bloqueado fala com o dono. */
function CartaoLoja({ loja, onEnviada }: { loja: Loja; onEnviada: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  async function enviar() {
    setError("");
    setEnviando(true);
    try {
      await api(`/api/lojas/${loja.id}/suporte`, { body: { texto } });
      setTexto("");
      setAberto(false);
      onEnviada();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível enviar a mensagem");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card style={loja.bloqueado ? { borderColor: C.erro } : undefined}>
      <Label>{loja.name}</Label>
      <Sub>{[loja.address, `${loja.city}/${loja.state}`].filter(Boolean).join(" · ")}</Sub>
      {loja.bloqueado ? (
        <Text style={{ fontFamily: F.body, fontSize: 15, color: C.erro, marginTop: 8 }}>
          Sua entrada nesta loja está bloqueada. Entre em contato com o suporte: sua mensagem é encaminhada ao
          responsável pela loja, e a resposta pode demorar até 24 horas.
        </Text>
      ) : (
        <Sub>Capacidade: {loja.capacidade} pessoas por vez.</Sub>
      )}

      {loja.mensagens.map((m) => (
        <View key={m.id} style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.linha }}>
          <Sub>Você, {dataHora(m.criadaEm)}: {m.texto}</Sub>
          <Text style={{ fontFamily: F.body, fontSize: 15, color: m.resposta ? C.cromo : C.acoD, marginTop: 4 }}>
            {m.resposta ? `Resposta da loja: ${m.resposta}` : "Aguardando resposta (até 24 horas)."}
          </Text>
        </View>
      ))}

      <View style={{ gap: 8, marginTop: 12 }}>
        {aberto ? (
          <>
            <Input
              placeholder="Escreva sua mensagem para o responsável pela loja" multiline maxLength={1000}
              style={{ minHeight: 90, textAlignVertical: "top" }} value={texto} onChangeText={setTexto}
            />
            <ErrText>{error}</ErrText>
            <Btn title="Enviar mensagem" onPress={enviar} loading={enviando} disabled={texto.trim().length < 5} />
            <Btn title="Cancelar" kind="ghost" onPress={() => setAberto(false)} />
          </>
        ) : (
          <Btn title="Falar com o suporte" kind="ghost" onPress={() => setAberto(true)} />
        )}
      </View>
    </Card>
  );
}

/**
 * Home da loja de conveniência. Só entra quem aceitou o termo E já tirou a
 * foto do rosto (usada pra reconhecer o cliente no caixa) — sem foto, vai
 * direto pra tela de foto.
 */
export default function LojaHome() {
  const { me } = useSession();
  const [lojas, setLojas] = useState<Loja[] | null>(null);
  const liberado = !!me && me.termosAceitos && me.temFoto;

  const carregarLojas = useCallback(() => {
    api<{ lojas: Loja[] }>("/api/lojas").then((r) => setLojas(r.lojas)).catch(() => setLojas([]));
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (liberado) carregarLojas();
    }, [liberado, carregarLojas])
  );

  if (!me) return <Redirect href="/cadastro" />;
  if (!me.termosAceitos) return <Redirect href="/termos" />;
  if (!me.temFoto) return <Redirect href="/loja-foto" />;

  const ehDono = (me.solicitacoes ?? []).some((s) => s.tipo === "DONO_LOJA" && s.status === "APROVADA");

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingVertical: 24 }}>
        <H1>Loja conveniência</H1>
        {ehDono && <Btn title="Minha loja (área do dono)" onPress={() => router.push("/minha-loja")} />}
        <Card>
          <Label>Seu código de cliente</Label>
          <Text style={{ fontFamily: F.displayX, fontSize: 32, color: C.cromo }}>{me.codigoCliente}</Text>
          <Sub>É por ele que a loja registra sua entrada.</Sub>
        </Card>
        <Card>
          <Label>Saldo disponível</Label>
          <Text style={{ fontFamily: F.displayX, fontSize: 32, color: C.cromo }}>{money(me.walletCents)}</Text>
          <View style={{ marginTop: 12 }}>
            <Btn title="Adicionar saldo" kind="ghost" onPress={() => router.push("/recarga")} />
          </View>
        </Card>

        <Label>Lojas</Label>
        {lojas === null ? (
          <Sub>Carregando…</Sub>
        ) : lojas.length === 0 ? (
          <Sub>Ainda não há lojas abertas. Assim que a primeira estiver funcionando, ela aparece aqui.</Sub>
        ) : (
          lojas.map((l) => <CartaoLoja key={l.id} loja={l} onEnviada={carregarLojas} />)
        )}

        <Btn title="Trocar minha foto" kind="ghost" onPress={() => router.push("/loja-foto")} />
        <Btn title="Voltar para a escolha" kind="ghost" onPress={() => router.replace("/escolha")} />
      </ScrollView>
    </Screen>
  );
}

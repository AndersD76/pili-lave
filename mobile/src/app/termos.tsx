import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { api } from "@/lib/api";
import { mascaraNascimento, nascimentoParaApi } from "@/lib/nascimento";
import { useSession } from "@/lib/session";
import { Btn, Card, ErrText, H1, Input, Label, Screen, Sub } from "@/ui";
import { C, F } from "@/theme";

type Termo = { versao: string; topicos: { titulo: string; texto: string }[] };

/**
 * Termo de uso — obrigatório pra usar o app (a tela de escolha manda pra cá
 * enquanto me.termosAceitos for falso). O texto vem do servidor
 * (GET /api/termos). Quem se cadastrou antes da data de nascimento existir
 * preenche ela aqui também.
 */
export default function Termos() {
  const { me, refresh } = useSession();
  const [termo, setTermo] = useState<Termo | null>(null);
  const [nascimento, setNascimento] = useState("");
  const [aceito, setAceito] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Termo>("/api/termos", { auth: false })
      .then(setTermo)
      .catch(() => setError("Não foi possível carregar o termo. Confira sua conexão."));
  }, []);

  if (!me) return <Redirect href="/cadastro" />;
  const faltaNascimento = !me.nascimento;
  const nascimentoApi = nascimentoParaApi(nascimento);
  // O que ainda falta pra liberar o botão — dito na tela, pra ninguém ficar
  // olhando um botão apagado sem saber por quê.
  const falta = !termo
    ? ""
    : faltaNascimento && !nascimentoApi
    ? "Informe sua data de nascimento completa (dia, mês e ano)."
    : !aceito
    ? "Marque \"Li e aceito o termo de uso\" para continuar."
    : "";

  function digitarNascimento(v: string) {
    const mascarado = mascaraNascimento(v);
    setNascimento(mascarado);
    // teclado numérico não tem tecla de fechar: some sozinho com a data completa
    if (mascarado.length === 10) Keyboard.dismiss();
  }

  async function aceitar() {
    if (!termo) return;
    setError("");
    setLoading(true);
    try {
      await api("/api/termos", { body: { versao: termo.versao, nascimento: nascimentoApi ?? undefined } });
      await refresh();
      router.replace("/escolha");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível registrar o aceite");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        // tocar fora do campo ou arrastar a tela fecha o teclado, e o toque
        // na caixa/botão vale mesmo com o teclado aberto
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ gap: 14, paddingVertical: 24 }}
      >
        <View>
          <H1>Termo de uso</H1>
          <Sub>Para usar o app é preciso ler e aceitar o termo abaixo.</Sub>
        </View>
        {!termo && !error ? <Sub>Carregando…</Sub> : null}
        {termo?.topicos.map((t) => (
          <Card key={t.titulo}>
            <Label>{t.titulo}</Label>
            <Text style={{ fontFamily: F.body, fontSize: 15, color: C.acoD }}>{t.texto}</Text>
          </Card>
        ))}
        {termo ? <Sub>Versão: {termo.versao}</Sub> : null}
        {faltaNascimento && (
          <View>
            <Label>Data de nascimento</Label>
            <Input
              placeholder="DD/MM/AAAA" keyboardType="number-pad" maxLength={10}
              value={nascimento} onChangeText={digitarNascimento}
            />
          </View>
        )}
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: aceito }}
          onPress={() => { Keyboard.dismiss(); setAceito((a) => !a); }}
          style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
        >
          <View
            style={{
              width: 24, height: 24, borderRadius: 6, borderWidth: 1.5,
              borderColor: aceito ? C.jato : C.linha, backgroundColor: aceito ? C.jato : "transparent",
            }}
          />
          <Text style={{ fontFamily: F.body, fontSize: 15, color: C.cromo, flex: 1 }}>Li e aceito o termo de uso</Text>
        </Pressable>
        <ErrText>{error}</ErrText>
        {falta ? <Sub>{falta}</Sub> : null}
        <Btn
          title="Aceitar e continuar" onPress={aceitar} loading={loading}
          disabled={!termo || !aceito || (faltaNascimento && !nascimentoApi)}
        />
      </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

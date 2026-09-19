import { router } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { api, type Me } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Btn, ErrText, Input, Screen, Sub } from "@/ui";
import { C, F } from "@/theme";

type TipoSolicitado = "LAVADOR" | "COMISSAO1" | "COMISSAO2" | "ALUGUEL" | null;

const OPCOES_TIPO: { k: TipoSolicitado; label: string }[] = [
  { k: null, label: "Sou cliente" },
  { k: "LAVADOR", label: "Sou lavador" },
  { k: "COMISSAO1", label: "Sou vendedor 1" },
  { k: "COMISSAO2", label: "Sou vendedor 2" },
  { k: "ALUGUEL", label: "Recebo aluguel" },
];

/**
 * Primeiro acesso: substitui o login por SMS. Cadastro → login automático →
 * onboarding → tela de créditos (ver src/app/onboarding.tsx).
 */
export default function Cadastro() {
  const { signIn } = useSession();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [tipoSolicitado, setTipoSolicitado] = useState<TipoSolicitado>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const podeEnviar = name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 10
    && /\S+@\S+\.\S+/.test(email) && password.length > 0 && confirmPassword.length > 0;

  async function submit() {
    setError("");
    setLoading(true);
    try {
      const r = await api<{ token: string; user: Me }>("/api/auth/register", {
        body: {
          name: name.trim(), phone, email: email.trim().toLowerCase(), password, confirmPassword,
          tipoSolicitado: tipoSolicitado ?? undefined,
        },
        auth: false,
      });
      await signIn(r.token, r.user);
      if (r.user.cadastroPendente) {
        Alert.alert(
          "Cadastro em análise",
          "Seu pedido pra virar " +
            (OPCOES_TIPO.find((o) => o.k === tipoSolicitado)?.label.replace("Sou ", "") ?? "parceiro") +
            " foi enviado. Enquanto isso você já pode usar o app normalmente como cliente."
        );
      }
      router.replace("/onboarding");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível criar sua conta");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", gap: 14, paddingVertical: 24 }}>
          <View style={{ marginBottom: 4 }}>
            <Text style={{ fontFamily: F.displayX, fontSize: 32, color: C.cromo, letterSpacing: -0.5 }}>
              PILI LAVE<Text style={{ color: C.pili }}>.</Text>
            </Text>
            <Sub>Crie sua conta para começar.</Sub>
          </View>
          <Input placeholder="Nome completo" value={name} onChangeText={setName} autoFocus maxLength={80} />
          <Input
            placeholder="(54) 99999-9999" keyboardType="phone-pad" value={phone} onChangeText={setPhone} maxLength={16}
          />
          <Input
            placeholder="seu@email.com" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail}
          />
          <Input
            placeholder="Senha (mín. 8 caracteres, letras e números)" secureTextEntry value={password} onChangeText={setPassword}
          />
          <Input
            placeholder="Confirmar senha" secureTextEntry value={confirmPassword} onChangeText={setConfirmPassword}
          />

          <View>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.acoD, marginBottom: 8 }}>Tipo de conta</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {OPCOES_TIPO.map((op) => {
                const sel = tipoSolicitado === op.k;
                return (
                  <Pressable
                    key={op.label}
                    onPress={() => setTipoSolicitado(op.k)}
                    style={{
                      borderWidth: 1.5, borderColor: sel ? C.jato : C.linha,
                      backgroundColor: sel ? "rgba(37,207,222,0.12)" : "transparent",
                      borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
                    }}
                  >
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.cromo }}>{op.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {tipoSolicitado && (
              <Sub>Fica pendente de aprovação do admin — você continua usando o app como cliente enquanto isso.</Sub>
            )}
          </View>

          <ErrText>{error}</ErrText>
          <Btn title="Criar conta" onPress={submit} loading={loading} disabled={!podeEnviar} />
          <Text
            style={{ fontFamily: F.body, fontSize: 14, color: C.jato, textAlign: "center", marginTop: 4 }}
            onPress={() => router.push("/login")}
          >
            Já tenho uma conta
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

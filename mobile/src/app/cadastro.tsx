import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { api, type Me } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Btn, ErrText, Input, Screen, Sub } from "@/ui";
import { C, F } from "@/theme";

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const podeEnviar = name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 10
    && /\S+@\S+\.\S+/.test(email) && password.length > 0 && confirmPassword.length > 0;

  async function submit() {
    setError("");
    setLoading(true);
    try {
      const r = await api<{ token: string; user: Me }>("/api/auth/register", {
        body: { name: name.trim(), phone, email: email.trim().toLowerCase(), password, confirmPassword },
        auth: false,
      });
      await signIn(r.token, r.user);
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

import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { api, type Me } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Btn, ErrText, Input, Screen, Sub } from "@/ui";
import { C, F } from "@/theme";

export default function Login() {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    setLoading(true);
    try {
      const r = await api<{ token: string; user: Me }>("/api/auth/login", {
        body: { email: email.trim().toLowerCase(), password }, auth: false,
      });
      await signIn(r.token, r.user);
      router.replace("/(tabs)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível entrar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "center", gap: 16 }}
      >
        <View style={{ marginBottom: 12 }}>
          <Text style={{ fontFamily: F.displayX, fontSize: 40, color: C.cromo, letterSpacing: -0.5 }}>
            PILI LAVE<Text style={{ color: C.pili }}>.</Text>
          </Text>
          <Sub>Entre com seu e-mail e senha.</Sub>
        </View>
        <Input
          placeholder="seu@email.com"
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
          autoFocus
        />
        <Input
          placeholder="Senha"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <ErrText>{error}</ErrText>
        <Btn title="Entrar" onPress={submit} loading={loading} disabled={!email || !password} />
        <Text
          style={{ fontFamily: F.body, fontSize: 14, color: C.jato, textAlign: "center", marginTop: 4 }}
          onPress={() => router.push("/cadastro")}
        >
          Criar conta
        </Text>
      </KeyboardAvoidingView>
    </Screen>
  );
}

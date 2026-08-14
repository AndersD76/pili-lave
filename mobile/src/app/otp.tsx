import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import { api, type Me } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Btn, ErrText, H1, Input, Screen, Sub } from "@/ui";

export default function Otp() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const { signIn } = useSession();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    setLoading(true);
    try {
      const r = await api<{ token: string; user: Me }>("/api/auth/otp/verify", {
        body: { phone, code }, auth: false,
      });
      await signIn(r.token, r.user);
      router.replace("/(tabs)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Código incorreto");
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
        <H1>Digite o código</H1>
        <Sub>Enviamos um SMS para {phone}.</Sub>
        <Input
          placeholder="000000"
          keyboardType="number-pad"
          value={code}
          onChangeText={setCode}
          maxLength={6}
          autoFocus
          style={{ fontSize: 28, letterSpacing: 8, textAlign: "center", fontFamily: "Sora_700Bold" }}
        />
        <ErrText>{error}</ErrText>
        <Btn title="Entrar" onPress={submit} loading={loading} disabled={code.length !== 6} />
      </KeyboardAvoidingView>
    </Screen>
  );
}

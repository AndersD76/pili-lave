import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { api } from "@/lib/api";
import { Btn, ErrText, Input, Screen, Sub } from "@/ui";
import { C, F } from "@/theme";

export default function Login() {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    setLoading(true);
    try {
      const r = await api<{ ok: true; phone: string }>("/api/auth/otp/request", {
        body: { phone }, auth: false,
      });
      router.push({ pathname: "/otp", params: { phone: r.phone } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao enviar o código");
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
          <Sub>Entre com seu celular. Enviamos um código por SMS.</Sub>
        </View>
        <Input
          placeholder="(54) 99999-9999"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          autoFocus
          maxLength={16}
        />
        <ErrText>{error}</ErrText>
        <Btn title="Receber código" onPress={submit} loading={loading} disabled={phone.replace(/\D/g, "").length < 10} />
      </KeyboardAvoidingView>
    </Screen>
  );
}

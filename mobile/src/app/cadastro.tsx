import { router } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { api, type Me, type TipoParceiro } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Btn, ErrText, Input, Screen, Sub } from "@/ui";
import { C, F } from "@/theme";

const OPCOES_TIPO: { k: TipoParceiro; label: string }[] = [
  { k: "LAVADOR", label: "Sou lavador" },
  { k: "COMISSAO1", label: "Sou vendedor 1" },
  { k: "COMISSAO2", label: "Sou vendedor 2" },
  { k: "ALUGUEL", label: "Recebo aluguel" },
];

/**
 * Primeiro acesso: substitui o login por SMS. Cadastro → login automático →
 * onboarding → tela de créditos (ver src/app/onboarding.tsx).
 *
 * Todo mundo já vira cliente automaticamente ao criar a conta — não existe
 * "sou cliente" pra marcar. Os chips abaixo são pedidos ADICIONAIS, e dá pra
 * marcar mais de um ao mesmo tempo (ex: lavador de uma máquina e também
 * recebe aluguel de outra) — cada um vira uma solicitação independente,
 * aprovada uma a uma pelo admin. Quem não marcar nada aqui ainda pode pedir
 * depois, a qualquer momento, pelo perfil.
 */
export default function Cadastro() {
  const { signIn } = useSession();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [tiposSolicitados, setTiposSolicitados] = useState<TipoParceiro[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const podeEnviar = name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 10
    && /\S+@\S+\.\S+/.test(email) && password.length > 0 && confirmPassword.length > 0;

  function alternarTipo(tipo: TipoParceiro) {
    setTiposSolicitados((atual) => (atual.includes(tipo) ? atual.filter((t) => t !== tipo) : [...atual, tipo]));
  }

  async function submit() {
    setError("");
    setLoading(true);
    try {
      const r = await api<{ token: string; user: Me }>("/api/auth/register", {
        body: {
          name: name.trim(), phone, email: email.trim().toLowerCase(), password, confirmPassword,
          tiposSolicitados,
        },
        auth: false,
      });
      await signIn(r.token, r.user);
      if (tiposSolicitados.length > 0) {
        const labels = tiposSolicitados
          .map((t) => OPCOES_TIPO.find((o) => o.k === t)?.label.replace(/^(Sou|Recebo) /, ""))
          .join(", ");
        Alert.alert(
          "Pedido enviado",
          `Seu pedido pra virar ${labels} foi enviado pro admin. Enquanto isso você já usa o app normalmente como cliente.`
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
            <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.acoD, marginBottom: 8 }}>
              Também é lavador, vendedor ou recebe aluguel de alguma máquina? (opcional, dá pra marcar mais de um)
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {OPCOES_TIPO.map((op) => {
                const sel = tiposSolicitados.includes(op.k);
                return (
                  <Pressable
                    key={op.k}
                    onPress={() => alternarTipo(op.k)}
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
            {tiposSolicitados.length > 0 && (
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

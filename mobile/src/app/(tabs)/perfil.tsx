import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ComponentProps } from "react";
import { useState } from "react";
import { Alert, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { api, API_URL, type TipoParceiro } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Btn, Card, Label, Screen, Sub } from "@/ui";
import { C, F } from "@/theme";

/** TODO: trocar pelo número oficial do suporte no WhatsApp. */
const SUPPORT_WHATSAPP = "https://wa.me/5554999999999";
const PRIVACY_URL = `${API_URL}/privacidade`;

type IconName = ComponentProps<typeof Ionicons>["name"];

function Row({
  icon, text, onPress, disabled, suffix,
}: {
  icon: IconName; text: string; onPress?: () => void; disabled?: boolean; suffix?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [{
        flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      }]}
    >
      <Ionicons name={icon} size={20} color={C.jato} />
      <Text style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 15, color: C.cromo }}>{text}</Text>
      {suffix ? <Text style={{ fontFamily: F.body, fontSize: 12, color: C.aco }}>{suffix}</Text> : null}
      {!disabled && <Ionicons name="chevron-forward" size={16} color={C.aco} />}
    </Pressable>
  );
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: "rgba(37,207,222,0.06)" }} />;
}

const LABEL_TIPO: Record<string, string> = {
  LAVADOR: "Lavador", COMISSAO1: "Vendedor 1", COMISSAO2: "Vendedor 2", ALUGUEL: "Aluguel",
};
const TIPOS: TipoParceiro[] = ["LAVADOR", "COMISSAO1", "COMISSAO2", "ALUGUEL"];

function SecaoParticipacao() {
  const { me, refresh } = useSession();
  const [enviando, setEnviando] = useState<TipoParceiro | null>(null);
  const solicitacoes = me?.solicitacoes ?? [];

  async function pedir(tipo: TipoParceiro) {
    setEnviando(tipo);
    try {
      await api("/api/parceiro/solicitar", { body: { tipo } });
      await refresh();
    } catch (e) {
      Alert.alert("Não deu", e instanceof Error ? e.message : "Não foi possível enviar o pedido");
    } finally {
      setEnviando(null);
    }
  }

  return (
    <View>
      <Label>Também é lavador, vendedor ou aluguel?</Label>
      <Card style={{ gap: 10 }}>
        {TIPOS.map((tipo) => {
          const s = solicitacoes.find((x) => x.tipo === tipo);
          return (
            <View key={tipo} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.cromo }}>{LABEL_TIPO[tipo]}</Text>
              {s?.status === "APROVADA" ? (
                <View style={{ backgroundColor: "rgba(80,200,120,0.15)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.ok }}>Aprovado</Text>
                </View>
              ) : s?.status === "PENDENTE" ? (
                <View style={{ backgroundColor: "rgba(230,180,60,0.15)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.atencao }}>Em análise</Text>
                </View>
              ) : (
                <Pressable
                  onPress={() => pedir(tipo)}
                  disabled={enviando === tipo}
                  style={{ borderWidth: 1.5, borderColor: C.jato, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, opacity: enviando === tipo ? 0.5 : 1 }}
                >
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.jato }}>
                    {enviando === tipo ? "Enviando..." : s?.status === "REJEITADA" ? "Pedir de novo" : "Pedir"}
                  </Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </Card>
    </View>
  );
}

export default function Perfil() {
  const { me, signOut } = useSession();
  const isLavador = me?.role === "LAVADOR" || me?.role === "ADMIN";
  const pendentes = (me?.solicitacoes ?? []).filter((s) => s.status === "PENDENTE");

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 16, gap: 20 }}>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Ionicons name="person-circle" size={44} color={C.jato} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.display, fontSize: 18, color: C.cromo }}>
              {me?.name || "Seu perfil"}
            </Text>
            <Text style={{ fontFamily: F.body, fontSize: 13, color: C.acoD, marginTop: 2 }}>
              {me?.phone}
            </Text>
          </View>
        </Card>

        {pendentes.length > 0 && (
          <Card style={{ borderColor: C.atencao, borderWidth: 1.5 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.cromo }}>
              Pedido{pendentes.length > 1 ? "s" : ""} em análise: {pendentes.map((s) => LABEL_TIPO[s.tipo]).join(", ")}
            </Text>
            <Sub>O admin ainda vai aprovar. Enquanto isso você usa o app normalmente como cliente.</Sub>
          </Card>
        )}

        <View>
          <Label>Conta</Label>
          <Card style={{ paddingVertical: 4 }}>
            <Row icon="id-card" text="Meus dados" onPress={() => router.push("/meus-dados")} />
            <Divider />
            <Row icon="time" text="Histórico" onPress={() => router.push("/historico")} />
            <Divider />
            <Row icon="notifications" text="Notificações" disabled suffix="em breve" />
          </Card>
        </View>

        <View>
          <Label>Suporte e sobre</Label>
          <Card style={{ paddingVertical: 4 }}>
            <Row
              icon="logo-whatsapp"
              text="Suporte técnico"
              onPress={() => Linking.openURL(SUPPORT_WHATSAPP).catch(() => {})}
            />
            <Divider />
            <Row
              icon="shield-checkmark"
              text="Política de privacidade"
              onPress={() => Linking.openURL(PRIVACY_URL).catch(() => {})}
            />
          </Card>
        </View>

        <View>
          <Label>Preferências</Label>
          <Card style={{ paddingVertical: 4 }}>
            <Row icon="finger-print" text="Biometria" disabled suffix="em breve" />
          </Card>
        </View>

        <SecaoParticipacao />

        {isLavador && (
          <Pressable
            onPress={() => router.push("/scanner")}
            style={({ pressed }) => [{
              flexDirection: "row", alignItems: "center", gap: 12,
              backgroundColor: C.jato, borderRadius: 20, padding: 20, opacity: pressed ? 0.85 : 1,
            }]}
          >
            <Ionicons name="qr-code" size={26} color={C.verniz} />
            <View>
              <Text style={{ fontFamily: F.display, fontSize: 17, color: C.verniz }}>Modo lavador</Text>
              <Text style={{ fontFamily: F.body, fontSize: 13, color: C.verniz }}>
                Escanear voucher do cliente
              </Text>
            </View>
          </Pressable>
        )}

        <Btn title="Sair" kind="danger" onPress={async () => { await signOut(); router.replace("/login"); }} />
        <Sub>PILI LAVE v1.0</Sub>
      </ScrollView>
    </Screen>
  );
}

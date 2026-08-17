import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ComponentProps } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { API_URL } from "@/lib/api";
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

export default function Perfil() {
  const { me, signOut } = useSession();
  const isLavador = me?.role === "LAVADOR" || me?.role === "ADMIN";

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

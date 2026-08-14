import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Btn, Card, ErrText, Input, Label, Screen, Sub } from "@/ui";
import { C, F } from "@/theme";

export default function Perfil() {
  const { me, refresh, signOut } = useSession();
  const [name, setName] = useState(me?.name ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setError(""); setSaved(false);
    try {
      await api("/api/me", { method: "PATCH", body: { name: name.trim() } });
      await refresh();
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar");
    }
  }

  const isLavador = me?.role === "LAVADOR" || me?.role === "ADMIN";

  return (
    <Screen>
      <View style={{ marginTop: 16, gap: 16 }}>
        <Card>
          <Label>Telefone</Label>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: C.cromo }}>{me?.phone}</Text>
        </Card>

        <Card>
          <Label>Seu nome</Label>
          <Input placeholder="Como podemos te chamar?" value={name} onChangeText={setName} />
          <View style={{ marginTop: 12 }}>
            <Btn title={saved ? "Salvo!" : "Salvar"} kind="ghost" onPress={save} />
          </View>
          <ErrText>{error}</ErrText>
        </Card>

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

        <Btn title="Sair" kind="ghost" onPress={async () => { await signOut(); router.replace("/login"); }} />
        <Sub>PILI LAVE v1.0</Sub>
      </View>
    </Screen>
  );
}

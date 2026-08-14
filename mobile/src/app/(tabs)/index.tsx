import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { api, type Vehicle } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Btn, Card, Label, Screen, Sub } from "@/ui";
import { C, F, fmtPlate, money } from "@/theme";

export default function Home() {
  const { me, refresh } = useSession();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      api<Vehicle[]>("/api/vehicles").then(setVehicles).catch(() => {});
    }, [refresh])
  );

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ marginTop: 18, marginBottom: 20 }}>
          <Text style={{ fontFamily: F.displayX, fontSize: 26, color: C.cromo }}>
            PILI LAVE<Text style={{ color: C.pili }}>.</Text>
          </Text>
          {me?.name ? <Sub>Olá, {me.name.split(" ")[0]}</Sub> : null}
        </View>

        <Card>
          <Label>Saldo disponível</Label>
          <Text style={{ fontFamily: F.displayX, fontSize: 38, color: C.cromo, fontVariant: ["tabular-nums"] }}>
            {money(me?.walletCents ?? 0)}
          </Text>
          <View style={{ marginTop: 14 }}>
            <Btn title="Adicionar saldo" kind="ghost" onPress={() => router.push("/recarga")} />
          </View>
        </Card>

        <View style={{ marginTop: 22 }}>
          <Btn title="Nova lavagem" onPress={() => router.push("/nova-lavagem")} />
        </View>

        <View style={{ marginTop: 28 }}>
          <Label>Meus veículos</Label>
          {vehicles.map((v) => (
            <Card key={v.id} style={{ marginBottom: 10 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 21, color: C.cromo, letterSpacing: 4 }}>
                {fmtPlate(v.plate)}
              </Text>
              <Text style={{ fontFamily: F.body, fontSize: 14, color: C.acoD, marginTop: 2 }}>
                {[v.brand, v.model].filter(Boolean).join(" ") || "Veículo"}
              </Text>
            </Card>
          ))}
          <Pressable
            onPress={() => router.push("/veiculo-novo")}
            style={({ pressed }) => [{
              flexDirection: "row", alignItems: "center", gap: 10,
              borderWidth: 1, borderColor: C.linha, borderRadius: 20, borderStyle: "dashed",
              padding: 18, opacity: pressed ? 0.7 : 1,
            }]}
          >
            <Ionicons name="add-circle" size={22} color={C.jato} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.cromo }}>Adicionar veículo</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

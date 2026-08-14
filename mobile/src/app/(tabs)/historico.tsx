import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { api, type Order } from "@/lib/api";
import { Label, Screen } from "@/ui";
import { C, F, fmtPlate, money } from "@/theme";

function StatusChip({ status }: { status: Order["status"] }) {
  const map = {
    PAID: { label: "Aguardando resgate", color: C.atencao },
    REDEEMED: { label: "Liberada", color: C.ok },
    CANCELED: { label: "Cancelada", color: C.erro },
  } as const;
  const m = map[status];
  return (
    <Text style={{
      fontFamily: F.bodyBold, fontSize: 12, color: m.color,
      backgroundColor: `${m.color}22`, borderRadius: 999,
      paddingHorizontal: 10, paddingVertical: 3, overflow: "hidden",
    }}>
      {m.label}
    </Text>
  );
}

export default function Historico() {
  const [orders, setOrders] = useState<Order[]>([]);

  useFocusEffect(
    useCallback(() => {
      api<Order[]>("/api/orders").then(setOrders).catch(() => {});
    }, [])
  );

  return (
    <Screen>
      <View style={{ marginTop: 16, flex: 1 }}>
        <Label>Minhas lavagens</Label>
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          ListEmptyComponent={
            <Text style={{ fontFamily: F.body, color: C.acoD, marginTop: 8 }}>
              Nenhuma lavagem ainda.
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => item.status === "PAID" && router.push({ pathname: "/voucher/[id]", params: { id: item.id } })}
              style={({ pressed }) => [{
                backgroundColor: C.verniz2, borderWidth: 1, borderColor: C.linha,
                borderRadius: 16, padding: 16, marginBottom: 10, opacity: pressed ? 0.8 : 1,
              }]}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontFamily: F.display, fontSize: 17, color: C.cromo }}>
                  {item.program.nome}
                </Text>
                <StatusChip status={item.status} />
              </View>
              <Text style={{ fontFamily: F.body, fontSize: 13, color: C.acoD, marginTop: 4 }}>
                {money(item.amountCents)}
                {item.vehicle ? ` · ${fmtPlate(item.vehicle.plate)}` : ""}
                {" · "}{new Date(item.createdAt).toLocaleDateString("pt-BR")}
              </Text>
              {item.status === "PAID" && (
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.jato, marginTop: 6 }}>
                  Toque para ver o QR
                </Text>
              )}
            </Pressable>
          )}
        />
      </View>
    </Screen>
  );
}

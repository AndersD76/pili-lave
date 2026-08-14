import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { api, type Order } from "@/lib/api";
import { Btn, Card, Screen, Sub } from "@/ui";
import { C, F, fmtPlate, money } from "@/theme";

export default function Voucher() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => api<Order>(`/api/orders/${id}`).then((o) => { if (alive) setOrder(o); }).catch(() => {});
    load();
    pollRef.current = setInterval(load, 4000); // vira "Liberada" quando o lavador escanear
    return () => { alive = false; if (pollRef.current) clearInterval(pollRef.current); };
  }, [id]);

  if (!order) return <Screen><Sub>Carregando…</Sub></Screen>;

  const liberada = order.status === "REDEEMED";

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingVertical: 24, alignItems: "center", gap: 16 }}>
        {liberada ? (
          <View style={{ alignItems: "center", gap: 12, marginTop: 40 }}>
            <View style={{
              width: 110, height: 110, borderRadius: 999, backgroundColor: C.ok,
              alignItems: "center", justifyContent: "center",
            }}>
              <Text style={{ fontFamily: F.displayX, fontSize: 30, color: C.espuma }}>OK</Text>
            </View>
            <Text style={{ fontFamily: F.displayX, fontSize: 26, color: C.cromo }}>Lavagem liberada!</Text>
            <Sub>{order.program.nome} · {money(order.amountCents)}</Sub>
            <View style={{ alignSelf: "stretch", marginTop: 16 }}>
              <Btn title="Voltar ao início" onPress={() => router.dismissAll()} />
            </View>
          </View>
        ) : (
          <>
            <Card style={{
              backgroundColor: C.espuma, alignItems: "center", padding: 24,
              borderStyle: "dashed", borderWidth: 2, borderColor: "rgba(11,124,137,0.35)", borderRadius: 24,
            }}>
              <QRCode
                value={`PILILAVE:${order.voucherCode}`}
                size={240}
                backgroundColor={C.espuma}
                color="#10181B"
              />
            </Card>
            <Text style={{ fontFamily: F.display, fontSize: 20, color: C.cromo }}>
              Lavagem {order.program.id} · {order.program.nome}
            </Text>
            {order.vehicle && (
              <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.acoD, letterSpacing: 2 }}>
                {fmtPlate(order.vehicle.plate)}
              </Text>
            )}
            <Sub>Mostre este código ao lavador</Sub>
            <Text style={{ fontFamily: F.body, fontSize: 12, color: C.aco }}>{order.voucherCode}</Text>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

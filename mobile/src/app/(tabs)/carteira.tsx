import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Btn, Card, Label, Screen } from "@/ui";
import { C, F, money } from "@/theme";

type Tx = { id: string; amountCents: number; kind: string; createdAt: string };
const KIND_LABEL: Record<string, string> = {
  TOPUP: "Recarga", WASH: "Lavagem", REFUND: "Estorno", ADJUST: "Ajuste",
};

export default function Carteira() {
  const { me, refresh } = useSession();
  const [txs, setTxs] = useState<Tx[]>([]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      api<{ walletCents: number; txs: Tx[] }>("/api/wallet").then((r) => setTxs(r.txs)).catch(() => {});
    }, [refresh])
  );

  return (
    <Screen>
      <Card style={{ marginTop: 16 }}>
        <Label>Saldo disponível</Label>
        <Text style={{ fontFamily: F.displayX, fontSize: 38, color: C.cromo, fontVariant: ["tabular-nums"] }}>
          {money(me?.walletCents ?? 0)}
        </Text>
        <View style={{ marginTop: 14 }}>
          <Btn title="Adicionar saldo" onPress={() => router.push("/recarga")} />
        </View>
      </Card>

      <View style={{ marginTop: 24, flex: 1 }}>
        <Label>Movimentações</Label>
        <FlatList
          data={txs}
          keyExtractor={(t) => t.id}
          ListEmptyComponent={
            <Text style={{ fontFamily: F.body, color: C.acoD, marginTop: 8 }}>
              Nada por aqui ainda. Adicione saldo para começar.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={{
              flexDirection: "row", justifyContent: "space-between", paddingVertical: 12,
              borderBottomWidth: 1, borderBottomColor: "rgba(37,207,222,0.06)",
            }}>
              <View>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.cromo }}>
                  {KIND_LABEL[item.kind] ?? item.kind}
                </Text>
                <Text style={{ fontFamily: F.body, fontSize: 12, color: C.aco }}>
                  {new Date(item.createdAt).toLocaleString("pt-BR")}
                </Text>
              </View>
              <Text style={{
                fontFamily: F.bodyBold, fontSize: 16, fontVariant: ["tabular-nums"],
                color: item.amountCents >= 0 ? C.ok : C.cromo,
              }}>
                {item.amountCents >= 0 ? "+" : "−"}{money(Math.abs(item.amountCents))}
              </Text>
            </View>
          )}
        />
      </View>
    </Screen>
  );
}

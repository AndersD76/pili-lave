import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { api, type WalletResp, type WalletTx } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Btn, Card, Label, Screen } from "@/ui";
import { C, F, money } from "@/theme";

const KIND: Record<string, { label: string; color: string }> = {
  TOPUP: { label: "Recarga", color: C.ok },
  WASH: { label: "Lavagem", color: C.erro },
  REFUND: { label: "Estorno", color: C.ok },
  ADJUST: { label: "Ajuste", color: C.cromo },
};

export default function Carteira() {
  const { me, refresh } = useSession();
  const [wallet, setWallet] = useState<WalletResp | null>(null);

  useFocusEffect(
    useCallback(() => {
      refresh();
      api<WalletResp>("/api/wallet").then(setWallet).catch(() => {});
    }, [refresh])
  );

  const available = wallet?.availableCents ?? me?.walletCents ?? 0;
  const reserved = wallet?.reservedCents ?? 0;

  return (
    <Screen>
      <Card style={{ marginTop: 16 }}>
        <Label>Saldo disponível</Label>
        <Text style={{ fontFamily: F.displayX, fontSize: 38, color: C.cromo, fontVariant: ["tabular-nums"] }}>
          {money(available)}
        </Text>
        {reserved > 0 && (
          <View style={{ marginTop: 6, gap: 2 }}>
            <Text style={{ fontFamily: F.body, fontSize: 14, color: C.atencao, fontVariant: ["tabular-nums"] }}>
              Reservado: {money(reserved)}
            </Text>
            <Text style={{ fontFamily: F.body, fontSize: 14, color: C.acoD, fontVariant: ["tabular-nums"] }}>
              Total: {money(wallet?.walletCents ?? available + reserved)}
            </Text>
          </View>
        )}
        <View style={{ marginTop: 14 }}>
          <Btn title="Adicionar saldo" onPress={() => router.push("/recarga")} />
        </View>
      </Card>

      <View style={{ marginTop: 24, flex: 1 }}>
        <Label>Movimentações</Label>
        <FlatList
          data={wallet?.txs ?? []}
          keyExtractor={(t: WalletTx) => t.id}
          ListEmptyComponent={
            <Text style={{ fontFamily: F.body, color: C.acoD, marginTop: 8 }}>
              Nada por aqui ainda. Adicione saldo para começar.
            </Text>
          }
          renderItem={({ item }) => {
            const kind = KIND[item.kind] ?? { label: item.kind, color: C.cromo };
            return (
              <View style={{
                flexDirection: "row", justifyContent: "space-between", paddingVertical: 12,
                borderBottomWidth: 1, borderBottomColor: "rgba(37,207,222,0.06)",
              }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.cromo }}>
                    {kind.label}
                  </Text>
                  {item.note ? (
                    <Text style={{ fontFamily: F.body, fontSize: 12, color: C.acoD }} numberOfLines={1}>
                      {item.note}
                    </Text>
                  ) : null}
                  <Text style={{ fontFamily: F.body, fontSize: 12, color: C.aco }}>
                    {new Date(item.createdAt).toLocaleString("pt-BR")}
                  </Text>
                </View>
                <Text style={{
                  fontFamily: F.bodyBold, fontSize: 16, fontVariant: ["tabular-nums"],
                  color: kind.color,
                }}>
                  {item.amountCents >= 0 ? "+" : "−"}{money(Math.abs(item.amountCents))}
                </Text>
              </View>
            );
          }}
        />
      </View>
    </Screen>
  );
}

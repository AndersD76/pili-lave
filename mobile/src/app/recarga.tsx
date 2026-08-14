import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Btn, Card, ErrText, Label, Screen, Sub } from "@/ui";
import { C, F, money } from "@/theme";

const VALORES = [2000, 3000, 5000, 10000];
type Topup = { id: string; pixPayload: string | null; invoiceUrl: string | null; status: string };

export default function Recarga() {
  const { refresh } = useSession();
  const [amount, setAmount] = useState<number>(VALORES[1]);
  const [topup, setTopup] = useState<Topup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function gerar() {
    setError("");
    setLoading(true);
    try {
      const t = await api<Topup>("/api/wallet/topup", { body: { amountCents: amount, method: "PIX" } });
      setTopup(t);
      pollRef.current = setInterval(async () => {
        try {
          const st = await api<{ status: string }>(`/api/wallet/topup/${t.id}`);
          if (st.status === "PAID") {
            if (pollRef.current) clearInterval(pollRef.current);
            await refresh();
            router.back();
          }
        } catch { /* segue tentando */ }
      }, 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível gerar a cobrança");
    } finally {
      setLoading(false);
    }
  }

  async function copiar() {
    if (!topup?.pixPayload) return;
    await Clipboard.setStringAsync(topup.pixPayload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  if (topup?.pixPayload) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ paddingVertical: 24, alignItems: "center", gap: 18 }}>
          <Card style={{ backgroundColor: C.espuma, alignItems: "center", padding: 24 }}>
            <QRCode value={topup.pixPayload} size={240} backgroundColor={C.espuma} color="#10181B" />
          </Card>
          <Text style={{ fontFamily: F.displayX, fontSize: 30, color: C.cromo }}>{money(amount)}</Text>
          <Sub>Abra o app do banco, pague o PIX e o saldo entra sozinho.</Sub>
          <View style={{ alignSelf: "stretch", gap: 10 }}>
            <Btn title={copied ? "Copiado!" : "Copiar código PIX"} kind="ghost" onPress={copiar} />
          </View>
          <Sub>Aguardando pagamento…</Sub>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ marginTop: 20, gap: 20 }}>
        <View>
          <Label>Quanto quer adicionar?</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {VALORES.map((v) => {
              const sel = amount === v;
              return (
                <Pressable
                  key={v}
                  onPress={() => setAmount(v)}
                  style={{
                    borderWidth: 1.5, borderColor: sel ? C.jato : C.linha,
                    backgroundColor: sel ? "rgba(37,207,222,0.12)" : C.verniz2,
                    borderRadius: 16, paddingHorizontal: 20, paddingVertical: 14,
                  }}
                >
                  <Text style={{ fontFamily: F.display, fontSize: 17, color: sel ? C.jato : C.cromo, fontVariant: ["tabular-nums"] }}>
                    {money(v)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <ErrText>{error}</ErrText>
        <Btn title={`Gerar PIX de ${money(amount)}`} onPress={gerar} loading={loading} />
        <Sub>O pagamento é processado pelo Asaas. Cartão de crédito chega em breve.</Sub>
      </View>
    </Screen>
  );
}

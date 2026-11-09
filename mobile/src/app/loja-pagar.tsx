import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Btn, Card, ErrText, H1, Screen, Sub } from "@/ui";
import { C, F, money } from "@/theme";

/** Pede um token novo um pouco antes de vencer (o token dura 180s no
 *  servidor) — assim quem ficar parado na tela não vê o QR morrer na mão. */
const RENOVA_A_CADA_MS = 150_000;

/**
 * QR de pagamento da loja: o caixa escaneia (mesmo leitor dos produtos) e
 * debita da carteira. Cada QR vale por pouco tempo e se renova sozinho
 * enquanto a tela ficar aberta.
 */
export default function PagarNaLoja() {
  const { me, refresh } = useSession();
  const [token, setToken] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const gerando = useRef(false);

  useEffect(() => {
    async function gerar() {
      if (gerando.current) return;
      gerando.current = true;
      try {
        const r = await api<{ token: string }>("/api/loja/pagamento/token", { body: {} });
        setToken(r.token);
        setErro("");
      } catch {
        setErro("Não foi possível gerar o código. Confira sua conexão e tente de novo.");
      } finally {
        gerando.current = false;
      }
    }
    gerar();
    refresh(); // saldo pode ter mudado desde a última vez que o app leu
    const t = setInterval(gerar, RENOVA_A_CADA_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <Screen>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingVertical: 24 }}>
        <H1>Pagar na loja</H1>
        <Sub>Mostre este código no leitor do caixa para pagar com o saldo da sua carteira.</Sub>
        <Card style={{ alignItems: "center", padding: 24 }}>
          {token ? (
            <QRCode value={`PILILOJA:${token}`} size={220} backgroundColor={C.espuma} color="#10181B" />
          ) : (
            <View style={{ width: 220, height: 220, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color={C.jato} />
            </View>
          )}
        </Card>
        <ErrText>{erro}</ErrText>
        <Card style={{ alignSelf: "stretch" }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: C.acoD }}>
            Saldo disponível
          </Text>
          <Text style={{ fontFamily: F.displayX, fontSize: 28, color: C.cromo, marginTop: 4 }}>
            {money(me?.walletCents ?? 0)}
          </Text>
        </Card>
        <Sub>O código muda a cada 3 minutos por segurança — deixe a tela aberta até terminar de pagar.</Sub>
        <Btn title="Voltar" kind="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

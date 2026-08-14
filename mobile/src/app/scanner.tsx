import { CameraView, useCameraPermissions } from "expo-camera";
import { useState } from "react";
import { Text, View } from "react-native";
import { api, ApiError } from "@/lib/api";
import { Btn, ErrText, Screen, Sub } from "@/ui";
import { C, F, fmtPlate, money } from "@/theme";

type RedeemResult = {
  ok: true;
  program: { id: number; nome: string };
  plate: string | null;
  clientName: string | null;
  amountCents: number;
};

export default function Scanner() {
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RedeemResult | null>(null);
  const [error, setError] = useState("");

  async function onScan(code: string) {
    if (busy || result) return;
    setBusy(true);
    setError("");
    try {
      setResult(await api<RedeemResult>("/api/redeem", { body: { code } }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao validar o voucher");
      setTimeout(() => { setError(""); setBusy(false); }, 2500); // deixa escanear de novo
      return;
    }
    setBusy(false);
  }

  if (!permission) return <Screen><Sub>Carregando…</Sub></Screen>;

  if (!permission.granted) {
    return (
      <Screen style={{ justifyContent: "center", gap: 16 }}>
        <Sub>Para escanear o voucher do cliente, o app precisa usar a câmera.</Sub>
        <Btn title="Permitir câmera" onPress={requestPermission} />
      </Screen>
    );
  }

  if (result) {
    return (
      <Screen style={{ alignItems: "center", justifyContent: "center", gap: 12 }}>
        <View style={{
          width: 110, height: 110, borderRadius: 999, backgroundColor: C.ok,
          alignItems: "center", justifyContent: "center",
        }}>
          <Text style={{ fontFamily: F.displayX, fontSize: 30, color: C.espuma }}>OK</Text>
        </View>
        <Text style={{ fontFamily: F.displayX, fontSize: 24, color: C.cromo }}>Lavagem liberada</Text>
        <Text style={{ fontFamily: F.display, fontSize: 19, color: C.jato }}>
          {result.program.id} · {result.program.nome}
        </Text>
        {result.plate && (
          <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: C.cromo, letterSpacing: 3 }}>
            {fmtPlate(result.plate)}
          </Text>
        )}
        <Sub>{result.clientName ?? "Cliente"} · {money(result.amountCents)}</Sub>
        <View style={{ alignSelf: "stretch", marginTop: 20 }}>
          <Btn title="Escanear próximo" onPress={() => { setResult(null); setBusy(false); }} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen style={{ paddingHorizontal: 0 }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => onScan(data)}
      />
      <View style={{ padding: 20, gap: 8 }}>
        <Sub>Aponte para o QR do cliente. A lavagem é debitada e liberada na hora.</Sub>
        <ErrText>{error}</ErrText>
      </View>
    </Screen>
  );
}

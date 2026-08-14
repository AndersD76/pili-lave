import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { api } from "@/lib/api";
import { Btn, ErrText, Input, Label, Screen, Sub } from "@/ui";

const PLATE_RE = /^[A-Z]{3}\d{4}$|^[A-Z]{3}\d[A-Z]\d{2}$/;

export default function VeiculoNovo() {
  const [plate, setPlate] = useState("");
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const normalized = plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const valid = PLATE_RE.test(normalized);

  async function submit() {
    setError("");
    setLoading(true);
    try {
      await api("/api/vehicles", { body: { plate: normalized, model: model.trim() || undefined } });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível cadastrar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View style={{ marginTop: 20, gap: 16 }}>
        <View>
          <Label>Placa</Label>
          <Input
            placeholder="ABC1D23"
            autoCapitalize="characters"
            value={plate}
            onChangeText={setPlate}
            maxLength={8}
            autoFocus
            style={{ fontSize: 24, letterSpacing: 6, textAlign: "center", fontFamily: "Sora_700Bold" }}
          />
          <Sub>Formato antigo (ABC1234) ou Mercosul (ABC1D23).</Sub>
        </View>
        <View>
          <Label>Modelo (opcional)</Label>
          <Input placeholder="Ex.: Fiat Toro" value={model} onChangeText={setModel} maxLength={60} />
        </View>
        <ErrText>{error}</ErrText>
        <Btn title="Cadastrar veículo" onPress={submit} loading={loading} disabled={!valid} />
      </View>
    </Screen>
  );
}

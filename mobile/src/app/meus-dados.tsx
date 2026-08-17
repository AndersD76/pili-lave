import { useState } from "react";
import { Text, View } from "react-native";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Btn, Card, ErrText, Input, Label, Screen, Sub } from "@/ui";
import { C, F } from "@/theme";

function fmtCpf(digits: string): string {
  const d = digits.slice(0, 11);
  if (d.length > 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length > 6) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  if (d.length > 3) return `${d.slice(0, 3)}.${d.slice(3)}`;
  return d;
}

export default function MeusDados() {
  const { me, refresh } = useSession();
  const [name, setName] = useState(me?.name ?? "");
  const [cpf, setCpf] = useState((me?.cpf ?? "").replace(/\D/g, ""));
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function salvar() {
    setError("");
    setSaved(false);
    setLoading(true);
    try {
      await api("/api/me", {
        method: "PATCH",
        body: {
          name: name.trim() || undefined,
          cpf: cpf || undefined,
        },
      });
      await refresh();
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <View style={{ marginTop: 20, gap: 16 }}>
        <Card>
          <Label>Telefone</Label>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: C.cromo }}>{me?.phone}</Text>
          <Sub>O telefone é seu login e não pode ser alterado aqui.</Sub>
        </Card>

        <View>
          <Label>Seu nome</Label>
          <Input
            placeholder="Como podemos te chamar?"
            value={name}
            onChangeText={setName}
            maxLength={80}
          />
        </View>

        <View>
          <Label>CPF</Label>
          <Input
            placeholder="000.000.000-00"
            value={fmtCpf(cpf)}
            onChangeText={(t) => setCpf(t.replace(/\D/g, "").slice(0, 11))}
            keyboardType="number-pad"
            maxLength={14}
          />
        </View>

        <ErrText>{error}</ErrText>
        <Btn title={saved ? "Salvo!" : "Salvar"} onPress={salvar} loading={loading} />
      </View>
    </Screen>
  );
}

import { useEffect, useState } from "react";
import { Switch, Text, View } from "react-native";
import { api } from "@/lib/api";
import { autenticarComBiometria, biometriaAtiva, biometriaDisponivel, setBiometriaAtiva } from "@/lib/biometria";
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

  const [temBiometria, setTemBiometria] = useState(false);
  const [biometriaOn, setBiometriaOn] = useState(false);

  useEffect(() => {
    (async () => {
      setTemBiometria(await biometriaDisponivel());
      setBiometriaOn(await biometriaAtiva());
    })();
  }, []);

  async function alternarBiometria(ligar: boolean) {
    if (ligar) {
      // pede a digital/rosto AGORA — só ativa se o dono do celular confirmar,
      // senão qualquer um que pegasse o aparelho ligaria a entrada por biometria.
      const ok = await autenticarComBiometria();
      if (!ok) return;
    }
    await setBiometriaAtiva(ligar);
    setBiometriaOn(ligar);
  }

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
          <Label>E-mail</Label>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: C.cromo }}>{me?.email}</Text>
          <Sub>O e-mail é seu login e não pode ser alterado aqui.</Sub>
        </Card>

        <Card>
          <Label>Telefone</Label>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: C.cromo }}>{me?.phone}</Text>
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

        {temBiometria && (
          <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: C.cromo }}>Entrar com biometria</Text>
              <Sub>Use digital ou reconhecimento facial para abrir o app.</Sub>
            </View>
            <Switch
              value={biometriaOn}
              onValueChange={alternarBiometria}
              trackColor={{ false: C.linha, true: C.jatoInk }}
              thumbColor={biometriaOn ? C.jato : C.aco}
            />
          </Card>
        )}

        <ErrText>{error}</ErrText>
        <Btn title={saved ? "Salvo!" : "Salvar"} onPress={salvar} loading={loading} />
      </View>
    </Screen>
  );
}

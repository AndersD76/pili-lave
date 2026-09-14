import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { autenticarComBiometria, biometriaAtiva } from "@/lib/biometria";
import { useSession } from "@/lib/session";
import { Btn } from "@/ui";
import { C, F } from "@/theme";

export default function Index() {
  const { ready, me } = useSession();
  // null = ainda não sabemos se precisa pedir; true = já liberado nesta abertura do app.
  const [desbloqueado, setDesbloqueado] = useState<boolean | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    if (!ready || !me) return;
    let ativo = true;
    (async () => {
      const precisa = await biometriaAtiva();
      if (!precisa) { if (ativo) setDesbloqueado(true); return; }
      const ok = await autenticarComBiometria();
      if (!ativo) return;
      if (ok) setDesbloqueado(true);
      else setFalhou(true);
    })();
    return () => { ativo = false; };
  }, [ready, me]);

  async function tentarDeNovo() {
    setFalhou(false);
    const ok = await autenticarComBiometria();
    if (ok) setDesbloqueado(true);
    else setFalhou(true);
  }

  if (!ready || (me && desbloqueado === null))
    return (
      <View style={{ flex: 1, backgroundColor: C.verniz, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={C.jato} />
      </View>
    );

  if (me && !desbloqueado) {
    return (
      <View style={{ flex: 1, backgroundColor: C.verniz, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 32 }}>
        <Text style={{ fontFamily: F.displayX, fontSize: 24, color: C.cromo }}>PILI LAVE<Text style={{ color: C.pili }}>.</Text></Text>
        {falhou && (
          <Text style={{ fontFamily: F.body, color: C.acoD, textAlign: "center" }}>
            Não deu para confirmar sua digital/rosto.
          </Text>
        )}
        <Btn title="Desbloquear" onPress={tentarDeNovo} />
      </View>
    );
  }

  return me ? <Redirect href="/(tabs)" /> : <Redirect href="/cadastro" />;
}

import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { Btn, Card, Label, Screen, Sub } from "@/ui";
import { C, F } from "@/theme";

const PASSOS = [
  {
    titulo: "Reserve pelo app",
    texto: "Escolha o tipo de lavagem e pague com seu saldo — a reserva fica valendo por 1 hora.",
  },
  {
    titulo: "A câmera reconhece sua placa",
    texto: "Chegando na máquina, a câmera identifica seu carro sozinha e acende o verde para você entrar.",
  },
  {
    titulo: "Câmera não reconheceu? Sem problema",
    texto: 'Toque em "Cheguei" na tela da sua reserva para liberar manualmente. O valor só é cobrado quando a lavagem termina.',
  },
];

/** Primeiro acesso: Cadastro → login automático → Onboarding → tela de créditos. */
export default function Onboarding() {
  const [passo, setPasso] = useState(0);
  const ultimo = passo === PASSOS.length - 1;
  const atual = PASSOS[passo];

  function avancar() {
    if (ultimo) router.replace("/recarga");
    else setPasso((p) => p + 1);
  }

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: "center", gap: 20 }}>
        <Text style={{ fontFamily: F.displayX, fontSize: 26, color: C.cromo }}>
          PILI LAVE<Text style={{ color: C.pili }}>.</Text>
        </Text>
        <Card>
          <Label>{passo + 1} de {PASSOS.length}</Label>
          <Text style={{ fontFamily: F.display, fontSize: 20, color: C.cromo, marginTop: 6 }}>{atual.titulo}</Text>
          <Sub>{atual.texto}</Sub>
        </Card>
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "center" }}>
          {PASSOS.map((_, i) => (
            <View
              key={i}
              style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: i === passo ? C.jato : C.linha }}
            />
          ))}
        </View>
        <Btn title={ultimo ? "Adicionar créditos" : "Próximo"} onPress={avancar} />
      </View>
    </Screen>
  );
}

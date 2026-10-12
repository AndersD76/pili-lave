import { Redirect, router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { Pressable, Text, View } from "react-native";
import { ONBOARDING_PENDENTE } from "@/lib/nascimento";
import { useSession } from "@/lib/session";
import { Screen, SeloServidor, Sub } from "@/ui";
import { C, F } from "@/theme";

function Opcao({ titulo, texto, onPress }: { titulo: string; texto: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: C.verniz2, borderRadius: 20, borderWidth: 1, borderColor: C.linha, padding: 18,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text style={{ fontFamily: F.display, fontSize: 20, color: C.cromo }}>{titulo}</Text>
      <Sub>{texto}</Sub>
    </Pressable>
  );
}

/**
 * Porta de entrada do app: o cliente escolhe entre os dois produtos. A
 * lavagem continua exatamente como era (abas em /(tabs)); a loja de
 * conveniência tem seu próprio caminho (/loja).
 */
export default function Escolha() {
  const { me, signOut } = useSession();

  if (!me) return <Redirect href="/cadastro" />;
  if (!me.termosAceitos) return <Redirect href="/termos" />;

  async function irLavagem() {
    if (await SecureStore.getItemAsync(ONBOARDING_PENDENTE)) {
      await SecureStore.deleteItemAsync(ONBOARDING_PENDENTE);
      router.push("/onboarding");
    } else {
      router.push("/(tabs)");
    }
  }

  return (
    <Screen style={{ justifyContent: "center", gap: 16 }}>
      <View style={{ marginBottom: 8 }}>
        <Text style={{ fontFamily: F.displayX, fontSize: 32, color: C.cromo, letterSpacing: -0.5 }}>
          PILI LAVE<Text style={{ color: C.pili }}>.</Text>
        </Text>
        <Sub>Olá{me.name ? `, ${me.name.split(" ")[0]}` : ""}. O que você quer usar agora?</Sub>
      </View>
      <Opcao
        titulo="Loja conveniência"
        texto="Entre, pegue o que quiser e pague no caixa de autoatendimento."
        onPress={() => router.push("/loja")}
      />
      <Opcao titulo="Lavagem expressa" texto="Reserve pelo app e a máquina lava sozinha." onPress={irLavagem} />
      {/* sair fica aqui também: quem só usa a loja nunca passa pelo Perfil
          (que mora nas abas da lavagem). Sem sessão, a tela cai no cadastro. */}
      <Text
        style={{ fontFamily: F.body, fontSize: 14, color: C.acoD, textAlign: "center", marginTop: 8 }}
        onPress={signOut}
      >
        Sair da conta
      </Text>
      <SeloServidor />
    </Screen>
  );
}

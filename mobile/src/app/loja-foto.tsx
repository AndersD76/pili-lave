import { CameraView, useCameraPermissions } from "expo-camera";
import { Image } from "expo-image";
import { Redirect, router } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Btn, ErrText, H1, Screen, Sub } from "@/ui";
import { C, F } from "@/theme";

/** Menor tamanho de foto que a câmera oferece com pelo menos 480px no lado
 *  maior — rosto pra reconhecimento não precisa de mais, e a foto cheia de
 *  um celular passa do limite do servidor. undefined = deixa o padrão. */
function menorTamanhoUtil(tamanhos: string[]): string | undefined {
  const candidatos = tamanhos
    .map((t) => ({ t, m: /^(\d+)x(\d+)$/.exec(t) }))
    .filter((c) => c.m)
    .map((c) => ({ t: c.t, lado: Math.max(Number(c.m![1]), Number(c.m![2])) }))
    .filter((c) => c.lado >= 480)
    .sort((a, b) => a.lado - b.lado);
  return candidatos[0]?.t;
}

/** Foto do rosto pra loja de conveniência — câmera frontal, com a
 *  autorização específica de uso da imagem (dado biométrico). */
export default function LojaFoto() {
  const { me, refresh } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [tamanho, setTamanho] = useState<string | undefined>(undefined);
  const [foto, setFoto] = useState<{ uri: string; base64: string } | null>(null);
  const [autorizo, setAutorizo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!me) return <Redirect href="/cadastro" />;
  if (!me.termosAceitos) return <Redirect href="/termos" />;

  async function cameraPronta() {
    try {
      setTamanho(menorTamanhoUtil((await camera.current?.getAvailablePictureSizesAsync()) ?? []));
    } catch {
      // sem lista de tamanhos: segue com o padrão do aparelho
    }
  }

  async function tirar() {
    setError("");
    try {
      const r = await camera.current?.takePictureAsync({ base64: true, quality: 0.5 });
      if (r?.base64) setFoto({ uri: r.uri, base64: r.base64 });
    } catch {
      setError("Não foi possível tirar a foto. Tente de novo.");
    }
  }

  async function enviar() {
    if (!foto) return;
    setError("");
    setLoading(true);
    try {
      await api("/api/me/foto", { body: { jpegBase64: foto.base64, consentimento: true } });
      await refresh();
      router.replace("/loja");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível enviar a foto");
    } finally {
      setLoading(false);
    }
  }

  if (!permission) return <Screen><Sub>Carregando…</Sub></Screen>;

  if (!permission.granted) {
    return (
      <Screen style={{ justifyContent: "center", gap: 16 }}>
        <Sub>Para usar a loja, o app precisa da câmera para tirar uma foto do seu rosto.</Sub>
        <Btn title="Permitir câmera" onPress={requestPermission} />
        <Btn title="Agora não" kind="ghost" onPress={() => router.replace("/escolha")} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingVertical: 24 }}>
        <View>
          <H1>Sua foto</H1>
          <Sub>
            Para usar a loja, tire uma foto do seu rosto. É por ela que o caixa reconhece você na hora de pagar.
            Fique de frente, em lugar claro, sem boné nem óculos escuros.
          </Sub>
        </View>
        <View style={{ aspectRatio: 3 / 4, borderRadius: 20, overflow: "hidden", backgroundColor: C.verniz2 }}>
          {foto ? (
            <Image source={{ uri: foto.uri }} style={{ flex: 1 }} contentFit="cover" />
          ) : (
            <CameraView
              ref={camera} style={{ flex: 1 }} facing="front" pictureSize={tamanho} onCameraReady={cameraPronta}
            />
          )}
        </View>
        {foto ? (
          <Btn title="Tirar outra" kind="ghost" onPress={() => setFoto(null)} />
        ) : (
          <Btn title="Tirar foto" onPress={tirar} />
        )}
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: autorizo }}
          onPress={() => setAutorizo((a) => !a)}
          style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}
        >
          <View
            style={{
              width: 24, height: 24, borderRadius: 6, borderWidth: 1.5,
              borderColor: autorizo ? C.jato : C.linha, backgroundColor: autorizo ? C.jato : "transparent",
            }}
          />
          <Text style={{ fontFamily: F.body, fontSize: 15, color: C.cromo, flex: 1 }}>
            Autorizo o uso da imagem do meu rosto para me reconhecer no caixa da loja de conveniência.
          </Text>
        </Pressable>
        <ErrText>{error}</ErrText>
        <Btn title="Enviar foto" onPress={enviar} loading={loading} disabled={!foto || !autorizo} />
        <Btn title="Agora não" kind="ghost" onPress={() => router.replace("/escolha")} />
      </ScrollView>
    </Screen>
  );
}

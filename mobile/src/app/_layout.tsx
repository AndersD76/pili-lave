import { Sora_700Bold, Sora_800ExtraBold, useFonts } from "@expo-google-fonts/sora";
import { PublicSans_400Regular, PublicSans_600SemiBold } from "@expo-google-fonts/public-sans";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { SessionProvider } from "@/lib/session";
import { C } from "@/theme";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded] = useFonts({
    Sora_700Bold, Sora_800ExtraBold, PublicSans_400Regular, PublicSans_600SemiBold,
  });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  return (
    <SessionProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: C.verniz },
          headerTintColor: C.cromo,
          headerTitleStyle: { fontFamily: "Sora_700Bold" },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: C.verniz },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="otp" options={{ title: "Código" }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="veiculo-novo" options={{ title: "Novo veículo", presentation: "modal" }} />
        <Stack.Screen name="nova-lavagem" options={{ title: "Nova lavagem" }} />
        <Stack.Screen name="recarga" options={{ title: "Adicionar saldo" }} />
        <Stack.Screen name="voucher/[id]" options={{ title: "Voucher" }} />
        <Stack.Screen name="scanner" options={{ title: "Escanear voucher" }} />
      </Stack>
    </SessionProvider>
  );
}

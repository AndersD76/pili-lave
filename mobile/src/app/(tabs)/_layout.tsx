import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { useSession } from "@/lib/session";
import { C } from "@/theme";

export default function TabsLayout() {
  const { ready, me } = useSession();
  if (ready && !me) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: C.verniz },
        headerTintColor: C.cromo,
        headerTitleStyle: { fontFamily: "Sora_700Bold" },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: C.verniz2, borderTopColor: C.linha },
        tabBarActiveTintColor: C.jato,
        tabBarInactiveTintColor: C.aco,
        tabBarLabelStyle: { fontFamily: "PublicSans_600SemiBold", fontSize: 11 },
        sceneStyle: { backgroundColor: C.verniz },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Início",
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="carteira"
        options={{
          title: "Carteira",
          tabBarIcon: ({ color, size }) => <Ionicons name="wallet" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="historico"
        options={{
          title: "Histórico",
          tabBarIcon: ({ color, size }) => <Ionicons name="time" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="perfil"
        options={{
          title: "Perfil",
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

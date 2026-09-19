import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { useSession } from "@/lib/session";
import { C } from "@/theme";

export default function TabsLayout() {
  const { ready, me } = useSession();
  if (ready && !me) return <Redirect href="/login" />;

  // Cada capacidade (lavador / comissão-aluguel) é independente — dá pra
  // ter as duas abas ao mesmo tempo se a pessoa tiver aprovação pras duas.
  const temMinhaMaquina = me?.role === "LAVADOR" || me?.role === "ADMIN"
    || (me?.solicitacoes ?? []).some((s) => s.tipo === "LAVADOR" && s.status === "APROVADA");
  const temComissoes = (me?.solicitacoes ?? []).some(
    (s) => s.tipo !== "LAVADOR" && s.status === "APROVADA"
  );

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
        name="unidades"
        options={{
          title: "Unidades",
          tabBarIcon: ({ color, size }) => <Ionicons name="location" size={size} color={color} />,
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
        name="planos"
        options={{
          title: "Planos",
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="minha-maquina"
        options={{
          title: "Minha Máquina",
          href: temMinhaMaquina ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="build" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="minhas-comissoes"
        options={{
          title: "Comissões",
          href: temComissoes ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="cash" size={size} color={color} />,
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

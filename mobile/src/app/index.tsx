import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "@/lib/session";
import { C } from "@/theme";

export default function Index() {
  const { ready, me } = useSession();
  if (!ready)
    return (
      <View style={{ flex: 1, backgroundColor: C.verniz, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={C.jato} />
      </View>
    );
  return me ? <Redirect href="/(tabs)" /> : <Redirect href="/login" />;
}

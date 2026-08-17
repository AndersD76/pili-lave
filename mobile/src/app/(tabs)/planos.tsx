import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { Card, Screen } from "@/ui";
import { C, F } from "@/theme";

export default function Planos() {
  return (
    <Screen>
      <View style={{ marginTop: 16, gap: 16 }}>
        <Card style={{ backgroundColor: C.verniz3 }}>
          <Text style={{ fontFamily: F.displayX, fontSize: 22, color: C.cromo }}>
            Economize com planos mensais
          </Text>
          <Text style={{ fontFamily: F.body, fontSize: 15, color: C.acoD, marginTop: 6 }}>
            Lavagens inclusas todo mês
          </Text>
        </Card>

        <Card style={{ alignItems: "center", paddingVertical: 36 }}>
          <Ionicons name="sparkles" size={34} color={C.jato} />
          <Text style={{ fontFamily: F.display, fontSize: 18, color: C.cromo, marginTop: 14 }}>
            Planos em breve
          </Text>
          <Text style={{
            fontFamily: F.body, fontSize: 14, color: C.acoD, marginTop: 8,
            textAlign: "center", lineHeight: 21,
          }}>
            Estamos preparando clubes de assinatura com lavagens inclusas. Avisaremos você no app.
          </Text>
        </Card>
      </View>
    </Screen>
  );
}

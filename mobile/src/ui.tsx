import { ReactNode } from "react";
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { C, F } from "./theme";

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <SafeAreaView style={[s.screen, style]}>{children}</SafeAreaView>;
}

export function H1({ children }: { children: ReactNode }) {
  return <Text style={s.h1}>{children}</Text>;
}

export function Sub({ children }: { children: ReactNode }) {
  return <Text style={s.sub}>{children}</Text>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={s.label}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Btn({
  title, onPress, kind = "primary", disabled, loading,
}: {
  title: string; onPress: () => void; kind?: "primary" | "ghost" | "danger";
  disabled?: boolean; loading?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn,
        kind === "ghost" && s.btnGhost,
        kind === "danger" && s.btnDanger,
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.85 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={kind === "primary" ? C.verniz : C.cromo} />
      ) : (
        <Text style={[s.btnText, kind !== "primary" && { color: C.cromo }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor={C.aco} {...props} style={[s.input, props.style]} />;
}

export function ErrText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <Text style={s.err}>{String(children)}</Text>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.verniz, paddingHorizontal: 20 },
  h1: { fontFamily: F.displayX, fontSize: 28, color: C.cromo, letterSpacing: -0.3 },
  sub: { fontFamily: F.body, fontSize: 15, color: C.acoD, marginTop: 4 },
  label: {
    fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1, textTransform: "uppercase",
    color: C.acoD, marginBottom: 8,
  },
  card: {
    backgroundColor: C.verniz2, borderRadius: 20, borderWidth: 1, borderColor: C.linha, padding: 18,
  },
  btn: {
    height: 56, borderRadius: 999, backgroundColor: C.jato,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 28,
  },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.linha },
  btnDanger: { backgroundColor: C.erro },
  btnText: { fontFamily: F.bodyBold, fontSize: 17, color: C.verniz },
  input: {
    backgroundColor: C.verniz2, borderWidth: 1, borderColor: C.linha, borderRadius: 14,
    color: C.cromo, fontFamily: F.body, fontSize: 17, paddingHorizontal: 16, paddingVertical: 14,
  },
  err: { fontFamily: F.body, color: C.erro, fontSize: 14, marginTop: 8 },
});

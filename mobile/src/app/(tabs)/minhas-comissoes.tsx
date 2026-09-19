import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { api, type MaquinaParceiro } from "@/lib/api";
import { Card, Label, Screen, Sub } from "@/ui";
import { C, F, money } from "@/theme";

const STATUS_LABEL: Record<MaquinaParceiro["status"], { label: string; color: string }> = {
  FREE: { label: "Livre", color: C.ok },
  WASHING: { label: "Lavando", color: C.jato },
  FAULT: { label: "Em operação", color: C.ok },
  OFFLINE: { label: "Em operação", color: C.ok },
  MAINTENANCE: { label: "Em manutenção", color: C.atencao },
};

const NOME_TIPO: Record<number, string> = { 1: "Tipo 1", 2: "Tipo 2", 3: "Tipo 3", 4: "Tipo 4" };

type Modo = "hoje" | "periodo" | "acerto";

/** Date -> "AAAA-MM-DD" no fuso local (evita virar o dia errado por UTC). */
function paraISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}
function fmtBR(d: Date): string {
  return d.toLocaleDateString("pt-BR");
}

/**
 * Painel do parceiro (Comissão 1/2, Aluguel) — igual em espírito ao do
 * lavador, mas SEM nenhum destaque de falha/status técnico: o parceiro só
 * acompanha o relatório financeiro das máquinas em que tem % vinculado, sem
 * receber notificação nenhuma de falha (essa é exclusiva do lavador).
 */
export default function MinhasComissoes() {
  const [maquinas, setMaquinas] = useState<MaquinaParceiro[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [modo, setModo] = useState<Modo>("hoje");
  const [de, setDe] = useState<Date>(new Date());
  const [ate, setAte] = useState<Date>(new Date());
  const [mostrarPicker, setMostrarPicker] = useState<"de" | "ate" | null>(null);

  const load = useCallback(async (m: Modo, deVal: Date, ateVal: Date) => {
    try {
      let qs = "";
      if (m === "acerto") qs = "?desde=acerto";
      else if (m === "periodo") qs = `?de=${paraISO(deVal)}&ate=${paraISO(ateVal)}`;
      const r = await api<{ maquinas: MaquinaParceiro[] }>(`/api/parceiro/painel${qs}`);
      setMaquinas(r.maquinas);
    } catch {
      /* mantém o que já tinha na tela */
    }
    setLoaded(true);
  }, []);

  useFocusEffect(useCallback(() => { load(modo, de, ate); }, [load, modo, de, ate]));

  async function onRefresh() {
    setRefreshing(true);
    await load(modo, de, ate);
    setRefreshing(false);
  }

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 32, gap: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.jato} />}
      >
        <Text style={{ fontFamily: F.displayX, fontSize: 24, color: C.cromo }}>Minhas Comissões</Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {([
            { k: "hoje", label: "Hoje" },
            { k: "periodo", label: "Escolher período" },
            { k: "acerto", label: "Não acertado ainda" },
          ] as { k: Modo; label: string }[]).map((op) => {
            const sel = modo === op.k;
            return (
              <Pressable
                key={op.k}
                onPress={() => { setModo(op.k); load(op.k, de, ate); }}
                style={{
                  borderWidth: 1.5, borderColor: sel ? C.jato : C.linha,
                  backgroundColor: sel ? "rgba(37,207,222,0.12)" : "transparent",
                  borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
                }}
              >
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.cromo }}>{op.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {modo === "periodo" && (
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            <Pressable
              onPress={() => setMostrarPicker("de")}
              style={{ flex: 1, borderWidth: 1, borderColor: C.linha, borderRadius: 10, padding: 12 }}
            >
              <Text style={{ fontFamily: F.body, fontSize: 13, color: C.acoD }}>De</Text>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.cromo }}>{fmtBR(de)}</Text>
            </Pressable>
            <Pressable
              onPress={() => setMostrarPicker("ate")}
              style={{ flex: 1, borderWidth: 1, borderColor: C.linha, borderRadius: 10, padding: 12 }}
            >
              <Text style={{ fontFamily: F.body, fontSize: 13, color: C.acoD }}>Até</Text>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.cromo }}>{fmtBR(ate)}</Text>
            </Pressable>
            <Pressable
              onPress={() => load("periodo", de, ate)}
              style={{ backgroundColor: C.jato, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 16 }}
            >
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: "#fff" }}>Ver</Text>
            </Pressable>
          </View>
        )}
        {mostrarPicker && (
          <DateTimePicker
            value={mostrarPicker === "de" ? de : ate}
            mode="date"
            display={Platform.OS === "ios" ? "inline" : "default"}
            maximumDate={new Date()}
            onChange={(_, escolhida) => {
              if (Platform.OS !== "ios") setMostrarPicker(null);
              if (!escolhida) return;
              if (mostrarPicker === "de") setDe(escolhida); else setAte(escolhida);
            }}
          />
        )}
        {Platform.OS === "ios" && mostrarPicker && (
          <Pressable
            onPress={() => setMostrarPicker(null)}
            style={{ backgroundColor: C.jato, borderRadius: 10, paddingVertical: 10, alignItems: "center" }}
          >
            <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: "#fff" }}>Pronto</Text>
          </Pressable>
        )}

        {loaded && maquinas.length === 0 && (
          <Card>
            <Sub>Nenhuma máquina vinculada ao seu usuário ainda. Fale com o administrador.</Sub>
          </Card>
        )}

        {maquinas.map((m) => {
          const sit = STATUS_LABEL[m.status];
          return (
            <Card key={m.id}>
              <Label>{m.unidade.cidade} — {m.unidade.rua} · Máquina {m.numero}</Label>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: sit.color }} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: sit.color }}>{sit.label}</Text>
                <Text style={{ fontFamily: F.body, fontSize: 12, color: C.acoD }}>· {m.tipoLabel}</Text>
              </View>

              <View style={{ height: 1, backgroundColor: C.linha, marginVertical: 12 }} />

              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontFamily: F.body, fontSize: 14, color: C.acoD }}>Total no período</Text>
                <Text style={{ fontFamily: F.displayX, fontSize: 20, color: C.cromo }}>{money(m.totalGeralCents)}</Text>
              </View>

              <View style={{ marginTop: 12, gap: 4 }}>
                <View style={{ flexDirection: "row", paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: C.linha }}>
                  <Text style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 11, color: C.acoD }}>TIPO</Text>
                  <Text style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 11, color: C.acoD, textAlign: "right" }}>PRESENCIAL</Text>
                  <Text style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 11, color: C.acoD, textAlign: "right" }}>APP</Text>
                </View>
                {m.porTipo.map((t) => (
                  <View key={t.programId} style={{ flexDirection: "row", paddingVertical: 6, alignItems: "center" }}>
                    <Text style={{ flex: 1, fontFamily: F.body, fontSize: 13, color: C.cromo }}>{NOME_TIPO[t.programId]}</Text>
                    <View style={{ flex: 1, alignItems: "flex-end" }}>
                      <Text style={{ fontFamily: F.body, fontSize: 12, color: C.acoD }}>{t.presencial.lavagens}x</Text>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.cromo }}>{money(t.presencial.valorCents)}</Text>
                    </View>
                    <View style={{ flex: 1, alignItems: "flex-end" }}>
                      <Text style={{ fontFamily: F.body, fontSize: 12, color: C.acoD }}>{t.app.lavagens}x</Text>
                      <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.cromo }}>{money(t.app.valorCents)}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={{ height: 1, backgroundColor: C.linha, marginVertical: 12 }} />
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.cromo }}>Sua participação</Text>
                <Text style={{ fontFamily: F.displayX, fontSize: 22, color: C.ok }}>{money(m.suaParticipacaoCents)}</Text>
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

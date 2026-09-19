import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { api, type MaquinaLavador } from "@/lib/api";
import { Card, ErrText, Label, Screen, Sub } from "@/ui";
import { C, F, money } from "@/theme";

const STATUS_LABEL: Record<MaquinaLavador["status"], { label: string; color: string }> = {
  FREE: { label: "Livre", color: C.ok },
  WASHING: { label: "Lavando", color: C.jato },
  FAULT: { label: "EM FALHA", color: C.erro },
  OFFLINE: { label: "OFFLINE", color: C.erro },
  MAINTENANCE: { label: "Em manutenção", color: C.atencao },
};

const NOME_TIPO: Record<number, string> = { 1: "Tipo 1", 2: "Tipo 2", 3: "Tipo 3", 4: "Tipo 4" };

/** "DD/MM/AAAA" -> "AAAA-MM-DD" (o que a API espera); null se não bater o formato. */
function paraISO(txt: string): string | null {
  const m = txt.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

type Modo = "hoje" | "periodo" | "acerto";

export default function MinhaMaquina() {
  const [maquinas, setMaquinas] = useState<MaquinaLavador[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [modo, setModo] = useState<Modo>("hoje");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [erroPeriodo, setErroPeriodo] = useState("");

  const load = useCallback(async (m: Modo, deTxt: string, ateTxt: string) => {
    try {
      let qs = "";
      if (m === "acerto") qs = "?desde=acerto";
      else if (m === "periodo") {
        const deISO = paraISO(deTxt);
        const ateISO = paraISO(ateTxt);
        if (!deISO || !ateISO) { setErroPeriodo("Use o formato DD/MM/AAAA nas duas datas."); return; }
        setErroPeriodo("");
        qs = `?de=${deISO}&ate=${ateISO}`;
      }
      const r = await api<{ maquinas: MaquinaLavador[] }>(`/api/lavador/painel${qs}`);
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
        <Text style={{ fontFamily: F.displayX, fontSize: 24, color: C.cromo }}>Minha Máquina</Text>

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
            <TextInput
              value={de}
              onChangeText={setDe}
              placeholder="De: DD/MM/AAAA"
              placeholderTextColor={C.acoD}
              style={{ flex: 1, borderWidth: 1, borderColor: C.linha, borderRadius: 10, padding: 10, color: C.cromo, fontFamily: F.body }}
            />
            <TextInput
              value={ate}
              onChangeText={setAte}
              placeholder="Até: DD/MM/AAAA"
              placeholderTextColor={C.acoD}
              style={{ flex: 1, borderWidth: 1, borderColor: C.linha, borderRadius: 10, padding: 10, color: C.cromo, fontFamily: F.body }}
            />
            <Pressable
              onPress={() => load("periodo", de, ate)}
              style={{ backgroundColor: C.jato, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 }}
            >
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: "#fff" }}>Ver</Text>
            </Pressable>
          </View>
        )}
        {!!erroPeriodo && <ErrText>{erroPeriodo}</ErrText>}

        {loaded && maquinas.length === 0 && (
          <Card>
            <Sub>Nenhuma máquina vinculada ao seu usuário ainda. Fale com o administrador.</Sub>
          </Card>
        )}

        {maquinas.map((m) => {
          const sit = STATUS_LABEL[m.status];
          return (
            <Card
              key={m.id}
              style={m.emFalha || m.status === "OFFLINE" ? { borderColor: C.erro, borderWidth: 2 } : undefined}
            >
              <Label>{m.unidade.cidade} — {m.unidade.rua} · Máquina {m.numero}</Label>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: sit.color }} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: sit.color }}>{sit.label}</Text>
              </View>
              {(m.emFalha || m.status === "OFFLINE") && (
                <Sub>
                  {m.emFalha
                    ? "A máquina reportou falha — verifique o display no local."
                    : "Sem comunicação com a máquina — confira a internet/energia dela."}
                </Sub>
              )}

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
                  <View key={t.programId} style={{ flexDirection: "row", paddingVertical: 6 }}>
                    <Text style={{ flex: 1, fontFamily: F.body, fontSize: 13, color: C.cromo }}>{NOME_TIPO[t.programId]}</Text>
                    <Text style={{ flex: 1, fontFamily: F.body, fontSize: 12, color: C.acoD, textAlign: "right" }}>
                      {t.presencial.lavagens}x · {money(t.presencial.valorCents)}
                    </Text>
                    <Text style={{ flex: 1, fontFamily: F.body, fontSize: 12, color: C.acoD, textAlign: "right" }}>
                      {t.app.lavagens}x · {money(t.app.valorCents)}
                    </Text>
                  </View>
                ))}
              </View>
              <Sub>
                Sua participação % ainda não foi definida — assim que for, o valor que você recebe aparece aqui.
              </Sub>
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

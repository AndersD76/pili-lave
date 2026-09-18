import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { api, type MaquinaLavador } from "@/lib/api";
import { Card, Label, Screen, Sub } from "@/ui";
import { C, F, money } from "@/theme";

const STATUS_LABEL: Record<MaquinaLavador["status"], { label: string; color: string }> = {
  FREE: { label: "Livre", color: C.ok },
  WASHING: { label: "Lavando", color: C.jato },
  FAULT: { label: "EM FALHA", color: C.erro },
  OFFLINE: { label: "OFFLINE", color: C.erro },
  MAINTENANCE: { label: "Em manutenção", color: C.atencao },
};

function LinhaPeriodo({ titulo, lavagens, faturamentoCents }: { titulo: string; lavagens: number; faturamentoCents: number }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 }}>
      <Text style={{ fontFamily: F.body, fontSize: 14, color: C.acoD }}>{titulo}</Text>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.cromo }}>
        {lavagens} lavagem{lavagens === 1 ? "" : "s"} · {money(faturamentoCents)}
      </Text>
    </View>
  );
}

export default function MinhaMaquina() {
  const [maquinas, setMaquinas] = useState<MaquinaLavador[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ maquinas: MaquinaLavador[] }>("/api/lavador/painel");
      setMaquinas(r.maquinas);
    } catch {
      /* mantém o que já tinha na tela */
    }
    setLoaded(true);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onRefresh() {
    setRefreshing(true);
    await load();
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

              <LinhaPeriodo titulo="Hoje" lavagens={m.hoje.lavagens} faturamentoCents={m.hoje.faturamentoCents} />
              <LinhaPeriodo titulo="Últimos 7 dias" lavagens={m.semana.lavagens} faturamentoCents={m.semana.faturamentoCents} />
              <LinhaPeriodo titulo="Últimos 30 dias" lavagens={m.mes.lavagens} faturamentoCents={m.mes.faturamentoCents} />
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

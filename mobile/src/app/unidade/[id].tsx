import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { api, type Machine, type Station } from "@/lib/api";
import { Btn, Card, Label, Screen, Sub } from "@/ui";
import { C, F } from "@/theme";

const SITUACAO = {
  ABERTO: { label: "Aberto", color: C.ok },
  OCUPADO: { label: "Ocupado", color: C.atencao },
  MANUTENCAO: { label: "Manutenção", color: C.erro },
  INATIVO: { label: "Inativa", color: C.aco },
} as const;

function mmss(totalSec: number): string {
  const s = Math.max(0, totalSec);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function machineInfo(m: Machine, elapsedSec: number): { label: string; color: string } {
  if (m.status === "FREE") return { label: "Livre", color: C.ok };
  if (m.status === "WASHING") {
    return { label: `Lavando ${mmss((m.remainingSec ?? 0) - elapsedSec)}`, color: C.atencao };
  }
  const map: Record<string, string> = { FAULT: "Falha", OFFLINE: "Offline", MAINTENANCE: "Manutenção" };
  return { label: map[m.status] ?? m.status, color: C.erro };
}

export default function UnidadeDetalhe() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [station, setStation] = useState<Station | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const r = await api<{ stations: Station[] }>("/api/stations", { auth: false });
      setStation(r.stations.find((s) => String(s.id) === String(id)) ?? null);
      setLoadedAt(Date.now());
    } catch {
      /* mantém o estado atual */
    }
    setLoaded(true);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const hasWashing = !!station?.machines.some((m) => m.status === "WASHING" && m.remainingSec > 0);
  useEffect(() => {
    if (!hasWashing) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasWashing]);

  if (!station) {
    return (
      <Screen>
        <View style={{ marginTop: 24 }}>
          <Sub>{loaded ? "Unidade não encontrada." : "Carregando…"}</Sub>
        </View>
      </Screen>
    );
  }

  const sit = SITUACAO[station.situacao] ?? SITUACAO.INATIVO;
  const elapsedSec = Math.floor((now - loadedAt) / 1000);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 20, gap: 20 }}>
        <View>
          <Text style={{ fontFamily: F.displayX, fontSize: 24, color: C.cromo }}>{station.name}</Text>
          <Sub>{station.address} · {station.city}/{station.state}</Sub>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: sit.color }} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: sit.color }}>{sit.label}</Text>
          </View>
        </View>

        <View>
          <Label>Máquinas</Label>
          {station.machines.length === 0 ? (
            <Sub>Sem máquinas cadastradas.</Sub>
          ) : (
            <Card style={{ paddingVertical: 6 }}>
              {station.machines.map((m, i) => {
                const info = machineInfo(m, elapsedSec);
                return (
                  <View
                    key={m.id}
                    style={{
                      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                      paddingVertical: 13,
                      borderBottomWidth: i < station.machines.length - 1 ? 1 : 0,
                      borderBottomColor: "rgba(37,207,222,0.06)",
                    }}
                  >
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.cromo }}>{m.name}</Text>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: info.color, fontVariant: ["tabular-nums"] }}>
                      {info.label}
                    </Text>
                  </View>
                );
              })}
            </Card>
          )}
        </View>

        <View>
          <Label>Câmera ao vivo</Label>
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Ionicons name="videocam" size={26} color={C.aco} />
            <Text style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: C.acoD }}>
              Câmera em manutenção — disponível em breve.
            </Text>
          </Card>
        </View>

        <Btn title="Reservar lavagem" onPress={() => router.push("/nova-lavagem")} />
      </ScrollView>
    </Screen>
  );
}

import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { api, API_URL, getToken, type Machine, type Station } from "@/lib/api";

type AoVivoFrame = { id: string; at: string; plate: string | null; clientName: string | null } | null;
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
  const [frameUri, setFrameUri] = useState<string | null>(null);
  const [semLavagem, setSemLavagem] = useState(false);

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

  // Câmera ao vivo: só existe enquanto o cliente tem lavagem em andamento
  // (o backend barra com 403 fora disso). Poll leve nos metadados; só baixa
  // o JPEG de novo quando o id da captura muda.
  useEffect(() => {
    let frameIdAtual: string | null = null;
    let cancelado = false;
    const tick = async () => {
      try {
        const r = await api<{ frame: AoVivoFrame }>("/api/lpr/ao-vivo");
        if (cancelado) return;
        setSemLavagem(false);
        if (!r.frame || r.frame.id === frameIdAtual) return;
        frameIdAtual = r.frame.id;
        const token = await getToken();
        const res = await fetch(`${API_URL}/api/lpr/ao-vivo?img=${encodeURIComponent(r.frame.id)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok || cancelado) return;
        const blob = await res.blob();
        const base64: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve((reader.result as string).split(",")[1] ?? "");
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        if (!cancelado) setFrameUri(`data:image/jpeg;base64,${base64}`);
      } catch {
        if (!cancelado) setSemLavagem(true);
      }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => { cancelado = true; clearInterval(t); };
  }, []);

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
          {frameUri ? (
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <Image source={{ uri: frameUri }} style={{ width: "100%", aspectRatio: 4 / 3 }} resizeMode="cover" />
            </Card>
          ) : (
            <Card style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <Ionicons name="videocam" size={26} color={C.aco} />
              <Text style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: C.acoD }}>
                {semLavagem
                  ? "Disponível quando sua lavagem estiver em andamento."
                  : "Aguardando imagem da câmera…"}
              </Text>
            </Card>
          )}
        </View>

        <Btn
          title="Reservar lavagem"
          onPress={() => router.push({ pathname: "/nova-lavagem", params: { stationId: station.id, stationName: station.name } })}
        />
        {(() => {
          const vacuumMachine = station.machines.find((m) => m.vacuumEnabled);
          if (!vacuumMachine) return null;
          return (
            <Btn
              title={`${vacuumMachine.vacuumDurationMin} min de aspirador de pó`}
              onPress={() => router.push({ pathname: "/aspirador", params: { machineId: vacuumMachine.id } })}
            />
          );
        })()}
      </ScrollView>
    </Screen>
  );
}

import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { api, type Station } from "@/lib/api";
import { Input, Screen } from "@/ui";
import { C, F } from "@/theme";

const SITUACAO = {
  ABERTO: { label: "Aberto", color: C.ok },
  OCUPADO: { label: "Ocupado", color: C.atencao },
  MANUTENCAO: { label: "Manutenção", color: C.erro },
  INATIVO: { label: "Inativa", color: C.aco },
} as const;

function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export default function Unidades() {
  const [stations, setStations] = useState<Station[]>([]);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ stations: Station[] }>("/api/stations", { auth: false });
      setStations(r.stations);
    } catch {
      /* mantém a lista atual */
    }
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? stations.filter((s) =>
        [s.name, s.city, s.address, s.state].some((v) => (v ?? "").toLowerCase().includes(q))
      )
    : stations;

  return (
    <Screen>
      <View style={{ marginTop: 16, gap: 12 }}>
        <Input
          placeholder="Buscar por nome, cidade ou endereço"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
        />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
          {(Object.keys(SITUACAO) as (keyof typeof SITUACAO)[]).map((k) => (
            <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Dot color={SITUACAO[k].color} size={8} />
              <Text style={{ fontFamily: F.body, fontSize: 12, color: C.acoD }}>{SITUACAO[k].label}</Text>
            </View>
          ))}
        </View>
      </View>

      <FlatList
        style={{ marginTop: 16 }}
        data={filtered}
        keyExtractor={(s) => String(s.id)}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.jato}
            colors={[C.jato]}
            progressBackgroundColor={C.verniz2}
          />
        }
        ListEmptyComponent={
          loaded ? (
            <Text style={{ fontFamily: F.body, color: C.acoD, marginTop: 8 }}>
              {q ? "Nenhuma unidade encontrada." : "Nenhuma unidade disponível no momento."}
            </Text>
          ) : null
        }
        renderItem={({ item }) => {
          const sit = SITUACAO[item.situacao] ?? SITUACAO.INATIVO;
          const remSec = item.machines.reduce((max, m) => Math.max(max, m.remainingSec ?? 0), 0);
          return (
            <Pressable
              onPress={() => router.push(`/unidade/${item.id}`)}
              style={({ pressed }) => [{
                backgroundColor: C.verniz2, borderWidth: 1, borderColor: C.linha,
                borderRadius: 20, padding: 18, marginBottom: 10, opacity: pressed ? 0.8 : 1,
                flexDirection: "row", alignItems: "center", gap: 12,
              }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.display, fontSize: 17, color: C.cromo }}>{item.name}</Text>
                <Text style={{ fontFamily: F.body, fontSize: 13, color: C.acoD, marginTop: 3 }}>
                  {item.address} · {item.city}/{item.state}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Dot color={sit.color} />
                {item.situacao === "OCUPADO" && remSec > 0 && (
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.atencao, fontVariant: ["tabular-nums"] }}>
                    ~{Math.ceil(remSec / 60)}min
                  </Text>
                )}
              </View>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

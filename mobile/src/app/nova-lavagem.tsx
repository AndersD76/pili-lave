import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { api, ApiError, type Program, type Vehicle, type WalletResp } from "@/lib/api";
import { Btn, Card, ErrText, Label, Screen, Sub } from "@/ui";
import { C, F, fmtPlate, money } from "@/theme";

export default function NovaLavagem() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [available, setAvailable] = useState<number | null>(null);
  const [programId, setProgramId] = useState<number | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  /** availableCents retornado pelo 402 (saldo disponível insuficiente). */
  const [insufficient, setInsufficient] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      api<Program[]>("/api/programs", { auth: false }).then(setPrograms).catch(() => {});
      api<Vehicle[]>("/api/vehicles")
        .then((v) => {
          setVehicles(v);
          setVehicleId((cur) => {
            if (cur && v.some((x) => x.id === cur)) return cur;
            return v.length === 1 ? v[0].id : null;
          });
        })
        .catch(() => setVehicles((cur) => cur ?? []));
      api<WalletResp>("/api/wallet").then((w) => setAvailable(w.availableCents)).catch(() => {});
    }, [])
  );

  // Pré-seleciona a lavagem padrão do veículo quando nenhum programa foi escolhido ainda.
  useEffect(() => {
    if (programId != null) return;
    const v = vehicles?.find((x) => x.id === vehicleId);
    if (v?.defaultProgramId != null) setProgramId(v.defaultProgramId);
  }, [programId, vehicleId, vehicles]);

  const selected = programs.find((p) => p.id === programId);

  function pickVehicle(v: Vehicle) {
    setVehicleId(v.id);
    if (v.defaultProgramId != null) setProgramId(v.defaultProgramId);
  }

  async function reservar() {
    if (!selected || !vehicleId) return;
    setError("");
    setInsufficient(null);
    setLoading(true);
    try {
      await api("/api/reservations", { body: { programId: selected.id, vehicleId } });
      Alert.alert(
        "Reserva feita!",
        "Válida por 1 hora. Aproxime o carro da câmera e entre no verde.",
        [{ text: "OK", onPress: () => router.replace("/(tabs)") }]
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        const d = e.data as { availableCents?: number } | null;
        setInsufficient(d?.availableCents ?? available ?? 0);
      } else if (e instanceof ApiError && e.status === 409) {
        setError("Este veículo já tem reserva ativa.");
      } else {
        setError(e instanceof Error ? e.message : "Não foi possível reservar");
      }
    } finally {
      setLoading(false);
    }
  }

  const semVeiculo = vehicles !== null && vehicles.length === 0;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 20, gap: 20 }}>
        {semVeiculo && (
          <Card>
            <Text style={{ fontFamily: F.display, fontSize: 18, color: C.cromo }}>
              Cadastre seu veículo
            </Text>
            <Text style={{ fontFamily: F.body, fontSize: 14, color: C.acoD, marginTop: 6 }}>
              A reserva é por placa — precisamos saber qual carro vai entrar.
            </Text>
            <View style={{ marginTop: 14 }}>
              <Btn title="Adicionar veículo" onPress={() => router.push("/veiculo-novo")} />
            </View>
          </Card>
        )}

        {!semVeiculo && vehicles !== null && (
          <View>
            <Label>Veículo</Label>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {vehicles.map((v) => {
                const sel = vehicleId === v.id;
                return (
                  <Pressable
                    key={v.id}
                    onPress={() => pickVehicle(v)}
                    style={{
                      borderWidth: 1.5, borderColor: sel ? C.jato : C.linha,
                      backgroundColor: sel ? "rgba(37,207,222,0.12)" : "transparent",
                      borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9,
                    }}
                  >
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.cromo, letterSpacing: 2 }}>
                      {fmtPlate(v.plate)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        <View>
          <Label>Tipo de lavagem</Label>
          <View style={{ gap: 10 }}>
            {programs.map((p) => {
              const sel = programId === p.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setProgramId(p.id)}
                  style={{
                    backgroundColor: sel ? "rgba(37,207,222,0.12)" : C.verniz2,
                    borderWidth: 1.5, borderColor: sel ? C.jato : C.linha,
                    borderRadius: 18, padding: 18,
                    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                  }}
                >
                  <Text style={{ fontFamily: F.display, fontSize: 18, color: C.cromo }}>
                    {p.id} · {p.nome}
                  </Text>
                  <Text style={{ fontFamily: F.displayX, fontSize: 18, color: sel ? C.jato : C.cromo, fontVariant: ["tabular-nums"] }}>
                    {money(p.precoCents)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ gap: 10 }}>
          {available != null && <Sub>Saldo disponível: {money(available)}</Sub>}
          {insufficient != null ? (
            <>
              <ErrText>Saldo disponível insuficiente ({money(insufficient)}).</ErrText>
              <Btn title="Adicionar saldo" onPress={() => router.push("/recarga")} />
            </>
          ) : (
            <Btn
              title={
                !selected ? "Escolha o tipo"
                : !vehicleId ? "Escolha o veículo"
                : `Reservar por ${money(selected.precoCents)}`
              }
              onPress={reservar}
              loading={loading}
              disabled={!selected || !vehicleId}
            />
          )}
          <ErrText>{error}</ErrText>
          <Sub>O valor fica reservado e só é cobrado quando a lavagem acontece.</Sub>
        </View>
      </ScrollView>
    </Screen>
  );
}

import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { api, type Order, type Program, type Vehicle } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Btn, ErrText, Label, Screen, Sub } from "@/ui";
import { C, F, fmtPlate, money } from "@/theme";

export default function NovaLavagem() {
  const { me, refresh } = useSession();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [programId, setProgramId] = useState<number | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Program[]>("/api/programs", { auth: false }).then(setPrograms).catch(() => {});
    api<Vehicle[]>("/api/vehicles").then((v) => {
      setVehicles(v);
      if (v.length === 1) setVehicleId(v[0].id);
    }).catch(() => {});
  }, []);

  const selected = programs.find((p) => p.id === programId);
  const saldo = me?.walletCents ?? 0;
  const falta = selected ? selected.precoCents - saldo : 0;

  async function comprar() {
    if (!selected) return;
    setError("");
    setLoading(true);
    try {
      const order = await api<Order>("/api/orders", {
        body: { programId: selected.id, vehicleId: vehicleId ?? undefined },
      });
      await refresh();
      router.replace({ pathname: "/voucher/[id]", params: { id: order.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 20, gap: 20 }}>
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

        {vehicles.length > 0 && (
          <View>
            <Label>Veículo (opcional)</Label>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {vehicles.map((v) => {
                const sel = vehicleId === v.id;
                return (
                  <Pressable
                    key={v.id}
                    onPress={() => setVehicleId(sel ? null : v.id)}
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

        <View style={{ gap: 10 }}>
          <Sub>Saldo: {money(saldo)}</Sub>
          {selected && falta > 0 ? (
            <>
              <ErrText>Saldo insuficiente — faltam {money(falta)}.</ErrText>
              <Btn title="Adicionar saldo" onPress={() => router.push("/recarga")} />
            </>
          ) : (
            <Btn
              title={selected ? `Pagar ${money(selected.precoCents)} com saldo` : "Escolha o tipo"}
              onPress={comprar}
              loading={loading}
              disabled={!selected}
            />
          )}
          <ErrText>{error}</ErrText>
        </View>
      </ScrollView>
    </Screen>
  );
}

import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { api, type Program, type Reservation, type Vehicle, type WalletResp } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Btn, Card, ErrText, Label, Screen, Sub } from "@/ui";
import { C, F, fmtPlate, money } from "@/theme";

const STATUS_ATIVOS: Reservation["status"][] = ["HELD", "ACTIVE", "ENTERED"];

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function mmss(totalSec: number): string {
  const s = Math.max(0, totalSec);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function Home() {
  const { me, refresh } = useSession();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [available, setAvailable] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Modal de lavagem padrão
  const [editVehicle, setEditVehicle] = useState<Vehicle | null>(null);
  const [selProgram, setSelProgram] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  const loadReservation = useCallback(() => {
    api<{ reservations: Reservation[] }>("/api/reservations")
      .then((r) => setReservation(r.reservations.find((x) => STATUS_ATIVOS.includes(x.status)) ?? null))
      .catch(() => {});
  }, []);

  const loadWallet = useCallback(() => {
    api<WalletResp>("/api/wallet").then((w) => setAvailable(w.availableCents)).catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      api<Vehicle[]>("/api/vehicles").then(setVehicles).catch(() => {});
      api<Program[]>("/api/programs", { auth: false }).then(setPrograms).catch(() => {});
      loadWallet();
      loadReservation();
      const t = setInterval(loadReservation, 10000);
      return () => clearInterval(t);
    }, [refresh, loadWallet, loadReservation])
  );

  // Countdown da reserva HELD
  useEffect(() => {
    if (!reservation || reservation.status !== "HELD") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [reservation]);

  function cancelarReserva() {
    if (!reservation) return;
    Alert.alert("Cancelar reserva?", "O valor reservado volta para seu saldo.", [
      { text: "Voltar", style: "cancel" },
      {
        text: "Cancelar reserva",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/api/reservations/${reservation.id}/cancel`, { method: "POST" });
          } catch {
            /* recarrega mesmo assim */
          }
          loadReservation();
          loadWallet();
          refresh();
        },
      },
    ]);
  }

  function abrirModal(v: Vehicle) {
    setModalError("");
    setSelProgram(v.defaultProgramId);
    setEditVehicle(v);
  }

  async function confirmarPadrao() {
    if (!editVehicle || selProgram == null) return;
    setSaving(true);
    setModalError("");
    try {
      await api(`/api/vehicles/${editVehicle.id}`, { method: "PATCH", body: { defaultProgramId: selProgram } });
      setVehicles((vs) => vs.map((v) => (v.id === editVehicle.id ? { ...v, defaultProgramId: selProgram } : v)));
      setEditVehicle(null);
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Não foi possível salvar");
    } finally {
      setSaving(false);
    }
  }

  const restanteSec = reservation
    ? Math.floor((new Date(reservation.expiresAt).getTime() - now) / 1000)
    : 0;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ marginTop: 18, marginBottom: 20 }}>
          <Text style={{ fontFamily: F.displayX, fontSize: 26, color: C.cromo }}>
            PILI LAVE<Text style={{ color: C.pili }}>.</Text>
          </Text>
          {me?.name ? <Sub>Olá, {me.name.split(" ")[0]}</Sub> : null}
        </View>

        {reservation && (
          <Card
            style={{
              marginBottom: 16,
              borderColor: reservation.status === "ACTIVE" ? C.ok : C.jato,
            }}
          >
            {reservation.status === "HELD" && (
              <>
                <Text style={{ fontFamily: F.display, fontSize: 17, color: C.cromo }}>
                  Reserva ativa — válida até {hhmm(reservation.expiresAt)}
                </Text>
                <Text style={{ fontFamily: F.displayX, fontSize: 34, color: C.jato, marginTop: 6, fontVariant: ["tabular-nums"] }}>
                  {mmss(restanteSec)}
                </Text>
              </>
            )}
            {reservation.status === "ACTIVE" && (
              <Text style={{ fontFamily: F.display, fontSize: 17, color: C.ok }}>
                Verde aceso — pode entrar!
              </Text>
            )}
            {reservation.status === "ENTERED" && (
              <Text style={{ fontFamily: F.display, fontSize: 17, color: C.atencao }}>
                Lavando seu carro…
              </Text>
            )}
            <Text style={{ fontFamily: F.body, fontSize: 14, color: C.acoD, marginTop: 6 }}>
              {reservation.program.nome} · {fmtPlate(reservation.vehicle.plate)}
            </Text>
            {reservation.status !== "ENTERED" && (
              <View style={{ marginTop: 14 }}>
                <Btn title="Cancelar reserva" kind="ghost" onPress={cancelarReserva} />
              </View>
            )}
          </Card>
        )}

        <Card>
          <Label>Saldo disponível</Label>
          <Text style={{ fontFamily: F.displayX, fontSize: 38, color: C.cromo, fontVariant: ["tabular-nums"] }}>
            {money(available ?? me?.walletCents ?? 0)}
          </Text>
          <View style={{ marginTop: 14 }}>
            <Btn title="Adicionar saldo" kind="ghost" onPress={() => router.push("/recarga")} />
          </View>
        </Card>

        <View style={{ marginTop: 22 }}>
          <Btn title="Reservar lavagem" onPress={() => router.push("/nova-lavagem")} />
        </View>

        <Card style={{ marginTop: 16, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14 }}>
          <Ionicons name="information-circle" size={20} color={C.jato} />
          <Text style={{ flex: 1, fontFamily: F.body, fontSize: 13, color: C.acoD, lineHeight: 19 }}>
            Defina a lavagem padrão de cada veículo — é ela que vale quando a câmera ler sua placa.
          </Text>
        </Card>

        <View style={{ marginTop: 28 }}>
          <Label>Meus veículos</Label>
          {vehicles.map((v) => {
            const prog = programs.find((p) => p.id === v.defaultProgramId);
            return (
              <Pressable
                key={v.id}
                onPress={() => abrirModal(v)}
                style={({ pressed }) => [{
                  backgroundColor: C.verniz2, borderRadius: 20, borderWidth: 1, borderColor: C.linha,
                  padding: 18, marginBottom: 10, opacity: pressed ? 0.85 : 1,
                }]}
              >
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 21, color: C.cromo, letterSpacing: 4 }}>
                      {fmtPlate(v.plate)}
                    </Text>
                    <Text style={{ fontFamily: F.body, fontSize: 14, color: C.acoD, marginTop: 2 }}>
                      {[v.brand, v.model].filter(Boolean).join(" ") || "Veículo"}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={C.aco} />
                </View>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: prog ? C.jato : C.aco, marginTop: 8 }}>
                  {prog ? `Lavagem padrão: ${prog.nome}` : "Toque para definir a lavagem padrão"}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => router.push("/veiculo-novo")}
            style={({ pressed }) => [{
              flexDirection: "row", alignItems: "center", gap: 10,
              borderWidth: 1, borderColor: C.linha, borderRadius: 20, borderStyle: "dashed",
              padding: 18, opacity: pressed ? 0.7 : 1,
            }]}
          >
            <Ionicons name="add-circle" size={22} color={C.jato} />
            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.cromo }}>Adicionar veículo</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        visible={!!editVehicle}
        transparent
        animationType="fade"
        onRequestClose={() => setEditVehicle(null)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(4,9,11,0.72)", justifyContent: "center", padding: 24 }}>
          <Card>
            <Text style={{ fontFamily: F.display, fontSize: 18, color: C.cromo }}>
              Lavagem padrão de {editVehicle ? fmtPlate(editVehicle.plate) : ""}
            </Text>
            <View style={{ gap: 8, marginTop: 14 }}>
              {programs.map((p) => {
                const sel = selProgram === p.id;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => setSelProgram(p.id)}
                    style={{
                      borderWidth: 1.5, borderColor: sel ? C.jato : C.linha,
                      backgroundColor: sel ? "rgba(37,207,222,0.12)" : "transparent",
                      borderRadius: 14, padding: 14,
                      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                    }}
                  >
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.cromo }}>{p.nome}</Text>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: sel ? C.jato : C.acoD, fontVariant: ["tabular-nums"] }}>
                      {money(p.precoCents)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <ErrText>{modalError}</ErrText>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <View style={{ flex: 1 }}>
                <Btn title="Cancelar" kind="ghost" onPress={() => setEditVehicle(null)} />
              </View>
              <View style={{ flex: 1 }}>
                <Btn title="Confirmar" onPress={confirmarPadrao} loading={saving} disabled={selProgram == null} />
              </View>
            </View>
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}

import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { api, ApiError, type Machine, type Station, type VacuumUse, type WalletResp } from "@/lib/api";
import { Btn, Card, ErrText, Screen, Sub } from "@/ui";
import { C, F, money } from "@/theme";

export default function Aspirador() {
  const { machineId } = useLocalSearchParams<{ machineId: string }>();
  const [machine, setMachine] = useState<Machine | null>(null);
  const [available, setAvailable] = useState<number | null>(null);
  const [use, setUse] = useState<VacuumUse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [insufficient, setInsufficient] = useState<number | null>(null);
  const [restante, setRestante] = useState<number | null>(null);
  const [finalizado, setFinalizado] = useState(false);

  useFocusEffect(
    useCallback(() => {
      api<{ stations: Station[] }>("/api/stations", { auth: false })
        .then(({ stations }) => {
          for (const st of stations) {
            const m = st.machines.find((x) => x.id === machineId);
            if (m) { setMachine(m); break; }
          }
        })
        .catch(() => {});
      api<WalletResp>("/api/wallet").then((w) => setAvailable(w.availableCents)).catch(() => {});
    }, [machineId])
  );

  // Contagem local só pra feedback visual — o tempo real é controlado pelo
  // backend/display via heartbeat. Ao zerar, mostra a finalização na hora
  // (não espera o backend confirmar COMPLETED) e volta pra Home sozinho.
  useEffect(() => {
    if (use?.status !== "ACTIVE" || !use.startedAt) return;
    const durationSec = use.durationSec;
    const tick = () => {
      const decorrido = Math.floor((Date.now() - new Date(use.startedAt!).getTime()) / 1000);
      const r = Math.max(0, durationSec - decorrido);
      setRestante(r);
      if (r <= 0) setFinalizado(true);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [use]);

  useEffect(() => {
    if (!finalizado) return;
    const t = setTimeout(() => router.replace("/(tabs)"), 5000);
    return () => clearTimeout(t);
  }, [finalizado]);

  async function comprar() {
    if (!machineId) return;
    setError(""); setInsufficient(null); setLoading(true);
    try {
      const created = await api<VacuumUse>("/api/vacuum/buy", { body: { machineId } });
      setUse(created);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        const d = e.data as { availableCents?: number } | null;
        setInsufficient(d?.availableCents ?? available ?? 0);
      } else {
        setError(e instanceof Error ? e.message : "Não foi possível comprar");
      }
    } finally {
      setLoading(false);
    }
  }

  async function comecar() {
    if (!use) return;
    setError(""); setLoading(true);
    try {
      const updated = await api<VacuumUse>("/api/vacuum/start", { body: { vacuumUseId: use.id } });
      setUse(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível iniciar");
    } finally {
      setLoading(false);
    }
  }

  if (!machine) {
    return (
      <Screen>
        <View style={{ marginTop: 24 }}>
          <Sub>Carregando…</Sub>
        </View>
      </Screen>
    );
  }

  const precoCents = machine.vacuumPriceCents ?? 0;
  const duracaoMin = machine.vacuumDurationMin ?? 0;

  return (
    <Screen>
      <View style={{ marginTop: 24, gap: 20 }}>
        <Card>
          <Text style={{ fontFamily: F.display, fontSize: 18, color: C.cromo }}>
            Aspirador de pó
          </Text>
          <Text style={{ fontFamily: F.body, fontSize: 14, color: C.acoD, marginTop: 6 }}>
            {duracaoMin} minutos por {money(precoCents)}.
          </Text>
        </Card>

        {!use && (
          <>
            {available != null && <Sub>Saldo disponível: {money(available)}</Sub>}
            {insufficient != null ? (
              <>
                <ErrText>Saldo disponível insuficiente ({money(insufficient)}).</ErrText>
                <Btn title="Adicionar saldo" onPress={() => router.push("/recarga")} />
              </>
            ) : (
              <Btn title={`Comprar por ${money(precoCents)}`} onPress={comprar} loading={loading} />
            )}
          </>
        )}

        {use?.status === "PAID" && (
          <>
            <Sub>Comprado! Aperte o botão quando estiver pronto pra usar.</Sub>
            <Btn title="Começar agora" onPress={comecar} loading={loading} />
          </>
        )}

        {use?.status === "ACTIVE" && !finalizado && (
          <Card>
            <Text style={{ fontFamily: F.displayX, fontSize: 32, color: C.jato, textAlign: "center" }}>
              {restante != null ? `${String(Math.floor(restante / 60)).padStart(2, "0")}:${String(restante % 60).padStart(2, "0")}` : "--:--"}
            </Text>
            <Sub>Aspirador liberado. Use até acabar o tempo.</Sub>
          </Card>
        )}

        {(finalizado || use?.status === "COMPLETED") && (
          <Card>
            <Text style={{ fontFamily: F.display, fontSize: 18, color: C.cromo, textAlign: "center" }}>
              Tempo esgotado ✓
            </Text>
            <Sub>Obrigado por usar o aspirador. Voltando pra tela inicial…</Sub>
          </Card>
        )}

        <ErrText>{error}</ErrText>
      </View>
    </Screen>
  );
}

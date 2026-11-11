import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Image, Pressable, Text, View } from "react-native";
import { api, type LojaAbertura, type LojaAlerta, type LojaDoDono, type LojaIndicadores } from "@/lib/api";
import { Btn, Card, ErrText, Input, Label, Sub } from "@/ui";
import { C, F, money } from "@/theme";

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const SEPARADOR = { paddingTop: 10, marginTop: 10, borderTopWidth: 1, borderTopColor: C.linha, gap: 6 } as const;
const TEXTO = { fontFamily: F.body, fontSize: 15, color: C.cromo } as const;

/** Botão pequeno de ação secundária (o Btn do app é grande demais pra lista). */
function Mini({ title, onPress, ativo }: { title: string; onPress: () => void; ativo?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button" onPress={onPress}
      style={({ pressed }) => ({
        borderWidth: 1, borderColor: ativo ? C.cromo : C.linha, borderRadius: 10,
        paddingHorizontal: 12, paddingVertical: 8, opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ fontFamily: ativo ? F.bodyBold : F.body, fontSize: 13, color: C.cromo }}>{title}</Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ avisos */

function Aviso({ a, lojaId, onMudou }: { a: LojaAlerta; lojaId: string; onMudou: () => void }) {
  const [imagens, setImagens] = useState<string[] | null>(null);
  const [motivo, setMotivo] = useState("");
  const [bloqueando, setBloqueando] = useState(false);
  const [error, setError] = useState("");
  const invasaoAberta = a.tipo === "INVASAO" && !a.lidoEm;

  async function tentar(acao: () => Promise<unknown>, falha: string) {
    setError("");
    try { await acao(); } catch (e) { setError(e instanceof Error ? e.message : falha); }
  }
  const verImagens = () =>
    tentar(async () => setImagens((await api<{ imagens: string[] }>(`/api/dono/alertas/${a.id}`)).imagens),
      "Não foi possível carregar as imagens");
  const marcarLido = () =>
    tentar(async () => { await api(`/api/dono/alertas/${a.id}`, { method: "POST" }); onMudou(); },
      "Não foi possível marcar como lido");
  const bloquear = () =>
    tentar(async () => {
      await api(`/api/dono/lojas/${lojaId}/bloqueios`, { body: { codigoCliente: a.codigoCliente, motivo } });
      setBloqueando(false);
      setMotivo("");
      onMudou();
    }, "Não foi possível bloquear");

  return (
    <View
      style={[
        SEPARADOR,
        invasaoAberta && {
          borderWidth: 2, borderTopWidth: 2, borderColor: C.erro, borderTopColor: C.erro, borderRadius: 12,
          padding: 12, backgroundColor: "rgba(201,64,60,0.14)",
        },
      ]}
    >
      <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: invasaoAberta ? C.pili : C.cromo }}>
        {a.lidoEm ? "" : "● "}{a.titulo}
      </Text>
      <Sub>{dataHora(a.ocorridoEm)}{a.codigoCliente ? ` · cliente código ${a.codigoCliente}` : ""}</Sub>
      {a.detalhe ? <Text style={TEXTO}>{a.detalhe}</Text> : null}

      {imagens?.map((b64, i) => (
        <Image
          key={i} source={{ uri: `data:image/jpeg;base64,${b64}` }} resizeMode="contain"
          accessibilityLabel={`Imagem ${i + 1} do aviso`}
          style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: 10, backgroundColor: C.verniz2 }}
        />
      ))}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {a.imagens > 0 && !imagens ? (
          <Mini title={a.imagens === 1 ? "Ver imagem" : `Ver ${a.imagens} imagens`} onPress={verImagens} />
        ) : null}
        {!a.lidoEm ? <Mini title="Marcar como lido" onPress={marcarLido} /> : null}
        {a.codigoCliente && !a.clienteBloqueado && !bloqueando ? (
          <Mini title="Bloquear este cliente" onPress={() => setBloqueando(true)} />
        ) : null}
      </View>
      {a.clienteBloqueado ? <Sub>Este cliente já está bloqueado nesta loja.</Sub> : null}

      {bloqueando ? (
        <>
          <Input placeholder="Motivo do bloqueio (fica só com você)" maxLength={300} value={motivo} onChangeText={setMotivo} />
          <Btn title={`Bloquear cliente ${a.codigoCliente}`} kind="danger" onPress={bloquear} disabled={motivo.trim().length < 3} />
          <Btn title="Cancelar" kind="ghost" onPress={() => setBloqueando(false)} />
        </>
      ) : null}
      <ErrText>{error}</ErrText>
    </View>
  );
}

/** Avisos que o computador da loja mandou: invasão, divergência de
 *  prateleira, saída sem pagar, estoque no mínimo. */
export function AvisosLoja({ loja, onMudou }: { loja: LojaDoDono; onMudou: () => void }) {
  const [dados, setDados] = useState<{ naoLidos: number; alertas: LojaAlerta[] } | null>(null);
  const [todos, setTodos] = useState(false);

  const carregar = useCallback(() => {
    api<{ naoLidos: number; alertas: LojaAlerta[] }>(`/api/dono/lojas/${loja.id}/alertas`)
      .then(setDados)
      .catch(() => setDados({ naoLidos: 0, alertas: [] }));
  }, [loja.id]);
  // recarrega junto com a loja (os contadores mudam quando chega aviso novo)
  useEffect(carregar, [carregar, loja.alertasNaoLidos, loja.bloqueios.length]);

  const mudou = () => { carregar(); onMudou(); };
  async function lerTodos() {
    await api(`/api/dono/lojas/${loja.id}/alertas`, { method: "POST" }).catch(() => {});
    mudou();
  }

  const lista = dados?.alertas ?? [];
  const visiveis = todos ? lista : lista.slice(0, 5);

  return (
    <Card>
      <Label>Avisos da loja{dados && dados.naoLidos > 0 ? ` · ${dados.naoLidos} não lido(s)` : ""}</Label>
      {dados === null ? (
        <Sub>Carregando…</Sub>
      ) : lista.length === 0 ? (
        <Sub>Nenhum aviso. Invasão, divergência de estoque, saída sem pagar e estoque no mínimo aparecem aqui.</Sub>
      ) : (
        <>
          {visiveis.map((a) => <Aviso key={a.id} a={a} lojaId={loja.id} onMudou={mudou} />)}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {lista.length > 5 ? (
              <Mini title={todos ? "Mostrar menos" : `Ver todos (${lista.length})`} onPress={() => setTodos(!todos)} />
            ) : null}
            {dados.naoLidos > 1 ? <Mini title="Marcar todos como lidos" onPress={lerTodos} /> : null}
          </View>
        </>
      )}
    </Card>
  );
}

/* --------------------------------------------------------- abrir a porta */

/** Abertura remota da porta — só o dono, com confirmação; fica registrada. */
export function AbrirPorta({ loja }: { loja: LojaDoDono }) {
  const [motivo, setMotivo] = useState("");
  const [pedido, setPedido] = useState<LojaAbertura | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const parar = () => { if (timer.current) clearInterval(timer.current); timer.current = null; };
  useEffect(() => parar, []);

  async function pedir() {
    setError("");
    setEnviando(true);
    try {
      const r = await api<{ id: string }>(`/api/dono/lojas/${loja.id}/abrir-porta`, { body: { motivo } });
      setPedido({ id: r.id, motivo, pedidaEm: new Date().toISOString(), feitaEm: null, situacao: "AGUARDANDO" });
      setMotivo("");
      parar();
      // acompanha até a loja confirmar que abriu (ou o pedido expirar)
      timer.current = setInterval(async () => {
        const lista = await api<{ aberturas: LojaAbertura[] }>(`/api/dono/lojas/${loja.id}/abrir-porta`).catch(() => null);
        const atual = lista?.aberturas.find((a) => a.id === r.id);
        if (atual) setPedido(atual);
        if (atual && atual.situacao !== "AGUARDANDO") parar();
      }, 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível pedir a abertura");
    } finally {
      setEnviando(false);
    }
  }

  function abrir() {
    Alert.alert("Abrir a porta?", `Abrir a porta da ${loja.name} agora? A abertura fica registrada no seu nome.`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Abrir", onPress: pedir },
    ]);
  }

  return (
    <Card style={{ gap: 10 }}>
      <Label>Abrir a porta à distância</Label>
      {!loja.temComputador ? (
        <Sub>Esta loja ainda não tem computador vinculado.</Sub>
      ) : (
        <>
          <Sub>
            Para um entregador sem cadastro ou um cliente que precisa voltar. Cada abertura fica registrada no seu
            nome. Se a loja estiver sem internet, o pedido expira em 2 minutos sem abrir.
          </Sub>
          <Input placeholder="Motivo (opcional)" maxLength={200} value={motivo} onChangeText={setMotivo} />
          <Btn title="Abrir a porta" onPress={abrir} loading={enviando} disabled={pedido?.situacao === "AGUARDANDO"} />
          {pedido?.situacao === "AGUARDANDO" ? <Sub>Pedido enviado. Aguardando a loja abrir…</Sub> : null}
          {pedido?.situacao === "ABERTA" ? (
            <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.ok }}>Porta aberta às {dataHora(pedido.feitaEm!)}.</Text>
          ) : null}
          {pedido?.situacao === "EXPIRADA" ? (
            <ErrText>A loja não respondeu (provavelmente sem internet). A porta não foi aberta.</ErrText>
          ) : null}
          <ErrText>{error}</ErrText>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------ indicadores */

const FORMA: Record<string, string> = { CARTEIRA: "Carteira do app", MAQUININHA: "Cartão" };
const PERIODOS = [{ dias: 7, rotulo: "7 dias" }, { dias: 30, rotulo: "30 dias" }, { dias: 90, rotulo: "90 dias" }];

/** Dia local (AAAA-MM-DD) de hoje menos n dias. */
function diaMenos(n: number): string {
  const d = new Date(Date.now() - n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Linha({ esquerda, direita }: { esquerda: string; direita: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
      <Text style={[TEXTO, { flex: 1 }]}>{esquerda}</Text>
      <Text style={TEXTO}>{direita}</Text>
    </View>
  );
}

function Grupo({ titulo, linhas }: { titulo: string; linhas: { rotulo: string; vendas: number; totalCents: number }[] }) {
  if (linhas.length === 0) return null;
  const maximo = Math.max(...linhas.map((l) => l.totalCents));
  return (
    <View style={SEPARADOR}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.acoD }}>{titulo}</Text>
      {linhas.map((l) => (
        <View key={l.rotulo} style={{ gap: 3 }}>
          <Linha esquerda={l.rotulo} direita={`${l.vendas} · ${money(l.totalCents)}`} />
          <View style={{ backgroundColor: C.linha, borderRadius: 4, height: 6 }}>
            <View
              style={{
                width: `${maximo > 0 ? Math.round((l.totalCents / maximo) * 100) : 0}%`,
                height: 6, borderRadius: 4, backgroundColor: C.ok,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Indicadores da loja: faturamento, mais vendidos, horários, faixa etária. */
export function IndicadoresLoja({ loja }: { loja: LojaDoDono }) {
  const [dias, setDias] = useState(30);
  const [ind, setInd] = useState<LojaIndicadores | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    api<LojaIndicadores>(`/api/dono/lojas/${loja.id}/indicadores?de=${diaMenos(dias - 1)}&ate=${diaMenos(0)}`)
      .then((r) => { if (vivo) { setInd(r); setError(""); } })
      .catch(() => { if (vivo) setError("Não foi possível carregar os indicadores."); });
    return () => { vivo = false; };
  }, [loja.id, dias]);

  return (
    <Card>
      <Label>Indicadores</Label>
      <View style={{ flexDirection: "row", gap: 8, marginVertical: 8 }}>
        {PERIODOS.map((p) => (
          <Mini key={p.dias} title={p.rotulo} ativo={p.dias === dias} onPress={() => setDias(p.dias)} />
        ))}
      </View>
      <ErrText>{error}</ErrText>
      {!ind ? (
        error ? null : <Sub>Carregando…</Sub>
      ) : (
        <>
          <Text style={{ fontFamily: F.displayX, fontSize: 28, color: C.cromo }}>{money(ind.faturamentoCents)}</Text>
          <Sub>
            {ind.vendas} {ind.vendas === 1 ? "venda" : "vendas"} · ticket médio {money(ind.ticketMedioCents)}
          </Sub>
          {ind.vendas === 0 ? (
            <Sub>Sem vendas sincronizadas neste período.</Sub>
          ) : (
            <>
              <View style={SEPARADOR}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.acoD }}>Itens mais vendidos</Text>
                {ind.maisVendidos.map((i) => (
                  <Linha key={i.ean ?? i.nome} esquerda={i.nome} direita={`${i.quantidade} un · ${money(i.totalCents)}`} />
                ))}
              </View>
              <Grupo titulo="Forma de pagamento" linhas={ind.porForma.map((f) => ({ rotulo: FORMA[f.forma] ?? f.forma, ...f }))} />
              <Grupo titulo="Faixa etária (só compras pela carteira são identificadas)" linhas={ind.faixaEtaria.map((f) => ({ rotulo: f.faixa, ...f }))} />
              <Grupo titulo="Dia da semana" linhas={ind.porDiaSemana.filter((d) => d.vendas > 0).map((d) => ({ rotulo: d.dia, ...d }))} />
              <Grupo titulo="Horário" linhas={ind.porHora.filter((h) => h.vendas > 0).map((h) => ({ rotulo: `${h.hora}h às ${h.hora + 1}h`, ...h }))} />
            </>
          )}
        </>
      )}
    </Card>
  );
}

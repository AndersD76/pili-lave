import { redirect } from "next/navigation";

// O histórico de alertas agora fica DENTRO da Visão geral (abas por máquina). Esta rota só mantém os links antigos funcionando.
export default function AlertasAntigo() {
  redirect("/admin");
}

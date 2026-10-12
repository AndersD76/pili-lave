/** Versão vigente do termo de uso. Trocar este valor obriga TODO MUNDO a
 *  aceitar de novo na próxima vez que abrir o app (User.termosVersao deixa
 *  de bater). Sem dependência de servidor: a tela /app/termos importa daqui. */
export const TERMOS_VERSAO = "rascunho-2026-10";

/* RASCUNHO — tópicos que o termo precisa cobrir, escritos pra orientar o
 * texto jurídico final. Não é o texto definitivo: precisa de revisão de
 * advogado antes de ir pra produção (e aí TERMOS_VERSAO muda). */
export const TERMOS_TOPICOS: { titulo: string; texto: string }[] = [
  {
    titulo: "Seus dados de cadastro",
    texto:
      "Guardamos nome, telefone, e-mail, data de nascimento e, se você informar, CPF. Usamos para identificar sua conta, cobrar o que você consumir e enviar a nota fiscal por e-mail.",
  },
  {
    titulo: "Carteira e pagamentos",
    texto:
      "O saldo da carteira paga lavagens, aspirador e compras na loja de conveniência. Todo lançamento fica no seu extrato.",
  },
  {
    titulo: "Câmeras na lavagem",
    texto: "A câmera da máquina fotografa a placa do veículo para liberar a lavagem que você pagou.",
  },
  {
    titulo: "Câmeras e acompanhamento dentro da loja",
    texto:
      "A loja de conveniência é filmada o tempo todo. O sistema acompanha por vídeo por onde cada cliente passa e o que sai das prateleiras, e compara com o que foi pago no caixa.",
  },
  {
    titulo: "Foto do rosto (só para usar a loja)",
    texto:
      "Para usar a loja você tira uma foto do rosto no app. Ela é usada apenas para reconhecer você no caixa da loja. É um dado biométrico: pedimos sua autorização separada na hora da foto.",
  },
  {
    titulo: "Divergências e contestação",
    texto:
      "Se houver diferença entre o que saiu da prateleira e o que foi pago, o responsável pela loja é avisado com as imagens do momento. Em caso de contestação de cobrança, o vídeo é a referência.",
  },
  {
    titulo: "Bloqueio de acesso",
    texto:
      "O responsável por uma loja pode bloquear a entrada de um cliente por problema de conduta. Quem for bloqueado pode pedir revisão pelo suporte.",
  },
];

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mesma razão do server/: fixa a raiz e cala o aviso de "multiple lockfiles".
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
  // O XML de uma nota grande passa do limite padrão de 1 MB dos formulários.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  // A gestão mudou de /produtos pra /gestao/produtos: quem ficou com a aba
  // antiga aberta (ou guardou o endereço) cai no lugar certo em vez de um 404.
  async redirects() {
    return [
      { source: "/produtos", destination: "/gestao/produtos", permanent: false },
      { source: "/produtos/:id", destination: "/gestao/produtos/:id", permanent: false },
    ];
  },
};

export default nextConfig;

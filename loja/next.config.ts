import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mesma razão do server/: fixa a raiz e cala o aviso de "multiple lockfiles".
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
};

export default nextConfig;

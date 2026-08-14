import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O deploy no Railway builda a partir da raiz do monorepo (shim no
  // package.json raiz); isto fixa o root correto e cala o aviso de
  // "multiple lockfiles".
  outputFileTracingRoot: __dirname,
};

export default nextConfig;

import type { NextConfig } from "next";
import path from "node:path";
import { loadEnvFile } from "node:process";

// The monorepo keeps its shared runtime configuration at the repository root,
// while Next.js normally only loads env files from apps/web.
loadEnvFile(path.resolve(process.cwd(), "../..", ".env"));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @merchantmesh/shared's package.json points straight at its TS source
  // (no build step) and its internal imports use NodeNext-style explicit
  // `.js` specifiers that actually resolve to sibling `.ts` files — webpack
  // doesn't do that `.js`→`.ts` fallback by default, only tsc/tsx do.
  webpack: (config) => {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};

export default nextConfig;

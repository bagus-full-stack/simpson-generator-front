import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Génère .next/standalone (serveur Node minimal) pour une image Docker légère.
  output: "standalone",
};

export default nextConfig;

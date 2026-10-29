import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // image Docker minimale (.next/standalone + server.js)
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repo root has its own package-lock.json (the Express agent); pin the app root to this folder.
  turbopack: { root: __dirname },
};

export default nextConfig;

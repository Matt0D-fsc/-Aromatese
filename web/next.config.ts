import type { NextConfig } from "next";

// Baseline browser protections. The dashboards must never load inside another site's frame (a hidden frame can
// trick a merchant into clicking Confirm or Delete). The public chat is left frameable for the embeddable widget.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The chat records voice notes; nothing uses the camera or location.
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // The repo root has its own package-lock.json (the Express agent); pin the app root to this folder.
  turbopack: { root: __dirname },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/((?!chat/).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] },
    ];
  },
};

export default nextConfig;

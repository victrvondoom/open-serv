import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["pg", "pg-boss", "pdfkit", "cheerio", "@prisma/client", "@prisma/adapter-pg"],
  poweredByHeader: false,
  // lets tests run a second server process from the same checkout
  distDir: process.env.NEXT_DIST_DIR || ".next",
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};
export default config;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // exceljs и prisma работают только на сервере
  serverExternalPackages: ["exceljs", "@prisma/client", "bcryptjs", "sharp", "pdfkit"],
  experimental: {
    serverActions: { bodySizeLimit: "30mb" },
  },
  poweredByHeader: false,
  // Базовые заголовки безопасности: запрет встраивания во фреймы (кликджекинг), запрет угадывания типа,
  // камера — только для самого приложения (съёмка АВР), без микрофона и геолокации
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;

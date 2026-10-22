import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // exceljs и prisma работают только на сервере
  serverExternalPackages: ["exceljs", "@prisma/client", "bcryptjs", "sharp", "pdfkit"],
  experimental: {
    serverActions: { bodySizeLimit: "30mb" },
  },
  poweredByHeader: false,
};

export default nextConfig;

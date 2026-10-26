/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["sharp", "@node-rs/argon2", "pdf-parse", "mammoth"],
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
      ],
    }];
  },
};
export default nextConfig;

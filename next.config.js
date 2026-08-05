import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const consoleFileStub = `${projectRoot}/stubs/next-console-file.js`;

const securityHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  turbopack: {
    root: projectRoot,
  },
  webpack(config, { isServer }) {
    if (isServer) {
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        "next/dist/server/node-environment-extensions/console-file.js": consoleFileStub,
      };
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;

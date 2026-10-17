import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Only the Docker image build asks for the self-contained server; a local Windows
  // build would have to copy pnpm's symlinked node_modules for it.
  ...(process.env["WORKPULSE_STANDALONE"] === "1" ? { output: "standalone" as const } : {}),
  experimental: {
    // Use a worker thread for Next's API-based type check; keep the check enabled
    // without requiring a child process in restricted build environments.
    workerThreads: true,
    useTypeScriptCli: false,
  },
};

export default nextConfig;

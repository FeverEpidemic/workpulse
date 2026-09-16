import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Use a worker thread for Next's API-based type check; keep the check enabled
    // without requiring a child process in restricted build environments.
    workerThreads: true,
    useTypeScriptCli: false,
  },
};

export default nextConfig;

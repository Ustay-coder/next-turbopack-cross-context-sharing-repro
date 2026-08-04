/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: process.cwd(),
  ...(process.env.REPRO_SERVER_SOURCE_MAPS === "1"
    ? { experimental: { serverSourceMaps: true } }
    : {}),
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;

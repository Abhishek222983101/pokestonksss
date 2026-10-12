import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@pokestonksss/rules-wasm", "@pokestonksss/sdk"],
};

export default nextConfig;

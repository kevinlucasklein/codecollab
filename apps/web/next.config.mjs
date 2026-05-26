/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Allow importing from workspace packages
  transpilePackages: ["@codecollab/shared"],
};

export default nextConfig;

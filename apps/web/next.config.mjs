/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow importing from workspace packages
  transpilePackages: ["@codecollab/shared"],
};

export default nextConfig;

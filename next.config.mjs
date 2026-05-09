/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  webpack(config) {
    // Allow importing TS files with .js extensions (ESM-style Node imports)
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    return config;
  },
};
export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config, { isServer, dev }) {
    // Enable experiments
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true, // Needed for WASM modules like Rapier
      layers: true, // Recommended for Next.js features
    };

    // Provide empty fallbacks for Node.js core modules that shouldn't be bundled for the browser
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback, // Spread existing fallbacks
        fs: false, // Tell webpack to ignore fs imports on the client side
        path: false, // Also common to ignore path
      };
    }

    // Rule to handle .wasm files as assets (alternative if async doesn't work alone)
    // config.module.rules.push({
    //   test: /\\.wasm$/,
    //   type: 'asset/resource',
    // });


    // Important: return the modified config
    return config;
  },
};

module.exports = nextConfig; 
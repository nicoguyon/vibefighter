/** @type {import('next').NextConfig} */

// Ensure R2_PUBLIC_URL is defined
if (!process.env.R2_PUBLIC_URL) {
  throw new Error('Missing required environment variable: R2_PUBLIC_URL');
}

// Parse the R2 public URL to extract hostname and protocol
const r2Url = new URL(process.env.R2_PUBLIC_URL);

const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: r2Url.protocol.replace(':', ''), // Extract protocol (e.g., 'https')
        hostname: r2Url.hostname, // Extract hostname
        port: r2Url.port || '', // Extract port or use empty string if default
        pathname: '/**', // Allow any path under this hostname
      },
    ],
  },
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
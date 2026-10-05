import { securityHeaders } from './src/lib/security-headers.js';

const headers = Object.entries(securityHeaders).map(([key, value]) => ({ key, value }));

const nextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers,
      },
      ...['/', '/login'].map((source) => ({
        source,
        headers: [...headers, { key: 'Cache-Control', value: 'private, no-store' }],
      })),
    ];
  },
};

export default nextConfig;

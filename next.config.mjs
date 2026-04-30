/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
  webpack: (config, { dev }) => {
    config.externals.push({
      'better-sqlite3': 'commonjs better-sqlite3',
      '@aws-sdk/client-s3': 'commonjs @aws-sdk/client-s3',
    });
    // Ignore SQLite WAL/SHM/DB writes + log files during dev — otherwise
    // every cron tick + mission update + session write triggers a full
    // recompile because the DB files live at the project root.
    // (Effective in webpack mode — `npm run dev:stable`. Turbopack 14.2
    // doesn't honor these; for --turbo, point DATABASE_PATH outside the
    // project root.)
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          '**/node_modules/**',
          '**/.next/**',
          '**/.git/**',
          '**/mission-control.db',
          '**/mission-control.db-wal',
          '**/mission-control.db-shm',
          '**/mission-control.db-journal',
          '**/db-backups/**',
          '**/*.db',
          '**/*.db-*',
          '**/*.log',
        ],
      };
    }
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};

export default nextConfig;

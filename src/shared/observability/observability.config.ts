export const OBSERVABILITY = {
  service: process.env.DD_SERVICE ?? 'execution-api',
  env: process.env.DD_ENV ?? process.env.NODE_ENV ?? 'development',
  version: process.env.DD_VERSION ?? process.env.npm_package_version ?? '0.0.1',
} as const;

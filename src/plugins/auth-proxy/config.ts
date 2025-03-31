export interface AuthProxyConfig {
  enabled: boolean;
  hostname: string;
  port: number;
  useUpstreamProxy: boolean;
  upstreamProxyUrl: string;
}

export const defaultAuthProxyConfig: AuthProxyConfig = {
  enabled: true,
  hostname: '127.0.0.1',
  port: 4545,
  useUpstreamProxy: false,
  upstreamProxyUrl: '',
};

// Helper function: Convert proxy configuration to URL string (for command line arguments)
export function getProxyUrl(config: AuthProxyConfig): string {
  const { hostname, port } = config;
  // No longer include authentication info as local proxy doesn't require authentication
  return `socks5://${hostname}:${port}`;
}

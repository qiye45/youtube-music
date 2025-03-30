export enum ProxyType {
  HTTP = 'http',
  SOCKS5 = 'socks5',
}

export interface AuthProxyConfig {
  enabled: boolean;
  hostname: string;
  port: number;
  username: string;
  password: string;
  proxyType: ProxyType;
  useUpstreamProxy: boolean;
  upstreamProxyUrl: string;
}

export const defaultAuthProxyConfig: AuthProxyConfig = {
  enabled: true,
  hostname: '127.0.0.1',
  port: 18080,
  username: 'admin',
  password: 'password',
  proxyType: ProxyType.HTTP,
  useUpstreamProxy: false,
  upstreamProxyUrl: ''
};

// 辅助函数：将代理配置转换为URL字符串（用于命令行参数）
export function getProxyUrl(config: AuthProxyConfig): string {
  const { proxyType, username, password, hostname, port } = config;
  const auth = username && password ? `${username}:${password}@` : '';
  return `${proxyType}://${auth}${hostname}:${port}`;
}

// 从代理URL字符串解析配置
export function parseProxyUrl(proxyUrl: string): Partial<AuthProxyConfig> {
  try {
    // 解析URL格式如：socks5://username:password@hostname:port
    const match = proxyUrl.match(/^(http|socks5):\/\/(?:([^:]+):([^@]+)@)?([^:]+):(\d+)/i);
    
    if (match) {
      const [, type, username, password, hostname, port] = match;
      return {
        proxyType: type.toLowerCase() === 'socks5' ? ProxyType.SOCKS5 : ProxyType.HTTP,
        username: username || '',
        password: password || '',
        hostname,
        port: parseInt(port, 10),
        enabled: true,
      };
    }
  } catch (error) {
    console.error('解析代理URL失败:', error);
  }
  
  return {};
}

// 解析SOCKS URL为配置对象
export function parseSocksUrl(socksUrl: string) {
  try {
    const url = new URL(socksUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port, 10),
      type: url.protocol === 'socks5:' ? 5 : 4,
      username: url.username || undefined,
      password: url.password || undefined
    };
  } catch (error) {
    console.error('解析SOCKS URL失败:', error);
    return null;
  }
} 
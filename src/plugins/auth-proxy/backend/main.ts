import { createBackend } from '@/utils';
import http from 'http';
import { parse as parseUrl } from 'url';
import net from 'net';
import { app } from 'electron';
import { URL } from 'url';

import type { AuthProxyConfig } from '../config';
import { ProxyType, getProxyUrl } from '../config';
import type { Server, IncomingMessage, ServerResponse } from 'http';
import type { BackendContext } from '@/types/contexts';

// 实用函数：生成基本认证头
function generateAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

// 验证请求中的认证信息
function validateAuth(request: IncomingMessage, username: string, password: string): boolean {
  const authHeader = request.headers['proxy-authorization'] || '';
  const expectedHeader = generateAuthHeader(username, password);
  return authHeader === expectedHeader;
}

// 发送认证失败响应
function sendAuthRequired(response: ServerResponse): void {
  response.writeHead(407, {
    'Proxy-Authenticate': 'Basic realm="Authentication Required"',
    'Content-Type': 'text/plain',
  });
  response.end('Proxy authentication required');
}

// 解析SOCKS URL为配置对象
function parseSocksUrl(socksUrl: string) {
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

// 解析HTTP代理URL
function parseHttpProxyUrl(proxyUrl: string) {
  try {
    const url = new URL(proxyUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port, 10),
      auth: url.username && url.password ? 
        Buffer.from(`${url.username}:${url.password}`).toString('base64') : null
    };
  } catch (error) {
    console.error('解析HTTP代理URL失败:', error);
    return null;
  }
}

interface BackendType {
  server?: Server;
  oldConfig?: AuthProxyConfig;
  connectHandler: (req: IncomingMessage, clientSocket: net.Socket, head: Buffer) => void;
  requestHandler: (req: IncomingMessage, res: ServerResponse) => void;
  connectViaSocks: (clientSocket: net.Socket, hostname: string, port: number, head: Buffer) => void;
  connectViaHttp: (clientSocket: net.Socket, hostname: string, port: number, head: Buffer) => void;
  forwardDirectly: (req: IncomingMessage, res: ServerResponse) => void;
  forwardViaHttpProxy: (req: IncomingMessage, res: ServerResponse) => void;
  startServer: (config: AuthProxyConfig) => void;
  stopServer: () => void;
  setSystemProxy: (config: AuthProxyConfig) => void;
  clearSystemProxy: () => void;
  proxyString?: string;
}

export const backend = createBackend<BackendType, AuthProxyConfig>({
  // 插件启动时调用
  async start(ctx: BackendContext<AuthProxyConfig>) {
    const config = await ctx.getConfig();
    if (config.enabled) {
      this.startServer(config);
      
      // 设置系统代理
      this.setSystemProxy(config);
    }
  },

  // 插件停止时调用
  stop() {
    this.clearSystemProxy();
    this.stopServer();
  },

  // 插件配置改变时调用
  async onConfigChange(config: AuthProxyConfig) {
    if (!this.oldConfig) {
      this.oldConfig = config;
      return;
    }

    // 配置变更逻辑处理
    const configChanged = 
      this.oldConfig.port !== config.port || 
      this.oldConfig.hostname !== config.hostname || 
      this.oldConfig.username !== config.username || 
      this.oldConfig.password !== config.password ||
      this.oldConfig.proxyType !== config.proxyType ||
      this.oldConfig.useUpstreamProxy !== config.useUpstreamProxy ||
      this.oldConfig.upstreamProxyUrl !== config.upstreamProxyUrl;
    
    // 启用状态变更
    if (this.oldConfig.enabled !== config.enabled) {
      if (config.enabled) {
        this.startServer(config);
        this.setSystemProxy(config);
      } else {
        this.clearSystemProxy();
        this.stopServer();
      }
    } 
    // 配置变更且代理已启用
    else if (configChanged && config.enabled) {
      this.clearSystemProxy();
      this.stopServer();
      this.startServer(config);
      this.setSystemProxy(config);
    }

    this.oldConfig = config;
  },

  // HTTPS隧道请求处理
  connectHandler(req, clientSocket, head) {
    const config = this.oldConfig!;
    const { username, password, useUpstreamProxy, upstreamProxyUrl } = config;
    
    // 验证认证
    if (!validateAuth(req, username, password)) {
      clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\n' +
        'Proxy-Authenticate: Basic realm="Authentication Required"\r\n' +
        '\r\n');
      clientSocket.end();
      return;
    }

    const { port, hostname } = parseUrl(`http://${req.url}`, false) as { port?: string; hostname?: string };
    
    if (!hostname || !port) {
      clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      clientSocket.end();
      return;
    }

    const targetPort = parseInt(port, 10) || 443;

    // 检查是否使用上游代理
    if (useUpstreamProxy && upstreamProxyUrl) {
      // 决定上游代理类型
      if (upstreamProxyUrl.startsWith('socks')) {
        // 使用SOCKS代理
        this.connectViaSocks(clientSocket, hostname, targetPort, head);
      } else if (upstreamProxyUrl.startsWith('http')) {
        // 使用HTTP代理
        this.connectViaHttp(clientSocket, hostname, targetPort, head);
      } else {
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        clientSocket.end();
      }
      return;
    }

    // 直接连接到目标
    const serverSocket = net.connect(
      targetPort,
      hostname,
      () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n' +
          'Proxy-agent: YTMusic-Auth-Proxy\r\n' +
          '\r\n');
        serverSocket.write(head);
        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
      }
    );

    serverSocket.on('error', (err) => {
      console.error('Target connection error:', err);
      clientSocket.end();
    });

    clientSocket.on('error', (err) => {
      console.error('Client connection error:', err);
      serverSocket.end();
    });
  },

  // 通过SOCKS代理连接
  connectViaSocks(clientSocket, hostname, port, head) {
    const config = this.oldConfig!;
    const socksConfig = parseSocksUrl(config.upstreamProxyUrl);
    
    if (!socksConfig) {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      clientSocket.end();
      return;
    }

    // 通过SOCKS连接目标
    // 注意：由于我们不直接使用socks库，这里只是展示基础实现逻辑
    // 在实际应用中，你可能需要引入socks库或直接实现SOCKS协议
    
    // SOCKS5握手阶段
    const socksSocket = net.connect(socksConfig.port, socksConfig.host, () => {
      // SOCKS5认证握手消息
      const authMsg = Buffer.from([
        0x05, // SOCKS版本
        0x01, // 认证方法数量
        0x00  // 无认证方法 (或者使用0x02表示用户名密码认证)
      ]);
      
      socksSocket.write(authMsg);
      
      let stage = 'auth';
      let buffer = Buffer.alloc(0);
      
      socksSocket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        
        if (stage === 'auth' && buffer.length >= 2) {
          // 处理认证响应
          const ver = buffer[0];
          const method = buffer[1];
          
          if (ver !== 0x05) {
            console.error('不支持的SOCKS版本');
            clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            clientSocket.end();
            socksSocket.end();
            return;
          }
          
          if (method === 0x00) {
            // 无认证方法被接受，发送连接请求
            const connectReq = Buffer.alloc(buffer.length > 2 ? buffer.length - 2 : 0);
            if (buffer.length > 2) {
              buffer.copy(connectReq, 0, 2);
            }
            buffer = connectReq;
            
            // 准备目标地址信息
            const domain = Buffer.from(hostname);
            const connectMsg = Buffer.alloc(7 + domain.length);
            
            connectMsg[0] = 0x05; // SOCKS版本
            connectMsg[1] = 0x01; // 命令：CONNECT
            connectMsg[2] = 0x00; // 保留字段
            connectMsg[3] = 0x03; // 地址类型：域名
            connectMsg[4] = domain.length;
            domain.copy(connectMsg, 5);
            connectMsg.writeUInt16BE(port, 5 + domain.length);
            
            socksSocket.write(connectMsg);
            stage = 'connect';
          } else {
            console.error('SOCKS服务器不接受无认证方法');
            clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            clientSocket.end();
            socksSocket.end();
          }
        } else if (stage === 'connect' && buffer.length >= 4) {
          // 处理连接响应
          const ver = buffer[0];
          const rep = buffer[1];
          
          if (ver !== 0x05) {
            console.error('不支持的SOCKS版本');
            clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            clientSocket.end();
            socksSocket.end();
            return;
          }
          
          if (rep === 0x00) {
            // 连接成功
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n' +
                               'Proxy-agent: YTMusic-Auth-Proxy\r\n' +
                               '\r\n');
            
            // 如果有初始数据，发送它
            if (head && head.length > 0) {
              socksSocket.write(head);
            }
            
            // 建立双向数据流
            socksSocket.pipe(clientSocket);
            clientSocket.pipe(socksSocket);
            
            // 清除现有的data处理器
            socksSocket.removeAllListeners('data');
          } else {
            // 连接失败
            console.error('SOCKS连接失败，错误码:', rep);
            clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            clientSocket.end();
            socksSocket.end();
          }
        }
      });
    });
    
    socksSocket.on('error', (err) => {
      console.error('SOCKS proxy socket error:', err);
      if (clientSocket.writable) clientSocket.end();
    });
    
    clientSocket.on('error', (err) => {
      console.error('SOCKS client socket error:', err);
      if (socksSocket.writable) socksSocket.end();
    });
  },

  // 通过HTTP代理连接
  connectViaHttp(clientSocket, hostname, port, head) {
    const config = this.oldConfig!;
    const httpConfig = parseHttpProxyUrl(config.upstreamProxyUrl);
    
    if (!httpConfig) {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      clientSocket.end();
      return;
    }

    // 创建到上游HTTP代理的连接
    const proxySocket = net.connect(httpConfig.port, httpConfig.host, () => {
      // 向上游HTTP代理发送CONNECT请求
      proxySocket.write(
        `CONNECT ${hostname}:${port} HTTP/1.1\r\n` +
        `Host: ${hostname}:${port}\r\n` +
        (httpConfig.auth ? `Proxy-Authorization: Basic ${httpConfig.auth}\r\n` : '') +
        'Connection: keep-alive\r\n' +
        '\r\n'
      );

      // 等待上游代理的响应
      let proxyResponseData = '';
      let isConnected = false;

      proxySocket.on('data', (chunk) => {
        if (!isConnected) {
          proxyResponseData += chunk.toString();
          
          // 检查是否收到完整的HTTP响应头
          if (proxyResponseData.includes('\r\n\r\n')) {
            const responseLines = proxyResponseData.split('\r\n');
            const statusLine = responseLines[0];
            const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
            
            if (statusMatch && statusMatch[1] === '200') {
              // 代理连接成功，将成功消息转发给客户端
              clientSocket.write('HTTP/1.1 200 Connection Established\r\n' +
                'Proxy-agent: YTMusic-Auth-Proxy\r\n' +
                '\r\n');
              
              // 设置为已连接
              isConnected = true;
              
              // 发送初始数据（如果有）
              if (head && head.length > 0) {
                proxySocket.write(head);
              }
              
              // 建立双向数据流
              proxySocket.pipe(clientSocket);
              clientSocket.pipe(proxySocket);
            } else {
              // 代理连接失败
              console.error('HTTP proxy error:', statusLine);
              clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
              clientSocket.end();
              proxySocket.end();
            }
          }
        }
      });
    });

    proxySocket.on('error', (err) => {
      console.error('HTTP proxy socket error:', err);
      if (clientSocket.writable) clientSocket.end();
    });

    clientSocket.on('error', (err) => {
      console.error('HTTP client socket error:', err);
      if (proxySocket.writable) proxySocket.end();
    });
  },

  // HTTP请求处理
  requestHandler(req, res) {
    const config = this.oldConfig!;
    const { username, password, useUpstreamProxy, upstreamProxyUrl } = config;
    
    // 验证认证
    if (!validateAuth(req, username, password)) {
      sendAuthRequired(res);
      return;
    }

    const url = req.url!;
    const options = parseUrl(url, false);
    
    if (!options.hostname) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid URL');
      return;
    }

    // 检查是否使用上游代理
    if (useUpstreamProxy && upstreamProxyUrl) {
      if (upstreamProxyUrl.startsWith('http')) {
        // 使用上游HTTP代理
        this.forwardViaHttpProxy(req, res);
        return;
      } else if (upstreamProxyUrl.startsWith('socks')) {
        // 使用上游SOCKS代理
        // 由于没有直接使用socks库，这里只是一个提示
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('SOCKS proxy for HTTP requests not implemented without socks library');
        return;
      }
    }

    // 直接转发请求（无上游代理）
    this.forwardDirectly(req, res);
  },

  // 直接转发HTTP请求
  forwardDirectly(req, res) {
    const url = req.url!;
    const options = parseUrl(url, false);
    
    // 设置请求选项
    const proxyReqOptions = {
      protocol: options.protocol || 'http:',
      host: options.hostname,
      port: options.port || 80,
      method: req.method,
      path: options.path,
      headers: { ...req.headers },
    };

    // 删除代理相关头信息
    delete proxyReqOptions.headers['proxy-authorization'];
    delete proxyReqOptions.headers['proxy-connection'];
    proxyReqOptions.headers['connection'] = 'close';

    // 转发请求到目标服务器
    const proxyReq = http.request(proxyReqOptions, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res);
    });

    req.pipe(proxyReq);

    proxyReq.on('error', (err) => {
      console.error('Proxy request error:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Proxy request error: ${err.message}`);
    });
  },

  // 通过HTTP代理转发请求
  forwardViaHttpProxy(req, res) {
    const config = this.oldConfig!;
    const httpConfig = parseHttpProxyUrl(config.upstreamProxyUrl);
    
    if (!httpConfig) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway: Cannot parse HTTP proxy configuration');
      return;
    }

    const url = req.url!;
    
    // 设置请求选项
    const proxyReqOptions = {
      host: httpConfig.host,
      port: httpConfig.port,
      method: req.method,
      path: url,  // 保持完整URL
      headers: { ...req.headers },
    };

    // 添加代理认证
    if (httpConfig.auth) {
      proxyReqOptions.headers['Proxy-Authorization'] = `Basic ${httpConfig.auth}`;
    }

    // 删除不需要的头信息
    delete proxyReqOptions.headers['proxy-authorization'];
    delete proxyReqOptions.headers['proxy-connection'];
    proxyReqOptions.headers['connection'] = 'close';

    // 转发请求到上游代理
    const proxyReq = http.request(proxyReqOptions, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res);
    });

    req.pipe(proxyReq);

    proxyReq.on('error', (err) => {
      console.error('HTTP proxy request error:', err);
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`HTTP proxy request error: ${err.message}`);
    });
  },

  // 启动代理服务器
  startServer(config) {
    if (this.server) {
      this.stopServer();
    }

    const { port, hostname, username, password } = config;

    // 本地代理服务器总是HTTP类型
    this.server = http.createServer(this.requestHandler.bind(this));
    
    // 处理HTTPS隧道请求
    this.server.on('connect', this.connectHandler.bind(this));

    // 启动服务器
    this.server.listen(port, hostname, () => {
      console.log(`Auth Proxy Server running at ${hostname}:${port}`);
      console.log(`Username: ${username}, Password: ${password}`);
      if (config.useUpstreamProxy && config.upstreamProxyUrl) {
        console.log(`Using upstream proxy: ${config.upstreamProxyUrl}`);
      }
    });

    this.server.on('error', (err) => {
      console.error('Server error:', err);
    });
  },

  // 停止代理服务器
  stopServer() {
    if (this.server) {
      this.server.close();
      this.server = undefined;
      console.log('Auth Proxy Server stopped');
    }
  },

  // 设置系统代理
  setSystemProxy(config) {
    try {
      if (!app) return;

      const proxyString = getProxyUrl(config);
      this.proxyString = proxyString;
      
      console.log(`Setting system proxy to: ${proxyString}`);
      app.commandLine.appendSwitch('proxy-server', proxyString);
    } catch (error) {
      console.error('Failed to set system proxy:', error);
    }
  },

  // 清除系统代理
  clearSystemProxy() {
    try {
      if (!app || !this.proxyString) return;

      console.log('Clearing system proxy');
      app.commandLine.removeSwitch('proxy-server');
      this.proxyString = undefined;
    } catch (error) {
      console.error('Failed to clear system proxy:', error);
    }
  }
}); 
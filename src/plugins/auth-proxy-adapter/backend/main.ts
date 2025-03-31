import net from 'net';

import {app} from 'electron';
import {SocksClient} from 'socks';

import {createBackend} from '@/utils';
import config from '@/config';

import {getProxyUrl} from '../config';

import type {SocksClientOptions} from 'socks';

import type {AuthProxyConfig} from '../config';
import type {Server} from 'http';
import type {BackendContext} from '@/types/contexts';
import {BackendType} from "./types";


// 解析上游SOCKS代理URL（支持认证）
const parseSocksUrl = (socksUrl: string) => {
  try {
    const url = new URL(socksUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port, 10),
      type: url.protocol === 'socks5:' ? 5 : 4,
      username: url.username || undefined,
      password: url.password || undefined,
    };
  } catch (error) {
    console.error('[Proxy Service] Failed to parse SOCKS URL:', error);
    return null;
  }
};

export const backend = createBackend<BackendType, AuthProxyConfig>({
  async start(ctx: BackendContext<AuthProxyConfig>) {
    const pluginConfig = await ctx.getConfig();
    this.startServer(pluginConfig);


  },
  stop() {
    this.stopServer();
  },
  onConfigChange(pluginConfig: AuthProxyConfig) {
    if (!this.oldConfig) {
      this.oldConfig = pluginConfig;
      return;
    }

    // Configuration change logic
    const configChanged =
      this.oldConfig.port !== pluginConfig.port ||
      this.oldConfig.hostname !== pluginConfig.hostname ||
      this.oldConfig.upstreamProxyUrl !== pluginConfig.upstreamProxyUrl;

    // Enable status change
    if (this.oldConfig.enabled !== pluginConfig.enabled) {
      if (pluginConfig.enabled) {
        this.startServer(pluginConfig);
      } else {
        this.stopServer();
      }
    }
    // Configuration changed and proxy is enabled
    else if (configChanged && pluginConfig.enabled) {
      this.stopServer();
      this.startServer(pluginConfig);
    }

    this.oldConfig = pluginConfig;
  },

  // Custom
  // Start proxy server - SOCKS
  startServer(config) {
    if (this.server) {
      this.stopServer();
    }

    const {port, hostname, upstreamProxyUrl} = config;

    // 创建SOCKS代理服务器
    const socksServer = net.createServer((socket) => {
      console.log('[SOCKS] New connection');

      socket.once('data', (chunk) => {
        // 检查是否是SOCKS协议
        if (chunk[0] === 0x05) {
          // SOCKS5
          console.log('[SOCKS] SOCKS5 handshake received');
          this.handleSocks5(
            socket,
            chunk
          );
        } else if (chunk[0] === 0x04) {
          // SOCKS4
          console.log('[SOCKS] SOCKS4 request received');
          this.handleSocks4(
            socket,
            chunk
          );
        } else {
          console.log('[SOCKS] Unknown protocol:', chunk[0]);
          socket.end();
        }
      });

      socket.on('error', (err) => {
        console.error('[SOCKS] Socket error:', err.message);
      });
    });

    // 监听错误
    socksServer.on('error', (err) => {
      console.error('[SOCKS Server Error]', err.message);
    });

    // 启动服务器
    socksServer.listen(port, hostname, () => {
      console.log('===========================================');
      console.log(`[Proxy Service] SOCKS proxy enabled at ${hostname}:${port}`);
      console.log('[Proxy Service] Authentication disabled');
      console.log(
        `[Proxy Service] Using upstream proxy: ${upstreamProxyUrl}`,
      );
      console.log('===========================================');
    });

    this.server = socksServer;
  },

  // 处理SOCKS5请求
  handleSocks5(
    clientSocket: net.Socket,
    chunk: Buffer,
    upstreamProxyUrl: string | null,
  ) {
    // 握手阶段
    const numMethods = chunk[1];
    const methods = chunk.slice(2, 2 + numMethods);

    // 检查客户端是否支持无认证方式(0x00)
    if (methods.includes(0x00)) {
      // 回复客户端，我们选择无认证方式
      clientSocket.write(Buffer.from([0x05, 0x00]));

      // 等待客户端的连接请求
      clientSocket.once('data', (data) => {
        this.processSocks5Request(clientSocket, data, upstreamProxyUrl);
      });
    } else {
      // 客户端不支持我们想要的认证方式
      clientSocket.write(Buffer.from([0x05, 0xff]));
      clientSocket.end();
    }
  },

  // 处理SOCKS5连接请求
  processSocks5Request(
    clientSocket: net.Socket,
    data: Buffer,
    upstreamProxyUrl: string | null,
  ) {
    // 解析目标地址和端口
    let targetHost, targetPort;
    const cmd = data[1]; // 命令: 0x01=CONNECT, 0x02=BIND, 0x03=UDP
    const atyp = data[3]; // 地址类型: 0x01=IPv4, 0x03=域名, 0x04=IPv6

    if (cmd !== 0x01) {
      // 目前只支持CONNECT命令
      clientSocket.write(
        Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
      );
      clientSocket.end();
      return;
    }

    if (atyp === 0x01) {
      // IPv4
      targetHost = `${data[4]}.${data[5]}.${data[6]}.${data[7]}`;
      targetPort = data.readUInt16BE(8);
    } else if (atyp === 0x03) {
      // 域名
      const hostLen = data[4];
      targetHost = data.slice(5, 5 + hostLen).toString();
      targetPort = data.readUInt16BE(5 + hostLen);
    } else if (atyp === 0x04) {
      // IPv6
      // 简化处理IPv6
      const ipv6Buffer = data.slice(4, 20);
      targetHost = Array.from(new Array(8), (_, i) =>
        ipv6Buffer.readUInt16BE(i * 2).toString(16),
      ).join(':');
      targetPort = data.readUInt16BE(20);
    }

    console.log(`[SOCKS5] Request to connect to ${targetHost}:${targetPort}`);

    if (upstreamProxyUrl) {
      // 使用上游代理
      const socksProxy = parseSocksUrl(upstreamProxyUrl);

      if (!socksProxy) {
        // 解析代理URL失败
        clientSocket.write(
          Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
        );
        clientSocket.end();
        return;
      }

      // 使用 SocksClient API
      const options: SocksClientOptions = {
        proxy: {
          host: socksProxy.host,
          port: socksProxy.port,
          type: socksProxy.type as 4 | 5,
          userId: socksProxy.username || undefined,
          password: socksProxy.password || undefined,
        },
        command: 'connect',
        destination: {
          host: targetHost || '',
          port: targetPort || 0,
        },
      };

      // 使用 SocksClient.createConnection API
      SocksClient.createConnection(options)
        .then((info) => {
          const {socket: proxySocket} = info;

          // 连接成功，向客户端发送成功响应
          const responseBuffer = Buffer.from([
            0x05, // VER: SOCKS5
            0x00, // REP: 成功
            0x00, // RSV: 保留字段
            0x01, // ATYP: IPv4
            0,
            0,
            0,
            0, // BND.ADDR: 0.0.0.0 (绑定的地址，通常不重要)
            0,
            0, // BND.PORT: 0 (绑定的端口，通常不重要)
          ]);
          clientSocket.write(responseBuffer);

          // 建立双向数据流
          proxySocket.pipe(clientSocket);
          clientSocket.pipe(proxySocket);

          proxySocket.on('error', (error) => {
            console.error('[SOCKS5] Proxy socket error:', error);
            if (clientSocket.writable) clientSocket.end();
          });

          clientSocket.on('error', (error) => {
            console.error('[SOCKS5] Client socket error:', error);
            if (proxySocket.writable) proxySocket.end();
          });
        })
        .catch((error) => {
          console.error('[SOCKS5] Connection error:', error);
          // 向客户端返回失败
          clientSocket.write(
            Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
          );
          clientSocket.end();
        });
    } else {
      // 直接连接目标（不使用上游代理）
      const targetSocket = net.createConnection(
        {
          host: targetHost || '',
          port: targetPort || 0,
        },
        () => {
          // 连接成功，向客户端发送成功响应
          const responseBuffer = Buffer.from([
            0x05, // VER: SOCKS5
            0x00, // REP: 成功
            0x00, // RSV: 保留字段
            0x01, // ATYP: IPv4
            0,
            0,
            0,
            0, // BND.ADDR: 0.0.0.0
            0,
            0, // BND.PORT: 0
          ]);
          clientSocket.write(responseBuffer);

          // 建立双向数据流
          targetSocket.pipe(clientSocket);
          clientSocket.pipe(targetSocket);
        },
      );

      targetSocket.on('error', (err: Error) => {
        console.error('[SOCKS5] Target connection error:', err.message);
        // 向客户端返回失败
        clientSocket.write(
          Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
        );
        clientSocket.end();
      });
    }
  },

  // 处理SOCKS4请求
  handleSocks4(
    clientSocket: net.Socket,
    chunk: Buffer,
    upstreamProxyUrl: string | null,
  ) {
    const cmd = chunk[1]; // 命令: 0x01=CONNECT, 0x02=BIND

    if (cmd !== 0x01) {
      // 目前只支持CONNECT命令
      clientSocket.write(Buffer.from([0x00, 0x5b, 0, 0, 0, 0, 0, 0]));
      clientSocket.end();
      return;
    }

    // 解析端口 (2字节)
    const port = chunk.readUInt16BE(2);

    // 解析IPv4地址 (4字节)
    const ip = `${chunk[4]}.${chunk[5]}.${chunk[6]}.${chunk[7]}`;

    // 读取USERID (可变长度，以null结尾)
    let idIndex = 8;
    while (idIndex < chunk.length && chunk[idIndex] !== 0) {
      idIndex++;
    }

    console.log(`[SOCKS4] Request to connect to ${ip}:${port}`);

    if (upstreamProxyUrl) {
      // 使用上游代理
      const socksProxy = parseSocksUrl(upstreamProxyUrl);

      if (!socksProxy) {
        // 解析代理URL失败
        clientSocket.write(Buffer.from([0x00, 0x5b, 0, 0, 0, 0, 0, 0]));
        clientSocket.end();
        return;
      }

      // 使用 SocksClient API
      const options: SocksClientOptions = {
        proxy: {
          host: socksProxy.host,
          port: socksProxy.port,
          type: socksProxy.type as 4 | 5,
          userId: socksProxy.username || undefined,
          password: socksProxy.password || undefined,
        },
        command: 'connect',
        destination: {
          host: ip,
          port: port,
        },
      };

      // 使用 SocksClient.createConnection API
      SocksClient.createConnection(options)
        .then((info) => {
          const {socket: proxySocket} = info;

          // 连接成功，向客户端发送成功响应
          clientSocket.write(Buffer.from([0x00, 0x5a, 0, 0, 0, 0, 0, 0]));

          // 建立双向数据流
          proxySocket.pipe(clientSocket);
          clientSocket.pipe(proxySocket);

          proxySocket.on('error', (error) => {
            console.error('[SOCKS4] Proxy socket error:', error);
            if (clientSocket.writable) clientSocket.end();
          });

          clientSocket.on('error', (error) => {
            console.error('[SOCKS4] Client socket error:', error);
            if (proxySocket.writable) proxySocket.end();
          });
        })
        .catch((error) => {
          console.error('[SOCKS4] Connection error:', error);
          // 向客户端返回失败
          clientSocket.write(Buffer.from([0x00, 0x5b, 0, 0, 0, 0, 0, 0]));
          clientSocket.end();
        });
    } else {
      // 直接连接目标（不使用上游代理）
      const targetSocket = net.createConnection(
        {
          host: ip,
          port: port,
        },
        () => {
          // 连接成功，向客户端发送成功响应
          clientSocket.write(Buffer.from([0x00, 0x5a, 0, 0, 0, 0, 0, 0]));

          // 建立双向数据流
          targetSocket.pipe(clientSocket);
          clientSocket.pipe(targetSocket);
        },
      );

      targetSocket.on('error', (err: Error) => {
        console.error('[SOCKS4] Target connection error:', err.message);
        // 向客户端返回失败
        clientSocket.write(Buffer.from([0x00, 0x5b, 0, 0, 0, 0, 0, 0]));
        clientSocket.end();
      });
    }
  },

  // Stop proxy server
  stopServer() {
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
    console.log('[Proxy Service] Proxy disabled');
  },
  // 设置代理
  set_proxy() {
    window.ipcRenderer.send("set_proxy", {
      http_proxy: this.setting_http_proxy
    });
  },

// 取消代理
  remove_proxy() {
    window.ipcRenderer.send("remove_proxy");
  },

});

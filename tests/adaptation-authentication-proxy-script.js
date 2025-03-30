const http = require('http');
const net = require('net');
const { Buffer } = require('buffer');
const { SocksClient } = require('socks');

const LOCAL_PORT = 8080;
const SOCKS_PORT = 8081;  // SOCKS代理服务器端口
const UPSTREAM_PROXY = 'http://test:test@172.16.229.142:7890';
const UPSTREAM_SOCKS = 'socks5://test:test@172.16.229.142:7891';  // 支持认证的上游SOCKS代理

// 解析上游HTTP代理
const upstreamUrl = new URL(UPSTREAM_PROXY);
const upstreamAuth = upstreamUrl.username && upstreamUrl.password ? Buffer.from(`${upstreamUrl.username}:${upstreamUrl.password}`).toString('base64') : null;
const upstreamTarget = `http://${upstreamUrl.hostname}:${upstreamUrl.port}`;

// 解析上游SOCKS代理（支持认证）
const parseSocksUrl = (socksUrl) => {
  const url = new URL(socksUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port, 10),
    type: url.protocol === 'socks5:' ? 5 : 4,
    username: url.username || undefined,  // 注意: socks库中是username而不是userId
    password: url.password || undefined
  };
};

const socksProxy = parseSocksUrl(UPSTREAM_SOCKS);

console.log(`Upstream HTTP Proxy: ${upstreamTarget}`);
console.log(`Upstream HTTP Auth: ${upstreamAuth ? 'Present' : 'None'}`);
console.log(`Upstream SOCKS Proxy: ${socksProxy.host}:${socksProxy.port}`);
console.log(`Upstream SOCKS Auth: ${socksProxy.username ? 'Present' : 'None'}`);

// HTTP代理服务器
const httpServer = http.createServer((req, res) => {
  console.log(`[HTTP Request] Received HTTP request for: ${req.url}`);

  const parsedUrl = new URL(req.url);
  const requestOptions = {
    hostname: upstreamUrl.hostname,
    port: upstreamUrl.port,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      Host: parsedUrl.host
    }
  };

  if (upstreamAuth) {
    requestOptions.headers['Proxy-Authorization'] = `Basic ${upstreamAuth}`;
  }

  const proxyReq = http.request(requestOptions, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`[HTTP Error] ${err.message}`);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`Error: ${err.message}`);
  });

  req.pipe(proxyReq);
});

// 处理 CONNECT 请求 (HTTPS)
httpServer.on('connect', (req, clientSocket, head) => {
  console.log(`[CONNECT] Received CONNECT request for: ${req.url}`);

  // 向上游HTTP代理发起 CONNECT 请求
  const proxyReqOptions = {
    method: 'CONNECT',
    path: req.url,
    host: upstreamUrl.hostname,
    port: upstreamUrl.port,
    headers: {
      'Host': req.url,
      'User-Agent': req.headers['user-agent'] || 'Node-Proxy-Agent'
    },
    agent: false
  };

  if (upstreamAuth) {
    proxyReqOptions.headers['Proxy-Authorization'] = `Basic ${upstreamAuth}`;
    console.log('[CONNECT] Added Proxy-Authorization header.');
  }

  console.log(`[CONNECT] Sending request to upstream HTTP proxy for: ${req.url}`);
  const proxyReq = http.request(proxyReqOptions);

  proxyReq.on('connect', (proxyRes, proxySocket) => {
    console.log(`[CONNECT] Upstream response: ${proxyRes.statusCode}`);
    if (proxyRes.statusCode === 200) {
      console.log(`[CONNECT] Connection established via HTTP proxy to ${req.url}`);
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

      proxySocket.write(head);
      proxySocket.pipe(clientSocket);
      clientSocket.pipe(proxySocket);

      proxySocket.on('error', (err) => {
        console.error('[CONNECT] Proxy socket error:', err.message);
        if (clientSocket.writable) clientSocket.end();
      });
      clientSocket.on('error', (err) => {
        console.error('[CONNECT] Client socket error:', err.message);
        if (proxySocket.writable) proxySocket.end();
      });
      proxySocket.on('end', () => {
        if (clientSocket.writable) clientSocket.end();
      });
      clientSocket.on('end', () => {
        if (proxySocket.writable) proxySocket.end();
      });
    } else {
      console.error(`[CONNECT] Failed: Upstream returned ${proxyRes.statusCode}`);
      clientSocket.write(`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`);
      Object.keys(proxyRes.headers).forEach(key => {
        clientSocket.write(`${key}: ${proxyRes.headers[key]}\r\n`);
      });
      clientSocket.write('\r\n');
      clientSocket.end();
      proxySocket.end();
    }
  });

  proxyReq.on('error', (err) => {
    console.error(`[CONNECT] Error connecting to upstream HTTP proxy:`, err.message);
    if (clientSocket.writable) {
      clientSocket.write(`HTTP/1.1 502 Bad Gateway\r\nError: ${err.message}\r\n\r\n`);
    }
    clientSocket.end();
  });

  proxyReq.end();
});

httpServer.listen(LOCAL_PORT, '127.0.0.1', () => {
  console.log(`HTTP proxy server listening on http://127.0.0.1:${LOCAL_PORT}`);
  console.log(`Forwarding HTTP/HTTPS traffic through: ${UPSTREAM_PROXY}`);
});

// SOCKS代理服务器
const socksServer = net.createServer((socket) => {
  console.log('[SOCKS] New connection');

  socket.once('data', (chunk) => {
    // 检查是否是SOCKS协议
    if (chunk[0] === 0x05) { // SOCKS5
      console.log('[SOCKS] SOCKS5 handshake received');
      handleSocks5(socket, chunk);
    } else if (chunk[0] === 0x04) { // SOCKS4
      console.log('[SOCKS] SOCKS4 request received');
      handleSocks4(socket, chunk);
    } else {
      console.log('[SOCKS] Unknown protocol:', chunk[0]);
      socket.end();
    }
  });

  socket.on('error', (err) => {
    console.error('[SOCKS] Socket error:', err.message);
  });
});

// 处理SOCKS5请求
function handleSocks5(clientSocket, chunk) {
  // 握手阶段
  const numMethods = chunk[1];
  const methods = chunk.slice(2, 2 + numMethods);

  // 检查客户端是否支持无认证方式(0x00)
  if (methods.includes(0x00)) {
    // 回复客户端，我们选择无认证方式
    clientSocket.write(Buffer.from([0x05, 0x00]));

    // 等待客户端的连接请求
    clientSocket.once('data', (data) => {
      processSocks5Request(clientSocket, data);
    });
  } else {
    // 客户端不支持我们想要的认证方式
    clientSocket.write(Buffer.from([0x05, 0xFF]));
    clientSocket.end();
  }
}

// 处理SOCKS5连接请求
function processSocks5Request(clientSocket, data) {
  // 解析目标地址和端口
  let targetHost, targetPort;
  const cmd = data[1];  // 命令: 0x01=CONNECT, 0x02=BIND, 0x03=UDP
  const atyp = data[3]; // 地址类型: 0x01=IPv4, 0x03=域名, 0x04=IPv6

  if (cmd !== 0x01) {
    // 目前只支持CONNECT命令
    clientSocket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
    clientSocket.end();
    return;
  }

  if (atyp === 0x01) { // IPv4
    targetHost = `${data[4]}.${data[5]}.${data[6]}.${data[7]}`;
    targetPort = data.readUInt16BE(8);
  } else if (atyp === 0x03) { // 域名
    const hostLen = data[4];
    targetHost = data.slice(5, 5 + hostLen).toString();
    targetPort = data.readUInt16BE(5 + hostLen);
  } else if (atyp === 0x04) { // IPv6
    // 简化处理IPv6
    const ipv6Buffer = data.slice(4, 20);
    targetHost = Array.from(new Array(8), (_, i) =>
      ipv6Buffer.readUInt16BE(i * 2).toString(16)
    ).join(':');
    targetPort = data.readUInt16BE(20);
  }

  console.log(`[SOCKS5] Request to connect to ${targetHost}:${targetPort}`);

  // 使用更新的 SocksClient API
  const options = {
    proxy: {
      host: socksProxy.host,
      port: socksProxy.port,
      type: socksProxy.type,
      userId: socksProxy.username,  // 注意在一些版本中是userId，但新版本可能是username
      password: socksProxy.password
    },
    command: 'connect',
    destination: {
      host: targetHost,
      port: targetPort
    }
  };

  // 使用新的 SocksClient.createConnection API
  SocksClient.createConnection(options)
    .then(info => {
      const { socket: proxySocket } = info;

      // 连接成功，向客户端发送成功响应
      const responseBuffer = Buffer.from([
        0x05, // VER: SOCKS5
        0x00, // REP: 成功
        0x00, // RSV: 保留字段
        0x01, // ATYP: IPv4
        0, 0, 0, 0, // BND.ADDR: 0.0.0.0 (绑定的地址，通常不重要)
        0, 0  // BND.PORT: 0 (绑定的端口，通常不重要)
      ]);
      clientSocket.write(responseBuffer);

      // 建立双向数据流
      proxySocket.pipe(clientSocket);
      clientSocket.pipe(proxySocket);

      proxySocket.on('error', (err) => {
        console.error('[SOCKS5] Proxy socket error:', err.message);
        if (clientSocket.writable) clientSocket.end();
      });

      clientSocket.on('error', (err) => {
        console.error('[SOCKS5] Client socket error:', err.message);
        if (proxySocket.writable) proxySocket.end();
      });
    })
    .catch(err => {
      console.error('[SOCKS5] Connection error:', err.message);
      // 向客户端返回失败
      clientSocket.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
      clientSocket.end();
    });
}

// 处理SOCKS4请求
function handleSocks4(clientSocket, chunk) {
  const cmd = chunk[1];  // 命令: 0x01=CONNECT, 0x02=BIND

  if (cmd !== 0x01) {
    // 目前只支持CONNECT命令
    clientSocket.write(Buffer.from([0x00, 0x5B, 0, 0, 0, 0, 0, 0]));
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

  // 使用更新的 SocksClient API
  const options = {
    proxy: {
      host: socksProxy.host,
      port: socksProxy.port,
      type: socksProxy.type,
      userId: socksProxy.username,
      password: socksProxy.password
    },
    command: 'connect',
    destination: {
      host: ip,
      port: port
    }
  };

  // 使用新的 SocksClient.createConnection API
  SocksClient.createConnection(options)
    .then(info => {
      const { socket: proxySocket } = info;

      // 连接成功，向客户端发送成功响应
      clientSocket.write(Buffer.from([0x00, 0x5A, 0, 0, 0, 0, 0, 0]));

      // 建立双向数据流
      proxySocket.pipe(clientSocket);
      clientSocket.pipe(proxySocket);

      proxySocket.on('error', (err) => {
        console.error('[SOCKS4] Proxy socket error:', err.message);
        if (clientSocket.writable) clientSocket.end();
      });

      clientSocket.on('error', (err) => {
        console.error('[SOCKS4] Client socket error:', err.message);
        if (proxySocket.writable) proxySocket.end();
      });
    })
    .catch(err => {
      console.error('[SOCKS4] Connection error:', err.message);
      // 向客户端返回失败
      clientSocket.write(Buffer.from([0x00, 0x5B, 0, 0, 0, 0, 0, 0]));
      clientSocket.end();
    });
}

socksServer.listen(SOCKS_PORT, '127.0.0.1', () => {
  console.log(`SOCKS proxy server listening on socks://127.0.0.1:${SOCKS_PORT}`);
  console.log(`Forwarding SOCKS traffic through: ${UPSTREAM_SOCKS}`);
});

socksServer.on('error', (err) => {
  console.error('[SOCKS Server Error]', err.message);
});

httpServer.on('error', (err) => {
  console.error('[HTTP Server Error]', err.message);
});

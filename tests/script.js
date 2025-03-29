const http = require('http');
const url = require('url');
const { Buffer } = require('buffer'); // 明确引入 Buffer

const LOCAL_PORT = 8080;
const UPSTREAM_PROXY = 'http://test:test@172.16.229.142:7890';

const upstreamUrl = new URL(UPSTREAM_PROXY);
const upstreamAuth = upstreamUrl.username && upstreamUrl.password ? Buffer.from(`${upstreamUrl.username}:${upstreamUrl.password}`).toString('base64') : null;
const upstreamTarget = `http://${upstreamUrl.hostname}:${upstreamUrl.port}`;

console.log(`Upstream Target: ${upstreamTarget}`);
console.log(`Upstream Auth: ${upstreamAuth ? 'Present' : 'None'}`);

// 本地 HTTP 服务器
const server_revised = http.createServer((req, res) => {
  console.log(`[Request In] Received HTTP request for: ${req.url}`);

  const parsedUrl = url.parse(req.url);
  const requestOptions = {
    hostname: upstreamUrl.hostname,
    port: upstreamUrl.port,
    path: req.url, // 代理服务器会解析 path
    method: req.method,
    headers: {
      ...req.headers,
      Host: parsedUrl.host // 确保 Host 头正确
    }
  };

  // 如果需要身份验证，则添加 `Proxy-Authorization` 头
  if (upstreamAuth) {
    requestOptions.headers['Proxy-Authorization'] = `Basic ${upstreamAuth}`;
  }

  // 通过上游代理发送请求
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
server_revised.on('connect', (req, clientSocket, head) => {
  console.log(`[Request In] Received CONNECT request for: ${req.url}`);
  const [targetHost, targetPort] = req.url.split(':');
  const port = targetPort || 443;

  // 向**上游代理**发起 CONNECT 请求
  const proxyReqOptions = {
    method: 'CONNECT',
    path: req.url, // host:port
    host: upstreamUrl.hostname,
    port: upstreamUrl.port,
    headers: {
      'Host': req.url,
      'User-Agent': req.headers['user-agent'] || 'Node-Proxy-Agent'
    },
    agent: false // 重要：为 CONNECT 请求创建独立的连接，不使用全局 agent
  };

  if (upstreamAuth) {
    proxyReqOptions.headers['Proxy-Authorization'] = `Basic ${upstreamAuth}`;
    console.log('[CONNECT Forwarding] Added Proxy-Authorization header.');
  }

  console.log(`[CONNECT Forwarding] Sending CONNECT request to upstream ${upstreamUrl.hostname}:${upstreamUrl.port} for target ${req.url}`);
  const proxyReq = http.request(proxyReqOptions);

  proxyReq.on('connect', (proxyRes, proxySocket, proxyHead) => {
    console.log(`[CONNECT Upstream Response] Status: ${proxyRes.statusCode}`);
    if (proxyRes.statusCode === 200) {
      console.log(`[CONNECT Success] Connection established via upstream proxy to ${req.url}`);
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

      // 隧道打通，双向绑定数据流
      proxySocket.write(head);
      proxySocket.pipe(clientSocket);
      clientSocket.pipe(proxySocket);

      proxySocket.on('error', (err) => {
        console.error('[CONNECT Proxy Socket Error]', `Error: ${err.message}`, `Code: ${err.code || 'N/A'}`);
        if (clientSocket.writable) clientSocket.end();
      });
      clientSocket.on('error', (err) => {
        console.error('[CONNECT Client Socket Error]', `Error: ${err.message}`, `Code: ${err.code || 'N/A'}`);
        if (proxySocket.writable) proxySocket.end();
      });
      proxySocket.on('end', () => {
        console.log('[CONNECT Proxy Socket] Ended.');
        if (clientSocket.writable) clientSocket.end();
      });
      clientSocket.on('end', () => {
        console.log('[CONNECT Client Socket] Ended.');
        if (proxySocket.writable) proxySocket.end();
      });

    } else {
      console.error(`[CONNECT Failed] Upstream proxy returned status ${proxyRes.statusCode}`);
      clientSocket.write(`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`);
      // 可以选择性地将上游代理的响应头传回
      Object.keys(proxyRes.headers).forEach(key => {
        clientSocket.write(`${key}: ${proxyRes.headers[key]}\r\n`);
      });
      clientSocket.write('\r\n');
      clientSocket.end();
      proxySocket.end(); // 关闭与上游的连接
    }
  });

  proxyReq.on('error', (err) => {
    console.error(`[CONNECT Error] Error connecting to upstream proxy for ${req.url}:`, `Error: ${err.message}`, `Code: ${err.code || 'N/A'}`);
    if (clientSocket.writable) {
      clientSocket.write(`HTTP/1.1 502 Bad Gateway\r\nProxy-Error: Cannot connect to upstream proxy (${err.message})\r\nContent-Length: 0\r\n\r\n`);
    }
    clientSocket.end();
  });

  proxyReq.end(); // 发送 CONNECT 请求
});

server_revised.listen(LOCAL_PORT, '127.0.0.1', () => {
  console.log(`Forwarding proxy server listening on http://127.0.0.1:${LOCAL_PORT}`);
  console.log(`Forwarding all traffic through: ${UPSTREAM_PROXY}`);
});

server_revised.on('error', (e) => {
  console.error('[Server Error]', `Error: ${e.message}`, `Code: ${e.code || 'N/A'}`);
});

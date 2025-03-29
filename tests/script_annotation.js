const http = require('http');       // 导入HTTP模块，用于创建HTTP服务器和客户端
const { Buffer } = require('buffer'); // 明确引入Buffer类，用于Base64编码

// 设置本地代理服务器监听的端口
const LOCAL_PORT = 8080;
// 设置上游代理服务器的地址，格式为：协议://用户名:密码@主机:端口
const UPSTREAM_PROXY = 'http://test:test@172.16.229.142:7890';

// 解析上游代理URL为URL对象
const upstreamUrl = new URL(UPSTREAM_PROXY);
// 如果上游代理有用户名和密码，则创建Base64编码的认证字符串
const upstreamAuth = upstreamUrl.username && upstreamUrl.password ?
  Buffer.from(`${upstreamUrl.username}:${upstreamUrl.password}`).toString('base64') : null;
// 构建上游代理的目标地址（不包含认证信息）
const upstreamTarget = `http://${upstreamUrl.hostname}:${upstreamUrl.port}`;

// 打印上游代理信息，用于调试
console.log(`Upstream Target: ${upstreamTarget}`);
console.log(`Upstream Auth: ${upstreamAuth ? 'Present' : 'None'}`);

// 创建本地HTTP代理服务器
const server_revised = http.createServer((req, res) => {
  // 记录接收到的HTTP请求
  console.log(`[Request In] Received HTTP request for: ${req.url}`);

  // 解析请求URL
  const parsedUrl = new URL(req.url);
  // 设置发送到上游代理的请求选项
  const requestOptions = {
    hostname: upstreamUrl.hostname,  // 上游代理主机名
    port: upstreamUrl.port,          // 上游代理端口
    path: req.url,                   // 请求路径（代理服务器会进一步解析）
    method: req.method,              // 保持原始请求方法
    headers: {
      ...req.headers,                // 复制原始请求的所有头信息
      Host: parsedUrl.host           // 确保Host头正确设置为目标服务器
    }
  };

  // 如果上游代理需要认证，添加Proxy-Authorization头
  if (upstreamAuth) {
    requestOptions.headers['Proxy-Authorization'] = `Basic ${upstreamAuth}`;
  }

  // 创建并发送到上游代理的HTTP请求
  const proxyReq = http.request(requestOptions, (proxyRes) => {
    // 收到上游代理响应后，将状态码和头信息写回客户端
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    // 将上游代理响应的数据流转发给客户端
    proxyRes.pipe(res);
  });

  // 处理与上游代理通信时可能发生的错误
  proxyReq.on('error', (err) => {
    console.error(`[HTTP Error] ${err.message}`);
    // 返回502错误给客户端
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`Error: ${err.message}`);
  });

  // 将客户端请求的数据流转发给上游代理
  req.pipe(proxyReq);
});

// 处理CONNECT请求（用于HTTPS连接）
server_revised.on('connect', (req, clientSocket, head) => {
  // 记录接收到的CONNECT请求
  console.log(`[Request In] Received CONNECT request for: ${req.url}`);

  // 设置发送到上游代理的CONNECT请求选项
  const proxyReqOptions = {
    method: 'CONNECT',            // 使用CONNECT方法
    path: req.url,                // 目标服务器地址（host:port）
    host: upstreamUrl.hostname,   // 上游代理主机名
    port: upstreamUrl.port,       // 上游代理端口
    headers: {
      'Host': req.url,            // 设置Host头为目标服务器
      'User-Agent': req.headers['user-agent'] || 'Node-Proxy-Agent'  // 传递或设置默认User-Agent
    },
    agent: false                  // 重要：为CONNECT请求创建独立的连接，不使用全局agent
  };

  // 如果上游代理需要认证，添加Proxy-Authorization头
  if (upstreamAuth) {
    proxyReqOptions.headers['Proxy-Authorization'] = `Basic ${upstreamAuth}`;
    console.log('[CONNECT Forwarding] Added Proxy-Authorization header.');
  }

  // 记录CONNECT转发信息
  console.log(`[CONNECT Forwarding] Sending CONNECT request to upstream ${upstreamUrl.hostname}:${upstreamUrl.port} for target ${req.url}`);
  // 创建发送到上游代理的CONNECT请求
  const proxyReq = http.request(proxyReqOptions);

  // 处理上游代理对CONNECT请求的响应
  proxyReq.on('connect', (proxyRes, proxySocket) => {
    // 记录上游代理的响应状态
    console.log(`[CONNECT Upstream Response] Status: ${proxyRes.statusCode}`);

    // 如果上游代理成功建立连接
    if (proxyRes.statusCode === 200) {
      console.log(`[CONNECT Success] Connection established via upstream proxy to ${req.url}`);
      // 向客户端发送连接成功的响应
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

      // 隧道已建立，开始双向转发数据
      proxySocket.write(head);  // 发送客户端发送的初始数据（如果有）
      proxySocket.pipe(clientSocket);  // 上游代理数据 -> 客户端
      clientSocket.pipe(proxySocket);  // 客户端数据 -> 上游代理

      // 处理上游代理socket的错误
      proxySocket.on('error', (err) => {
        console.error('[CONNECT Proxy Socket Error]', `Error: ${err.message}`, `Code: ${err.code || 'N/A'}`);
        if (clientSocket.writable) clientSocket.end();  // 关闭客户端连接
      });

      // 处理客户端socket的错误
      clientSocket.on('error', (err) => {
        console.error('[CONNECT Client Socket Error]', `Error: ${err.message}`, `Code: ${err.code || 'N/A'}`);
        if (proxySocket.writable) proxySocket.end();  // 关闭与上游代理的连接
      });

      // 处理上游代理socket结束事件
      proxySocket.on('end', () => {
        console.log('[CONNECT Proxy Socket] Ended.');
        if (clientSocket.writable) clientSocket.end();  // 关闭客户端连接
      });

      // 处理客户端socket结束事件
      clientSocket.on('end', () => {
        console.log('[CONNECT Client Socket] Ended.');
        if (proxySocket.writable) proxySocket.end();  // 关闭与上游代理的连接
      });

    } else {
      // 如果上游代理连接失败
      console.error(`[CONNECT Failed] Upstream proxy returned status ${proxyRes.statusCode}`);
      // 向客户端发送失败响应
      clientSocket.write(`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`);
      // 将上游代理的响应头传回客户端
      Object.keys(proxyRes.headers).forEach(key => {
        clientSocket.write(`${key}: ${proxyRes.headers[key]}\r\n`);
      });
      clientSocket.write('\r\n');
      clientSocket.end();  // 关闭客户端连接
      proxySocket.end();   // 关闭与上游的连接
    }
  });

  // 处理与上游代理通信时可能发生的错误
  proxyReq.on('error', (err) => {
    console.error(`[CONNECT Error] Error connecting to upstream proxy for ${req.url}:`, `Error: ${err.message}`, `Code: ${err.code || 'N/A'}`);
    // 如果客户端socket仍然可写，发送错误响应
    if (clientSocket.writable) {
      clientSocket.write(`HTTP/1.1 502 Bad Gateway\r\nProxy-Error: Cannot connect to upstream proxy (${err.message})\r\nContent-Length: 0\r\n\r\n`);
    }
    clientSocket.end();  // 关闭客户端连接
  });

  // 发送CONNECT请求到上游代理
  proxyReq.end();
});

// 启动服务器，监听指定端口
server_revised.listen(LOCAL_PORT, '127.0.0.1', () => {
  console.log(`Forwarding proxy server listening on http://127.0.0.1:${LOCAL_PORT}`);
  console.log(`Forwarding all traffic through: ${UPSTREAM_PROXY}`);
});

// 处理服务器可能发生的错误
server_revised.on('error', (e) => {
  console.error('[Server Error]', `Error: ${e.message}`, `Code: ${e.code || 'N/A'}`);
});

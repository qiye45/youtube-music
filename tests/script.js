const http = require('http');
const httpProxy = require('http-proxy');
const url = require('url');

const LOCAL_PORT = 8080;
const UPSTREAM_PROXY = 'http://test:test@172.16.229.142:7890';

// 解析上游代理 URL 以便获取认证信息和目标
const upstreamUrl = new URL(UPSTREAM_PROXY);
const upstreamAuth = upstreamUrl.username && upstreamUrl.password ? Buffer.from(`${upstreamUrl.username}:${upstreamUrl.password}`).toString('base64') : null;
const upstreamTarget = `http://${upstreamUrl.hostname}:${upstreamUrl.port}`;

const proxy = httpProxy.createProxyServer({});

const server = http.createServer((req, res) => {
    console.log(`Request received for: ${req.url}`);

    // 直接将请求转发给 http-proxy 处理
    // http-proxy 似乎不直接支持在 target 中包含认证的上游代理
    // 我们需要在 'proxyReq' 事件中手动添加 Proxy-Authorization 头
    proxy.web(req, res, {
        target: req.url, // 目标是客户端请求的原始 URL
        changeOrigin: false, // 保持原始 Host 头
        // 我们需要一个 agent 来将请求发送到上游代理
        agent: new http.Agent({ // Node 14+ http.Agent 支持 proxy 选项不完善或不直接用于此场景
            // 我们将利用 proxyReq 事件修改请求
        }),
        selfHandleResponse: false // 让 http-proxy 处理响应
    }, (e) => {
        console.error('Proxy error:', e);
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Proxy Error: Could not connect to upstream or target.');
    });
});

// 处理 CONNECT 请求 (HTTPS)
server.on('connect', (req, clientSocket, head) => {
    console.log(`CONNECT request for: ${req.url}`);
    const [targetHost, targetPort] = req.url.split(':');
    const port = targetPort || 443; // 默认 HTTPS 端口

    // 向**上游代理**发起 CONNECT 请求
    const proxyReq = http.request({
        method: 'CONNECT',
        path: req.url, // host:port
        host: upstreamUrl.hostname,
        port: upstreamUrl.port,
        headers: {
            'Host': req.url, // CONNECT 请求的目标
            'User-Agent': req.headers['user-agent'] || 'Node-Proxy-Agent',
            // 添加上游代理认证
            ...(upstreamAuth && { 'Proxy-Authorization': `Basic ${upstreamAuth}` })
        },
        // agent: false // 使用默认全局 agent 或特定 agent
    });

    proxyReq.on('connect', (proxyRes, proxySocket, proxyHead) => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); // 通知客户端连接已建立

        // 将客户端和上游代理的 socket 连接起来
        proxySocket.write(head);
        proxySocket.pipe(clientSocket);
        clientSocket.pipe(proxySocket);

        proxySocket.on('error', (err) => {
            console.error('Proxy socket error:', err);
            clientSocket.end();
        });
        clientSocket.on('error', (err) => {
            console.error('Client socket error:', err);
            proxySocket.end();
        });
        proxySocket.on('end', () => clientSocket.end());
        clientSocket.on('end', () => proxySocket.end());
    });

    proxyReq.on('error', (err) => {
        console.error(`Error connecting to upstream proxy for CONNECT ${req.url}:`, err);
        clientSocket.write(`HTTP/1.1 502 Bad Gateway\r\n\r\n`);
        clientSocket.end();
    });

    proxyReq.end(); // 发送 CONNECT 请求
});

// 监听 'proxyReq' 事件来修改出站请求 (适用于普通 HTTP 请求)
proxy.on('proxyReq', (proxyReq, req, res, options) => {
    // 对于非 CONNECT 请求，我们需要将请求路由到上游代理
    // http-proxy 的 target 应该设为上游代理，但它处理认证和绝对 URI 的方式可能不直接
    // 替代方法：修改请求路径和头部，使其符合代理请求格式

    // 目标是上游代理
    proxyReq.path = req.url; // 代理请求需要完整的 URL 作为路径
    proxyReq.setHeader('Host', url.parse(req.url).host); // Host 应该是目标服务器

    // 添加上游代理认证
    if (upstreamAuth) {
        proxyReq.setHeader('Proxy-Authorization', `Basic ${upstreamAuth}`);
    }
    console.log(`Forwarding HTTP request for ${req.url} via upstream proxy`);

    // **重要**: 需要修改 http-proxy 的目标指向 上游代理
    // **修正思路**: server.js 应该将所有请求导向上游代理，而不是目标 URL
    // 让我们重构一下 createServer 部分
});

// ---- 重构 createServer ----
const proxy_for_upstream = httpProxy.createProxyServer({
  target: upstreamTarget, // 目标是上游代理
  changeOrigin: true, // 可能需要，取决于上游代理
  secure: false // 如果上游是 http
});

proxy_for_upstream.on('proxyReq', (proxyReq, req, res, options) => {
  // 对于发送到上游代理的请求，需要设置 Proxy-Authorization
  if (upstreamAuth) {
    proxyReq.setHeader('Proxy-Authorization', `Basic ${upstreamAuth}`);
  }
  // 确保路径是完整的 URL (http-proxy 通常会处理)
  console.log(`Forwarding HTTP request for ${req.url} via upstream proxy ${upstreamTarget}`);
});

proxy_for_upstream.on('error', (err, req, res) => {
  console.error('Upstream proxy error:', err);
  res.writeHead(502, { 'Content-Type': 'text/plain' });
  res.end('Proxy Error: Could not connect to upstream proxy.');
});

const server_revised = http.createServer((req, res) => {
    console.log(`Request received for: ${req.url}`);
    // 所有非 CONNECT 请求都通过上游代理转发
    proxy_for_upstream.web(req, res);
});

// CONNECT 处理部分保持不变，因为它直接与上游代理交互
server_revised.on('connect', server.listeners('connect')[0]); // 复用之前的 CONNECT 处理器

server_revised.listen(LOCAL_PORT, '127.0.0.1', () => {
    console.log(`Forwarding proxy server listening on http://127.0.0.1:${LOCAL_PORT}`);
    console.log(`Forwarding all traffic through: ${UPSTREAM_PROXY}`);
});

server_revised.on('error', (e) => {
    console.error("Server error:", e);
});

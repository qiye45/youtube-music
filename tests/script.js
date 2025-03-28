const http = require('http');
const httpProxy = require('http-proxy');
const url = require('url');
const { Buffer } = require('buffer'); // 明确引入 Buffer

const LOCAL_PORT = 8080;
const UPSTREAM_PROXY = 'http://test:test@172.16.229.142:7890';

const upstreamUrl = new URL(UPSTREAM_PROXY);
const upstreamAuth = upstreamUrl.username && upstreamUrl.password ? Buffer.from(`${upstreamUrl.username}:${upstreamUrl.password}`).toString('base64') : null;
const upstreamTarget = `http://${upstreamUrl.hostname}:${upstreamUrl.port}`;

console.log(`Upstream Target: ${upstreamTarget}`);
console.log(`Upstream Auth: ${upstreamAuth ? 'Present' : 'None'}`);

// 代理服务器，用于转发到上游代理
const proxy_for_upstream = httpProxy.createProxyServer({
    target: upstreamTarget,
    changeOrigin: true, // 通常需要，让上游代理正确处理 Host
    secure: false // 上游代理是 http
});

// 监听发送到上游代理的请求事件
proxy_for_upstream.on('proxyReq', (proxyReq, req, res, options) => {
    console.log(`[Forwarding] Sending request for ${req.url} to upstream ${upstreamTarget}`);
    // 确保路径是完整的 URL (http-proxy 通常会处理，但确认下)
    // proxyReq.path = req.url;
    if (upstreamAuth) {
        proxyReq.setHeader('Proxy-Authorization', `Basic ${upstreamAuth}`);
        console.log('[Forwarding] Added Proxy-Authorization header.');
    }
});

// 监听从上游代理收到的响应事件 <--- 添加这个
proxy_for_upstream.on('proxyRes', (proxyRes, req, res) => {
    console.log(`[Upstream Response] Status: ${proxyRes.statusCode}`);
    console.log(`[Upstream Response] Headers: ${JSON.stringify(proxyRes.headers, null, 2)}`);
    // 注意：此时 http-proxy 会自动将响应流回客户端 (res)
    // 如果需要修改响应，可以在这里操作，但通常不需要
});

// 增强错误处理
proxy_for_upstream.on('error', (err, req, res) => {
    console.error('[Upstream Proxy Error]', `Error: ${err.message}`, `Code: ${err.code || 'N/A'}`);
    // 确保在发送响应之前检查 headersSent
    if (res && !res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end(`Proxy Error: Could not connect or communicate with upstream proxy.\n${err.message}`);
    } else if (res) {
        // 如果头已发送，可能只能尝试关闭连接
        console.error('[Upstream Proxy Error] Headers already sent, cannot send error response.');
        res.end();
    } else {
        console.error('[Upstream Proxy Error] Response object is not available.');
    }
});

// 本地 HTTP 服务器
const server_revised = http.createServer((req, res) => {
    console.log(`[Request In] Received HTTP request for: ${req.url}`);
    // 所有非 CONNECT 请求都通过上游代理转发
    proxy_for_upstream.web(req, res);
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
            'User-Agent': req.headers['user-agent'] || 'Node-Proxy-Agent',
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
    console.error("[Server Error]", `Error: ${e.message}`, `Code: ${e.code || 'N/A'}`);
});

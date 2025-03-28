const http = require('http');
const net = require('net');
const { URL } = require('url');

class ProxyServer {
    constructor({ local_host = '127.0.0.1', local_port = 8081, remote_host, remote_port, username='test', password='test' }) {
        if (!remote_host || !remote_port) {
            throw new Error('必须提供 remote_host 和 remote_port');
        }

        this.config = { local_host, local_port, remote_host, remote_port, username, password };
        this.server = http.createServer(this.httpHandler.bind(this));
        this.server.on('connect', this.httpsHandler.bind(this));
    }

    // 处理 HTTP 请求
    httpHandler(req, res) {
        const { remote_host, remote_port, username, password } = this.config;
        const options = {
            hostname: remote_host,
            port: remote_port,
            method: req.method,
            path: req.url,
            headers: {
                ...req.headers,
                'Proxy-Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
            }
        };

        const proxyReq = http.request(options, proxyRes => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);
        });

        proxyReq.on('error', err => {
            console.error('HTTP Proxy Error:', err.message);
            res.writeHead(500);
            res.end('Proxy Server Error');
        });

        req.pipe(proxyReq);
    }

    // 处理 HTTPS (CONNECT 方法)
    httpsHandler(req, clientSocket, head) {
        const { port, hostname } = new URL(`http://${req.url}`);
        const remoteSocket = net.connect(port, hostname, () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            remoteSocket.write(head);
            remoteSocket.pipe(clientSocket);
            clientSocket.pipe(remoteSocket);
        });

        remoteSocket.on('error', err => {
            console.error('HTTPS Proxy Error:', err.message);
            clientSocket.end();
        });
    }

    // 启动代理服务器
    start() {
        const { local_host, local_port, remote_host, remote_port } = this.config;
        this.server.listen(local_port, local_host, () => {
            console.log(`[Proxy Server] 运行于 http://${local_host}:${local_port}`);
            console.log(`[Proxy Forwarding] 转发到 http://${remote_host}:${remote_port}`);
        });
    }

    // 关闭服务器
    stop() {
        this.server.close(() => console.log('[Proxy Server] 已停止'));
    }
}

module.exports = ProxyServer;

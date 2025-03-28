const http = require('http');
const https = require('https');
const net = require('net');
const dgram = require('dgram');
const httpProxy = require('http-proxy');

// 代理服务器信息
const PROXY_HOST = '172.16.229.142'; // 代理服务器地址
const PROXY_PORT = 7890; // 代理服务器端口
const PROXY_USER = 'test'; // 代理用户名
const PROXY_PASS = 'test'; // 代理密码

// 创建 HTTP 代理服务器
const httpProxyServer = httpProxy.createProxyServer({
  target: `http://${PROXY_HOST}:${PROXY_PORT}`,
  changeOrigin: true,
  secure: false, // 忽略 SSL 证书错误
  auth: `${PROXY_USER}:${PROXY_PASS}` // 代理认证
});

// 创建 HTTP 服务器
const httpServer = http.createServer((req, res) => {
  console.log(`Proxying HTTP request for: ${req.url}`);
  httpProxyServer.web(req, res, {}, (err) => {
    console.error('HTTP Proxy error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('HTTP Proxy Server Error');
  });
});

httpServer.on('connect', (req, clientSocket, head) => {
  console.log(`Proxying HTTPS request for: ${req.url}`);

  httpProxyServer.ws(req, clientSocket, head, {}, (err) => {
    console.error('HTTPS Proxy error:', err);
    clientSocket.end();
  });
});
httpServer.on('connect', (req, clientSocket, head) => {
  console.log(`Proxying HTTPS request for: ${req.url}`);

  const serverSocket = net.connect(PROXY_PORT, PROXY_HOST, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    serverSocket.write(head);
    clientSocket.pipe(serverSocket).pipe(clientSocket);
  });

  serverSocket.on('error', (err) => {
    console.error('HTTPS Proxy error:', err);
    clientSocket.end();
  });
});

// 创建 HTTPS 代理服务器
// httpServer.on('connect', (req, clientSocket, head) => {
//   console.log(`Proxying HTTPS request for: ${req.url}`);
//   const serverSocket = net.connect(PROXY_PORT, PROXY_HOST, () => {
//     clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
//     serverSocket.write(head);
//     clientSocket.pipe(serverSocket).pipe(clientSocket);
//   });
//
//   serverSocket.on('error', (err) => {
//     console.error('HTTPS Proxy error:', err);
//     clientSocket.end();
//   });
// });

// 创建 TCP 代理服务器
const tcpServer = net.createServer((clientSocket) => {
  console.log('TCP connection established');
  const serverSocket = net.connect(PROXY_PORT, PROXY_HOST, () => {
    clientSocket.pipe(serverSocket).pipe(clientSocket);
  });

  serverSocket.on('error', (err) => {
    console.error('TCP Proxy error:', err);
    clientSocket.end();
  });
});

// 创建 UDP 代理服务器
const udpServer = dgram.createSocket('udp4');
udpServer.on('message', (msg, rinfo) => {
  console.log(`UDP message from ${rinfo.address}:${rinfo.port}`);
  const client = dgram.createSocket('udp4');
  client.send(msg, 0, msg.length, PROXY_PORT, PROXY_HOST, (err) => {
    if (err) console.error('UDP Proxy error:', err);
    client.close();
  });
});

// 监听端口
const HTTP_PORT = 8080;
const TCP_PORT = 8081;
const UDP_PORT = 8082;
httpServer.listen(HTTP_PORT, () => console.log(`HTTP/HTTPS Proxy running on port ${HTTP_PORT}`));
tcpServer.listen(TCP_PORT, () => console.log(`TCP Proxy running on port ${TCP_PORT}`));
udpServer.bind(UDP_PORT, () => console.log(`UDP Proxy running on port ${UDP_PORT}`));

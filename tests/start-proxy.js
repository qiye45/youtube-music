// const ProxyServer = require('./forward_authenticated_proxy');
//
// const proxy = new ProxyServer({
//     local_host: '127.0.0.1',
//     local_port: 8081,
//     remote_host: '172.16.229.142',
//     remote_port: 7890,
//     usr: 'test',
//     pwd: 'test'
// });
//
// proxy.start();


var portforward = require('./script')

console.log(portforward)
portforward()

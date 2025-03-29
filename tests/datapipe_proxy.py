#!/usr/bin/env python
# -*- coding: utf-8 -*-

import socket
import select
import time
import argparse
import sys
import logging
import struct
from urllib.parse import urlparse
from socket import inet_aton, inet_ntoa

# 尝试导入 socks 库，如果失败则提示安装
try:
    import socks
except ImportError:
    print("错误：需要 PySocks 库来支持 SOCKS 代理。")
    print("请使用 'pip install PySocks' 命令安装。")
    sys.exit(1)

# --- 配置常量 ---
BUFFER_SIZE = 4096
SELECT_TIMEOUT = 1.0
CONNECT_TIMEOUT = 10 # 连接上游代理或目标的超时时间
IDLE_TIMEOUT = 300   # 空闲连接超时时间

# SOCKS5 协议常量
SOCKS_VERSION = 5
METHOD_NO_AUTH = 0x00
METHOD_NO_ACCEPTABLE = 0xFF
CMD_CONNECT = 0x01
ADDR_TYPE_IPV4 = 0x01
ADDR_TYPE_DOMAIN = 0x03
ADDR_TYPE_IPV6 = 0x04
REPLY_SUCCESS = 0x00
REPLY_GENERAL_FAILURE = 0x01
REPLY_CONNECTION_REFUSED = 0x05
# ... 可以添加更多 SOCKS 回复代码

# 客户端连接状态
STATE_EXPECT_METHOD = 1
STATE_EXPECT_REQUEST = 2
STATE_CONNECTED = 3
STATE_ERROR = 4 # 标记出错，待清理

# --- 日志配置 ---
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(levelname)s - %(message)s',
                    datefmt='%Y-%m-%d %H:%M:%S')

# --- 代理配置解析 ---
def parse_proxy_uri(proxy_uri):
    """
    解析上游 SOCKS5 代理 URI (例如: socks5://user:pass@host:port)。
    """
    try:
        parsed = urlparse(proxy_uri)
        if parsed.scheme.lower() not in ['socks5', 'socks5h']:
            raise ValueError("仅支持 socks5 或 socks5h 协议")

        proxy_type = socks.SOCKS5
        proxy_host = parsed.hostname
        proxy_port = parsed.port
        proxy_user = parsed.username
        proxy_pass = parsed.password

        if not proxy_host or not proxy_port:
             raise ValueError("代理 URI 必须包含主机和端口")

        return proxy_type, proxy_host, proxy_port, proxy_user, proxy_pass
    except Exception as e:
        logging.error(f"解析代理 URI '{proxy_uri}' 时出错: {e}")
        return None, None, None, None, None

# --- 数据转发 ---
def forward_data(source_sock, dest_sock, sock_map):
    """
    从源 socket 读取数据并转发到目标 socket。
    如果出错或连接关闭，标记 socket 状态为 STATE_ERROR。
    返回读取/发送的字节数，错误或关闭返回 <= 0。
    """
    global last_activity # 引用全局活动时间记录

    try:
        data = source_sock.recv(BUFFER_SIZE)
        if not data:  # 对端关闭连接
            logging.info(f"连接 {source_sock.getpeername() if source_sock.fileno() != -1 else '已关闭'} 已关闭。")
            return -1 # 标记关闭
        sent_len = dest_sock.sendall(data) # 使用 sendall 确保所有数据发送
        if sent_len is None: # sendall 成功时返回 None
             now = time.time()
             # 更新双方活动时间
             last_activity[source_sock] = now
             if dest_sock in last_activity:
                 last_activity[dest_sock] = now
             return len(data)
        else: # 理论上 sendall 要么成功要么抛异常
             logging.warning(f"发送数据到 {dest_sock.getpeername() if dest_sock.fileno() != -1 else '未知'} 时可能未完全发送。")
             return -1 # 标记错误
    except (socket.error, BrokenPipeError, ConnectionResetError) as e:
        # 过滤掉非阻塞 IO 导致的 EWOULDBLOCK/EAGAIN 错误
        if isinstance(e, socket.error) and e.errno in (socket.EWOULDBLOCK, socket.EAGAIN):
            return 0 # 表示暂时没有数据可读写，不是真正错误
        logging.error(f"转发数据时发生 socket 错误 ({source_sock.fileno()} -> {dest_sock.fileno()}): {e}")
        return -1 # 标记错误
    except Exception as e:
        logging.error(f"转发数据时发生未知错误: {e}")
        return -1 # 标记错误

# --- SOCKS5 协议处理 ---

def handle_method_selection(client_sock, data, sock_map):
    """处理客户端的方法选择阶段"""
    global client_states
    if len(data) < 3:
        logging.warning(f"客户端 {client_sock.getpeername()} 发送的方法选择请求过短")
        client_states[client_sock] = STATE_ERROR
        return

    version, nmethods = struct.unpack("!BB", data[:2])
    methods = list(data[2:2+nmethods])

    if version != SOCKS_VERSION:
        logging.warning(f"客户端 {client_sock.getpeername()} SOCKS 版本 ({version}) 不支持")
        client_states[client_sock] = STATE_ERROR
        return

    # 本脚本仅支持“无需认证”
    if METHOD_NO_AUTH in methods:
        reply = struct.pack("!BB", SOCKS_VERSION, METHOD_NO_AUTH)
        try:
            client_sock.sendall(reply)
            client_states[client_sock] = STATE_EXPECT_REQUEST # 进入下一状态
            logging.debug(f"客户端 {client_sock.getpeername()} 方法选择成功 (No Auth)")
        except socket.error as e:
            logging.error(f"向客户端 {client_sock.getpeername()} 发送方法确认失败: {e}")
            client_states[client_sock] = STATE_ERROR
    else:
        logging.warning(f"客户端 {client_sock.getpeername()} 不支持 No Auth 方法")
        reply = struct.pack("!BB", SOCKS_VERSION, METHOD_NO_ACCEPTABLE)
        try:
            client_sock.sendall(reply)
        except socket.error:
            pass # 忽略发送错误，因为连接即将关闭
        client_states[client_sock] = STATE_ERROR

def handle_connection_request(client_sock, data, sock_map, proxy_config):
    """处理客户端的连接请求阶段"""
    global client_states, sockets_list, peers, last_activity

    if len(data) < 5:
        logging.warning(f"客户端 {client_sock.getpeername()} 发送的连接请求过短")
        client_states[client_sock] = STATE_ERROR
        return

    version, cmd, _, addr_type = struct.unpack("!BBBB", data[:4])

    if version != SOCKS_VERSION:
        logging.warning(f"客户端 {client_sock.getpeername()} 请求版本 ({version}) 错误")
        client_states[client_sock] = STATE_ERROR
        return

    if cmd != CMD_CONNECT:
        logging.warning(f"客户端 {client_sock.getpeername()} 请求了不支持的命令: {cmd}")
        # 发送命令不支持的回复
        send_socks_reply(client_sock, 0x07) # 0x07: Command not supported
        client_states[client_sock] = STATE_ERROR
        return

    target_host = None
    target_port = None
    addr_offset = 4 # 地址开始的偏移量

    try:
        if addr_type == ADDR_TYPE_IPV4:
            if len(data) < 10: # 4 (header) + 4 (IPv4) + 2 (port)
                raise ValueError("IPv4 请求数据不足")
            target_host = inet_ntoa(data[addr_offset:addr_offset+4])
            target_port = struct.unpack("!H", data[addr_offset+4:addr_offset+6])[0]
            logging.info(f"客户端 {client_sock.getpeername()} 请求连接 IPv4: {target_host}:{target_port}")

        elif addr_type == ADDR_TYPE_DOMAIN:
            domain_len = data[addr_offset]
            addr_offset += 1
            if len(data) < addr_offset + domain_len + 2: # offset + domain + port
                 raise ValueError("Domain 请求数据不足")
            target_host = data[addr_offset:addr_offset+domain_len].decode('utf-8')
            target_port = struct.unpack("!H", data[addr_offset+domain_len:addr_offset+domain_len+2])[0]
            logging.info(f"客户端 {client_sock.getpeername()} 请求连接 Domain: {target_host}:{target_port}")

        elif addr_type == ADDR_TYPE_IPV6:
            # PySocks 可能不支持直接用 IPv6 地址字符串，需要确认
            # 这里暂时发送地址类型不支持的错误
            logging.warning(f"客户端 {client_sock.getpeername()} 请求连接 IPv6，暂不支持")
            send_socks_reply(client_sock, 0x08) # 0x08: Address type not supported
            client_states[client_sock] = STATE_ERROR
            return
        else:
            logging.warning(f"客户端 {client_sock.getpeername()} 请求了未知的地址类型: {addr_type}")
            send_socks_reply(client_sock, 0x08)
            client_states[client_sock] = STATE_ERROR
            return

    except Exception as e:
        logging.error(f"解析客户端 {client_sock.getpeername()} 连接请求失败: {e}")
        send_socks_reply(client_sock, REPLY_GENERAL_FAILURE)
        client_states[client_sock] = STATE_ERROR
        return

    # --- 通过上游代理连接目标 ---
    remote_sock = None
    try:
        remote_sock = socks.socksocket(socket.AF_INET, socket.SOCK_STREAM)
        remote_sock.set_proxy(
            proxy_config['type'],
            proxy_config['host'],
            proxy_config['port'],
            username=proxy_config['user'],
            password=proxy_config['pass']
        )
        remote_sock.settimeout(CONNECT_TIMEOUT)
        logging.debug(f"正在通过代理 {proxy_config['host']}:{proxy_config['port']} 连接目标 {target_host}:{target_port}")
        remote_sock.connect((target_host, target_port))
        remote_sock.setblocking(False) # 连接成功后设为非阻塞
        logging.info(f"成功通过代理连接到目标: {target_host}:{target_port}")

        # --- 发送成功回复给客户端 ---
        # 回复需要包含服务器绑定的地址和端口，但代理模式下通常用 0 填充
        # 这里的实现发送一个标准的成功响应，包含请求的地址类型和0地址/端口
        # reply = struct.pack("!BBB", SOCKS_VERSION, REPLY_SUCCESS, 0x00)
        # if addr_type == ADDR_TYPE_IPV4:
        #     reply += struct.pack("!B", ADDR_TYPE_IPV4) + b'\x00\x00\x00\x00' + struct.pack("!H", 0)
        # elif addr_type == ADDR_TYPE_DOMAIN:
        #     # Domain 回复比较复杂，为了简单，也用 IPv4 的 0 地址
        #     reply += struct.pack("!B", ADDR_TYPE_IPV4) + b'\x00\x00\x00\x00' + struct.pack("!H", 0)
        # else: # IPv6 或其他 (虽然前面已经拦截了IPv6)
        #     reply += struct.pack("!B", ADDR_TYPE_IPV4) + b'\x00\x00\x00\x00' + struct.pack("!H", 0)
        # 使用最简单的成功回复
        reply = b'\x05\x00\x00\x01\x00\x00\x00\x00\x00\x00'
        client_sock.sendall(reply)

        # --- 设置连接状态 ---
        client_states[client_sock] = STATE_CONNECTED
        peers[client_sock] = remote_sock
        peers[remote_sock] = client_sock
        sockets_list.append(remote_sock)
        now = time.time()
        last_activity[client_sock] = now
        last_activity[remote_sock] = now
        logging.debug(f"连接对建立: {client_sock.fileno()} <-> {remote_sock.fileno()}")


    except (socks.ProxyConnectionError, socks.GeneralProxyError) as e:
        logging.error(f"连接上游代理 {proxy_config['host']}:{proxy_config['port']} 失败: {e}")
        send_socks_reply(client_sock, REPLY_GENERAL_FAILURE) # SOCKS Reply: General failure
        client_states[client_sock] = STATE_ERROR
        if remote_sock: remote_sock.close()
    except socket.timeout:
        logging.error(f"通过代理连接目标 {target_host}:{target_port} 超时")
        send_socks_reply(client_sock, 0x04) # SOCKS Reply: Host unreachable (approximated)
        client_states[client_sock] = STATE_ERROR
        if remote_sock: remote_sock.close()
    except socket.gaierror as e: # getaddrinfo error (e.g., domain not found)
         logging.error(f"无法解析目标主机 {target_host}: {e}")
         send_socks_reply(client_sock, 0x04) # SOCKS Reply: Host unreachable
         client_states[client_sock] = STATE_ERROR
         if remote_sock: remote_sock.close()
    except socket.error as e:
        logging.error(f"通过代理连接目标 {target_host}:{target_port} 失败: {e}")
        reply_code = REPLY_GENERAL_FAILURE
        if e.errno == 111: # Connection refused
            reply_code = REPLY_CONNECTION_REFUSED
        elif e.errno == 113: # No route to host
             reply_code = 0x03 # Network unreachable
        send_socks_reply(client_sock, reply_code)
        client_states[client_sock] = STATE_ERROR
        if remote_sock: remote_sock.close()
    except Exception as e:
         logging.error(f"连接目标时发生未知错误: {e}")
         send_socks_reply(client_sock, REPLY_GENERAL_FAILURE)
         client_states[client_sock] = STATE_ERROR
         if remote_sock: remote_sock.close()


def send_socks_reply(client_sock, reply_code):
    """向客户端发送 SOCKS 错误回复"""
    # 使用通用的 IPv4 0.0.0.0:0 作为绑定地址
    reply = struct.pack("!BBB", SOCKS_VERSION, reply_code, 0x00)
    reply += struct.pack("!B", ADDR_TYPE_IPV4) + b'\x00\x00\x00\x00' + struct.pack("!H", 0)
    try:
        client_sock.sendall(reply)
    except socket.error as e:
        logging.debug(f"向客户端 {client_sock.fileno()} 发送错误回复失败: {e}")


# --- 主函数 ---
def main():
    """
    主函数，处理参数、设置监听、管理连接和 SOCKS 协议处理及数据转发。
    """
    global client_states, sockets_list, peers, last_activity # 声明全局变量

    # --- 参数解析 ---
    parser = argparse.ArgumentParser(
        description="Python 实现的 SOCKS5 中继转发工具。",
        epilog="示例: python datapipe_socks_relay.py 0.0.0.0 1080 socks5://user:pass@proxy.example.com:1080"
    )
    parser.add_argument("local_host", help="本地监听的主机地址 (例如 0.0.0.0 或 127.0.0.1)")
    parser.add_argument("local_port", type=int, help="本地监听的端口号 (作为本地 SOCKS 代理端口)")
    parser.add_argument("proxy_uri", help="上游 SOCKS5 代理服务器 URI (格式: socks5://[username:password@]proxy_host:proxy_port)")

    args = parser.parse_args()

    # --- 解析上游代理信息 ---
    proxy_type, proxy_host, proxy_port, proxy_user, proxy_pass = parse_proxy_uri(args.proxy_uri)
    if proxy_type is None:
        sys.exit(25) # 代理配置错误退出码

    upstream_proxy_config = {
        'type': proxy_type,
        'host': proxy_host,
        'port': proxy_port,
        'user': proxy_user,
        'pass': proxy_pass
    }
    logging.info(f"将使用上游 SOCKS5 代理 {proxy_host}:{proxy_port}" +
                 (" (带认证)" if proxy_user else " (无认证)"))

    # --- 设置本地监听 Socket ---
    listener_sock = None
    try:
        listener_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener_sock.bind((args.local_host, args.local_port))
        listener_sock.listen(10) # 增加监听队列
        listener_sock.setblocking(False) # 非阻塞
        logging.info(f"本地 SOCKS5 中继服务已启动，正在监听 {args.local_host}:{args.local_port}...")

    except socket.error as e:
        logging.error(f"创建或绑定监听 socket 时出错: {e}")
        sys.exit(20)
    except Exception as e:
        logging.error(f"设置监听时发生未知错误: {e}")
        sys.exit(20)

    # --- 连接管理 ---
    sockets_list = [listener_sock] # select 监控列表
    peers = {} # 存储 client_sock <-> remote_sock 的映射
    client_states = {} # 存储每个 client_sock 的状态
    last_activity = {} # 记录最后活动时间戳

    # --- 主循环 ---
    try:
        while True:
            # --- 超时检查 ---
            now = time.time()
            timeout_sockets = []
            for sock in list(last_activity.keys()):
                 # 如果 socket 不在 peers 中（可能是监听 socket 或已关闭的），不检查超时
                 # 只检查活跃连接对的超时
                 if sock in peers and now - last_activity.get(sock, now) > IDLE_TIMEOUT:
                     if sock not in timeout_sockets:
                         timeout_sockets.append(sock)
                     peer_sock = peers.get(sock)
                     if peer_sock and peer_sock not in timeout_sockets:
                         timeout_sockets.append(peer_sock)

            # 关闭超时的连接
            for sock in timeout_sockets:
                 state = client_states.get(sock) or client_states.get(peers.get(sock))
                 logging.info(f"连接 {sock.fileno()} (状态: {state}) 因空闲超时而被关闭。")
                 client_states[sock] = STATE_ERROR # 标记错误，将在下面清理循环中处理


            # --- 使用 select 进行 I/O 多路复用 ---
            try:
                readable, writable, exceptional = select.select(sockets_list, [], sockets_list, SELECT_TIMEOUT)
            except select.error as e:
                 logging.error(f"Select 错误: {e}")
                 # 简单处理：移除所有出错的 socket，让后续逻辑处理
                 for sock in list(sockets_list):
                     try:
                         sock.fileno()
                     except socket.error:
                         logging.warning(f"检测到无效 socket，准备移除...")
                         client_states[sock] = STATE_ERROR # 标记错误
                 # 不立即移除，让下面清理逻辑统一处理
                 continue
            except ValueError: # 可能发生在 socket 关闭后 fd 变为 -1
                 logging.warning("Select 遇到无效文件描述符，清理中...")
                 # 标记所有可能无效的 socket
                 for sock in list(sockets_list):
                     try:
                         sock.fileno()
                     except (socket.error, ValueError):
                         client_states[sock] = STATE_ERROR
                 continue


            # --- 处理可读的 Socket ---
            for sock in readable:
                if sock is listener_sock:
                    # --- 1. 处理新的客户端连接 ---
                    try:
                        client_sock, client_addr = listener_sock.accept()
                        client_sock.setblocking(False) # 非阻塞
                        logging.info(f"接受到新连接: {client_addr} (fd={client_sock.fileno()})")
                        sockets_list.append(client_sock)
                        client_states[client_sock] = STATE_EXPECT_METHOD # 初始状态
                        last_activity[client_sock] = time.time() # 记录活动时间
                    except socket.error as e:
                        logging.error(f"接受新连接时出错: {e}")

                else:
                    # --- 2. 处理已有连接的数据或 SOCKS 握手 ---
                    state = client_states.get(sock)
                    peer_sock = peers.get(sock)

                    if state == STATE_CONNECTED:
                        # --- a. 已连接状态，转发数据 ---
                        if peer_sock:
                            result = forward_data(sock, peer_sock, peers)
                            if result <= 0 and not (isinstance(result, int) and result == 0): # 0 表示暂时无数据(EWOULDBLOCK)
                                # 连接关闭或出错
                                client_states[sock] = STATE_ERROR
                                if peer_sock in client_states: # 对端也标记错误
                                    client_states[peer_sock] = STATE_ERROR
                        else:
                            # 对端丢失，标记错误
                            client_states[sock] = STATE_ERROR

                    elif state == STATE_EXPECT_METHOD:
                        # --- b. 等待方法选择 ---
                        try:
                            data = sock.recv(BUFFER_SIZE)
                            if data:
                                last_activity[sock] = time.time() # 更新活动时间
                                handle_method_selection(sock, data, peers)
                            else: # 客户端直接关闭连接
                                logging.info(f"客户端 {sock.fileno()} 在方法选择阶段关闭连接")
                                client_states[sock] = STATE_ERROR
                        except (socket.error, ConnectionResetError) as e:
                             if isinstance(e, socket.error) and e.errno in (socket.EWOULDBLOCK, socket.EAGAIN):
                                 pass # 暂时无数据可读
                             else:
                                 logging.error(f"读取客户端 {sock.fileno()} 方法选择失败: {e}")
                                 client_states[sock] = STATE_ERROR

                    elif state == STATE_EXPECT_REQUEST:
                        # --- c. 等待连接请求 ---
                        try:
                            data = sock.recv(BUFFER_SIZE)
                            if data:
                                last_activity[sock] = time.time() # 更新活动时间
                                handle_connection_request(sock, data, peers, upstream_proxy_config)
                            else: # 客户端关闭连接
                                logging.info(f"客户端 {sock.fileno()} 在连接请求阶段关闭连接")
                                client_states[sock] = STATE_ERROR
                        except (socket.error, ConnectionResetError) as e:
                             if isinstance(e, socket.error) and e.errno in (socket.EWOULDBLOCK, socket.EAGAIN):
                                 pass # 暂时无数据可读
                             else:
                                 logging.error(f"读取客户端 {sock.fileno()} 连接请求失败: {e}")
                                 client_states[sock] = STATE_ERROR
                    # else: STATE_ERROR 或 None 会在下面的清理逻辑中处理


            # --- 处理异常的 Socket ---
            for sock in exceptional:
                logging.error(f"Socket {sock.fileno()} 出现异常，标记关闭。")
                client_states[sock] = STATE_ERROR
                peer_sock = peers.get(sock)
                if peer_sock:
                    client_states[peer_sock] = STATE_ERROR # 对端也标记关闭


            # --- 清理标记为错误的 Socket ---
            # 单独循环处理，避免在迭代 readable/exceptional 列表时修改它
            cleanup_list = [s for s, state in client_states.items() if state == STATE_ERROR]
            for sock in cleanup_list:
                logging.debug(f"正在清理 socket {sock.fileno()}...")
                if sock in sockets_list:
                    sockets_list.remove(sock)

                peer_sock = peers.pop(sock, None)
                if peer_sock:
                    if peer_sock in sockets_list:
                        sockets_list.remove(peer_sock)
                    peers.pop(peer_sock, None) # 确保双向都移除
                    client_states.pop(peer_sock, None) # 移除对端状态
                    last_activity.pop(peer_sock, None) # 移除对端活动记录
                    try:
                        peer_sock.close()
                        logging.debug(f"已关闭 peer socket {peer_sock.fileno()}")
                    except socket.error as e:
                        logging.debug(f"关闭 peer socket {peer_sock.fileno()} 时出错: {e}")

                client_states.pop(sock, None) # 移除自己状态
                last_activity.pop(sock, None) # 移除自己活动记录
                try:
                    sock.close()
                    logging.debug(f"已关闭 socket {sock.fileno()}")
                except socket.error as e:
                    logging.debug(f"关闭 socket {sock.fileno()} 时出错: {e}")


    except KeyboardInterrupt:
        logging.info("收到退出信号 (Ctrl+C)，正在关闭服务...")
    finally:
        logging.info("开始关闭所有剩余连接...")
        for sock in sockets_list:
            try:
                sock.close()
            except socket.error:
                pass # 忽略关闭时的错误
        logging.info("服务已停止。")


# --- 程序入口 ---
if __name__ == "__main__":
    main()

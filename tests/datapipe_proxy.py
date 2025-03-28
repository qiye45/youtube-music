#!/usr/bin/env python
# -*- coding: utf-8 -*-

import socket
import select
import time
import argparse
import sys
import logging
from urllib.parse import urlparse

# 尝试导入 socks 库，如果失败则提示安装
try:
    import socks
except ImportError:
    print("错误：需要 PySocks 库来支持 SOCKS 代理。")
    print("请使用 'pip install PySocks' 命令安装。")
    sys.exit(1)

# --- 配置常量 ---
# 最大并发客户端连接数 (与 C 代码中的 MAXCLIENTS 类似)
MAX_CLIENTS = 20
# 空闲连接超时时间（秒）(与 C 代码中的 IDLETIMEOUT 类似)
IDLE_TIMEOUT = 300
# 数据传输缓冲区大小 (与 C 代码中的 buf[4096] 类似)
BUFFER_SIZE = 4096
# select 超时时间（秒），用于控制主循环检查频率
SELECT_TIMEOUT = 1.0

# --- 日志配置 ---
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(levelname)s - %(message)s',
                    datefmt='%Y-%m-%d %H:%M:%S')

# --- 主要逻辑 ---

def parse_proxy_uri(proxy_uri):
    """
    解析 SOCKS5 代理 URI (例如: socks5://user:pass@host:port)。
    返回一个包含代理类型、主机、端口、用户名和密码的元组。
    如果 URI 无效或不包含用户名/密码，则对应值为 None。
    """
    try:
        parsed = urlparse(proxy_uri)
        if parsed.scheme.lower() not in ['socks5', 'socks5h']: # socks5h 会让代理服务器解析域名
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

def forward_data(source_sock, dest_sock):
    """
    从源 socket 读取数据并转发到目标 socket。
    返回读取/发送的字节数，如果出错或连接关闭则返回 -1。
    """
    try:
        data = source_sock.recv(BUFFER_SIZE)
        if not data:  # 对端关闭连接
            logging.info(f"连接 {source_sock.getpeername()} 已关闭。")
            return -1
        sent_len = dest_sock.sendall(data) # 使用 sendall 确保所有数据发送
        if sent_len is None: # sendall 成功时返回 None
             return len(data)
        else: # 理论上 sendall 要么成功要么抛异常，但以防万一
             logging.warning(f"发送数据到 {dest_sock.getpeername()} 时可能未完全发送。")
             return sent_len # 返回实际发送的长度（如果有的话）
    except (socket.error, BrokenPipeError, ConnectionResetError) as e:
        logging.error(f"转发数据时发生 socket 错误: {e}")
        return -1
    except Exception as e:
        logging.error(f"转发数据时发生未知错误: {e}")
        return -1

def main():
    """
    主函数，处理参数、设置监听、管理连接和数据转发。
    """
    # --- 参数解析 ---
    parser = argparse.ArgumentParser(
        description="Python 实现的 TCP 端口转发工具，支持 SOCKS5 代理认证。",
        epilog="示例: python datapipe_proxy.py 0.0.0.0 8080 socks5://user:pass@proxy.example.com:1080 target.server.com 80"
    )
    parser.add_argument("local_host", help="本地监听的主机地址 (例如 0.0.0.0 或 127.0.0.1)")
    parser.add_argument("local_port", type=int, help="本地监听的端口号")
    parser.add_argument("proxy_uri", help="SOCKS5 代理服务器 URI (格式: socks5://[username:password@]proxy_host:proxy_port)，如果不需要代理，请使用 'none'")
    parser.add_argument("remote_host", help="远程目标主机地址或域名")
    parser.add_argument("remote_port", type=int, help="远程目标主机端口号")

    args = parser.parse_args()

    # --- 解析代理信息 ---
    proxy_type, proxy_host, proxy_port, proxy_user, proxy_pass = None, None, None, None, None
    use_proxy = False
    if args.proxy_uri.lower() != 'none':
        proxy_type, proxy_host, proxy_port, proxy_user, proxy_pass = parse_proxy_uri(args.proxy_uri)
        if proxy_type is None:
            sys.exit(25) # 代理配置错误退出码
        use_proxy = True
        logging.info(f"将通过 SOCKS5 代理 {proxy_host}:{proxy_port} 连接远程主机" +
                     (" (带认证)" if proxy_user else " (无认证)"))
    else:
        logging.info("不使用 SOCKS 代理，将直接连接远程主机。")

    # --- 设置本地监听 Socket ---
    listener_sock = None
    try:
        listener_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        # 设置地址重用，方便快速重启服务
        listener_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener_sock.bind((args.local_host, args.local_port))
        listener_sock.listen(5) # 设置最大等待连接数
        listener_sock.setblocking(False) # 设置为非阻塞模式，配合 select 使用
        logging.info(f"服务已启动，正在监听 {args.local_host}:{args.local_port}...")
        logging.info(f"传入连接将转发至 {args.remote_host}:{args.remote_port}" +
                     (f" 通过代理 {proxy_host}:{proxy_port}" if use_proxy else ""))

    except socket.error as e:
        logging.error(f"创建或绑定监听 socket 时出错: {e}")
        sys.exit(20) # 监听设置错误退出码
    except Exception as e:
        logging.error(f"设置监听时发生未知错误: {e}")
        sys.exit(20)

    # --- 连接管理 ---
    # 存储所有需要 select 监控的 socket
    sockets_list = [listener_sock]
    # 存储客户端与远程服务器 socket 的对应关系: {client_sock: remote_sock, remote_sock: client_sock}
    peers = {}
    # 记录每个连接对的最后活动时间: {client_sock: timestamp, remote_sock: timestamp}
    # 使用 client_sock 或 remote_sock 作为键都可以，因为它们是成对的
    last_activity = {}

    # --- 主循环 ---
    try:
        while True:
            # 使用 select 监控 socket 是否可读
            # readable: 可读的 socket 列表
            # writable: 可写的 socket 列表 (我们这里不关心，sendall 会处理阻塞)
            # exceptional: 发生错误的 socket 列表
            try:
                # 检查是否有超时的连接
                now = time.time()
                timeout_sockets = []
                # 遍历 peers 的键（所有活跃的 client 和 remote socket）
                for sock in list(peers.keys()):
                    # 仅当 sock 存在于 last_activity 时才检查超时（避免新连接或已关闭连接误判）
                    if sock in last_activity and now - last_activity.get(sock, now) > IDLE_TIMEOUT:
                       # 检查对端是否存在，避免重复添加
                       peer_sock = peers.get(sock)
                       if sock not in timeout_sockets:
                           timeout_sockets.append(sock)
                       if peer_sock and peer_sock not in timeout_sockets:
                           timeout_sockets.append(peer_sock)

                # 关闭超时的连接
                for sock in timeout_sockets:
                    logging.info(f"连接 {sock.getpeername() if sock.fileno() != -1 else '已关闭'} 因空闲超时而被关闭。")
                    # 清理资源
                    if sock in sockets_list:
                        sockets_list.remove(sock)
                    peer_sock = peers.pop(sock, None) # 从 peers 移除自己
                    if peer_sock:
                        peers.pop(peer_sock, None) # 从 peers 移除对端
                        if peer_sock in sockets_list:
                             sockets_list.remove(peer_sock)
                        peer_sock.close() # 关闭对端 socket
                    sock.close() # 关闭自己
                    last_activity.pop(sock, None) # 移除活动记录
                    if peer_sock:
                        last_activity.pop(peer_sock, None)


                # --- 使用 select 进行 I/O 多路复用 ---
                readable, _, exceptional = select.select(sockets_list, [], sockets_list, SELECT_TIMEOUT)

            except select.error as e:
                 logging.error(f"Select 错误: {e}")
                 # 在某些情况下（例如 socket 被异常关闭），select 可能出错，尝试清理无效 socket
                 valid_sockets = []
                 for sock in sockets_list:
                     try:
                         # 尝试获取一个选项，如果失败说明 socket 无效
                         sock.getsockopt(socket.SOL_SOCKET, socket.SO_TYPE)
                         valid_sockets.append(sock)
                     except socket.error:
                         logging.warning(f"检测到无效 socket，正在移除...")
                         # 清理无效 socket 的相关资源
                         peer_sock = peers.pop(sock, None)
                         if peer_sock:
                             peers.pop(peer_sock, None)
                             last_activity.pop(peer_sock, None)
                             try:
                                 peer_sock.close()
                             except socket.error:
                                 pass # 忽略关闭错误
                         last_activity.pop(sock, None)
                 sockets_list = valid_sockets # 更新 sockets_list
                 continue # 继续下一次循环


            # --- 处理可读的 Socket ---
            for sock in readable:
                now = time.time() # 获取当前时间戳

                # --- 1. 处理新的客户端连接 ---
                if sock is listener_sock:
                    if len(peers) // 2 >= MAX_CLIENTS:
                        logging.warning("达到最大客户端连接数，暂时拒绝新连接。")
                        # 仍然需要 accept 然后立即 close，防止客户端一直等待
                        temp_client_sock, _ = listener_sock.accept()
                        temp_client_sock.close()
                        continue

                    try:
                        client_sock, client_addr = listener_sock.accept()
                        client_sock.setblocking(False) # 接收到的 socket 也设为非阻塞
                        logging.info(f"接受到新连接: {client_addr}")

                        # --- 创建连接到远程主机的 Socket (可能通过代理) ---
                        remote_sock = None
                        try:
                            if use_proxy:
                                # 使用 PySocks 创建 socket
                                remote_sock = socks.socksocket(socket.AF_INET, socket.SOCK_STREAM)
                                # 设置代理
                                remote_sock.set_proxy(proxy_type, proxy_host, proxy_port,
                                                      username=proxy_user, password=proxy_pass)
                            else:
                                # 直接创建标准 socket
                                remote_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

                            remote_sock.settimeout(10) # 设置连接超时
                            remote_sock.connect((args.remote_host, args.remote_port))
                            remote_sock.setblocking(False) # 连接成功后设为非阻塞
                            logging.info(f"成功连接到远程目标: {args.remote_host}:{args.remote_port}" +
                                         (f" via proxy {proxy_host}:{proxy_port}" if use_proxy else ""))

                            # --- 添加到管理列表 ---
                            sockets_list.append(client_sock)
                            sockets_list.append(remote_sock)
                            peers[client_sock] = remote_sock
                            peers[remote_sock] = client_sock
                            last_activity[client_sock] = now # 记录初始活动时间
                            last_activity[remote_sock] = now # 记录初始活动时间

                        except (socks.ProxyConnectionError, socks.GeneralProxyError) as e:
                            logging.error(f"连接代理服务器 {proxy_host}:{proxy_port} 失败: {e}")
                            client_sock.close() # 关闭客户端连接
                            if remote_sock: remote_sock.close() # 如果 remote_sock 已创建也关闭
                        except socket.timeout:
                            logging.error(f"连接远程主机 {args.remote_host}:{args.remote_port} 超时" +
                                         (f" (通过代理 {proxy_host}:{proxy_port})" if use_proxy else ""))
                            client_sock.close()
                            if remote_sock: remote_sock.close()
                        except socket.error as e:
                            logging.error(f"连接远程主机 {args.remote_host}:{args.remote_port} 失败: {e}" +
                                         (f" (通过代理 {proxy_host}:{proxy_port})" if use_proxy else ""))
                            client_sock.close()
                            if remote_sock: remote_sock.close()
                        except Exception as e:
                             logging.error(f"创建到远程主机的连接时发生未知错误: {e}")
                             client_sock.close()
                             if remote_sock: remote_sock.close()

                    except socket.error as e:
                        logging.error(f"接受新连接时出错: {e}")

                # --- 2. 处理已有连接的数据转发 ---
                else:
                    peer_sock = peers.get(sock)
                    if peer_sock: # 确保对端 socket 存在
                        result = forward_data(sock, peer_sock)
                        if result > 0:
                            # 数据成功转发，更新双方活动时间
                            last_activity[sock] = now
                            last_activity[peer_sock] = now
                        elif result <= 0:
                            # 读取错误、连接关闭或发送错误
                            logging.info(f"关闭连接对: {sock.getpeername() if sock.fileno() != -1 else '已关闭'} <-> {peer_sock.getpeername() if peer_sock.fileno() != -1 else '已关闭'}")
                            # 清理这对连接
                            if sock in sockets_list:
                                sockets_list.remove(sock)
                            if peer_sock in sockets_list:
                                sockets_list.remove(peer_sock)

                            peers.pop(sock, None)
                            peers.pop(peer_sock, None)
                            last_activity.pop(sock, None)
                            last_activity.pop(peer_sock, None)

                            sock.close()
                            peer_sock.close()
                    else:
                        # 如果在 peers 中找不到对应的 socket，说明可能已被关闭，清理自身
                        logging.warning(f"发现孤立的 socket {sock.getpeername() if sock.fileno() != -1 else '已关闭'}，正在清理...")
                        if sock in sockets_list:
                             sockets_list.remove(sock)
                        last_activity.pop(sock, None)
                        sock.close()


            # --- 处理异常的 Socket ---
            for sock in exceptional:
                logging.error(f"Socket {sock.getpeername() if sock.fileno() != -1 else '未知'} 出现异常，关闭连接。")
                # 清理这个异常的 socket 及其对端
                if sock in sockets_list:
                    sockets_list.remove(sock)

                peer_sock = peers.pop(sock, None)
                if peer_sock:
                    if peer_sock in sockets_list:
                        sockets_list.remove(peer_sock)
                    peers.pop(peer_sock, None) # 从 peers 移除对端
                    last_activity.pop(peer_sock, None) # 清理对端活动时间
                    try:
                        peer_sock.close() # 关闭对端
                    except socket.error:
                        pass # 忽略关闭错误
                last_activity.pop(sock, None) # 清理自己活动时间
                try:
                    sock.close() # 关闭自己
                except socket.error:
                    pass # 忽略关闭错误

    except KeyboardInterrupt:
        logging.info("收到退出信号 (Ctrl+C)，正在关闭服务...")
    finally:
        logging.info("开始关闭所有连接...")
        # 关闭所有剩余的 socket
        for sock in sockets_list:
            try:
                sock.close()
            except socket.error:
                pass # 忽略关闭时的错误
        logging.info("服务已停止。")

# --- 程序入口 ---
if __name__ == "__main__":
    main()

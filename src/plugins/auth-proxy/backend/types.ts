import net from 'net';
import { app } from 'electron';
import { SocksClient } from 'socks';
import { createBackend } from '@/utils';
import config from '@/config';
import { getProxyUrl } from '../config';
import type { SocksClientOptions } from 'socks';
import type { AuthProxyConfig } from '../config';
import type { Server } from 'http';


export type BackendType {
  server?: Server | net.Server;
  oldConfig?: AuthProxyConfig;
  startServer: (config: AuthProxyConfig) => void;
  stopServer: () => void;
  setSystemProxy: (config: AuthProxyConfig) => void;
  clearSystemProxy: () => void;
  proxyString?: string;
  _savedProxy?: string;
  handleSocks5: (
    clientSocket: net.Socket,
    chunk: Buffer,
    upstreamProxyUrl: string | null,
  ) => void;
  handleSocks4: (
    clientSocket: net.Socket,
    chunk: Buffer,
    upstreamProxyUrl: string | null,
  ) => void;
  processSocks5Request: (
    clientSocket: net.Socket,
    data: Buffer,
    upstreamProxyUrl: string | null,
  ) => void;
}

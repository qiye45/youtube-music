import { app, shell } from 'electron';

import { t } from '@/i18n';
import { promptPasswordWithConfirm, promptText } from '@/utils/prompts';

import type { MenuContext } from '@/types/contexts';
import type { AuthProxyConfig } from './config';
import { ProxyType, parseProxyUrl, getProxyUrl } from './config';

export async function onMenu(
  menu: Electron.Menu,
  { getConfig, setConfig }: MenuContext<AuthProxyConfig>,
) {
  const config = await getConfig();

  menu.append(
    new (app as any).MenuItem({
      label: t('plugins.auth-proxy.menu.proxy-settings'),
      submenu: [
        {
          label: t('plugins.auth-proxy.menu.proxy-type'),
          submenu: [
            {
              label: 'HTTP',
              type: 'radio',
              checked: config.proxyType === ProxyType.HTTP,
              click: () => {
                setConfig({
                  ...config,
                  proxyType: ProxyType.HTTP,
                });
              },
            },
            {
              label: 'SOCKS5',
              type: 'radio',
              checked: config.proxyType === ProxyType.SOCKS5,
              click: () => {
                setConfig({
                  ...config,
                  proxyType: ProxyType.SOCKS5,
                });
              },
            },
          ],
        },
        {
          label: t('plugins.auth-proxy.menu.hostname'),
          click: async () => {
            const hostname = await promptText({
              title: t('plugins.auth-proxy.menu.prompt-hostname'),
              label: t('plugins.auth-proxy.menu.enter-hostname'),
              value: config.hostname,
              inputAttrs: {
                type: 'text',
                required: true,
              },
            });

            if (hostname && hostname !== config.hostname) {
              setConfig({
                ...config,
                hostname,
              });
            }
          },
        },
        {
          label: t('plugins.auth-proxy.menu.port'),
          click: async () => {
            const portText = await promptText({
              title: t('plugins.auth-proxy.menu.prompt-port'),
              label: t('plugins.auth-proxy.menu.enter-port'),
              value: config.port.toString(),
              inputAttrs: {
                type: 'number',
                required: true,
                min: 1,
                max: 65535,
              },
            });

            const port = parseInt(portText || '', 10);
            if (!isNaN(port) && port !== config.port) {
              setConfig({
                ...config,
                port,
              });
            }
          },
        },
        {
          label: t('plugins.auth-proxy.menu.username'),
          click: async () => {
            const username = await promptText({
              title: t('plugins.auth-proxy.menu.prompt-username'),
              label: t('plugins.auth-proxy.menu.enter-username'),
              value: config.username,
              inputAttrs: {
                type: 'text',
                required: true,
              },
            });

            if (username && username !== config.username) {
              setConfig({
                ...config,
                username,
              });
            }
          },
        },
        {
          label: t('plugins.auth-proxy.menu.password'),
          click: async () => {
            const password = await promptPasswordWithConfirm({
              title: t('plugins.auth-proxy.menu.prompt-password'),
              label: t('plugins.auth-proxy.menu.enter-password'),
              value: config.password,
            });

            if (password && password !== config.password) {
              setConfig({
                ...config,
                password,
              });
            }
          },
        },
        {
          type: 'separator',
        },
        {
          label: t('plugins.auth-proxy.menu.upstream-proxy'),
          submenu: [
            {
              label: config.useUpstreamProxy 
                ? t('plugins.auth-proxy.menu.disable-upstream') 
                : t('plugins.auth-proxy.menu.enable-upstream'),
              click: () => {
                setConfig({
                  ...config,
                  useUpstreamProxy: !config.useUpstreamProxy,
                });
              },
            },
            {
              label: t('plugins.auth-proxy.menu.set-upstream-url'),
              click: async () => {
                const upstreamProxyUrl = await promptText({
                  title: t('plugins.auth-proxy.menu.prompt-upstream'),
                  label: t('plugins.auth-proxy.menu.enter-upstream'),
                  value: config.upstreamProxyUrl,
                  inputAttrs: {
                    type: 'text',
                    required: true,
                    placeholder: 'socks5://username:password@your_server_ip:port',
                  },
                });

                if (upstreamProxyUrl && upstreamProxyUrl !== config.upstreamProxyUrl) {
                  setConfig({
                    ...config,
                    upstreamProxyUrl,
                  });
                }
              },
            },
          ]
        },
        {
          type: 'separator',
        },
        {
          label: t('plugins.auth-proxy.menu.import-from-string'),
          click: async () => {
            const proxyUrl = await promptText({
              title: t('plugins.auth-proxy.menu.prompt-import'),
              label: t('plugins.auth-proxy.menu.enter-proxy-string'),
              value: '',
              inputAttrs: {
                type: 'text',
                required: true,
                placeholder: 'socks5://username:password@your_server_ip:port',
              },
            });

            if (proxyUrl) {
              const parsedConfig = parseProxyUrl(proxyUrl);
              if (Object.keys(parsedConfig).length > 0) {
                setConfig({
                  ...config,
                  ...parsedConfig,
                });
              }
            }
          },
        },
        {
          label: t('plugins.auth-proxy.menu.export-as-string'),
          click: () => {
            const proxyString = getProxyUrl(config);
            // 复制到剪贴板
            if ((app as any).clipboard) {
              (app as any).clipboard.writeText(proxyString);
            }
          },
        },
        {
          type: 'separator',
        },
        {
          label: config.enabled
            ? t('plugins.auth-proxy.menu.disable')
            : t('plugins.auth-proxy.menu.enable'),
          click: () => {
            setConfig({
              ...config,
              enabled: !config.enabled,
            });
          },
        },
      ],
    }),
  );
} 
import { t } from '@/i18n';
import config from '@/config';

import type { MenuContext } from '@/types/contexts';
import type { AuthProxyConfig } from './config';
import type { MenuTemplate } from '@/menu';

export const onMenu = async ({
  getConfig,
}: MenuContext<AuthProxyConfig>): Promise<MenuTemplate> => {
  const pluginConfig = await getConfig();

  return [
    {
      label: pluginConfig.enabled
        ? t('plugins.auth-proxy.menu.disable')
        : t('plugins.auth-proxy.menu.enable'),
      type: 'normal',
      click: () => {
        if (pluginConfig.enabled) {
          config.plugins.disable('auth-proxy');
        } else {
          config.plugins.enable('auth-proxy');
        }
      },
    },
  ];
};

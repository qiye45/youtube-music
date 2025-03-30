import { createPlugin } from '@/utils';
import { t } from '@/i18n';

import { defaultAuthProxyConfig } from './config';
import { onMenu } from './menu';
import { backend } from './backend';

export default createPlugin({
  name: () => t('plugins.auth-proxy.name'),
  description: () => t('plugins.auth-proxy.description'),
  restartNeeded: false,
  config: defaultAuthProxyConfig,
  addedVersion: '3.8.X',
  menu: onMenu,
  backend,
}); 
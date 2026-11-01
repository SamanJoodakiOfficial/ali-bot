import * as http from 'node:http';
export function configureProxy(config) {
  if (!config.telegramProxyUrl) return;
  if (typeof http.setGlobalProxyFromEnv !== 'function') throw new Error('پروکسی نیاز به Node 24.14+ دارد.');
  const pHost = new URL(config.panelBase).hostname;
  const existing = (process.env.NO_PROXY || '').split(',').filter(Boolean);
  http.setGlobalProxyFromEnv({
    HTTPS_PROXY: config.telegramProxyUrl, HTTP_PROXY: config.telegramProxyUrl,
    NO_PROXY: [...new Set([pHost, ...existing, 'localhost', '127.0.0.1', 'host.docker.internal'])].join(',')
  });
  console.log('Trusted Telegram proxy enabled; panel host bypassed.');
}

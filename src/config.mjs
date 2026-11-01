export function loadConfig(env = process.env) {
  const required = k => {
    const v = (env[k] || '').trim();
    if (!v || /^PUT_/.test(v)) throw new Error(`مقدار ${k} را در .env وارد کنید.`);
    return v;
  };
  const telegramToken = required('TELEGRAM_BOT_TOKEN');
  const panelToken = required('PANEL_API_TOKEN');
  const ids = (env.OWNER_TELEGRAM_IDS || env.ADMIN_TELEGRAM_IDS || '').split(',').map(x => x.trim());
  if (!ids.length || ids.some(x => !/^\d{5,20}$/.test(x))) throw new Error('OWNER_TELEGRAM_IDS باید عددی باشد.');
  const panelBase = new URL(required('PANEL_URL'));
  if (!['https:', 'http:'].includes(panelBase.protocol) || panelBase.search || panelBase.hash || panelBase.username) throw new Error('PANEL_URL نامعتبر است.');
  if (/\/panel(?:\/api(?:\/.*)?)?\/?$/i.test(panelBase.pathname)) throw new Error('PANEL_URL باید بدون پسوند /panel باشد.');
  if (panelBase.protocol === 'http:' && !['localhost', 'host.docker.internal', '127.0.0.1'].includes(panelBase.hostname)) throw new Error('پنل عمومی باید HTTPS باشد.');
  panelBase.pathname = panelBase.pathname.replace(/\/+$/, '') + '/';
  const telegramApiBase = new URL((env.TELEGRAM_API_BASE_URL || 'https://api.telegram.org/').trim());
  if (telegramApiBase.protocol !== 'https:' && !(telegramApiBase.protocol === 'http:' && ['localhost', '127.0.0.1', 'host.docker.internal'].includes(telegramApiBase.hostname))) throw new Error('Telegram API base باید HTTPS باشد.');
  if (telegramApiBase.username || telegramApiBase.password || telegramApiBase.search || telegramApiBase.hash) throw new Error('Telegram API base دارای اطلاعات اضافی است.');
  telegramApiBase.pathname = telegramApiBase.pathname.replace(/\/+$/, '') + '/';
  let proxy = (env.TELEGRAM_PROXY_URL || '').trim();
  if (proxy) {
    const p = new URL(proxy);
    if (!['http:', 'https:'].includes(p.protocol)) throw new Error('فقط پروکسی HTTP CONNECT مجاز است.');
    if (p.pathname !== '/' || p.search || p.hash) throw new Error('آدرس پروکسی باید تنها شامل میزبان و پورت باشد.');
  }
  let subscriptionBase = '';
  if ((env.SUBSCRIPTION_BASE_URL || '').trim()) {
    const s = new URL(env.SUBSCRIPTION_BASE_URL.trim());
    if(s.protocol !== 'https:' || s.username || s.password || s.search || s.hash) throw new Error('SUBSCRIPTION_BASE_URL باید HTTPS بدون پارامتر باشد.');
    subscriptionBase = s.toString().replace(/\/+$/, '') + '/';
  }
  const timezone = env.DISPLAY_TIMEZONE || 'Asia/Tehran';
  try { Intl.DateTimeFormat('fa-IR', { timeZone: timezone }); } catch { throw new Error('منطقه زمانی نامعتبر است.'); }
  const timeoutMs = Number(env.PANEL_TIMEOUT_MS || 20000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) throw new Error('PANEL_TIMEOUT_MS نامعتبر است.');
  const telegramPollSeconds = Number(env.TELEGRAM_POLL_TIMEOUT_SECONDS ?? 5);
  if (!Number.isInteger(telegramPollSeconds) || telegramPollSeconds < 0 || telegramPollSeconds > 25) {
    throw new Error('TELEGRAM_POLL_TIMEOUT_SECONDS باید عدد صحیح بین ۰ تا ۲۵ باشد.');
  }
  return {
    telegramToken, panelToken, ownerIds: new Set(ids), panelBase: panelBase.toString(),
    telegramApiBase: telegramApiBase.toString(), telegramProxyUrl: proxy,
    timezone, timeoutMs, telegramPollSeconds, dbPath: env.DB_PATH || './data/bot.sqlite', subscriptionBase,
    resetTraffic: false
  };
}

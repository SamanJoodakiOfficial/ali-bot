export function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function dateFa(value, timezone = 'Asia/Tehran') {
  if (value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) <= 0) {
    return 'نامشخص';
  }
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(Number(value)));
}

export function gb(bytes) {
  if (bytes === null || bytes === undefined || !Number.isFinite(Number(bytes))) return 'نامشخص';
  return `${(Math.max(0, Number(bytes)) / (1024 ** 3)).toFixed(2)} GB`;
}

export function getStatus(c) {
  if (c.enabled === false) return '🔴 غیرفعال';
  if (c.expiryRaw !== null && c.expiryRaw !== undefined && c.expiryRaw > 0 &&
      c.expiryTime !== null && c.expiryTime < Date.now()) return '🔴 منقضی‌شده';
  if (c.totalBytes !== null && c.totalBytes > 0 && c.usedBytes !== null &&
      c.usedBytes >= c.totalBytes) return '🔴 اتمام حجم';
  if (c.enabled === true) return '🟢 فعال';
  return '⚪ وضعیت نامشخص';
}

export function clientText(c, n, timezone) {
  const expired = c.expiryRaw !== null && c.expiryRaw < 0
    ? 'پس از اولین اتصال' : c.expiryRaw === 0 ? 'بدون انقضا' : dateFa(c.expiryTime, timezone);
  let text = `<b>${n}. ${escapeHtml(c.email)}</b> — ${getStatus(c)}\n`;
  text += `📅 ثبت‌نام: ${dateFa(c.createdAt, timezone)}\n`;
  text += `📦 مصرف: ${gb(c.usedBytes)} / ${c.totalBytes === 0 ? 'نامحدود' : gb(c.totalBytes)}\n`;
  text += `⏳ انقضا: ${expired}`;
  if (c.group) text += `\n🏷 گروه: ${escapeHtml(c.group)}`;
  return text;
}

export function latestMessages(clients, { timezone, title = '۱۰ کاربر آخر', note = '', total = null } = {}) {
  if (clients.length === 0) return [`📭 ${escapeHtml(title)}\n\nکاربری پیدا نشد.${note ? `\n${escapeHtml(note)}` : ''}`];
  const chunks = [];
  for (let i = 0; i < clients.length; i += 7) {
    const number = Math.floor(i / 7) + 1;
    const header = `👥 <b>${escapeHtml(title)}</b>${total !== null ? ` (از ${total})` : ''}` +
      (number > 1 ? ` — بخش ${number}` : '');
    chunks.push(`${header}\n\n${clients.slice(i, i + 7).map((c, j) => clientText(c, i + j + 1, timezone)).join('\n\n')}` +
      (i + 7 >= clients.length && note ? `\n\n⚠️ ${escapeHtml(note)}` : ''));
  }
  return chunks;
}

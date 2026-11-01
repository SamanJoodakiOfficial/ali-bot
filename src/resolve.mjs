import {createHash} from 'node:crypto';
export function quotaAddition(currentTotalBytes,purchasedGb) {
  const unit=1073741824;
  if (!Number.isSafeInteger(currentTotalBytes) || currentTotalBytes < 0 || currentTotalBytes === 0) throw new Error('حساب با حجم نامحدود قابل تمدید خودکار نیست.');
  if (!Number.isInteger(purchasedGb) || purchasedGb < 20 || purchasedGb > 10000) throw new Error('حجم خرید باید حداقل ۲۰ و حداکثر ۱۰۰۰۰ گیگ باشد.');
  const target=currentTotalBytes+purchasedGb*unit;
  if (!Number.isSafeInteger(target)) throw new Error('حجم جدید خارج از محدوده ایمن است.');
  return target;
}
export function addMonths(baseMs,months) {
  if(!Number.isSafeInteger(baseMs)||baseMs<=0)throw new Error('تاریخ معتبر نیست.');
  if(!Number.isInteger(months)||months<1||months>24)throw new Error('مدت تنها به تعداد صحیح ماه (۱ تا ۲۴) است.');
  const d=new Date(baseMs);
  const day=d.getUTCDate();
  const y=d.getUTCFullYear(), mo=d.getUTCMonth();
  const last=new Date(Date.UTC(y,mo+months+1,0)).getUTCDate();
  const next=new Date(baseMs);
  next.setUTCDate(1);
  next.setUTCMonth(mo+months);
  next.setUTCDate(Math.min(day,last));
  return next.getTime();
}
export function renewByMonths(oldExpiry,months,now=Date.now()) {
  if(!Number.isSafeInteger(oldExpiry)||oldExpiry<=0)throw new Error('حساب بدون تاریخ انقضای معتبر است.');
  return addMonths(Math.max(oldExpiry,now),months);
}
// The bot NEVER downloads arbitrary subscription URLs or echoes full config links.
// Extract only an identifier, then look it up inside the trusted 3x-ui panel.
export function extractIdentity(input) {
  const value=String(input||'').trim();
  if (!value || value.length > 12000) throw new Error('لینک یا کانفیگ معتبر نیست.');
  if (/^email:/i.test(value)) {
    const email=value.slice(6).trim();
    if (!/^[^\s]{1,180}$/.test(email))throw new Error('ایمیل نامعتبر است.');
    return {kind:'email', value:email};
  }
  if (/^subid:/i.test(value)) {
    const sub=value.slice(6).trim();
    if (!/^[a-zA-Z0-9_-]{4,200}$/.test(sub))throw new Error('شناسه اشتراک نامعتبر است.');
    return {kind:'subId',value:sub};
  }
  if (/^https?:\/\//i.test(value)) {
    let url;
    try{url=new URL(value);}catch{throw new Error('لینک معتبر نیست.');}
    const parts=url.pathname.split('/').filter(Boolean);
    // Modern Sanaei subscriptions have RANDOM path prefixes, not necessarily /sub/.
    // Never fetch the supplied URL; extract only the last path component and
    // perform exact lookup in the authenticated panel before accessing any account.
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('لینک اشتراک معتبر نیست.');
    const sub=decodeURIComponent(parts.at(-1)||'');
    if(!/^[a-zA-Z0-9_-]{4,200}$/.test(sub))throw new Error('شناسه اشتراک نامعتبر است.');
    return {kind:'subId',value:sub};
  }
  if (/^vmess:\/\//i.test(value)) {
    const encoded=value.slice(8).split(/[\s#]/)[0];
    try {
      const data=JSON.parse(Buffer.from(encoded.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8'));
      const id=String(data.id||'').trim();
      if(!id)throw new Error('missing');
      return {kind:'credential',value:id};
    }catch {throw new Error('فرمت VMess نامعتبر است.');}
  }
  const proto=value.match(/^(vless|trojan|ss|hysteria2|hy2|tuic):\/\//i);
  if(proto){
    try{
      const u=new URL(value);
      let secret=decodeURIComponent(u.username);
      if (proto[1].toLowerCase()==='ss' && !u.password && secret && !secret.includes(':')){
        try {secret=Buffer.from(secret.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8');}catch{}
      }
      if (secret.includes(':') && proto[1].toLowerCase()==='ss')secret=secret.split(':').slice(1).join(':');
      if(!secret)throw new Error('empty');
      return {kind:'credential',value:secret};
    } catch{throw new Error('فرمت کانفیگ نامعتبر است.');}
  }
  // Accept plain UUIDs for advanced admin users (but not arbitrary short strings).
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value))return {kind:'credential',value};
  throw new Error('کانفیگ VLESS/VMess/Trojan/SS یا لینک اشتراک کامل بفرستید؛ همچنین email:NAME و subid:VALUE پشتیبانی می‌شود.');
}
export function matchesIdentity(client, identity) {
  if(identity.kind==='email')return String(client.email||'').toLowerCase()===identity.value.toLowerCase();
  if(identity.kind==='subId')return String(client.subId||'')===identity.value;
  const candidates=[client.uuid,client.password,client.auth,client.secret,client.id];
  return candidates.some(x=>typeof x==='string' && x.length>=4 && x===identity.value);
}
export function getClientFromResult(obj) {
  const candidate=obj?.client || obj;
  if(!candidate || typeof candidate.email !== 'string')throw new Error('فرمت پاسخ جزئیات کاربر قابل‌شناسایی نیست.');
  return candidate;
}
export function nextExpiry(oldExpiry,days,now=Date.now()) {
  if (!Number.isFinite(oldExpiry) || oldExpiry<=0) throw new Error('اشتراک دارای تاریخ نامحدود یا شمارش از اولین استفاده است؛ تمدید خودکار مجاز نیست.');
  if (!Number.isInteger(days) || days<1 || days>3650)throw new Error('مدت نامعتبر است.');
  const next=Math.max(now,oldExpiry)+days*86400000;
  if (!Number.isSafeInteger(next))throw new Error('تاریخ پایان نامعتبر است.');
  return next;
}
// Older 3x-ui builds can return a string for the WireGuard allowedIPs field,
// even though the update endpoint requires a JSON array ([]string in Go).
// Preserve restrictions faithfully rather than blindly passing the string back.
export function normalizeAllowedIPs(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    if (!value.every(ip => typeof ip === 'string'))
      throw new Error('فرمت allowedIPs پنل معتبر نیست؛ مقدار باید آرایه‌ای از رشته‌ها باشد.');
    return [...value];
  }
  if (typeof value !== 'string')
    throw new Error('فرمت allowedIPs پنل معتبر نیست؛ برای جلوگیری از تغییر ناخواسته حساب، عملیات متوقف شد.');
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null') return [];
  if (trimmed.startsWith('[')) {
    let parsed;
    try { parsed = JSON.parse(trimmed); }
    catch { throw new Error('فرمت JSON فیلد allowedIPs پنل نامعتبر است؛ عملیات متوقف شد.'); }
    if (!Array.isArray(parsed) || !parsed.every(ip => typeof ip === 'string'))
      throw new Error('فرمت allowedIPs پنل معتبر نیست؛ انتظار آرایه رشته‌ها وجود دارد.');
    return parsed;
  }
  // Some older panels store a comma-separated WireGuard address list.
  // Do not drop nonempty restrictions when normalizing to the API's []string.
  return trimmed.split(/[,\r\n]+/).map(ip => ip.trim()).filter(Boolean);
}

export function updatePayload(client, newExpiry) {
  // API replaces client instead of patching it: retain every documented editable field.
  const fields=['email','uuid','password','auth','secret','flow','security','subId','totalGB','expiryTime',
  'enable','limitIp','limitHwid','tgId','comment','group','reset','resetDay','resetWeekday','resetMax',
  'trafficReset','trafficResetDay','reverse','adTag','allowedIPs','keepAlive','privateKey','publicKey','preSharedKey',
  'clientHostRuleIds','forwardedPorts'];
  const data={};
  for(const key of fields)if(Object.hasOwn(client,key))data[key]=client[key];
  // The read API may expose allowedIPs as a legacy string; the Go update API
  // requires an actual JSON []string. Normalize only when the field exists.
  if(Object.hasOwn(data,'allowedIPs'))data.allowedIPs=normalizeAllowedIPs(data.allowedIPs);
  // In the GET response, id is the numeric database row key. The update API
  // uses id for the Xray credential UUID (as the 3x-ui frontend does).
  // Never forward the numeric database ID into that field.
  if(typeof client.uuid==='string' && client.uuid.trim()) data.id=client.uuid;
  data.expiryTime=newExpiry;
  data.enable=true;
  return data;
}

export function identityFingerprint(identity){
  if(!identity || !['subId','credential'].includes(identity.kind))throw new Error('لینک معتبر لازم است.');
  return createHash('sha256').update(identity.kind+'\0'+identity.value,'utf8').digest('hex');
}
export function hasIdentityFingerprint(client,kind,digest){
  if(!['subId','credential'].includes(kind)||!/^[a-f0-9]{64}$/.test(String(digest)))return false;
  const values=kind==='subId'?[client.subId]:[client.uuid,client.password,client.auth,client.secret,client.id];
  return values.some(value=>typeof value==='string'&&value.length>=4 && identityFingerprint({kind,value})===digest);
}

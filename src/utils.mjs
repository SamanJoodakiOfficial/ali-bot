export const money = value => new Intl.NumberFormat('fa-IR').format(value) + ' تومان';
export const number = value => new Intl.NumberFormat('fa-IR').format(value);
export const short = (s, max = 85) => String(s ?? '').slice(0, max);
export function dateText(ms, timezone = 'Asia/Tehran') {
  if (Number(ms) < 0) return `پس از اولین استفاده: ${Math.round(Math.abs(Number(ms))/86400000)} روز`;
  if (!ms || Number(ms) === 0) return 'نامحدود/نامشخص';
  return new Intl.DateTimeFormat('fa-IR', {timeZone:timezone, dateStyle:'medium', timeStyle:'short'}).format(new Date(ms));
}
export const clip = (s, n = 3500) => String(s).slice(0, n);
export const parseAmount = (s, allowZero = false) => {
  const digits = String(s).replace(/[۰-۹]/g, c => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[ ,٬،_]/g, '');
  if (!/^\d{1,12}$/.test(digits)) throw new Error('مبلغ را به عدد صحیح تومان وارد کنید.');
  const v = Number(digits);
  if (!Number.isSafeInteger(v) || (allowZero ? v < 0 : v <= 0) || v > 1_000_000_000_000) throw new Error('مبلغ معتبر نیست.');
  return v;
};
export function html(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
export const encode = val => encodeURIComponent(String(val));

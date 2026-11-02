# اصلاح خطای `allowedIPs` در تمدید سنایی — v2.4.3

## علت

سرویس 3x-ui پاسخ ویرایش حساب را با خطای `json: cannot unmarshal string into Go struct field .allowedIPs of type []string` رد می‌کند، چون در نسخه قبلی ربات مقدار `allowedIPs` به صورت رشته به API برگردانده می‌شد. نسخه ۲.۴.۳ این مقدار را پیش از ویرایش به `[]string` تبدیل می‌کند و سایر فیلدها را حفظ می‌کند.

## نصب از فایل اصلاحیه در رایانه (سپس Git)

1. از `.env` و دیتابیس خود بکاپ بگیرید.
2. محتویات این ZIP را در ریشه پروژه استخراج کنید و فایل‌های هم‌نام `src/resolve.mjs` و `test/panel.test.mjs` را جایگزین کنید.
3. اجرای تست در سیستم محلی: `docker compose run --rm bot node --test test/*.test.mjs`
4. ثبت تغییرات:

```bash
git add src/resolve.mjs test/panel.test.mjs
git commit -m "fix: normalize allowedIPs array before Sanaei client updates"
git push origin main
```

## نصب روی سرور

```bash
cd /root/ali-bot
docker compose stop bot
mkdir -p /root/ali-bot-backups
cp -a data "/root/ali-bot-backups/data-$(date +%Y%m%d-%H%M%S)"
git pull --ff-only origin main
docker compose up -d --build --force-recreate
docker compose logs --tail=80 bot
```

برای بررسی عملیات پیشین بدون ویرایش حساب:

```bash
docker compose run --rm bot node src/inspect-renewal.mjs 5
```

**هشدار:** عملیات شماره ۵ در وضعیت `review` است و به‌صورت خودکار تکرار یا تسویه نمی‌شود. ابتدا وضعیت واقعی را با سنایی تطبیق دهید؛ اگر تمدید قبلی قطعاً اعمال نشده، مدیر می‌تواند با ذکر توضیح آن را از وضعیت معلق خارج کند و بعد تمدید جدید را فقط یک بار آزمایش کند. این اصلاح بر اساس خطای واقعی پنل و آزمون‌های محلی تهیه شده؛ موفقیت روی پنل شما هنوز تأیید نشده است.

// Safe Telegram diagnostics: deliberately never prints URL/token or message data.
// Stop the main bot before running this (only one getUpdates consumer).
import {loadConfig} from './config.mjs';
import {configureProxy} from './network.mjs';
import {TelegramApi} from './telegram.mjs';
const cfg=loadConfig();
configureProxy(cfg);
const tg=new TelegramApi({token:cfg.telegramToken,baseUrl:cfg.telegramApiBase});
console.log('Endpoint:',new URL(cfg.telegramApiBase).host, 'Proxy:',cfg.telegramProxyUrl?'enabled':'disabled');
async function check(method, payload={}, timeoutMs=12000) {
  const started=Date.now();
  try {
    const result=await tg.call(method,payload,timeoutMs);
    const extra=method==='getMe' ? `username=@${result?.username||'unknown'}`
      : method==='getWebhookInfo' ? `webhook=${result?.url?'enabled':'disabled'}`
      : `updates=${Array.isArray(result)?result.length:'unknown'}`;
    console.log(`${method}${method==='getUpdates'?` timeout=${payload.timeout}`:''}: OK ${extra} elapsed=${Date.now()-started}ms`);
    return true;
  }catch(e){
    const code=String(e.code||'UNKNOWN').slice(0,30);
    // Do not print raw error messages, URL, or request payloads.
    console.log(`${method}${method==='getUpdates'?` timeout=${payload.timeout}`:''}: FAILED code=${code} elapsed=${Date.now()-started}ms`);
    return false;
  }
}
await check('getMe');
const webhookOk=await check('getWebhookInfo');
if (webhookOk) {
  await check('getUpdates',{timeout:0,limit:1},12000);
  await check('getUpdates',{timeout:5,limit:1},17000);
}

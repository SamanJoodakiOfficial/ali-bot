import {loadConfig} from './config.mjs';
import {configureProxy} from './network.mjs';
import {TelegramApi} from './telegram.mjs';
import {PanelApi} from './panel.mjs';
const cfg=loadConfig();
configureProxy(cfg);
const tg=new TelegramApi({token:cfg.telegramToken,baseUrl:cfg.telegramApiBase});
const panel=new PanelApi({baseUrl:cfg.panelBase,token:cfg.panelToken,timeoutMs:cfg.timeoutMs});
const tgHost=new URL(cfg.telegramApiBase).host;
console.log(`Telegram endpoint: ${tgHost} | proxy: ${cfg.telegramProxyUrl?'enabled':'disabled'}`);
try {const user=await tg.call('getMe',{},10000);console.log(`Telegram OK: @${user.username}`);}
catch(e){console.log('Telegram FAILED:',e.message);}
try {const data=await panel.validate();console.log('Panel OK, client total:',data?.total??'unknown');}
catch(e){console.log('Panel FAILED:',e.message);}

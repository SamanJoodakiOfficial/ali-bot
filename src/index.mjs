import {setTimeout as sleep} from 'node:timers/promises';
import {loadConfig} from './config.mjs';
import {configureProxy} from './network.mjs';
import {Store} from './store.mjs';
import {PanelApi} from './panel.mjs';
import {TelegramApi} from './telegram.mjs';
import {AdaptivePolling} from './polling.mjs';
import {Bot} from './bot.mjs';

async function main(){
  const config=loadConfig();
  configureProxy(config);
  const db=new Store(config.dbPath);
  const tg=new TelegramApi({token:config.telegramToken,baseUrl:config.telegramApiBase});
  const panel=new PanelApi({baseUrl:config.panelBase,token:config.panelToken,timeoutMs:config.timeoutMs});
  const bot=new Bot({config,db,panel,tg});
  let running=true;
  const stopper=new AbortController();
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{running=false;stopper.abort();});
  process.on('unhandledRejection',e=>console.error('Unhandled rejection:',e?.name||'Error'));
  let connected=false;
  let lastId=Number(db.meta('last_update')||0);
  const poll = new AdaptivePolling(config.telegramPollSeconds);
  let phase='initializing';
  try {
    while(running){
      try {
        if(!connected){
          phase='getMe';
          const me=await tg.call('getMe',{},15000,stopper.signal);
          phase='getWebhookInfo';
          const webhook=await tg.call('getWebhookInfo',{},15000,stopper.signal);
          if(webhook.url)throw new Error('یک Webhook فعال است؛ برای Long Polling ابتدا آن را غیرفعال کنید.');
          connected=true;
          console.log(`Connected to Telegram as @${me.username}; getUpdates timeout=${poll.seconds}s.`);
          tg.call('setMyCommands',{commands:[
            {command:'start',description:'منوی اصلی'},
            {command:'whoami',description:'شناسه عددی تلگرام'},
            {command:'cancel',description:'لغو عملیات'},
            {command:'menu',description:'بازگشت به منو'}
          ]}).catch(()=>{});
        }
        phase='getUpdates';
        const updates=await tg.call('getUpdates',{offset:lastId+1,timeout:poll.seconds,limit:25,allowed_updates:['message','callback_query']},poll.requestTimeoutMs,stopper.signal);
        poll.success();
        for(const update of updates){
          if(!running)break;
          try{await bot.handle(update);}catch(e){console.error('Handler failed:',e?.name||'Error');}
          lastId=update.update_id;
          db.setMeta('last_update',lastId);
        }
        // Avoid a busy loop when a network cannot maintain long polling.
        if(poll.isShort) await sleep(1500,undefined,{signal:stopper.signal});
      }catch(e){
        if(!running)break;
        if(phase==='getUpdates' && poll.failure(e)) {
          console.warn('Long polling repeatedly failed; switching to short polling (timeout=0).');
        }
        // Never print URL, token, request objects, or response bodies in logs.
        const safeMessage=String(e.message||e.name||'network error').replace(/bot\d+:[A-Za-z0-9_-]+/g,'[token]').slice(0,250);
        console.error(`Telegram ${phase} unavailable:`,safeMessage);
        try{await sleep(phase==='getUpdates' ? 3500 : 10000,undefined,{signal:stopper.signal});}catch{break;}
      }
    }
  } finally {db.close();console.log('Bot stopped.');}
}
main().catch(e=>{console.error('Startup configuration/storage error:',e?.message||'error');process.exitCode=1;});

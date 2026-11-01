import {randomBytes} from 'node:crypto';
import {button as B,copyButton} from './telegram.mjs';
import {money,number,short,html,dateText,parseAmount} from './utils.mjs';
import {addMonths,renewByMonths,extractIdentity,quotaAddition,identityFingerprint,hasIdentityFingerprint} from './resolve.mjs';
import {periodNames,periodBounds} from './sales.mjs';
import {createBackup,performRestore,validateBackup,backupFolder,MAX_UPLOAD_BYTES} from './maintenance.mjs';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes as secureRandomBytes} from 'node:crypto';

const kb=(...rows)=>rows;
const back=()=>[B('🏠 منوی اصلی','home')];
const GB=1073741824;
const CUSTOM_PLAN_ID=999997;
const cleanError=e=>html(String(e?.message||'خطای ناشناخته').replace(/https?:\/\/\S+/g,'[link]').slice(0,260));
function integer(raw,min,max,label){const n=Number(String(raw).replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)));if(!Number.isInteger(n)||n<min||n>max)throw new Error(`${label} باید عدد صحیح ${min} تا ${max} باشد.`);return n;}
function trimName(s,len=80){const v=s.trim();if(v.length<2||v.length>len)throw new Error('نام نامعتبر است.');return v;}
function safeEmail(s){if(!/^[a-zA-Z0-9_.-]{3,55}$/.test(s)||s==='.'||s==='..')throw new Error('نام حساب باید بین ۳ تا ۵۵ حرف لاتین/عدد/نقطه/خط‌تیره/زیرخط باشد.');return s;}
const statusName=s=>({pending:'⏳ در انتظار',applied:'✅ اعمال شد',failed:'❌ ناموفق',review:'⚠️ بررسی دستی'})[s]||s;

export class Bot {
  constructor({config,db,panel,tg,onRestore=()=>process.exit(0)}){this.cfg=config;this.db=db;this.panel=panel;this.tg=tg;this.onRestore=onRestore;this.currentUpdateId=0;}
  admin(id){return this.cfg.ownerIds.has(String(id));}
  role(id){if(this.admin(id))return 'owner';const r=this.db.repByTg(id);return r?.active?'rep':'guest';}
  rep(id){return this.db.repByTg(id);}
  say(id,text,keys){return this.tg.send(id,text,keys);}
  async notifyOwners(text,keys){for(const owner of this.cfg.ownerIds){try{await this.say(owner,text,keys);}catch{this.db.log('system','notification.failed',`owner:${owner}`);}}}
  async notifyRep(rep,text,keys){try{await this.say(rep.telegram_id,text,keys);}catch{this.db.log('system','notification.failed',`rep:${rep.id}`);}}
  async debtCheck(repId){
    if(!this.db.debtAlertTrigger(repId))return;
    const r=this.db.rep(repId), balance=this.db.balance(repId);
    const text=`⚠️ <b>هشدار سقف بدهکاری</b>\nنماینده: ${html(r.name)}\nمانده: <b>${money(balance)}</b>\nحد هشدار: ${money(r.debt_alert)}`;
    await this.notifyOwners(text,kb([B('👤 مدیریت نماینده',`a:rep:${r.id}`)]));
    await this.notifyRep(r,text+'\nلطفاً از بخش تسویه، واریزی خود را ثبت کنید.');
  }
  async home(id){
    this.db.clearSession(id);
    const role=this.role(id);
    if(role==='guest')return this.say(id,'⛔️ دسترسی به مدیریت نمایندگان ندارید. /whoami را بفرستید و شناسه را به مدیر بدهید.');
    if(role==='owner')return this.say(id,'🛡 <b>مدیریت مرکزی نمایندگان سنایی</b>\nاز منوی زیر انتخاب کنید:',kb(
      [B('👥 نمایندگان','a:reps'),B('📈 گزارش فروش','a:sales')],
      [B('🖧 اینباندهای مجاز','a:inbounds'),B('🏦 حساب بانکی','a:bank')],
      [B('🔗 آدرس سرور اشتراک','a:subbase')],
      [B('🧾 واریزی‌ها','a:payments'),B('📊 گزارش مالی','a:finance')],
      [B('💬 مکاتبات','a:chats'),B('📣 پیام همگانی','a:broadcast')],
      [B('📜 تاریخچه عملیات','a:operations')],
      [B('⚠️ بررسی عملیات معلق','a:pending'),B('🪵 گزارش لاگ','a:logs')],
      [B('💾 بکاپ و بازیابی','a:backup')],
      [B('🔁 انتساب حساب قدیمی','a:transfer'),B('🩺 سلامت پنل','a:health')]
    ));
    const r=this.rep(id), balance=this.db.balance(r.id);
    return this.say(id,`👤 <b>نمایندگی ${html(r.name)}</b>\nمانده حساب: <b>${money(balance)}</b>${r.debt_alert?'\nحد هشدار: '+money(r.debt_alert):''}\nمانده مثبت یعنی بدهکار و منفی یعنی بستانکار.`,kb(
      [B('➕ ساخت اشتراک ماهانه','r:create'),B('👥 اشتراک‌های من','r:accounts:0')],
      [B('🔄 تمدید با لینک/کانفیگ','r:renew'),B('📈 گزارش فروش','r:sales')],
      [B('🔗 افزودن حساب قدیمی با لینک','r:connect')],
      [B('📜 تاریخچه عملیات','r:history')],
      [B('💳 تسویه و اعلام واریزی','r:settle'),B('📒 گردش مالی','r:balance')],
      [B('💬 پیام به مدیر','r:chat'),B('🧾 واریزی‌های من','r:payments')]
    ));
  }
  async handle(update){
    this.currentUpdateId=Number(update.update_id||0);
    const message=update.message,callback=update.callback_query,msg=message||callback?.message;
    if(!msg||msg.chat?.type!=='private')return;
    const id=String(message?.from?.id||callback?.from?.id), role=this.role(id);
    try{
      if(callback){this.pendingCallbackId=callback.id;return await this.callback(id,callback.data||'',role);}
      const text=String(message?.text||'').trim();
      if(text==='/whoami')return this.say(id,`شناسه شما: <code>${html(id)}</code>`);
      if(['/start','/menu','/cancel','/help'].includes(text))return this.home(id);
      if(role==='guest')return this.home(id);
      const session=this.db.session(id);
      if(session)return await this.input(id,role,session,message);
      return this.home(id);
    }catch(e){
      this.db.log(id,'bot.error','workflow',String(e.message||'unknown').replace(/https?:\/\/\S+/g,'[link]').slice(0,150));
      console.error('Bot action failed:',e?.name||'Error',e?.code||e?.status||'');
      try{await this.say(id,'❌ '+cleanError(e),kb(back()));}catch{}
    }finally{if(callback)await this.tg.answer(callback.id).catch(()=>{});}
  }
  callback(id,data,role){
    if(data==='home')return this.home(id);
    if(role==='guest')throw new Error('اجازه دسترسی ندارید.');
    if(data.startsWith('a:')){if(role!=='owner')throw new Error('فقط مدیر اصلی می‌تواند این کار را انجام دهد.');return this.adminAction(id,data.slice(2));}
    if(data.startsWith('r:')){if(role!=='rep')throw new Error('فقط نماینده می‌تواند این کار را انجام دهد.');return this.repAction(id,data.slice(2));}
    throw new Error('دکمه ناشناخته است.');
  }
  prompt(id,state,text,payload={}){this.db.setSession(id,state,payload);return this.say(id,text,kb(back()));}
  plansFor(repId){return this.db.plans(true).filter(p=>this.db.price(repId,p.id).amount>0);}
  planButtons(repId,callbackPrefix){return this.plansFor(repId).slice(0,35).map(p=>[B(`${short(p.name,25)} | ${p.volume_gb}GB / ${p.months} ماه | ${money(this.db.price(repId,p.id).amount)}`,`${callbackPrefix}:${p.id}`)]);}
  async adminAction(id,action){
    const [op,a,b]=action.split(':');const n=Number(a);
    if(op==='reps'){
      const reps=this.db.reps(),offset=Math.max(0,Number(a)||0),size=15;
      return this.say(id,`👥 <b>نمایندگان (${reps.length})</b>\nمانده مثبت بدهکاری است.`,kb(
        ...reps.slice(offset,offset+size).map(r=>[B(`#${r.id} ${short(r.name,18)} ${r.active?'✅':'🚫'} | ${number(r.balance)} تومان`,`a:rep:${r.id}`)]),
        [...(offset>0?[B('⬅️ قبلی',`a:reps:${Math.max(0,offset-size)}`)]:[]),...(offset+size<reps.length?[B('بعدی ➡️',`a:reps:${offset+size}`)]:[])],
        [B('➕ تعریف نماینده','a:addrep')],back()));
    }
    if(op==='backup')return this.say(id,'💾 <b>بکاپ و بازیابی</b>\nفایل بکاپ شامل تمامی اطلاعات نمایندگان، بدهی‌ها، واریزی‌ها، مکاتبات و لاگ‌هاست. آن را محرمانه نگه دارید.\n\nبازیابی باعث جایگزینی داده‌های فعلی می‌شود؛ پیش از آن بکاپ نجات گرفته خواهد شد.',kb(
      [B('📥 ساخت و ارسال بکاپ','a:backupexport')],
      [B('📤 بازیابی از فایل SQLite','a:restore')],back()));
    if(op==='backupexport'){
      const file=await createBackup(this.db);
      this.db.log(id,'backup.created','local','admin_download');
      const data=await readFile(file);
      if(data.length>MAX_UPLOAD_BYTES)throw new Error('بکاپ محلی ساخته شد اما اندازه آن برای ارسال با تلگرام زیاد است؛ از پوشه data/backups بردارید.');
      await this.tg.sendDocument(id,data,file.split('/').at(-1),'⚠️ بکاپ محرمانه سامانه نمایندگان؛ این فایل را نزد افراد دیگر نفرستید.');
      return this.say(id,'✅ نسخه پشتیبان ساخته و ارسال شد. یک کپی در پوشه data/backups نیز نگهداری می‌شود.',kb(back()));
    }
    if(op==='restore')return this.prompt(id,'admin.restore.upload','⚠️ بازیابی، تمام اطلاعات فعلی را با فایل شما جایگزین می‌کند. فقط فایل .sqlite بکاپ همین ربات را به‌صورت Document ارسال کنید. حداکثر ۱۸MB.');
    if(op==='restoreapply'){
      const s=this.db.session(id);
      if(s?.state!=='admin.restore.confirm')throw new Error('مرحله بازیابی منقضی شده است. فایل را دوباره ارسال کنید.');
      const file=s.payload.stage;
      await validateBackup(file);
      await this.tg.answer(this.pendingCallbackId||'').catch(()=>{});
      await this.say(id,'✅ فایل معتبر است. نسخه نجات از دیتابیس فعلی گرفته می‌شود؛ سپس اطلاعات بازیابی و ربات دوباره راه‌اندازی خواهد شد.');
      // Last update id is preserved in the restored SQLite to prevent duplicate callbacks.
      const currentOffset=Math.max(Number(this.db.meta('last_update')||0),this.currentUpdateId);
      const result=await performRestore(this.db,file,currentOffset);
      await unlink(file).catch(()=>{});
      console.log('Restore committed; recovery backup retained in data/backups.');
      this.onRestore(result);
      return;
    }
    if(op==='addrep')return this.prompt(id,'rep.id','شناسه عددی تلگرام نماینده را وارد کنید.');
    if(op==='rep'){
      const r=this.db.rep(n);if(!r)throw new Error('نماینده پیدا نشد.');

      return this.say(id,`👤 <b>${html(r.name)}</b> #${r.id}\nTelegram ID: <code>${r.telegram_id}</code>\nوضعیت: ${r.active?'فعال':'غیرفعال'}\nمانده: <b>${money(this.db.balance(r.id))}</b>\nحد هشدار: ${r.debt_alert?money(r.debt_alert):'خاموش'}\nتعداد حساب: ${number(this.db.accountsCount(r.id))}\nنرخ هر گیگابایت در ماه: <b>${r.price_per_gb_month?money(r.price_per_gb_month):'تعریف نشده'}</b>`,kb(
        [B('💰 تعیین نرخ هر گیگ/ماه',`a:gigrate:${r.id}`)],
        [B('⚠️ تنظیم حد هشدار',`a:threshold:${r.id}`),B('💬 گفت‌وگو',`a:chat:${r.id}`)],
        [B('📈 گزارش فروش',`a:salesrep:${r.id}`)],
        [B('👥 حساب‌ها',`a:accounts:${r.id}:0`),B('📒 گردش مالی',`a:ledger:${r.id}`)],
        [B('📜 تاریخچه نماینده',`a:history:${r.id}:0`)],
        [B('✏️ نام',`a:rename:${r.id}`),B(r.active?'🚫 غیرفعال':'✅ فعال',`a:toggle:${r.id}`)],
        [B('➕/➖ اصلاح مانده',`a:adjust:${r.id}`)],
        [B('⬅️ نمایندگان','a:reps')]));
    }
    if(op==='gigrate')return this.prompt(id,'rep.gigrate','قیمت یک گیگابایت برای یک ماه را به تومان وارد کنید. مثال: ۵۰۰۰؛ فروش ۲۰ گیگ یک‌ماهه = ۱۰۰,۰۰۰ تومان. مقدار ۰ یعنی ممنوعیت فروش.',{repId:n});
    if(op==='rename')return this.prompt(id,'rep.rename','نام جدید نماینده:',{repId:n});
    if(op==='toggle'){const r=this.db.rep(n);if(!r)throw new Error('نماینده پیدا نشد.');this.db.updateRep(n,'active',r.active?0:1,id);return this.adminAction(id,`rep:${n}`);}
    if(op==='threshold')return this.prompt(id,'rep.threshold','حد هشدار بدهکاری بر حسب تومان را وارد کنید. «۰» یعنی غیرفعال. با عبور از حد، برای مدیر و نماینده پیام ارسال می‌شود.',{repId:n});
    if(op==='rate'){
      const r=this.db.rep(n),p=this.db.plan(Number(b));if(!r||!p)throw new Error('نماینده/پلن وجود ندارد.');
      return this.prompt(id,'rep.rate',`قیمت پلن «${html(p.name)}» برای «${html(r.name)}» (تومان):\nقیمت فعلی: ${money(this.db.price(n,p.id).amount)}\n۰ یعنی غیرقابل خرید.`,{repId:n,planId:p.id});
    }
    if(op==='subbase')return this.prompt(id,'admin.subbase',`آدرس کامل و عمومی سرور اشتراک، به‌همراه مسیر تصادفی را وارد کنید. مثلاً:
https://sub.example.com:2096/random-path/

فعلی: ${html(this.subscriptionBase()||'تنظیم نشده')}

با - می‌توانید پاک کنید.`);
    if(op==='sales')return this.salesMenu(id,null);
    if(op==='salesrep'){
      if(!this.db.rep(n))throw new Error('نماینده وجود ندارد.');
      return this.salesMenu(id,n);
    }
    if(op==='salesshow')return this.salesReport(id,a, b ? Number(b) : null, 0);
    if(op==='salespage'){
      const [period,repId,offset] = action.slice('salespage:'.length).split(':');
      return this.salesReport(id,period,repId==='all'?null:Number(repId),Number(offset)||0);
    }
    if(op==='receipt')return this.sendReceipt(id,n,true);
    if(op==='usage'){const row=this.db.accountById(n);if(!row)throw new Error('حساب پیدا نشد.');return this.accountUsage(id,row.email);}
    if(op==='links'){
      const row=this.db.accountById(n);if(!row)throw new Error('حساب وجود ندارد.');
      return this.sendClientLinks(id,row.rep_id,row.email);
    }
    if(['plans','plan','newplan','planfield','ptoggle','rate'].includes(op))throw new Error('طرح‌های ثابت حذف شده‌اند؛ فقط فروش یک‌ماهه با حجم دلخواه فعال است.');
    if(op==='plans'){
      const ps=this.db.plans();return this.say(id,'📦 <b>پلن‌های ماهانه</b>\nقیمت صفر یعنی پلن برای نماینده قابل خرید نیست.',kb(
        ...ps.slice(0,50).map(p=>[B(`#${p.id} ${short(p.name,21)} | ${p.volume_gb} گیگ / ${p.months} ماه | ${money(p.base_price)} ${p.active?'✅':'🚫'}`,`a:plan:${p.id}`)]),
        [B('➕ پلن جدید','a:newplan')],back()));
    }
    if(op==='plan'){
      const p=this.db.plan(n);if(!p)throw new Error('پلن پیدا نشد.');
      return this.say(id,`📦 ${html(p.name)}\nحجم: ${p.volume_gb} گیگابایت\nمدت: ${p.months} ماه\nقیمت پیش‌فرض: ${money(p.base_price)}\nوضعیت: ${p.active?'فعال':'غیرفعال'}`,kb(
        [B('✏️ نام',`a:planfield:${p.id}:name`),B('📅 ماه',`a:planfield:${p.id}:months`)],
        [B('📦 حجم',`a:planfield:${p.id}:volume_gb`),B('💰 قیمت',`a:planfield:${p.id}:base_price`)],
        [B(p.active?'🚫 غیرفعال‌سازی':'✅ فعال‌سازی',`a:ptoggle:${p.id}`)],
        [B('⬅️ پلن‌ها','a:plans')]));
    }
    if(op==='newplan')return this.prompt(id,'plan.name','نام پلن را وارد کنید.');
    if(op==='planfield')return this.prompt(id,'plan.field',`مقدار جدید «${html(b)}» را ارسال کنید.`,{planId:n,field:b});
    if(op==='ptoggle'){const p=this.db.plan(n);if(!p)throw new Error('پلن پیدا نشد.');this.db.changePlan(n,'active',p.active?0:1,id);return this.adminAction(id,`plan:${n}`);}
    if(op==='bank'){
      const x=this.db.bank();return this.say(id,`🏦 <b>مشخصات تسویه</b>\nدارنده: ${html(x.holder||'—')}\nکارت: <code>${html(x.card||'—')}</code>\nشبا: <code>${html(x.iban||'—')}</code>`,kb(
        [B('💳 شماره کارت','a:bankfield:card'),B('🏦 شبا','a:bankfield:iban')],
        [B('👤 نام دارنده','a:bankfield:holder')],back()));
    }
    if(op==='bankfield')return this.prompt(id,'bank.field',`مقدار جدید ${html(a)} را وارد کنید؛ - برای حذف.`,{field:a});
    if(op==='inbounds'){
      const inbounds=await this.panel.listInbounds(),selected=new Set(this.db.allowedInbounds().map(x=>x.id));
      return this.say(id,'🖧 <b>اینباندهای قابل‌استفاده نمایندگان</b>\nتنها اینباندهای فعال‌شده در این فهرست برای ساخت حساب در دسترس هستند.',kb(
        ...inbounds.slice(0,35).map(i=>[B(`${selected.has(i.id)?'✅':'▫️'} #${i.id} ${short(i.remark||i.protocol,28)} ${i.enable?'🟢':'🔴'}`,`a:inbound:${i.id}`)]),back()));
    }
    if(op==='inbound'){this.db.toggleInbound(n,id);return this.adminAction(id,'inbounds');}
    if(op==='payments'){
      const offset=Math.max(0,n||0),total=this.db.allPaymentsCount(),list=this.db.allPayments(15,offset);
      const stateName={pending:'⏳',approved:'✅',rejected:'❌'};
      return this.say(id,`🧾 <b>تمام واریزی‌ها (${number(total)})</b>\nبرای بررسی، تأیید یا مشاهده مجدد رسید، روی هر مورد بزنید.`,kb(
        ...list.map(p=>[B(`#${p.id} ${short(p.rep_name,14)} ${stateName[p.state]||''} | ${money(p.amount)}`,`a:payment:${p.id}`)]),
        [...(offset>0?[B('⬅️ جدیدتر',`a:payments:${Math.max(0,offset-15)}`)]:[]),...(offset+15<total?[B('قدیمی‌تر ➡️',`a:payments:${offset+15}`)]:[])],back()));
    }
    if(op==='payment'){
      const p=this.db.payment(n);if(!p)throw new Error('واریزی وجود ندارد.');const rep=this.db.rep(p.rep_id);
      await this.say(id,`🧾 <b>واریزی #${p.id}</b>\nنماینده: ${html(rep?.name)}\nمبلغ: ${money(p.amount)}\nپیگیری: <code>${html(p.reference)}</code>\nوضعیت: ${p.state}\nتاریخ: ${dateText(p.created_at,this.cfg.timezone)}`,kb(
        ...(p.state==='pending'?[[B('✅ تأیید دریافت واقعی وجه',`a:approve:${p.id}`),B('❌ رد واریزی',`a:reject:${p.id}`)]]:[]),
        ...(p.receipt_file?[[B('🖼 مشاهده رسید',`a:receipt:${p.id}`)]]:[]),
        [B('⬅️ واریزی‌ها','a:payments')]));
      return;
    }
    if(op==='approve'||op==='reject'){
      const p=this.db.settlePayment(n,op==='approve',id),rep=this.db.rep(p.rep_id);
      await this.notifyRep(rep,`🧾 واریزی #${p.id} به مبلغ ${money(p.amount)} ${op==='approve'?'تأیید و از مانده بدهی کسر شد.':'رد شد. برای پیگیری به مدیر پیام دهید.'}`);
      await this.debtCheck(rep.id);return this.adminAction(id,'payments');
    }
    if(op==='finance'){
      const rs=this.db.reps();return this.say(id,`📊 <b>گزارش مالی</b>\nنمایندگان: ${rs.length}\nمانده بدهکاران: ${money(rs.reduce((a,r)=>a+Math.max(0,r.balance),0))}\nمانده بستانکاران: ${money(rs.reduce((a,r)=>a+Math.max(0,-r.balance),0))}\nواریزی در انتظار: ${this.db.pendingPayments().length}`,kb([B('👥 جزئیات نمایندگان','a:reps')],back()));
    }
    if(op==='ledger'){
      const r=this.db.rep(n);if(!r)throw new Error('نماینده وجود ندارد.');
      const lines=this.db.ledger(n,20).map(t=>`#${t.id} ${t.kind} | ${money(t.amount)}\n${html(short(t.description,85))}\n${dateText(t.created_at,this.cfg.timezone)}`);
      return this.say(id,`📒 <b>${html(r.name)}</b>\nمانده ${money(this.db.balance(n))}\n\n${lines.join('\n\n')||'تراکنشی نیست.'}`.slice(0,4000),kb([B('⬅️ نماینده',`a:rep:${n}`)]));
    }
    if(op==='adjust')return this.prompt(id,'adjust.amount','مبلغ اصلاح مانده را وارد کنید: مثبت = افزایش بدهی، منفی = کاهش بدهی.',{repId:n});
    if(op==='accounts')return this.accountList(id,n,Number(b)||0,true);
    if(op==='account'){const c=this.db.accountById(n);if(!c)throw new Error('حساب وجود ندارد.');return this.accountDetail(id,Number(b),c.email,true);}
    if(op==='chat')return this.chatHistory(id,n,true,Number(b)||0);
    if(op==='chats'){
      const reps=this.db.reps();return this.say(id,'💬 <b>گفت‌وگو با نمایندگان</b>\nنماینده را انتخاب کنید:',kb(
        ...reps.slice(0,45).map(r=>[B(`#${r.id} ${short(r.name,30)}`,`a:chat:${r.id}`)]),back()));
    }
    if(op==='broadcast')return this.prompt(id,'admin.broadcast','متن پیام همگانی به تمام نمایندگان فعال را وارد کنید. پیش از ارسال، تأیید گرفته می‌شود.');
    if(op==='broadcastsend'){
      const s=this.db.session(id);if(s?.state!=='admin.broadcast.confirm')throw new Error('پیام همگانی منقضی شده است.');
      this.db.clearSession(id);
      let delivered=0,failed=0;
      for(const rep of this.db.reps().filter(r=>r.active)){
        const ok=await this.deliverMessage(rep.id,id,'admin_to_rep',s.payload.text);
        ok?delivered++:failed++;
      }
      this.db.log(id,'chat.broadcast','active_reps',`delivered=${delivered}; failed=${failed}`);
      return this.say(id,`📣 پیام همگانی انجام شد. موفق: ${number(delivered)} | ارسال ناموفق: ${number(failed)}`,kb(back()));
    }
    if(op==='reply')return this.prompt(id,'admin.message','متن پیام برای نماینده را ارسال کنید.',{repId:n});
    if(op==='operations'){
      const offset=Math.max(0,n||0),rows=this.db.operationsAll(10,offset),total=this.db.operationsAllCount();
      const lines=rows.map(x=>`${x.kind==='create'?'➕':'🔄'} #${x.id} ${html(x.rep_name)} | ${html(x.email)}\n${x.months}ماه/${x.volume_gb}گیگ | ${statusName(x.status)} | ${money(x.price)}\n${dateText(x.created_at,this.cfg.timezone)}`);
      return this.say(id,`📜 <b>سوابق کل سیستم (${total})</b>\n\n${lines.join('\n\n')||'موردی نیست.'}`.slice(0,4000),kb(
        [...(offset>0?[B('⬅️ قبلی',`a:operations:${Math.max(0,offset-10)}`)]:[]),...(offset+10<total?[B('بعدی ➡️',`a:operations:${offset+10}`)]:[])],back()));
    }
    if(op==='history')return this.sendOperations(id,n,Number(b)||0,true);
    if(op==='pending'){
      const renews=this.db.pendingOps(), creates=this.db.pendingCreations();
      return this.say(id,'⚠️ <b>عملیات نیازمند بررسی</b>\nهر مورد با وضعیت واقعی پنل تطبیق داده می‌شود و در صورت نامشخص‌بودن، بدهکاری ثبت نخواهد شد.',kb(
        ...creates.map(c=>[B(`➕ ایجاد #${c.id} ${short(c.email,25)} ${c.status}`,`a:reconcilecreate:${c.id}`)]),
        ...renews.map(r=>[B(`🔄 تمدید #${r.id} ${short(r.email,25)} ${r.status}`,`a:reconcilerenew:${r.id}`)]),back()));
    }
    if(op==='reconcilecreate'){const res=await this.reconcileCreation(n,id);const o=this.db.creation(n);return this.say(id,html(res),kb(
      ...(o?.status==='review'?[[B('🔒 بستن بدون بدهی (پس از بررسی دستی)',`a:closecreate:${n}`)]]:[]),[B('⬅️ موارد معلق','a:pending')]));}
    if(op==='reconcilerenew'){const res=await this.reconcileRenew(n,id);const o=this.db.renewal(n);return this.say(id,html(res),kb(
      ...(o?.status==='review'?[[B('🔒 بستن بدون بدهی (پس از بررسی دستی)',`a:closerenew:${n}`)]]:[]),[B('⬅️ موارد معلق','a:pending')]));}
    if(op==='closecreate'||op==='closerenew'){
      const operation=op==='closecreate'?this.db.creation(n):this.db.renewal(n);
      if(!operation||operation.status!=='review')throw new Error('عملیات در وضعیت بررسی نیست.');
      return this.prompt(id,'admin.close.reason',`⚠️ تنها پس از بررسی دستی وضعیت واقعی پنل، این عملیات را «ناموفق، بدون بدهی» ثبت کنید.\nنوع: ${op==='closecreate'?'ساخت':'تمدید'} #${n}\nحساب: ${html(operation.email)}\nدلیل دقیق تصمیم را وارد کنید (حداقل ۸ کاراکتر).`,{kind:op,id:n});
    }
    if(op==='logs'){
      const offset=Math.max(0,n||0),logs=this.db.logs(15,offset);
      return this.say(id,`🪵 <b>گزارش رویدادها</b>\n\n${logs.map(e=>`#${e.id} ${html(e.action)} | ${html(e.actor)}\n${html(e.subject)} ${html(short(e.detail,55))}\n${dateText(e.created_at,this.cfg.timezone)}`).join('\n\n')||'—'}`.slice(0,4000),kb(
        [...(offset>0?[B('⬅️ قبلی',`a:logs:${Math.max(0,offset-15)}`)]:[]),...(logs.length===15?[B('بعدی ➡️',`a:logs:${offset+15}`)]:[])],back()));
    }
    if(op==='transfer')return this.prompt(id,'transfer.email','نام دقیق حساب قدیمی را وارد کنید؛ پس از تأیید وجود در پنل، نماینده مالک آن را انتخاب می‌کنید.');
    if(op==='health'){
      const p=await this.panel.validate();return this.say(id,`✅ ارتباط API پنل برقرار است. تعداد کل کاربران: ${number(p.total||0)}`,kb(back()));
    }
    throw new Error('دستور مدیریتی ناشناخته است.');
  }
  async repAction(id,action){
    const r=this.rep(id);if(!r?.active)throw new Error('نمایندگی غیرفعال است.');
    const [op,a,b]=action.split(':');const n=Number(a);
    if(op==='create'){
      if(!r.price_per_gb_month)throw new Error('مدیر هنوز نرخ هر گیگابایت ماهانه را برای شما مشخص نکرده است.');
      return this.prompt(id,'create.volume',`➕ <b>ساخت اشتراک جدید</b>\nحجم موردنظر را به گیگابایت وارد کنید.\nحداقل: ۲۰ گیگابایت\nنرخ شما: ${money(r.price_per_gb_month)} برای هر گیگ در هر ماه.`);
    }
    if(op==='createmonths'){
      const s=this.db.session(id);if(s?.state!=='create.months')throw new Error('مرحله منقضی شده است.');
      const months=integer(a,1,1,'ماه'), price=this.db.customPrice(r.id,s.payload.volumeGb,months);
      const panelInbounds=await this.panel.listInbounds();
      const allowed=new Set(this.db.allowedInbounds().map(x=>x.id));
      const choices=panelInbounds.filter(x=>x.enable&&allowed.has(x.id));
      if(!choices.length)throw new Error('مدیر هنوز اینباند فعالی را مجاز نکرده است.');
      this.db.setSession(id,'create.inbound',{volumeGb:s.payload.volumeGb,months});
      return this.say(id,`📦 ${s.payload.volumeGb} گیگ / ${months} ماه / ${money(price)}\nاینباند را انتخاب کنید:`,kb(...choices.slice(0,30).map(x=>[B(`#${x.id} ${short(x.remark||x.protocol,35)}`,`r:createinbound:${x.id}`)]),back()));
    }
    if(op==='createinbound'){
      const s=this.db.session(id);if(s?.state!=='create.inbound')throw new Error('مرحله منقضی شده است.');
      if(!this.db.allowedInbounds().some(x=>x.id===n))throw new Error('اینباند غیرمجاز است.');
      return this.prompt(id,'create.name','نام انگلیسی اشتراک را وارد کنید؛ مانند ali123. نام با پیشوند نماینده ذخیره می‌شود.',{...s.payload,inboundId:n});
    }
    if(op==='createconfirm'){
      const s=this.db.session(id);if(s?.state!=='create.confirm')throw new Error('تأیید ساخت منقضی شده است.');
      this.db.clearSession(id);return this.performCreation(id,r,s.payload);
    }
    if(op==='accounts')return this.accountList(id,r.id,n,false);
    if(op==='accountssearch')return this.prompt(id,'accounts.search','🔎 بخشی از نام اشتراک ذخیره‌شده خود را وارد کنید (حداقل ۲ کاراکتر).');
    if(op==='account'){const c=this.db.accountById(n);if(!c)throw new Error('حساب وجود ندارد.');return this.accountDetail(id,r.id,c.email,false);}
    if(op==='toggle'){
      const row=this.db.accountById(n),email=row?.email,owner=email?this.db.owner(email):null;
      if(owner?.rep_id!==r.id)throw new Error('این حساب متعلق به شما نیست.');
      const c=await this.panel.details(email);if(this.db.pendingOps().some(o=>o.email===email)||this.db.pendingCreations().some(o=>o.email===email))throw new Error('عملیات مالی معلق است.');
      await this.panel.toggleClient(email,Boolean(c.enable));
      this.db.log(id,'client.toggle',email,c.enable?'disabled':'enabled');
      return this.accountDetail(id,r.id,email,false);
    }
    if(op==='connect')return this.prompt(id,'connect.link','🔗 لینک کانفیگ یا Subscription Link حساب موجود را ارسال کنید؛ پس از بررسی حساب در پنل، به فهرست «اشتراک‌های من» اضافه می‌شود.');
    if(op==='renew')return this.prompt(id,'renew.link','لینک اشتراک یا کانفیگ را ارسال کنید.\nفرمت‌های قابل‌شناسایی: vless://، vmess://، trojan://، ss://، لینک /sub/…، email:NAME یا subid:VALUE.\nبرای امنیت، لینک شما دانلود نمی‌شود.');
    if(op==='linkadd'||op==='linkrenew'||op==='linkrenewadd'){
      const state=this.db.session(id);
      if(state?.state!=='link.review')throw new Error('لینک قبلی منقضی شده است؛ دوباره ارسال کنید.');
      const {email,proofKind,proofHash}=state.payload;
      const current=await this.panel.details(email);
      if(!hasIdentityFingerprint(current,proofKind,proofHash))throw new Error('شناسه لینک با اطلاعات فعلی پنل تطابق ندارد.');
      const owner=this.db.owner(email);
      if(owner && owner.rep_id!==r.id)throw new Error('حساب قبلاً به نماینده دیگری اختصاص یافته است.');
      if(op==='linkadd'||op==='linkrenewadd'){
        const claimed=this.db.claim(email,r.id,id);
        if(claimed)await this.notifyOwners(`📌 حساب <code>${html(email)}</code> با ارائه لینک معتبر توسط نماینده ${html(r.name)} به فهرست او افزوده شد.`);
      }
      if(op==='linkadd'){
        this.db.clearSession(id);
        return this.accountDetail(id,r.id,email,false);
      }
      return this.chooseRenewal(id,r,current,{allowUnowned:!this.db.owner(email),proofKind,proofHash});
    }
    if(op==='usage'){
      const row=this.db.accountById(n);
      if(!row||this.db.owner(row.email)?.rep_id!==r.id)throw new Error('این حساب متعلق به نماینده دیگری است.');
      return this.accountUsage(id,row.email);
    }
    if(op==='unpin'){
      const row=this.db.accountById(n);
      if(!row||row.rep_id!==r.id)throw new Error('اشتراک در فهرست شما پیدا نشد.');
      return this.say(id,`⚠️ حساب <code>${html(row.email)}</code> فقط از فهرست شخصی شما برداشته می‌شود؛ اطلاعات آن در پنل سنایی حذف نخواهد شد.`,kb(
        [B('🗑 حذف فقط از فهرست',`r:unpinconfirm:${n}`)],[B('انصراف',`r:account:${n}`)]));
    }
    if(op==='unpinconfirm'){
      const row=this.db.accountById(n);
      if(!row||row.rep_id!==r.id)throw new Error('این حساب متعلق به شما نیست.');
      this.db.unclaim(row.email,r.id,id);
      await this.notifyOwners(`📌 نماینده ${html(r.name)} حساب <code>${html(row.email)}</code> را از فهرست شخصی برداشت (در پنل حذف نشد).`);
      return this.accountList(id,r.id,0,false);
    }
    if(op==='renewaccount'){
      const email=this.db.accountById(n)?.email;if(!email||this.db.owner(email)?.rep_id!==r.id)throw new Error('این حساب متعلق به نماینده دیگری است.');
      const c=await this.panel.details(email);
      return this.chooseRenewal(id,r,c);
    }
    if(op==='renewmonths'){
      const s=this.db.session(id);if(s?.state!=='renew.months')throw new Error('مرحله تمدید منقضی شده است.');
      const months=integer(a,1,1,'ماه');
      const current=await this.panel.details(s.payload.email);
      const savedOwner=this.db.owner(current.email);
      if(savedOwner && savedOwner.rep_id!==r.id)throw new Error('اجازه تمدید ندارید.');
      if(!savedOwner && (!s.payload.allowUnowned||!hasIdentityFingerprint(current,s.payload.proofKind,s.payload.proofHash)))throw new Error('برای تمدید حساب خارج از فهرست، لینک معتبر را دوباره بفرستید.');
      if(Number(current.expiryTime)<=0)throw new Error('انقضای عادی برای این حساب ثبت نشده است.');
      const price=this.db.customPrice(r.id,s.payload.volumeGb,months);
      const oldTotal=Number(current.totalGB);
      const traffic=await this.panel.traffic(current.email);
      const newTotal=quotaAddition(oldTotal,s.payload.volumeGb);
      const quote={email:current.email,planId:CUSTOM_PLAN_ID,months:1,volumeGb:s.payload.volumeGb,oldExpiry:Number(current.expiryTime),
        newExpiry:renewByMonths(Number(current.expiryTime),1),oldTotal,newTotal,oldUsed:traffic.used,price,at:Date.now(),allowUnowned:!savedOwner,proofKind:s.payload.proofKind||'',proofHash:s.payload.proofHash||''};
      this.db.setSession(id,'renew.confirm',quote);
      return this.say(id,`🔄 <b>تأیید تمدید</b>\nحساب: <code>${html(current.email)}</code>\nحجم افزوده: ${quote.volumeGb} گیگ\nمدت: ۱ ماه\nنرخ هر گیگ/ماه: ${money(r.price_per_gb_month)}\nقیمت: <b>${money(price)}</b>\nپایان فعلی: ${dateText(quote.oldExpiry,this.cfg.timezone)}\nپایان جدید: ${dateText(quote.newExpiry,this.cfg.timezone)}\nحجم قابل استفاده قبل: ${(Math.max(0,quote.oldTotal-quote.oldUsed)/GB).toFixed(2)} گیگ\nحجم قابل استفاده بعد (تقریبی): ${(Math.max(0,quote.newTotal-quote.oldUsed)/GB).toFixed(2)} گیگ\n\nمصرف فعلی حفظ می‌شود، حجم خریداری‌شده اضافه می‌شود و فقط حجم خرید بدهکار می‌گردد.`,kb([B('✅ تأیید قطعی تمدید','r:renewconfirm')],[B('❌ لغو','home')]));
    }
    if(op==='renewconfirm'){
      const s=this.db.session(id);if(s?.state!=='renew.confirm')throw new Error('درخواست منقضی شده است.');
      this.db.clearSession(id);return this.performRenewal(id,r,s.payload);
    }
    if(op==='sales')return this.salesMenu(id,r.id);
    if(op==='salesshow')return this.salesReport(id,a,r.id,0);
    if(op==='salespage')return this.salesReport(id,a,r.id,Number(b)||0);
    if(op==='history')return this.sendOperations(id,r.id,Math.max(0,n||0),false);
    if(op==='links'){
      const c=this.db.accountById(n);
      if(!c||c.rep_id!==r.id)throw new Error('این حساب متعلق به شما نیست.');
      return this.sendClientLinks(id,r.id,c.email);
    }
    if(op==='receipt')return this.sendReceipt(id,n,false);
    if(op==='payment'){
      const payment=this.db.payment(n);
      if(!payment||payment.rep_id!==r.id)throw new Error('این واریزی متعلق به شما نیست.');
      return this.paymentDetail(id,payment,false);
    }
    if(op==='balance')return this.say(id,`📒 <b>گردش حساب</b>\nمانده: ${money(this.db.balance(r.id))}\n\n${this.db.ledger(r.id,20).map(x=>`${x.kind==='payment'?'💵':x.kind==='create'?'➕':'🔄'} ${money(x.amount)}\n${html(short(x.description,85))}`).join('\n\n')||'—'}`.slice(0,4000),kb([B('💳 تسویه','r:settle')],back()));
    if(op==='settle'){
      const bank=this.db.bank();return this.say(id,`💳 <b>اطلاعات تسویه</b>\nدارنده کارت: ${html(bank.holder||'تعریف نشده')}\nشماره کارت: <code>${html(bank.card||'تعریف نشده')}</code>\nشماره شبا: <code>${html(bank.iban||'تعریف نشده')}</code>\nمانده: <b>${money(this.db.balance(r.id))}</b>\n\nاعلام واریز به‌تنهایی بدهی را کم نمی‌کند؛ تأیید مدیر الزامی است.`,kb(
        ...(bank.card?[[copyButton('📋 کپی شماره کارت',bank.card)]]:[]),
        ...(bank.iban?[[copyButton('📋 کپی شماره شبا',bank.iban)]]:[]),
        [B('➕ اعلام واریزی','r:pay')],back()));
    }
    if(op==='pay'){
      const bank=this.db.bank();if(!bank.card&&!bank.iban)throw new Error('اطلاعات بانکی هنوز تنظیم نشده است.');
      return this.prompt(id,'payment.amount','مبلغ واریز را بر حسب تومان وارد کنید.');
    }
    if(op==='skipreceipt'){
      const s=this.db.session(id);if(s?.state!=='payment.receipt')throw new Error('فرآیند واریزی منقضی شد.');
      return this.finishPayment(id,r,s.payload,null);
    }
    if(op==='payments'){
      const offset=Math.max(0,n||0),payments=this.db.payments(r.id,20,offset);
      const count=this.db.paymentsCount(r.id);
      return this.say(id,`🧾 <b>واریزی‌های من</b>\nروی واریزی بزنید تا مشخصات و رسید آن را ببینید.`,kb(
        ...payments.map(p=>[B(`#${p.id} ${money(p.amount)} ${p.state==='pending'?'⏳':p.state==='approved'?'✅':'❌'}`,`r:payment:${p.id}`)]),
        [...(offset>0?[B('⬅️ قبلی',`r:payments:${Math.max(0,offset-20)}`)]:[]),...(offset+20<count?[B('بعدی ➡️',`r:payments:${offset+20}`)]:[])],back()));
    }
    if(op==='chat')return this.chatHistory(id,r.id,false,Math.max(0,n||0));
    if(op==='message')return this.prompt(id,'rep.message','پیام خود را بنویسید تا برای مدیر ارسال شود.');
    throw new Error('دستور نماینده نامعتبر است.');
  }
  async sendOperations(id,repId,offset,admin){
    const r=this.db.rep(repId);if(!r||(!admin&&this.rep(id)?.id!==repId))throw new Error('اجازه دسترسی ندارید.');
    const rows=this.db.operations(repId,12,offset),total=this.db.operationsCount(repId);
    const lines=rows.map(x=>`${x.kind==='create'?'➕ ساخت':'🔄 تمدید'} | ${html(x.email)}\n${x.volume_gb}گیگ/${x.months}ماه | ${money(x.price)} | ${statusName(x.status)}\n${dateText(x.created_at,this.cfg.timezone)}`);
    return this.say(id,`📜 <b>سوابق ${html(r.name)} (${total})</b>\n\n${lines.join('\n\n')||'هنوز عملیاتی ثبت نشده است.'}`.slice(0,4000),kb(
      [...(offset>0?[B('⬅️ قبلی',admin?`a:history:${repId}:${Math.max(0,offset-12)}`:`r:history:${Math.max(0,offset-12)}`)]:[]),...(offset+12<total?[B('بعدی ➡️',admin?`a:history:${repId}:${offset+12}`:`r:history:${offset+12}`)]:[])],
      [B('🏠 منو','home')]));
  }
  async chatHistory(id,repId,admin,offset=0){
    const r=this.db.rep(repId);if(!r||(!admin&&r.telegram_id!==String(id)))throw new Error('اجازه مشاهده مکاتبات ندارید.');
    const history=this.db.messages(repId,12,offset);
    const lines=history.map(m=>`${m.direction==='admin_to_rep'?'🛡 مدیر':'👤 نماینده'}: ${html(short(m.body,350))}\n${dateText(m.created_at,this.cfg.timezone)} ${m.status==='failed'?'⚠️ ارسال ناموفق':''}`);
    return this.say(id,`💬 <b>گفت‌وگو با ${html(r.name)}</b>\n\n${lines.join('\n\n')||'هنوز پیامی ردوبدل نشده است.'}`.slice(0,4000),kb(
      [...(offset>0?[B('⬅️ جدیدتر',admin?`a:chat:${repId}:${Math.max(0,offset-12)}`:`r:chat:${Math.max(0,offset-12)}`)]:[]),...(history.length===12?[B('قدیمی‌تر ➡️',admin?`a:chat:${repId}:${offset+12}`:`r:chat:${offset+12}`)]:[])],
      [B('✍️ ارسال پیام',admin?`a:reply:${repId}`:'r:message')],
      [B('↩️ بازگشت',admin?`a:rep:${repId}`:'home')]));
  }
  async deliverMessage(repId,actor,direction,text){
    if(!text||text.length>2000)throw new Error('متن پیام باید بین ۱ تا ۲۰۰۰ کاراکتر باشد.');
    const r=this.db.rep(repId);if(!r)throw new Error('نماینده وجود ندارد.');
    const msgId=this.db.addMessage(repId,actor,direction,text);
    const payload=`💬 <b>${direction==='admin_to_rep'?'پیام مدیر':'پیام نماینده: '+html(r.name)}</b>\n\n${html(text)}`;
    let delivered=0;
    if(direction==='admin_to_rep'){
      try{await this.say(r.telegram_id,payload,kb([B('✍️ پاسخ به مدیر','r:message')]));delivered++;}catch{}
    }else{
      for(const owner of this.cfg.ownerIds){try{await this.say(owner,payload,kb([B('💬 پاسخ',`a:reply:${r.id}`),B('📜 مکاتبات',`a:chat:${r.id}`)]));delivered++;}catch{}}
    }
    this.db.setMessageStatus(msgId,delivered?'delivered':'failed');
    return delivered>0;
  }
  async accountList(chat,repId,offset=0,admin=false){
    if(!admin&&this.rep(chat)?.id!==repId)throw new Error('دسترسی غیرمجاز.');
    const size=8, total=this.db.accountsCount(repId),accounts=this.db.accounts(repId,size,offset);
    const pre=admin?'a':'r';
    return this.say(chat,`👥 <b>اشتراک‌ها (${total})</b>\nنمایش ${offset+1} تا ${Math.min(total,offset+size)}\nاطلاعات هر حساب از پنل خوانده می‌شود.`,kb(
      ...accounts.map(c=>[B(short(c.email,44),`${pre}:account:${c.rowid}${admin?':'+repId:''}`)]),
      [...(offset>0?[B('⬅️ قبلی',`${pre}:accounts:${admin?repId+':':''}${Math.max(0,offset-size)}`)]:[]),...(offset+size<total?[B('بعدی ➡️',`${pre}:accounts:${admin?repId+':':''}${offset+size}`)]:[])],
      ...(admin?[]:[[B('🔎 جستجو بین اشتراک‌های من','r:accountssearch')]]),
      [B('🏠 بازگشت','home')]));
  }
  async accountDetail(chat,repId,email,admin=false){
    if(this.db.owner(email)?.rep_id!==repId)throw new Error('این حساب متعلق به این نماینده نیست.');
    if(!admin&&this.rep(chat)?.id!==repId)throw new Error('دسترسی غیرمجاز.');
    const c=await this.panel.details(email);
    // The detail API may not embed traffic; get the exact traffic endpoint.
    const t=await this.panel.traffic(email).catch(()=>null);
    const used=t?.used??null,total=Number(c.totalGB||0);
    let subscription='';
    if(this.subscriptionBase() && c.subId)subscription=this.subscriptionBase()+encodeURIComponent(c.subId);
    const rowid=this.db.owner(email).rowid;
    const info=`👤 <b>${html(email)}</b>
وضعیت: ${c.enable?'🟢 فعال':'🔴 غیرفعال'}
حجم کل: ${total===0?'نامحدود':(total/GB).toFixed(2)+' GB'}
مصرف: ${used===null?'نامشخص':(used/GB).toFixed(2)+' GB'}
باقی‌مانده: ${used===null||total===0?'نامشخص':(Math.max(0,total-used)/GB).toFixed(2)+' GB'}
انقضا: ${dateText(Number(c.expiryTime),this.cfg.timezone)}
شناسه اشتراک: <code>${html(c.subId||'—')}</code>`;
    return this.say(chat,info+(subscription?'\nلینک اشتراک: <code>'+html(subscription)+'</code>':''),kb(
      ...(subscription&&subscription.length<=256?[[copyButton('📋 کپی لینک اشتراک',subscription)]]:[]),
      [B('🔗 لینک کانفیگ + اشتراک + QR',`${admin?'a':'r'}:links:${rowid}`)],
      [B('📡 آنلاین و تعداد IPهای اخیر',`${admin?'a':'r'}:usage:${rowid}`)],
      ...(admin?[]:[[B('🔄 تمدید ماهانه',`r:renewaccount:${rowid}`),B(c.enable?'⛔️ خاموش':'✅ روشن',`r:toggle:${rowid}`)],[B('📌 حذف فقط از فهرست',`r:unpin:${rowid}`)]]),
      [B('⬅️ فهرست',admin?`a:accounts:${repId}:0`:'r:accounts:0')]));
  }
  async accountUsage(chat,email){
    // Never infer person-count from IPs. A user may have multiple IPs and several
    // people may share NAT; the API reports account online + observed source IPs.
    const c=await this.panel.details(email);
    const [onlineResult,ipResult,lastResult,deviceResult]=await Promise.allSettled([
      this.panel.onlineSnapshot(email),this.panel.ipUsage(email),this.panel.lastSeen(email),this.panel.registeredDeviceCount(email)
    ]);
    const online=onlineResult.status==='fulfilled'?(onlineResult.value?'🟢 آنلاین':'⚪️ آفلاین'):'⚠️ نامشخص (API آنلاین در دسترس نیست)';
    const ip=ipResult.status==='fulfilled'?
      `IP یکتای ثبت‌شده در ۱۰ دقیقه اخیر: <b>${number(ipResult.value.recent)}</b>
IP یکتای مشاهده‌شده در سوابق پنل: ${number(ipResult.value.observed)}`:
      'تعداد IP: این نسخه پنل آمار لازم را ارائه نکرده است.';
    const last=lastResult.status==='fulfilled'&&lastResult.value?dateText(lastResult.value,this.cfg.timezone):'نامشخص';
    const registered= deviceResult.status==='fulfilled'?`دستگاه‌های ثبت‌شده با HWID: ${number(deviceResult.value)} (در صورت فعال‌بودن کنترل دستگاه)`:'دستگاه‌های ثبت‌شده با HWID: نامشخص';
    this.db.log(chat,'client.status.view',email,'counts_only');
    return this.say(chat,`📡 <b>وضعیت اشتراک</b>
<code>${html(email)}</code>
وضعیت ثبت‌شده حساب: ${c.enable?'فعال':'غیرفعال'}
اتصال در بازه heartbeat سنایی: ${online}
آخرین فعالیت: ${last}
${ip}
${registered}

⚠️ تعداد IP یا آنلاین‌بودن یک حساب، تعداد قطعی افراد یا دستگاه‌های هم‌زمان نیست.`,kb(back()));
  }
  durationButtons(prefix){return kb([B('✅ تأیید یک ماه',`${prefix}:1`)],back());}
  subscriptionBase(){const fromDb=this.db.meta('subscription_base');return fromDb===undefined?this.cfg.subscriptionBase||'':fromDb;}
  async chooseRenewal(chat,rep,client,{allowUnowned=false,proofKind='',proofHash=''}={}){
    const owner=this.db.owner(client.email);
    if(owner && owner.rep_id!==rep.id)throw new Error('این حساب متعلق به نماینده دیگری است.');
    if(!owner && (!allowUnowned || !hasIdentityFingerprint(client,proofKind,proofHash)))
      throw new Error('برای حساب خارج از فهرست، ارسال لینک معتبر لازم است.');
    if(Number(client.expiryTime)<=0)throw new Error('این حساب انقضای عادی ندارد؛ تمدید خودکار ممکن نیست.');
    const total=Number(client.totalGB||0);
    if(!Number.isSafeInteger(total)||total<=0)throw new Error('حساب نامحدود یا دارای حجم نامعتبر است؛ تمدید خودکار ممکن نیست.');
    const traffic=await this.panel.traffic(client.email);
    const remaining=Math.max(0,total-traffic.used);
    return this.prompt(chat,'renew.volume',`🔎 <b>حساب شناسایی شد</b>
حساب: <code>${html(client.email)}</code>
حجم کنونی: ${(total/GB).toFixed(2)} گیگ
مصرف: ${(traffic.used/GB).toFixed(2)} گیگ
باقی‌مانده: ${(remaining/GB).toFixed(2)} گیگ
انقضا: ${dateText(Number(client.expiryTime),this.cfg.timezone)}
${owner?'📌 در فهرست شما':'📎 تمدید بدون افزودن به فهرست'}

حجم موردنظر برای <b>افزودن</b> را وارد کنید (حداقل ۲۰ گیگ).`,{email:client.email,allowUnowned:!owner,proofKind,proofHash});
  }
  salesMenu(chat,repId){
    const admin=repId===null||this.admin(chat),prefix=admin?'a':'r';
    if(!admin&&this.rep(chat)?.id!==repId)throw new Error('اجازه مشاهده فروش ندارید.');
    const label=repId===null?'کل سیستم':this.db.rep(repId)?.name||'نماینده';
    const build=(k)=>prefix==='a'?`a:salesshow:${k}:${repId??''}`:`r:salesshow:${k}`;
    return this.say(chat,`📈 <b>گزارش فروش - ${html(label)}</b>\nبازه موردنظر را انتخاب کنید. تاریخ‌ها براساس ساعت تهران و ماه شمسی هستند.`,kb(
      [B('امروز',build('today')),B('این هفته',build('week'))],
      [B('این ماه',build('month')),B('۶ ماه اخیر',build('six'))],
      [B('یک سال اخیر',build('year')),B('کل دوره',build('all'))],back()));
  }
  salesReport(chat,period,repId,offset=0){
    const admin=this.admin(chat);
    if(!admin&&this.rep(chat)?.id!==repId)throw new Error('فروش سایر نمایندگان قابل مشاهده نیست.');
    if(admin&&repId!==null&&!this.db.rep(repId))throw new Error('نماینده وجود ندارد.');
    const [from,to]=periodBounds(period,Date.now(),this.cfg.timezone),data=this.db.sales(repId,from,to,12,offset);
    const s=data.summary;
    const rows=data.records.map(x=>{
      const rate=x.volume_gb>0&&x.months>0&&x.price%(x.volume_gb*x.months)===0
        ?` | گیگی ${money(x.price/(x.volume_gb*x.months))}`:'';
      return `${x.kind==='create'?'➕ ساخت':'🔄 تمدید'} <code>${html(x.email)}</code>\n${admin?html(x.rep_name)+' | ':''}${x.volume_gb}گیگ / ${x.months}ماه | ${money(x.price)}${rate}\n${dateText(x.completed_at,this.cfg.timezone)}`;
    });
    const prev=admin?`a:salespage:${period}:${repId??'all'}:`:`r:salespage:${period}:`;
    return this.say(chat,`📈 <b>فروش ${periodNames[period]}</b>\nسفارش‌های موفق: ${number(s.count)}\nساخت: ${number(s.created)} | تمدید: ${number(s.renewed)}\nجمع فروش: <b>${money(s.amount)}</b>\n\n${rows.join('\n\n')||'فروشی در این بازه ثبت نشده است.'}`.slice(0,4000),kb(
      [...(offset>0?[B('⬅️ جدیدتر',prev+Math.max(0,offset-12))]:[]),...(offset+12<s.count?[B('قدیمی‌تر ➡️',prev+(offset+12))]:[])],
      [B('📆 انتخاب بازه',admin?(repId===null?'a:sales':`a:salesrep:${repId}`):'r:sales')],back()));
  }
  async paymentDetail(chat,p,admin){
    if(!admin&&this.rep(chat)?.id!==p.rep_id)throw new Error('این واریزی متعلق به شما نیست.');
    await this.say(chat,`🧾 <b>واریزی #${p.id}</b>\nمبلغ: ${money(p.amount)}\nپیگیری: <code>${html(p.reference)}</code>\nوضعیت: ${p.state==='pending'?'⏳ منتظر تأیید':p.state==='approved'?'✅ تأییدشده':'❌ ردشده'}\nتاریخ: ${dateText(p.created_at,this.cfg.timezone)}`,kb(
       ...(p.receipt_file?[[B('🖼 مشاهده تصویر رسید',`${admin?'a':'r'}:receipt:${p.id}`)]]:[]),
       [B('⬅️ بازگشت',admin?'a:payments':'r:payments')]));
  }
  async sendReceipt(chat,paymentId,admin){
    const p=this.db.payment(paymentId);
    if(!p||(!admin&&this.rep(chat)?.id!==p.rep_id))throw new Error('دسترسی به این رسید ندارید.');
    if(!p.receipt_file)return this.say(chat,'برای این واریزی رسید تصویری ثبت نشده است.',kb(back()));
    try{return await this.tg.call('sendPhoto',{chat_id:chat,photo:p.receipt_file,caption:`🧾 رسید واریزی #${p.id} / ${p.amount} تومان`});}
    catch {return this.say(chat,'⚠️ فایل رسید فعلاً از تلگرام قابل دریافت نیست.',kb(back()));}
  }
  async sendClientLinks(chat,repId,email){
    if(!this.admin(chat)&&this.rep(chat)?.id!==repId)throw new Error('دسترسی غیرمجاز.');
    if(this.db.owner(email)?.rep_id!==repId)throw new Error('مالک حساب تغییر کرده است.');
    return this.sendVerifiedLinks(chat,email);
  }
  async sendVerifiedLinks(chat,email){
    const client=await this.panel.details(email);
    let links=[];
    try{links=await this.panel.links(email);}catch{
      await this.say(chat,'⚠️ API لینک کانفیگ این نسخه پنل در دسترس نیست. لینک اشتراک را جداگانه بررسی کنید.');
    }
    const sub=this.subscriptionBase()&&client.subId?this.subscriptionBase()+encodeURIComponent(client.subId):'';
    if(!links.length&&!sub)return this.say(chat,'برای این حساب هنوز لینک قابل‌ارائه‌ای موجود نیست. مدیر باید آدرس سرور اشتراک را تنظیم کند و اینباند هم باید از پروتکل دارای لینک پشتیبانی کند.',kb(back()));
    if(sub)await this.deliverLink(chat,`🔗 لینک اشتراک ${email}`,sub);
    else await this.say(chat,'ℹ️ آدرس سرور اشتراک تنظیم نشده است. مدیر می‌تواند از منوی «آدرس سرور اشتراک» آن را تعیین کند.');
    for(const [i,link] of links.slice(0,5).entries())await this.deliverLink(chat,`🔐 کانفیگ ${i+1} / ${email}`,link);
    if(links.length>5)await this.say(chat,`برای جلوگیری از ازدحام، ۵ لینک از ${links.length} لینک نمایش داده شد.`);
    this.db.log(chat,'client.links.delivered',email,`configs=${links.length};sub=${!!sub}`);
  }
  async deliverLink(chat,label,link){
    // A link is a credential: send only to the authorized chat, never to logs.
    if(link.length>3600)throw new Error('لینک کانفیگ طولانی است؛ دریافت مستقیم از پنل لازم است.');
    await this.say(chat,`<b>${html(label)}</b>\n<code>${html(link)}</code>`+(link.length>256?'\nبرای کپی لینک بلند روی متن نگه دارید.':''),link.length<=256?kb([copyButton('📋 کپی لینک',link)]):undefined);
    try{await this.tg.sendQr(chat,link,`${label} - QR Code`);}
    catch{await this.say(chat,'⚠️ تصویر QR ارسال نشد؛ لینک متنی و قابل‌کپی در پیام قبلی موجود است.');}
  }
  async input(id,role,s,message){
    const raw=String(message.text||'').trim(),{state,payload:p}=s;
    // Recheck role on every state transition; stale owner sessions never grant access.
    if(((state.startsWith('rep.') && state!=='rep.message')||state.startsWith('plan.')||state.startsWith('bank.')||state.startsWith('adjust.')||state.startsWith('transfer.')||state==='admin.message'||state==='admin.close.reason'||state.startsWith('admin.broadcast'))&&role!=='owner')throw new Error('فقط مدیر مجاز است.');
    if(state.startsWith('plan.')||state==='rep.rate')throw new Error('پلن‌های ثابت حذف شده‌اند؛ از فروش یک‌ماهه با حجم دلخواه استفاده کنید.');
    if(state==='rep.id'){
      if(!/^\d{5,20}$/.test(raw))throw new Error('شناسه تلگرام عددی وارد کنید.');
      return this.prompt(id,'rep.name','نام نماینده را بنویسید.',{tg:raw});
    }
    if(state==='rep.name'){
      const rid=this.db.createRep(p.tg,trimName(raw),id);this.db.clearSession(id);
      await this.notifyRep(this.db.rep(rid),'✅ دسترسی نمایندگی شما ایجاد شده است. /start را ارسال کنید.');
      return this.adminAction(id,`rep:${rid}`);
    }
    if(state==='rep.rename'){this.db.updateRep(p.repId,'name',trimName(raw),id);this.db.clearSession(id);return this.adminAction(id,`rep:${p.repId}`);}
    if(state==='rep.gigrate'){
      const amount=parseAmount(raw,true);this.db.setGigRate(p.repId,amount,id);this.db.clearSession(id);return this.adminAction(id,`rep:${p.repId}`);
    }
    if(state==='admin.subbase'){
      let url='';
      if(raw!=='-'){
        const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw new Error('آدرس اشتراک باید HTTPS و بدون نام‌کاربری یا پارامتر باشد.');
        url=u.toString().replace(/\/+$/,'')+'/';
      }
      this.db.setMeta('subscription_base',url);this.db.log(id,'subscription.base.set','subscription','changed');this.db.clearSession(id);
      return this.say(id,'✅ آدرس سرور اشتراک ذخیره شد.',kb(back()));
    }
    if(state==='rep.rate'){const amount=parseAmount(raw,true);this.db.setPrice(p.repId,p.planId,amount,id);this.db.clearSession(id);return this.adminAction(id,`rep:${p.repId}`);}
    if(state==='rep.threshold'){
      const amount=parseAmount(raw,true);this.db.setDebtAlert(p.repId,amount,id);this.db.clearSession(id);await this.debtCheck(p.repId);return this.adminAction(id,`rep:${p.repId}`);
    }
    if(state==='plan.name')return this.prompt(id,'plan.months','مدت پلن چند ماه است؟ فقط عدد صحیح ۱ تا ۲۴.',{name:trimName(raw,65)});
    if(state==='plan.months')return this.prompt(id,'plan.volume','حجم پلن چند گیگابایت است؟ فقط عدد صحیح ۱ تا ۱۰۰۰۰.',{...p,months:integer(raw,1,24,'ماه')});
    if(state==='plan.volume')return this.prompt(id,'plan.price','قیمت پیش‌فرض به تومان (صفر تا تعریف تعرفه اختصاصی، فروش را متوقف می‌کند):',{...p,volumeGb:integer(raw,1,10000,'حجم')});
    if(state==='plan.price'){const planId=this.db.addPlan(p.name,p.months,p.volumeGb,parseAmount(raw,true),id);this.db.clearSession(id);return this.adminAction(id,`plan:${planId}`);}
    if(state==='plan.field'){
      const field=p.field;let value=raw;
      if(field==='name')value=trimName(raw,65);
      else if(field==='months')value=integer(raw,1,24,'ماه');
      else if(field==='volume_gb')value=integer(raw,1,10000,'حجم');
      else if(field==='base_price')value=parseAmount(raw,true);
      else throw new Error('فیلد نامعتبر است.');
      this.db.changePlan(p.planId,field,value,id);this.db.clearSession(id);return this.adminAction(id,`plan:${p.planId}`);
    }
    if(state==='bank.field'){
      let value=raw==='-'?'':raw.replace(/[\s-]/g,'');
      if(p.field==='card'&&value&&!/^\d{16}$/.test(value))throw new Error('شماره کارت ۱۶ رقمی لازم است.');
      if(p.field==='iban'&&value){value=value.toUpperCase();if(!/^IR\d{24}$/.test(value))throw new Error('شبا باید IR و ۲۴ رقم داشته باشد.');}
      if(p.field==='holder'){value=raw==='-'?'':raw;if(value.length>100)throw new Error('نام طولانی است.');}
      this.db.setBank(p.field,value,id);this.db.clearSession(id);return this.adminAction(id,'bank');
    }
    if(state==='adjust.amount'){
      const standardized=raw.replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)));
      const amount=standardized.startsWith('-')?-parseAmount(standardized.slice(1)):parseAmount(standardized);
      return this.prompt(id,'adjust.reason','دلیل اصلاح حساب را وارد کنید (در لاگ ثبت می‌شود).',{...p,amount});
    }
    if(state==='adjust.reason'){
      if(raw.length<5||raw.length>150)throw new Error('توضیح ۵ تا ۱۵۰ کاراکتری لازم است.');
      this.db.adjustment(p.repId,p.amount,raw,id);this.db.clearSession(id);await this.debtCheck(p.repId);return this.adminAction(id,`rep:${p.repId}`);
    }
    if(state==='transfer.email'){
      if(!/^[^\s]{1,180}$/.test(raw))throw new Error('نام حساب نامعتبر است.');
      await this.panel.details(raw);
      return this.prompt(id,'transfer.rep','شماره داخلی نماینده (# در فهرست) را وارد کنید.',{email:raw});
    }
    if(state==='transfer.rep'){
      const repId=integer(raw,1,100000000,'شناسه نماینده');this.db.transfer(p.email,repId,id);this.db.clearSession(id);
      return this.say(id,`✅ مالکیت ${html(p.email)} به نماینده #${repId} داده شد.`,kb(back()));
    }
    if(state==='admin.close.reason'){
      if(raw.length<8||raw.length>160)throw new Error('دلیل باید بین ۸ تا ۱۶۰ کاراکتر باشد.');
      if(p.kind==='closecreate')this.db.markCreation(p.id,'failed','Manually closed: '+raw,id);
      else if(p.kind==='closerenew')this.db.markRenewal(p.id,'failed','Manually closed: '+raw,id);
      else throw new Error('نوع عملیات ناشناخته است.');
      this.db.log(id,'operation.manual_close',`${p.kind}:${p.id}`,raw);
      this.db.clearSession(id);
      return this.say(id,`✅ عملیات #${p.id} بدون بدهی بسته شد. برای حساب‌هایی که واقعاً در پنل ایجاد/تمدید شده‌اند، بررسی و اصلاح مالی دستی با مدیر است.`,kb([B('⚠️ عملیات معلق','a:pending')]));
    }
    if(state==='admin.restore.upload'){
      const doc=message.document;
      if(!doc||!String(doc.file_name||'').toLowerCase().endsWith('.sqlite'))throw new Error('فایل بکاپ را به صورت Document با پسوند .sqlite ارسال کنید.');
      if(Number(doc.file_size)>MAX_UPLOAD_BYTES)throw new Error('فایل بزرگ‌تر از سقف مجاز تلگرام است؛ از روش بازیابی آفلاین استفاده کنید.');
      const data=await this.tg.downloadDocument(doc.file_id);
      const dir=backupFolder(this.cfg.dbPath);
      await mkdir(dir,{recursive:true,mode:0o700});
      const stage=join(dir,'restore-upload-'+secureRandomBytes(12).toString('hex')+'.sqlite');
      await writeFile(stage,data,{flag:'wx',mode:0o600});
      let info;
      try{info=await validateBackup(stage);}catch(e){await unlink(stage).catch(()=>{});throw e;}
      this.db.setSession(id,'admin.restore.confirm',{stage});
      return this.say(id,`⚠️ <b>تأیید نهایی بازیابی</b>\nنمایندگان داخل فایل: ${info.representatives}\nتمدیدهای داخل فایل: ${info.operations}\nاندازه: ${(info.size/1048576).toFixed(2)} MB\n\nاطلاعات کنونی جایگزین می‌شوند. بکاپ نجات محلی گرفته می‌شود.\n<b>آیا مطمئن هستید؟</b>`,kb([B('⚠️ بازیابی قطعی و راه‌اندازی مجدد','a:restoreapply')],[B('❌ لغو','home')]));
    }
    if(state==='admin.broadcast'){
      if(!raw||raw.length>2000)throw new Error('پیام باید بین ۱ تا ۲۰۰۰ کاراکتر باشد.');
      this.db.setSession(id,'admin.broadcast.confirm',{text:raw});
      return this.say(id,`📣 <b>تأیید ارسال همگانی</b>\nتعداد نمایندگان فعال: ${this.db.reps().filter(r=>r.active).length}\n\n${html(raw)}`,kb([B('✅ ارسال به همه نمایندگان فعال','a:broadcastsend')],[B('❌ لغو','home')]));
    }
    if(state==='admin.message'){
      if(!raw)throw new Error('پیام متنی وارد کنید.');
      const delivered=await this.deliverMessage(p.repId,id,'admin_to_rep',raw);this.db.clearSession(id);
      return this.say(id,delivered?'✅ پیام نماینده ارسال و ثبت شد.':'⚠️ پیام ثبت شد اما تحویل به تلگرام ناموفق بود. نماینده باید یک‌بار /start را برای ربات بفرستد.',kb([B('💬 مکاتبات',`a:chat:${p.repId}`)]));
    }
    if(role!=='rep')throw new Error('این مرحله مخصوص نماینده است.');
    const rep=this.rep(id);
    if(state==='rep.message'){
      if(!raw)throw new Error('پیام متنی وارد کنید.');
      const sent=await this.deliverMessage(rep.id,id,'rep_to_admin',raw);this.db.clearSession(id);
      return this.say(id,sent?'✅ پیام ثبت و به مدیر ارسال شد.':'⚠️ پیام ثبت شد ولی تحویل تلگرام ناموفق بود.',kb([B('💬 مکاتبات','r:chat')]));
    }
    if(state==='accounts.search'){
      const matches=this.db.searchAccounts(rep.id,raw);
      this.db.clearSession(id);
      return this.say(id,`🔎 نتایج جست‌وجو برای <b>${html(short(raw,50))}</b> (حداکثر ۲۵ نتیجه):`,kb(
        ...matches.map(c=>[B(short(c.email,50),`r:account:${c.rowid}`)]),
        [B('📋 فهرست اشتراک‌ها','r:accounts:0')],back()));
    }
    if(state==='create.volume'){
      const volumeGb=integer(raw,20,10000,'حجم');
      this.db.setSession(id,'create.months',{volumeGb});
      return this.say(id,`📦 حجم: ${volumeGb} گیگ\nمدت ثابت: ۱ ماه.`,this.durationButtons('r:createmonths'));
    }
    if(state==='create.name'){
      const email=`r${rep.id}_${safeEmail(raw)}`;
      const inbounds=await this.panel.listInbounds();
      if(!this.db.allowedInbounds().some(i=>i.id===p.inboundId)||!inbounds.some(i=>i.id===p.inboundId&&i.enable))throw new Error('اینباند مجاز و فعال نیست.');
      const expiryTime=addMonths(Date.now(),p.months);
      const price=this.db.customPrice(rep.id,p.volumeGb,p.months);
      const quote={email,planId:CUSTOM_PLAN_ID,months:p.months,volumeGb:p.volumeGb,inboundId:p.inboundId,expiryTime,
        subId:randomBytes(12).toString('hex'),price,at:Date.now()};
      this.db.setSession(id,'create.confirm',quote);
      return this.say(id,`➕ <b>تأیید ساخت اشتراک</b>\nحساب: <code>${html(email)}</code>\nحجم: ${p.volumeGb} گیگ\nمدت: ${p.months} ماه\nاینباند: ${p.inboundId}\nنرخ هر گیگ/ماه: ${money(rep.price_per_gb_month)}\nپایان: ${dateText(expiryTime,this.cfg.timezone)}\nمبلغ بدهکاری: <b>${money(price)}</b>`,kb(
        [B('✅ ایجاد حساب و ثبت بدهی','r:createconfirm')],[B('❌ لغو','home')]));
    }
    if(state==='renew.volume'){
      const volumeGb=integer(raw,20,10000,'حجم');
      this.db.setSession(id,'renew.months',{...p,volumeGb});
      return this.say(id,`📦 حجم افزوده: ${volumeGb} گیگ\nمدت ثابت: ۱ ماه.`,this.durationButtons('r:renewmonths'));
    }
    if(state==='renew.link'||state==='connect.link'){
      if(!raw)throw new Error('لینک یا کانفیگ را به صورت متن بفرستید.');
      await this.say(id,'🔎 لینک دریافت شد؛ در حال بررسی حساب در پنل...');
      const identity=extractIdentity(raw);
      // Possession of a real account credential/subscription ID is required.
      if(!['subId','credential'].includes(identity.kind))throw new Error('برای حساب‌های قدیمی لینک اشتراک یا کانفیگ واقعی بفرستید؛ ایمیل تنها کافی نیست.');
      let client;
      try{client=await this.panel.find(identity);}catch(e){
        // Older panels may not index credentials via paged search.
        if(identity.kind!=='credential')throw e;
        const owned=this.db.accounts(rep.id,300,0);
        let match=null;
        for(const own of owned){
          const links=await this.panel.links(own.email).catch(()=>[]);
          if(links.some(link=>{try{const found=extractIdentity(link);return found.kind==='credential'&&found.value===identity.value;}catch{return false;}})){
            if(match)throw new Error('شناسه به بیش از یک حساب مربوط است. لینک اشتراک دقیق بفرستید.');
            match=own.email;
          }
        }
        if(!match)throw e;
        client=await this.panel.details(match);
      }
      const owner=this.db.owner(client.email);
      if(owner && owner.rep_id!==rep.id)throw new Error('این حساب قبلاً به نماینده دیگری تعلق گرفته است.');
      const hash=identityFingerprint(identity);
      this.db.setSession(id,'link.review',{email:client.email,proofKind:identity.kind,proofHash:hash});
      const traffic=await this.panel.traffic(client.email).catch(()=>null);
      const used=traffic?.used??0;
      const remaining=Number(client.totalGB)>0?Math.max(0,Number(client.totalGB)-used):null;
      return this.say(id,`✅ <b>حساب شناسایی شد</b>
<code>${html(client.email)}</code>
حجم: ${(Number(client.totalGB||0)/GB).toFixed(2)} GB
مصرف: ${traffic?(used/GB).toFixed(2)+' GB':'نامشخص'}
باقی‌مانده: ${remaining===null?'نامحدود':(remaining/GB).toFixed(2)+' GB'}
انقضا: ${dateText(Number(client.expiryTime),this.cfg.timezone)}
وضعیت: ${client.enable?'فعال':'غیرفعال'}
${owner?'📌 قبلاً در فهرست شما ثبت شده است.':'برای ذخیره در «اشتراک‌های من» دکمه افزودن را بزنید؛ تمدید بدون ذخیره هم ممکن است.'}`,kb(
        ...(!owner?[[B('📌 افزودن فقط به فهرست','r:linkadd')],[B('🔄 تمدید بدون افزودن','r:linkrenew'),B('🔄 تمدید و افزودن','r:linkrenewadd')]]:[[B('🔄 تمدید','r:linkrenew')]]),
        [B('🏠 لغو','home')]));
    }
    if(state==='payment.amount'){const amount=parseAmount(raw);if(amount<=0)throw new Error('مبلغ باید مثبت باشد.');return this.prompt(id,'payment.reference','کد پیگیری تراکنش (۴ تا ۱۰۰ کاراکتر) را ارسال کنید.',{amount});}
    if(state==='payment.reference'){
      if(raw.length<4||raw.length>100)throw new Error('کد پیگیری نامعتبر است.');
      this.db.setSession(id,'payment.receipt',{...p,reference:raw});
      return this.say(id,'در صورت وجود عکس رسید، آن را بفرستید؛ در غیر این صورت «بدون تصویر» را انتخاب کنید.',kb([B('بدون عکس رسید','r:skipreceipt')],back()));
    }
    if(state==='payment.receipt'){
      const photo=message.photo?.at(-1)?.file_id;if(!photo)throw new Error('عکس رسید بفرستید یا «بدون عکس» را انتخاب کنید.');
      return this.finishPayment(id,rep,p,photo);
    }
    throw new Error('مرحله نامعتبر است. /cancel را ارسال کنید.');
  }
  async finishPayment(chat,rep,quote,receipt){
    const id=this.db.createPayment(rep.id,quote.amount,quote.reference,receipt,chat);this.db.clearSession(chat);
    await this.say(chat,`✅ واریزی #${id} به مبلغ ${money(quote.amount)} ثبت شد. پس از تأیید دریافت وجه توسط مدیر، بدهی کاهش می‌یابد.`,kb(back()));
    await this.notifyOwners(`🧾 واریزی جدید #${id}\nنماینده: ${html(rep.name)}\nمبلغ: ${money(quote.amount)}`,kb([B('بررسی واریزی',`a:payment:${id}`)]));
  }
  async performCreation(chat,rep,q){
    if(this.db.customPrice(rep.id,q.volumeGb,q.months)!==q.price)throw new Error('نرخ تغییر کرده؛ ساخت را از ابتدا انجام دهید.');
    if(Date.now()-q.at>600000)throw new Error('پیش‌نمایش منقضی شده است.');
    if(!this.db.allowedInbounds().some(x=>x.id===q.inboundId))throw new Error('اینباند اکنون غیرفعال است.');
    const inbound=await this.panel.listInbounds();if(!inbound.some(x=>x.id===q.inboundId&&x.enable))throw new Error('اینباند در پنل فعال نیست.');
    // A failed network check must NOT be treated as a missing client.
    // Paged search is authoritative for existence; exact-match locally.
    const found=await this.panel.search(q.email);
    if(found.some(c=>c.email===q.email))throw new Error('این نام حساب قبلاً در پنل وجود دارد؛ نام دیگری انتخاب کنید.');
    const id=this.db.beginCreation({repId:rep.id,email:q.email,planId:q.planId,months:q.months,volumeGb:q.volumeGb,price:q.price,inboundId:q.inboundId,expiryTime:q.expiryTime,subId:q.subId,actor:chat});
    try{await this.panel.createClient({email:q.email,inboundId:q.inboundId,volumeGb:q.volumeGb,expiryTime:q.expiryTime,subId:q.subId,repId:rep.id});}
    catch{this.db.markCreation(id,'review','Uncertain remote write',chat);}
    const result=await this.reconcileCreation(id,chat);
    await this.notifyOwners(`${this.db.creation(id).status==='applied'?'✅':'⚠️'} ایجاد حساب #${id}: ${html(q.email)}\nنماینده: ${html(rep.name)}\n${html(result)}`,kb([B('بررسی معلق','a:pending')]));
    await this.say(chat,`${html(result)}\nحساب: <code>${html(q.email)}</code>\nشناسه عملیات: #${id}\nمانده حساب: ${money(this.db.balance(rep.id))}`,kb(back()));
    if(this.db.creation(id)?.status==='applied'){
      try{await this.sendClientLinks(chat,rep.id,q.email);}
      catch{await this.say(chat,'⚠️ اشتراک ساخته شد اما ارسال لینک‌ها کامل نبود. از «اشتراک‌های من» دوباره دریافت کنید.');}
    }
    return;

  }
  async reconcileCreation(opId,actor){
    const c=this.db.creation(opId);if(!c||!['pending','review'].includes(c.status))throw new Error('ایجاد قبلاً تعیین تکلیف شده است.');
    let data;
    try{data=await this.panel.details(c.email);}catch{
      this.db.markCreation(opId,'review','Cannot verify client in panel',actor);return '⚠️ ایجاد حساب نیازمند بررسی مدیر است؛ هنوز بدهی ثبت نشده.';
    }
    if(data.subId===c.sub_id && Number(data.expiryTime)===c.expiry_time && Number(data.totalGB)===c.volume_gb*GB && data.enable===true && Array.isArray(data.inboundIds) && data.inboundIds.includes(c.inbound_id)){
      this.db.completeCreation(opId,actor);await this.debtCheck(c.rep_id);return '✅ ایجاد حساب در پنل تأیید و بدهی ثبت شد.';
    }
    this.db.markCreation(opId,'review','Client exists but parameters differ',actor);
    return '⚠️ مشخصات حساب در پنل با درخواست برابر نیست. مدیر باید آن را دستی بررسی کند؛ بدهی ثبت نشد.';
  }
  async performRenewal(chat,rep,q){
    if(this.db.customPrice(rep.id,q.volumeGb,q.months)!==q.price)throw new Error('نرخ تغییر کرده؛ تمدید را از ابتدا انجام دهید.');
    if(Date.now()-q.at>600000)throw new Error('پیش‌نمایش منقضی شده است.');
    const owner=this.db.owner(q.email);
    if(owner && owner.rep_id!==rep.id)throw new Error('این حساب متعلق به نماینده دیگری است.');
    if(!owner&&!q.allowUnowned)throw new Error('برای تمدید حساب ثبت‌نشده لینک معتبر لازم است.');
    const data=await this.panel.details(q.email);
    if(!owner&&!hasIdentityFingerprint(data,q.proofKind,q.proofHash))throw new Error('شناسه کانفیگ یا اشتراک عوض شده است؛ لینک را مجدداً ارسال کنید.');
    if(Number(data.expiryTime)!==q.oldExpiry||Number(data.totalGB)!==q.oldTotal)throw new Error('حساب در پنل تغییر کرده است. بررسی را مجدد انجام دهید.');
    if(quotaAddition(q.oldTotal,q.volumeGb)!==q.newTotal)throw new Error('مقدار حجم اضافه شده معتبر نیست.');
    const traffic=await this.panel.traffic(q.email); if(traffic.used<0)throw new Error('مصرف نامعتبر است.');
    const opId=this.db.beginRenewal({repId:rep.id,email:q.email,planId:q.planId,months:q.months,volumeGb:q.volumeGb,oldTotal:q.oldTotal,newTotal:q.newTotal,oldUsed:q.oldUsed,price:q.price,oldExpiry:q.oldExpiry,newExpiry:q.newExpiry,actor:chat,authorizedUnowned:!owner});
    try{await this.panel.changeExpiry(q.email,q.oldExpiry,q.newExpiry,q.newTotal);}catch(e){
      // Preserve the panel rejection reason for admin review. A write may still
      // have reached the server before a transport failure: do not auto-retry.
      const reason=String(e?.message||e?.name||'Unknown update error').replace(/[\r\n]/g,' ').slice(0,300);
      this.db.markRenewal(opId,'review',`Uncertain remote write: ${reason}`,chat);
    }
    const result=await this.reconcileRenew(opId,chat);
    await this.notifyOwners(`${this.db.renewal(opId).status==='applied'?'✅':'⚠️'} تمدید #${opId}\n${html(rep.name)} / ${html(q.email)}\n${html(result)}`,kb([B('عملیات معلق','a:pending')]));
    await this.say(chat,`${html(result)}\nتمدید #${opId}\nحساب: <code>${html(q.email)}</code>\nمانده: ${money(this.db.balance(rep.id))}`,kb(...(this.db.owner(q.email)?[[B('🔗 کانفیگ، Subscription Link و QR',`r:links:${this.db.owner(q.email).rowid}`)]]:[]),back()));
    if(this.db.renewal(opId)?.status==='applied'){
      try{if(this.db.owner(q.email)?.rep_id===rep.id)await this.sendClientLinks(chat,rep.id,q.email);else await this.sendVerifiedLinks(chat,q.email);}
      catch{await this.say(chat,'⚠️ تمدید انجام شد اما ارسال لینک کامل نبود. لینک معتبر را مجدداً برای مشاهده بفرستید.');}
    }
    return;
  }
  async reconcileRenew(opId,actor){
    const op=this.db.renewal(opId);if(!op||!['pending','review'].includes(op.status))throw new Error('این تمدید قبلاً تعیین تکلیف شده است.');
    let c;
    try{c=await this.panel.details(op.email);}catch{this.db.markRenewal(opId,'review','Cannot verify panel update',actor);return '⚠️ دریافت وضعیت پنل ناموفق بود؛ بررسی دستی الزامی است.';}
    if(Number(c.expiryTime)===op.new_expiry && Number(c.totalGB)===(op.new_total??op.volume_gb*GB)){
      this.db.completeRenewal(opId,actor);
      // Never reset used traffic: unused quota remains available after additive renewal.
      await this.debtCheck(op.rep_id);return '✅ تمدید پنل تأیید و بدهی ثبت شد.';
    }
    this.db.markRenewal(opId,'review','Panel expiry/quota do not match',actor);
    return '⚠️ وضعیت حجم یا انقضا با درخواست برابر نیست؛ بدهی ثبت نشد و مدیر باید بررسی کند.';
  }
}

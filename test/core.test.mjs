import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {Bot} from '../src/bot.mjs';
import {addMonths,renewByMonths,extractIdentity,matchesIdentity,updatePayload} from '../src/resolve.mjs';
import {parseAmount} from '../src/utils.mjs';
import {loadConfig} from '../src/config.mjs';

const GB=1073741824;
function setup(){
  const db=new Store(':memory:');
  const repId=db.createRep('23456789','نماینده آزمایشی','11111111');
  db.setGigRate(repId,10000,'11111111');
  db.toggleInbound(7,'11111111');
  const clients=new Map(), sent=[], qr=[], tg={send:async(chat,text,keys)=>{sent.push({chat:String(chat),text,keys});return {message_id:sent.length};},sendQr:async(chat,link,caption)=>{qr.push({chat:String(chat),link,caption});return {};},call:async()=>({}),answer:async()=>({})};
  const panel={
    async listInbounds(){return [{id:7,remark:'VLESS',protocol:'vless',enable:true}]},
    async search(query){return [...clients.values()].filter(c=>c.email.includes(query))},
    async createClient({email,volumeGb,expiryTime,subId}){clients.set(email,{email,totalGB:volumeGb*GB,expiryTime,subId,enable:true,inboundIds:[7],traffic:{up:0,down:0}});},
    async details(email){if(!clients.has(email))throw new Error('missing');return structuredClone(clients.get(email));},
    async changeExpiry(email,oldExpiry,expiry,total){const x=clients.get(email);if(x.expiryTime!==oldExpiry)throw new Error('changed');x.expiryTime=expiry;x.totalGB=total;},
    async toggleClient(email,expected){const x=clients.get(email);if(x.enable!==expected)throw new Error('changed');x.enable=!expected;},
    async resetTraffic(email){clients.get(email).traffic={up:0,down:0};},
    async find(input){const email=input.startsWith('email:')?input.slice(6):[...clients.values()].find(c=>c.subId===input.split('/').at(-1))?.email;return this.details(email);},
    async links(email){const x=clients.get(email);return x?[`vless://${x.uuid||'11111111-2222-3333-4444-555555555555'}@example.org:443?type=tcp#${email}`]:[];},
    async validate(){return {total:clients.size}}
  };
  const config={ownerIds:new Set(['11111111']),timezone:'Asia/Tehran',resetTraffic:true,subscriptionBase:'https://sub.example.com/random/'};
  const bot=new Bot({config,db,panel,tg});
  const message=async(user,text,photo)=>bot.handle({message:{chat:{id:user,type:'private'},from:{id:user},text,...(photo?{photo:[{file_id:photo}]}:{})}});
  const click=async(user,data)=>bot.handle({callback_query:{id:'cb',data,from:{id:user},message:{chat:{id:user,type:'private'}}}});
  return {db,repId,clients,sent,qr,panel,bot,message,click,close:()=>db.close()};
}

test('monthly calendar clamps end of month and enforces integer months',()=>{
  assert.equal(new Date(addMonths(Date.UTC(2026,0,31),1)).toISOString().slice(0,10),'2026-02-28');
  assert.throws(()=>addMonths(Date.now(),1.5));
  assert.ok(renewByMonths(Date.now()-86400000,1)>Date.now());
});
test('config rejects fake /panel suffix and accepts no proxy',()=>{
  const env={TELEGRAM_BOT_TOKEN:'fake-token',PANEL_API_TOKEN:'fake-panel',OWNER_TELEGRAM_IDS:'11111111',PANEL_URL:'https://panel.example.net/base/'};
  assert.equal(loadConfig(env).telegramProxyUrl,'');
  assert.throws(()=>loadConfig({...env,PANEL_URL:'https://panel.example.net/base/panel'}));
  assert.equal(loadConfig({...env,ADMIN_TELEGRAM_IDS:'23456789',OWNER_TELEGRAM_IDS:''}).ownerIds.has('23456789'),true);
});
test('parse money permits zero only when authorized',()=>{
  assert.equal(parseAmount('۲۵۰,۰۰۰'),250000);
  assert.equal(parseAmount('0',true),0);
  assert.throws(()=>parseAmount('0'));
});
test('client identity parser supports subscription paths and vless credentials',()=>{
  assert.deepEqual(extractIdentity('https://sub.example/sub/abcDef123'),{kind:'subId',value:'abcDef123'});
  const id='a'.repeat(30);
  assert.deepEqual(extractIdentity(`vless://${id}@example.org:443?type=tcp#test`),{kind:'credential',value:id});
  assert.ok(matchesIdentity({email:'abc',uuid:id},{kind:'credential',value:id}));
  assert.deepEqual(extractIdentity('https://site/other/secret'),{kind:'subId',value:'secret'});
});
test('retain client fields for full update',()=>{
  const v=updatePayload({email:'a',uuid:'x',subId:'y',totalGB:44,enable:false,flow:'vision',tgId:5},123);
  assert.equal(v.flow,'vision');assert.equal(v.uuid,'x');assert.equal(v.totalGB,44);assert.equal(v.expiryTime,123);
});
test('admin permissions and representative isolation',async()=>{
  const x=setup();try{
    await x.click('23456789','a:reps');assert.match(x.sent.at(-1).text,/فقط مدیر/);
    await x.click('44444444','r:balance');assert.match(x.sent.at(-1).text,/دسترسی/);
    x.db.transfer('old',x.repId,'11111111');
    const id2=x.db.createRep('22222222','دیگر نماینده','11111111');
    await x.click('22222222',`r:account:${x.db.owner('old').rowid}`);
    assert.match(x.sent.at(-1).text,/متعلق|دسترسی/);
  }finally{x.close();}
});
test('creation flow uses month+volume and charges only after verified panel write',async()=>{
  const x=setup();try{
    await x.click('23456789','r:create');
    await x.message('23456789','30');
    await x.click('23456789','r:createmonths:1');
    await x.click('23456789','r:createinbound:7');
    await x.message('23456789','ali123');
    assert.equal(x.db.session('23456789').state,'create.confirm');
    await x.click('23456789','r:createconfirm');
    const c=x.db.creation(1);assert.equal(c.status,'applied');
    assert.equal(c.volume_gb,30);assert.equal(c.months,1);
    assert.equal(x.clients.get('r1_ali123').totalGB,30*GB);
    assert.ok(x.qr.length>=1);
    assert.equal(x.db.owner('r1_ali123').rep_id,x.repId);
    assert.equal(x.db.balance(x.repId),300000);
    assert.equal(x.db.ledger(x.repId).length,1);
    await x.click('23456789','r:createconfirm');
    assert.equal(x.db.ledger(x.repId).length,1);
  }finally{x.close();}
});
test('creation blocked if preflight panel fails',async()=>{
  const x=setup();try{
    x.panel.search=async()=>{throw new Error('failed')};
    await x.click('23456789','r:create');await x.message('23456789','30');await x.click('23456789','r:createmonths:1');await x.click('23456789','r:createinbound:7');await x.message('23456789','ali123');await x.click('23456789','r:createconfirm');
    assert.equal(x.db.creation(1),undefined);assert.equal(x.db.balance(x.repId),0);
  }finally{x.close();}
});
test('renewal verified and billed once; traffic reset',async()=>{
  const x=setup();try{
    const old=Date.now()+3*86400000;
    x.clients.set('old',{email:'old',enable:true,subId:'abcde',expiryTime:old,totalGB:60*GB,traffic:{up:2*GB,down:4*GB}});
    x.db.transfer('old',x.repId,'11111111');
    await x.click('23456789',`r:renewaccount:${x.db.owner('old').rowid}`);
    await x.message('23456789','30');
    await x.click('23456789','r:renewmonths:1');
    await x.click('23456789','r:renewconfirm');
    assert.equal(x.db.renewal(1).status,'applied');
    assert.equal(x.db.renewal(1).months,1);
    assert.equal(x.db.balance(x.repId),300000);
    assert.equal(x.clients.get('old').totalGB,30*GB);
    assert.equal(x.clients.get('old').traffic.up,0);
    await x.click('23456789','r:renewconfirm');
    assert.equal(x.db.balance(x.repId),300000);
  }finally{x.close();}
});
test('uncertain create never auto-charges and remains for manager review',async()=>{
  const x=setup();try{
    x.panel.createClient=async()=>{throw new Error('timeout')};
    await x.click('23456789','r:create');await x.message('23456789','30');await x.click('23456789','r:createmonths:1');await x.click('23456789','r:createinbound:7');await x.message('23456789','ali123');await x.click('23456789','r:createconfirm');
    assert.equal(x.db.creation(1).status,'review');assert.equal(x.db.balance(x.repId),0);
    assert.equal(x.db.pendingCreations().length,1);
  }finally{x.close();}
});
test('payment only affects ledger after approval and cannot approve twice',async()=>{
  const x=setup();try{
    x.db.adjustment(x.repId,500000,'starting balance','11111111');
    const paymentId=x.db.createPayment(x.repId,200000,'TRACK',null,'23456789');
    assert.equal(x.db.balance(x.repId),500000);
    await x.click('11111111',`a:approve:${paymentId}`);
    assert.equal(x.db.balance(x.repId),300000);
    await x.click('11111111',`a:approve:${paymentId}`);
    assert.equal(x.db.balance(x.repId),300000);
  }finally{x.close();}
});
test('alert once per threshold breach and resets after settlement',async()=>{
  const x=setup();try{
    x.db.setDebtAlert(x.repId,100000,'11111111');
    x.db.adjustment(x.repId,120000,'starter','11111111');
    await x.bot.debtCheck(x.repId);
    assert.equal(x.db.logs().filter(e=>e.action==='debt.alert').length,1);
    await x.bot.debtCheck(x.repId);
    assert.equal(x.db.logs().filter(e=>e.action==='debt.alert').length,1);
    const payment=x.db.createPayment(x.repId,90000,'CODE',null,'23456789');
    await x.click('11111111',`a:approve:${payment}`);
    assert.equal(x.db.rep(x.repId).alerted,0);
    x.db.adjustment(x.repId,100000,'extra charge','11111111');
    await x.bot.debtCheck(x.repId);
    assert.equal(x.db.logs().filter(e=>e.action==='debt.alert').length,2);
  }finally{x.close();}
});
test('2-way chat stores messages, notifies recipient, has private history',async()=>{
  const x=setup();try{
    await x.click('23456789','r:message');await x.message('23456789','سلام مدیر');
    assert.equal(x.db.messages(x.repId).length,1);
    assert.ok(x.sent.some(e=>e.chat==='11111111'&&e.text.includes('سلام مدیر')));
    await x.click('11111111',`a:reply:${x.repId}`);await x.message('11111111','درود نماینده');
    assert.equal(x.db.messages(x.repId).length,2);
    assert.ok(x.sent.some(e=>e.chat==='23456789'&&e.text.includes('درود نماینده')));
  }finally{x.close();}
});
test('admin broadcast requires confirmation and persists conversations',async()=>{
  const x=setup();try{
    await x.click('11111111','a:broadcast');
    await x.message('11111111','پیام عمومی آزمایشی');
    assert.equal(x.db.messages(x.repId).length,0);
    await x.click('11111111','a:broadcastsend');
    assert.equal(x.db.messages(x.repId).length,1);
    await x.click('11111111','a:broadcastsend');
    assert.equal(x.db.messages(x.repId).length,1);
  }finally{x.close();}
});
test('admin may manually close an unresolved operation only with audited reason',async()=>{
  const x=setup();try{
    x.panel.createClient=async()=>{throw new Error('timeout')};
    await x.click('23456789','r:create');await x.message('23456789','30');await x.click('23456789','r:createmonths:1');await x.click('23456789','r:createinbound:7');
    await x.message('23456789','ali123');await x.click('23456789','r:createconfirm');
    assert.equal(x.db.creation(1).status,'review');
    await x.click('11111111','a:closecreate:1');
    await x.message('11111111','تأیید شد که حساب در پنل ایجاد نشده است');
    assert.equal(x.db.creation(1).status,'failed');
    assert.equal(x.db.balance(x.repId),0);
    assert.equal(x.db.logs().filter(x=>x.action==='operation.manual_close').length,1);
  }finally{x.close();}
});
test('history pagination merges create and renewal records',()=>{
  const x=setup();try{
    assert.equal(x.db.operationsCount(x.repId),0);
    x.db.transfer('old',x.repId,'11111111');
    const n=x.db.beginRenewal({repId:x.repId,email:'old',planId:999997,months:1,volumeGb:30,oldTotal:10*GB,price:200000,oldExpiry:1900000000000,newExpiry:1910000000000,actor:'23456789'});
    x.db.completeRenewal(n,'23456789');
    assert.equal(x.db.operationsCount(x.repId),1);
    assert.equal(x.db.operations(x.repId,10,0)[0].kind,'renew');
    assert.equal(x.db.operationsAllCount(),1);
  }finally{x.close();}
});

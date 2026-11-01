import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {Bot} from '../src/bot.mjs';
import {periodBounds} from '../src/sales.mjs';
import {extractIdentity} from '../src/resolve.mjs';

const GB=1073741824;
function env(){
 const db=new Store(':memory:');
 const rep=db.createRep('123450001','نماینده یک','987650001');
 const other=db.createRep('123450002','نماینده دو','987650001');
 db.setGigRate(rep,6000,'987650001'); db.setGigRate(other,7000,'987650001');
 db.toggleInbound(11,'987650001');
 const accounts=new Map(); const messages=[],qrs=[],photos=[];
 const tg={send:async(chat,text,keys)=>{messages.push({chat:String(chat),text,keys});return {message_id:messages.length};},
  sendQr:async(chat,link,caption)=>{qrs.push({chat:String(chat),link,caption});},
  call:async(method,data)=>{if(method==='sendPhoto')photos.push({chat:String(data.chat_id),photo:data.photo});return {message_id:1};},answer:async()=>{}};
 const panel={listInbounds:async()=>[{id:11,enable:true,protocol:'vless',remark:'Main'}],
  search:async(query)=>[...accounts.values()].filter(c=>c.email.includes(query)),
  details:async(email)=>{if(!accounts.has(email))throw Error('No account');return structuredClone(accounts.get(email));},
  find:async(text)=>{const id=extractIdentity(text);const c=[...accounts.values()].find(c=>id.kind==='email'?id.value===c.email:id.kind==='subId'?id.value===c.subId:id.value===c.uuid);if(!c)throw Error('No match');return structuredClone(c);},
  links:async(email)=>accounts.has(email)?[`vless://${accounts.get(email).uuid}@domain.example:443?type=tcp#${email}`]:[],
  createClient:async({email,volumeGb,expiryTime,subId})=>{accounts.set(email,{email,subId,uuid:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',enable:true,expiryTime,totalGB:volumeGb*GB,inboundIds:[11],traffic:{up:0,down:0}});},
  changeExpiry:async(email,old,expiry,total)=>{const c=accounts.get(email);assert.equal(c.expiryTime,old);c.expiryTime=expiry;c.totalGB=total;},
  resetTraffic:async()=>{},
  toggleClient:async()=>{}};
 const bot=new Bot({config:{ownerIds:new Set(['987650001']),timezone:'Asia/Tehran',resetTraffic:false,subscriptionBase:'https://sub.example/random/'},db,panel,tg});
 const click=(id,data)=>bot.handle({callback_query:{id:'cb',from:{id},data,message:{chat:{id,type:'private'}}}});
 const input=(id,text,photo)=>bot.handle({message:{chat:{id,type:'private'},from:{id},text,...(photo?{photo:[{file_id:photo}]}:{})}});
 return {db,rep,other,bot,panel,accounts,qrs,messages,photos,click,input,close:()=>db.close()};
}

test('free GB selection requires minimum 20 and calculates per rep volume x months',async()=>{
 const x=env();try{
  await x.click('123450001','r:create');await x.input('123450001','19');
  assert.match(x.messages.at(-1).text,/20/);
  await x.input('123450001','47');
  assert.equal(x.db.session('123450001').state,'create.months');
  await x.click('123450001','r:createmonths:3');await x.click('123450001','r:createinbound:11');
  await x.input('123450001','newcustomer');
  const pre=x.db.session('123450001');
  assert.equal(pre.payload.volumeGb,47);assert.equal(pre.payload.months,3);assert.equal(pre.payload.price,47*3*6000);
  await x.click('123450001','r:createconfirm');
  assert.equal(x.db.creation(1).status,'applied');
  assert.equal(x.db.balance(x.rep),47*3*6000);
  assert.ok(x.qrs.some(q=>q.link.startsWith('vless://')));
  assert.ok(x.qrs.some(q=>q.link==='https://sub.example/random/'+x.accounts.get('r1_newcustomer').subId));
  assert.ok(x.messages.some(m=>m.keys?.some(row=>row.some(b=>b.copy_text))));
 }finally{x.close();}
});

test('subscription URL with random prefix resolves to owner and allows renewal',async()=>{
 const x=env();try{
  const expiry=Date.now()+86400000;
  x.accounts.set('existing',{email:'existing',uuid:'11111111-2222-4333-8444-555555555555',subId:'realSub123',totalGB:35*GB,expiryTime:expiry,enable:true,inboundIds:[11]});
  x.db.transfer('existing',x.rep,'987650001');
  await x.click('123450001','r:renew');
  await x.input('123450001','https://sub.example/r4nd0m-path/realSub123');
  assert.equal(x.db.session('123450001').state,'renew.volume');
  await x.input('123450001','45');await x.click('123450001','r:renewmonths:1');
  await x.click('123450001','r:renewconfirm');
  assert.equal(x.db.renewal(1).status,'applied');
  assert.equal(x.db.balance(x.rep),45*6000);
  assert.equal(x.accounts.get('existing').totalGB,45*GB);
 }finally{x.close();}
});

test('sales report excludes unapproved sales, isolates reps and counts date range',()=>{
 const x=env();try{
  assert.equal(x.db.customPrice(x.rep,20,1),120000);
  x.db.transfer('sale_1',x.rep,'987650001');
  const a=x.db.beginRenewal({repId:x.rep,email:'sale_1',planId:999997,months:1,volumeGb:20,oldTotal:10*GB,price:120000,oldExpiry:Date.now()+10000,newExpiry:Date.now()+9000000,actor:'123450001'});
  x.db.completeRenewal(a,'123450001');
  const now=Date.now();
  const pending=x.db.beginCreation({repId:x.other,email:'not_complete',planId:999997,months:1,volumeGb:50,price:350000,inboundId:11,expiryTime:now+1000000,subId:'abcabcabc',actor:'123450002'});
  assert.ok(pending>0);
  const all=x.db.sales(null,0,now+2000),rep=x.db.sales(x.rep,0,now+2000),other=x.db.sales(x.other,0,now+2000);
  assert.equal(all.summary.amount,120000);assert.equal(rep.summary.count,1);assert.equal(other.summary.count,0);
  assert.equal(all.records[0].email,'sale_1');
 }finally{x.close();}
});

test('receipt photo may be viewed again only by owner or admin',async()=>{
 const x=env();try{
  const p=x.db.createPayment(x.rep,120000,'TRX123','telegram-file-id-secret','123450001');
  await x.click('123450002',`r:receipt:${p}`);
  assert.equal(x.photos.length,0);
  await x.click('123450001',`r:payment:${p}`);
  assert.match(x.messages.at(-1).text,/واریزی/);
  await x.click('123450001',`r:receipt:${p}`);
  await x.click('987650001',`a:receipt:${p}`);
  assert.equal(x.photos.length,2);assert.equal(x.photos[0].photo,'telegram-file-id-secret');
 }finally{x.close();}
});

test('sales report menu and current week/month use Tehran calendar boundaries',async()=>{
 const x=env();try{
  await x.click('123450001','r:sales');
  assert.match(x.messages.at(-1).text,/گزارش فروش/);
  await x.click('123450001','r:salesshow:week');
  assert.match(x.messages.at(-1).text,/فروش این هفته/);
  await x.click('987650001','a:salesshow:month:');
  assert.match(x.messages.at(-1).text,/فروش این ماه/);
  const now=Date.parse('2026-11-01T10:00:00.000Z');
  const [today]=periodBounds('today',now);const [week]=periodBounds('week',now);const [month]=periodBounds('month',now);
  assert.equal(new Date(today).toISOString(),'2026-10-31T20:30:00.000Z');
  assert.equal(new Date(week).toISOString(),'2026-10-30T20:30:00.000Z');
  assert.ok(month<=week);
  for(const key of ['six','year','all'])assert.ok(periodBounds(key,now)[0]<=month);
 }finally{x.close();}
});

test('each representative has an independent per-GB monthly rate; historical sales preserve quoted prices',async()=>{
 const x=env();try{
  x.db.setGigRate(x.rep,6500,'987650001');
  x.db.setGigRate(x.other,7000,'987650001');
  assert.equal(x.db.customPrice(x.rep,20,1),130000);
  assert.equal(x.db.customPrice(x.other,20,1),140000);
  assert.equal(x.db.customPrice(x.rep,45,2),585000);
  assert.throws(()=>x.db.customPrice(x.other,19,1),/۲۰/);
  // Two representatives may create equal-size accounts, but their invoice prices differ.
  for(const [user,name] of [['123450001','alice'],['123450002','bob']]){
    await x.click(user,'r:create');await x.input(user,'40');
    await x.click(user,'r:createmonths:1');await x.click(user,'r:createinbound:11');
    await x.input(user,name);await x.click(user,'r:createconfirm');
  }
  assert.equal(x.db.balance(x.rep),260000);
  assert.equal(x.db.balance(x.other),280000);
  assert.equal(x.db.sales(null,0,Date.now()+2000).summary.amount,540000);
  // A later rate adjustment changes future prices, not the recorded completed sales.
  x.db.setGigRate(x.rep,9000,'987650001');
  assert.equal(x.db.customPrice(x.rep,40,1),360000);
  assert.equal(x.db.creation(1).price,260000);
  assert.equal(x.db.balance(x.rep),260000);
  assert.equal(x.db.sales(x.rep,0,Date.now()+2000).summary.amount,260000);
 }finally{x.close();}
});

test('admin can view receipts of approved payments from full payment history',async()=>{
 const x=env();try{
  const id=x.db.createPayment(x.rep,50000,'PAID222','stored-image-id','123450001');
  x.db.settlePayment(id,true,'987650001');
  await x.click('987650001','a:payments');
  assert.ok(x.messages.at(-1).keys.some(row=>row.some(b=>b.callback_data===`a:payment:${id}`)));
  await x.click('987650001',`a:payment:${id}`);
  assert.ok(x.messages.at(-1).keys.some(row=>row.some(b=>b.callback_data===`a:receipt:${id}`)));
  await x.click('987650001',`a:receipt:${id}`);
  assert.equal(x.photos.at(-1).photo,'stored-image-id');
 }finally{x.close();}
});

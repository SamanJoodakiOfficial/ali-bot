import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';
import { Bot } from '../src/bot.mjs';
import { firstUseExpiry, renewalQuota } from '../src/resolve.mjs';

const GB=1073741824;

function setup(){
  const db=new Store(':memory:');
  const repId=db.createRep('10000001','نماینده اول','90000001');
  const otherId=db.createRep('10000002','نماینده دوم','90000001');
  db.setGigRate(repId,6500,'90000001');db.setGigRate(otherId,7000,'90000001');
  db.toggleInbound(12,'90000001');
  const messages=[];const clients=new Map();
  const tg={send:async (chat,text,keys)=>{messages.push({chat:String(chat),text,keys});return {message_id:messages.length};},
    sendQr:async()=>{},call:async()=>{},answer:async()=>{}};
  const panel={
    listInbounds:async()=>[{id:12,enable:true,remark:'Main',protocol:'vless'}],
    search:async q=>[...clients.values()].filter(c=>c.email.includes(q)),
    createClient:async ({email,volumeGb,expiryTime,subId})=>{clients.set(email,{email,volumeGb,subId,uuid:'11111111-2222-4333-8444-555555555555',expiryTime,totalGB:volumeGb*GB,enable:true,inboundIds:[12],traffic:{up:0,down:0}});},
    details:async email=>{const c=clients.get(email);if(!c)throw new Error('Not found');return structuredClone(c);},
    traffic:async email=>{const c=clients.get(email);return {up:c.traffic.up,down:c.traffic.down,used:c.traffic.up+c.traffic.down};},
    links:async()=>[],resetTraffic:async email=>{clients.get(email).traffic={up:0,down:0};},
    changeExpiry:async (email,old,newExpiry,newTotal)=>{const c=clients.get(email);if(c.expiryTime!==old)throw new Error('changed');c.expiryTime=newExpiry;c.totalGB=newTotal;},
  };
  const bot=new Bot({config:{ownerIds:new Set(['90000001']),timezone:'Asia/Tehran',subscriptionBase:''},db,panel,tg});
  const click=(user,data)=>bot.handle({callback_query:{id:'cb',data,from:{id:user},message:{chat:{id:user,type:'private'}}}});
  const input=(user,text)=>bot.handle({message:{from:{id:user},chat:{id:user,type:'private'},text}});
  return {db,bot,repId,otherId,clients,messages,click,input,close:()=>db.close()};
}

test('new representatives default to 1..10000 GB and each can have independent limits',()=>{
  const x=setup();try {
    assert.deepEqual(x.db.volumeBounds(x.repId),{min:1,max:10000});
    assert.equal(x.db.customPrice(x.repId,1,1),6500);
    assert.equal(x.db.customPrice(x.otherId,1,1),7000);
    x.db.setVolumeLimit(x.repId,'max_volume_gb',100,'90000001');
    x.db.setVolumeLimit(x.repId,'min_volume_gb',1,'90000001');
    x.db.setVolumeLimit(x.otherId,'max_volume_gb',200,'90000001');
    x.db.setVolumeLimit(x.otherId,'min_volume_gb',5,'90000001');
    assert.equal(x.db.customPrice(x.repId,1,1),6500);
    assert.equal(x.db.customPrice(x.repId,100,1),650000);
    assert.throws(()=>x.db.customPrice(x.repId,101,1),/1 تا 100/);
    assert.throws(()=>x.db.customPrice(x.otherId,1,1),/5 تا 200/);
    assert.equal(x.db.customPrice(x.otherId,5,1),35000);
    assert.throws(()=>x.db.customPrice(x.otherId,5,2),/فقط یک‌ماهه/);
  }finally{x.close();}
});

test('limits never allow min > max, values outside global bounds, or unsupported fields',()=>{
  const x=setup();try {
    x.db.setVolumeLimit(x.repId,'max_volume_gb',20,'90000001');
    assert.throws(()=>x.db.setVolumeLimit(x.repId,'min_volume_gb',30,'90000001'),/حداقل/);
    assert.throws(()=>x.db.setVolumeLimit(x.repId,'max_volume_gb',0,'90000001'),/۱ تا ۱۰۰۰۰/);
    assert.throws(()=>x.db.setVolumeLimit(x.repId,'max_volume_gb',10001,'90000001'),/۱ تا ۱۰۰۰۰/);
    assert.throws(()=>x.db.setVolumeLimit(x.repId,'active',20,'90000001'),/نامعتبر/);
    assert.deepEqual(x.db.volumeBounds(x.repId),{min:1,max:20});
    assert.ok(x.db.logs().some(x=>x.action==='rep.volume_limit'));
  }finally{x.close();}
});

test('legacy SQLite DB gains limit columns without changing representative values',()=>{
  const dir=mkdtempSync(join(tmpdir(),'reseller-limits-'));const path=join(dir,'legacy.sqlite');
  try{
    const old=new DatabaseSync(path);
    old.exec("CREATE TABLE representatives(id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, price_per_gb_month INTEGER NOT NULL DEFAULT 0, debt_alert INTEGER NOT NULL DEFAULT 0, alerted INTEGER NOT NULL DEFAULT 0);");
    old.prepare('INSERT INTO representatives(telegram_id,name,created_at,price_per_gb_month) VALUES(?,?,?,?)').run('10000003','قدیمی',Date.now(),5500);
    old.close();
    const upgraded=new Store(path);
    try{
      assert.equal(upgraded.repByTg('10000003').price_per_gb_month,5500);
      assert.deepEqual(upgraded.volumeBounds(1),{min:1,max:10000});
      upgraded.setVolumeLimit(1,'max_volume_gb',25,'90000001');
    }finally{upgraded.close();}
    const reopened=new Store(path);
    try{assert.deepEqual(reopened.volumeBounds(1),{min:1,max:25});}
    finally{reopened.close();}
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('admin changes minimum and maximum from Telegram menu; 1 GB creates after first use',async()=>{
  const x=setup();try{
    await x.click('90000001',`a:rep:${x.repId}`);
    assert.match(x.messages.at(-1).text,/حجم مجاز ساخت و تمدید/);
    await x.click('90000001',`a:maxvolume:${x.repId}`);
    await x.input('90000001','100');
    await x.click('90000001',`a:minvolume:${x.repId}`);
    await x.input('90000001','1');
    await x.click('10000001','r:create');
    assert.match(x.messages.at(-1).text,/۱ تا ۱۰۰/);
    await x.input('10000001','101');
    assert.match(x.messages.at(-1).text,/1 تا 100/);
    await x.input('10000001','1');
    await x.click('10000001','r:createmonths:1');
    await x.click('10000001','r:createinbound:12');
    await x.input('10000001','onegb');
    assert.equal(x.db.session('10000001').payload.price,6500);
    await x.click('10000001','r:createconfirm');
    assert.equal(x.db.creation(1).status,'applied');
    assert.equal(x.db.creation(1).volume_gb,1);
    assert.equal(x.db.balance(x.repId),6500);
    assert.equal(x.clients.get('r1_onegb').expiryTime,firstUseExpiry());
    assert.equal(x.clients.get('r1_onegb').totalGB,renewalQuota(1));
  }finally{x.close();}
});

test('changing limits after a quote blocks the creation before remote API call',async()=>{
  const x=setup();try{
    await x.click('10000001','r:create');
    await x.input('10000001','50');
    await x.click('10000001','r:createmonths:1');
    await x.click('10000001','r:createinbound:12');
    await x.input('10000001','customer');
    x.db.setVolumeLimit(x.repId,'max_volume_gb',20,'90000001');
    await x.click('10000001','r:createconfirm');
    assert.equal(x.clients.size,0);
    assert.equal(x.db.balance(x.repId),0);
    assert.match(x.messages.at(-1).text,/1 تا 20/);
  }finally{x.close();}
});

test('limits also prevent renewal of account volumes outside representative range',async()=>{
  const x=setup();try{
    x.clients.set('existing',{email:'existing',subId:'subs007',uuid:'11111111-2222-4333-8444-555555555555',totalGB:40*GB,expiryTime:Date.now()+86400000,enable:true,inboundIds:[12],traffic:{up:0,down:0}});
    x.db.transfer('existing',x.repId,'90000001');
    x.db.setVolumeLimit(x.repId,'min_volume_gb',2,'90000001');
    x.db.setVolumeLimit(x.repId,'max_volume_gb',10,'90000001');
    await x.click('10000001',`r:renewaccount:${x.db.owner('existing').rowid}`);
    assert.match(x.messages.at(-1).text,/۲ تا ۱۰/);
    await x.input('10000001','1');
    assert.match(x.messages.at(-1).text,/2 تا 10/);
    await x.input('10000001','5');
    await x.click('10000001','r:renewmonths:1');
    await x.click('10000001','r:renewconfirm');
    assert.equal(x.clients.get('existing').totalGB,5*GB);
    assert.equal(x.db.renewal(1).status,'applied');
    assert.equal(x.db.balance(x.repId),5*6500);
  }finally{x.close();}
});

test('admin representative screen exposes a visible volume-limit submenu with min and max controls',async()=>{
  const x=setup();try{
    await x.click('90000001',`a:rep:${x.repId}`);
    let keys=x.messages.at(-1).keys;
    assert.ok(keys.flat().some(k=>k.callback_data===`a:volumelimits:${x.repId}`),
      'representative screen must visibly expose volume limits');

    await x.click('90000001',`a:volumelimits:${x.repId}`);
    assert.match(x.messages.at(-1).text,/حداقل حجم مجاز/);
    assert.match(x.messages.at(-1).text,/حداکثر حجم مجاز/);
    keys=x.messages.at(-1).keys;
    assert.ok(keys.flat().some(k=>k.callback_data===`a:minvolume:${x.repId}`));
    assert.ok(keys.flat().some(k=>k.callback_data===`a:maxvolume:${x.repId}`));

    await x.click('90000001',`a:minvolume:${x.repId}`);
    await x.input('90000001','1');
    await x.click('90000001',`a:volumelimits:${x.repId}`);
    assert.match(x.messages.at(-1).text,/حداقل حجم مجاز: <b>۱ گیگابایت<\/b>/);

    await x.click('90000001',`a:maxvolume:${x.repId}`);
    await x.input('90000001','250');
    await x.click('90000001',`a:volumelimits:${x.repId}`);
    assert.match(x.messages.at(-1).text,/حداکثر حجم مجاز: <b>۲۵۰ گیگابایت<\/b>/);
  }finally{x.close();}
});

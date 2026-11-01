import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {Bot} from '../src/bot.mjs';
import {PanelApi} from '../src/panel.mjs';
import {extractIdentity,identityFingerprint,hasIdentityFingerprint} from '../src/resolve.mjs';
import {createBackup,validateBackup} from '../src/maintenance.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const GB=1073741824;
const uuid='aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa';
function fixture(){
  const db=new Store(':memory:');
  const repId=db.createRep('11112222','نماینده','88889999');
  const other=db.createRep('33334444','رقیب','88889999');
  db.setGigRate(repId,6500,'88889999');db.setGigRate(other,7000,'88889999');
  const accounts=new Map([['legacy',{email:'legacy',uuid,subId:'longSubabc123',expiryTime:Date.now()+2*86400000,enable:true,totalGB:20*GB,inboundIds:[1]}]]);
  const messages=[];
  const tg={send:async(chat,text,keys)=>{messages.push({chat:String(chat),text,keys});},answer:async()=>{},sendQr:async()=>{},call:async()=>{}};
  const panel={
    details:async(email)=>structuredClone(accounts.get(email)),
    traffic:async(email)=>{const c=accounts.get(email);return {up:c.used||0,down:0,used:c.used??10*GB};},
    resetTraffic:async(email)=>{accounts.get(email).used=0;},
    find:async(identity)=>{const x=typeof identity==='string'?extractIdentity(identity):identity;const acc=accounts.get('legacy');if((x.kind==='subId'&&x.value===acc.subId)||(x.kind==='credential'&&x.value===acc.uuid))return structuredClone(acc);throw Error('not found');},
    changeExpiry:async(email,oldExpiry,newExpiry,newTotal)=>{const c=accounts.get(email);assert.equal(c.expiryTime,oldExpiry);c.expiryTime=newExpiry;c.totalGB=newTotal;},
    links:async()=>[`vless://${uuid}@example.org:443#legacy`],
    onlineSnapshot:async()=>true,ipUsage:async()=>({recent:2,observed:4}),lastSeen:async()=>Date.now()-1500,registeredDeviceCount:async()=>2,
    toggleClient:async(email,expected)=>{const c=accounts.get(email);assert.equal(c.enable,expected);c.enable=!expected;}
  };
  const bot=new Bot({config:{ownerIds:new Set(['88889999']),timezone:'Asia/Tehran',subscriptionBase:'https://sub.example.com/path/'},db,panel,tg});
  const message=(id,text)=>bot.handle({message:{from:{id},chat:{type:'private',id},text}});
  const click=(id,data)=>bot.handle({callback_query:{id:'cb',from:{id},data,message:{chat:{type:'private',id}}}});
  return {db,repId,other,messages,accounts,bot,message,click,close:()=>db.close()};
}
test('link preview does not auto-pin and optional pin creates exactly one owner',async()=>{
  const x=fixture();try{
    await x.click('11112222','r:connect');
    await x.message('11112222','https://sub.example.com/path/longSubabc123');
    assert.equal(x.db.owner('legacy'),undefined);
    assert.equal(x.db.session('11112222').state,'link.review');
    assert.ok(x.messages.at(-1).keys.some(row=>row.some(b=>b.callback_data==='r:linkadd')));
    await x.click('11112222','r:linkadd');
    assert.equal(x.db.owner('legacy').rep_id,x.repId);
    assert.ok(x.messages.at(-1).keys.some(row=>row.some(b=>b.callback_data?.startsWith('r:usage:'))));
    await x.click('11112222',`r:unpin:${x.db.owner('legacy').rowid}`);
    await x.click('11112222',`r:unpinconfirm:${x.db.owner('legacy').rowid}`);
    assert.equal(x.db.owner('legacy'),undefined);
    assert.ok(x.accounts.has('legacy'));
  }finally{x.close();}
});
test('renew unpinned account, reset old usage, charge exactly purchased 20 GB and do not pin',async()=>{
  const x=fixture();try{
    await x.click('11112222','r:renew');
    await x.message('11112222','https://sub.example.com/secret/longSubabc123');
    assert.equal(x.db.owner('legacy'),undefined);
    await x.click('11112222','r:linkrenew');
    await x.message('11112222','20');
    await x.click('11112222','r:renewmonths:1');
    const quote=x.db.session('11112222');assert.equal(quote.state,'renew.confirm');
    assert.equal(quote.payload.oldTotal,20*GB);assert.equal(quote.payload.newTotal,20*GB);
    await x.click('11112222','r:renewconfirm');
    assert.equal(x.db.renewal(1).status,'applied');
    assert.equal(x.accounts.get('legacy').totalGB,20*GB);
    assert.equal(x.db.owner('legacy'),undefined);
    assert.equal(x.accounts.get('legacy').used,0);
    assert.equal(x.db.balance(x.repId),130000);
    assert.equal(x.db.renewal(1).save_account,0);
    await x.click('11112222','r:renewconfirm');
    assert.equal(x.db.balance(x.repId),130000);
  }finally{x.close();}
});
test('other representative cannot take already pinned account or view its usage',async()=>{
  const x=fixture();try{
    x.db.claim('legacy',x.repId,'11112222');
    await x.click('33334444','r:connect');await x.message('33334444','https://sub.example.com/path/longSubabc123');
    assert.equal(x.db.owner('legacy').rep_id,x.repId);
    assert.match(x.messages.at(-1).text,/نماینده دیگری/);
    await x.click('33334444',`r:usage:${x.db.owner('legacy').rowid}`);
    assert.match(x.messages.at(-1).text,/متعلق/);
  }finally{x.close();}
});
test('only monthly purchases and account status reports counts, not people identities',async()=>{
  const x=fixture();try{
    assert.throws(()=>x.db.customPrice(x.repId,30,2),/فقط یک‌ماهه/);
    x.db.claim('legacy',x.repId,'88889999');
    await x.click('11112222',`r:usage:${x.db.owner('legacy').rowid}`);
    assert.match(x.messages.at(-1).text,/IP یکتای ثبت‌شده در ۱۰ دقیقه اخیر/);
    assert.match(x.messages.at(-1).text,/تعداد قطعی افراد/);
  }finally{x.close();}
});
test('PanelApi online and unique recent IP count use documented POST routes',async()=>{
  const calls=[];
  const now=Date.now();
  const api=new PanelApi({baseUrl:'https://panel.example/hidden/',token:'test',fetchImpl:async(url,opts)=>{
    calls.push([new URL(url).pathname,opts.method]);
    const path=new URL(url).pathname;
    const obj=path.endsWith('/onlines')?['legacy'] : path.endsWith('/clientIpsByGuid')?{
      guid1:{legacy:[{ip:'1.2.3.4',timestamp:Math.floor(now/1000)-100},{ip:'4.3.2.1',timestamp:Math.floor(now/1000)-1000}]},
      guid2:{legacy:[{ip:'1.2.3.4',timestamp:Math.floor(now/1000)-50}]}
    }:{};
    return {ok:true,status:200,json:async()=>({success:true,obj})};
  }});
  assert.equal(await api.onlineSnapshot('legacy'),true);
  assert.deepEqual(await api.ipUsage('legacy',600000,now),{recent:1,observed:2,windowMinutes:10});
  assert.deepEqual(calls,[['/hidden/panel/api/clients/onlines','POST'],['/hidden/panel/api/clients/clientIpsByGuid','POST']]);
});
test('backup is consistent and validated without deleting original database',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sanaei-v24-'));
  const store=new Store(join(dir,'bot.sqlite'));
  try{
    store.createRep('11112222','نماینده','88889999');
    const file=await createBackup(store);
    const result=await validateBackup(file);
    assert.equal(result.representatives,1);
    assert.ok(result.size>=1024);
  }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('fingerprint verifies only same real subscription, not swapped account',()=>{
  const identity=extractIdentity('https://sub.example/x/longSubabc123');
  const digest=identityFingerprint(identity);
  assert.equal(hasIdentityFingerprint({subId:'longSubabc123'},'subId',digest),true);
  assert.equal(hasIdentityFingerprint({subId:'longSubabc125'},'subId',digest),false);
});

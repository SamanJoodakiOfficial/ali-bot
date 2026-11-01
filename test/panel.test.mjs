import test from 'node:test';
import assert from 'node:assert/strict';
import {PanelApi} from '../src/panel.mjs';
import {normalizeAllowedIPs,updatePayload} from '../src/resolve.mjs';
const GB=1073741824;
function mockAPI(handler){
  const calls=[];
  const fetchImpl=async(url,opts)=>{
    calls.push({url:new URL(url),opts});
    const payload=opts.body?JSON.parse(opts.body):null;
    const res=await handler(new URL(url),opts.method,payload);
    return {ok:res?.status!==403,status:res?.status||200,json:async()=>({success:res?.success??true,obj:res?.obj??null,msg:res?.msg||''})};
  };
  const api=new PanelApi({baseUrl:'https://panel.example/base/',token:'SECRET',fetchImpl});
  return {api,calls};
}
test('API respects base path and bearer and paged search',async()=>{
  const {api,calls}=mockAPI((url)=>({obj:{filtered:1,items:[{email:'r1_ali'}]}}));
  const rs=await api.search('r1_ali');assert.equal(rs[0].email,'r1_ali');
  assert.equal(calls[0].url.pathname,'/base/panel/api/clients/list/paged');
  assert.equal(calls[0].url.searchParams.get('search'),'r1_ali');
  assert.equal(calls[0].opts.headers.Authorization,'Bearer SECRET');
});
test('create sends monthly GB bytes and inbound ids, not old inbound/client route',async()=>{
  const {api,calls}=mockAPI(()=>({obj:null}));
  await api.createClient({email:'r1_customer',inboundId:7,volumeGb:30,expiryTime:1900000000000,subId:'hello12345',repId:1});
  assert.equal(calls[0].url.pathname,'/base/panel/api/clients/add');
  const body=JSON.parse(calls[0].opts.body);
  assert.deepEqual(body.inboundIds,[7]);assert.equal(body.client.totalGB,30*GB);
  assert.equal(body.client.expiryTime,1900000000000);
  assert.equal(body.client.subId,'hello12345');
});
test('update carries credential fields while renewing expiry and volume',async()=>{
  const old={email:'r1_a',totalGB:40*GB,expiryTime:1800000000000,flow:'xtls-rprx-vision',uuid:'uuid_value',id:503,subId:'abc',enable:true};
  const {api,calls}=mockAPI((url,method,body)=>url.pathname.endsWith('/get/r1_a')?{obj:{client:old,inboundIds:[7]}}:{obj:null});
  await api.changeExpiry('r1_a',old.expiryTime,old.expiryTime+86400000,30*GB);
  assert.equal(calls[1].url.pathname,'/base/panel/api/clients/update/r1_a');
  const body=JSON.parse(calls[1].opts.body);
  assert.equal(body.uuid,'uuid_value');assert.equal(body.id,'uuid_value');assert.equal(body.flow,'xtls-rprx-vision');
  assert.equal(body.totalGB,30*GB);
});
test('explicit API failure does not pass as success',async()=>{
  const {api}=mockAPI(()=>({success:false,msg:'denied'}));
  await assert.rejects(()=>api.validate(),/پنل درخواست را رد کرد/);
});

test('update never copies database numeric id into credential id for password-based clients',async()=>{
  const old={email:'trojan',id:177, password:'private-password',totalGB:20*GB,expiryTime:1800000000000,enable:false};
  const {api,calls}=mockAPI(url=>url.pathname.endsWith('/get/trojan')?{obj:{client:old,inboundIds:[503]}}:{obj:null});
  await api.changeExpiry('trojan',old.expiryTime,old.expiryTime+86400000,40*GB);
  const body=JSON.parse(calls[1].opts.body);
  assert.equal(body.id,undefined);
  assert.equal(body.password,'private-password');
  assert.equal(body.totalGB,40*GB);
});


test('allowedIPs strings from old panels are normalized before renewal; credentials remain intact',async()=>{
  const old={email:'old_user',id:503,uuid:'e7b81112-b182-4d46-8b65-bd2da425ced3',
    allowedIPs:'',totalGB:30*GB,expiryTime:1786480200000,enable:false,
    limitIp:2,flow:'xtls-rprx-vision',subId:'my-sub',comment:'keep-this'};
  const {api,calls}=mockAPI(url=>url.pathname.endsWith('/get/old_user')?{obj:{client:old,inboundIds:[503]}}:{obj:null});
  await api.changeExpiry('old_user',old.expiryTime,1796113336964,50*GB);
  const sent=JSON.parse(calls[1].opts.body);
  assert.deepEqual(sent.allowedIPs,[]);
  assert.equal(sent.id,old.uuid);
  assert.equal(sent.totalGB,50*GB);
  assert.equal(sent.comment,'keep-this');
  assert.equal(sent.flow,'xtls-rprx-vision');
});

test('allowedIPs JSON string or comma list preserves restrictions',()=>{
  assert.deepEqual(normalizeAllowedIPs(' ["10.0.0.2/32", "::/0"] '),['10.0.0.2/32','::/0']);
  assert.deepEqual(normalizeAllowedIPs('10.0.0.2/32, 10.0.0.3/32'),['10.0.0.2/32','10.0.0.3/32']);
  assert.deepEqual(normalizeAllowedIPs(['10.0.0.4/32']),['10.0.0.4/32']);
  assert.deepEqual(normalizeAllowedIPs('[]'),[]);
  assert.deepEqual(normalizeAllowedIPs(null),[]);
});

test('reject malformed allowedIPs before sending any renewal update',async()=>{
  const old={email:'bad_ips',id:22,uuid:'96698264-1c15-4b75-ac58-4505d4205357',allowedIPs:'[not-json',totalGB:20*GB,expiryTime:1800000000000};
  const {api,calls}=mockAPI(url=>url.pathname.endsWith('/get/bad_ips')?{obj:{client:old,inboundIds:[503]}}:{obj:null});
  await assert.rejects(()=>api.changeExpiry('bad_ips',old.expiryTime,old.expiryTime+86400000,40*GB),/allowedIPs/);
  assert.equal(calls.length,1);
});

test('toggle client also normalizes allowedIPs and never drops fields',async()=>{
  const old={email:'disabled_client',uuid:'d696abfc-2d28-4e20-8bb9-519f9898c7ba',
    allowedIPs:'["10.3.0.2/32"]',totalGB:20*GB,expiryTime:1900000000000,enable:false,
    password:'preserve-password',comment:'sticky'};
  const {api,calls}=mockAPI(url=>url.pathname.endsWith('/get/disabled_client')?{obj:{client:old,inboundIds:[503]}}:{obj:null});
  await api.toggleClient('disabled_client',false);
  const sent=JSON.parse(calls[1].opts.body);
  assert.deepEqual(sent.allowedIPs,['10.3.0.2/32']);
  assert.equal(sent.password,'preserve-password');
  assert.equal(sent.comment,'sticky');
  assert.equal(sent.enable,true);
});

test('normalization does not insert allowedIPs into accounts without the field',()=>{
  const p=updatePayload({email:'old',totalGB:20*GB,expiryTime:1800000000000},1800000000001);
  assert.equal(Object.hasOwn(p,'allowedIPs'),false);
});

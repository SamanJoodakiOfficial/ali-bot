import test from 'node:test';
import assert from 'node:assert/strict';
import {PanelApi} from '../src/panel.mjs';
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
  const old={email:'r1_a',totalGB:40*GB,expiryTime:1800000000000,flow:'xtls-rprx-vision',uuid:'uuid_value',subId:'abc',enable:true};
  const {api,calls}=mockAPI((url,method,body)=>url.pathname.endsWith('/get/r1_a')?{obj:{client:old,inboundIds:[7]}}:{obj:null});
  await api.changeExpiry('r1_a',old.expiryTime,old.expiryTime+86400000,30*GB);
  assert.equal(calls[1].url.pathname,'/base/panel/api/clients/update/r1_a');
  const body=JSON.parse(calls[1].opts.body);
  assert.equal(body.uuid,'uuid_value');assert.equal(body.flow,'xtls-rprx-vision');
  assert.equal(body.totalGB,30*GB);
});
test('explicit API failure does not pass as success',async()=>{
  const {api}=mockAPI(()=>({success:false,msg:'denied'}));
  await assert.rejects(()=>api.validate(),/پنل درخواست را رد کرد/);
});

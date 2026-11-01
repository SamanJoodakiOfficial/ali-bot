import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {Bot} from '../src/bot.mjs';
const GB=1073741824;
function setup({writeRejected=false,readback=false}={}){
 const db=new Store(':memory:');
 const repId=db.createRep('12345678','test','12345678');
 db.setGigRate(repId,6500,'12345678');
 const old=Date.now()+86400000;
 const latest={email:'client',subId:'test',totalGB:20*GB,expiryTime:old,enable:true,inboundIds:[503]};
 const panel={details:async()=>({...latest})};
 const tg={send:async()=>{},answer:async()=>{}};
 const bot=new Bot({config:{timezone:'Asia/Tehran',ownerIds:new Set(['12345678'])},db,panel,tg});
 const opId=db.beginRenewal({repId,email:'client',planId:999997,months:1,volumeGb:20,oldTotal:20*GB,newTotal:20*GB,oldUsed:10*GB,price:130000,oldExpiry:old,newExpiry:old+30*86400000,actor:'12345678',authorizedUnowned:true});
 if(writeRejected)db.markRenewal(opId,'review','Uncertain remote write: API rejected: invalid client flow',12345678);
 if(readback){latest.totalGB=20*GB;latest.expiryTime=old+30*86400000;}
 return {db,bot,opId,repId};
}
test('preserve API rejection reason after readback mismatch, debt remains zero',async()=>{
 const {db,bot,opId,repId}=setup({writeRejected:true});
 try{
  const text=await bot.reconcileRenew(opId,'12345678');
  assert.match(text,/واقعی/);
  assert.match(db.renewal(opId).error,/invalid client flow/);
  assert.match(db.renewal(opId).error,/expected/);
  assert.equal(db.renewal(opId).status,'review');
  assert.equal(db.balance(repId),0);
 }finally{db.close();}
});
test('save mismatch even on nominal API success without charging',async()=>{
 const {db,bot,opId,repId}=setup();
 try{
  await bot.reconcileRenew(opId,'12345678');
  assert.match(db.renewal(opId).error,/reported success but readback differs/);
  assert.equal(db.balance(repId),0);
 }finally{db.close();}
});
test('matching readback completes renewal once only after verified traffic reset',async()=>{
 const {db,bot,opId,repId}=setup({writeRejected:true,readback:true});
 try{
  db.markReset(opId,'verified');
  await bot.reconcileRenew(opId,'12345678');
  assert.equal(db.renewal(opId).status,'applied');
  assert.equal(db.balance(repId),130000);
  await assert.rejects(bot.reconcileRenew(opId,'12345678'),/قبلاً تعیین تکلیف/);
  assert.equal(db.balance(repId),130000);
 }finally{db.close();}
});

test('readback matching without verified reset does not charge',async()=>{
 const {db,bot,opId,repId}=setup({readback:true});
 try {
  const message=await bot.reconcileRenew(opId,'12345678');
  assert.match(message,/ریست ترافیک/);
  assert.equal(db.renewal(opId).status,'review');
  assert.equal(db.balance(repId),0);
 }finally{db.close();}
});

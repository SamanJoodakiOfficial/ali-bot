// Read-only renewal diagnostic. Never prints API tokens or client credentials.
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from './config.mjs';
import { PanelApi } from './panel.mjs';

const cfg=loadConfig();
const db=new DatabaseSync(cfg.dbPath,{readOnly:true});
let op;
try {
  const id=process.argv[2];
  if(id && !/^\d+$/.test(id))throw new Error('Renewal ID must be numeric');
  op=id
    ? db.prepare('SELECT * FROM renewals WHERE id=?').get(Number(id))
    : db.prepare('SELECT * FROM renewals ORDER BY id DESC LIMIT 1').get();
} finally {db.close();}
if(!op){console.log('No renewal found.');process.exit(0);}
const gb=bytes=>Number.isFinite(Number(bytes))?+(Number(bytes)/1073741824).toFixed(3):null;
const date=ms=>Number.isFinite(Number(ms))&&Number(ms)>0?new Date(Number(ms)).toISOString():null;
console.log('RENEWAL:',JSON.stringify({id:op.id,email:op.email,status:op.status,reason:op.error,trafficResetState:op.reset_state,purchasedGB:op.volume_gb,expectedTotalGB:gb(op.new_total),previousTotalGB:gb(op.old_total),expectedExpiry:date(op.new_expiry),previousExpiry:date(op.old_expiry)},null,2));
try {
  const panel=new PanelApi({baseUrl:cfg.panelBase,token:cfg.panelToken,timeoutMs:cfg.timeoutMs});
  const current=await panel.details(op.email);
  console.log('PANEL:',JSON.stringify({inboundIds:current.inboundIds,enabled:current.enable,totalGB:gb(current.totalGB),expiry:date(current.expiryTime),volumeMatches:Number(current.totalGB)===Number(op.new_total),expiryMatches:Number(current.expiryTime)===Number(op.new_expiry)},null,2));
  if(Number(current.totalGB)!==Number(op.new_total)||Number(current.expiryTime)!==Number(op.new_expiry))
    console.log('RESULT: NOT VERIFIED; do not repeat renewal, do not manually charge without investigation.');
  else
    console.log(op.reset_state==='verified'?'RESULT: QUOTA/EXPIRY MATCH + TRAFFIC RESET VERIFIED; admin may reconcile.':'RESULT: QUOTA/EXPIRY MATCH BUT TRAFFIC RESET NOT VERIFIED; do not charge or repeat automatically.');
} catch(e){
  // Display only short error class/message, not URLs or credentials.
  const safe=String(e?.message||'Unknown').replace(/https?:\/\/\S+/g,'[url]').slice(0,180);
  console.log('PANEL READ FAILED:',safe);
}

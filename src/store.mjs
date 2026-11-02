import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  constructor(path = ':memory:') {
    this.dbPath=path;
    if (path !== ':memory:') mkdirSync(dirname(path), {recursive:true});
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(`
CREATE TABLE IF NOT EXISTS representatives (
 id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS plans (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, months INTEGER NOT NULL CHECK(months BETWEEN 1 AND 24), volume_gb INTEGER NOT NULL CHECK(volume_gb BETWEEN 1 AND 10000),
 base_price INTEGER NOT NULL CHECK(base_price >= 0), active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS prices (
 rep_id INTEGER NOT NULL REFERENCES representatives(id), plan_id INTEGER NOT NULL REFERENCES plans(id),
 amount INTEGER NOT NULL CHECK(amount >= 0), PRIMARY KEY(rep_id, plan_id));
CREATE TABLE IF NOT EXISTS bank (id INTEGER PRIMARY KEY CHECK(id=1), card TEXT, iban TEXT, holder TEXT);
CREATE TABLE IF NOT EXISTS client_owners (
 email TEXT PRIMARY KEY, rep_id INTEGER NOT NULL REFERENCES representatives(id), updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS renewals (
 id INTEGER PRIMARY KEY AUTOINCREMENT, rep_id INTEGER NOT NULL REFERENCES representatives(id),
 email TEXT NOT NULL, plan_id INTEGER NOT NULL REFERENCES plans(id), months INTEGER NOT NULL, volume_gb INTEGER NOT NULL, old_total INTEGER NOT NULL,
 price INTEGER NOT NULL, old_expiry INTEGER NOT NULL, new_expiry INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','applied','failed','review')),
 reset_state TEXT NOT NULL DEFAULT 'not_requested', created_at INTEGER NOT NULL,
 completed_at INTEGER, error TEXT);
CREATE INDEX IF NOT EXISTS idx_renewal_rep ON renewals(rep_id,id DESC);
CREATE INDEX IF NOT EXISTS idx_renewal_status ON renewals(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_renewal ON renewals(email) WHERE status IN ('pending','review');
CREATE TABLE IF NOT EXISTS creations (
 id INTEGER PRIMARY KEY AUTOINCREMENT,rep_id INTEGER NOT NULL REFERENCES representatives(id),
 email TEXT NOT NULL UNIQUE,plan_id INTEGER NOT NULL REFERENCES plans(id),months INTEGER NOT NULL,
 volume_gb INTEGER NOT NULL,price INTEGER NOT NULL,inbound_id INTEGER NOT NULL,
 expiry_time INTEGER NOT NULL,sub_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','applied','failed','review')),
 created_at INTEGER NOT NULL,completed_at INTEGER,error TEXT);
CREATE INDEX IF NOT EXISTS idx_creations_rep ON creations(rep_id,id DESC);
CREATE TABLE IF NOT EXISTS allowed_inbounds (id INTEGER PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS payments (
 id INTEGER PRIMARY KEY AUTOINCREMENT, rep_id INTEGER NOT NULL REFERENCES representatives(id),
 amount INTEGER NOT NULL CHECK(amount > 0), reference TEXT NOT NULL, receipt_file TEXT,
 state TEXT NOT NULL CHECK(state IN ('pending','approved','rejected')) DEFAULT 'pending',
 created_at INTEGER NOT NULL, reviewed_at INTEGER, reviewed_by TEXT, note TEXT);
CREATE INDEX IF NOT EXISTS idx_payment_state ON payments(state);
CREATE TABLE IF NOT EXISTS ledger (
 id INTEGER PRIMARY KEY AUTOINCREMENT, rep_id INTEGER NOT NULL REFERENCES representatives(id),
 amount INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('create','renewal','payment','adjustment')),
 source_id INTEGER, description TEXT NOT NULL, actor TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(kind, source_id));
CREATE INDEX IF NOT EXISTS idx_ledger_rep ON ledger(rep_id,id DESC);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL,
 subject TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (telegram_id TEXT PRIMARY KEY, state TEXT NOT NULL,
 payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT OR IGNORE INTO bank(id,card,iban,holder) VALUES(1,'','','');
`);
    // Additive migrations for installations already carrying a database.
    const cols = this.all('PRAGMA table_info(representatives)').map(x=>x.name);
    if(!cols.includes('debt_alert')) this.db.exec('ALTER TABLE representatives ADD COLUMN debt_alert INTEGER NOT NULL DEFAULT 0');
    if(!cols.includes('alerted')) this.db.exec('ALTER TABLE representatives ADD COLUMN alerted INTEGER NOT NULL DEFAULT 0');
    if(!cols.includes('price_per_gb_month')) this.db.exec('ALTER TABLE representatives ADD COLUMN price_per_gb_month INTEGER NOT NULL DEFAULT 0');
    if(!cols.includes('min_volume_gb')) this.db.exec('ALTER TABLE representatives ADD COLUMN min_volume_gb INTEGER NOT NULL DEFAULT 1 CHECK(min_volume_gb BETWEEN 1 AND 10000)');
    if(!cols.includes('max_volume_gb')) this.db.exec('ALTER TABLE representatives ADD COLUMN max_volume_gb INTEGER NOT NULL DEFAULT 10000 CHECK(max_volume_gb BETWEEN 1 AND 10000)');
    const renewalCols=this.all('PRAGMA table_info(renewals)').map(x=>x.name);
    if(!renewalCols.includes('new_total'))this.db.exec('ALTER TABLE renewals ADD COLUMN new_total INTEGER');
    if(!renewalCols.includes('old_used'))this.db.exec('ALTER TABLE renewals ADD COLUMN old_used INTEGER');
    if(!renewalCols.includes('save_account'))this.db.exec('ALTER TABLE renewals ADD COLUMN save_account INTEGER NOT NULL DEFAULT 1');
    // Legacy plan rows and historical foreign keys are preserved. New operations use this
    // internal reference only, with their actual volume/months/price recorded per sale.
    this.db.exec("INSERT OR IGNORE INTO plans(id,name,months,volume_gb,base_price,active) VALUES(999997,'سفارش حجمی دلخواه (سیستمی)',1,20,0,0)");
    this.db.exec(`CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rep_id INTEGER NOT NULL REFERENCES representatives(id), actor TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('admin_to_rep','rep_to_admin')),
      body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS idx_conversations_rep ON conversations(rep_id,id DESC);`);
  }
  // Creation is journaled *before* calling the remote API, to prevent silent double billing.
  // A doubtful remote response leaves the operation in review for an owner to reconcile.
  run(sql,...args) {return this.db.prepare(sql).run(...args);}
  one(sql,...args) {return this.db.prepare(sql).get(...args);}
  all(sql,...args) {return this.db.prepare(sql).all(...args);}
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {const out=fn();this.db.exec('COMMIT');return out;}
    catch(e) {this.db.exec('ROLLBACK');throw e;}
  }
  close() {this.db.close();}
  now(){return Date.now();}
  repByTg(id) {return this.one('SELECT * FROM representatives WHERE telegram_id=?',String(id));}
  rep(id) {return this.one('SELECT * FROM representatives WHERE id=?',Number(id));}
  reps(){return this.all(`SELECT r.*,(SELECT COALESCE(SUM(l.amount),0) FROM ledger l WHERE l.rep_id=r.id) balance FROM representatives r ORDER BY id DESC`);}
  createRep(tg,name,actor){
    return this.tx(()=>{
      const out=this.run('INSERT INTO representatives(telegram_id,name,created_at) VALUES (?,?,?)',String(tg),name,this.now());
      this.log(actor,'rep.create',String(out.lastInsertRowid),name);
      return Number(out.lastInsertRowid);
    });
  }
  updateRep(id,field,value,actor){
    if(!['active','name'].includes(field))throw new Error('فیلد نماینده نامعتبر است.');
    return this.tx(()=>{
      const out=this.run(`UPDATE representatives SET ${field}=? WHERE id=?`,value,id);
      if(!out.changes)throw new Error('نماینده وجود ندارد.');
      this.log(actor,'rep.update',String(id),`${field} changed`); return out.changes;
    });
  }
  setGigRate(repId,amount,actor){return this.tx(()=>{
    if(!this.rep(repId))throw new Error('نماینده وجود ندارد.');
    if(!Number.isSafeInteger(amount)||amount<0||amount>100000000)throw new Error('نرخ هر گیگ ماهانه نامعتبر است.');
    this.run('UPDATE representatives SET price_per_gb_month=? WHERE id=?',amount,repId);
    this.log(actor,'rep.gig_rate',String(repId),`rate=${amount}`);
  });}
  setVolumeLimit(repId,field,volumeGb,actor){
    if(!['min_volume_gb','max_volume_gb'].includes(field))throw new Error('نوع محدودیت حجمی نامعتبر است.');
    if(!Number.isSafeInteger(volumeGb)||volumeGb<1||volumeGb>10000)throw new Error('محدوده مجاز ۱ تا ۱۰۰۰۰ گیگابایت است.');
    return this.tx(()=>{
      const rep=this.rep(repId);
      if(!rep)throw new Error('نماینده وجود ندارد.');
      const nextMin=field==='min_volume_gb'?volumeGb:Number(rep.min_volume_gb);
      const nextMax=field==='max_volume_gb'?volumeGb:Number(rep.max_volume_gb);
      if(nextMin>nextMax)throw new Error('حداقل حجم نباید از حداکثر حجم بیشتر باشد.');
      this.run(`UPDATE representatives SET ${field}=? WHERE id=?`,volumeGb,repId);
      this.log(actor,'rep.volume_limit',String(repId),`${field}=${volumeGb}`);
    });
  }
  volumeBounds(repId){
    const rep=this.rep(repId);
    if(!rep)throw new Error('نماینده پیدا نشد.');
    return {min:Number(rep.min_volume_gb),max:Number(rep.max_volume_gb)};
  }
  assertVolumeAllowed(repId,volumeGb){
    const {min,max}=this.volumeBounds(repId);
    if(!Number.isSafeInteger(volumeGb)||volumeGb<min||volumeGb>max)
      throw new Error(`حجم مجاز برای این نماینده بین ${min} تا ${max} گیگابایت است.`);
  }
  customPrice(repId,volumeGb,months){
    const rep=this.rep(repId);
    if(!rep?.active)throw new Error('نماینده فعال نیست.');
    this.assertVolumeAllowed(repId,volumeGb);
    if(months!==1)throw new Error('تمامی اشتراک‌ها فقط یک‌ماهه هستند.');
    const rate=Number(rep.price_per_gb_month);
    if(!Number.isSafeInteger(rate)||rate<=0)throw new Error('مدیر نرخ هر گیگابایت ماهانه را برای نماینده تعریف نکرده است.');
    const price=rate*volumeGb*months;
    if(!Number.isSafeInteger(price))throw new Error('مبلغ محاسبه‌شده خارج از محدوده است.');
    return price;
  }
  sales(repId=null,startMs=0,endMs=Date.now(),limit=10,offset=0){
    const filter=repId===null?'':'AND rep_id=?';
    const a=repId===null?[startMs,endMs]:[startMs,endMs,repId];
    const c=this.one(`SELECT COUNT(*) count, COALESCE(SUM(price),0) amount, COALESCE(SUM(CASE WHEN kind='create' THEN 1 ELSE 0 END),0) created, COALESCE(SUM(CASE WHEN kind='renew' THEN 1 ELSE 0 END),0) renewed FROM (
      SELECT 'create' kind,price FROM creations WHERE status='applied' AND completed_at>=? AND completed_at<? ${filter}
      UNION ALL SELECT 'renew' kind,price FROM renewals WHERE status='applied' AND completed_at>=? AND completed_at<? ${filter}
    )`,...a,...a);
    const records=this.all(`SELECT o.*,r.name rep_name FROM (
      SELECT 'create' kind,id,rep_id,email,volume_gb,months,price,completed_at FROM creations WHERE status='applied' AND completed_at>=? AND completed_at<? ${filter}
      UNION ALL SELECT 'renew' kind,id,rep_id,email,volume_gb,months,price,completed_at FROM renewals WHERE status='applied' AND completed_at>=? AND completed_at<? ${filter}
    ) o JOIN representatives r ON r.id=o.rep_id ORDER BY completed_at DESC,id DESC LIMIT ? OFFSET ?`,...a,...a,limit,offset);
    return {summary:c,records};
  }
  plans(active=false){return this.all(`SELECT * FROM plans ${active?'WHERE active=1':''} ORDER BY months,volume_gb,id`);}
  plan(id){return this.one('SELECT * FROM plans WHERE id=?',Number(id));}
  addPlan(name,months,volumeGb,price,actor){return this.tx(()=>{
    const res=this.run('INSERT INTO plans(name,months,volume_gb,base_price) VALUES (?,?,?,?)',name,months,volumeGb,price);
    this.log(actor,'plan.create',String(res.lastInsertRowid),name);
    return Number(res.lastInsertRowid);
  });}
  changePlan(id,field,value,actor){
    if(!['name','months','volume_gb','base_price','active'].includes(field))throw new Error('فیلد تعرفه نامعتبر است.');
    return this.tx(()=>{
      const out=this.run(`UPDATE plans SET ${field}=? WHERE id=?`,value,id);
      if(!out.changes)throw new Error('پلن وجود ندارد.');
      this.log(actor,'plan.update',String(id),`${field} changed`);
    });
  }
  setPrice(repId,planId,amount,actor){return this.tx(()=>{
    if(!this.rep(repId)||!this.plan(planId)) throw new Error('نماینده یا پلن پیدا نشد.');
    this.run(`INSERT INTO prices(rep_id,plan_id,amount) VALUES(?,?,?) ON CONFLICT(rep_id,plan_id) DO UPDATE SET amount=excluded.amount`,repId,planId,amount);
    this.log(actor,'rate.set',`${repId}/${planId}`,String(amount));
  });}
  price(repId,planId){return this.one('SELECT COALESCE(p.amount,pl.base_price) amount,pl.name,pl.months,pl.volume_gb,pl.active FROM plans pl LEFT JOIN prices p ON p.plan_id=pl.id AND p.rep_id=? WHERE pl.id=?',repId,planId);}
  bank(){return this.one('SELECT * FROM bank WHERE id=1');}
  setBank(field,value,actor){
    if(!['card','iban','holder'].includes(field))throw new Error('فیلد بانکی نامعتبر است.');
    this.tx(()=>{this.run(`UPDATE bank SET ${field}=? WHERE id=1`,value);this.log(actor,'bank.update',field,field==='holder'?value:'redacted');});
  }
  owner(email) {return this.one('SELECT rowid,* FROM client_owners WHERE email=?',email);}
  accountById(rowid){return this.one('SELECT rowid,* FROM client_owners WHERE rowid=?',rowid);}
  claim(email,repId,actor){return this.tx(()=>{
    const current=this.owner(email);
    if(current){
      if(current.rep_id!==repId)throw new Error('این حساب قبلاً به نماینده دیگری اختصاص یافته است؛ فقط مدیر امکان انتقال آن را دارد.');
      return false;
    }
    if(!this.rep(repId)?.active)throw new Error('نماینده غیرفعال یا نامعتبر است.');
    if(this.one("SELECT id FROM renewals WHERE email=? AND status IN ('pending','review')",email)) throw new Error('عملیات تمدید باز روی این حساب وجود دارد.');
    this.run('INSERT INTO client_owners(email,rep_id,updated_at) VALUES (?,?,?)',email,repId,this.now());
    this.log(actor,'client.claim',email,`rep=${repId}`);
    return true;
  });}
  unclaim(email,repId,actor){return this.tx(()=>{
    const existing=this.owner(email);
    if(!existing || existing.rep_id!==repId)throw new Error('این حساب در فهرست شما نیست.');
    if(this.one("SELECT id FROM renewals WHERE email=? AND status IN ('pending','review')",email))throw new Error('برای این حساب تمدید معلق وجود دارد.');
    this.run('DELETE FROM client_owners WHERE email=? AND rep_id=?',email,repId);
    this.log(actor,'client.unpin',email,`rep=${repId}`);
  });}
  transfer(email,repId,actor){return this.tx(()=>{
    if(!this.rep(repId))throw new Error('نماینده پیدا نشد.');
    if(this.one("SELECT id FROM renewals WHERE email=? AND status IN ('pending','review')",email)) throw new Error('ابتدا تمدید معلق را تعیین تکلیف کنید.');
    this.run('INSERT INTO client_owners(email,rep_id,updated_at) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET rep_id=excluded.rep_id,updated_at=excluded.updated_at',email,repId,this.now());
    this.log(actor,'client.transfer',email,`rep=${repId}`);
  });}
  session(tg){const s=this.one('SELECT * FROM sessions WHERE telegram_id=?',String(tg));
    if(!s || this.now()-s.updated_at > 20*60*1000)return null;
    return {state:s.state,payload:JSON.parse(s.payload)};
  }
  setSession(tg,state,payload={}){this.run('INSERT INTO sessions(telegram_id,state,payload,updated_at) VALUES (?,?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET state=excluded.state,payload=excluded.payload,updated_at=excluded.updated_at',String(tg),state,JSON.stringify(payload),this.now());}
  clearSession(tg){this.run('DELETE FROM sessions WHERE telegram_id=?',String(tg));}
  log(actor,action,subject='',detail=''){this.run('INSERT INTO events(actor,action,subject,detail,created_at) VALUES(?,?,?,?,?)',String(actor),action,String(subject).slice(0,160),String(detail).slice(0,400),this.now());}
  logs(limit=20,offset=0){return this.all('SELECT * FROM events ORDER BY id DESC LIMIT ? OFFSET ?',limit,offset);}
  balance(repId){return Number(this.one('SELECT COALESCE(SUM(amount),0) val FROM ledger WHERE rep_id=?',repId)?.val || 0);}
  history(repId,limit=20){return this.all('SELECT * FROM renewals WHERE rep_id=? ORDER BY id DESC LIMIT ?',repId,limit);}
  ledger(repId,limit=20){return this.all('SELECT * FROM ledger WHERE rep_id=? ORDER BY id DESC LIMIT ?',repId,limit);}
  allRenewals(limit=20){return this.all('SELECT n.*,r.name rep_name FROM renewals n JOIN representatives r ON r.id=n.rep_id ORDER BY n.id DESC LIMIT ?',limit);}
  operations(repId,limit=15,offset=0){return this.all(`
    SELECT * FROM (
      SELECT 'create' kind,id,email,months,volume_gb,price,status,created_at FROM creations WHERE rep_id=?
      UNION ALL
      SELECT 'renew' kind,id,email,months,volume_gb,price,status,created_at FROM renewals WHERE rep_id=?
    ) ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,repId,repId,limit,offset);}
  operationsCount(repId){return this.one(`SELECT ((SELECT COUNT(*) FROM creations WHERE rep_id=?)+(SELECT COUNT(*) FROM renewals WHERE rep_id=?)) n`,repId,repId)?.n||0;}
  operationsAll(limit=15,offset=0){return this.all(`
    SELECT o.*,r.name rep_name FROM (
      SELECT 'create' kind,id,rep_id,email,months,volume_gb,price,status,created_at FROM creations
      UNION ALL
      SELECT 'renew' kind,id,rep_id,email,months,volume_gb,price,status,created_at FROM renewals
    ) o JOIN representatives r ON o.rep_id=r.id ORDER BY o.created_at DESC,o.id DESC LIMIT ? OFFSET ?`,limit,offset);}
  operationsAllCount(){return this.one('SELECT (SELECT COUNT(*) FROM creations)+(SELECT COUNT(*) FROM renewals) n')?.n||0;}
  pendingOps(){return this.all("SELECT * FROM renewals WHERE status IN ('pending','review') ORDER BY id");}
  beginRenewal({repId,email,planId,months,volumeGb,oldTotal,newTotal=null,oldUsed=null,price,oldExpiry,newExpiry,actor,authorizedUnowned=false}){
    return this.tx(()=>{
      const owner=this.owner(email);
      if(owner && owner.rep_id!==repId)throw new Error('این حساب متعلق به نماینده دیگری است.');
      if(!owner && !authorizedUnowned)throw new Error('برای تمدید حساب خارج از فهرست، لینک معتبر ارسال کنید.');
      if(!this.rep(repId)?.active)throw new Error('نمایندگی غیرفعال است.');
      const saveAccount=owner?1:0;
      const result=this.run(`INSERT INTO renewals(rep_id,email,plan_id,months,volume_gb,old_total,new_total,old_used,price,old_expiry,new_expiry,status,created_at,save_account) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,repId,email,planId,months,volumeGb,oldTotal,newTotal,oldUsed,price,oldExpiry,newExpiry,this.now(),saveAccount);
      this.log(actor,'renewal.begin',String(result.lastInsertRowid),email);
      return Number(result.lastInsertRowid);
    });
  }
  renewal(id){return this.one('SELECT * FROM renewals WHERE id=?',id);}
  completeRenewal(id,actor){return this.tx(()=>{
    const n=this.renewal(id);
    if(!n||!['pending','review'].includes(n.status))throw new Error('تمدید آماده ثبت نیست.');
    const owner=this.owner(n.email);
    if(owner && owner.rep_id!==n.rep_id)throw new Error('مالک حساب در این فاصله تغییر کرده است.');
    const changed=this.run("UPDATE renewals SET status='applied',completed_at=?,error=NULL WHERE id=? AND status IN ('pending','review')",this.now(),id);
    if(!changed.changes)throw new Error('این تمدید قبلاً ثبت شده است.');
    if(n.save_account)this.run('INSERT OR IGNORE INTO client_owners(email,rep_id,updated_at) VALUES(?,?,?)',n.email,n.rep_id,this.now());
    this.run("INSERT INTO ledger(rep_id,amount,kind,source_id,description,actor,created_at) VALUES(?,?,'renewal',?,?,?,?)",n.rep_id,n.price,id,`تمدید ${n.email} / ${n.months} ماه / ${n.volume_gb} گیگ`,String(actor),this.now());
    this.log(actor,'renewal.applied',String(id),`${n.email}; amount=${n.price}`);
    return n;
  });}
  markRenewal(id,status,error='',actor='system'){
    if(!['failed','review'].includes(status))throw new Error('وضعیت نامعتبر');
    this.tx(()=>{
      const changed=this.run("UPDATE renewals SET status=?,error=?,completed_at=? WHERE id=? AND status IN ('pending','review')",status,String(error).slice(0,650),this.now(),id);
      if(changed.changes)this.log(actor,`renewal.${status}`,String(id),String(error).slice(0,120));
    });
  }
  markReset(id,status){this.run('UPDATE renewals SET reset_state=? WHERE id=?',status,id);}
  allowedInbounds(){return this.all('SELECT * FROM allowed_inbounds WHERE enabled=1 ORDER BY id');}
  allInbounds(){return this.all('SELECT * FROM allowed_inbounds ORDER BY id');}
  toggleInbound(id,actor){return this.tx(()=>{
    if(!Number.isInteger(id)||id<=0)throw new Error('اینباند نامعتبر است.');
    const old=this.one('SELECT * FROM allowed_inbounds WHERE id=?',id);
    this.run('INSERT INTO allowed_inbounds(id,enabled) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled',id,old?.enabled?0:1);
    this.log(actor,'inbound.toggle',id,old?.enabled?'disabled':'enabled');
  });}
  accounts(repId,limit=25,offset=0){return this.all('SELECT rowid,* FROM client_owners WHERE rep_id=? ORDER BY updated_at DESC,email LIMIT ? OFFSET ?',repId,limit,offset);}
  searchAccounts(repId,term,limit=25){
    const t=String(term||'').trim();
    if(t.length<2||t.length>80)throw new Error('عبارت جست‌وجو باید ۲ تا ۸۰ کاراکتر باشد.');
    const like='%'+t.replace(/[\%_]/g,'\$&')+'%';
    return this.all("SELECT rowid,* FROM client_owners WHERE rep_id=? AND email LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?",repId,like,limit);
  }
  accountsCount(repId){return this.one('SELECT COUNT(*) n FROM client_owners WHERE rep_id=?',repId)?.n||0;}
  creation(id){return this.one('SELECT * FROM creations WHERE id=?',id);}
  pendingCreations(){return this.all("SELECT * FROM creations WHERE status IN ('pending','review') ORDER BY id LIMIT 30");}
  creations(repId,limit=20){return this.all('SELECT * FROM creations WHERE rep_id=? ORDER BY id DESC LIMIT ?',repId,limit);}
  allCreations(limit=20){return this.all('SELECT c.*,r.name rep_name FROM creations c JOIN representatives r ON c.rep_id=r.id ORDER BY c.id DESC LIMIT ?',limit);}
  beginCreation({repId,email,planId,months,volumeGb,price,inboundId,expiryTime,subId,actor}){
    return this.tx(()=>{
      if(this.owner(email))throw new Error('این حساب قبلا مالک دارد.');
      if(!this.one('SELECT id FROM allowed_inbounds WHERE id=? AND enabled=1',inboundId))throw new Error('اینباند مجاز نیست.');
      const result=this.run("INSERT INTO creations(rep_id,email,plan_id,months,volume_gb,price,inbound_id,expiry_time,sub_id,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',?)",repId,email,planId,months,volumeGb,price,inboundId,expiryTime,subId,this.now());
      this.log(actor,'create.begin',String(result.lastInsertRowid),email);
      return Number(result.lastInsertRowid);
    });
  }
  completeCreation(id,actor){return this.tx(()=>{
    const c=this.creation(id);
    if(!c||!['pending','review'].includes(c.status))throw new Error('عملیات ایجاد قابل تأیید نیست.');
    if(this.owner(c.email))throw new Error('برای این حساب مالک ثبت شده است.');
    const out=this.run("UPDATE creations SET status='applied',completed_at=?,error=NULL WHERE id=? AND status IN ('pending','review')",this.now(),id);
    if(!out.changes)throw new Error('قبلا ثبت شده است.');
    this.run('INSERT INTO client_owners(email,rep_id,updated_at) VALUES (?,?,?)',c.email,c.rep_id,this.now());
    this.run("INSERT INTO ledger(rep_id,amount,kind,source_id,description,actor,created_at) VALUES(?,?,'create',?,?,?,?)",c.rep_id,c.price,c.id,`ایجاد ${c.email} / ${c.months} ماه / ${c.volume_gb} گیگ`,String(actor),this.now());
    this.log(actor,'create.applied',id,`${c.email}; amount=${c.price}`);
    return c;
  });}
  markCreation(id,status,error='',actor='system'){
    if(!['failed','review'].includes(status))throw new Error('وضعیت نامعتبر');
    this.tx(()=>{const out=this.run("UPDATE creations SET status=?,error=?,completed_at=? WHERE id=? AND status IN ('pending','review')",status,String(error).slice(0,650),this.now(),id);
      if(out.changes)this.log(actor,`create.${status}`,id,String(error).slice(0,100));});
  }
  createPayment(repId,amount,reference,receipt,actor){return this.tx(()=>{
    const out=this.run('INSERT INTO payments(rep_id,amount,reference,receipt_file,created_at) VALUES(?,?,?,?,?)',repId,amount,reference,receipt,this.now());
    this.log(actor,'payment.submit',String(out.lastInsertRowid),`amount=${amount}`);
    return Number(out.lastInsertRowid);
  });}
  payment(id){return this.one('SELECT * FROM payments WHERE id=?',id);}
  payments(repId,limit=20,offset=0){return this.all('SELECT * FROM payments WHERE rep_id=? ORDER BY id DESC LIMIT ? OFFSET ?',repId,limit,offset);}
  paymentsCount(repId){return this.one('SELECT COUNT(*) n FROM payments WHERE rep_id=?',repId)?.n||0;}
  pendingPayments(){return this.all(`SELECT p.*,r.name rep_name FROM payments p JOIN representatives r ON r.id=p.rep_id WHERE p.state='pending' ORDER BY p.id LIMIT 30`);}
  allPayments(limit=20,offset=0){return this.all('SELECT p.*,r.name rep_name FROM payments p JOIN representatives r ON r.id=p.rep_id ORDER BY p.id DESC LIMIT ? OFFSET ?',limit,offset);}
  allPaymentsCount(){return this.one('SELECT COUNT(*) n FROM payments')?.n||0;}
  settlePayment(id,accept,actor){return this.tx(()=>{
    const p=this.payment(id);
    if(!p || p.state!=='pending')throw new Error('این واریزی قبلاً بررسی شده یا وجود ندارد.');
    const state=accept?'approved':'rejected';
    this.run('UPDATE payments SET state=?,reviewed_at=?,reviewed_by=? WHERE id=?',state,this.now(),String(actor),id);
    if(accept)this.run("INSERT INTO ledger(rep_id,amount,kind,source_id,description,actor,created_at) VALUES(?,?,'payment',?,?,?,?)",p.rep_id,-p.amount,id,`واریزی تاییدشده #${id}`,String(actor),this.now());
    this.log(actor,accept?'payment.approve':'payment.reject',String(id),`amount=${p.amount}`);
    return p;
  });}
  adjustment(repId,amount,reason,actor){return this.tx(()=>{
    if(!this.rep(repId))throw new Error('نماینده وجود ندارد.');
    this.run("INSERT INTO ledger(rep_id,amount,kind,source_id,description,actor,created_at) VALUES(?,?,'adjustment',NULL,?, ?,?)",repId,amount,reason,actor,this.now());
    this.log(actor,'ledger.adjust',String(repId),`${amount}; ${reason}`);
  });}
  setDebtAlert(repId,amount,actor){return this.tx(()=>{
    if(!Number.isSafeInteger(amount)||amount<0)throw new Error('حد هشدار باید عدد غیرمنفی باشد.');
    const before=this.rep(repId);if(!before)throw new Error('نماینده وجود ندارد.');
    this.run('UPDATE representatives SET debt_alert=?,alerted=0 WHERE id=?',amount,repId);
    this.log(actor,'debt.threshold',repId,`new=${amount}`);
  });}
  // Returns true only once per threshold breach. Reset when balance falls below it.
  debtAlertTrigger(repId){return this.tx(()=>{
    const rep=this.rep(repId);if(!rep)return false;
    const balance=this.balance(repId);
    if(!rep.debt_alert||balance<rep.debt_alert){
      if(rep.alerted)this.run('UPDATE representatives SET alerted=0 WHERE id=?',repId);
      return false;
    }
    if(rep.alerted)return false;
    this.run('UPDATE representatives SET alerted=1 WHERE id=?',repId);
    this.log('system','debt.alert',repId,`threshold=${rep.debt_alert}; balance=${balance}`);
    return true;
  });}
  addMessage(repId,actor,direction,body){return this.tx(()=>{
    if(!this.rep(repId))throw new Error('نماینده پیدا نشد.');
    if(!['admin_to_rep','rep_to_admin'].includes(direction))throw new Error('نوع مکاتبه نامعتبر است.');
    const result=this.run("INSERT INTO conversations(rep_id,actor,direction,body,status,created_at) VALUES(?,?,?,?,'pending',?)",repId,String(actor),direction,body,this.now());
    this.log(actor,'chat.'+direction,repId,`message #${result.lastInsertRowid}`);
    return Number(result.lastInsertRowid);
  });}
  setMessageStatus(id,status){if(!['delivered','failed'].includes(status))throw new Error('وضعیت نامعتبر.');this.run('UPDATE conversations SET status=? WHERE id=?',status,id);}
  messages(repId,limit=15,offset=0){return this.all('SELECT * FROM (SELECT * FROM conversations WHERE rep_id=? ORDER BY id DESC LIMIT ? OFFSET ?) ORDER BY id',repId,limit,offset);}
  recentMessages(limit=20){return this.all(`SELECT c.*,r.name rep_name FROM conversations c JOIN representatives r ON r.id=c.rep_id ORDER BY c.id DESC LIMIT ?`,limit);}
  meta(key){return this.one('SELECT value FROM meta WHERE key=?',key)?.value;}
  setMeta(key,value){this.run('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,String(value));}
}

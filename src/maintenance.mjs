import {DatabaseSync,backup as sqliteBackup} from 'node:sqlite';
import {mkdir,readFile,copyFile,rename,unlink,stat,chmod} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,dirname,resolve,basename} from 'node:path';
import {randomBytes} from 'node:crypto';

const IMPORTANT_TABLES=['representatives','client_owners','ledger','renewals','creations','payments','events','sessions','meta'];
export const MAX_UPLOAD_BYTES=18*1024*1024;
export function backupFolder(dbPath){return join(dirname(resolve(dbPath)),'backups');}
export async function validateBackup(path){
  const info=await stat(path);
  if(!info.isFile() || info.size<1024 || info.size>MAX_UPLOAD_BYTES)throw new Error('فایل پشتیبان باید SQLite معتبر و حداکثر ۱۸ مگابایت باشد.');
  const header=(await readFile(path)).subarray(0,16).toString('ascii');
  if(header!=='SQLite format 3\0')throw new Error('فایل ارسال‌شده دیتابیس SQLite نیست.');
  const db=new DatabaseSync(path,{readOnly:true});
  try {
    db.exec('PRAGMA trusted_schema=OFF;');
    if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')throw new Error('بررسی سلامت SQLite ناموفق بود.');
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('فایل پشتیبان روابط دیتابیس ناسازگار دارد.');
    const objects=db.prepare("SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
    if(objects.some(o=>!['table','index'].includes(o.type)))throw new Error('فایل پشتیبان حاوی ساختار غیرمجاز است.');
    const tables=new Set(objects.filter(o=>o.type==='table').map(o=>o.name));
    if(IMPORTANT_TABLES.some(t=>!tables.has(t)))throw new Error('فایل پشتیبان ساختار سامانه نمایندگان را ندارد.');
    return {size:info.size,representatives:db.prepare('SELECT count(*) AS n FROM representatives').get().n,operations:db.prepare('SELECT count(*) AS n FROM renewals').get().n};
  }finally{db.close();}
}
export async function createBackup(store){
  if(!store?.db)throw new Error('دیتابیس آماده نیست.');
  const dir=backupFolder(store.dbPath);
  await mkdir(dir,{recursive:true,mode:0o700});
  const name='bot-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(3).toString('hex')+'.sqlite';
  const target=join(dir,name);
  try {
    await sqliteBackup(store.db,target);
    await chmod(target,0o600);
    await validateBackup(target);
    return target;
  }catch(e){await unlink(target).catch(()=>{});throw e;}
}
export async function performRestore(store,stagedPath,lastUpdateId=0){
  await validateBackup(stagedPath);
  const dbPath=resolve(store.dbPath);
  // Protect previous state with an online, verified snapshot before overwriting any bytes.
  const recovery=await createBackup(store);
  // SQLite close checkpoints WAL and releases handles. This service must be the only writer.
  store.db.close();
  const temp=dbPath+'.restoring-'+randomBytes(5).toString('hex');
  try {
    await copyFile(stagedPath,temp);
    // Database is offline: preserve update offset so restore confirmation isn't replayed.
    const target=new DatabaseSync(temp);
    try{
      target.exec('PRAGMA trusted_schema=OFF; PRAGMA journal_mode=DELETE;');
      target.prepare("INSERT INTO meta(key,value) VALUES('last_update',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(String(lastUpdateId));
      target.exec('DELETE FROM sessions;');
    }finally{target.close();}
    await chmod(temp,0o600);
    await rename(temp,dbPath);
    for(const suffix of ['-wal','-shm']) if(existsSync(dbPath+suffix))await unlink(dbPath+suffix);
    return {recovery};
  }catch(e){await unlink(temp).catch(()=>{});throw e;}
}
export function safeBackupName(filename){
  const name=basename(String(filename||''));
  if(!/^bot-[\w-]+\.sqlite$/.test(name))throw new Error('نام فایل بکاپ نامعتبر است.');
  return name;
}

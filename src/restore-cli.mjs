import {resolve,relative} from 'node:path';
import {loadConfig} from './config.mjs';
import {Store} from './store.mjs';
import {backupFolder,performRestore,validateBackup} from './maintenance.mjs';
const cfg=loadConfig();
const file=process.argv[2];
if(!file)throw new Error('Usage: node src/restore-cli.mjs /app/data/backups/bot-....sqlite');
const safe=resolve(file),dir=resolve(backupFolder(cfg.dbPath));
if(relative(dir,safe).startsWith('..'))throw new Error('فقط بکاپ‌های داخل پوشه backups مجاز هستند.');
console.log('Validating:',await validateBackup(safe));
// Never run simultaneously with the main bot. Stop it first using docker compose stop bot.
const db=new Store(cfg.dbPath);
try{console.log('Restored. Previous database saved at:',(await performRestore(db,safe,Number(db.meta('last_update')||0))).recovery);}
catch(e){try{db.close();}catch{};throw e;}

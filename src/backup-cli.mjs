import {loadConfig} from './config.mjs';
import {Store} from './store.mjs';
import {createBackup} from './maintenance.mjs';
const cfg=loadConfig();
const db=new Store(cfg.dbPath);
try{console.log('Backup:',await createBackup(db));}
finally{db.close();}

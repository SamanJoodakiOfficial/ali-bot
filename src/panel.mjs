import { extractIdentity,matchesIdentity,getClientFromResult,updatePayload,nextExpiry,addMonths,renewByMonths,quotaAddition } from './resolve.mjs';
export class PanelError extends Error {constructor(message,status=0){super(message);this.status=status;}}
export class PanelApi {
  constructor({baseUrl,token,fetchImpl=fetch,timeoutMs=20000}){
    this.baseUrl=baseUrl;this.token=token;this.fetchImpl=fetchImpl;this.timeoutMs=timeoutMs;
  }
  async request(path,body=null,query=null){
    const url=new URL(path.replace(/^\/+/,''),this.baseUrl);
    if(query)for(const [k,v] of Object.entries(query))url.searchParams.set(k,String(v));
    let response;
    try{response=await this.fetchImpl(url,{method:body===null?'GET':'POST',
      headers:{Authorization:`Bearer ${this.token}`,Accept:'application/json',...(body===null?{}:{'Content-Type':'application/json'})},
      ...(body===null?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(this.timeoutMs)});
    }catch(e){throw new PanelError(e?.name==='TimeoutError'?'زمان اتصال به پنل پایان یافت.':'اتصال به پنل برقرار نشد.');}
    if(!response.ok)throw new PanelError(`پنل HTTP ${response.status} برگرداند. مسیر پایه و نسخه API را بررسی کنید.`,response.status);
    let obj;
    try {obj=await response.json();}catch{throw new PanelError('پاسخ پنل JSON نیست؛ مسیر پایه را اصلاح کنید.');}
    if(obj?.success!==true)throw new PanelError(`پنل درخواست را رد کرد: ${String(obj?.msg||'دسترسی یا سازگاری API').replace(/https?:\/\/\S+/g,'[link]').slice(0,240)}`,response.status);
    return obj.obj;
  }
  getClient(email){return this.request(`panel/api/clients/get/${encodeURIComponent(email)}`);}
  async find(input){
    const identity=typeof input==='string'?extractIdentity(input):input;
    if(identity.kind==='email'){
      const c=getClientFromResult(await this.getClient(identity.value));
      if(!matchesIdentity(c,identity))throw new Error('این حساب در پنل پیدا نشد.');
      return c;
    }
    let candidates=[];
    if(identity.kind==='subId'){
      try{
        const found=await this.request(`panel/api/clients/get/subId/${encodeURIComponent(identity.value)}`);
        if(Array.isArray(found))candidates=found.map(getClientFromResult);
      }catch(e){if(!(e instanceof PanelError && [404,405].includes(e.status)))throw e;}
    }
    if(candidates.length===0){
      const page=await this.request('panel/api/clients/list/paged',null,{page:1,pageSize:50,search:identity.value});
      if(!Array.isArray(page?.items))throw new Error('جست‌وجوی کاربران روی این نسخه پنل پشتیبانی نمی‌شود.');
      if(page.filtered>50)throw new Error('تعداد نتایج زیاد است؛ لینک دقیق‌تری ارسال کنید.');
      // Search results are deliberately slim: verify on full client records.
      for(const item of page.items){
        if(!item.email)continue;
        const full=getClientFromResult(await this.getClient(item.email));
        candidates.push(full);
      }
    }
    const exact=[...new Map(candidates.filter(c=>matchesIdentity(c,identity)).map(c=>[c.email,c])).values()];
    if(exact.length===0)throw new Error('هیچ حساب منطبقی در پنل پیدا نشد.');
    if(exact.length>1)throw new Error('این شناسه به چند حساب مربوط است؛ برای جلوگیری از اشتباه تمدید مسدود شد.');
    return exact[0];
  }
  async onlineSnapshot(email){
    const entries=await this.request('panel/api/clients/onlines',{});
    if(!Array.isArray(entries))throw new Error('پنل وضعیت آنلاین را برنگرداند.');
    return entries.some(x=>String(x).toLowerCase()===String(email).toLowerCase());
  }
  async ipUsage(email,windowMs=10*60*1000,now=Date.now()){
    const grouped=await this.request('panel/api/clients/clientIpsByGuid',{});
    if(!grouped || typeof grouped!=='object' || Array.isArray(grouped))throw new Error('آمار IP در این نسخه پنل در دسترس نیست.');
    const recent=new Set(),all=new Set();
    for(const node of Object.values(grouped)){
      if(!node||typeof node!=='object')continue;
      for(const [name,rows] of Object.entries(node)){
        if(name.toLowerCase()!==String(email).toLowerCase()||!Array.isArray(rows))continue;
        for(const row of rows){
          if(!row || typeof row.ip!=='string' || !row.ip)continue;
          all.add(row.ip);
          let stamp=Number(row.timestamp||0);
          if(stamp>0 && stamp<1e12)stamp*=1000;
          if(stamp>0 && stamp<=now+60000 && stamp>=now-windowMs)recent.add(row.ip);
        }
      }
    }
    return {recent:recent.size,observed:all.size,windowMinutes:Math.round(windowMs/60000)};
  }
  async registeredDeviceCount(email){
    const rows=await this.request(`panel/api/clients/hwids/${encodeURIComponent(email)}`,{});
    if(!Array.isArray(rows))throw new Error('فهرست HWID در این پنل پشتیبانی نمی‌شود.');
    return rows.length;
  }
  async lastSeen(email){
    const data=await this.request('panel/api/clients/lastOnline',{});
    if(!data || typeof data!=='object')return null;
    const stamp=Number(data[email]||0);
    if(!Number.isSafeInteger(stamp)||stamp<=0)return null;
    return stamp<1e12?stamp*1000:stamp;
  }
  async traffic(email){
    const row=await this.request(`panel/api/clients/traffic/${encodeURIComponent(email)}`);
    if(!row || !Number.isSafeInteger(Number(row.up)) || !Number.isSafeInteger(Number(row.down)) || Number(row.up)<0 || Number(row.down)<0)
      throw new Error('آمار مصرف این حساب در پنل قابل اتکا نیست؛ تمدید خودکار متوقف شد.');
    return {up:Number(row.up),down:Number(row.down),used:Number(row.up)+Number(row.down)};
  }
  async changeExpiry(email,expectedOld,newExpiry,newTotal=null){
    const fresh=getClientFromResult(await this.getClient(email));
    if(Number(fresh.expiryTime)!==expectedOld)throw new Error('تاریخ انقضا نسبت به زمان پیش‌نمایش تغییر کرده است. دوباره بررسی کنید.');
    const body=updatePayload(fresh,newExpiry);
    if(newTotal!==null)body.totalGB=newTotal;
    await this.request(`panel/api/clients/update/${encodeURIComponent(email)}`,body);
  }
  async expiry(email){return Number(getClientFromResult(await this.getClient(email)).expiryTime);}
  async details(email){
    const raw=await this.getClient(email);const client=getClientFromResult(raw);
    return {...client,inboundIds:raw?.inboundIds||client.inboundIds||[]};
  }
  async createClient({email,inboundId,volumeGb,expiryTime,subId,repId}){
    const body={client:{email,subId,totalGB:volumeGb*1073741824,expiryTime,enable:true,tgId:0,limitIp:0,limitHwid:0,comment:`Telegram reseller #${repId}`,reset:0,resetDay:0,resetWeekday:0},inboundIds:[inboundId]};
    await this.request('panel/api/clients/add',body);
  }
  async listInbounds(){const data=await this.request('panel/api/inbounds/list');
    if(!Array.isArray(data))throw new Error('پنل فهرست اینباند را به‌صورت آرایه برنگرداند.');return data;}
  async toggleClient(email,expected){
    const current=await this.details(email);
    if(Boolean(current.enable)!==expected)throw new Error('وضعیت از زمان نمایش تغییر کرده است.');
    const payload=updatePayload(current,Number(current.expiryTime));payload.enable=!expected;
    await this.request(`panel/api/clients/update/${encodeURIComponent(email)}`,payload);
  }
  async links(email){
    const out=await this.request(`panel/api/clients/links/${encodeURIComponent(email)}`);
    if(!Array.isArray(out))throw new Error('API لینک کانفیگ خروجی معتبر برنگرداند.');
    return out.filter(x=>typeof x==='string' && /^(vless|vmess|trojan|ss|hy2|hysteria2):\/\//i.test(x));
  }
  async resetTraffic(email){await this.request(`panel/api/clients/resetTraffic/${encodeURIComponent(email)}`,{});}
  async search(query){
    const result=await this.request('panel/api/clients/list/paged',null,{page:1,pageSize:100,search:query});
    if(!Array.isArray(result?.items))throw new Error('قابلیت جست‌وجو در API پنل در دسترس نیست.');
    if(result.filtered>100)throw new Error('نتایج جست‌وجو بیش از ۱۰۰ مورد است؛ ساخت حساب متوقف شد.');
    return result.items;
  }
  async latest(){const page=await this.request('panel/api/clients/list/paged',null,{page:1,pageSize:10,sort:'createdAt',order:'descend'});
    return page.items||[];
  }
  async validate(){return this.request('panel/api/clients/list/paged',null,{page:1,pageSize:1});}
}
export {extractIdentity,matchesIdentity,getClientFromResult,updatePayload,nextExpiry,addMonths,renewByMonths};

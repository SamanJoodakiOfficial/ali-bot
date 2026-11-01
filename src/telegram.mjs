export class TelegramApi {
  constructor({ token, baseUrl, fetchImpl = fetch }) {
    // The ./ prefix is essential: `bot123456:SECRET/` would otherwise be
    // interpreted by URL() as a custom URI scheme (bot123456:) instead of
    // a relative URL path. This caused immediate TypeError/NETWORK failures.
    this.url = new URL(`./bot${token}/`, baseUrl).toString();
    this.token=token;
    this.fetchImpl = fetchImpl;
  }
  async call(method, body = {}, timeout = 15000, signal) {
    let response;
    try {
      response = await this.fetchImpl(this.url + method, {
        method:'POST', headers: {'Content-Type':'application/json'}, body:JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
        redirect:'error'
      });
    } catch(e) {
      // Do not reveal request URLs: those contain the private bot token.
      const causeCode = [e?.cause?.code, e?.cause?.cause?.code, e?.code].find(x => typeof x === 'string' && /^[A-Z0-9_]{2,40}$/.test(x));
      const code = e?.name === 'TimeoutError' ? 'TIMEOUT'
        : e?.name === 'AbortError' ? 'ABORTED' : (causeCode || 'NETWORK');
      const error = new Error(`Telegram transport error (${String(code).slice(0,30)}, ${String(e?.name || 'Error').slice(0,35)}).`);
      error.code = String(code);
      error.isNetworkFailure = true;
      if (signal?.aborted) error.stopped = true;
      throw error;
    }
    let data;
    try { data = await response.json(); } catch { throw new Error(`Telegram response HTTP ${response.status} (not JSON)`); }
    if (!response.ok || data.ok !== true) {
      const error = new Error(`Telegram HTTP ${response.status}: ${String(data.description||'API rejected request').slice(0,150)}`);
      error.code = data.error_code || response.status; throw error;
    }
    return data.result;
  }
  async sendDocument(chatId,fileBuffer,fileName='backup.sqlite',caption='Database backup') {
    const form=new FormData();
    form.set('chat_id',String(chatId));
    form.set('caption',caption.slice(0,900));
    form.set('document',new Blob([fileBuffer],{type:'application/octet-stream'}),fileName);
    const response=await this.fetchImpl(this.url+'sendDocument',{method:'POST',body:form,signal:AbortSignal.timeout(120000)});
    const result=await response.json().catch(()=>null);
    if(!response.ok||result?.ok!==true)throw new Error('ارسال فایل بکاپ در تلگرام ناموفق بود.');
    return result.result;
  }
  async downloadDocument(fileId){
    const info=await this.call('getFile',{file_id:fileId},20000);
    if(!info?.file_path || !/^[\w./-]+$/.test(info.file_path) || info.file_path.split('/').includes('..'))throw new Error('مسیر فایل تلگرام معتبر نیست.');
    if(info.file_size>18*1024*1024)throw new Error('بکاپ حجیم است. برای بازیابی بزرگ از CLI استفاده کنید.');
    const base=new URL(this.url);
    const path=new URL('./../file/bot'+this.token+'/'+info.file_path,base);
    // Only Telegram's trusted API host/gateway; no third-party upload links.
    if(path.origin!==base.origin)throw new Error('نشانی فایل دانلود نامعتبر است.');
    const response=await this.fetchImpl(path,{signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw new Error('دریافت بکاپ از تلگرام ناموفق بود.');
    const array=await response.arrayBuffer();
    if(array.byteLength>18*1024*1024)throw new Error('بکاپ بیش از حد مجاز است.');
    return Buffer.from(array);
  }
  async sendQr(chatId,content,caption='QR Code') {
    // Local generation. Never send sensitive client links to third-party QR web services.
    if(typeof content!=='string'||Buffer.byteLength(content)>2000)throw new Error('لینک برای QR بیش از حد طولانی است.');
    const {default: QRCode}=await import('qrcode');
    const png=await QRCode.toBuffer(content,{type:'png',width:500,margin:2,errorCorrectionLevel:'M'});
    const form=new FormData();
    form.set('chat_id',String(chatId));
    form.set('caption',caption.slice(0,1000));
    form.set('photo',new Blob([png],{type:'image/png'}),'qr.png');
    let response;
    try{response=await this.fetchImpl(this.url+'sendPhoto',{method:'POST',body:form,signal:AbortSignal.timeout(30000)});}
    catch(e){throw new Error(`خطا در ارسال تصویر QR (${e?.name||'network'})`);}
    const obj=await response.json().catch(()=>null);
    if(!response.ok||obj?.ok!==true)throw new Error('تلگرام تصویر QR را نپذیرفت.');
    return obj.result;
  }
  async send(chatId, text, keys) {
    return this.call('sendMessage', {chat_id:chatId, text, parse_mode:'HTML', disable_web_page_preview:true, ...(keys ? {reply_markup:{inline_keyboard:keys}} : {})});
  }
  async answer(id, text='') { return this.call('answerCallbackQuery',{callback_query_id:id, text: text.slice(0,180)}); }
}
export function button(label, action) { return {text:label, callback_data:action}; }
export function copyButton(label, value) { return {text:label, copy_text:{text:String(value)}}; }

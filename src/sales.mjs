// Period boundaries are based on Asia/Tehran local calendar.
// "month" uses the Persian (Jalali) calendar and "week" begins Saturday.
const formatterCache=new Map();
function parts(ms,timezone,calendar='gregory'){
 const key=timezone+calendar;
 let f=formatterCache.get(key);
 if(!f){f=new Intl.DateTimeFormat('en-US-u-ca-'+calendar,{timeZone:timezone,year:'numeric',month:'numeric',day:'numeric',weekday:'short'});formatterCache.set(key,f);}
 const out={};for(const p of f.formatToParts(new Date(ms)))if(p.type!=='literal')out[p.type]=p.value;
 return out;
}
const dayKey=(ms,tz)=>{const p=parts(ms,tz);return Number(p.year)*400+Number(p.month)*32+Number(p.day);};
const monthKey=(ms,tz)=>{const p=parts(ms,tz,'persian');return Number(p.year)*12+Number(p.month);};
// Find first millisecond when a local date/calendar month key reaches the target.
function firstInstant(target,selector,now,tz){
 let hi=now+1000,lo=now-420*86400000;
 while(selector(lo,tz)>=target)lo-=400*86400000;
 while(hi-lo>1){const mid=Math.floor((hi+lo)/2);if(selector(mid,tz)>=target)hi=mid;else lo=mid;}
 return hi;
}
const periods={today:'امروز',week:'این هفته',month:'این ماه',six:'۶ ماه اخیر',year:'یک سال اخیر',all:'کل دوره'};
export const periodNames=periods;
export function periodBounds(period,now=Date.now(),tz='Asia/Tehran'){
 if(!Object.hasOwn(periods,period))throw new Error('بازه گزارش نامعتبر است.');
 if(period==='all')return [0,now+1];
 if(period==='today')return [firstInstant(dayKey(now,tz),dayKey,now,tz),now+1];
 if(period==='week'){
  let start=firstInstant(dayKey(now,tz),dayKey,now,tz);
  while(parts(start,tz).weekday!=='Sat') start=firstInstant(dayKey(start-1,tz),dayKey,start-1,tz);
  return [start,now+1];
 }
 const month=monthKey(now,tz),delta={month:0,six:5,year:11}[period];
 return [firstInstant(month-delta,monthKey,now,tz),now+1];
}

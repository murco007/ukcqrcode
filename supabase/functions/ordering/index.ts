import postgres from 'npm:postgres@3.4.5';
import worker from './worker-truck.js';
import {createDB} from './database.js';
const required=(name:string)=>{const value=Deno.env.get(name);if(!value)throw Error('Missing server configuration: '+name);return value;};
let pool:ReturnType<typeof postgres>|undefined;
function database(){return pool??=postgres(Deno.env.get('ORDERING_DB_URL')||required('SUPABASE_DB_URL'),{prepare:false,max:2,idle_timeout:20,connect_timeout:10,ssl:'require'});}
const reply=(value:unknown,status:number,headers:HeadersInit={})=>Response.json(value,{status,headers});
Deno.serve(async request=>{
 let privateSettings:Record<string,string>;
 try{const rows=await database().unsafe('SELECT settings FROM ordering.runtime_config WHERE id=1');privateSettings=rows[0]?.settings||{};}catch{return reply({error:'雲端資料庫連線尚未完成。'},503);}
 const allowed=Deno.env.get('SITE_URL')||privateSettings.SITE_URL||'https://murco007.github.io/ukcqrcode/';
 if(!allowed)return reply({error:'雲端主機尚未設定 SITE_URL。'},503);
 const site=new URL(allowed);const origin=request.headers.get('origin');
 const cors={'Access-Control-Allow-Origin':site.origin,'Vary':'Origin','Access-Control-Allow-Headers':'apikey,content-type,x-staff-session','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Expose-Headers':'Content-Disposition','Cache-Control':'no-store'};
 if(origin!==site.origin)return reply({error:'請從指定點餐網站操作。'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const path=new URL(request.url).pathname.replace(/^\/(?:functions\/v1\/)?ordering(?=\/|$)/,'');
 if(!path.startsWith('/api/')||!['GET','POST'].includes(request.method))return reply({error:'找不到此功能。'},404,cors);
 try{
  let body:string|undefined;
  if(request.method==='POST'){
   const reader=request.body?.getReader();let size=0;const parts:Uint8Array[]=[];
   if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1048576){await reader.cancel();return reply({error:'上傳資料過大。'},413,cors);}parts.push(value);}
   const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}body=new TextDecoder().decode(bytes);
  }
  const session=request.headers.get('x-staff-session')||'';
  if(session&&!/^(admin|kitchen|cashier)\.\d{13}\.[a-f0-9]{64}$/.test(session))return reply({error:'請重新登入。'},401,cors);
  const keys=['SESSION_SECRET','STAFF_PASSWORD_SALT','CASHIER_PASSWORD_HASH','KITCHEN_PASSWORD_HASH','ADMIN_USERNAME','ADMIN_PASSWORD_HASH','ADMIN_PASSWORD_SALT'];
  const env=Object.fromEntries(keys.map(key=>[key,Deno.env.get(key)||privateSettings[key]||'']));
  if(keys.some(key=>!env[key])&&!['/api/menu','/api/table'].includes(path))return reply({error:'雲端登入設定尚未完成，暫不接受點餐。'},503,cors);
  const result=await database().begin(async transaction=>{
   await transaction.unsafe('SET LOCAL search_path TO ordering, pg_catalog');
   // Serialize complete business operations to preserve order/checkout invariants.
   await transaction.unsafe('SELECT pg_advisory_xact_lock(187889,1)');
   const headers=new Headers({'Origin':'https://ordering.internal','Content-Type':'application/json','cf-connecting-ip':request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown'});
   if(session)headers.set('Cookie','staff='+session);
   const apiUrl='https://ordering.internal'+path+new URL(request.url).search;
   return worker.fetch(new Request(apiUrl,{method:request.method,headers,...(body!==undefined?{body}:{})}),{...env,DB:createDB(transaction)});
  });
  const headers=new Headers(cors);headers.set('Content-Type',result.headers.get('Content-Type')||'application/json');
  const disposition=result.headers.get('Content-Disposition');if(disposition)headers.set('Content-Disposition',disposition);
  if(path==='/api/menu'&&result.ok)return reply({...await result.json(),ready:keys.every(key=>!!env[key])},200,headers);
  if(path==='/api/login'&&result.ok){const data=await result.json();const token=result.headers.get('Set-Cookie')?.match(/^staff=([^;]+)/)?.[1];if(!token)throw Error('Missing session');return reply({...data,session:token},200,headers);}
  return new Response(await result.arrayBuffer(),{status:result.status,headers});
 }catch(error){console.error('Ordering backend failed',error instanceof Error?error.name:'unknown');return reply({error:'雲端主機暫時無法使用，請確認後端設定。'},503,cors);}
});


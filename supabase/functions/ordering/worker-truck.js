const MENU = [{"id":"wg-classic","name":"傳統肉燥碗粿","category":"古早味碗粿","price":50,"description":"米香軟Q，搭配肉燥與菜脯的經典口味。","tag":"招牌","available":false},{"id":"wg-egg-yolk","name":"蛋黃碗粿","category":"古早味碗粿","price":60,"description":"傳統碗粿搭配蛋黃，口感豐富。","available":false},{"id":"wg-plain","name":"原味碗粿","category":"古早味碗粿","price":45,"description":"簡單米香，品味古早好滋味。","available":false},{"id":"rice-cake","name":"傳統米糕","category":"米食主食","price":45,"description":"糯米蒸熟，淋上香氣十足的肉燥。","available":false},{"id":"braised-pork-rice","name":"滷肉飯","category":"米食主食","price":40,"description":"鹹香滷肉燥配白飯。","available":false},{"id":"pork-thick-soup","name":"肉羹湯","category":"湯品小菜","price":55,"description":"熱呼呼的古早味肉羹湯。","available":false},{"id":"pork-thick-noodles","name":"肉羹麵線","category":"湯品小菜","price":65,"description":"滑順麵線搭配肉羹湯底。","available":false},{"id":"sishen-soup","name":"四神湯","category":"湯品小菜","price":60,"description":"溫潤順口的台式傳統湯品。","available":false},{"id":"braised-egg","name":"滷蛋","category":"湯品小菜","price":15,"description":"滷香入味，適合搭配主食。","available":false},{"id":"seasonal-veg","name":"燙青菜","category":"湯品小菜","price":40,"description":"依當日供應提供新鮮時蔬。","available":false}];
const HTML = '';
const QRS = {};
const json = (v,status=200,headers={}) => new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const fail=(msg,status=400)=>{throw Object.assign(new Error(msg),{status})};
const validTable=n=>Number.isInteger(n)&&n>=1&&n<=10;
const now=()=>new Date().toISOString();
const dayNow=()=>new Date(Date.now()+28800000).toISOString().slice(0,10);
async function signature(s,secret){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function identityOf(req,env){
 const token=req.headers.get('cookie')?.match(/(?:^|;\s*)staff=([^;]+)/)?.[1];
 if(!token||!env.SESSION_SECRET)return null;
 const [role,exp,sig]=token.split('.');
 if(!['admin','kitchen','cashier'].includes(role)||!/^\d{13}$/.test(exp||'')||Number(exp)<Date.now())return null;
 if(await signature(role+'.'+exp,env.SESSION_SECRET)!==sig)return null;
 const session=await env.DB.prepare('SELECT a.id,a.name,a.username,a.role,a.active FROM staff_sessions s JOIN staff_accounts a ON a.id=s.account_id WHERE s.token_hash=?').bind(sig).first();
 if(session)return session.active===1&&session.role===role?session:null;
 // Legacy sessions belong only to the original accounts, never to a manager.
 const legacy=await env.DB.prepare('SELECT id,name,username,role,active FROM staff_accounts WHERE id=?').bind(role==='admin'?'owner':'legacy-'+role).first();
 return legacy?.active===1&&legacy.role===role?legacy:null;
}
async function roleOf(req,env){return (await identityOf(req,env))?.role||null;}
const staffOwner=identity=>identity?.id==='owner'&&identity?.username==='murco007'&&identity?.role==='admin';
async function menu(db){const {results:overrides}=await db.prepare('SELECT * FROM menu_overrides').all();const {results:custom}=await db.prepare('SELECT * FROM menu_custom ORDER BY rowid').all();const {results:deleted}=await db.prepare('SELECT id FROM menu_deleted').all();const hidden=new Set(deleted.map(x=>x.id));const products=[...MENU,...custom.filter(p=>!MENU.some(x=>x.id===p.id))].filter(p=>!hidden.has(p.id));return products.map(p=>{const edit=custom.find(x=>x.id===p.id);const override=overrides.find(x=>x.id===p.id);return {...p,...edit,...override,available:(override?.available??edit?.available??(p.available===false?0:1))!==0}});}
async function tableState(db,t){const state=await db.prepare('SELECT generation FROM dining_tables WHERE table_no=?').bind(t).first();const generation=state?.generation||1;const bill=await db.prepare("SELECT * FROM bills WHERE table_no=? AND generation=? AND status='open'").bind(t,generation).first();const lines=bill?(await db.prepare('SELECT * FROM lines WHERE bill_id=? ORDER BY created_at,id').bind(bill.id).all()).results:[];return {table:t,generation,bill,lines,total:lines.reduce((a,l)=>a+l.price*l.qty,0)};}
async function printPayload(db,job){const bill=await db.prepare('SELECT b.*,'+preorderColumns+' FROM bills b LEFT JOIN preorders p ON p.bill_id=b.id WHERE b.id=?').bind(job.bill_id).first();const lines=(await db.prepare(job.kind==='kitchen'&&job.id.startsWith('order:')?'SELECT * FROM lines WHERE bill_id=? AND id LIKE ? ORDER BY created_at,id':'SELECT * FROM lines WHERE bill_id=? ORDER BY created_at,id').bind(...(job.kind==='kitchen'&&job.id.startsWith('order:')?[job.bill_id,job.id.slice(6)+'-%']:[job.bill_id])).all()).results;return {...job,bill,lines};}

const preorderColumns='p.slot AS preorder_slot,p.pickup_code,p.pickup_date,p.channel AS preorder_channel,p.completed_at';
function pickupDetails(body){
 const code=String(body.pickupCode||'').trim(),date=String(body.pickupDate||'').trim(),channel=body.channel||'phone';
 if(!/^[0-9]{3}$/.test(code))fail('取餐碼請輸入手機末三碼，包含開頭的 0。');
 const stamp=/^\d{4}-\d{2}-\d{2}$/.test(date)?new Date(date+'T00:00:00Z'):new Date(NaN);
 if(!Number.isFinite(stamp.getTime())||stamp.toISOString().slice(0,10)!==date)fail('請選擇有效取餐日期。');
 if(!['phone','web'].includes(channel))fail('預購來源錯誤。');
 return {code,date,channel};
}
async function preorderApi(req,db,u,b,role,env){
 if(!['admin','cashier','kitchen'].includes(role))fail('請先登入員工後台。',401);
 if(u.pathname==='/api/preorders'&&req.method==='GET'){
  const {results}=await db.prepare('SELECT b.*,'+preorderColumns+',l.id AS line_id,l.product_id,l.name,l.price,l.qty,l.note,l.created_at,l.served FROM preorders p JOIN bills b ON b.id=p.bill_id JOIN lines l ON l.bill_id=b.id WHERE p.completed_at IS NULL ORDER BY p.slot,l.created_at,l.id').all();
  return json({rows:results});
 }
 if(!['admin','cashier'].includes(role))fail('新增、修改及取餐確認僅供前台與管理員使用。',403);
 if(u.pathname==='/api/preorders/create'&&req.method==='POST'){
  const slot=Number(b.slot),details=pickupDetails(b);
  if(!Number.isInteger(slot)||slot<1||slot>10)fail('預購組別需為 1–10。');
  if(!/^[a-zA-Z0-9-]{16,64}$/.test(b.requestId||''))fail('缺少送單識別碼。');
  if(!Array.isArray(b.items)||!b.items.length||b.items.length>30)fail('請選擇 1–30 項餐點。');
  const hash=await signature(JSON.stringify({slot,...details,items:b.items}),env.SESSION_SECRET);
  const prior=await db.prepare('SELECT bill_id,request_hash FROM preorders WHERE request_id=?').bind(b.requestId).first();
  if(prior){if(prior.request_hash!==hash)fail('此送單識別碼已用於其他預購。',409);return json({ok:true,id:prior.bill_id,duplicate:true});}
  if(await db.prepare('SELECT bill_id FROM preorders WHERE slot=? AND completed_at IS NULL').bind(slot).first())fail('此組仍有未完成預購，請確認取餐後再使用。',409);
  const products=await menu(db),stamp=now();
  const items=b.items.map((item,index)=>{
   const product=products.find(p=>p.id===item.id);
   if(!product||!product.available)fail('餐點已停售，請重新選擇。');
   if(!Number.isInteger(item.qty)||item.qty<1||item.qty>20)fail('每項數量需為 1–20。');
   if(item.price!==product.price)fail('餐點價格已更新，請重新確認。',409);
   const note=String(item.note||'').trim();if(note.length>200)fail('備註最多 200 字。');
   return {id:b.requestId+'-'+index,product,qty:item.qty,note};
  });
  const tableNo=10+slot;
  const last=await db.prepare('SELECT COALESCE(MAX(generation),0) AS generation FROM bills WHERE table_no=?').bind(tableNo).first();
  const generation=Number(last.generation)+1,id='P'+slot+':'+generation;
  await db.batch([
   db.prepare("INSERT INTO bills(id,table_no,generation,status,opened_at) VALUES(?,?,?,'open',?)").bind(id,tableNo,generation,stamp),
   db.prepare('INSERT INTO preorders(bill_id,slot,pickup_code,pickup_date,channel,request_id,request_hash) VALUES(?,?,?,?,?,?,?)').bind(id,slot,details.code,details.date,details.channel,b.requestId,hash),
   ...items.map(x=>db.prepare('INSERT INTO lines(id,bill_id,product_id,name,price,qty,note,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(x.id,id,x.product.id,x.product.name,x.product.price,x.qty,x.note,stamp)),
   db.prepare("INSERT INTO print_jobs(id,kind,bill_id,created_at) VALUES(?,'kitchen',?,?)").bind('order:'+b.requestId,id,stamp)
  ]);
  return json({ok:true,id});
 }
 if(u.pathname==='/api/preorders/update'&&req.method==='POST'){
  const details=pickupDetails(b);
  const result=await db.prepare('UPDATE preorders SET pickup_code=?,pickup_date=?,channel=? WHERE bill_id=? AND completed_at IS NULL').bind(details.code,details.date,details.channel,String(b.billId)).run();
  if(!result.meta.changes)fail('預購已完成或不存在。',409);return json({ok:true});
 }
 if(u.pathname==='/api/preorders/complete'&&req.method==='POST'){
  const row=await db.prepare('SELECT b.status,p.completed_at FROM preorders p JOIN bills b ON b.id=p.bill_id WHERE p.bill_id=?').bind(String(b.billId)).first();
  if(!row)fail('找不到預購。',404);
  if(row.completed_at)return json({ok:true,duplicate:true});
  if(row.status!=='paid')fail('請先完成結帳，再確認取餐。',409);
  const unserved=await db.prepare('SELECT COUNT(*) AS count FROM lines WHERE bill_id=? AND served=0').bind(String(b.billId)).first();
  if(Number(unserved.count)>0)fail('仍有餐點未出餐，請先完成出餐。',409);
  await db.prepare('UPDATE preorders SET completed_at=? WHERE bill_id=? AND completed_at IS NULL').bind(now(),String(b.billId)).run();
  return json({ok:true});
 }
 fail('找不到預購功能。',404);
}

async function printingApi(req,db,u,b,role){
 const can=kind=>role==='admin'||role===(kind==='kitchen'?'kitchen':'cashier');
 if(u.pathname==='/api/print/receipt'&&req.method==='GET'){const kind=u.searchParams.get('kind')||'receipt';if(!['kitchen','receipt'].includes(kind)||!can(kind))fail('沒有列印權限',403);const id=u.searchParams.get('bill');if(!/^(?:(?:[1-9]|10)|P(?:[1-9]|10)):[1-9][0-9]{0,11}$/.test(id||''))fail('帳單編號錯誤');const bill=await db.prepare('SELECT * FROM bills WHERE id=?').bind(id).first();if(!bill)fail('找不到帳單',404);return json(await printPayload(db,{id:'manual:'+id,kind,bill_id:id,created_at:bill.paid_at||bill.opened_at}));}

 if(u.pathname==='/api/print/jobs'&&req.method==='GET'){
  const kind=u.searchParams.get('kind');if(!['kitchen','receipt'].includes(kind)||!can(kind))fail('沒有列印權限',403);
  return json({jobs:(await db.prepare("SELECT * FROM print_jobs WHERE kind=? AND status='pending' ORDER BY created_at,id LIMIT 1").bind(kind).all()).results});
 }
 if(u.pathname==='/api/print/claim'&&req.method==='POST'){
  const job=await db.prepare('SELECT * FROM print_jobs WHERE id=?').bind(String(b.id)).first();if(!job||!can(job.kind))fail('沒有列印權限',403);
  if(!/^[a-zA-Z0-9-]{8,80}$/.test(b.owner||''))fail('裝置識別錯誤');
  const r=await db.prepare("UPDATE print_jobs SET status='sending',owner=?,updated_at=? WHERE id=? AND status='pending'").bind(b.owner,now(),job.id).run();
  if(!r.meta.changes)fail('此工作已被其他裝置接收',409);
  return json(await printPayload(db,{...job,owner:b.owner,status:'sending'}));
 }
 if(u.pathname==='/api/print/result'&&req.method==='POST'){
  const job=await db.prepare('SELECT * FROM print_jobs WHERE id=?').bind(String(b.id)).first();if(!job||!can(job.kind))fail('沒有列印權限',403);
  if(!['sent','failed'].includes(b.status))fail('列印狀態錯誤');
  await db.prepare("UPDATE print_jobs SET status=?,detail=?,updated_at=? WHERE id=? AND owner=? AND status='sending'").bind(b.status,String(b.detail||'').slice(0,200),now(),job.id,String(b.owner)).run();return json({ok:true});
 }
 if(u.pathname==='/api/print/history'&&req.method==='GET'){
  if(!['admin','kitchen','cashier'].includes(role))fail('請先登入',401);
  const day=u.searchParams.get('day')||dayNow();if(!/^\d{4}-\d{2}-\d{2}$/.test(day))fail('日期格式錯誤');
  const start=new Date(day+'T00:00:00+08:00');if(!Number.isFinite(start.getTime()))fail('日期格式錯誤');const end=new Date(start.getTime()+86400000);
  const bills=(await db.prepare("SELECT b.*,"+preorderColumns+",COALESCE(SUM(l.price*l.qty),0) AS total FROM bills b LEFT JOIN preorders p ON p.bill_id=b.id LEFT JOIN lines l ON l.bill_id=b.id WHERE b.opened_at>=? AND b.opened_at<? GROUP BY b.id,p.bill_id ORDER BY b.opened_at DESC LIMIT 500").bind(start.toISOString(),end.toISOString()).all()).results;
  const jobs=(await db.prepare(role==='admin'?'SELECT * FROM print_jobs ORDER BY created_at DESC LIMIT 100':'SELECT * FROM print_jobs WHERE kind=? ORDER BY created_at DESC LIMIT 100').bind(...(role==='admin'?[]:[role==='kitchen'?'kitchen':'receipt'])).all()).results;return json({bills,jobs});
 }
 if(u.pathname==='/api/print/reprint'&&req.method==='POST'){
  if(!['kitchen','receipt'].includes(b.kind))fail('單據類型錯誤');if(!can(b.kind))fail('沒有列印權限',403);
  const bill=await db.prepare('SELECT * FROM bills WHERE id=?').bind(String(b.billId)).first();if(!bill)fail('找不到訂單',404);
  if(b.kind==='receipt'&&bill.status!=='paid')fail('此帳單尚未結帳，請選擇點餐明細');
  const id='reprint:'+crypto.randomUUID();await db.prepare("INSERT INTO print_jobs(id,kind,bill_id,created_at,detail) VALUES(?,?,?,?,?)").bind(id,b.kind,bill.id,now(),'重印').run();return json({ok:true,id});
 }
 if(u.pathname==='/api/print/retry'&&req.method==='POST'){
  const retryJob=await db.prepare('SELECT * FROM print_jobs WHERE id=?').bind(String(b.id)).first();if(!retryJob||!can(retryJob.kind))fail('沒有列印權限',403);
  await db.prepare("UPDATE print_jobs SET status='pending',owner='',detail='人工確認補印',updated_at=? WHERE id=? AND status IN ('failed','sending')").bind(now(),String(b.id)).run();return json({ok:true});
 }
 fail('找不到列印功能',404);
}



async function archiveOldestComplete(db){
 const {results}=await db.prepare("SELECT b.id,b.status,COUNT(l.id) AS line_count,SUM(CASE WHEN l.served=1 THEN 1 ELSE 0 END) AS served_count FROM bills b JOIN lines l ON l.bill_id=b.id WHERE b.archived=false GROUP BY b.id ORDER BY b.serial DESC").all();
 if(results.length<10)return false;
 const oldest=results[results.length-1];
 if(oldest.status==='paid'&&Number(oldest.line_count)>0&&Number(oldest.line_count)===Number(oldest.served_count)){
  await db.prepare("UPDATE bills SET archived=true WHERE id=? AND archived=false").bind(oldest.id).run();return true;
 }
 return false;
}
async function api(req,env,u){
 const db=env.DB;if(!db)fail('尚未連接資料庫，請聯絡管理員。',503);
 const path=u.pathname;const identity=await identityOf(req,env);const role=identity?.role||null;
 if(req.method==='POST'&&req.headers.get('origin')!==u.origin)fail('請從本站操作。',403);
 const b=req.method==='POST'?await req.json().catch(()=>fail('資料格式錯誤')):{};
 if(path==='/api/login'&&req.method==='POST'){
  if(!env.SESSION_SECRET||!env.CASHIER_PASSWORD_HASH||!env.KITCHEN_PASSWORD_HASH)fail('尚未設定員工登入，請聯絡管理員。',503);
  const ip=req.headers.get('cf-connecting-ip')||'local';const k=await signature(ip,env.SESSION_SECRET);const minute=Math.floor(Date.now()/600000);
  await db.prepare('INSERT INTO login_attempts(key,attempts,window_bucket) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_bucket=? THEN attempts+1 ELSE 1 END, window_bucket=?').bind(k,minute,minute,minute).run();
  const a=await db.prepare('SELECT attempts FROM login_attempts WHERE key=?').bind(k).first();if(a.attempts>12)fail('嘗試次數過多，請於 10 分鐘後重試。',429);
  const username=typeof b.username==='string'?b.username.trim():'';
  const r=username?'admin':b.role==='kitchen'?'kitchen':'cashier';
  const pin=String(b.pin||'');if(!pin||pin.length>40)fail('帳號或密碼不正確。',401);
  const accounts=(await db.prepare(username?'SELECT * FROM staff_accounts WHERE active=1 AND role=? AND username=?':'SELECT * FROM staff_accounts WHERE active=1 AND role=?').bind(...(username?[r,username]:[r])).all()).results;
  let account=null;const legacyHash=await signature(pin,r==='admin'?env.ADMIN_PASSWORD_SALT:env.STAFF_PASSWORD_SALT);
  for(const candidate of accounts){
   if(candidate.password_scheme==='legacy'&&candidate.password_hash===legacyHash){account=candidate;break;}
   if(candidate.password_scheme==='bcrypt'){
    const check=await db.prepare('SELECT extensions.crypt(?,?) = ? AS valid').bind(pin,candidate.password_hash,candidate.password_hash).first();
    if(check?.valid){account=candidate;break;}
   }
  }
  if(!account)fail('帳號或密碼不正確。',401);
  let expires=Date.now()+43200000,tokenHash;
  do{expires++;tokenHash=await signature(r+'.'+expires,env.SESSION_SECRET);}while(await db.prepare('SELECT token_hash FROM staff_sessions WHERE token_hash=?').bind(tokenHash).first());
  await db.prepare('INSERT INTO staff_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)').bind(tokenHash,account.id,expires).run();
  const token=r+'.'+expires+'.'+tokenHash;
  return json({role:r,canManageStaff:staffOwner(account),username:account.username||'',displayName:account.name},200,{'Set-Cookie':'staff='+token+'; HttpOnly; '+(env.LAN_MODE?'':'Secure; ')+'SameSite=Strict; Path=/; Max-Age=43200'});
 }
 if(path==='/api/logout'&&req.method==='POST')return json({ok:true},200,{'Set-Cookie':'staff=; HttpOnly; '+(env.LAN_MODE?'':'Secure; ')+'SameSite=Strict; Path=/; Max-Age=0'});
 if(path==='/api/menu'&&req.method==='GET')return json({menu:await menu(db),role,canManageStaff:staffOwner(identity),username:identity?.username||'',displayName:identity?.name||'',sourceDate:'2026-11-19'});
 if(path==='/api/table'&&req.method==='GET'){if(!role)fail('請先登入員工後台。',401);const t=Number(u.searchParams.get('table'));if(!validTable(t))fail('桌號必須為 1–10');return json(await tableState(db,t));}
 if(path==='/api/order'&&req.method==='POST'){
  if(!/^[a-zA-Z0-9-]{16,64}$/.test(b.requestId||''))fail('缺少送單識別碼。');
  if(!Array.isArray(b.items)||!b.items.length||b.items.length>30)fail('請選擇 1–30 項餐點。');
  const products=await menu(db),stamp=now();
  const items=b.items.map((x,i)=>{const p=products.find(p=>p.id===x.id);if(!p||!p.available)fail('餐點已停售，請重新選擇。');if(!Number.isInteger(x.qty)||x.qty<1||x.qty>20)fail('每項數量需為 1–20。');const note=String(x.note||'').trim();if(note.length>200)fail('備註最多 200 字。');if(x.price!==p.price)fail('餐點價格已更新，請重新確認。',409);return {id:b.requestId+'-'+i,p,qty:x.qty,note};});
  const existing=await db.prepare('SELECT bill_id FROM lines WHERE id=?').bind(items[0].id).first();
  if(existing){const prior=await db.prepare('SELECT id,serial FROM bills WHERE id=?').bind(existing.bill_id).first();if(!prior)fail('訂單識別資料不完整。',409);return json({ok:true,duplicate:true,id:prior.id,serial:Number(prior.serial)});}
  await archiveOldestComplete(db);
  const slot=await db.prepare("SELECT s.slot FROM generate_series(1,10) AS s(slot) WHERE NOT EXISTS(SELECT 1 FROM bills b WHERE b.table_no=s.slot AND b.archived=false) ORDER BY s.slot LIMIT 1").first();
  if(!slot)fail('目前 10 張訂單都尚未完成，請稍後再送單或洽櫃檯。',409);
  const t=Number(slot.slot),last=await db.prepare('SELECT COALESCE(MAX(generation),0) AS generation FROM bills WHERE table_no=?').bind(t).first(),g=Number(last.generation)+1,billId=t+':'+g;
  const seq=await db.prepare("SELECT nextval('ticket_serial') AS serial").first(),serial=Number(seq.serial);
  await db.prepare('INSERT INTO dining_tables(table_no,generation) VALUES(?,?) ON CONFLICT(table_no) DO UPDATE SET generation=excluded.generation').bind(t,g).run();
  await db.prepare("INSERT INTO bills(id,table_no,generation,serial,status,opened_at,archived) VALUES(?,?,?,?,'open',?,false)").bind(billId,t,g,serial,stamp).run();
  await db.batch(items.map(x=>db.prepare('INSERT INTO lines(id,bill_id,product_id,name,price,qty,note,created_at,served) VALUES(?,?,?,?,?,?,?,?,0)').bind(x.id,billId,x.p.id,x.p.name,x.p.price,x.qty,x.note,stamp)));
  await db.prepare("INSERT INTO print_jobs(id,kind,bill_id,created_at) VALUES(?,'kitchen',?,?)").bind('order:'+b.requestId,billId,stamp).run();
  return json({ok:true,id:billId,serial});
 }
 if(!role)fail('請先登入員工後台。',401);

 if(path==='/api/staff/change-password'&&req.method==='POST'){
  if(!staffOwner(identity))fail('僅 murco007 可更改店主密碼。',403);
  const currentPin=String(b.currentPin||''),newPin=String(b.newPin||''),confirmPin=String(b.confirmPin||'');
  if(currentPin.length<1||currentPin.length>40)fail('請輸入目前密碼。');
  if(newPin.length<5||newPin.length>40||new TextEncoder().encode(newPin).length>72)fail('新密碼需為 5–40 字（最多 72 位元組）。');
  if(newPin!==confirmPin)fail('兩次輸入的新密碼不一致。');
  const owner=await db.prepare("SELECT * FROM staff_accounts WHERE id='owner' AND username='murco007' AND role='admin' AND active=1").first();
  if(!owner)fail('找不到店主帳號。',404);
  let valid=false;
  if(owner.password_scheme==='bcrypt')valid=(await db.prepare('SELECT extensions.crypt(?,?) = ? AS valid').bind(currentPin,owner.password_hash,owner.password_hash).first())?.valid===true;
  else if(owner.password_scheme==='legacy')valid=await signature(currentPin,env.ADMIN_PASSWORD_SALT)===owner.password_hash;
  if(!valid){
   const ip=req.headers.get('cf-connecting-ip')||'local',key=await signature(ip,env.SESSION_SECRET),bucket=Math.floor(Date.now()/600000);
   await db.prepare('INSERT INTO login_attempts(key,attempts,window_bucket) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_bucket=? THEN attempts+1 ELSE 1 END, window_bucket=?').bind(key,bucket,bucket,bucket).run();
   const attempts=await db.prepare('SELECT attempts FROM login_attempts WHERE key=?').bind(key).first();
   if(attempts?.attempts>12)fail('嘗試次數過多，請於 10 分鐘後重試。',429);
   fail('目前密碼不正確。',401);
  }
  if(currentPin===newPin)fail('新密碼必須與目前密碼不同。');
  const hash=(await db.prepare("SELECT extensions.crypt(?,extensions.gen_salt('bf',10)) AS hash").bind(newPin).first()).hash;
  await db.prepare("UPDATE staff_accounts SET password_hash=?,password_scheme='bcrypt' WHERE id='owner' AND username='murco007' AND role='admin' AND active=1").bind(hash).run();
  await db.prepare("DELETE FROM staff_sessions WHERE account_id='owner'").run();
  return json({ok:true});
 }
 if(path==='/api/staff'||path==='/api/staff/save'||path==='/api/staff/delete'){
  if(!staffOwner(identity))fail('僅 murco007 可管理人員。',403);
  if(path==='/api/staff'&&req.method==='GET')return json({staff:(await db.prepare("SELECT id,name,username,role,created_at FROM staff_accounts WHERE id<>'owner' AND active=1 ORDER BY created_at,id").all()).results});
  if(path==='/api/staff/save'&&req.method==='POST'){
   const name=String(b.name||'').trim(),pin=String(b.pin||'');
   const username=b.role==='admin'?String(b.username||'').trim().toLowerCase():null;
   if(b.role==='admin'){
    if(!/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(username||'')||username==='murco007'||username===String(env.ADMIN_USERNAME||'').toLowerCase())fail('經理帳號需為 3–40 字英數、底線、點或連字號，且不可使用擁有者帳號。');
    if(await db.prepare('SELECT id FROM staff_accounts WHERE lower(username)=?').bind(username).first())fail('此帳號已存在，請使用其他帳號。',409);
   }
   if(!name||name.length>60||!['admin','kitchen','cashier'].includes(b.role)||pin.length<5||pin.length>40||new TextEncoder().encode(pin).length>72)fail('請填寫姓名、職務與 5–40 字密碼（最多 72 位元組）。');
   const peers=b.role==='admin'?[]:(await db.prepare('SELECT password_hash,password_scheme FROM staff_accounts WHERE role=? AND active=1').bind(b.role).all()).results;
   const legacyHash=await signature(pin,env.STAFF_PASSWORD_SALT);
   for(const peer of peers){
    if(peer.password_scheme==='legacy'&&peer.password_hash===legacyHash)fail('此職務已有相同密碼，請設定另一組密碼。');
    if(peer.password_scheme==='bcrypt'&&(await db.prepare('SELECT extensions.crypt(?,?) = ? AS valid').bind(pin,peer.password_hash,peer.password_hash).first())?.valid)fail('此職務已有相同密碼，請設定另一組密碼。');
   }
   const hash=(await db.prepare("SELECT extensions.crypt(?,extensions.gen_salt('bf',10)) AS hash").bind(pin).first()).hash;
   const id=crypto.randomUUID();
   await db.prepare("INSERT INTO staff_accounts(id,name,username,role,password_hash,password_scheme,created_at) VALUES(?,?,?,?,?,'bcrypt',?)").bind(id,name,username,b.role,hash,now()).run();
   return json({ok:true,id});
  }
  if(path==='/api/staff/delete'&&req.method==='POST'){
   const changed=await db.prepare("UPDATE staff_accounts SET active=0 WHERE id=? AND id<>'owner' AND role IN ('admin','kitchen','cashier') AND active=1").bind(String(b.id)).run();
   if(!changed.meta.changes)fail('找不到此人員。',404);
   return json({ok:true});
  }
  fail('找不到此功能。',404);
 }


 if(path==='/api/kitchen-display/hide'||path==='/api/kitchen-display/restore'){
  if(!['admin','kitchen'].includes(role))fail('此功能僅供廚房或管理員使用。',403);
  if(req.method!=='POST')fail('操作方式錯誤。',405);
  if(path==='/api/kitchen-display/restore'){await db.prepare('DELETE FROM kitchen_hidden').run();return json({ok:true});}
  const id=String(b.billId||''),count=Number(b.expectedCount);
  if(!/^(?:(?:[1-9]|10)|P(?:[1-9]|10)):[1-9][0-9]{0,11}$/.test(id)||!Number.isInteger(count)||count<1)fail('訂單資料錯誤。');
  const result=await db.prepare('INSERT INTO kitchen_hidden(bill_id,line_count,hidden_at) SELECT b.id,?,? FROM bills b WHERE b.id=? AND (SELECT COUNT(*) FROM lines l WHERE l.bill_id=b.id)=? ON CONFLICT(bill_id) DO UPDATE SET line_count=excluded.line_count,hidden_at=excluded.hidden_at').bind(count,now(),id,count).run();
  if(!result.meta.changes)fail('訂單有新餐點或已變動，請確認更新後的訂單再移除顯示。',409);
  return json({ok:true});
 }

 if(path.startsWith('/api/preorders'))return preorderApi(req,db,u,b,role,env);
 if(path.startsWith('/api/print/'))return printingApi(req,db,u,b,role);
 if(path==='/api/board'&&req.method==='GET'){if(!['admin','cashier','kitchen'].includes(role))fail('請先登入員工後台。',401);const {results}=await db.prepare("SELECT b.*,"+preorderColumns+",l.id AS line_id,l.product_id,l.name,l.price,l.qty,l.note,l.created_at,l.served FROM bills b JOIN lines l ON l.bill_id=b.id LEFT JOIN preorders p ON p.bill_id=b.id WHERE b.archived=false AND b.id IN (SELECT id FROM bills WHERE archived=false ORDER BY serial DESC LIMIT 10) ORDER BY b.serial DESC,l.created_at,l.id").all();return json({rows:results,role});}
 if(path==='/api/order/archive'&&req.method==='POST'){if(!['admin','cashier','kitchen'].includes(role))fail('請先登入員工後台。',401);const id=String(b.billId||'');if(!/^([1-9]|10):[1-9][0-9]{0,11}$/.test(id))fail('流水單號錯誤。');const changed=await db.prepare('UPDATE bills SET archived=true WHERE id=? AND archived=false').bind(id).run();if(!changed.meta.changes)fail('找不到這張訂單或它已移除。',404);return json({ok:true});}
 if(path==='/api/serve'&&req.method==='POST'){if(!['admin','kitchen'].includes(role))fail('此功能僅供廚房或管理員使用。',403);if(typeof b.served!=='boolean')fail('出餐狀態錯誤');const r=await db.prepare("UPDATE lines SET served=? WHERE id=? AND bill_id IN (SELECT id FROM bills WHERE archived=false)").bind(b.served?1:0,String(b.id)).run();if(!r.meta.changes)fail('訂單已結束。',409);await archiveOldestComplete(db);return json({ok:true});}
 if(!['admin','cashier'].includes(role))fail('此功能僅供結帳前台使用。',403);
 if(path==='/api/checkout'&&req.method==='POST'){
  if(!['現金','刷卡','行動支付'].includes(b.payment))fail('付款方式錯誤');
  const bill=await db.prepare("SELECT * FROM bills WHERE id=? AND status='open'").bind(String(b.billId)).first();if(!bill)fail('此帳單已結帳或不存在。',409);
  if(!Number.isInteger(b.expectedTotal)||!Number.isInteger(b.expectedCount)||!Number.isInteger(b.received)||b.received<b.expectedTotal)fail('收款金額不足或格式錯誤。');
  const paid=now();const result=await db.batch([
   db.prepare("UPDATE bills SET status='paid',paid_at=?,payment=?,received=? WHERE id=? AND status='open' AND (SELECT COUNT(*) FROM lines WHERE bill_id=?)=? AND (SELECT COALESCE(SUM(price*qty),0) FROM lines WHERE bill_id=?)=?").bind(paid,b.payment,b.received,bill.id,bill.id,b.expectedCount,bill.id,b.expectedTotal),
   db.prepare("INSERT INTO print_jobs(id,kind,bill_id,created_at) SELECT ?, 'receipt', ?, ? WHERE EXISTS(SELECT 1 FROM bills WHERE id=? AND status='paid')").bind('receipt:'+bill.id,bill.id,paid,bill.id),
   db.prepare("UPDATE dining_tables SET generation=generation+1 WHERE table_no=? AND generation=? AND EXISTS(SELECT 1 FROM bills WHERE id=? AND status='paid')").bind(bill.table_no,bill.generation,bill.id)
  ]);if(!result[0].meta.changes)fail('帳單已變動或仍有未出餐品項，請重新確認。',409);await archiveOldestComplete(db);return json({ok:true,change:b.received-b.expectedTotal});
 }
 if(role!=='admin')fail('此功能僅供管理員使用。',403);

 if(path==='/api/menu-delete'&&req.method==='POST'){
  const id=String(b.id||'');if(!(await menu(db)).some(p=>p.id===id))fail('找不到餐點，可能已被刪除。',404);
  await db.prepare('INSERT OR IGNORE INTO menu_deleted(id,deleted_at) VALUES(?,?)').bind(id,now()).run();
  return json({ok:true});
 }
 if(path==='/api/menu-save'&&req.method==='POST'){
  const name=String(b.name||'').trim(),description=String(b.description||'').trim(),image=String(b.image||'');
  if(!name||name.length>80||description.length>500||!['原味燉盅','暖心套餐','廣東腸粉','飯麵主食','私房小菜','家傳甜湯'].includes(b.category)||!Number.isInteger(b.price)||b.price<0||b.price>99999||typeof b.available!=='boolean')fail('請確認名稱、分類與價格。');
  if(image.length>700000||image&&!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(image)&&!/^https:\/\/[^\s"<>]+$/.test(image)&&!MENU.some(p=>p.image===image))fail('請上傳圖片或使用 HTTPS 圖片網址。');
  const products=await menu(db);if(b.id&&!products.some(p=>p.id===b.id))fail('找不到餐點。',404);const id=b.id||'custom-'+crypto.randomUUID();
  await db.batch([db.prepare('INSERT INTO menu_custom(id,name,category,description,image,price,available) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,category=excluded.category,description=excluded.description,image=excluded.image,price=excluded.price,available=excluded.available').bind(id,name,b.category,description,image,b.price,b.available?1:0),db.prepare('DELETE FROM menu_overrides WHERE id=?').bind(id)]);return json({ok:true,id});
 }
 if(path==='/api/menu-update'&&req.method==='POST'){if(!(await menu(db)).some(p=>p.id===b.id)||!Number.isInteger(b.price)||b.price<0||b.price>99999||typeof b.available!=='boolean')fail('價格或餐點資料錯誤。');await db.prepare('INSERT INTO menu_overrides(id,price,available) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET price=excluded.price,available=excluded.available').bind(b.id,b.price,b.available?1:0).run();return json({ok:true});}
 if(path==='/api/expense'&&req.method==='POST'){if(!/^\d{4}-\d{2}-\d{2}$/.test(b.day)||!Number.isInteger(b.amount)||b.amount<=0||b.amount>9999999||!['食材','人事','租金','水電','其他'].includes(b.category))fail('請確認支出日期、分類與正整數金額。');await db.prepare('INSERT INTO expenses(id,day,category,amount,note,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),b.day,b.category,b.amount,String(b.note||'').slice(0,200),now()).run();return json({ok:true});}
 if((path==='/api/report'||path==='/api/export')&&req.method==='GET'){
  const day=u.searchParams.get('day')||dayNow();if(!/^\d{4}-\d{2}-\d{2}$/.test(day))fail('日期格式錯誤');
  const bills=(await db.prepare("SELECT b.*,"+preorderColumns+",SUM(l.price*l.qty) AS total,SUM(l.qty) AS quantity FROM bills b JOIN lines l ON l.bill_id=b.id LEFT JOIN preorders p ON p.bill_id=b.id WHERE b.status='paid' AND substr(datetime(b.paid_at,'+8 hours'),1,10)=? GROUP BY b.id,p.bill_id ORDER BY b.paid_at DESC").bind(day).all()).results;
  const expenses=(await db.prepare('SELECT * FROM expenses WHERE day=? ORDER BY created_at DESC').bind(day).all()).results;
  const sales=(await db.prepare("SELECT l.name,SUM(l.qty) AS quantity,SUM(l.qty*l.price) AS total FROM lines l JOIN bills b ON b.id=l.bill_id WHERE b.status='paid' AND substr(datetime(b.paid_at,'+8 hours'),1,10)=? GROUP BY l.name ORDER BY quantity DESC").bind(day).all()).results;
  if(path==='/api/export'){const cell=v=>'"'+String(typeof v==='string'&&/^[=+@\-]/.test(v)?"'"+v:v??'').replaceAll('"','""')+'"';const rows=[['日期','類型','帳單／分類','桌號','金額','付款方式','備註'],...bills.map(x=>[day,'營收',x.id,x.pickup_code?'預購 '+x.pickup_code:x.table_no,x.total,x.payment,'']),...expenses.map(x=>[day,'支出',x.category,'',-x.amount,'',x.note])];return new Response('\ufeff'+rows.map(x=>x.map(cell).join(',')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="ukcqrcode-'+day+'.csv"','Cache-Control':'no-store'}});}
  return json({day,bills,expenses,sales,revenue:bills.reduce((a,x)=>a+x.total,0),expense:expenses.reduce((a,x)=>a+x.amount,0)});
 }
 fail('找不到此功能。',404);
}
export default {async fetch(req,env){try{const u=new URL(req.url);if(u.pathname.startsWith('/api/'))return await api(req,env,u);if(req.method!=='GET')return new Response('Method not allowed',{status:405});const pageRole=await roleOf(req,env);if(u.pathname!=='/'&&!u.pathname.startsWith('/api/')&&pageRole&&pageRole!=='admin'){const home=pageRole==='kitchen'?'/kitchen':'/cashier';if(u.pathname!==home)return new Response(null,{status:302,headers:{Location:home,'Cache-Control':'no-store'}});}if(u.pathname.startsWith('/qr/')){const svg=(env.QR_CODES||QRS)[u.pathname.slice(4)];return new Response(svg||'Not found',{status:svg?200:404,headers:{'Content-Type':'image/svg+xml','Cache-Control':'public, max-age=3600'}});}if(!['/','/kitchen','/cashier','/qrcodes','/reports','/settings'].includes(u.pathname))return new Response('Not found',{status:404});return new Response(env.PUBLIC_ORIGIN?HTML.replaceAll('https://ukcqrcode-order-2026.murco007.chatgpt.site',env.PUBLIC_ORIGIN):HTML,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}});}catch(e){return json({error:e.status?e.message:'服務暫時無法使用，請重試。'},e.status||500);}}};


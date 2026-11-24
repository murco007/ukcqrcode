// Server-only SQL adapter. No SQL execution endpoint is exposed to clients.
export function translate(query){
 let index=0;
 let sql=query.replaceAll('ORDER BY rowid','ORDER BY id')
 .replaceAll('CASE WHEN window=','CASE WHEN login_attempts.window=')
 .replaceAll('CASE WHEN window_bucket=','CASE WHEN login_attempts.window_bucket=')
 .replaceAll('THEN attempts+1','THEN login_attempts.attempts+1')
 .replaceAll("substr(datetime(b.paid_at,'+8 hours'),1,10)","to_char(b.paid_at::timestamptz AT TIME ZONE 'Asia/Taipei','YYYY-MM-DD')")
 .replace(/\bwindow\b/g,'"window"');
 if(sql.startsWith('INSERT OR IGNORE INTO '))sql=sql.replace('INSERT OR IGNORE INTO ','INSERT INTO ')+' ON CONFLICT DO NOTHING';
 sql=sql.replace(/\?/g,()=>'$'+(++index));
 return sql;
}
function normal(row){for(const name of ['total','quantity'])if(row[name]!=null)row[name]=Number(row[name]);return row;}
export function createDB(connection){
 const prepare=(text,args=[])=>({
  bind(...values){return prepare(text,values);},
  async all(){return {results:(await connection.unsafe(translate(text),args)).map(normal)};},
  async first(){return (await this.all()).results[0]??null;},
  async run(){const result=await connection.unsafe(translate(text),args);return {meta:{changes:result.count??0}};}
 });
 return {prepare,async batch(statements){const results=[];for(const statement of statements)results.push(await statement.run());return results;}};
}


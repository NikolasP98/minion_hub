import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import postgres from 'postgres';
import {Ledger,makeRequest,validateResponse,hash} from './shadow.mjs';
const home=path.dirname(fileURLToPath(import.meta.url));
const data=process.env.JEV_SHADOW_DATA??'/var/lib/minion-jev-shadow';
fs.mkdirSync(data,{recursive:true,mode:0o700});process.umask(0o077);
const ledger=new Ledger(path.join(data,'ledger.sqlite'));
const config=JSON.parse(fs.readFileSync(process.env.JEV_SHADOW_CONFIG??'/etc/minion/jev-shadow.json','utf8'));
const rubric=JSON.parse(fs.readFileSync(path.join(home,'rubric.json'),'utf8'));
const mode=process.argv[2]??'tick';
function report(){
 const cutoff=new Date(Date.now()-30*86400000).toISOString();
 ledger.db.prepare("update runs set snapshot='{}',request='{}',receipt=null where created_at<? and request!='{}'").run(cutoff);
 for(const file of fs.readdirSync(data))if(/^backup-\d{4}-\d{2}-\d{2}\.sqlite$/.test(file)&&file.slice(7,17)<cutoff.slice(0,10))fs.unlinkSync(path.join(data,file));
 const r=ledger.report();r.empirical_pilot_authorized=config.empiricalPilotAuthorized===true;r.active=config.enabled===true;r.mode=config.empiricalPilotAuthorized===true?'shadow_inference':'readiness_only';r.source_sha=config.sourceSha;r.generated_at=new Date().toISOString();r.review_due=Boolean(r.review_due_at&&Date.parse(r.review_due_at)<=Date.now());r.alerts=[];if(config.enabled&&!config.empiricalPilotAuthorized)r.alerts.push('admission_not_authorized');
 if(!r.last_tick||Date.now()-Date.parse(r.last_tick)>7200000)r.alerts.push('worker_heartbeat_stale');
 if(!r.last_successful_tick||Date.now()-Date.parse(r.last_successful_tick)>7200000)r.alerts.push('source_read_stale');
 if(r.halt_reason)r.alerts.push('pilot_halted');if(r.review_due)r.alerts.push('week_review_due');
 const text=JSON.stringify(r,null,2)+'\n';fs.writeFileSync(path.join(data,'report.json.tmp'),text,{mode:0o600});fs.renameSync(path.join(data,'report.json.tmp'),path.join(data,'report.json'));return r;}
async function call(body){const response=await fetch('https://openrouter.ai/api/alpha/decisions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENROUTER_API_KEY}`},body,signal:AbortSignal.timeout(20000)});
 const reader=response.body?.getReader();if(!reader)throw Error('empty_response');let count=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>32768){await reader.cancel();throw Error('response_bytes_limit');}chunks.push(value);}}finally{reader.releaseLock();}
 if(!response.ok)throw Error(`provider_${response.status}`);return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
let sql;
try{
 if(mode==='backup'){
  const target=path.join(data,'backup-'+new Date().toISOString().slice(0,10)+'.sqlite');if(!fs.existsSync(target))ledger.db.prepare('VACUUM INTO ?').run(target);console.log('Private audit backup complete');
 }else if(mode==='report'){const r=report();console.log(JSON.stringify({calls:r.calls,alerts:r.alerts,review_due_at:r.review_due_at}));}
 else if(mode==='label'){
  const [runId,tag,label,reviewer]=process.argv.slice(3);if(!['positive','negative','unknown'].includes(label)||!reviewer||!rubric.tags.some(t=>t.key===tag)||!ledger.db.prepare("select id from runs where id=? and status='succeeded'").get(runId))throw Error('invalid_label');
  ledger.db.prepare('insert into labels values(?,?,?,?,?) on conflict(run_id,tag) do update set label=excluded.label,reviewer=excluded.reviewer,at=excluded.at').run(runId,tag,label,reviewer,new Date().toISOString());ledger.event('label_changed',{runId,tag,label,reviewer});report();
 }else if(mode==='tick'){
  ledger.set('last_tick',new Date().toISOString());ledger.recover();
  if(!config.enabled){ledger.event('paused');report();}
  else if(ledger.get('halt_reason')){ledger.event('halted_tick',{reason:ledger.get('halt_reason')});report();}
  else{
   ledger.start(config.startedAt,7);
   if(Date.now()>=Date.parse(ledger.get('review_due_at'))){ledger.event('review_due');report();}
   else{
    sql=postgres(process.env.JEV_SHADOW_DATABASE_URL,{max:1,connect_timeout:5,idle_timeout:2,prepare:false,connection:{default_transaction_read_only:'on',statement_timeout:5000,application_name:'minion-jev-shadow'}});
    let candidates=await sql`select jev_shadow_source.page(${ledger.get('cursor')||null}::uuid) as rows`;
    let page=candidates[0].rows;if(!page.length){ledger.set('cursor','');candidates=await sql`select jev_shadow_source.page(null) as rows`;page=candidates[0].rows;}
    let attempted=0;let seen=0;let eligible=0;
    for(const c of page){
     // Move cursor only after source retrieval succeeds. A transient read failure retries this contact next tick.
     const [row]=await sql`select jev_shadow_source.evidence(${c.contact_id}::uuid) as evidence`;
     ledger.set('cursor',c.contact_id);seen++;if(!row.evidence)continue;
     let request;try{request=makeRequest(row.evidence,rubric.tags);}catch(e){ledger.event('context_skipped',{contact:c.contact_id,reason:e.message});continue;}eligible++;
     if(!config.empiricalPilotAuthorized){ledger.event('admission_blocked',{contact:c.contact_id,bytes:request.bytes});continue;}
     if(!process.env.OPENROUTER_API_KEY)throw Error('missing_provider_key');
     const signature=hash(c.contact_id+':'+request.hash);
     const id=ledger.reserve(c.contact_id,signature,{...request.snapshot,baseline_tags:row.evidence.baseline_tags},request.body);if(!id)continue;
     attempted++;const start=Date.now();try{
      const raw=await call(request.body);ledger.db.prepare('update runs set receipt=? where id=?').run(JSON.stringify(raw),id);
      // Preserve a trustworthy reported cost even when semantic/limit validation rejects the result.
      if(Number.isFinite(raw?.usage?.cost)&&raw.usage.cost>=0&&Number.isSafeInteger(Math.ceil(raw.usage.cost*1e6)))ledger.db.prepare('update runs set cost_micro_usd=? where id=?').run(Math.ceil(raw.usage.cost*1e6),id);
      ledger.finish(id,validateResponse(raw,request.keys),Date.now()-start);
     }catch(e){const allowed=/^(invalid_response|invalid_usage|invalid_probability|reported_limit|unknown_cost|reservation_exceeded|response_bytes_limit|empty_response|provider_\d{3})$/;ledger.fail(id,allowed.test(e.message)?e.message:'provider_transport_or_parse_error',Date.now()-start);}
     if(ledger.get('halt_reason')||attempted>=10)break;
    }
    ledger.set('last_successful_tick',new Date().toISOString());ledger.event('tick_completed',{seen,eligible,attempted});const r=report();console.log(JSON.stringify({seen,eligible,attempted,calls:r.calls,alerts:r.alerts}));
   }
  }
 }else throw Error('unknown_mode');
}catch(e){ledger.event('worker_error',{code:/^[A-Z0-9_]{2,30}$/.test(e.code??'')?e.code:'worker_failure'});report();console.error('JEV shadow worker failed; inspect private ledger events');process.exitCode=1;}
finally{if(sql)await sql.end({timeout:2});ledger.close();}

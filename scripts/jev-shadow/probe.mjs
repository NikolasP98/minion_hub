// Authorized synthetic diagnostics only; never reads customer data.
import fs from 'node:fs';import {makeRequest,validateResponse} from './shadow.mjs';
const tags=JSON.parse(fs.readFileSync(new URL('./rubric.json',import.meta.url),'utf8')).tags;
const results=[];
for(const [name,text] of [['spanish','Quiero reservar una cita. ¿Cuál es el precio? '.repeat(35)],['emoji','🙂🧑🏽‍⚕️ '.repeat(60)],['ascii','a1Z![]? 9_@&<>/'.repeat(110)]]){
 const messages=Array.from({length:6},(_,i)=>({source_id:String(i),direction:i%2?'outbound':'inbound',body:text,occurred_at:'2026-09-21T12:00:00Z'}));
 const request=makeRequest({messages},tags);const start=Date.now();
 const response=await fetch('https://openrouter.ai/api/alpha/decisions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENROUTER_API_KEY}`},body:request.body,signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('provider_'+response.status);
 const result=validateResponse(await response.json(),request.keys);
 results.push({name,bytes:request.bytes,input_tokens:result.inputTokens,output_tokens:result.outputTokens,cost_micro_usd:result.costMicroUsd,model:result.model,ms:Date.now()-start});
}
console.log(JSON.stringify({kind:'synthetic_empirical_probe_not_tokenizer_proof',results}));

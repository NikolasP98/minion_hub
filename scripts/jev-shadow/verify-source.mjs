import postgres from 'postgres';
const sql=postgres(process.env.JEV_SHADOW_DATABASE_URL,{max:1,prepare:false,connect_timeout:5});
try{
 const [scope]=await sql`select current_user as role,current_setting('default_transaction_read_only') as read_only,has_table_privilege(current_user,'public.crm_contact_tags','INSERT') as membership_insert,has_table_privilege(current_user,'public.crm_tags','UPDATE') as tag_update,has_table_privilege(current_user,'public.crm_contacts','SELECT') as unrestricted_contacts`;
 if(scope.role!=='minion_jev_shadow'||scope.read_only!=='on'||scope.membership_insert||scope.tag_update||scope.unrestricted_contacts)throw Error('privilege_mismatch');
 const [page]=await sql`select jev_shadow_source.page(null) as rows`;const start=Date.now();let evidence=0;
 if(page.rows.length){const [row]=await sql`select jev_shadow_source.evidence(${page.rows[0].contact_id}::uuid) as evidence`;evidence=row.evidence?.messages?.length??0;}
 console.log(JSON.stringify({...scope,candidate_page_size:page.rows.length,evidence_rows:evidence,evidence_ms:Date.now()-start}));
}catch(e){console.error(JSON.stringify({code:e.code??e.message}));process.exitCode=1;}finally{await sql.end({timeout:2});}

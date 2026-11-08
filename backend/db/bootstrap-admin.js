const db=require('../src/db'),bcrypt=require('bcryptjs'),readline=require('node:readline'),{Writable}=require('node:stream'),{audit}=require('../src/management');
async function main(){
 const email=process.argv[2];if(!email||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Usage: node db/bootstrap-admin.js admin@example.com');
 const output=new Writable({write(chunk,encoding,callback){callback();}}),input=readline.createInterface({input:process.stdin,output,terminal:!!process.stdin.isTTY});
 process.stdout.write('New account password (hidden; ignored if the account exists): ');
 const password=await new Promise(resolve=>input.question('',resolve));input.close();process.stdout.write('\n');
 const client=await db.pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(68421003)');
 const count=await client.query("SELECT count(*)::int AS count FROM users WHERE management_role='superadmin'");if(count.rows[0].count)throw new Error('A superadmin already exists. Bootstrap is disabled.');
 const existing=await client.query('SELECT id,email,management_role FROM users WHERE lower(email)=lower($1) FOR UPDATE',[email]);let id;
 if(existing.rowCount){id=existing.rows[0].id;await client.query("UPDATE users SET management_role='superadmin',auth_version=auth_version+1 WHERE id=$1",[id]);}
 else{if(password.length<12||password.length>128)throw new Error('Use a password of 12–128 characters.');id=(await client.query("INSERT INTO users(email,password_hash,real_name,management_role) VALUES($1,$2,'AURA Superadmin','superadmin') RETURNING id",[email.toLowerCase(),await bcrypt.hash(password,12)])).rows[0].id;}
 await audit(client,{id,email},'superadmin_bootstrapped','account',id,'Initial local setup',{role:'superadmin'});await client.query('COMMIT');console.log('Superadmin ready. Sign in using the regular login page, then open /admin.');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>db.pool.end());

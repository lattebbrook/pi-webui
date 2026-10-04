import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';
const root=mkdtempSync(join(tmpdir(),'omp-login-test-'));
const script=join(root,'fake-omp.cjs');
writeFileSync(script,`#!/usr/bin/env node
const send=(v)=>console.log(JSON.stringify(v));
let loginId;
require('readline').createInterface({input:process.stdin}).on('line',(line)=>{
 const c=JSON.parse(line);
 if(c.type==='login') {loginId=c.id;send({type:'extension_ui_request',method:'input',id:'code',title:'Paste code'});}
 if(c.type==='extension_ui_response') send({type:'response',id:loginId,command:'login',success:c.value==='test-code',data:{},error:'Invalid test code'});
});
send({type:'ready'});
`,{mode:0o700});
let binary=script;
if(process.platform==='win32') {binary=join(root,'omp.cmd');writeFileSync(binary,`@"${process.execPath}" "${script}" %*\r\n`);}
process.env.PI_WEBUI_OMP_BIN=binary;
process.env.PI_WEBUI_OMP_AGENT_DIR=root;
const jiti=createJiti(import.meta.url,{tsconfigPaths:true});
const route=await jiti.import('../../app/api/omp/auth/login/[provider]/route.ts');
test.after(()=>rmSync(root,{recursive:true,force:true}));
const params=(provider='test-provider')=>({params:Promise.resolve({provider})});
function post(token,code='test-code') {return new Request('http://localhost:30141/api/omp/auth/login/test-provider',{method:'POST',headers:{host:'localhost:30141','Content-Type':'application/json'},body:JSON.stringify({token,code})});}
test('native login bridges prompts, binds tokens to providers, and cleans up after success', {timeout:10000}, async()=>{
 const abort=new AbortController();
 const res=await route.GET(new Request('http://localhost:30141/api/omp/auth/login/test-provider',{signal:abort.signal,headers:{host:'localhost:30141'}}),params());
 assert.equal(res.status,200);
 const reader=res.body.getReader();
 try {
  const first=new TextDecoder().decode((await reader.read()).value);
  const prompt=JSON.parse(first.split('data: ')[1].trim());
  assert.equal(prompt.type,'prompt_request');
  assert.equal((await route.POST(post(prompt.token),params('different-provider'))).status,400);
  assert.equal((await route.POST(post(prompt.token),params())).status,200);
  let events='';for(;;){const next=await reader.read();if(next.done)break;events+=new TextDecoder().decode(next.value);}
  assert.match(events,/"type":"success"/);
  assert.equal((await route.POST(post(prompt.token),params())).status,404);
 } finally {abort.abort();await reader.cancel();}
});
test('native login refuses cross-site initiation and non-JSON input',async()=>{
 const cross=new Request('http://localhost:30141/api/omp/auth/login/test-provider',{headers:{origin:'https://evil.example'}});
 assert.equal((await route.GET(cross,params())).status,403);
 assert.equal((await route.POST(new Request('http://localhost:30141/api/omp/auth/login/test-provider',{method:'POST',headers:{host:'localhost:30141'}}),params())).status,415);
});

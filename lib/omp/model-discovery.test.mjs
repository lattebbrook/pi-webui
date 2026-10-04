import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';
const dir = mkdtempSync(join(tmpdir(), 'omp-discovery-test-'));
process.env.PI_WEBUI_OMP_AGENT_DIR = dir;
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { discoverOmpModels } = await jiti.import('./model-discovery.ts');
const { STORED_SECRET } = await jiti.import('./models-config.ts');
let requests = [];
const server = createServer((req, res) => {
  requests.push({ url:req.url, auth:req.headers.authorization });
  if (req.url.startsWith('/redirect/')) { res.writeHead(302,{location:'/v1/models'}); res.end(); return; }
  if (req.url.startsWith('/fail/')) { res.writeHead(401); res.end('private-upstream-secret'); return; }
  res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify({data:[{id:'local-test',name:'Local test'}]}));
});
await new Promise((r) => server.listen(0,'127.0.0.1',r));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const request = (provider, extra={}) => new Request('http://localhost:30141/api/omp/models-config/discover', {method:'POST',headers:{'Content-Type':'application/json',host:'localhost:30141'},body:JSON.stringify({providerName:'local',provider,...extra})});
test.after(() => { server.close(); rmSync(dir,{recursive:true,force:true}); });
test('local discovery and model availability use the supplied endpoint without Pi credentials', async () => {
  writeFileSync(join(dir,'models.yml'),'providers: {}\n');
  const result = await discoverOmpModels(request({baseUrl,auth:'none',api:'openai-completions'}));
  assert.deepEqual(result.models,[{id:'local-test',name:'Local test'}]);
  assert.equal(requests.at(-1).auth,undefined);
  assert.equal(requests.at(-1).url,'/v1/models');
});
test('stored secrets only resolve against their saved endpoint and stay out of responses', async () => {
  writeFileSync(join(dir,'models.yml'),`providers:\n  local:\n    baseUrl: ${baseUrl}\n    api: openai-completions\n    apiKey: private-key\n`);
  const provider = {baseUrl,api:'openai-completions',apiKey:STORED_SECRET};
  const result = await discoverOmpModels(request(provider));
  assert.equal(requests.at(-1).auth,'Bearer private-key');
  assert(!JSON.stringify(result).includes('private-key'));
  const count = requests.length;
  await assert.rejects(discoverOmpModels(request({...provider,baseUrl:baseUrl+'/other'})), /Save the changed endpoint/);
  assert.equal(requests.length,count);
});
test('discovery rejects command evaluation, redirects, untrusted requests and raw upstream errors', async () => {
  const count = requests.length;
  await assert.rejects(discoverOmpModels(request({baseUrl,apiKey:'!echo private-command'})), /only by OMP/);
  assert.equal(requests.length,count);
  await assert.rejects(discoverOmpModels(request({baseUrl:baseUrl.replace('/v1','/redirect')})), (e)=>e.status===502);
  await assert.rejects(discoverOmpModels(request({baseUrl:baseUrl.replace('/v1','/fail')})), (e)=>e.status===502 && !e.message.includes('private-upstream-secret'));
  await assert.rejects(discoverOmpModels(new Request('http://localhost:30141/api/omp/models-config/discover',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})), (e)=>e.status===403);
});

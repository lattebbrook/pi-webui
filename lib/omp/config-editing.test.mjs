import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "pi-webui-omp-config-"));
process.env.PI_WEBUI_OMP_AGENT_DIR = root;
const fake = join(root, "omp");
writeFileSync(fake, `#!/usr/bin/env node\nconsole.log(JSON.stringify({
  'bash.enabled': {type:'boolean', value:true, description:'Shell'},
  'grep.enabled': {type:'boolean', value:true},
  'defaultThinkingLevel': {type:'enum', value:'low'},
  'modelRoles': {type:'record', value:{default:'local/model', advisor:'local/reviewer'}},
  'enabledModels': {type:'array', value:[]},
  'auth.secret': {type:'string', value:'should-never-appear'},
  'retry.maxRetries': {type:'number', value:3},
  'tools.approval': {type:'record', value:{}},
}));\n`, { mode: 0o700 });
process.env.PI_WEBUI_OMP_BIN = fake;
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const store = await jiti.import("./config-store.ts");
const models = await jiti.import("./models-config.ts");
const settings = await jiti.import("./settings-config.ts");
const api = await jiti.import("./config-api.ts");
const modelRoute = await jiti.import("../../app/api/omp/models-config/route.ts");
const settingRoute = await jiti.import("../../app/api/omp/settings/route.ts");
test.after(() => rmSync(root, { recursive: true, force: true }));
const path = join(root, "config.yml");
const modelPath = join(root, "models.yml");

test("native schema exposes only reviewed settings; saving preserves comments, roles and unknown fields", async () => {
  writeFileSync(path, '# keep this comment\nmodelRoles:\n  default: local/model\n  advisor: local/reviewer\ncustom: {retained: true}\nbash:\n  enabled: true # keep shell comment\n');
  const before = readFileSync(path, "utf8");
  const snapshot = await settings.readOmpSettings();
  assert(!JSON.stringify(snapshot).includes("should-never-appear"));
  const result = await settings.writeOmpSettings({ "bash.enabled": false }, snapshot.revision);
  const source = readFileSync(path, "utf8");
  assert.match(source, /keep this comment/); assert.match(source, /keep shell comment/);
  assert.match(source, /advisor: local\/reviewer/); assert.match(source, /retained: true/);
  assert.equal(store.readOmpDocument(path).value.bash.enabled, false);
  assert.equal(readFileSync(result.backupPath, "utf8"), before);
  assert.equal((await (await import('node:fs/promises')).stat(result.backupPath)).mode & 0o777, 0o600);
});

test("stale saves and concurrent edits cannot overwrite each other", async () => {
  writeFileSync(path, 'bash: {enabled: true}\ngrep: {enabled: true}\n');
  const rev = store.readOmpDocument(path).revision;
  const results = await Promise.allSettled([
    settings.writeOmpSettings({ "bash.enabled": false }, rev),
    settings.writeOmpSettings({ "grep.enabled": false }, rev),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.status, 409);
});

test("invalid YAML, unknown keys and invalid types leave original files unchanged", async () => {
  writeFileSync(path, 'secret: [broken\n');
  assert.throws(() => store.readOmpDocument(path), (e) => e.status === 422 && !e.message.includes('broken'));
  writeFileSync(path, 'bash: {enabled: true}\n');
  const original = readFileSync(path, "utf8"); const rev = store.readOmpDocument(path).revision;
  for (const changes of [{ "auth.secret": "oops" }, { "bash.enabled": "false" }, { "retry.maxRetries": -1 }, { enabledModels: [{ selector: "local/*" }] }, { "tools.approval": { bash: "typo" } }]) {
    await assert.rejects(settings.writeOmpSettings(changes, rev));
    assert.equal(readFileSync(path, "utf8"), original);
  }
});

test("reset clears nested and legacy dotted values; a symlink stays a symlink", async () => {
  const target = join(root, "linked.yml"); writeFileSync(target, 'bash.enabled: false\nbash:\n  enabled: false\n  other: retained\n');
  rmSync(path); symlinkSync(target, path);
  await settings.writeOmpSettings({ "bash.enabled": null }, store.readOmpDocument(path).revision);
  assert.equal((await (await import('node:fs/promises')).lstat(path)).isSymbolicLink(), true);
  assert.deepEqual(store.readOmpDocument(path).value, { bash: { other: "retained" } });
  rmSync(path); writeFileSync(path, '{}\n');
});

test("provider edits retain credentials and comments across model reordering; invalid configs are refused", async () => {
  writeFileSync(modelPath, `# provider file\nother: retained\nproviders:\n  local:\n    baseUrl: http://127.0.0.1:1234/v1\n    api: openai-completions\n    apiKey: '!do-not-execute-me'\n    headers: {Authorization: 'private-header'}\n    custom: retained\n    models:\n      - id: first # first model comment\n        contextWindow: 131072\n        headers: {Authorization: 'first-private'}\n      - id: second # second model comment\n        contextWindow: 65536\n`);
  const snapshot = models.readOmpModelsConfig();
  assert(!JSON.stringify(snapshot).includes('private-header')); assert(!JSON.stringify(snapshot).includes('do-not-execute'));
  const provider = structuredClone(snapshot.providers.local);
  provider.models.reverse(); provider.models[0].contextWindow = 131072;
  await models.writeOmpProvider('local', provider, snapshot.revision);
  const edited = store.readOmpDocument(modelPath).value;
  assert.equal(edited.providers.local.apiKey, '!do-not-execute-me');
  assert.equal(edited.providers.local.headers.Authorization, 'private-header');
  assert.equal(edited.providers.local.models[1].headers.Authorization, 'first-private');
  assert.equal(edited.other, 'retained');
  const source = readFileSync(modelPath, 'utf8');
  assert.match(source, /second # second model comment/); assert.match(source, /first # first model comment/);
  for (const bad of [{ ...provider, models: [{ id:'dupe' }, { id:'dupe' }] }, { ...provider, models: [{ id:'bad', contextWindow:-1 }] }]) {
    await assert.rejects(models.writeOmpProvider('local', bad, store.readOmpDocument(modelPath).revision));
    assert.equal(readFileSync(modelPath,'utf8'),source);
  }
  assert(readdirSync(root).some((p) => p.startsWith('models.yml.backup-webui-')));
});

test("adding/removing a provider preserves other providers; URLs with credentials are masked", async () => {
  assert.equal(models.redactModelSecrets('https://user:password@local.invalid'), models.STORED_SECRET);
  assert.equal(models.redactModelSecrets('https://local.invalid?api_key=secret'), models.STORED_SECRET);
  const local = models.readOmpModelsConfig().providers.local;
  await models.writeOmpProvider('new-local', { baseUrl:'http://127.0.0.1:1234/v1', auth:'none', api:'openai-completions', models:[{id:'test',contextWindow:131072,maxTokens:8192,input:['text']}] }, models.readOmpModelsConfig().revision);
  await models.writeOmpProvider('new-local', null, models.readOmpModelsConfig().revision);
  assert.deepEqual(models.readOmpModelsConfig().providers, {local});
  await assert.rejects(models.writeOmpProvider('__proto__', {}, models.readOmpModelsConfig().revision));
});

function req(url, body, headers = {}) { return new Request(`http://localhost:30141${url}`, {method:'PUT',headers:{host:'localhost:30141','content-type':'application/json',...headers},body:JSON.stringify(body)}); }
test("configuration API rejects cross-site writes, non-JSON and invalid revisions", async () => {
  const before = readFileSync(modelPath, 'utf8');
  const response = await modelRoute.PUT(req('/api/omp/models-config',{revision:models.readOmpModelsConfig().revision,name:'local',provider:null},{origin:'https://untrusted.invalid','sec-fetch-site':'cross-site'}));
  assert.equal(response.status,403); assert.equal(readFileSync(modelPath,'utf8'),before);
  assert.equal((await settingRoute.PUT(req('/api/omp/settings',{}, {'content-type':'text/plain'}))).status,415);
  assert.equal((await settingRoute.PUT(req('/api/omp/settings',{changes:{'bash.enabled':false}}))).status,400);
  const saved = await settingRoute.PUT(req('/api/omp/settings',{revision:store.readOmpDocument(path).revision,changes:{'bash.enabled':false}}));
  assert.equal(saved.status,200);
  const stale = await settingRoute.PUT(req('/api/omp/settings',{revision:'stale',changes:{'bash.enabled':true}}));
  assert.equal(stale.status,409);
  const result = await api.ompConfigRequest(req('/x',{revision:'test'})); assert.equal(result.revision,'test');
});

test("bulk provider saves are atomic and preserve untouched secrets and YAML comments", async () => {
  writeFileSync(modelPath, '# custom providers\nother: keep\nproviders:\n  old:\n    apiKey: private-key # preserve key comment\n  remove-me: {}\n');
  const snapshot = models.readOmpModelsConfig();
  const next = { old: snapshot.providers.old, local: { baseUrl:'http://localhost:1234/v1', api:'openai-completions', auth:'none', models:[{id:'local-model'}] } };
  const result = await models.writeOmpProviders(next, snapshot.revision);
  const saved = store.readOmpDocument(modelPath);
  assert.equal(saved.value.providers.old.apiKey, 'private-key');
  assert.equal(saved.value.providers['remove-me'], undefined);
  assert.equal(saved.value.other, 'keep');
  assert.match(readFileSync(modelPath,'utf8'), /preserve key comment/);
  assert.match(readFileSync(result.backupPath,'utf8'), /remove-me/);
  const before = readFileSync(modelPath,'utf8');
  await assert.rejects(models.writeOmpProviders({ ...next, broken: {models:[{id:''}]} }, saved.revision));
  assert.equal(readFileSync(modelPath,'utf8'), before);
  await assert.rejects(models.writeOmpProviders(next, snapshot.revision), (e) => e.status === 409);
});

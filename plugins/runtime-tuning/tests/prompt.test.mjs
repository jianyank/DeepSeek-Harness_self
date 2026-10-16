import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as tuning from '../index.js';
import * as cache from '../../cache-prefix/index.js';
const root = path.resolve(import.meta.dirname, '../../..');
const native = name => import(pathToFileURL(path.join(process.env.DSH_NATIVE_ROOT || path.join(root, 'sdk/node_modules/@deepseek-ai'), name, 'lib/index.js')));
const { Context } = await native('cordis');
const { SystemPrompt, renderPrompt } = await native('dsh-system-prompt');
const wording = [
  "The complete, self-contained task for the subagent. It does not share this conversation's context, so include everything it needs.",
  "The task for the subagent. It already sees this conversation's completed turns, so build on them freely and state only what is new."
];
function tools() {
  return wording.map((description, i) => ({name: i ? 'subagent_fork' : 'subagent', description: 'Native scheduling and model routing stay here.', parameters: {type: 'object', properties: {prompt: {type: 'string', description}, run_in_background: {type: 'boolean', description: 'Defaults to true.'}}, required: ['prompt']}}));
}
async function host(t, provider = 'deepseek-official') {
  const ctx = new Context();
  const prompt = await ctx.plugin(SystemPrompt, {});
  t.after(() => prompt.dispose());
  if (provider !== null) ctx.systemPrompt.variable('provider', () => provider);
  const mounted = await ctx.plugin(tuning);
  t.after(() => mounted.dispose());
  return {ctx, mounted};
}
test('official coding instruction is short, stable and preserves existing policies', async t => {
  const {ctx} = await host(t);
  ctx.systemPrompt.section({name: 'mode', order: 500, text: 'PLAN MODE: read only; no edits.'});
  const first = await ctx.systemPrompt.assemble();
  const policy = first.sections.find(s => s.name === 'runtime-tuning:coding');
  assert.ok(policy);
  assert.ok(policy.text.length <= 320);
  assert.match(policy.text, /inspect/i);
  assert.match(policy.text, /smallest/i);
  assert.match(policy.text, /comments/i);
  assert.match(policy.text, /checks/i);
  assert.match(policy.text, /unverified/i);
  assert.match(renderPrompt(first), /PLAN MODE: read only; no edits/);
  assert.deepEqual(first, await ctx.systemPrompt.assemble());
});
test('account and other providers keep their original coding sections', async t => {
  for (const provider of ['deepseek-account', 'openai', null]) {
    const {ctx, mounted} = await host(t, provider);
    const before = await ctx.systemPrompt.assemble();
    await mounted.dispose();
    assert.deepEqual(before, await ctx.systemPrompt.assemble());
  }
});
test('spawn and fork tasks gain scope and acceptance criteria without changing routing or scheduling', async t => {
  const {ctx} = await host(t);
  const source = tools(), before = structuredClone(source);
  ctx.systemPrompt.tools(() => ({schemas: source}));
  const assembly = await ctx.systemPrompt.assemble();
  for (const tool of assembly.tools) {
    const original = before.find(s => s.name === tool.name);
    assert.equal(tool.description, original.description);
    assert.deepEqual(tool.parameters.properties.run_in_background, original.parameters.properties.run_in_background);
    assert.deepEqual(tool.parameters.required, original.parameters.required);
    assert.match(tool.parameters.properties.prompt.description, /scope|allowed edits/i);
    assert.match(tool.parameters.properties.prompt.description, /checks/i);
    assert.match(tool.parameters.properties.prompt.description, /changed paths/i);
  }
  const spawn = assembly.tools.find(s => s.name === 'subagent').parameters.properties.prompt.description;
  const fork = assembly.tools.find(s => s.name === 'subagent_fork').parameters.properties.prompt.description;
  assert.match(spawn, /self-contained/i);
  assert.match(fork, /completed turns/i);
  assert.match(fork, /current turn/i);
  assert.deepEqual(source, before);
  const extraChars = assembly.sections.find(s => s.name === 'runtime-tuning:coding').text.length + spawn.length + fork.length - wording.join('').length;
  assert.ok(extraChars <= 375, String(extraChars));
});
test('unknown custom task descriptions and unrelated schemas stay untouched', async t => {
  const {ctx} = await host(t);
  const source = [{...tools()[0], parameters: {type: 'object', properties: {prompt: {type: 'string', description: 'Custom semantics'}}}}];
  ctx.systemPrompt.tools(() => ({schemas: source}));
  assert.deepEqual((await ctx.systemPrompt.assemble()).tools, source);
});
test('native complete prompt overrides coding guidance; context stays live; unloading restores tools', async t => {
  const {ctx, mounted} = await host(t);
  let live = 'old';
  const source = tools();
  ctx.systemPrompt.tools(() => ({schemas: source}));
  ctx.systemPrompt.context({name: 'memory', order: 100, text: () => live});
  ctx.systemPrompt.section({name: 'complete', order: 1, text: 'Complete override', complete: true});
  assert.deepEqual((await ctx.systemPrompt.assemble()).sections, [{name: 'complete', text: 'Complete override'}]);
  live = 'new';
  assert.equal((await ctx.systemPrompt.assemble()).contexts[0].text, 'new');
  await mounted.dispose();
  assert.deepEqual((await ctx.systemPrompt.assemble()).tools, source.slice().sort((a,b) => a.name.localeCompare(b.name)));
});
test('cache plugin composition remains byte stable with changing schemas', async t => {
  const {ctx} = await host(t);
  const mounted = await ctx.plugin(cache);
  t.after(() => mounted.dispose());
  let source = tools();
  ctx.systemPrompt.tools(() => ({schemas: source}));
  const first = await ctx.systemPrompt.assemble();
  source = tools().map(s => ({...s, parameters: Object.fromEntries(Object.entries(s.parameters).reverse())}));
  const second = await ctx.systemPrompt.assemble();
  assert.equal(JSON.stringify(first.tools), JSON.stringify(second.tools));
  source[0].parameters.properties.prompt.description = 'New custom instructions';
  assert.match(JSON.stringify((await ctx.systemPrompt.assemble()).tools), /New custom instructions/);
});

test('final scoped route controls official guidance through provider switches', async t => {
  const {ctx} = await host(t, 'deepseek-account');
  const {installModelSelection} = await native('dsh-agent');
  const scoped = ctx.extend();
  const selection = {current: {provider: 'deepseek-official', model: 'deepseek-flash'}};
  t.after(installModelSelection(scoped, selection));
  assert.ok((await ctx.systemPrompt.assemble({scope: scoped})).sections.some(s => s.name === 'runtime-tuning:coding'));
  selection.current = {provider: 'deepseek-account', model: 'deepseek-flash'};
  assert.ok(!(await ctx.systemPrompt.assemble({scope: scoped})).sections.some(s => s.name === 'runtime-tuning:coding'));
});

test('real subagent tool schemas retain continuations and receive task guidance', async t => {
  const {ctx} = await host(t);
  const {ToolRuntime} = await native('dsh-tools');
  const subagent = await native('dsh-tool-subagent');
  const runtime = await ctx.plugin(ToolRuntime, {});
  t.after(() => runtime.dispose());
  const providers = new Map(['spawn','fork'].map(name => [name,{name, inheritsParentContext:name==='fork', capabilities:{depthLimit:true,agentOptions:true}, prepareContinuable:async()=>{throw new Error('not executed')}}]));
  ctx.reflect.provide('subagents',{getProvider:name=>providers.get(name),resolveMaxDepth:()=>1});
  ctx.reflect.provide('sessionProjections',{register:()=>{}});
  for (const provider of providers.keys()) {
    const mounted = await ctx.plugin(subagent,{provider,toolName:provider==='fork'?'subagent_fork':'subagent',backgroundMode:'continuable'});
    t.after(() => mounted.dispose());
  }
  const first=await ctx.systemPrompt.assemble();
  assert.equal(first.tools.length,2);
  for (const tool of first.tools) {
    assert.match(tool.description,/send_message/);
    assert.match(tool.parameters.properties.prompt.description,/acceptance checks/);
    assert.match(tool.parameters.properties.run_in_background.description,/Defaults to true/);
  }
  assert.match(renderPrompt(first),/continue useful work/);
});

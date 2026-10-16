import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as plugin from '../index.js';

const root = path.resolve(import.meta.dirname, '../../..');
const nativeRoot = process.env.DSH_NATIVE_ROOT || path.join(root, 'sdk/node_modules/@deepseek-ai');
const native = name => import(pathToFileURL(path.join(nativeRoot, name, 'lib/index.js')));
const { Context } = await native('cordis');
const { SystemPrompt } = await native('dsh-system-prompt');
const { canonicalHeader, headerEquals } = await native('dsh-session');

async function host(t, provider = 'deepseek-official') {
  const ctx = new Context();
  const prompt = await ctx.plugin(SystemPrompt, {});
  t.after(() => prompt.dispose());
  if (provider !== null) ctx.systemPrompt.variable('provider', () => provider);
  const mounted = await ctx.plugin(plugin);
  t.after(() => mounted.dispose());
  return ctx;
}

function schemas(reversed) {
  const fields = [['type', 'object'], ['properties', Object.fromEntries((reversed
    ? [['path', { description: 'Absolute path', type: 'string' }], ['limit', { minimum: 1, type: 'integer' }]]
    : [['limit', { type: 'integer', minimum: 1 }], ['path', { type: 'string', description: 'Absolute path' }]]))], ['required', ['path']]];
  return [{ name: 'read_file', description: 'Read a file', parameters: Object.fromEntries(reversed ? fields.reverse() : fields) }];
}

const header = assembly => canonicalHeader({ config: { provider: 'deepseek-official', model: 'deepseek-flash' }, tools: assembly.tools });

test('equivalent schemas keep native request headers stable across property insertion orders', async t => {
  const ctx = await host(t);
  let reversed = false;
  ctx.systemPrompt.tools(() => ({ schemas: schemas(reversed) }));
  const first = await ctx.systemPrompt.assemble();
  reversed = true;
  const second = await ctx.systemPrompt.assemble();
  assert.deepEqual(first.tools, second.tools);
  assert.equal(headerEquals(header(first), header(second)), true, 'JSON key order alone must not restart the request series');
  assert.equal(JSON.stringify(first.tools), JSON.stringify(second.tools), 'wire declarations must be byte-stable');
});


test('real parameter changes still change the native request header immediately', async t => {
  const ctx = await host(t);
  let tools = schemas(false);
  ctx.systemPrompt.tools(() => ({ schemas: tools }));
  const first = await ctx.systemPrompt.assemble();
  tools = structuredClone(tools);
  tools[0].parameters.properties.limit.minimum = 2;
  const second = await ctx.systemPrompt.assemble();
  assert.equal(headerEquals(header(first), header(second)), false);
  assert.equal(second.tools[0].parameters.properties.limit.minimum, 2);
});

test('nested schemas preserve arrays, prose, booleans, unusual keys and source objects', async t => {
  const ctx = await host(t);
  const parameters = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"},"value":{"anyOf":[{"type":"string","description":"keep  spaces\\n"},{"type":"integer"}],"enum":["z","a"],"default":{"z":2,"a":1}},"flag":false},"required":["value","__proto__"],"additionalProperties":false}');
  const before = JSON.stringify(parameters);
  ctx.systemPrompt.tools(() => ({ schemas: [{ name: 'inspect', description: 'Do not change text', parameters, deferLoading: true }] }));
  const { tools: [tool] } = await ctx.systemPrompt.assemble();
  assert.deepEqual(tool.parameters, parameters);
  assert.equal(JSON.stringify(parameters), before);
  assert.deepEqual(Object.keys(tool.parameters.properties), ['__proto__', 'flag', 'value']);
  assert.deepEqual(tool.parameters.properties.value.enum, ['z', 'a']);
  assert.deepEqual(tool.parameters.required, ['value', '__proto__']);
  assert.equal(tool.parameters.properties.value.anyOf[0].type, 'string');
  assert.equal(tool.parameters.properties.value.anyOf[0].description, parameters.properties.value.anyOf[0].description);
  assert.equal(Object.hasOwn(tool.parameters.properties, '__proto__'), true);
  assert.equal(tool.deferLoading, true);
});

for (const provider of ['deepseek-account', 'third-party', null]) {
  test('unrelated provider keeps original tool serialization: ' + String(provider ?? 'unselected'), async t => {
    const ctx = await host(t, provider);
    const input = schemas(false);
    ctx.systemPrompt.tools(() => ({ schemas: input }));
    assert.equal(JSON.stringify((await ctx.systemPrompt.assemble()).tools), JSON.stringify(input));
  });
}

test('final scoped model selection controls optimization on both provider switches', async t => {
  const ctx = await host(t, 'third-party');
  const { installModelSelection } = await native('dsh-agent');
  const selection = { current: { provider: 'deepseek-official', model: 'deepseek-flash' } };
  const scoped = ctx.extend();
  const dispose = installModelSelection(scoped, selection);
  t.after(dispose);
  let reversed = false;
  ctx.systemPrompt.tools(() => ({ schemas: schemas(reversed) }));
  const first = await ctx.systemPrompt.assemble({ scope: scoped });
  reversed = true;
  const second = await ctx.systemPrompt.assemble({ scope: scoped });
  assert.equal(JSON.stringify(first.tools), JSON.stringify(second.tools));
  selection.current = { provider: 'third-party', model: 'another-model' };
  const other = await ctx.systemPrompt.assemble({ scope: scoped });
  assert.equal(JSON.stringify(other.tools), JSON.stringify(schemas(true)));
});

test('live mode, time, memory and folder context remain fresh and scoped to each session', async t => {
  const ctx = await host(t);
  const { renderPrompt, renderContextSnapshot } = await native('dsh-system-prompt');
  let mode = 'plan', time = '2026-10-15T10:00:00+08:00', folders = ['D:/project/a'], memory = 'old memory';
  ctx.systemPrompt.section({ name: 'mode-policy', order: 500, text: () => mode });
  ctx.systemPrompt.context({ name: 'test-time', order: 100, text: () => time });
  ctx.systemPrompt.context({ name: 'test-memory', order: 200, text: () => memory });
  ctx.systemPrompt.context({ name: 'test-folders', order: 180, text: context => context.agent.session.id === 'a' ? JSON.stringify(folders) : 'D:/project/b' });
  ctx.systemPrompt.tools(() => ({ schemas: schemas(false) }));
  const first = await ctx.systemPrompt.assemble({ agent: { session: { id: 'a' } } });
  mode = 'execute'; time = '2026-10-15T10:01:00+08:00'; folders = ['D:/project/extra']; memory = 'new memory';
  const second = await ctx.systemPrompt.assemble({ agent: { session: { id: 'a' } } });
  const other = await ctx.systemPrompt.assemble({ agent: { session: { id: 'b' } } });
  assert.match(renderPrompt(first), /plan/);
  assert.match(renderPrompt(second), /execute/);
  assert.equal(JSON.stringify(first.tools), JSON.stringify(second.tools));
  assert.match(renderContextSnapshot(second), /10:01:00/);
  assert.match(renderContextSnapshot(second), /new memory/);
  assert.match(renderContextSnapshot(second), /project\/extra/);
  assert.doesNotMatch(renderContextSnapshot(second), /project\/a/);
  assert.match(renderContextSnapshot(other), /project\/b/);
  assert.doesNotMatch(renderContextSnapshot(other), /project\/extra/);
});

test('native tool ordering and complete prompt semantics are unchanged', async t => {
  const ctx = await host(t);
  ctx.systemPrompt.section({ name: 'complete', order: 1, text: 'Authoritative prompt', complete: true });
  ctx.systemPrompt.tools(() => ({ schemas: [
    { name: 'z_tool', description: 'Last', parameters: true },
    { name: 'a_tool', description: 'First', parameters: false },
  ] }));
  const assembly = await ctx.systemPrompt.assemble();
  assert.deepEqual(assembly.tools.map(tool => tool.name), ['a_tool', 'z_tool']);
  assert.equal(assembly.tools[0].parameters, false);
  assert.equal(assembly.tools[1].parameters, true);
  assert.deepEqual(assembly.sections, [{ name: 'complete', text: 'Authoritative prompt' }]);
});

test('unloading restores native behavior and empty toolsets remain empty', async t => {
  const ctx = new Context();
  const prompt = await ctx.plugin(SystemPrompt, {});
  t.after(() => prompt.dispose());
  ctx.systemPrompt.variable('provider', () => 'deepseek-official');
  const mounted = await ctx.plugin(plugin);
  t.after(() => mounted.dispose());
  assert.deepEqual((await ctx.systemPrompt.assemble()).tools, []);
  let reversed = false;
  ctx.systemPrompt.tools(() => ({ schemas: schemas(reversed) }));
  const first = await ctx.systemPrompt.assemble();
  await mounted.dispose();
  reversed = true;
  const unmounted = await ctx.systemPrompt.assemble();
  assert.equal(JSON.stringify(unmounted.tools), JSON.stringify(schemas(true)));
  assert.equal(headerEquals(header(first), header(unmounted)), false);
});


test('tools added, removed or edited remain immediately visible without stale declarations', async t => {
  const ctx = await host(t);
  let current = schemas(false);
  ctx.systemPrompt.tools(() => ({ schemas: current }));
  const first = await ctx.systemPrompt.assemble();
  current = [...current, { name: 'new_tool', description: 'Fresh tool', parameters: { type: 'object', properties: {} }, deferLoading: true }];
  const added = await ctx.systemPrompt.assemble();
  assert.deepEqual(added.tools.map(tool => tool.name), ['new_tool', 'read_file']);
  assert.equal(added.tools[0].deferLoading, true);
  assert.equal(headerEquals(header(first), header(added)), false);
  current = [{ ...current[1], description: 'Updated tool' }];
  const removed = await ctx.systemPrompt.assemble();
  assert.deepEqual(removed.tools.map(tool => tool.name), ['new_tool']);
  assert.equal(removed.tools[0].description, 'Updated tool');
  assert.equal(headerEquals(header(added), header(removed)), false);
});

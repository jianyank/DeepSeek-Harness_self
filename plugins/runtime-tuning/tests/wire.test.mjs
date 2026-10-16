import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as plugin from '../index.js';
import * as cache from '../../cache-prefix/index.js';

const root = path.resolve(import.meta.dirname, '../../..');
const nativeRoot = process.env.DSH_NATIVE_ROOT || path.join(root, 'sdk/node_modules/@deepseek-ai');
const native = name => import(pathToFileURL(path.join(nativeRoot, name, 'lib/index.js')));
const { Context } = await native('cordis');
const { SystemPrompt, renderPrompt, renderContextSnapshot } = await native('dsh-system-prompt');
const { DeepSeekAdapter, resolveAdapterOptions } = await native('dsh-llm-deepseek');
const { DeepSeekLlmApiExtensionRegistry } = await native('dsh-deepseek-llm-api-extensions');
const inventory = await native('dsh-plugin-package-inventory-deepseek');
const { createUserMessage, createSystemMessage, createAssistantMessage, createToolResultMessage } = await native('dsh-llm');

for (const model of ['deepseek-flash']) {
  test('real Messages adapter preserves prefix, thinking and tool/result pairing: ' + model, async t => {
    const requests = [];
    const server = http.createServer(async (req, res) => {
      let raw = '';
      for await (const part of req) raw += part;
      requests.push({ path: req.url, body: JSON.parse(raw) });
      const events = [
        { type: 'message_start', message: { id: 'local-response', role: 'assistant', model, content: [], usage: { input_tokens: 10, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(events.map(event => 'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n').join(''));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const connection = resolveAdapterOptions({ baseURL: 'http://127.0.0.1:' + server.address().port + '/anthropic', maxTokens: 1024 });
    const adapter = new DeepSeekAdapter({ options: () => connection,
      resolveAuth: async () => ({ headers: { 'x-api-key': 'local-test-only' } }),
      resolveUserId: () => 'local-test', resolveFiles: () => ({}),
      prepareExtensions: request => ctx.deepseekLlmApiExtensions.prepare(request) });
    const ctx = new Context();
    const extensions = await ctx.plugin(DeepSeekLlmApiExtensionRegistry);
    t.after(() => extensions.dispose());
    const tree = { ctx: { baseUrl: pathToFileURL(root + '/').href } };
    tree.entries = () => ['runtime-tuning', 'cache-prefix', 'project-folders'].map(name => ({
      options: { name: pathToFileURL(path.join(root, 'plugins', name, 'index.js')).href },
      parent: { tree }, fiber: { state: 2 }
    }));
    inventory.apply({ loader: tree, baseUrl: tree.ctx.baseUrl, get: () => undefined,
      deepseekLlmApiExtensions: ctx.deepseekLlmApiExtensions }, { enabled: true });
    const prompt = await ctx.plugin(SystemPrompt, {});
    const mounted = await ctx.plugin(plugin);
    const cacheMounted = await ctx.plugin(cache);
    t.after(() => cacheMounted.dispose());
    t.after(async () => { await mounted.dispose(); await prompt.dispose(); });
    ctx.systemPrompt.variable('provider', () => 'deepseek-official');
    let reversed = false, currentTime = '2026-10-15T10:00:00+08:00';
    ctx.systemPrompt.tools(() => ({ schemas: [{ name: 'read_file', description: 'Read a file', parameters: Object.fromEntries(reversed
      ? [['required', ['path']], ['properties', { path: { description: 'Absolute path', type: 'string' } }], ['type', 'object']]
      : [['type', 'object'], ['properties', { path: { type: 'string', description: 'Absolute path' } }], ['required', ['path']]]) }] }));
    ctx.systemPrompt.context({ name: 'current-time', order: 100, text: () => currentTime });
    const firstAssembly = await ctx.systemPrompt.assemble();
    const user = text => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'local-test' } });
    const history = [createSystemMessage(renderPrompt(firstAssembly)), user('Read the selected file'),
      createAssistantMessage({ source: { provider: 'deepseek-official', model,
        replayState: { response: { kind: 'deepseek-messages', version: 1, model }, blocks: [{ type: 'reasoning', signature: 'local-signature' }, { type: 'tool-call' }] } },
        content: [{ type: 'reasoning', text: 'Read with the available tool.' }, { type: 'tool-call', id: 'call-local', name: 'read_file', arguments: '{"path":"D:/project/file.txt"}' }] }),
      createToolResultMessage({ callId: 'call-local', content: [{ type: 'text', text: 'file contents' }], isError: false }),
      user(renderContextSnapshot(firstAssembly))];
    const before = JSON.stringify(history);
    async function send(assembly, messages) {
      const chunks = [];
      for await (const chunk of adapter.stream({ provider: 'deepseek-official', model, reasoningEffort: 'high', tools: assembly.tools, messages })) chunks.push(chunk);
      assert.equal(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join(''), 'OK');
      assert.equal(chunks.at(-1).type, 'finish');
    }
    await send(firstAssembly, history);
    reversed = true; currentTime = '2026-10-15T10:01:00+08:00';
    const nextAssembly = await ctx.systemPrompt.assemble();
    const continued = [...history, createAssistantMessage({ source: { provider: 'deepseek-official', model }, content: [{ type: 'text', text: 'File read.' }] }), user('Continue'), user(renderContextSnapshot(nextAssembly))];
    await send(nextAssembly, continued);
    const [first, second] = requests.map(request => request.body);
    assert.equal(requests.length, 2);
    assert.ok(requests.every(request => request.path === '/anthropic/v1/messages'));
    assert.equal(JSON.stringify(first.tools), JSON.stringify(second.tools));
    assert.equal(first.system, second.system);
    assert.match(JSON.stringify(first.system), /smallest correct change/);
    assert.deepEqual(second.messages.slice(0, first.messages.length), first.messages);
    const thinking = second.messages.flatMap(message => message.content).find(block => block.type === 'thinking');
    assert.equal(thinking.signature, 'local-signature');
    assert.equal(thinking.thinking, 'Read with the available tool.');
    const call = second.messages.flatMap(message => message.content).find(block => block.type === 'tool_use');
    const result = second.messages.flatMap(message => message.content).find(block => block.type === 'tool_result');
    assert.equal(call.id, result.tool_use_id);
    assert.deepEqual(call.input, { path: 'D:/project/file.txt' });
    assert.match(JSON.stringify(second.messages.at(-1)), /10:01:00/);
    assert.equal(JSON.stringify(history), before);
    assert.equal(first.max_tokens, 1024);
    assert.deepEqual(first.dsh_plugin_packages, { version: 1, packages: [
      { name: 'dsh-cache-prefix', version: '0.1.0' },
      { name: 'dsh-project-folders', version: '0.1.0' },
      { name: 'dsh-runtime-tuning', version: '0.1.0' }
    ] });
    assert.deepEqual(second.dsh_plugin_packages, first.dsh_plugin_packages);
    assert.equal(first.output_config.effort, 'high');
    assert.equal(JSON.stringify(first).includes('cache_control'), false);
  });
}

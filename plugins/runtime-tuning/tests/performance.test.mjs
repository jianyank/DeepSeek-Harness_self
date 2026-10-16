import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {MemoryStore} from '../../dsh-obsidian-memory/lib/store.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(count = 20) {
  const files = Array.from({length: count}, (_,i) => ({path: 'Memory/lessons/' + i + '.md', type: 'lesson'}));
  let running = 0, peak = 0, reads = 0, listingError = false;
  let release;
  let gate = new Promise(resolve => {release = resolve});
  const vault = {relative: p => p, listNotes: async () => {if (listingError) throw new Error('listing failed'); return files;}, read: async p => {
    reads++; running++; peak = Math.max(peak, running);
    try {await gate; if (p.includes('/3.md')) throw new Error('unreadable'); return '# ' + p;} finally {running--;}
  }};
  return {store: new MemoryStore(vault), files, stats: () => ({running, peak, reads}), release: () => release(), failListing: () => {listingError = true}, resetGate: () => {gate = new Promise(resolve => {release = resolve})}};
}
test('memory refresh reads concurrently with a bound and publishes an ordered atomic snapshot', async () => {
  const f = fixture();
  f.store.entries = [{id: 'old'}];
  const first = f.store.refresh();
  assert.equal(f.store.refresh(), first);
  await tick();
  assert.ok(f.stats().peak > 1, 'serial reads leave filesystem wait time unhidden');
  assert.ok(f.stats().peak <= 4, 'avoid unbounded filesystem fanout');
  assert.deepEqual(f.store.entries, [{id: 'old'}]);
  f.release(); await first;
  assert.equal(f.stats().reads, 20);
  assert.deepEqual(f.store.entries.map(e => e.path), f.files.filter(f => !f.path.includes('/3.md')).map(f => f.path));
  assert.equal(f.store.lastError, undefined);
  assert.equal(f.store.loading, null);
});
test('memory refresh preserves errors and notices changed/deleted notes without stale caching', async () => {
  const f = fixture(5); f.release(); await f.store.refresh();
  const old = f.store.entries;
  f.failListing(); await f.store.refresh();
  assert.equal(f.store.entries, old);
  assert.match(f.store.lastError.message, /listing failed/);
  const other = fixture(1); other.release(); await other.store.refresh();
  other.files.length = 0; await other.store.refresh();
  assert.deepEqual(other.store.entries, []);
});
const client = await readFile(new URL('../../../patches/dsh-whale-widget/whale-widget.js', import.meta.url), 'utf8');
for (const name of ['pollLastTurn', 'pollWaitState']) {
  const fn = client.slice(client.indexOf('function ' + name + '() {'), client.indexOf('\n}', client.indexOf('function ' + name + '() {')) + 2);
  const declarations = client.split('\n').filter(s => /^var (lastTurnPolling|waitStatePolling) = false/.test(s)).join('\n');
  test(name + ' merges slow polls, recovers on rejection, and keeps successful notifications', async () => {
    let resolve, reject, timeout, requests = 0, played = 0, shown = 0;
    const sandbox = {AbortController, setTimeout: callback => {timeout = callback; return 1}, clearTimeout: () => {}, fetch: (_url, options) => {requests++; return new Promise((yes,no) => {resolve = yes; reject = no; options.signal.addEventListener('abort', () => no(new Error('timeout')), {once:true})})}, LAST_TURN_URL: '/turn', WAIT_URL: '/wait', WAIT_SOUND_KEY: 'wait', waitSeenId: '', waitPendingId: '', waitDismissedId: '', waitSessionName: '', lastCostAligned: true, lastCostSeq: 0, localStorage: {getItem: () => '', setItem: () => {}}, waitEventCfg: () => ({on: true, sel: 'sound'}), playTaskEndSound: () => {played++}, playBindingSound: () => {played++}, showCostBubble: () => {shown++}, showWaitBubble: () => {shown++}, hideWaitBubble: () => {}};
    vm.createContext(sandbox); vm.runInContext(declarations + '\n' + fn, sandbox);
    for (let i=0;i<8;i++) sandbox[name]();
    assert.equal(requests, 1, 'slow responses must not accumulate duplicate polls');
    reject(new Error('offline')); await tick();
    sandbox[name](); assert.equal(requests, 2);
    resolve({json: async () => ({ok:true, seq:1, turn:1, amount:0.1, sessionName:'test', pending:{id:'question-1',kind:'question'}})}); await tick();
    assert.equal(played, 1); assert.equal(shown, 1);
    sandbox[name](); assert.equal(requests, 3);
    timeout(); await tick();
    sandbox[name](); assert.equal(requests, 4, 'a hung response times out and polling resumes');
    reject(new Error('offline')); await tick();
  });
  test(name + ' releases its guard after synchronous fetch errors and invalid JSON', async () => {
    let requests = 0, cleared = 0;
    const sandbox = {AbortController, setTimeout: () => 1, clearTimeout: () => {cleared++}, LAST_TURN_URL: '/turn', WAIT_URL: '/wait', fetch: () => {
      requests++;
      if (requests === 1) throw new Error('fetch failed');
      return Promise.resolve({json: async () => {throw new Error('invalid JSON')}});
    }};
    vm.createContext(sandbox); vm.runInContext(declarations + '\n' + fn, sandbox);
    assert.doesNotThrow(() => sandbox[name]());
    assert.equal(cleared, 1);
    sandbox[name](); await tick();
    assert.equal(requests, 2); assert.equal(cleared, 2);
    sandbox[name](); await tick();
    assert.equal(requests, 3); assert.equal(cleared, 3);
  });
}

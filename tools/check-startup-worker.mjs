import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const events = {};
let timer, cached = new Response('<h1>Лунарио</h1>'), network = 'hang';
runInNewContext(readFileSync(new URL('../site/sw.js', import.meta.url), 'utf8'), {
  self: {addEventListener: (name, fn) => events[name] = fn},
  location: {origin: 'https://lunario.online'}, URL, Response, AbortController,
  setTimeout: (fn, ms) => {assert.equal(ms, 5000); timer = fn; return 1;}, clearTimeout() {},
  caches: {match: async key => key === '/app/' ? cached : undefined},
  fetch: async (request, opts) => {
    if(network === 'fail') throw new TypeError('network unavailable');
    return new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => reject(new Error('timeout'))));
  },
});
function request(path, mode, destination) {
  let result;
  events.fetch({request: {url: 'https://lunario.online' + path, method: 'GET', mode, destination}, respondWith: p => result = p});
  return result;
}
let pending = request('/app/', 'navigate', 'document'); timer();
assert.equal(await pending, cached, 'hung navigation returns the cached page at the deadline');
cached = undefined;
pending = request('/app/', 'navigate', 'document'); timer();
assert.equal((await pending).type, 'error', 'missing cache returns a valid error response');
network = 'fail'; cached = new Response('<h1>Лунарио</h1>');
assert.equal((await request('/app/missing.js', 'cors', 'script')).type, 'error', 'HTML is never returned in place of missing JavaScript');
console.log('PASS: startup worker deadline, cache fallback and missing scripts');

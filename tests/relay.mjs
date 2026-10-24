// The problem-report relay (relay/worker.js) with a pretend KV and a pretend GitHub: shape checks, limits, one issue
// per problem per day, and GitHub failures. No network. Run: node tests/relay.mjs
import worker, { checkReport } from '../relay/worker.js';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const store = new Map();
const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } };
let issues = [], ghStatus = 201;
globalThis.fetch = async (url, o) => { issues.push({ url, body: JSON.parse(o.body), auth: o.headers.authorization }); return new Response('{}', { status: ghStatus }); };
const env = { REPORTS: kv, GITHUB_TOKEN: 'tok', REPO: 'Dsmjr2/DeviceHub-support' };
const good = (o = {}) => ({ v: 1, install: 'a1b2c3d4e5f60718', fingerprint: 'helper:build-failed', version: '0.1.0', title: 'DeviceHub: helper could not be built', body: 'The helper failed to build.\nLog lines...', ...o });
const post = (b, path = '/report', method = 'POST') => worker.fetch(new Request(`https://relay.example${path}`, { method, body: method === 'POST' ? (typeof b === 'string' ? b : JSON.stringify(b)) : undefined }), env);

check(checkReport(good()) === null, 'a good report passes');
for (const [what, r] of [['extra field', { ...good(), pc: 'DESKTOP-1' }], ['bad install', good({ install: 'Shawn-PC' })], ['short body', good({ body: 'x' })], ['long title', good({ title: 'x'.repeat(200) })], ['bad version', good({ v: 2 })]])
  check(checkReport(r) !== null, `refused: ${what}`);

check((await post(good(), '/other')).status === 404, 'other paths 404');
check((await post(null, '/report', 'GET')).status === 404, 'GET 404');
check((await post('not json')).status === 400, 'not JSON 400');
check((await post({ ...good(), pc: 'x' })).status === 400, 'bad shape 400');
check((await post('x'.repeat(20000))).status === 413, 'too large 413');

let r = await post(good());
check(r.status === 202 && issues.length === 1, 'files one issue');
check(issues[0].url.endsWith('/repos/Dsmjr2/DeviceHub-support/issues') && issues[0].body.labels[0] === 'problem' && issues[0].auth === 'Bearer tok', 'to the private repo, labeled problem, with the secret');
{ const w = await import('../relay/worker.js'); check(w.labelOf('support:x') === 'support' && w.labelOf('driver:3710abcd:12') === 'driver' && w.labelOf('crash:devicehub') === 'problem', 'labels: support, driver (a shared learned driver), problem'); }
check(/Install: `a1b2c3d4e5f6`/.test(issues[0].body.body) && !/a1b2c3d4e5f60718/.test(issues[0].body.body), 'only a short install id in the issue');
r = await post(good());
check(r.status === 200 && issues.length === 1, 'same problem again today: no second issue');

for (let i = 0; i < 4; i++) await post(good({ fingerprint: `p${i}` }));
check(issues.length === 5, 'four more problems filed');
check((await post(good({ fingerprint: 'p9' }))).status === 429 && issues.length === 5, 'sixth in an hour refused');

ghStatus = 500;
r = await post(good({ install: 'ffffffffffffffff' }));
check(r.status === 502, 'GitHub failing -> 502');
ghStatus = 201;
r = await post(good({ install: 'ffffffffffffffff' }));
check(r.status === 202, 'a failed send can be tried again');

console.log(fails.length ? `relay: FAILED: ${fails.join('; ')}` : 'relay (pretend KV and GitHub): all good');
process.exit(fails.length ? 1 : 0);

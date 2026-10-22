// DeviceHub problem-report relay (22 Oct 2026). A Cloudflare Worker (free plan) that takes DeviceHub's automatic
// problem reports and files each as an issue in Shawn's PRIVATE repo, so friends need no GitHub account and the GitHub
// key never sits in the app. POST /report only; strict shape; per-install and global limits; one issue per problem
// per install per day. Secrets/bindings (relay/wrangler.toml, relay/README.md): GITHUB_TOKEN (fine-grained, Issues
// read/write on the one repo), REPORTS (KV), REPO ("owner/name").

const LIMITS = { perHour: 5, perDay: 20, globalPerDay: 200, body: 12000, total: 16384 };
const FIELDS = { v: 'number', install: 'string', fingerprint: 'string', version: 'string', title: 'string', body: 'string' };

export function checkReport(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'not an object';
  for (const k of Object.keys(r)) if (!(k in FIELDS)) return `unknown field ${k}`;
  for (const [k, t] of Object.entries(FIELDS)) if (typeof r[k] !== t) return `${k} missing`;
  if (r.v !== 1) return 'unknown version';
  if (!/^[a-f0-9]{16,64}$/.test(r.install)) return 'bad install id';
  if (!/^[a-z0-9:._-]{1,80}$/i.test(r.fingerprint)) return 'bad fingerprint';
  if (r.version.length > 40 || r.title.length < 3 || r.title.length > 120 || r.body.length < 10 || r.body.length > LIMITS.body) return 'bad length';
  return null;
}

const json = (status, o) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const day = () => new Date().toISOString().slice(0, 10);
const hour = () => new Date().toISOString().slice(0, 13);

async function bump(kv, key, ttl) {
  const n = Number((await kv.get(key)) || 0) + 1;
  await kv.put(key, String(n), { expirationTtl: ttl });
  return n;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname !== '/report' || req.method !== 'POST') return json(404, { error: 'not found' });
    const text = await req.text();
    if (text.length > LIMITS.total) return json(413, { error: 'too large' });
    let r; try { r = JSON.parse(text); } catch { return json(400, { error: 'not JSON' }); }
    const why = checkReport(r);
    if (why) return json(400, { error: why });

    const kv = env.REPORTS;
    // one issue per problem per install per day
    const seen = `seen:${r.install}:${r.fingerprint}:${day()}`;
    if (await kv.get(seen)) return json(200, { ok: true, duplicate: true });
    if (await bump(kv, `h:${r.install}:${hour()}`, 7200) > LIMITS.perHour) return json(429, { error: 'too many this hour' });
    if (await bump(kv, `d:${r.install}:${day()}`, 172800) > LIMITS.perDay) return json(429, { error: 'too many today' });
    if (await bump(kv, `g:${day()}`, 172800) > LIMITS.globalPerDay) return json(429, { error: 'relay busy today' });
    await kv.put(seen, '1', { expirationTtl: 90000 });

    const body = `${r.body}\n\n---\nInstall: \`${r.install.slice(0, 12)}\` · DeviceHub ${r.version} · problem \`${r.fingerprint}\` · filed by the DeviceHub relay`;
    const gh = await fetch(`https://api.github.com/repos/${env.REPO}/issues`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'devicehub-relay', 'content-type': 'application/json' },
      body: JSON.stringify({ title: r.title, body, labels: [r.fingerprint.startsWith('support:') ? 'support' : 'problem'] }),
    });
    if (!gh.ok) { await kv.delete(seen); return json(502, { error: `github ${gh.status}` }); }
    return json(202, { ok: true });
  },
};

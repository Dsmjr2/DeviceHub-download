// Profiles and monitors (22 Oct 2026): a profile's monitor is found by its saved hardware id, or else by the one
// monitor of the same model on this PC (Windows can give a monitor a new instance id); never guessed between two of the
// same model; one that is not there is left out of what differs. Run: node tests/profile-monitors.mjs
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const { env } = await import('../public/core/env.js');
const P = await import('../public/core/profiles.js');
let list = [];
env.api = async (p) => { if (p.startsWith('/api/monitors')) return list; throw new Error(`unexpected call ${p}`); };
const mon = (id, b) => ({ id, name: id.split('#')[0], ddc: true, brightness: { value: b, max: 100 }, contrast: { value: 50, max: 100 }, volume: null });
const profile = { name: 'Music', devices: {}, monitors: { 'AOCA610#5&3da353e&0&UID37121': { name: 'AOC AGON OLED', brightness: 52 } } };

list = [mon('AOCA610#5&3da353e&0&UID37121', 30)];
await P.loadMonitors(true);
let rows = P.diff(profile);
check(rows.length === 1 && rows[0].monitorId === 'AOCA610#5&3da353e&0&UID37121' && rows[0].savedId === 'AOCA610#5&3da353e&0&UID37121', `exact id (${JSON.stringify(rows)})`);

list = [mon('AOCA610#5&99&0&UID4352', 30), mon('ACR081B#5&3da353e&0&UID37123', 26)];
await P.loadMonitors(true);
rows = P.diff(profile);
check(rows.length === 1 && rows[0].monitorId === 'AOCA610#5&99&0&UID4352' && rows[0].savedId === 'AOCA610#5&3da353e&0&UID37121', `same model with a new instance id is used (${JSON.stringify(rows)})`);

list = [mon('AOCA610#a', 30), mon('AOCA610#b', 30)];
await P.loadMonitors(true);
check(P.findMonitor('AOCA610#5&3da353e&0&UID37121') === null && P.diff(profile).length === 0, 'two of the same model: neither is guessed');

list = [mon('ACR081B#5&3da353e&0&UID37123', 26)];
await P.loadMonitors(true);
check(P.findMonitor('AOCA610#5&3da353e&0&UID37121') === null && P.diff(profile).length === 0, 'a monitor that is off or gone is left out');

if (fails.length) { console.log(`profile-monitors: ${fails.length} failed\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('profile-monitors (profiles find their monitors): all good');

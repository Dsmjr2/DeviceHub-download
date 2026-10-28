// "When to use it" on the Profiles page (22 Oct 2026; docs/handoff/profiles-redesign.md): the one choice per profile
// maps onto the data profiles.json and settings.json already hold, without changing their format.
//  1. Shawn's shape: Desktop (games [], the default profile) reads "When no game is running", Gaming (games
//     ['*games*']) reads "When any game starts"; reading never changes the profile.
//  2. Every choice, applied and read back, gives the same choice; "When no game is running" moves the default
//     profile to this one; leaving it clears the setting; another profile's choice leaves it alone.
//  3. Named games: kept, remembered across "any game" and back, never mixed with the any-game marker.
//  4. Older data: a profile with games AND the default; games missing; junk in games.
//  5. The plain line under the name.
//  6. The real profiles.json and settings.json (read only, when they are here) map as described and are not changed.
// Run: node tests/profile-use.mjs (tests/profiles-added.mjs runs it too, so test:offline covers it)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function run() {
  const fails = [];
  const check = (ok, what) => { if (!ok) fails.push(what); };
  const U = await import('../public/core/profile-use.js');
  const { ANY_GAME } = await import('../public/core/autoswitch.js');
  const J = JSON.stringify;
  check(U.ANY === ANY_GAME, 'the any-game marker is the one auto-switch reads');

  // ---- 1. Shawn's shape
  const SHAWN = [
    { name: 'Desktop', color: '#8299a8', games: [], devices: { mouse: { pollingRate: 1000 } }, savedAt: '2026-10-19T05:31:30.5509083Z' },
    { name: 'Gaming', color: '#c47b55', games: ['*games*'], devices: { mouse: { pollingRate: 4000 } }, savedAt: '2026-10-19T05:31:30.5509083Z' },
  ];
  const copy = JSON.parse(J(SHAWN));
  check(U.useOf(copy[0], 'Desktop') === 'idle', 'Desktop (no games, the default) is "When no game is running"');
  check(U.useOf(copy[1], 'Desktop') === 'any', 'Gaming (any game) is "When any game starts"');
  check(U.useOf(copy[0], '') === 'pick', 'with no default profile set, Desktop is "Only when I pick it"');
  check(J(copy) === J(SHAWN), 'reading the choice never changes a profile');

  // ---- 2. every choice round-trips
  const settle = (p, choice, def, remembered) => {
    const plan = U.planUse(p, choice, def, remembered);
    const np = { ...p, games: plan.games };
    const nd = plan.defaultProfile === undefined ? def : plan.defaultProfile;
    return { np, nd, plan };
  };
  for (const start of [copy[0], copy[1], { name: 'Named', games: ['Valorant.exe'] }, { name: 'Plain', games: [] }]) {
    for (const def of ['', 'Desktop', start.name]) {
      for (const choice of ['pick', 'idle', 'any', 'named']) {
        const { np, nd } = settle(start, choice, def, ['Apex.exe']);
        const back = U.useOf(np, nd, choice === 'named' && !np.games.length);
        check(back === choice, `${start.name} (default "${def}") -> ${choice} reads back ${back}`);
        if (choice === 'idle') check(nd === start.name && J(np.games) === '[]', `${start.name} -> idle: it holds the default and has no games`);
        else if (def === start.name) check(nd === '', `${start.name} leaving "When no game is running" clears the default (${nd})`);
        else check(nd === def, `${start.name} -> ${choice} leaves another profile's default alone (${nd})`);
      }
    }
  }
  // picking it moves it: Gaming takes the fallback, Desktop then reads "Only when I pick it"
  {
    const { np, nd } = settle(copy[1], 'idle', 'Desktop');
    check(nd === 'Gaming' && U.useOf(np, nd) === 'idle' && U.useOf(copy[0], nd) === 'pick', 'the fallback moves from Desktop to Gaming; only one holds it');
  }
  check(U.planUse(copy[0], 'idle', 'Desktop').defaultProfile === 'Desktop', 'picking the choice it already has changes nothing');
  check(U.planUse(copy[1], 'any', 'Desktop').defaultProfile === undefined && J(U.planUse(copy[1], 'any', 'Desktop').games) === J(['*games*']), 'Gaming -> any game: the same data');

  // ---- 3. named games
  const named = { name: 'Shooters', games: ['Valorant.exe', 'r5apex.exe'] };
  check(U.useOf(named, '') === 'named', 'named games read "When these games start"');
  check(J(U.planUse(named, 'named', '').games) === J(named.games), 'choosing it again keeps the list');
  const anyPlan = U.planUse(named, 'any', '');
  check(J(anyPlan.games) === J(['*games*']), 'any game is the marker alone');
  check(J(U.planUse({ ...named, games: anyPlan.games }, 'named', '', named.games).games) === J(named.games), 'back to these games: the remembered list comes back');
  check(J(U.planUse({ name: 'X', games: [] }, 'named', '').games) === '[]', 'these games with none yet: an empty list (the page shows the picker)');
  check(U.useOf({ name: 'X', games: [] }, '', true) === 'named', 'chosen but no game added yet still shows "When these games start"');
  check(J(U.namedGames({ games: ['*games*', 'a.exe'] })) === J(['a.exe']), 'the marker is never shown as a game name');
  check(!U.planUse({ name: 'X', games: ['*games*'] }, 'named', '', ['*games*', 'b.exe']).games.includes('*games*'), 'these games never carries the any-game marker');

  // ---- 4. older or odd data
  const both = { name: 'Both', games: ['Valorant.exe'] };
  check(U.useOf(both, 'Both') === 'named', 'a profile with games AND the default shows its game choice');
  check(U.planUse(both, 'named', 'Both').defaultProfile === '', 'and changing it settles the default');
  check(U.useOf({ name: 'Old' }, '') === 'pick' && U.useOf({ name: 'Old' }, 'Old') === 'idle', 'a profile with no games field');
  check(U.useOf({ name: 'J', games: [null, '', 3] }, '') === 'pick', 'junk in games is not a game');
  check(U.useOf({ name: 'M', games: ['a.exe', '*games*'] }, '') === 'any', 'any game wins over names in the same list (auto-switch matches it on any game)');

  // ---- 5. the plain line
  const t = (x) => ({ 'valorant.exe': 'Valorant', 'r5apex.exe': 'Apex Legends' }[x.toLowerCase()] || x.replace(/\.exe$/i, ''));
  const line = (p, def, on = true) => U.whenLine(p, U.useOf(p, def), { defaultProfile: def, autoSwitch: on, title: t });
  check(line(copy[1], 'Desktop') === 'Turns on when a game starts', `any game (${line(copy[1], 'Desktop')})`);
  check(line(copy[0], 'Desktop') === 'Used when no game is running', `the default (${line(copy[0], 'Desktop')})`);
  check(line(copy[0], '') === 'Only when you pick it', `by hand (${line(copy[0], '')})`);
  check(line({ name: 'V', games: ['Valorant.exe'] }, '') === 'Turns on when Valorant starts', `one game (${line({ name: 'V', games: ['Valorant.exe'] }, '')})`);
  check(line(named, '') === 'Turns on when Valorant or Apex Legends start', `two games (${line(named, '')})`);
  check(line({ name: 'T', games: ['a.exe', 'b.exe', 'c.exe'] }, '') === 'Turns on when a, b or c start', 'three games');
  check(line(copy[1], 'Desktop', false) === 'Turns on when a game starts (switching is off above)', 'switching off is said');
  check(line(copy[0], '', false) === 'Only when you pick it', 'by hand needs no switching note');
  check(line(both, 'Both') === 'Turns on when Valorant starts, and when no game is running', 'games and the default together');

  // ---- 6. the real files, read only
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const pf = path.join(root, 'data', 'profiles.json'), sf = path.join(root, 'data', 'settings.json');   // data\ since 27 Oct 2026
  if (fs.existsSync(pf) && fs.existsSync(sf)) {
    const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    const before = [hash(pf), hash(sf)];
    try {
      const list = JSON.parse(fs.readFileSync(pf, 'utf8'));
      const set = JSON.parse(fs.readFileSync(sf, 'utf8'));
      const uses = list.map((p) => U.useOf(p, set.defaultProfile || ''));
      check(uses.filter((u) => u === 'idle').length <= 1, 'at most one real profile is "When no game is running"');
      const desk = list.find((p) => p.name === 'Desktop'), game = list.find((p) => p.name === 'Gaming');
      if (desk && game && set.defaultProfile === 'Desktop' && J(game.games) === J(['*games*']) && J(desk.games) === '[]') {
        check(U.useOf(desk, 'Desktop') === 'idle' && U.useOf(game, 'Desktop') === 'any', 'the real Desktop and Gaming map as described');
      }
    } catch (e) { fails.push(`the real files: ${e.message}`); }
    check(hash(pf) === before[0] && hash(sf) === before[1], 'the real profiles.json and settings.json are not changed');
  }
  return fails;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const fails = await run();
  console.log(fails.length ? `profile-use: FAILED: ${fails.join('; ')}` : 'profile-use ("When to use it" on the Profiles page): all good');
  process.exit(fails.length ? 1 : 0);
}

// Game settings in the setup file (11 Nov 2026): no imports, so tests/setup-games.mjs runs it in Node.
// The file's games over this PC's: a game with the same name takes the file's switches, a game only this PC has stays.
// HDR names a screen, and screens differ between PCs: it is kept only for a screen this PC has (same id, else same
// name); otherwise this PC's own HDR choice for that game stays, or HDR is left as is.
const gameKey = (g) => String(g?.name || '').trim().toLowerCase();
export function mergeGames(now, fromFile, screens = []) {
  const list = now.map((g) => ({ ...g, setup: { ...g.setup } }));
  const lines = [];
  for (const g of fromFile) {
    if (!g || !gameKey(g) || !Array.isArray(g.exes)) continue;
    const setup = { ...(g.setup || {}) };
    const mine = list.find((x) => gameKey(x) === gameKey(g));
    if (setup.hdr) {
      const s = screens.find((x) => setup.hdr.id && x.id === setup.hdr.id) || screens.find((x) => x.name && x.name === setup.hdr.name);
      if (s) setup.hdr = { id: s.id, screen: s.screen, name: s.name, on: setup.hdr.on };
      else if (mine?.setup?.hdr) setup.hdr = mine.setup.hdr;
      else delete setup.hdr;
    }
    const next = { ...(mine ? { id: mine.id } : { id: g.id }), name: g.name, exes: [...new Set([...(mine?.exes || []), ...g.exes])], setup, ...(g.source ? { source: g.source } : {}) };
    if (mine && JSON.stringify({ e: [...mine.exes].sort(), s: mine.setup }) === JSON.stringify({ e: [...next.exes].sort(), s: next.setup })) continue;
    if (mine) Object.assign(mine, next); else list.push(next);
    lines.push({ name: g.name, added: !mine });
  }
  return { list, lines };
}

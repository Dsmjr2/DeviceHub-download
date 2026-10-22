// "When to use it" on the Profiles page (22 Oct 2026, docs/handoff/profiles-redesign.md): one plain choice per profile,
// stored in the same places as before, so profiles.json and settings.json keep their format:
//   pick  "Only when I pick it"        games []                       not the default profile
//   idle  "When no game is running"    games []                       settings.defaultProfile = its name (only one)
//   any   "When any game starts"       games ['*games*']
//   named "When these games start"     games ['Valorant.exe', ...]
// A profile from an older file that has games AND is the default profile shows its game choice; the default stays
// with it until another choice is made (it is only moved or cleared when the person changes something).
// No DOM here: tests/profile-use.mjs runs it in Node.
export const ANY = '*games*';   // the same marker auto-switch reads (core/autoswitch.js ANY_GAME)

export const USES = [
  { value: 'pick', label: 'Only when I pick it' },
  { value: 'idle', label: 'When no game is running' },
  { value: 'any', label: 'When any game starts' },
  { value: 'named', label: 'When these games start' },
];

const gamesOf = (p) => (Array.isArray(p?.games) ? p.games.filter((g) => typeof g === 'string' && g) : []);
export const namedGames = (p) => gamesOf(p).filter((g) => g !== ANY);

// which choice a profile shows. pendingNamed: picked "When these games start" on the page but no game added yet.
export function useOf(p, defaultProfile, pendingNamed = false) {
  const g = gamesOf(p);
  if (g.includes(ANY)) return 'any';
  if (g.length) return 'named';
  if (pendingNamed) return 'named';
  if (defaultProfile && p?.name === defaultProfile) return 'idle';
  return 'pick';
}

// What changes when the person picks a choice: { games, defaultProfile } where defaultProfile is undefined when the
// setting stays as it is. remembered: named games this page saw for the profile earlier (so going from "these games"
// to "any game" and back keeps the list for the session).
export function planUse(p, choice, defaultProfile, remembered = []) {
  const isDefault = !!defaultProfile && p?.name === defaultProfile;
  const named = namedGames(p).length ? namedGames(p) : remembered.filter((g) => g && g !== ANY);
  if (choice === 'idle') return { games: [], defaultProfile: p.name };
  const leave = isDefault ? '' : undefined;
  if (choice === 'any') return { games: [ANY], defaultProfile: leave };
  if (choice === 'named') return { games: [...new Set(named)], defaultProfile: leave };
  return { games: [], defaultProfile: leave };
}

// The one plain line under a profile's name. title(exe) -> a game's name (core/autoswitch.js gameTitle).
export function whenLine(p, use, { defaultProfile, autoSwitch, title = (x) => String(x).replace(/\.exe$/i, '') } = {}) {
  let line;
  if (use === 'any') line = 'Turns on when a game starts';
  else if (use === 'named') {
    const names = namedGames(p).map(title);
    line = names.length ? `Turns on when ${joinNames(names)} start${names.length === 1 ? 's' : ''}` : 'Add the games below';
  } else if (use === 'idle') line = 'Used when no game is running';
  else return 'Only when you pick it';
  if ((use === 'any' || use === 'named') && defaultProfile && p?.name === defaultProfile) line += ', and when no game is running';
  if (!autoSwitch && !(use === 'named' && !namedGames(p).length)) line += ' (switching is off above)';
  return line;
}
const joinNames = (n) => (n.length <= 2 ? n.join(' or ') : `${n.slice(0, -1).join(', ')} or ${n[n.length - 1]}`);

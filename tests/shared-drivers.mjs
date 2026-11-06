// The publish gate for drivers taken in from the public relay (6 Nov 2026, security audit; helpers/accept-driver-shares.mjs
// libraryProblems): a shared library entry is "untested" until Shawn marks it reviewed, has no code, and every device
// message it sends is on helpers/share-allow-list.json or already sent by a reviewed driver for that vendor. Run by
// npm test and by helpers/publish-release.ps1 before anything is built.
import { libraryProblems } from '../helpers/accept-driver-shares.mjs';
const bad = libraryProblems();
if (bad.length) { console.error(`shared-drivers: ${bad.length} shared driver(s) may not be published:\n  ${bad.join('\n  ')}`); process.exit(1); }
console.log('shared-drivers (shared library drivers stay untested until reviewed, every message on the allow-list): all good');

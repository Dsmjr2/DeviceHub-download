// The publish gate for library entries that public input can change (6 Nov 2026, security audit; run by npm test and by
// helpers/publish-release.ps1 before anything is built):
// - drivers taken in from the public relay (helpers/accept-driver-shares.mjs libraryProblems): "untested" until Shawn
//   marks them reviewed, no code, and every device message on helpers/share-allow-list.json or already sent by a
//   reviewed driver for that vendor;
// - works reports (8 Nov 2026, helpers/accept-works-reports.mjs worksProblems): every works record names the GitHub
//   account that filed it, and none makes an entry "tested" unless enough different accounts (or the publisher) filed them.
import { libraryProblems } from '../helpers/accept-driver-shares.mjs';
import { worksProblems } from '../helpers/accept-works-reports.mjs';
const bad = [...libraryProblems(), ...worksProblems()];
if (bad.length) { console.error(`shared-drivers: ${bad.length} library entr${bad.length === 1 ? 'y' : 'ies'} may not be published:\n  ${bad.join('\n  ')}`); process.exit(1); }
console.log('shared-drivers (shared drivers stay untested until reviewed, works reports need several accounts): all good');

// Settings > Health's helper memory (helpers/helper-memory.js): the C# helper reports its own; the Rust one does not,
// so its process is measured (13 Nov 2026: Health showed no helper memory during the Rust helper's trial).
import { createRequire } from 'node:module';
const { helperMemoryMB } = createRequire(import.meta.url)('../helpers/helper-memory.js');
let bad = 0;
const check = (ok, what) => { if (!ok) { bad++; console.log(`FAIL ${what}`); } };
check(await helperMemoryMB('heap=3.1MB gen0=2 private=21.4MB handles=600', 99, async () => { throw new Error('not asked'); }) === 21.4, 'C# helper: its own number');
check(await helperMemoryMB('rust-helper', 1234, async (pid) => (pid === 1234 ? 17 * 1048576 : 0)) === 17, 'Rust helper: its process measured');
check(await helperMemoryMB('rust-helper', null) === null, 'no helper process: nothing shown');
check(await helperMemoryMB('GONE', 5, async () => { throw new Error('gone'); }) === null, 'a process that ended: nothing shown');
console.log(bad ? `helper-memory: ${bad} failed` : 'helper-memory: all checks passed');
process.exit(bad ? 1 : 0);

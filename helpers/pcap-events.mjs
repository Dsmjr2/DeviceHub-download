// Prints only the messages in a USBPcap capture that are not part of a steady repeating pattern
// (a payload seen more than `--min` times is shown once as a summary).
//   node helpers/pcap-events.mjs capture.pcap [--min 6]
import { readPcap } from './pcap-read.mjs';

const [file, , min = '6'] = process.argv.slice(2);
const recs = readPcap(file).filter((r) => r.transfer !== 0 && r.data.length);
const hex = (a) => a.map((x) => x.toString(16).padStart(2, '0')).join(' ');
const key = (r) => `${r.endpoint & 0x80 ? 'IN' : 'OUT'} ${hex(r.data.slice(0, 20))}`;
const count = new Map();
for (const r of recs) count.set(key(r), (count.get(key(r)) || 0) + 1);
console.log('repeating patterns:');
for (const [k, n] of count) if (n > Number(min)) console.log(`  x${n}  ${k}`);
console.log('one-off messages:');
for (const r of recs) if (count.get(key(r)) <= Number(min)) console.log(`  ${r.t.toFixed(3).padStart(8)}s  ${r.endpoint & 0x80 ? 'IN ' : 'OUT'}  ${hex(r.data.slice(0, 32))}`);

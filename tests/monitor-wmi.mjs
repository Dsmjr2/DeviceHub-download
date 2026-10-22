// A laptop's built-in screen (22 Oct 2026; helpers/monitor-wmi.js): Windows' brightness list is read safely and matched
// to the right screen. Run: node tests/monitor-wmi.mjs (no Windows needed; nothing is run)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { _test: { parse, match, PS_SET } } = require('../helpers/monitor-wmi.js');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const one = parse('{"instance":"DISPLAY\\\\BOE0A1C\\\\4&2a3b4c&0&UID8388688_0","value":60,"active":true}');
check(one.length === 1 && one[0].value === 60, 'one screen (PowerShell answers an object, not a list)');
const two = parse(JSON.stringify([{ instance: 'DISPLAY\\BOE0A1C\\4&2a3b4c&0&UID8388688_0', value: 40 }, { instance: 'DISPLAY\\LGD05E5\\4&9&0&UID1_0', value: 70 }]));
check(two.length === 2, 'two screens');
check(parse('').length === 0 && parse('not json').length === 0 && parse('[{"instance":"x","value":300}]').length === 0, 'nothing, junk and impossible values give no screens');
check(match('BOE0A1C#4&2a3b4c&0&UID8388688', two)?.value === 40, 'matched by model and instance');
check(match('boe0a1c#4&OTHER', two)?.value === 40, 'the one screen of that model when the instance differs');
check(match('AOCA610#5&3da353e&0&UID37121', two) === null, 'an external monitor is never matched to the laptop screen');
const twins = [{ instance: 'DISPLAY\\ABC1234\\1_0', value: 1 }, { instance: 'DISPLAY\\ABC1234\\2_0', value: 2 }];
check(match('ABC1234#3', twins) === null, 'two of the same model: neither is guessed');
check(/\$env:DEVICEHUB_WMI_INSTANCE/.test(PS_SET) && /\$env:DEVICEHUB_WMI_VALUE/.test(PS_SET), 'the screen and the value reach PowerShell through the environment, not the script text');
if (fails.length) { console.log(`monitor-wmi: ${fails.length} failed\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log('monitor-wmi (a laptop\'s built-in screen): all good');

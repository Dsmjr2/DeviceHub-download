// A brand's new model with nothing to learn (24 Oct 2026): a device-library entry with a family ("FF00:0002", the
// protocol's own HID collection) matches a model it does not list, only with that collection, never an id another entry
// names; the install keeps the extra id (library.json familyPids) and a copy already installed gets it added.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { match, installFromLibrary, validateMeta, ROOT } from '../helpers/device-library.mjs';
import { addFamilyPids, libraryMark } from '../helpers/my-devices.mjs';

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const usb = [{ vid: '046d', pid: 'c0ff', name: 'new Logitech mouse', pages: ['FF00:0001', 'FF00:0002'] }, { vid: '046d', pid: '0825', name: 'webcam', pages: [] }, { vid: '046d', pid: 'c539', name: 'receiver', pages: ['FF00:0002'] }];
const m = match(usb, { root: ROOT, readOnly: true, untested: true });
const mouse = m.find((x) => x.name === 'logitech-hidpp-mouse'), kb = m.find((x) => x.name === 'logitech-hidpp-keyboard');
check(mouse?.familyPids?.join() === 'c0ff' && kb?.familyPids?.join() === 'c0ff', `an unlisted Logitech model with the HID++ collection matches both Logitech drivers by family (${JSON.stringify(m.map((x) => [x.name, x.familyPids]))})`);
check(!m.some((x) => (x.familyPids || []).includes('0825')), 'a Logitech webcam (no HID++ collection) is not matched');
check(!m.some((x) => (x.familyPids || []).includes('c539')), 'a listed id is never taken by a family');
check(!match([{ vid: '046d', pid: 'c0ff', pages: ['FF43:0602'] }], { root: ROOT, readOnly: true, untested: true }).some((x) => x.familyPids), 'another collection: no family match');
check(validateMeta({ id: 'x-y', vendor: 'v', product: 'p', kind: 'Mouse', vid: '1234', pids: ['0001'], models: ['m'], status: 'untested', works: [], tested: [], family: ['00FF:1'] }) !== null, 'a family that is not a vendor collection is refused');

// install keeps the family id; a copy already there gets a new one added (kept in library.json)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-fam-'));
fs.cpSync(path.join(ROOT, 'device-library', 'logitech-hidpp-mouse'), path.join(root, 'device-library', 'logitech-hidpp-mouse'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public'), path.join(root, 'public'), { recursive: true });
fs.cpSync(path.join(ROOT, 'helpers'), path.join(root, 'helpers'), { recursive: true, filter: (s) => !/[\\/]bin([\\/]|$)/.test(s) });
const r = await installFromLibrary('logitech-hidpp-mouse', { root, readOnly: true, familyPids: ['c0ff'] });
check(r.ok, `installed (${r.error})`);
const folder = path.join(root, 'my-devices', 'logitech-hidpp-mouse');
check(libraryMark(folder)?.familyPids?.join() === 'c0ff', 'the family id is kept in library.json');
check(addFamilyPids(root, 'logitech-hidpp-mouse', ['C0FE', 'c0ff']).join() === 'C0FE' && libraryMark(folder).familyPids.join() === 'c0ff,c0fe', 'a new family id is added to the copy once');
check(addFamilyPids(root, 'logitech-hidpp-mouse', ['c0fe']).length === 0, 'the same id is not added twice');
fs.rmSync(root, { recursive: true, force: true });
if (fails.length) { console.log(`library-family: FAILED:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('library-family (a brand\'s unlisted model matched by its protocol\'s collection, kept and added to the copy): all good');

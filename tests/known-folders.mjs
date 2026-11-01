// The person's real Documents and Pictures (helpers/known-folders.js, 1 Nov 2026): OneDrive's when Windows moved them,
// and a DeviceHub folder made before under the home folder stays where it is. Run: node tests/known-folders.mjs
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { folder, place, _test: { parse } } = require('../helpers/known-folders.js');

const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
const reg = [
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
  '    Personal    REG_EXPAND_SZ    %USERPROFILE%\\OneDrive\\Documents',
  '    My Pictures    REG_EXPAND_SZ    %USERPROFILE%\\OneDrive\\Pictures',
  '    Desktop    REG_EXPAND_SZ    %USERPROFILE%\\Desktop',
].join('\r\n');
const known = parse(reg, { USERPROFILE: 'C:\\Users\\José' }, () => true);
// reg's old code page garbles a name outside it ("Imágenes"), and a folder that is not there is never used (a review)
check(Object.keys(parse('    My Pictures    REG_EXPAND_SZ    C:\\Users\\a\\OneDrive\\Im\uFFFDgenes', {}, () => true)).length === 0, 'a garbled folder name is not used');
check(Object.keys(parse(reg, { USERPROFILE: 'C:\\Users\\José' }, () => false)).length === 0, 'a folder that does not exist is not used');
check(known.documents === 'C:\\Users\\José\\OneDrive\\Documents' && known.pictures === 'C:\\Users\\José\\OneDrive\\Pictures', `OneDrive's folders read and expanded (${JSON.stringify(known)})`);
check(Object.keys(parse('    Personal    REG_EXPAND_SZ    %NOPE%\\Docs', {})).length === 0, 'a path that does not expand is not used');
check(Object.keys(parse('', {})).length === 0, 'nothing read: nothing claimed');
check(folder('documents', { known: {} }) === path.join(os.homedir(), 'Documents'), 'no registry answer: the home folder\'s Documents');

const real = 'D:\\OneDrive\\Documents', old = path.join(os.homedir(), 'Documents', 'DeviceHub backups');
const at = (have) => place('documents', 'DeviceHub backups', { known: { documents: real }, exists: (p) => have.includes(p) });
check(at([]) === path.join(real, 'DeviceHub backups'), 'a new PC: inside the real Documents');
check(at([old]) === old, 'a folder made before under the home folder stays where it is');
check(at([old, path.join(real, 'DeviceHub backups')]) === path.join(real, 'DeviceHub backups'), 'both there: the real one');

const now = folder('documents'), pics = folder('pictures');
check(path.isAbsolute(now) && path.isAbsolute(pics), `this PC's folders are full paths (${now}, ${pics})`);

if (fails.length) { console.log(`known-folders: FAILED:\n- ${fails.join('\n- ')}`); process.exit(1); }
console.log('known-folders (the real Documents and Pictures, OneDrive\'s too; earlier DeviceHub folders stay put): all good');

// Embark's option save (THE FINALS, ARC Raiders: EmbarkOptionSaveGame.sav), an Unreal Engine save (GVAS) read and
// written key by key (13 Nov 2026, Shawn: the laptop takes the PC's controls and options, not its graphics).
//
// The file is the GVAS header, then two properties: Version (an int) and Properties, a map of option name -> text
// ("GameplayOption.Controls.MouseSensitivity" -> "0.42"), then whatever the game keeps after it (THE FINALS: an
// AdditionalData byte array, the same bytes whatever the options are, checked against its _PreUpgrade copy), then None.
// Only that exact shape is accepted; anything else is refused (null), so a file this does not understand is never
// written. A write changes only the map's entries, its size and its count: every other byte stays as it was.
// Both tag layouts are read: UE 5.4 and before (size int32 + array index int32, then the key and value types, then a
// guid flag; ARC Raiders) and UE 5.5's (the type with its parameters, size int32, a flags byte; THE FINALS).
//   parseOptions(buf) -> { entries: [{ key, value, rawKey, rawValue }], ... } | null
//   writeOptions(parsed, entries) -> Buffer

const NEW_TAGS = 1012;   // UE5 package version PROPERTY_TAG_COMPLETE_TYPE_NAME
const NONE = Buffer.from('050000004e6f6e650000000000', 'hex');   // "None" and Unreal's four zero bytes

function reader(buf) {
  let o = 0;
  const need = (n) => { if (n < 0 || o + n > buf.length) throw new Error('past the end'); };
  const r = {
    get at() { return o; },
    i32() { need(4); const v = buf.readInt32LE(o); o += 4; return v; },
    u16() { need(2); const v = buf.readUInt16LE(o); o += 2; return v; },
    u8() { need(1); return buf[o++]; },
    skip(n) { need(n); o += n; },
    // an FString: a length (negative: UTF-16), the text, a terminating zero; also the bytes as they were
    str() {
      const start = o, n = r.i32();
      if (n === 0) return { text: '', raw: buf.subarray(start, o) };
      if (n < 0) { if (n < -0x100000) throw new Error('bad string'); need(-2 * n); const text = buf.subarray(o, o - 2 * n - 2).toString('utf16le'); o += -2 * n; return { text, raw: buf.subarray(start, o) }; }
      if (n > 0x100000) throw new Error('bad string');
      need(n);
      if (buf[o + n - 1] !== 0) throw new Error('unterminated string');
      const text = buf.subarray(o, o + n - 1).toString('latin1'); o += n;
      return { text, raw: buf.subarray(start, o) };
    },
  };
  return r;
}
// an FString as Unreal writes it: plain text when every character is ASCII, else UTF-16
export function fstring(text) {
  if (text === '') return Buffer.alloc(4);   // an empty one is a bare zero length
  if (/^[\x00-\x7f]*$/.test(text)) { const b = Buffer.alloc(4 + text.length + 1); b.writeInt32LE(text.length + 1, 0); b.write(text, 4, 'latin1'); return b; }
  const b = Buffer.alloc(4 + (text.length + 1) * 2); b.writeInt32LE(-(text.length + 1), 0); b.write(text, 4, 'utf16le'); return b;
}

export function parseOptions(buf) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 64 || buf.toString('latin1', 0, 4) !== 'GVAS') return null;
    const r = reader(buf);
    r.skip(4);
    const saveVersion = r.i32(), ue4 = r.i32(), ue5 = saveVersion >= 3 ? r.i32() : 0;
    if (saveVersion !== 3 || ue4 < 500 || ue5 < 1000) return null;
    r.u16(); r.u16(); r.u16(); r.i32(); r.str();   // engine version and branch
    if (r.i32() !== 3) return null;                 // custom version format
    const customs = r.i32();
    if (customs < 0 || customs > 1000) return null;
    r.skip(customs * 20);
    if (!/EmbarkOptionSaveGame/.test(r.str().text)) return null;
    const newTags = ue5 >= NEW_TAGS;
    if (newTags) { if (r.u8() !== 0) return null; }   // UE 5.5: a flags byte before the first property
    // Version: IntProperty
    if (r.str().text !== 'Version' || r.str().text !== 'IntProperty') return null;
    if (newTags) { if (r.i32() !== 0 || r.i32() !== 4 || r.u8() !== 0) return null; }
    else { if (r.i32() !== 4 || r.i32() !== 0 || r.u8() !== 0) return null; }
    r.i32();
    // Properties: MapProperty<NameProperty, StrProperty>
    if (r.str().text !== 'Properties' || r.str().text !== 'MapProperty') return null;
    let sizeAt;
    if (newTags) {
      if (r.i32() !== 2) return null;
      if (r.str().text !== 'NameProperty' || r.i32() !== 0 || r.str().text !== 'StrProperty' || r.i32() !== 0) return null;
      sizeAt = r.at;
      r.i32();
      if (r.u8() !== 0) return null;
    } else {
      sizeAt = r.at;
      r.i32();
      if (r.i32() !== 0) return null;   // array index
      if (r.str().text !== 'NameProperty' || r.str().text !== 'StrProperty' || r.u8() !== 0) return null;
    }
    const size = buf.readInt32LE(sizeAt), dataAt = r.at;
    if (r.i32() !== 0) return null;   // keys to remove
    const countAt = r.at, count = r.i32();
    if (count < 0 || count > 100000) return null;
    const entries = [];
    for (let i = 0; i < count; i++) {
      const k = r.str(), v = r.str();
      entries.push({ key: k.text, value: v.text, rawKey: Buffer.from(k.raw), rawValue: Buffer.from(v.raw) });
    }
    if (r.at - dataAt !== size) return null;
    // what follows must end in None (and Unreal's four zero bytes)
    if (!buf.subarray(r.at).subarray(-13).equals(NONE)) return null;
    return { buf, sizeAt, countAt, mapEnd: r.at, entries };
  } catch { return null; }
}

// the same file with these entries in its map; every byte outside the map's entries, size and count stays as it was
export function writeOptions(p, entries) {
  const body = Buffer.concat(entries.flatMap((e) => [e.rawKey || fstring(e.key), e.rawValue || fstring(e.value)]));
  const count = Buffer.alloc(4); count.writeInt32LE(entries.length, 0);
  const head = Buffer.from(p.buf.subarray(0, p.countAt));
  head.writeInt32LE(4 + 4 + body.length, p.sizeAt);   // keys-to-remove + count + entries
  return Buffer.concat([head, count, body, p.buf.subarray(p.mapEnd)]);
}

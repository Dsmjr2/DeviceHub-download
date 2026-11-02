# Makes the .xz samples tests/xz.mjs decodes (1 Nov 2026). Run once from DeviceHub's folder:
#   py tests/fixtures/xz/make.py
# Python's lzma (liblzma) writes every sample except multiblock.xz, which needs the xz program's --block-size (Git for
# Windows ships it as xz.exe). manifest.json records each sample's expected length and SHA-256, or the error it must
# raise. vial-sample.json is the keyboard definition the Vial simulator (tests/sim-vial.mjs) serves.
import hashlib, json, lzma, os, random, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
out = {}

def save(name, data, expect=None, error=None):
    with open(os.path.join(HERE, name), 'wb') as f:
        f.write(data)
    if error:
        out[name] = {'error': error}
    else:
        out[name] = {'length': len(expect), 'sha256': hashlib.sha256(expect).hexdigest()}

def vial_json():
    # a 2-row board drawn the way vial.json files draw keys (KLE rows; "row,col" in the first legend), an encoder drawn
    # the Vial way ("0,0" in legend 0 and "e" as the tenth line, which KLE puts in slot 4), and the vial-only fields
    keys = [[{"x": 0}] + ["%d,%d" % (0, c) for c in range(8)], ["%d,%d" % (1, c) for c in range(8)],
            [{"y": 0.5}, "0,0" + "\n" * 9 + "e", "0,1" + "\n" * 9 + "e"]]
    return {"name": "Simulated Vial board", "vendorId": "0xFEED", "productId": "0x1001", "lighting": "none",
            "matrix": {"rows": 2, "cols": 8}, "layouts": {"keymap": keys},
            "vial": {"midi": "none"}, "customKeycodes": [{"name": "X1", "title": "Custom one", "shortName": "X1"}]}

text = json.dumps(vial_json(), separators=(',', ':')).encode('utf-8')
with open(os.path.join(HERE, 'vial-sample.json'), 'wb') as f:
    f.write(text)
save('vial-sample.xz', lzma.compress(text), text)            # what vial-qmk's vial_generate_definition.py does
save('empty.xz', lzma.compress(b''), b'')

rnd = random.Random(20261101)
words = [''.join(rnd.choice('abcdefghij') for _ in range(rnd.randint(2, 9))) for _ in range(400)]
prose = ' '.join(rnd.choice(words) for _ in range(30000)).encode()       # ~180 KB, many LZMA chunks
noise = bytes(rnd.getrandbits(8) for _ in range(30000))                   # incompressible: stored chunks
mixed = prose[:50000] + noise[:15000] + prose[50000:90000] + bytes(5000) + noise[15000:]

save('crc32.xz', lzma.compress(prose[:20000], check=lzma.CHECK_CRC32), prose[:20000])
save('nocheck.xz', lzma.compress(prose[:20000], check=lzma.CHECK_NONE), prose[:20000])
save('mixed.xz', lzma.compress(mixed), mixed)
save('extreme.xz', lzma.compress(prose, preset=9 | lzma.PRESET_EXTREME), prose)
save('props-lc0-lp2-pb0.xz', lzma.compress(mixed[:60000], filters=[{'id': lzma.FILTER_LZMA2, 'lc': 0, 'lp': 2, 'pb': 0}]), mixed[:60000])
save('props-lc4-lp0-pb4.xz', lzma.compress(mixed[:60000], filters=[{'id': lzma.FILTER_LZMA2, 'lc': 4, 'lp': 0, 'pb': 4, 'dict_size': 4096}]), mixed[:60000])
two = lzma.compress(prose[:3000]) + bytes(8) + lzma.compress(noise[:3000], check=lzma.CHECK_CRC32)
save('multistream.xz', two, prose[:3000] + noise[:3000])
save('too-big.xz', lzma.compress(bytes(3 * 1024 * 1024)), None, 'more than allowed')
save('sha256.xz', lzma.compress(b'hello', check=lzma.CHECK_SHA256), None, 'SHA-256')
save('bcj.xz', lzma.compress(prose[:4000], filters=[{'id': lzma.FILTER_X86}, {'id': lzma.FILTER_LZMA2}]), None, 'BCJ')

xz = shutil.which('xz') or next((p for p in [r'C:\Program Files\Git\mingw64\bin\xz.exe', r'C:\Program Files\Git\usr\bin\xz.exe'] if os.path.exists(p)), None)
if not xz:
    sys.exit('xz.exe was not found (Git for Windows ships it); multiblock.xz needs it')
data = mixed[:120000]
r = subprocess.run([xz, '-z', '-c', '-6', '--block-size=16KiB', '--check=crc64'], input=data, capture_output=True, check=True)
save('multiblock.xz', r.stdout, data)

with open(os.path.join(HERE, 'manifest.json'), 'w') as f:
    json.dump(out, f, indent=2)
    f.write('\n')
print('made', len(out), 'samples')

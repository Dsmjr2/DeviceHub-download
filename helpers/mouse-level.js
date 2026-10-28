// The mouse's real battery level (19 Oct 2026). The X-Lite reports a level worked out from its battery voltage, in
// 5% steps. The charger lifts that voltage, so on the cable it reads high (95% at 4.10 V) and for a few minutes after
// unplugging too (85%, 70%, then 65% settled). It has no charge-counting chip, so DeviceHub keeps its own level and
// every page shows that one:
//
//   on battery     the mouse's own reading, which is right once settled; it only ever goes down (an upward 5% blip
//                  is voltage noise), unless it is 10 or more above (DeviceHub's level was off: take the mouse's)
//   plugged in     starts from DeviceHub's level at that moment and adds charge at the measured speed: the learned
//                  rate up to 80%, half of it above (charging slows as the cell fills); 99% at most until the mouse
//                  itself reports 100%
//   unplugged      keeps the end-of-charge level, following the mouse's reading only downward, until that reading
//                  has held steady for 3 minutes within one 5% step of it (the voltage has settled; 30 minutes at
//                  most); the settled reading then replaces it, and where the charge started vs where it settled
//                  teaches the charge speed
//
// Kept in mouse-level.json beside DeviceHub, so a restart carries on where it was.
const fs = require('fs');
const { writeAtomic } = require('./safe-write');  // crash-proof saving (helpers/safe-write.js)
const path = require('path');

const FILE = require('./data-dir').dataFile('mouse-level.json');
const DEFAULT_RATE = 1.2;          // % per minute until a charge is measured (19 Oct 2026: 30% -> 65% in ~31 min = 1.13-1.26)
const SETTLE_MAX_MS = 30 * 60000;

let s = load();
function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^﻿/, '')); } catch { return { level: null, mode: 'battery', rates: [] }; } }
function save() { try { writeAtomic(FILE, JSON.stringify(s, null, 1)); } catch {} }
const rate = () => { const r = [...(s.rates || [])].sort((a, b) => a - b); return r.length ? r[Math.floor(r.length / 2)] : DEFAULT_RATE; };

// level after `mins` on the charger from `from`: full speed to 80%, half speed above
function charged(from, mins) {
  const k = rate();
  const toEighty = Math.max(0, (80 - from) / k);
  if (mins <= toEighty) return from + mins * k;
  return Math.max(from, 80) + (mins - toEighty) * (k / 2);
}

// b = the mouse's own reading { percent, charging, mv }; returns it with percent = DeviceHub's level
function filter(b) {
  if (!b || b.percent == null) return b;
  const now = Date.now();
  const raw = b.percent;
  if (s.level == null) { s.level = raw; s.mode = b.charging ? 'charging' : 'battery'; s.since = now; s.anchor = raw; save(); }

  if (b.charging) {
    if (s.mode !== 'charging') { s.anchor = s.level; s.since = now; s.mode = 'charging'; }
    s.level = raw >= 100 ? 100 : Math.min(99, charged(s.anchor, (now - s.since) / 60000));
    s.endedAt = null;
  } else {
    if (s.mode === 'charging') {
      s.mode = 'settling'; s.chargeFrom = s.anchor; s.chargeMins = (now - s.since) / 60000; s.endedAt = now; s.settleRaw = null;
    }
    if (s.mode === 'settling') {
      // follow the reading down meanwhile. Settled = the same reading for 3 minutes AND within one 5% step of
      // DeviceHub's level, or 30 minutes after unplugging whatever it reads (a long charge may have been
      // underestimated). 19 Oct 2026: after a 1-minute charge the mouse read 80% for over 3 minutes while the true
      // level was ~72%, and the old rule took the 80.
      if (raw < s.level) s.level = raw;
      if (raw !== s.settleRaw) { s.settleRaw = raw; s.settleRawAt = now; }
      if ((now - s.settleRawAt >= 3 * 60000 && raw <= s.level + 5) || now - s.endedAt > SETTLE_MAX_MS) {
        // settled: the mouse's reading is the truth again; learn how fast that charge really was
        if (s.chargeMins >= 10 && raw < 95 && raw > s.chargeFrom) {
          const measured = (raw - s.chargeFrom) / s.chargeMins;
          if (measured > 0.2 && measured < 5) s.rates = [...(s.rates || []), +measured.toFixed(2)].slice(-5);
        }
        s.level = raw; s.mode = 'battery';
      }
    } else {
      // on battery: down only, unless the mouse reads clearly higher (DeviceHub's level was off)
      if (raw < s.level || raw - s.level >= 10) s.level = raw;
    }
  }
  s.level = Math.round(Math.max(0, Math.min(100, s.level)) * 10) / 10;
  save();
  study(now, b, raw);
  return { ...b, percent: Math.round(s.level), reported: raw, levelMode: s.mode };
}

// The battery study (19 Oct 2026, Shawn: "study my mouse battery"): every reading, about once a minute, goes to
// mouse-battery-study.jsonl with the voltage, the mouse's own number, charging and DeviceHub's level, kept 30 days.
// From whole discharges (full to low, at a steady drain) and whole charges it gives this battery's real
// voltage-to-level curve, which can then replace the mouse's 5% steps. No extra device reads: it logs the readings
// DeviceHub already takes.
const STUDY = require('./data-dir').dataFile('mouse-battery-study.jsonl');
let studyAt = 0, studyTrimAt = 0;
function study(now, b, raw) {
  if (now - studyAt < 30000) return;
  studyAt = now;
  try {
    fs.appendFileSync(STUDY, JSON.stringify({ at: now, mv: b.mv ?? null, raw, charging: !!b.charging, level: s.level, mode: s.mode }) + '\n');
    if (now - studyTrimAt > 24 * 3600 * 1000) {
      studyTrimAt = now;
      const keep = fs.readFileSync(STUDY, 'utf8').split('\n').filter((l) => { try { return now - JSON.parse(l).at < 30 * 24 * 3600 * 1000; } catch { return false; } });
      writeAtomic(STUDY, keep.join('\n') + '\n');
    }
  } catch {}
}

const info = () => ({ ...s, rate: rate() });
module.exports = { filter, info };

// Shared WebHID helpers: one command in flight per device, each send waits for its matching reply.

export class HidChannel {
  constructor(device, { reportId = 0, length = 32, match } = {}) {
    this.device = device;
    this.reportId = reportId;
    this.length = length;
    // match(sentBytes, reply) -> true when reply answers the command we sent
    this.match = match || ((sent, reply) => reply[0] === sent[0]);
    this.queue = Promise.resolve();
    this.quietUntil = 0;
    this.log = [];
  }

  async open() {
    if (!this.device.opened) await this.device.open();
  }

  // Send bytes, resolve with the reply as a Uint8Array. Serialised: commands never overlap.
  request(bytes, { timeoutMs = 1000, reportId = this.reportId } = {}) {
    const run = async () => {
      // After a timeout, a late reply could still arrive; give it time to land (nobody is listening) before the next command.
      const wait = this.quietUntil - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      return this.send(bytes, timeoutMs, reportId);
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  send(bytes, timeoutMs, reportId) {
    return new Promise((resolve, reject) => {
      const out = new Uint8Array(this.length);
      out.set(bytes.slice(0, this.length));
      const onReport = (e) => {
        if (e.reportId !== reportId && reportId !== 0) return;
        const reply = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
        if (!this.match(out, reply)) return;
        cleanup();
        this.log.push({ t: Date.now(), out: hex(out), in: hex(reply) });
        if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
        resolve(new Uint8Array(reply));
      };
      const timer = setTimeout(() => { cleanup(); this.quietUntil = Date.now() + 400; reject(new Error(`no reply to ${hex(out.slice(0, 4))}`)); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); this.device.removeEventListener('inputreport', onReport); };
      this.device.addEventListener('inputreport', onReport);
      this.device.sendReport(reportId, out).catch((err) => { cleanup(); reject(err); });
    });
  }
}

export const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');

// The server's agent plugs in its own device source (Windows HID through the native helper, helpers/hid-host.mjs), so no browser
// permission is needed there. provider(filters) -> a HIDDevice-like object or null.
let provider = null;
export function setDeviceProvider(fn) { provider = fn; }

// Find an already-permitted device matching the filter, or ask the user to pick one.
export async function getDevice(filters, { prompt = true } = {}) {
  if (provider) return provider(filters);
  const known = await navigator.hid.getDevices();
  const hit = known.find((d) => filters.some((f) => matches(d, f)));
  if (hit || !prompt) return hit || null;
  const picked = await navigator.hid.requestDevice({ filters });
  return picked.find((d) => filters.some((f) => matches(d, f))) || null;
}

function matches(d, f) {
  if (f.vendorId != null && d.vendorId !== f.vendorId) return false;
  if (f.productId != null && d.productId !== f.productId) return false;
  if (f.usagePage == null) return true;
  return d.collections.some((c) => c.usagePage === f.usagePage && (f.usage == null || c.usage === f.usage));
}

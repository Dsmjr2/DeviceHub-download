// The worked example of a device added on a PC (21 Oct 2026; helpers/my-devices.mjs loads my-devices/<name>/device.mjs).
// This one is pretend: its settings live in memory, so it runs with no hardware. DeviceHub skips folders whose name
// starts with "_"; DEVICEHUB_EXAMPLE_DEVICE=1 loads it, which is how the tests use it.
//
// To add a real device: copy this folder to my-devices/<your-device>/ (no "_"), give it its own id and title, and replace
// the pretend parts with the device's protocol. A HID device lists its channel in `hid`, then opens it in connect():
//
//   import { getDevice } from '../../public/devices/hid.js';
//   hid: { vid: '046D', pid: 'C547', page: 'FF00', usage: '0001', len: 20, reportId: 0x11 },
//   async connect() { this.dev = await getDevice([{ vendorId: 0x046d, productId: 0xc547, usagePage: 0xff00 }]); return !!this.dev; },
//
// and talks to it the way public/devices/pulsar.js does (dev.sendReport / the reply). Every rule in CLAUDE.md applies:
// only settings whose bytes were seen or are documented, write one setting and read it back, never firmware, resets or
// bootloader commands. A file here is this PC's own: DeviceHub's updates never change it.
const state = { brightness: 60, lights: true, mode: 'steady', battery: 80 };

export default {
  id: 'example-light',
  title: 'Example light',
  kind: 'Light',
  // what its page shows; DeviceHub draws the page from this list
  settings: [
    { key: 'lights', label: 'Lights', type: 'toggle' },
    { key: 'brightness', label: 'Brightness', type: 'slider', min: 0, max: 100, unit: '%', live: true },
    { key: 'mode', label: 'Effect', type: 'choice', options: [{ value: 'steady', label: 'Steady' }, { value: 'breathing', label: 'Breathing' }, { value: 'off', label: 'Off' }] },
  ],
  unsupported: ['firmware updates'],
  async connect() { return true; },
  async info() { return { Model: 'Example light', Firmware: '1.0 (pretend)' }; },
  async read() { return { brightness: state.brightness, lights: state.lights, mode: state.mode }; },
  // checks the value, writes it, reads it back
  async write(key, value) {
    if (key === 'brightness' && !(Number.isInteger(value) && value >= 0 && value <= 100)) throw new Error('brightness must be 0-100');
    if (key === 'lights' && typeof value !== 'boolean') throw new Error('lights must be on or off');
    if (key === 'mode' && !['steady', 'breathing', 'off'].includes(value)) throw new Error(`"${value}" is not an effect`);
    if (!(key in state) || key === 'battery') throw new Error(`${key} is not a setting`);
    state[key] = value;
    return (await this.read())[key];
  },
  async battery() { return { percent: state.battery, charging: false }; },
  async rawBackup() { return { ...state }; },
};

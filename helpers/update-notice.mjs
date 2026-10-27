// A new version is ready (24 Oct 2026, Shawn: "Dont check for updates every 6 hours, I still want them to be able to
// manually update ... but I do want you to provide a pop up that says there is an update"). server.js asks once, 2
// minutes after DeviceHub starts; the window shows the answer once, Update or Later. Nothing installs by itself.
// Only a signed version is offered (a zip copy's release, or a download copy's signed appCommit), never on the owner's PC.
export const when = (at) => { const d = new Date(at); return Number.isNaN(+d) ? null : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };

// status: helpers/self-update.js status(). { version, at, text, name, notes } or null. name: the readable number ("1.5"),
// notes: what's new, up to 5 short lines (27 Oct 2026; a release from before then has neither, and the text says as before)
export function notice({ owner, status }) {
  if (owner || !status || status.error || !status.behind) return null;
  if (!status.zip && !(status.git && status.shared)) return null;
  const version = status.version || null;
  if (!version) return null;
  const day = when(status.versionAt);
  const files = status.blockedFiles?.length || 0;
  const name = typeof status.versionName === 'string' && /^\d{1,4}\.\d{1,6}$/.test(status.versionName) ? status.versionName : null;
  const notes = name && Array.isArray(status.notes) ? status.notes.filter((n) => typeof n === 'string' && n.trim()).slice(0, 5) : [];
  const text = `${name ? `DeviceHub ${name} is ready` : 'A new version of DeviceHub is ready'}${day ? ` (${day})` : ''}.${status.blocked ? ` ${files === 1 ? '1 file was' : `${files || 'Some'} files were`} changed on this PC; Update keeps a copy of ${files === 1 ? 'it' : 'them'}.` : ''}`;
  return { version, at: status.versionAt || null, blocked: !!status.blocked, text, name, notes };
}

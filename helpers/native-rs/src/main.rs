#![allow(
    clippy::upper_case_acronyms,
    clippy::manual_c_str_literals,
    clippy::too_many_arguments,
    clippy::type_complexity,
    clippy::needless_range_loop,
    clippy::collapsible_if,
    clippy::chunks_exact_to_as_chunks,
    clippy::manual_range_patterns,
    clippy::wrong_self_convention
)]

mod audio;
mod audio_com;
mod camera;
mod cue;
mod hid;
mod hs80;
mod monitors;
mod pc_native;
mod pc_reads;
mod pointer;
mod ps_ops;
mod tray;
mod winbrand;
mod wmi;

use std::collections::{HashMap, HashSet};
use std::io::{self, BufRead, Write};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};

static OUT_LOCK: Mutex<()> = Mutex::new(());

fn say_to<W: Write>(out: &mut W, s: &str) {
    let _ = out.write_all(s.as_bytes());
    let _ = out.write_all(b"\n");
    let _ = out.flush();
}

pub fn say(s: &str) {
    let _g = OUT_LOCK.lock().unwrap();
    let mut out = io::stdout().lock();
    say_to(&mut out, s);
}

struct ChannelReq {
    seq: String,
    rest: String,
}

#[derive(Default)]
struct ChannelState {
    hid: Option<hid::HidIo>,
    watch: Option<hid::HidWatch>,
    hs: Option<hs80::Hs80Io>,
}

struct ChannelEntry {
    id: u64,
    tx: mpsc::Sender<ChannelReq>,
}

struct Shared {
    cue_dll: Option<String>,
    channels: Mutex<HashMap<String, ChannelEntry>>,
    next_id: Mutex<u64>,
}

fn parse_line(raw: &str) -> Option<(String, String, String)> {
    let line = raw.trim();
    let a = line.find(' ')?;
    let b_rel = line[a + 1..].find(' ')?;
    let b = a + 1 + b_rel;
    Some((
        line[..a].to_string(),
        line[a + 1..b].to_string(),
        line[b + 1..].to_string(),
    ))
}

fn main() {
    let cue_dll = std::env::args().nth(1);
    let shared = Arc::new(Shared {
        cue_dll,
        channels: Mutex::new(HashMap::new()),
        next_id: Mutex::new(1),
    });

    let mut handles: Vec<thread::JoinHandle<()>> = Vec::new();
    let stdin = io::stdin();
    for line_res in stdin.lock().lines() {
        let line = match line_res {
            Ok(l) => l,
            Err(_) => break,
        };
        let Some((chan, seq, rest)) = parse_line(&line) else { continue };

        let mut req = ChannelReq { seq, rest };
        let mut map = shared.channels.lock().unwrap();
        if let Some(entry) = map.get(&chan) {
            match entry.tx.send(req) {
                Ok(()) => continue,
                Err(mpsc::SendError(returned)) => req = returned,
            }
        }
        let mut nid = shared.next_id.lock().unwrap();
        let id = *nid;
        *nid += 1;
        drop(nid);

        let (tx, rx) = mpsc::channel::<ChannelReq>();
        let _ = tx.send(req);
        map.insert(chan.clone(), ChannelEntry { id, tx });
        drop(map);

        let shared_c = Arc::clone(&shared);
        let chan_c = chan.clone();
        let h = thread::spawn(move || work(shared_c, chan_c, id, rx));
        handles.push(h);
    }

    tray::stop();
    {
        let mut map = shared.channels.lock().unwrap();
        map.clear();
    }
    for h in handles {
        let _ = h.join();
    }
}

fn work(shared: Arc<Shared>, chan: String, id: u64, rx: mpsc::Receiver<ChannelReq>) {
    let mut state = ChannelState::default();
    for req in rx {
        let is_close = req.rest == "CLOSE";
        let reply = match handle(&shared, &chan, &mut state, &req.rest) {
            Ok(r) => r,
            Err(e) => {
                state.watch = None;
                state.hid = None;
                state.hs = None;
                if matches!(chan.as_str(), "audio" | "cue" | "monitor" | "camera") {
                    json!({ "ok": false, "error": e }).to_string()
                } else {
                    "GONE".to_string()
                }
            }
        };
        say(&format!("{chan} {} {reply}", req.seq));
        if is_close {
            let mut map = shared.channels.lock().unwrap();
            if let Some(cur) = map.get(&chan) {
                if cur.id == id {
                    map.remove(&chan);
                }
            }
            break;
        }
    }
}

fn handle(
    shared: &Shared,
    chan: &str,
    state: &mut ChannelState,
    rest: &str,
) -> Result<String, String> {
    if rest.len() > 8192 {
        return Ok("ERR payload too large".to_string());
    }
    if chan.starts_with("hid:") {
        return hid::handle(chan, rest, &mut state.hid, &mut state.watch);
    }
    if chan.starts_with("hs80:") {
        return hs80::handle(chan, rest, &mut state.hs);
    }
    if chan == "hidlist" {
        let mut w = rest.split_whitespace();
        let Some(page) = w.next().and_then(|s| i32::from_str_radix(s, 16).ok()) else {
            return Ok("ERR missing or bad page".to_string());
        };
        let Some(usage) = w.next().and_then(|s| i32::from_str_radix(s, 16).ok()) else {
            return Ok("ERR missing or bad usage".to_string());
        };
        return Ok(hid::list_by_usage(page, usage));
    }
    if chan == "audio" {
        return audio::handle(rest);
    }
    if chan == "pc" || chan.starts_with("pc:") {
        return Ok(pc_reads::handle(rest));
    }
    if chan == "cue" {
        return cue::handle(shared.cue_dll.as_deref(), rest);
    }
    if chan == "monitor" {
        return monitors::handle(rest);
    }
    if chan == "camera" {
        return camera::handle(rest);
    }
    if chan == "tray" {
        let w: Vec<&str> = rest.splitn(3, ' ').collect();
        if w.first() == Some(&"START") && w.len() == 3 {
            let port: u16 = w[1].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
            return Ok(tray::start(port, w[2]));
        }
        if w.first() == Some(&"WAKE") && w.len() == 2 {
            return Ok(tray::wake(w[1] == "ON"));
        }
        return Ok("ERR unknown command".to_string());
    }
    if chan == "win" {
        if let Some(body) = rest.strip_prefix("BRAND ") {
            let mut parts = body.splitn(2, '|');
            let ico = parts.next().unwrap_or("");
            let relaunch = parts.next().unwrap_or("");
            return Ok(winbrand::brand(ico, relaunch));
        }
        return Ok("ERR unknown command".to_string());
    }
    if chan == "pointer" {
        let w: Vec<&str> = rest.split_whitespace().collect();
        let res = if w.first() == Some(&"SET") && w.len() >= 3 {
            let v: i32 = w[2].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
            pointer::set(w[1], v)
        } else {
            Ok(pointer::read())
        };
        return Ok(match res {
            Ok(v) => v.to_string(),
            Err(e) => json!({ "ok": false, "error": e }).to_string(),
        });
    }
    if chan == "watchdog" {
        if rest == "HANG-TEST" {
            loop {
                thread::sleep(Duration::from_secs(3600));
            }
        }
        return Ok("PONG".to_string());
    }
    if chan == "diag" {
        return Ok("rust-helper".to_string());
    }
    Ok("ERR unknown channel".to_string())
}

fn list_process_names() -> Result<Vec<String>, String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    // SAFETY: Win32 system/process API call with valid handles and caller-owned output buffers.
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
            .map_err(|e| format!("snapshot failed: {e}"))?;
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut seen = HashSet::<String>::new();
        let mut out = Vec::<String>::new();
        if Process32FirstW(snap, &mut entry).is_ok() {
            loop {
                let len = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                let key = name.to_ascii_lowercase();
                if !name.is_empty() && seen.insert(key) {
                    out.push(name);
                }
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
        Ok(out)
    }
}

fn get_power_status() -> Value {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut s = SYSTEM_POWER_STATUS::default();
    // SAFETY: Win32 power management API with valid GUID/struct pointers.
    let ok = unsafe { GetSystemPowerStatus(&mut s) }.is_ok();
    if !ok {
        return json!({ "ok": true, "hasBattery": false, "onBattery": false, "percent": Value::Null });
    }
    let has_battery = (s.BatteryFlag & 128) == 0 && s.BatteryFlag != 255;
    let on_battery = s.ACLineStatus == 0;
    let percent = if s.BatteryLifePercent <= 100 {
        json!(s.BatteryLifePercent)
    } else {
        Value::Null
    };
    json!({
        "ok": true,
        "hasBattery": has_battery,
        "onBattery": on_battery,
        "percent": percent,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct BrokenPipeWriter;
    impl Write for BrokenPipeWriter {
        fn write(&mut self, _buf: &[u8]) -> io::Result<usize> {
            Err(io::Error::new(io::ErrorKind::BrokenPipe, "closed"))
        }
        fn flush(&mut self) -> io::Result<()> {
            Err(io::Error::new(io::ErrorKind::BrokenPipe, "closed"))
        }
    }

    fn test_shared() -> Shared {
        Shared {
            cue_dll: None,
            channels: Mutex::new(HashMap::new()),
            next_id: Mutex::new(1),
        }
    }

    #[test]
    fn unknown_channel_and_commands_return_err() {
        let shared = test_shared();
        let mut st = ChannelState::default();
        assert_eq!(handle(&shared, "bogus", &mut st, "PING").unwrap(), "ERR unknown channel");
        assert_eq!(handle(&shared, "tray", &mut st, "NOPE").unwrap(), "ERR unknown command");
        assert_eq!(handle(&shared, "win", &mut st, "NOPE").unwrap(), "ERR unknown command");
        assert_eq!(
            handle(&shared, "hidlist", &mut st, "zz 01").unwrap(),
            "ERR missing or bad page"
        );
    }

    #[test]
    fn oversize_payload_returns_err() {
        let shared = test_shared();
        let mut st = ChannelState::default();
        let big = "x".repeat(9000);
        assert_eq!(handle(&shared, "diag", &mut st, &big).unwrap(), "ERR payload too large");
    }

    #[test]
    fn closed_stdout_does_not_panic_or_hang() {
        let mut w = BrokenPipeWriter;
        say_to(&mut w, "diag 1 rust-helper");
    }

    #[test]
    fn fuzz_parser_malformed_half_lines_binary_huge_and_burst() {
        assert!(parse_line("").is_none());
        assert!(parse_line("   ").is_none());
        assert!(parse_line("diag").is_none());
        assert!(parse_line("diag 1").is_none());
        assert_eq!(
            parse_line("  diag 1 PING  "),
            Some(("diag".into(), "1".into(), "PING".into()))
        );

        let shared = test_shared();
        let mut st = ChannelState::default();
        let huge = "A".repeat(65536);
        for chan in ["diag", "pc", "audio", "monitor", "camera", "cue", "hid:1b1c:0a69:ff42:0001:64:0", "hs80:0a69:1"] {
            assert_eq!(handle(&shared, chan, &mut st, &huge).unwrap(), "ERR payload too large");
        }

        let bad_inputs = [
            "\0\x01\x02\x7f\u{FFFD}",
            "{broken json",
            "[]",
            "null",
            "12345",
            "",
            "   ",
            "SET",
            "GET",
        ];
        for chan in ["bogus", "tray", "win", "hidlist", "pc", "audio", "monitor", "camera", "cue", "hs80:0a69:1", "hid:dead:beef:ff00:0001:64:0"] {
            for inp in bad_inputs {
                let _ = handle(&shared, chan, &mut st, inp);
            }
        }

        // Fast burst of 5,000 mixed requests must not panic, hang, or accumulate state
        for i in 0..5000 {
            let r = match i % 5 {
                0 => handle(&shared, "watchdog", &mut st, "PING").unwrap(),
                1 => handle(&shared, "diag", &mut st, "MEM").unwrap(),
                2 => handle(&shared, "bogus", &mut st, "X").unwrap(),
                3 => handle(&shared, "hs80:0a69:1", &mut st, "SET 0d 1").unwrap(),
                _ => handle(&shared, "hid:1b1c:0a69:ff42:0001:64:0", &mut st, "OPEN").unwrap(),
            };
            assert!(!r.is_empty());
        }
    }
}

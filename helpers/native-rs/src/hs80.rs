use crate::hid::{find, open_device_handle};
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

#[repr(C)]
struct OVERLAPPED {
    internal: usize,
    internal_high: usize,
    offset: u32,
    offset_high: u32,
    h_event: isize,
}

const GENERIC_READ: u32 = 0x8000_0000;
const GENERIC_WRITE: u32 = 0x4000_0000;
const ERROR_IO_PENDING: u32 = 997;

#[link(name = "kernel32")]
extern "system" {
    fn CloseHandle(h_object: isize) -> i32;
    fn GetLastError() -> u32;
    fn CreateEventW(
        lp_event_attributes: *mut c_void,
        b_manual_reset: i32,
        b_initial_state: i32,
        lp_name: *const u16,
    ) -> isize;
    fn ResetEvent(h_event: isize) -> i32;
    fn ReadFile(
        h_file: isize,
        lp_buffer: *mut u8,
        n_number_of_bytes_to_read: u32,
        lp_number_of_bytes_read: *mut u32,
        lp_overlapped: *mut OVERLAPPED,
    ) -> i32;
    fn WriteFile(
        h_file: isize,
        lp_buffer: *const u8,
        n_number_of_bytes_to_write: u32,
        lp_number_of_bytes_written: *mut u32,
        lp_overlapped: *mut OVERLAPPED,
    ) -> i32;
    fn GetOverlappedResult(
        h_file: isize,
        lp_overlapped: *mut OVERLAPPED,
        lp_number_of_bytes_transferred: *mut u32,
        b_wait: i32,
    ) -> i32;
    fn CancelIoEx(h_file: isize, lp_overlapped: *mut OVERLAPPED) -> i32;
}

pub fn report_len(peripheral: bool) -> usize {
    if peripheral { 65 } else { 64 }
}

fn from_ep(ep: u8) -> u8 {
    if ep == 9 { 1 } else { 0 }
}

fn is_reply(peripheral: bool, ep: u8, b: &[u8]) -> bool {
    if b.len() < 4 {
        return false;
    }
    if peripheral {
        b[0] == 0 && b[1] == from_ep(ep) && (b[2] == 1 || b[2] == 2)
    } else {
        b[0] == 1 && b[1] == from_ep(ep) && (b[2] == 1 || b[2] == 2 || b[2] == 6 || b[2] == 0x0d)
    }
}

fn is_event(peripheral: bool, ep: u8, b: &[u8]) -> bool {
    !peripheral && b.len() >= 9 && b[0] == 3 && b[1] == from_ep(ep) && b[2] == 1
}

fn frame(peripheral: bool, ep: u8, cmd: u8) -> Vec<u8> {
    let mut o = vec![0u8; report_len(peripheral)];
    o[0] = if peripheral { 0 } else { 2 };
    o[1] = ep;
    o[2] = cmd;
    o
}

fn get_frame(peripheral: bool, ep: u8, id: i32) -> Vec<u8> {
    let mut o = frame(peripheral, ep, 2);
    o[3] = (id & 0xff) as u8;
    o[4] = ((id >> 8) & 0xff) as u8;
    o
}

fn set_frame(peripheral: bool, ep: u8, id: i32, value: i32) -> Vec<u8> {
    let mut o = frame(peripheral, ep, 1);
    o[3] = id as u8;
    o[4] = 0;
    let bytes = value.to_le_bytes();
    o[5..9].copy_from_slice(&bytes);
    o
}

fn light_frame(ep: u8, rgb9: &[u8]) -> Vec<u8> {
    let mut o = frame(false, ep, 6);
    o[3] = 0;
    o[4] = 9;
    o[8..17].copy_from_slice(&rgb9[..9]);
    o
}

fn open_light_frame(ep: u8) -> Vec<u8> {
    let mut o = frame(false, ep, 0x0d);
    o[3] = 0;
    o[4] = 1;
    o
}

fn hs80_allows(id: i32, value: i32) -> bool {
    (id == 0x02 && (0..=1000).contains(&value))
        || (id == 0x03 && (value == 1 || value == 2))
        || (id == 0x0e && (60000..=7200000).contains(&value))
        || (id == 0x0d && (value == 0 || value == 1))
        || (id == 0x46 && (value == 0 || value == 1))
        || (id == 0x47 && (0..=1000).contains(&value))
}

fn peripheral_allows(id: i32, value: i32) -> bool {
    (id == 0x02 && (0..=1000).contains(&value))
        || (id == 0x0d && (value == 0 || value == 1))
        || (id == 0x0e && (60000..=3600000).contains(&value))
        || (id == 0x01 && (1..=4).contains(&value))
        || ((id == 0x21 || id == 0x22) && (100..=26000).contains(&value))
}

fn allows(peripheral: bool, id: i32, value: i32) -> bool {
    if peripheral {
        peripheral_allows(id, value)
    } else {
        hs80_allows(id, value)
    }
}

fn frame_of(name: &str) -> Option<&'static str> {
    let p: Vec<&str> = name.split(':').collect();
    let mut f = "hs80";
    for item in p.iter().skip(3) {
        if !item.starts_with("frame=") {
            continue;
        }
        if *item == "frame=peripheral" && f == "hs80" {
            f = "peripheral";
        } else {
            return None;
        }
    }
    Some(f)
}

pub(crate) fn is_hs80_pid(pid: &str) -> bool {
    matches!(pid.to_ascii_uppercase().as_str(), "0A69" | "0A6B" | "0A71")
}

pub(crate) fn hs80_own_refusal(name: &str, verb: &str, id: i32) -> Option<String> {
    let p: Vec<&str> = name.split(':').collect();
    if p.len() < 2 || !is_hs80_pid(p[1]) {
        return None;
    }
    for item in p.iter().skip(3) {
        if *item == "bragi" && verb != "CLOSE" {
            return Some(
                "the HS80 is DeviceHub's own headset: a library driver never talks to it".into(),
            );
        }
    }
    if verb == "SET" && (id == 0x0d || id == 0x46 || id == 0x47) {
        return Some(format!("DeviceHub's own HS80 code never sets {id:02x}"));
    }
    None
}

pub struct Hs80Io {
    h: isize,
    ep: u8,
    peripheral: bool,
    broken: Arc<AtomicBool>,
    replies_rx: Mutex<mpsc::Receiver<Vec<u8>>>,
    reader_thread: Option<thread::JoinHandle<()>>,
}

impl Hs80Io {
    pub fn open(path: &str, ep: u8, peripheral: bool, chan_name: String) -> Result<Self, String> {
        let h = open_device_handle(path, GENERIC_READ | GENERIC_WRITE, true)
            .map_err(|e| format!("open failed {e}"))?;
        let len = report_len(peripheral);
        let broken = Arc::new(AtomicBool::new(false));
        let broken_c = Arc::clone(&broken);
        let (rep_tx, rep_rx) = mpsc::channel::<Vec<u8>>();

        let t = thread::spawn(move || {
            // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
            let ev = unsafe { CreateEventW(std::ptr::null_mut(), 1, 0, std::ptr::null()) };
            let mut b = vec![0u8; len];
            loop {
                // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
                unsafe { ResetEvent(ev) };
                let mut ov = OVERLAPPED {
                    internal: 0,
                    internal_high: 0,
                    offset: 0,
                    offset_high: 0,
                    h_event: ev,
                };
                let mut n: u32 = 0;
                // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
                let ok = unsafe {
                    ReadFile(h, b.as_mut_ptr(), len as u32, &mut n, &mut ov)
                };
                if ok == 0 {
                    // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
                    let err = unsafe { GetLastError() };
                    if err == ERROR_IO_PENDING {
                        // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
                        if unsafe { GetOverlappedResult(h, &mut ov, &mut n, 1) } == 0 {
                            broken_c.store(true, Ordering::SeqCst);
                            break;
                        }
                    } else {
                        broken_c.store(true, Ordering::SeqCst);
                        break;
                    }
                }
                if n == 0 {
                    continue;
                }
                if is_reply(peripheral, ep, &b) {
                    let _ = rep_tx.send(b.clone());
                } else if is_event(peripheral, ep, &b) {
                    let val = i32::from_le_bytes(b[5..9].try_into().unwrap());
                    crate::say(&format!("{chan_name} EVT {:02x} {val}", b[3]));
                }
            }
            if ev != 0 {
                // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
                unsafe { CloseHandle(ev) };
            }
        });

        Ok(Self {
            h,
            ep,
            peripheral,
            broken,
            replies_rx: Mutex::new(rep_rx),
            reader_thread: Some(t),
        })
    }

    pub fn is_broken(&self) -> bool {
        self.broken.load(Ordering::SeqCst)
    }

    fn send(&self, out: &[u8], wait_ms: u64) -> Result<Option<Vec<u8>>, String> {
        let rx = self.replies_rx.lock().unwrap();
        while rx.try_recv().is_ok() {}
        // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
        let ev = unsafe { CreateEventW(std::ptr::null_mut(), 1, 0, std::ptr::null()) };
        let mut ov = OVERLAPPED {
            internal: 0,
            internal_high: 0,
            offset: 0,
            offset_high: 0,
            h_event: ev,
        };
        let mut written: u32 = 0;
        // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
        let ok = unsafe { WriteFile(self.h, out.as_ptr(), out.len() as u32, &mut written, &mut ov) };
        let res = if ok != 0 {
            Ok(())
        } else {
            // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
            let err = unsafe { GetLastError() };
            if err == ERROR_IO_PENDING {
                // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
                if unsafe { GetOverlappedResult(self.h, &mut ov, &mut written, 1) } != 0 {
                    Ok(())
                } else {
                    // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
                    Err(unsafe { GetLastError() })
                }
            } else {
                Err(err)
            }
        };
        if ev != 0 {
            // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
            unsafe { CloseHandle(ev) };
        }
        if let Err(code) = res {
            return Err(format!("write failed {code}"));
        }
        Ok(rx.recv_timeout(Duration::from_millis(wait_ms)).ok())
    }

    pub fn get(&self, id: i32, wait_ms: u64) -> Result<Option<Vec<u8>>, String> {
        self.send(&get_frame(self.peripheral, self.ep, id), wait_ms)
    }

    pub fn set(&self, id: i32, value: i32, wait_ms: u64) -> Result<i32, String> {
        if !allows(self.peripheral, id, value) {
            return Err(format!(
                "ERR property {id:02x} = {value} is not something DeviceHub sets"
            ));
        }
        let r = self.send(&set_frame(self.peripheral, self.ep, id, value), wait_ms)?;
        Ok(r.map(|b| b[3] as i32).unwrap_or(-1))
    }

    pub fn light(&self, rgb9: &[u8], wait_ms: u64) -> Result<i32, String> {
        if self.peripheral {
            return Err("ERR no light messages on a peripheral channel".into());
        }
        let r = self.send(&light_frame(self.ep, rgb9), wait_ms)?;
        Ok(r.map(|b| b[3] as i32).unwrap_or(-1))
    }

    pub fn open_light(&self, wait_ms: u64) -> Result<i32, String> {
        if self.peripheral {
            return Err("ERR no handles are opened on a peripheral channel".into());
        }
        let r = self.send(&open_light_frame(self.ep), wait_ms)?;
        Ok(r.map(|b| b[3] as i32).unwrap_or(-1))
    }
}

impl Drop for Hs80Io {
    fn drop(&mut self) {
        // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
        unsafe {
            CancelIoEx(self.h, std::ptr::null_mut());
            CloseHandle(self.h);
        }
        if let Some(t) = self.reader_thread.take() {
            let _ = t.join();
        }
    }
}

pub fn handle(chan: &str, rest: &str, hs: &mut Option<Hs80Io>) -> Result<String, String> {
    if rest.len() > 4096 {
        return Ok("ERR payload too large".into());
    }
    let p: Vec<&str> = chan.split(':').collect();
    let w: Vec<&str> = rest.split_whitespace().collect();
    if w.len() > 64 {
        return Ok("ERR payload too large".into());
    }
    let verb = w.first().copied().unwrap_or("");
    let sid = if w.len() > 1 && verb == "SET" {
        i32::from_str_radix(w[1], 16).unwrap_or(-1)
    } else {
        -1
    };
    if let Some(no) = hs80_own_refusal(chan, verb, sid) {
        return Ok(format!("ERR {no}"));
    }

    let st = |x: i32| -> String {
        if x < 0 {
            "NONE".into()
        } else {
            format!("{x:02x}")
        }
    };

    match verb {
        "OPEN" => {
            if p.len() < 3 {
                return Ok("ERR bad hs80 channel".into());
            }
            if let Some(cur) = hs.as_ref() {
                if !cur.is_broken() {
                    return Ok("OK".into());
                }
            }
            let Some(frame_kind) = frame_of(chan) else {
                return Ok("ERR unknown frame".into());
            };
            let per = frame_kind == "peripheral";
            if per && is_hs80_pid(p[1]) {
                return Ok("ERR the HS80 is never opened on the peripheral frame".into());
            }
            let Ok(ep) = p[2].parse::<u8>() else {
                return Ok("ERR bad hs80 endpoint".into());
            };
            let path = find("1b1c", p[1], 0xFF42, 1, report_len(per) as i32);
            let Some(path) = path else {
                return Ok("NODEVICE".into());
            };
            *hs = Some(Hs80Io::open(&path, ep, per, chan.to_string())?);
            return Ok("OK".into());
        }
        "CLOSE" => {
            *hs = None;
            return Ok("OK".into());
        }
        "" => return Ok("ERR unknown command".into()),
        _ => {}
    }

    let broken = hs.as_ref().map(|h| h.is_broken()).unwrap_or(false);
    if hs.is_none() || broken {
        *hs = None;
        return Ok("GONE".into());
    }
    let io = hs.as_ref().unwrap();

    match verb {
        "GET" => {
            if w.len() < 2 {
                return Ok("ERR missing property id".into());
            }
            let Ok(id) = i32::from_str_radix(w[1], 16) else {
                return Ok("ERR bad property id".into());
            };
            Ok(match io.get(id, 400)? {
                Some(r) => r[3..9]
                    .iter()
                    .map(|x| format!("{x:02x}"))
                    .collect::<Vec<_>>()
                    .join(" "),
                None => "NONE".into(),
            })
        }
        "SET" => {
            if w.len() < 3 {
                return Ok("ERR missing property id or value".into());
            }
            let Ok(id) = i32::from_str_radix(w[1], 16) else {
                return Ok("ERR bad property id".into());
            };
            let Ok(val) = w[2].parse::<i32>() else {
                return Ok("ERR bad value".into());
            };
            match io.set(id, val, 400) {
                Ok(v) => Ok(st(v)),
                Err(e) if e.starts_with("ERR ") => Ok(e),
                Err(e) => Err(e),
            }
        }
        "MODE" => {
            if w.len() < 2 {
                return Ok("ERR missing mode value".into());
            }
            let Ok(val) = w[1].parse::<i32>() else {
                return Ok("ERR bad mode value".into());
            };
            match io.set(3, val, 400) {
                Ok(v) => Ok(st(v)),
                Err(e) if e.starts_with("ERR ") => Ok(e),
                Err(e) => Err(e),
            }
        }
        "LIGHT" => {
            let rgb: Result<Vec<u8>, _> = w[1..].iter().map(|x| u8::from_str_radix(x, 16)).collect();
            let Ok(rgb) = rgb else {
                return Ok("ERR bad rgb hex".into());
            };
            if rgb.len() != 9 {
                return Ok("ERR need 9 bytes".into());
            }
            match io.light(&rgb, 400) {
                Ok(v) => Ok(st(v)),
                Err(e) if e.starts_with("ERR ") => Ok(e),
                Err(e) => Err(e),
            }
        }
        "OPENLIGHT" => match io.open_light(400) {
            Ok(v) => Ok(st(v)),
            Err(e) if e.starts_with("ERR ") => Ok(e),
            Err(e) => Err(e),
        },
        "FRAME" => Ok(if io.peripheral { "peripheral" } else { "hs80" }.into()),
        _ => Ok("ERR unknown command".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_set_0d_46_47_on_hs80_channels() {
        for pid in ["0a69", "0a6b", "0a71"] {
            let chan = format!("hs80:{pid}:1");
            for (cmd, hex) in [("SET 0d 1", "0d"), ("SET 46 1", "46"), ("SET 47 500", "47")] {
                let mut hs = None;
                let res = handle(&chan, cmd, &mut hs).unwrap();
                assert!(
                    res.starts_with("ERR ") && res.contains(hex),
                    "expected refusal for {chan} {cmd}, got {res}"
                );
            }
        }
    }

    #[test]
    fn refuses_peripheral_frame_on_hs80() {
        let mut hs = None;
        let res = handle("hs80:0a69:1:frame=peripheral", "OPEN", &mut hs).unwrap();
        assert_eq!(res, "ERR the HS80 is never opened on the peripheral frame");
    }

    #[test]
    fn refuses_bragi_library_driver_on_hs80() {
        for verb in ["OPEN", "GET 02", "SET 03 1"] {
            let mut hs = None;
            let res = handle("hs80:0a6b:1:bragi", verb, &mut hs).unwrap();
            assert!(
                res.starts_with("ERR ") && res.contains("library driver"),
                "expected bragi refusal for {verb}, got {res}"
            );
        }
        let mut hs = None;
        assert_eq!(handle("hs80:0a6b:1:bragi", "CLOSE", &mut hs).unwrap(), "OK");
    }

    #[test]
    fn malformed_unknown_oversize_and_unplugged_return_cleanly() {
        let mut hs = None;
        assert_eq!(handle("hs80:0a69", "OPEN", &mut hs).unwrap(), "ERR bad hs80 channel");
        assert_eq!(handle("hs80:0a69:1", "", &mut hs).unwrap(), "ERR unknown command");
        assert_eq!(handle("hs80:0a69:1", "GET 02", &mut hs).unwrap(), "GONE");
        assert_eq!(handle("hs80:ffff:1", "OPEN", &mut hs).unwrap(), "NODEVICE");
        let big = "a ".repeat(4000);
        assert_eq!(handle("hs80:0a69:1", &big, &mut hs).unwrap(), "ERR payload too large");
    }
}

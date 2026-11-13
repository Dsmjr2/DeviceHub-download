use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::thread;
use std::time::{Duration, Instant};

#[repr(C)]
#[derive(Clone, Copy)]
struct GUID {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

#[repr(C)]
struct SP_DEVICE_INTERFACE_DATA {
    cb_size: u32,
    interface_class_guid: GUID,
    flags: u32,
    reserved: usize,
}

#[repr(C)]
struct OVERLAPPED {
    internal: usize,
    internal_high: usize,
    offset: u32,
    offset_high: u32,
    h_event: isize,
}

const INVALID_HANDLE_VALUE: isize = -1;
const GENERIC_READ: u32 = 0x8000_0000;
const GENERIC_WRITE: u32 = 0x4000_0000;
const FILE_SHARE_READ_WRITE: u32 = 3;
const OPEN_EXISTING: u32 = 3;
const FILE_FLAG_OVERLAPPED: u32 = 0x4000_0000;
const ERROR_IO_PENDING: u32 = 997;
const WAIT_OBJECT_0: u32 = 0;

#[link(name = "kernel32")]
extern "system" {
    fn CreateFileW(
        lp_file_name: *const u16,
        dw_desired_access: u32,
        dw_share_mode: u32,
        lp_security_attributes: *mut c_void,
        dw_creation_disposition: u32,
        dw_flags_and_attributes: u32,
        h_template_file: isize,
    ) -> isize;
    fn CloseHandle(h_object: isize) -> i32;
    fn GetLastError() -> u32;
    fn CreateEventW(
        lp_event_attributes: *mut c_void,
        b_manual_reset: i32,
        b_initial_state: i32,
        lp_name: *const u16,
    ) -> isize;
    fn ResetEvent(h_event: isize) -> i32;
    fn WaitForSingleObject(h_handle: isize, dw_milliseconds: u32) -> u32;
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

#[link(name = "hid")]
extern "system" {
    fn HidD_GetHidGuid(hid_guid: *mut GUID);
    fn HidD_GetPreparsedData(hid_device_object: isize, preparsed_data: *mut isize) -> i32;
    fn HidD_FreePreparsedData(preparsed_data: isize) -> i32;
    fn HidP_GetCaps(preparsed_data: isize, capabilities: *mut u8) -> i32;
    fn HidD_GetProductString(hid_device_object: isize, buffer: *mut u16, buffer_length: u32)
        -> i32;
    fn HidD_FlushQueue(hid_device_object: isize) -> i32;
    fn HidD_SetFeature(hid_device_object: isize, report_buffer: *const u8, buffer_len: u32) -> i32;
    fn HidD_GetFeature(hid_device_object: isize, report_buffer: *mut u8, buffer_len: u32) -> i32;
    fn HidD_GetInputReport(
        hid_device_object: isize,
        report_buffer: *mut u8,
        buffer_len: u32,
    ) -> i32;
}

#[link(name = "setupapi")]
extern "system" {
    fn SetupDiGetClassDevsW(
        class_guid: *const GUID,
        enumerator: *const u16,
        hwnd_parent: isize,
        flags: u32,
    ) -> isize;
    fn SetupDiEnumDeviceInterfaces(
        device_info_set: isize,
        device_info_data: *mut c_void,
        interface_class_guid: *const GUID,
        member_index: u32,
        device_interface_data: *mut SP_DEVICE_INTERFACE_DATA,
    ) -> i32;
    fn SetupDiGetDeviceInterfaceDetailW(
        device_info_set: isize,
        device_interface_data: *mut SP_DEVICE_INTERFACE_DATA,
        device_interface_detail_data: *mut u8,
        device_interface_detail_data_size: u32,
        required_size: *mut u32,
        device_info_data: *mut c_void,
    ) -> i32;
    fn SetupDiDestroyDeviceInfoList(device_info_set: isize) -> i32;
}

pub fn to_wide(s: &str) -> Vec<u16> {
    let mut w: Vec<u16> = s.encode_utf16().collect();
    w.push(0);
    w
}

pub fn open_device_handle(path: &str, access: u32, overlapped: bool) -> Result<isize, u32> {
    let w = to_wide(path);
    let flags = if overlapped { FILE_FLAG_OVERLAPPED } else { 0 };
    // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
    let h = unsafe {
        CreateFileW(
            w.as_ptr(),
            access,
            FILE_SHARE_READ_WRITE,
            std::ptr::null_mut(),
            OPEN_EXISTING,
            flags,
            0,
        )
    };
    if h == INVALID_HANDLE_VALUE {
        // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
        Err(unsafe { GetLastError() })
    } else {
        Ok(h)
    }
}

fn read_caps(h: isize) -> Option<[u8; 64]> {
    let mut pp: isize = 0;
    // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
    if unsafe { HidD_GetPreparsedData(h, &mut pp) } == 0 || pp == 0 {
        return None;
    }
    let mut c = [0u8; 64];
    // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
    unsafe {
        HidP_GetCaps(pp, c.as_mut_ptr());
        HidD_FreePreparsedData(pp);
    }
    Some(c)
}

fn cap_u16(c: &[u8; 64], off: usize) -> u16 {
    u16::from_le_bytes([c[off], c[off + 1]])
}

fn enum_hid_paths<F: FnMut(&str) -> bool>(mut cb: F) {
    let mut g = GUID {
        data1: 0,
        data2: 0,
        data3: 0,
        data4: [0; 8],
    };
    // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
    unsafe { HidD_GetHidGuid(&mut g) };
    // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
    let set = unsafe { SetupDiGetClassDevsW(&g, std::ptr::null(), 0, 0x12) };
    if set == INVALID_HANDLE_VALUE {
        return;
    }
    for i in 0u32.. {
        let mut d = SP_DEVICE_INTERFACE_DATA {
            cb_size: std::mem::size_of::<SP_DEVICE_INTERFACE_DATA>() as u32,
            interface_class_guid: g,
            flags: 0,
            reserved: 0,
        };
        // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
        if unsafe { SetupDiEnumDeviceInterfaces(set, std::ptr::null_mut(), &g, i, &mut d) } == 0 {
            break;
        }
        let mut need: u32 = 0;
        // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
        unsafe {
            SetupDiGetDeviceInterfaceDetailW(
                set,
                &mut d,
                std::ptr::null_mut(),
                0,
                &mut need,
                std::ptr::null_mut(),
            );
        }
        if need < 6 {
            continue;
        }
        let mut buf = vec![0u8; need as usize];
        let cb_detail: u32 = if std::mem::size_of::<usize>() == 8 { 8 } else { 6 };
        buf[0..4].copy_from_slice(&cb_detail.to_le_bytes());
        // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
        if unsafe {
            SetupDiGetDeviceInterfaceDetailW(
                set,
                &mut d,
                buf.as_mut_ptr(),
                need,
                &mut need,
                std::ptr::null_mut(),
            )
        } == 0
        {
            continue;
        }
        let u16_slice: Vec<u16> = buf[4..]
            .chunks_exact(2)
            .map(|ch| u16::from_le_bytes([ch[0], ch[1]]))
            .take_while(|&w| w != 0)
            .collect();
        let path = String::from_utf16_lossy(&u16_slice);
        if !cb(&path) {
            break;
        }
    }
    // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
    unsafe { SetupDiDestroyDeviceInfoList(set) };
}

fn extract_vid_pid(path_lower: &str) -> Option<(&str, &str)> {
    let idx = path_lower.find("vid_")?;
    let rest = &path_lower[idx + 4..];
    if rest.len() < 13 || &rest[4..9] != "&pid_" {
        return None;
    }
    let vid = &rest[0..4];
    let pid = &rest[9..13];
    if vid.bytes().all(|b| b.is_ascii_hexdigit()) && pid.bytes().all(|b| b.is_ascii_hexdigit()) {
        Some((vid, pid))
    } else {
        None
    }
}

pub fn list_by_usage(page: i32, usage: i32) -> String {
    let mut seen = HashSet::new();
    let mut lines = Vec::new();
    enum_hid_paths(|path| {
        let lower = path.to_ascii_lowercase();
        let Some((vid, pid)) = extract_vid_pid(&lower) else {
            return true;
        };
        let Ok(h) = open_device_handle(path, 0, false) else {
            return true;
        };
        let caps = read_caps(h);
        if let Some(c) = caps {
            if cap_u16(&c, 0) as i32 == usage && cap_u16(&c, 2) as i32 == page {
                let key = format!("{}{}", vid.to_ascii_uppercase(), pid.to_ascii_uppercase());
                if seen.insert(key) {
                    let mut nb = [0u16; 128];
                    // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
                    let ok = unsafe {
                        HidD_GetProductString(h, nb.as_mut_ptr(), (nb.len() * 2) as u32)
                    } != 0;
                    let name = if ok {
                        let end = nb.iter().position(|&w| w == 0).unwrap_or(nb.len());
                        String::from_utf16_lossy(&nb[..end])
                            .replace(['\n', '|'], " ")
                            .trim()
                            .to_string()
                    } else {
                        String::new()
                    };
                    lines.push(format!(
                        "{} {} {}",
                        vid.to_ascii_uppercase(),
                        pid.to_ascii_uppercase(),
                        name
                    ));
                }
            }
        }
        // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
        unsafe { CloseHandle(h) };
        true
    });
    lines.join("|")
}

pub fn find(vid: &str, pid: &str, page: i32, usage: i32, out_len: i32) -> Option<String> {
    let want = format!(
        "vid_{}&pid_{}",
        vid.to_ascii_lowercase(),
        pid.to_ascii_lowercase()
    );
    let mut found = None;
    enum_hid_paths(|path| {
        let lower = path.to_ascii_lowercase();
        if !lower.contains(&want) {
            return true;
        }
        let Ok(h) = open_device_handle(path, 0, false) else {
            return true;
        };
        let caps = read_caps(h);
        // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
        unsafe { CloseHandle(h) };
        if let Some(c) = caps {
            if cap_u16(&c, 0) as i32 == usage
                && cap_u16(&c, 2) as i32 == page
                && (out_len <= 0 || cap_u16(&c, 6) as i32 == out_len)
            {
                found = Some(path.to_string());
                return false;
            }
        }
        true
    });
    found
}

fn path_fits(path_lower: &str, iface: i32, col: i32) -> bool {
    if iface >= 0 && !path_lower.contains(&format!("&mi_{iface:02x}")) {
        return false;
    }
    if col >= 0 && !path_lower.contains(&format!("&col{col:02x}")) {
        return false;
    }
    true
}

fn caps_fit(c: &[u8; 64], page: i32, usage: i32, in_len: i32, out_len: i32, feat_len: i32) -> bool {
    if usage >= 0 && cap_u16(c, 0) as i32 != usage {
        return false;
    }
    if page >= 0 && cap_u16(c, 2) as i32 != page {
        return false;
    }
    if in_len >= 0 && cap_u16(c, 4) as i32 != in_len {
        return false;
    }
    if out_len >= 0 && cap_u16(c, 6) as i32 != out_len {
        return false;
    }
    if feat_len >= 0 && cap_u16(c, 8) as i32 != feat_len {
        return false;
    }
    true
}

#[allow(clippy::too_many_arguments)]
pub fn find_ex(
    vid: &str,
    pid: &str,
    page: i32,
    usage: i32,
    iface: i32,
    col: i32,
    in_len: i32,
    out_len: i32,
    feat_len: i32,
) -> Option<String> {
    let want = format!(
        "vid_{}&pid_{}",
        vid.to_ascii_lowercase(),
        pid.to_ascii_lowercase()
    );
    let mut found = None;
    enum_hid_paths(|path| {
        let lower = path.to_ascii_lowercase();
        if !lower.contains(&want) || !path_fits(&lower, iface, col) {
            return true;
        }
        let Ok(h) = open_device_handle(path, 0, false) else {
            return true;
        };
        let caps = read_caps(h);
        // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
        unsafe { CloseHandle(h) };
        if let Some(c) = caps {
            if caps_fit(&c, page, usage, in_len, out_len, feat_len) {
                found = Some(path.to_string());
                return false;
            }
        }
        true
    });
    found
}

fn gone_code(code: u32) -> bool {
    matches!(code, 2 | 3 | 6 | 21 | 55 | 995 | 1167)
}

pub enum HidErr {
    Gone(String),
    Refused(u32),
}

pub struct HidIo {
    pub path: String,
    h_rw: Option<isize>,
    out_len: usize,
    in_len: usize,
    feature_only: bool,
    // One overlapped read kept in flight across calls
    read_ev: isize,
    read_ov: Option<Box<OVERLAPPED>>,
    read_buf: Vec<u8>,
    // Non-overlapped handle for HidD_*Feature / HidD_GetInputReport
    h_feat: Option<isize>,
    feat_len: i32,
    in_rep_len: i32,
}

impl HidIo {
    pub fn open(
        path: String,
        out_len: usize,
        in_len: usize,
        _report_id: u8,
        feature_only: bool,
    ) -> Result<Self, String> {
        let h_rw = if feature_only {
            None
        } else {
            let h = open_device_handle(&path, GENERIC_READ | GENERIC_WRITE, true)
                .map_err(|e| format!("open failed {e}"))?;
            Some(h)
        };
        let read_ev = if !feature_only {
            // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
            unsafe { CreateEventW(std::ptr::null_mut(), 1, 0, std::ptr::null()) }
        } else {
            0
        };
        Ok(Self {
            path,
            h_rw,
            out_len,
            in_len,
            feature_only,
            read_ev,
            read_ov: None,
            read_buf: vec![0u8; in_len + 1],
            h_feat: None,
            feat_len: -1,
            in_rep_len: -1,
        })
    }

    fn write_overlapped(&self, buf: &[u8], refusals: bool) -> Result<(), HidErr> {
        let Some(h) = self.h_rw else {
            return Err(HidErr::Refused(1));
        };
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
        let ok = unsafe { WriteFile(h, buf.as_ptr(), buf.len() as u32, &mut written, &mut ov) };
        let res = if ok != 0 {
            Ok(())
        } else {
            // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
            let err = unsafe { GetLastError() };
            if err == ERROR_IO_PENDING {
                // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
                if unsafe { GetOverlappedResult(h, &mut ov, &mut written, 1) } != 0 {
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
        match res {
            Ok(()) => Ok(()),
            Err(code) => {
                if refusals && !gone_code(code) {
                    Err(HidErr::Refused(code))
                } else {
                    Err(HidErr::Gone(format!("write failed {code}")))
                }
            }
        }
    }

    fn ensure_pending_read(&mut self) -> Result<Option<usize>, HidErr> {
        let Some(h) = self.h_rw else {
            return Err(HidErr::Gone("feature-only".into()));
        };
        if self.read_ov.is_some() {
            return Ok(None);
        }
        // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
        unsafe { ResetEvent(self.read_ev) };
        self.read_buf.resize(self.in_len + 1, 0);
        let mut ov = Box::new(OVERLAPPED {
            internal: 0,
            internal_high: 0,
            offset: 0,
            offset_high: 0,
            h_event: self.read_ev,
        });
        let mut n: u32 = 0;
        // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
        let ok = unsafe {
            ReadFile(
                h,
                self.read_buf.as_mut_ptr(),
                self.read_buf.len() as u32,
                &mut n,
                ov.as_mut(),
            )
        };
        if ok != 0 {
            return Ok(Some(n as usize));
        }
        // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
        let err = unsafe { GetLastError() };
        if err == ERROR_IO_PENDING {
            self.read_ov = Some(ov);
            Ok(None)
        } else {
            Err(HidErr::Gone(format!("read failed {err}")))
        }
    }

    fn wait_pending_read(&mut self, wait_ms: u32) -> Result<Option<Vec<u8>>, HidErr> {
        if let Some(n) = self.ensure_pending_read()? {
            return Ok(Some(self.read_buf[..n].to_vec()));
        }
        let Some(h) = self.h_rw else {
            return Err(HidErr::Gone("feature-only".into()));
        };
        // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
        let w = unsafe { WaitForSingleObject(self.read_ev, wait_ms) };
        if w != WAIT_OBJECT_0 {
            return Ok(None);
        }
        let mut ov = self.read_ov.take().unwrap();
        let mut n: u32 = 0;
        // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
        if unsafe { GetOverlappedResult(h, ov.as_mut(), &mut n, 0) } == 0 {
            // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
            let err = unsafe { GetLastError() };
            return Err(HidErr::Gone(format!("overlapped read failed {err}")));
        }
        Ok(Some(self.read_buf[..n as usize].to_vec()))
    }

    pub fn req_as(
        &mut self,
        data: &[u8],
        echo: usize,
        wait_ms: u64,
        rid: u8,
        refusals: bool,
    ) -> Result<Option<Vec<u8>>, HidErr> {
        let mut outb = vec![0u8; self.out_len + 1];
        outb[0] = rid;
        let copy_n = data.len().min(self.out_len);
        outb[1..1 + copy_n].copy_from_slice(&data[..copy_n]);
        self.write_overlapped(&outb, refusals)?;

        let deadline = Instant::now() + Duration::from_millis(wait_ms);
        loop {
            let now = Instant::now();
            let left = if deadline > now {
                (deadline - now).as_millis().min(u32::MAX as u128) as u32
            } else {
                0
            };
            let Some(inb) = self.wait_pending_read(left)? else {
                return Ok(None);
            };
            if inb.len() < 2 || inb[0] != rid || (inb[1] != data[0] && inb[1] != 0xff) {
                continue;
            }
            let max_i = echo.min(data.len()).min(self.out_len).min(self.in_len);
            let mut same = true;
            for i in 1..max_i {
                if inb.get(1 + i).copied() != Some(data[i]) {
                    same = false;
                    break;
                }
            }
            if !same {
                continue;
            }
            let mut r = vec![0u8; self.in_len];
            let avail = inb.len().saturating_sub(1).min(self.in_len);
            r[..avail].copy_from_slice(&inb[1..1 + avail]);
            return Ok(Some(r));
        }
    }

    pub fn send_raw(&mut self, rid: u8, data: &[u8]) -> Result<(), HidErr> {
        let Some(h) = self.h_rw else {
            return Err(HidErr::Refused(1));
        };
        if self.read_ov.is_some()
            // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
            && unsafe { WaitForSingleObject(self.read_ev, 0) } == WAIT_OBJECT_0
        {
            let mut ov = self.read_ov.take().unwrap();
            let mut n: u32 = 0;
            // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
            unsafe { GetOverlappedResult(h, ov.as_mut(), &mut n, 0) };
        }
        // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
        unsafe { HidD_FlushQueue(h) };
        let mut outb = vec![0u8; self.out_len + 1];
        outb[0] = rid;
        let copy_n = data.len().min(self.out_len);
        outb[1..1 + copy_n].copy_from_slice(&data[..copy_n]);
        self.write_overlapped(&outb, true)
    }

    pub fn read_raw(&mut self, wait_ms: u64, max: usize) -> Result<Vec<Vec<u8>>, HidErr> {
        let mut list = Vec::new();
        let deadline = Instant::now() + Duration::from_millis(wait_ms);
        while list.len() < max {
            let left = if list.is_empty() {
                let now = Instant::now();
                if deadline > now {
                    (deadline - now).as_millis().min(u32::MAX as u128) as u32
                } else {
                    0
                }
            } else {
                5
            };
            let Some(inb) = self.wait_pending_read(left)? else {
                break;
            };
            if inb.is_empty() {
                break;
            }
            list.push(inb);
        }
        Ok(list)
    }

    fn feature_handle(&mut self) -> Result<isize, String> {
        if let Some(h) = self.h_feat {
            return Ok(h);
        }
        let access = if self.feature_only {
            0
        } else {
            GENERIC_READ | GENERIC_WRITE
        };
        let h = open_device_handle(&self.path, access, false)
            .map_err(|e| format!("open failed {e}"))?;
        let (fl, il) = if let Some(c) = read_caps(h) {
            (cap_u16(&c, 8) as i32, cap_u16(&c, 4) as i32)
        } else {
            (0, 0)
        };
        self.h_feat = Some(h);
        self.feat_len = fl;
        self.in_rep_len = il;
        Ok(h)
    }

    pub fn feature_set(&mut self, report: &[u8]) -> Result<bool, String> {
        let h = self.feature_handle()?;
        if self.feat_len <= 0 || report.len() > self.feat_len as usize {
            return Ok(false);
        }
        let mut b = vec![0u8; self.feat_len as usize];
        b[..report.len()].copy_from_slice(report);
        // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
        if unsafe { HidD_SetFeature(h, b.as_ptr(), b.len() as u32) } != 0 {
            return Ok(true);
        }
        // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
        if unsafe { GetLastError() } == 1167 {
            return Err("device not connected".into());
        }
        Ok(false)
    }

    pub fn feature_get(&mut self, id: u8, len: i32) -> Result<Option<Vec<u8>>, String> {
        let h = self.feature_handle()?;
        if self.feat_len <= 0 || len < 0 || len > self.feat_len - 1 {
            return Ok(None);
        }
        let mut b = vec![0u8; self.feat_len as usize];
        b[0] = id;
        // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
        if unsafe { HidD_GetFeature(h, b.as_mut_ptr(), b.len() as u32) } == 0 {
            // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
            if unsafe { GetLastError() } == 1167 {
                return Err("device not connected".into());
            }
            return Ok(None);
        }
        Ok(Some(b[1..1 + len as usize].to_vec()))
    }

    pub fn input_get(&mut self, id: u8, len: i32) -> Result<Option<Vec<u8>>, String> {
        let h = self.feature_handle()?;
        if self.in_rep_len <= 0 || len < 0 || len > self.in_rep_len - 1 {
            return Ok(None);
        }
        let mut b = vec![0u8; self.in_rep_len as usize];
        b[0] = id;
        // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
        if unsafe { HidD_GetInputReport(h, b.as_mut_ptr(), b.len() as u32) } == 0 {
            // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
            if unsafe { GetLastError() } == 1167 {
                return Err("device not connected".into());
            }
            return Ok(None);
        }
        Ok(Some(b[1..1 + len as usize].to_vec()))
    }
}

impl Drop for HidIo {
    fn drop(&mut self) {
        if let Some(h) = self.h_rw.take() {
            // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
            unsafe {
                CancelIoEx(h, std::ptr::null_mut());
                CloseHandle(h);
            }
        }
        if self.read_ev != 0 {
            // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
            unsafe { CloseHandle(self.read_ev) };
            self.read_ev = 0;
        }
        if let Some(h) = self.h_feat.take() {
            // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
            unsafe { CloseHandle(h) };
        }
    }
}

pub struct HidWatch {
    h: isize,
    thread: Option<thread::JoinHandle<()>>,
}

impl HidWatch {
    pub fn start(
        path: &str,
        report_len: usize,
        command: u8,
        chan_name: String,
    ) -> Result<Self, String> {
        let h = open_device_handle(path, GENERIC_READ, false)
            .map_err(|e| format!("open failed {e}"))?;
        let t = thread::spawn(move || {
            let mut b = vec![0u8; report_len];
            loop {
                let mut n: u32 = 0;
                // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
                let ok = unsafe {
                    ReadFile(
                        h,
                        b.as_mut_ptr(),
                        b.len() as u32,
                        &mut n,
                        std::ptr::null_mut(),
                    )
                };
                if ok == 0 || n < 2 {
                    break;
                }
                if b[1] == command {
                    crate::say(&format!("{chan_name} EVT {:02x} 1", command));
                }
            }
        });
        Ok(Self { h, thread: Some(t) })
    }
}

impl Drop for HidWatch {
    fn drop(&mut self) {
        // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
        unsafe {
            CancelIoEx(self.h, std::ptr::null_mut());
            CloseHandle(self.h);
        }
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn hex_str(b: &[u8]) -> String {
    b.iter()
        .map(|x| format!("{x:02x}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_hex_bytes(tokens: &[&str]) -> Result<Vec<u8>, String> {
    tokens
        .iter()
        .map(|t| u8::from_str_radix(t, 16).map_err(|_| format!("bad hex {t}")))
        .collect()
}

fn parse_opts(p: &[&str]) -> HashMap<String, i32> {
    let mut o = HashMap::new();
    for item in p.iter().skip(7) {
        if let Some(eq) = item.find('=') {
            if let Ok(v) = item[eq + 1..].parse::<i32>() {
                o.insert(item[..eq].to_string(), v);
            }
        }
    }
    o
}

fn opt(o: &HashMap<String, i32>, k: &str) -> i32 {
    o.get(k).copied().unwrap_or(-1)
}

fn hex_or_any(s: &str) -> Result<i32, String> {
    if s == "*" {
        Ok(-1)
    } else {
        i32::from_str_radix(s, 16).map_err(|_| format!("bad hex {s}"))
    }
}

pub fn handle(
    chan: &str,
    rest: &str,
    hid: &mut Option<HidIo>,
    watch: &mut Option<HidWatch>,
) -> Result<String, String> {
    if rest.len() > 4096 {
        return Ok("ERR payload too large".into());
    }
    let p: Vec<&str> = chan.split(':').collect();
    let w: Vec<&str> = rest.split_whitespace().collect();
    if w.is_empty() {
        return Ok("ERR unknown command".into());
    }
    if w.len() > 256 {
        return Ok("ERR payload too large".into());
    }
    if p.len() < 7 {
        return Ok("ERR bad hid channel".into());
    }
    if p[1].eq_ignore_ascii_case("1b1c")
        && crate::hs80::is_hs80_pid(p[2])
        && w[0] != "CLOSE"
    {
        return Ok("ERR the HS80 is DeviceHub's own headset: a library driver never talks to it".into());
    }
    let o = parse_opts(&p);
    if !o.is_empty() || p.get(3) == Some(&"*") || p.get(4) == Some(&"*") {
        return handle_ex(chan, &p, &w, &o, hid, watch);
    }

    match w[0] {
        "OPEN" => {
            if hid.is_some() {
                return Ok("OK".into());
            }
            let page = i32::from_str_radix(p[3], 16).map_err(|e| e.to_string())?;
            let usage = i32::from_str_radix(p[4], 16).map_err(|e| e.to_string())?;
            let Some(path) = find(p[1], p[2], page, usage, 0) else {
                return Ok("NODEVICE".into());
            };
            let len: usize = p[5].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
            let rid: u8 = p[6].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
            *hid = Some(HidIo::open(path, len, len, rid, false)?);
            Ok("OK".into())
        }
        "WATCH" => {
            if hid.is_none() {
                return Ok("GONE".into());
            }
            if watch.is_some() {
                return Ok("OK".into());
            }
            let page = i32::from_str_radix(p[3], 16).map_err(|e| e.to_string())?;
            let usage = i32::from_str_radix(p[4], 16).map_err(|e| e.to_string())?;
            let Some(path) = find(p[1], p[2], page, usage, 0) else {
                return Ok("NODEVICE".into());
            };
            let len: usize = p[5].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
            let cmd = u8::from_str_radix(w[1], 16).map_err(|e| e.to_string())?;
            *watch = Some(HidWatch::start(&path, len + 1, cmd, chan.to_string())?);
            Ok("OK".into())
        }
        "REQ" => {
            let Some(h) = hid.as_mut() else {
                return Ok("GONE".into());
            };
            let echo: usize = w[1].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
            let ms: u64 = w[2].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
            let bytes = parse_hex_bytes(&w[3..])?;
            let rid: u8 = p[6].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
            match h.req_as(&bytes, echo, ms, rid, false) {
                Ok(Some(r)) => Ok(hex_str(&r)),
                Ok(None) => Ok("NONE".into()),
                Err(HidErr::Gone(e)) => Err(e),
                Err(HidErr::Refused(code)) => Ok(format!("REFUSED {code}")),
            }
        }
        "FSET" => {
            let Some(h) = hid.as_mut() else {
                return Ok("GONE".into());
            };
            if w.len() < 2 {
                return Ok("ERR need the report".into());
            }
            let bytes = parse_hex_bytes(&w[1..])?;
            Ok(if h.feature_set(&bytes)? {
                "OK".into()
            } else {
                "NONE".into()
            })
        }
        "FGET" => {
            let Some(h) = hid.as_mut() else {
                return Ok("GONE".into());
            };
            if w.len() < 3 {
                return Ok("ERR need the id and length".into());
            }
            let id = u8::from_str_radix(w[1], 16).map_err(|e| e.to_string())?;
            let len: i32 = w[2].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
            Ok(match h.feature_get(id, len)? {
                Some(r) => hex_str(&r),
                None => "NONE".into(),
            })
        }
        "CLOSE" => {
            *watch = None;
            *hid = None;
            Ok("OK".into())
        }
        _ => Ok("ERR unknown command".into()),
    }
}

fn handle_ex(
    chan: &str,
    p: &[&str],
    w: &[&str],
    o: &HashMap<String, i32>,
    hid: &mut Option<HidIo>,
    watch: &mut Option<HidWatch>,
) -> Result<String, String> {
    let fo = opt(o, "fo") == 1;
    let raw = opt(o, "rw") == 1;
    let rf = opt(o, "rf") == 1;
    let len: i32 = p[5].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;

    match w[0] {
        "OPEN" => {
            if hid.is_some() {
                return Ok("OK".into());
            }
            let page = hex_or_any(p[3])?;
            let usage = hex_or_any(p[4])?;
            let iface = opt(o, "if");
            let col = opt(o, "col");
            let il = opt(o, "il");
            let ol = opt(o, "ol");
            let fl = opt(o, "fl");
            if page < 0 && iface < 0 && col < 0 && il < 0 && ol < 0 && fl < 0 {
                return Ok(
                    "ERR a channel without a usage page needs an interface, a collection or a report length".into(),
                );
            }
            let Some(path) = find_ex(
                p[1],
                p[2],
                page,
                usage,
                iface,
                col,
                if il < 0 { -1 } else { il + 1 },
                if ol < 0 { -1 } else { ol + 1 },
                if fl < 0 { -1 } else { fl + 1 },
            ) else {
                return Ok("NODEVICE".into());
            };
            let out_len = (if ol < 0 { len } else { ol }) as usize;
            let in_len = (if il < 0 { len } else { il }) as usize;
            let rid: u8 = p[6].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
            *hid = Some(HidIo::open(path, out_len, in_len, rid, fo)?);
            return Ok("OK".into());
        }
        "CLOSE" => {
            *watch = None;
            *hid = None;
            return Ok("OK".into());
        }
        _ => {}
    }

    let Some(h) = hid.as_mut() else {
        return Ok("GONE".into());
    };
    match w[0] {
        "FSET" => {
            if w.len() < 2 {
                return Ok("ERR need the report".into());
            }
            let bytes = parse_hex_bytes(&w[1..])?;
            return Ok(if h.feature_set(&bytes)? {
                "OK".into()
            } else {
                "NONE".into()
            });
        }
        "FGET" => {
            if w.len() < 3 {
                return Ok("ERR need the id and length".into());
            }
            let id = u8::from_str_radix(w[1], 16).map_err(|e| e.to_string())?;
            let rlen: i32 = w[2].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
            return Ok(match h.feature_get(id, rlen)? {
                Some(r) => hex_str(&r),
                None => "NONE".into(),
            });
        }
        "IGET" => {
            if opt(o, "gi") != 1 {
                return Ok("ERR not an input-report channel (gi=1)".into());
            }
            if w.len() < 3 {
                return Ok("ERR need the id and length".into());
            }
            let id = u8::from_str_radix(w[1], 16).map_err(|e| e.to_string())?;
            let rlen: i32 = w[2].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
            return Ok(match h.input_get(id, rlen)? {
                Some(r) => hex_str(&r),
                None => "NONE".into(),
            });
        }
        _ => {}
    }

    if fo {
        return Ok("ERR feature-only channel: FSET and FGET only".into());
    }

    match w[0] {
        "WATCH" => {
            if raw {
                return Ok("ERR raw channel: READ instead".into());
            }
            if watch.is_some() {
                return Ok("OK".into());
            }
            let il = opt(o, "il");
            let rlen = ((if il < 0 { len } else { il }) + 1) as usize;
            let cmd = u8::from_str_radix(w[1], 16).map_err(|e| e.to_string())?;
            *watch = Some(HidWatch::start(&h.path, rlen, cmd, chan.to_string())?);
            Ok("OK".into())
        }
        "REQ" | "REQR" => {
            if raw {
                return Ok("ERR raw channel: SEND and READ".into());
            }
            let at = if w[0] == "REQR" { 2 } else { 1 };
            if w.len() < at + 3 {
                return Ok("ERR need the echo, wait and report".into());
            }
            let rid = if w[0] == "REQR" {
                u8::from_str_radix(w[1], 16).map_err(|e| e.to_string())?
            } else {
                p[6].parse().map_err(|e: std::num::ParseIntError| e.to_string())?
            };
            let echo: usize = w[at].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
            let ms: u64 = w[at + 1].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
            let bytes = parse_hex_bytes(&w[at + 2..])?;
            match h.req_as(&bytes, echo, ms, rid, rf) {
                Ok(Some(r)) => Ok(hex_str(&r)),
                Ok(None) => Ok("NONE".into()),
                Err(HidErr::Refused(code)) => Ok(format!("REFUSED {code}")),
                Err(HidErr::Gone(e)) => Err(e),
            }
        }
        "SEND" => {
            if !raw {
                return Ok("ERR not a raw channel".into());
            }
            if w.len() < 2 {
                return Ok("ERR need the report id".into());
            }
            let rid = u8::from_str_radix(w[1], 16).map_err(|e| e.to_string())?;
            let bytes = parse_hex_bytes(&w[2..])?;
            match h.send_raw(rid, &bytes) {
                Ok(()) => Ok("OK".into()),
                Err(HidErr::Refused(code)) => Ok(format!("REFUSED {code}")),
                Err(HidErr::Gone(e)) => Err(e),
            }
        }
        "READ" => {
            if !raw {
                return Ok("ERR not a raw channel".into());
            }
            let ms = if w.len() > 1 {
                w[1].parse::<i64>().unwrap_or(0).clamp(0, 5000) as u64
            } else {
                0
            };
            let max = if w.len() > 2 {
                w[2].parse::<i64>().unwrap_or(16).clamp(1, 64) as usize
            } else {
                16
            };
            match h.read_raw(ms, max) {
                Ok(list) => {
                    if list.is_empty() {
                        Ok("NONE".into())
                    } else {
                        Ok(list.iter().map(|r| hex_str(r)).collect::<Vec<_>>().join("|"))
                    }
                }
                Err(HidErr::Gone(e)) => Err(e),
                Err(HidErr::Refused(code)) => Ok(format!("REFUSED {code}")),
            }
        }
        _ => Ok("ERR unknown command".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn library_driver_channel_never_reaches_hs80() {
        for pid in ["0a69", "0a6b", "0a71"] {
            let chan = format!("hid:1b1c:{pid}:ff42:0001:64:0");
            for cmd in ["OPEN", "SEND 01", "READ 100"] {
                let mut h = None;
                let mut w = None;
                let res = handle(&chan, cmd, &mut h, &mut w).unwrap();
                assert!(
                    res.starts_with("ERR ") && res.contains("HS80"),
                    "expected HS80 refusal on {chan} {cmd}, got {res}"
                );
            }
        }
    }

    #[test]
    fn malformed_unknown_oversize_and_unplugged_return_cleanly() {
        let mut h = None;
        let mut w = None;
        assert_eq!(handle("hid:1b1c", "OPEN", &mut h, &mut w).unwrap(), "ERR bad hid channel");
        assert_eq!(
            handle("hid:dead:beef:ff00:0001:64:0", "", &mut h, &mut w).unwrap(),
            "ERR unknown command"
        );
        assert_eq!(
            handle("hid:dead:beef:ff00:0001:64:0", "FOOBAR", &mut h, &mut w).unwrap(),
            "ERR unknown command"
        );
        assert_eq!(
            handle("hid:dead:beef:ff00:0001:64:0", "OPEN", &mut h, &mut w).unwrap(),
            "NODEVICE"
        );
        let big = "00 ".repeat(300);
        assert_eq!(
            handle("hid:dead:beef:ff00:0001:64:0", &big, &mut h, &mut w).unwrap(),
            "ERR payload too large"
        );
    }
}

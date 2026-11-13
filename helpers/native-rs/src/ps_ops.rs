use serde_json::{json, Value};
use std::ffi::c_void;
use std::path::Path;

use crate::wmi;

#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq)]
struct Guid {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

impl Guid {
    const fn from_parts(d1: u32, d2: u16, d3: u16, d4: [u8; 8]) -> Self {
        Self {
            data1: d1,
            data2: d2,
            data3: d3,
            data4: d4,
        }
    }
    fn to_string_hyphen(&self) -> String {
        format!(
            "{:08x}-{:04x}-{:04x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
            self.data1,
            self.data2,
            self.data3,
            self.data4[0],
            self.data4[1],
            self.data4[2],
            self.data4[3],
            self.data4[4],
            self.data4[5],
            self.data4[6],
            self.data4[7]
        )
    }
}

const GUID_SLEEP_SUBGROUP: Guid =
    Guid::from_parts(0x238c9fa8, 0x0aad, 0x41ed, [0x83, 0xf4, 0x97, 0xbe, 0x24, 0x2c, 0x8f, 0x20]);
const GUID_STANDBY_TIMEOUT: Guid =
    Guid::from_parts(0x29f6c1db, 0x86da, 0x48c5, [0x9f, 0xdb, 0xf2, 0xb6, 0x7b, 0x1f, 0x44, 0xda]);
const GUID_VIDEO_SUBGROUP: Guid =
    Guid::from_parts(0x7516b95f, 0xf776, 0x4464, [0x8c, 0x53, 0x06, 0x16, 0x7f, 0x40, 0xcc, 0x99]);
const GUID_VIDEO_POWERDOWN_TIMEOUT: Guid =
    Guid::from_parts(0x3c0bc021, 0xc8a8, 0x4e07, [0xa9, 0x73, 0x6b, 0x14, 0xcb, 0xcb, 0x2b, 0x7e]);

const GUID_OVERLAY_EFFICIENCY: Guid =
    Guid::from_parts(0x961cc777, 0x2547, 0x4f9d, [0x81, 0x74, 0x7d, 0x86, 0x18, 0x1b, 0x8a, 0x7a]);
const GUID_OVERLAY_BALANCED: Guid = Guid::from_parts(0, 0, 0, [0; 8]);
const GUID_OVERLAY_PERFORMANCE: Guid =
    Guid::from_parts(0xded574b5, 0x45a0, 0x4f42, [0x87, 0x37, 0x46, 0x34, 0x5c, 0x09, 0xc2, 0x38]);

#[link(name = "powrprof")]
#[allow(clashing_extern_declarations)]
extern "system" {
    fn PowerGetActiveScheme(root: *mut c_void, scheme: *mut *mut Guid) -> u32;
    fn PowerSetActiveScheme(root: *mut c_void, scheme: *const Guid) -> u32;
    fn PowerReadACValueIndex(
        root: *mut c_void,
        scheme: *const Guid,
        sub: *const Guid,
        setting: *const Guid,
        value: *mut u32,
    ) -> u32;
    fn PowerReadDCValueIndex(
        root: *mut c_void,
        scheme: *const Guid,
        sub: *const Guid,
        setting: *const Guid,
        value: *mut u32,
    ) -> u32;
    fn PowerWriteACValueIndex(
        root: *mut c_void,
        scheme: *const Guid,
        sub: *const Guid,
        setting: *const Guid,
        value: u32,
    ) -> u32;
    fn PowerWriteDCValueIndex(
        root: *mut c_void,
        scheme: *const Guid,
        sub: *const Guid,
        setting: *const Guid,
        value: u32,
    ) -> u32;
    fn GetPwrCapabilities(caps: *mut u8) -> i32;
}

extern "system" {
    fn LoadLibraryA(lp_lib_file_name: *const u8) -> isize;
    fn GetProcAddress(h_module: isize, lp_proc_name: *const u8) -> *const c_void;
    fn LocalFree(hmem: *mut c_void) -> *mut c_void;
    fn EnumWindows(lp_enum_func: unsafe extern "system" fn(isize, isize) -> i32, lparam: isize) -> i32;
    fn IsWindowVisible(hwnd: isize) -> i32;
    fn GetWindowTextW(hwnd: isize, lp_string: *mut u16, n_max_count: i32) -> i32;
    fn GetWindowThreadProcessId(hwnd: isize, lpdw_process_id: *mut u32) -> u32;
    fn PostMessageW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> i32;
    fn OpenProcess(dw_desired_access: u32, b_inherit_handle: i32, dw_process_id: u32) -> isize;
    fn QueryFullProcessImageNameW(
        h_process: isize,
        dw_flags: u32,
        lp_exe_name: *mut u16,
        lpdw_size: *mut u32,
    ) -> i32;
    fn CloseHandle(h_object: isize) -> i32;
}

#[link(name = "advapi32")]
extern "system" {
    fn RegOpenKeyExW(
        hkey: isize,
        sub_key: *const u16,
        ul_options: u32,
        sam_desired: u32,
        phk_result: *mut isize,
    ) -> i32;
    fn RegCloseKey(hkey: isize) -> i32;
    fn RegQueryValueExW(
        hkey: isize,
        lp_value_name: *const u16,
        lp_reserved: *mut u32,
        lp_type: *mut u32,
        lp_data: *mut u8,
        lpcb_data: *mut u32,
    ) -> i32;
    fn RegEnumKeyExW(
        hkey: isize,
        dw_index: u32,
        lp_name: *mut u16,
        lpcch_name: *mut u32,
        lp_reserved: *mut u32,
        lp_class: *mut u16,
        lpcch_class: *mut u32,
        lpft_last_write_time: *mut c_void,
    ) -> i32;
    fn RegEnumValueW(
        hkey: isize,
        dw_index: u32,
        lp_value_name: *mut u16,
        lpcch_value_name: *mut u32,
        lp_reserved: *mut u32,
        lp_type: *mut u32,
        lp_data: *mut u8,
        lpcb_data: *mut u32,
    ) -> i32;
}

const HKEY_CURRENT_USER: isize = -2147483647_isize; // 0x80000001
const HKEY_CLASSES_ROOT: isize = -2147483648_isize; // 0x80000000
const HKEY_LOCAL_MACHINE: isize = -2147483646_isize; // 0x80000002
const KEY_READ: u32 = 0x20019;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn modern_standby() -> bool {
    let mut b = [0u8; 128];
    // SAFETY: Win32 display/monitor API call with valid HMONITOR/handle and stack-allocated output buffers.
    unsafe { GetPwrCapabilities(b.as_mut_ptr()) != 0 && b[20] != 0 }
}

fn active_scheme() -> Result<Guid, String> {
    // SAFETY: Win32 power management API with valid GUID/struct pointers.
    unsafe {
        let mut p: *mut Guid = std::ptr::null_mut();
        if PowerGetActiveScheme(std::ptr::null_mut(), &mut p) != 0 || p.is_null() {
            return Err("the active power plan could not be read".into());
        }
        let g = *p;
        LocalFree(p as *mut c_void);
        Ok(g)
    }
}

fn read_power_idx(screen: bool, ac: bool) -> Result<u32, String> {
    let s = active_scheme()?;
    let sub = if screen { &GUID_VIDEO_SUBGROUP } else { &GUID_SLEEP_SUBGROUP };
    let set = if screen { &GUID_VIDEO_POWERDOWN_TIMEOUT } else { &GUID_STANDBY_TIMEOUT };
    let mut v = 0u32;
    // SAFETY: Win32 power management API with valid GUID/struct pointers.
    let r = unsafe {
        if ac {
            PowerReadACValueIndex(std::ptr::null_mut(), &s, sub, set, &mut v)
        } else {
            PowerReadDCValueIndex(std::ptr::null_mut(), &s, sub, set, &mut v)
        }
    };
    if r != 0 {
        let lbl = if screen { "Screen off after" } else { "Sleep after" };
        return Err(format!("{} could not be read ({})", lbl, r));
    }
    Ok(v)
}

fn write_power_idx(screen: bool, ac: bool, v: u32) -> Result<(), String> {
    let s = active_scheme()?;
    let sub = if screen { &GUID_VIDEO_SUBGROUP } else { &GUID_SLEEP_SUBGROUP };
    let set = if screen { &GUID_VIDEO_POWERDOWN_TIMEOUT } else { &GUID_STANDBY_TIMEOUT };
    // SAFETY: Win32 power management API with valid GUID/struct pointers.
    let r = unsafe {
        if ac {
            PowerWriteACValueIndex(std::ptr::null_mut(), &s, sub, set, v)
        } else {
            PowerWriteDCValueIndex(std::ptr::null_mut(), &s, sub, set, v)
        }
    };
    if r == 5 {
        return Err("Windows needs administrator rights to change this power plan".into());
    }
    if r != 0 {
        let lbl = if screen { "Screen off after" } else { "Sleep after" };
        return Err(format!("{} could not be changed ({})", lbl, r));
    }
    // SAFETY: Win32 power management API with valid GUID/struct pointers.
    unsafe {
        PowerSetActiveScheme(std::ptr::null_mut(), &s);
    }
    Ok(())
}

pub fn sleep_timer(q: &Value) -> Value {
    let do_write = |key: &str, screen: bool, ac: bool| -> Result<(), String> {
        if let Some(v) = q.get(key).and_then(|x| x.as_i64()) {
            if v >= 0 {
                write_power_idx(screen, ac, v as u32)?;
            }
        }
        Ok(())
    };
    if let Err(e) = (|| -> Result<(), String> {
        do_write("ac", false, true)?;
        do_write("dc", false, false)?;
        do_write("screenAc", true, true)?;
        do_write("screenDc", true, false)?;
        Ok(())
    })() {
        return json!({ "ok": false, "why": e });
    }
    let plan = match active_scheme() {
        Ok(g) => g.to_string_hyphen(),
        Err(e) => return json!({ "ok": false, "why": e }),
    };
    let ac = match read_power_idx(false, true) {
        Ok(v) => v,
        Err(e) => return json!({ "ok": false, "why": e }),
    };
    let dc = match read_power_idx(false, false) {
        Ok(v) => v,
        Err(e) => return json!({ "ok": false, "why": e }),
    };
    let screen_ac = match read_power_idx(true, true) {
        Ok(v) => v,
        Err(e) => return json!({ "ok": false, "why": e }),
    };
    let screen_dc = match read_power_idx(true, false) {
        Ok(v) => v,
        Err(e) => return json!({ "ok": false, "why": e }),
    };
    let bat = !wmi::query("root\\CIMV2", "SELECT DeviceID FROM Win32_Battery", &["DeviceID"])
        .unwrap_or_default()
        .is_empty();
    json!({
        "ok": true,
        "plan": plan,
        "ac": ac,
        "dc": dc,
        "screenAc": screen_ac,
        "screenDc": screen_dc,
        "battery": bat,
        "modernStandby": modern_standby(),
    })
}

pub fn close_app_window(title: &str) -> Value {
    if !title.starts_with("DeviceHub closing ")
        || title.len() != 34
        || !title[18..].bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    {
        return json!("invalid title");
    }

    struct Ctx {
        target: String,
        hits: Vec<isize>,
    }
    // SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
    unsafe extern "system" fn enum_proc(hwnd: isize, lparam: isize) -> i32 {
        let ctx = &mut *(lparam as *mut Ctx);
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }
        let mut buf = [0u16; 512];
        let n = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if n <= 0 {
            return 1;
        }
        let s = String::from_utf16_lossy(&buf[..n as usize]);
        if s != ctx.target {
            return 1;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return 1;
        }
        let hproc = OpenProcess(0x1000, 0, pid); // PROCESS_QUERY_LIMITED_INFORMATION
        if hproc != 0 {
            let mut pbuf = [0u16; 520];
            let mut plen = pbuf.len() as u32;
            let ok = QueryFullProcessImageNameW(hproc, 0, pbuf.as_mut_ptr(), &mut plen);
            CloseHandle(hproc);
            if ok != 0 && plen > 0 {
                let full = String::from_utf16_lossy(&pbuf[..plen as usize]);
                let base = Path::new(&full)
                    .file_stem()
                    .and_then(|x| x.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if base == "chrome" || base == "msedge" {
                    ctx.hits.push(hwnd);
                }
            }
        }
        1
    }

    let mut ctx = Ctx {
        target: title.to_string(),
        hits: Vec::new(),
    };
    // SAFETY: Win32 window/tray/GDI call on valid HWND/HINSTANCE/resource with initialized structs.
    unsafe {
        EnumWindows(enum_proc, &mut ctx as *mut Ctx as isize);
    }
    let msg = if ctx.hits.len() == 1 {
        // SAFETY: Win32 window/tray/GDI call on valid HWND/HINSTANCE/resource with initialized structs.
        unsafe { PostMessageW(ctx.hits[0], 0x0010, 0, 0) };
        "closed 1".to_string()
    } else if ctx.hits.is_empty() {
        "not found".to_string()
    } else {
        format!("not closed: {} windows had that title", ctx.hits.len())
    };
    json!(msg)
}

fn reg_open(root: isize, sub: &str) -> Option<isize> {
    let w = wide(sub);
    let mut h = 0isize;
    // SAFETY: Win32 registry call using null-terminated UTF-16 strings and properly sized stack/Vec buffers.
    let r = unsafe { RegOpenKeyExW(root, w.as_ptr(), 0, KEY_READ, &mut h) };
    if r == 0 { Some(h) } else { None }
}

fn reg_read_str(hkey: isize, name: Option<&str>) -> Option<String> {
    let wname = name.map(wide);
    let p_name = wname.as_ref().map(|v| v.as_ptr()).unwrap_or(std::ptr::null());
    let mut ty = 0u32;
    let mut sz = 0u32;
    // SAFETY: Win32 registry call using null-terminated UTF-16 strings and properly sized stack/Vec buffers.
    let r = unsafe {
        RegQueryValueExW(
            hkey,
            p_name,
            std::ptr::null_mut(),
            &mut ty,
            std::ptr::null_mut(),
            &mut sz,
        )
    };
    if r != 0 || sz == 0 {
        return None;
    }
    let mut buf = vec![0u8; sz as usize];
    // SAFETY: Win32 registry call using null-terminated UTF-16 strings and properly sized stack/Vec buffers.
    let r = unsafe {
        RegQueryValueExW(
            hkey,
            p_name,
            std::ptr::null_mut(),
            &mut ty,
            buf.as_mut_ptr(),
            &mut sz,
        )
    };
    if r != 0 {
        return None;
    }
    if ty == 1 || ty == 2 {
        let u16s: Vec<u16> = buf[..sz as usize]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let s = String::from_utf16_lossy(&u16s);
        Some(s.trim_end_matches('\0').to_string())
    } else if ty == 4 && sz >= 4 {
        let v = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]);
        Some(v.to_string())
    } else {
        None
    }
}

fn is_guid(s: &str) -> bool {
    s.len() == 38
        && s.starts_with('{')
        && s.ends_with('}')
        && s[1..37]
            .bytes()
            .all(|b| b.is_ascii_hexdigit() || b == b'-')
}

fn class_of(clsid: Option<String>) -> Value {
    let c = match clsid {
        Some(s) if is_guid(&s) => s,
        _ => return Value::Null,
    };
    let name = reg_open(HKEY_CLASSES_ROOT, &format!("CLSID\\{}", c))
        .and_then(|h| {
            let v = reg_read_str(h, None);
            // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
            unsafe { RegCloseKey(h) };
            v
        })
        .unwrap_or_default();
    let dll = reg_open(HKEY_CLASSES_ROOT, &format!("CLSID\\{}\\InprocServer32", c))
        .and_then(|h| {
            let v = reg_read_str(h, None);
            // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
            unsafe { RegCloseKey(h) };
            v
        })
        .unwrap_or_default();
    json!({ "clsid": c, "name": name, "dll": dll })
}

fn fx_has_apo(hkey: isize) -> bool {
    let apo = "eacd2258-fcac-4ff4-b36d-419e924a6d79";
    let mut idx = 0u32;
    loop {
        let mut vname = [0u16; 256];
        let mut vlen = vname.len() as u32;
        let mut ty = 0u32;
        let mut data = [0u8; 512];
        let mut dlen = data.len() as u32;
        // SAFETY: Win32 registry call using null-terminated UTF-16 strings and properly sized stack/Vec buffers.
        let r = unsafe {
            RegEnumValueW(
                hkey,
                idx,
                vname.as_mut_ptr(),
                &mut vlen,
                std::ptr::null_mut(),
                &mut ty,
                data.as_mut_ptr(),
                &mut dlen,
            )
        };
        if r != 0 {
            break;
        }
        idx += 1;
        if (ty == 1 || ty == 2) && dlen >= 2 {
            let u16s: Vec<u16> = data[..dlen as usize]
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            let s = String::from_utf16_lossy(&u16s).to_ascii_lowercase();
            if s.contains(apo) {
                return true;
            }
        }
    }
    false
}

fn has_icue_installed() -> bool {
    if let Ok(pf) = std::env::var("ProgramFiles") {
        if Path::new(&pf)
            .join("Corsair\\Corsair iCUE5 Software\\iCUE.exe")
            .exists()
        {
            return true;
        }
    }
    for sub in [
        "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        "Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    ] {
        if let Some(h) = reg_open(HKEY_LOCAL_MACHINE, sub) {
            let mut idx = 0u32;
            loop {
                let mut kname = [0u16; 256];
                let mut klen = kname.len() as u32;
                // SAFETY: Win32 registry call using null-terminated UTF-16 strings and properly sized stack/Vec buffers.
                let r = unsafe {
                    RegEnumKeyExW(
                        h,
                        idx,
                        kname.as_mut_ptr(),
                        &mut klen,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                    )
                };
                if r != 0 {
                    break;
                }
                idx += 1;
                let kn = String::from_utf16_lossy(&kname[..klen as usize]);
                if let Some(hk) = reg_open(h, &kn) {
                    let dn = reg_read_str(hk, Some("DisplayName")).unwrap_or_default();
                    // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
                    unsafe { RegCloseKey(hk) };
                    if dn.to_ascii_lowercase().contains("icue") {
                        // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
                        unsafe { RegCloseKey(h) };
                        return true;
                    }
                }
            }
            // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
            unsafe { RegCloseKey(h) };
        }
    }
    false
}

pub fn corsair_apo_read(endpoints: &str) -> Value {
    let mut rows = Vec::new();
    for entry in endpoints.split(',') {
        let mut parts = entry.splitn(2, '|');
        let flow = parts.next().unwrap_or("");
        let g = parts.next().unwrap_or("");
        if (flow != "Render" && flow != "Capture") || !is_guid(g) {
            continue;
        }
        let dev_path = format!(
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\{}\\{}",
            flow, g
        );
        let state = reg_open(HKEY_LOCAL_MACHINE, &dev_path)
            .and_then(|h| {
                let v = reg_read_str(h, Some("DeviceState"));
                // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
                unsafe { RegCloseKey(h) };
                v
            })
            .unwrap_or_default();
        let on = reg_open(HKEY_LOCAL_MACHINE, &format!("{}\\FxProperties", dev_path))
            .map(|h| {
                let b = fx_has_apo(h);
                // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
                unsafe { RegCloseKey(h) };
                b
            })
            .unwrap_or(false);
        let name = reg_open(HKEY_LOCAL_MACHINE, &format!("{}\\Properties", dev_path))
            .and_then(|h| {
                let v = reg_read_str(h, Some("{a45c254e-df1c-4efd-8020-67d146a850e0},2"));
                // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
                unsafe { RegCloseKey(h) };
                v
            })
            .unwrap_or_default();
        let child_key = reg_open(HKEY_LOCAL_MACHINE, &format!("SOFTWARE\\EqualizerAPO\\Child APOs\\{}", g));
        let (child, pre, post) = if let Some(hc) = child_key {
            let p1 = reg_read_str(hc, Some("PreMixChild"));
            let p2 = reg_read_str(hc, Some("PostMixChild"));
            // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
            unsafe { RegCloseKey(hc) };
            (true, class_of(p1), class_of(p2))
        } else {
            (false, Value::Null, Value::Null)
        };
        rows.push(json!({
            "flow": flow,
            "guid": g,
            "state": state,
            "on": on,
            "name": name,
            "child": child,
            "pre": pre,
            "post": post,
        }));
    }
    json!({
        "icue": has_icue_installed(),
        "rows": rows,
    })
}

fn overlay_get() -> Option<String> {
    // SAFETY: Dynamic library/symbol lookup and FFI invocation using null-terminated names and ABI-matched signatures.
    unsafe {
        let lib = LoadLibraryA(b"powrprof.dll\0".as_ptr());
        if lib == 0 {
            return None;
        }
        let p = GetProcAddress(lib, b"PowerGetEffectiveOverlayScheme\0".as_ptr());
        if p.is_null() {
            return None;
        }
        type FnGet = unsafe extern "system" fn(*mut Guid) -> u32;
        let func: FnGet = std::mem::transmute(p);
        let mut g = GUID_OVERLAY_BALANCED;
        if func(&mut g) != 0 {
            return None;
        }
        if g == GUID_OVERLAY_EFFICIENCY {
            Some("efficiency".into())
        } else if g == GUID_OVERLAY_PERFORMANCE {
            Some("performance".into())
        } else if g == GUID_OVERLAY_BALANCED {
            Some("balanced".into())
        } else {
            Some("other".into())
        }
    }
}

fn overlay_set(mode: &str) -> u32 {
    // SAFETY: Dynamic library/symbol lookup and FFI invocation using null-terminated names and ABI-matched signatures.
    unsafe {
        let lib = LoadLibraryA(b"powrprof.dll\0".as_ptr());
        if lib == 0 {
            return 1;
        }
        let p = GetProcAddress(lib, b"PowerSetActiveOverlayScheme\0".as_ptr());
        if p.is_null() {
            return 1;
        }
        type FnSet = unsafe extern "system" fn(Guid) -> u32;
        let func: FnSet = std::mem::transmute(p);
        let g = match mode {
            "efficiency" => GUID_OVERLAY_EFFICIENCY,
            "performance" => GUID_OVERLAY_PERFORMANCE,
            _ => GUID_OVERLAY_BALANCED,
        };
        func(g)
    }
}

fn looks_like_placeholder(s: &str) -> bool {
    let l = s.to_ascii_lowercase();
    l.starts_with("none")
        || l.starts_with("to be filled")
        || l.starts_with("system version")
        || l.starts_with("system product name")
        || l.starts_with("default string")
}

fn looks_like_version(s: &str) -> bool {
    let t = s.strip_prefix('v').or_else(|| s.strip_prefix('V')).unwrap_or(s);
    t.contains('.') && t.bytes().all(|b| b.is_ascii_digit() || b == b'.')
}

pub fn laptop(mode: Option<&str>) -> Value {
    let mut set_obj = Value::Null;
    if let Some(m) = mode {
        if matches!(m, "efficiency" | "balanced" | "performance") {
            let r = overlay_set(m);
            set_obj = json!({ "asked": m, "result": r });
        }
    }

    let cs = wmi::query(
        "root\\CIMV2",
        "SELECT Manufacturer, Model FROM Win32_ComputerSystem",
        &["Manufacturer", "Model"],
    )
    .unwrap_or_default();
    let prod = wmi::query(
        "root\\CIMV2",
        "SELECT Version FROM Win32_ComputerSystemProduct",
        &["Version"],
    )
    .unwrap_or_default();
    let enc = wmi::query(
        "root\\CIMV2",
        "SELECT ChassisTypes FROM Win32_SystemEnclosure",
        &["ChassisTypes"],
    )
    .unwrap_or_default();

    let maker = cs
        .first()
        .and_then(|r| r.get("Manufacturer"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let ver = prod
        .first()
        .and_then(|r| r.get("Version"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let cs_model = cs
        .first()
        .and_then(|r| r.get("Model"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let model = if !ver.is_empty() && !looks_like_placeholder(&ver) && !looks_like_version(&ver) {
        Some(ver)
    } else if !cs_model.is_empty() && !looks_like_placeholder(&cs_model) {
        Some(cs_model)
    } else {
        None
    };

    let portable_types = [8, 9, 10, 11, 12, 14, 18, 21, 30, 31, 32];
    let portable = enc
        .first()
        .and_then(|r| r.get("ChassisTypes"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_i64())
                .any(|n| portable_types.contains(&(n as i32)))
        })
        .unwrap_or(false);

    let bats = wmi::query(
        "root\\CIMV2",
        "SELECT EstimatedChargeRemaining, BatteryStatus, EstimatedRunTime FROM Win32_Battery",
        &["EstimatedChargeRemaining", "BatteryStatus", "EstimatedRunTime"],
    )
    .unwrap_or_default();
    let battery = if let Some(bat) = bats.first() {
        let pct = bat.get("EstimatedChargeRemaining").cloned().unwrap_or(Value::Null);
        let st = bat.get("BatteryStatus").and_then(|v| v.as_i64()).unwrap_or(0);
        let charger = matches!(st, 2 | 3 | 6 | 7 | 8 | 9);
        let rt = bat.get("EstimatedRunTime").and_then(|v| v.as_i64());
        let minutes_left = match rt {
            Some(m) if m > 0 && m < 71582788 => json!(m),
            _ => Value::Null,
        };
        let design = wmi::query("root\\wmi", "SELECT DesignedCapacity FROM BatteryStaticData", &["DesignedCapacity"])
            .unwrap_or_default()
            .first()
            .and_then(|r| r.get("DesignedCapacity"))
            .and_then(|v| v.as_i64());
        let full = wmi::query("root\\wmi", "SELECT FullChargedCapacity FROM BatteryFullChargedCapacity", &["FullChargedCapacity"])
            .unwrap_or_default()
            .first()
            .and_then(|r| r.get("FullChargedCapacity"))
            .and_then(|v| v.as_i64());
        let cycles = wmi::query("root\\wmi", "SELECT CycleCount FROM BatteryCycleCount", &["CycleCount"])
            .unwrap_or_default()
            .first()
            .and_then(|r| r.get("CycleCount"))
            .and_then(|v| v.as_i64())
            .filter(|&c| c > 0);
        let bs = wmi::query(
            "root\\wmi",
            "SELECT RemainingCapacity, ChargeRate, DischargeRate FROM BatteryStatus",
            &["RemainingCapacity", "ChargeRate", "DischargeRate"],
        )
        .unwrap_or_default();
        let now_mwh = bs.first().and_then(|r| r.get("RemainingCapacity")).and_then(|v| v.as_i64());
        let charge_w = bs
            .first()
            .and_then(|r| r.get("ChargeRate"))
            .and_then(|v| v.as_i64())
            .filter(|&c| c > 0)
            .map(|c| json!(((c as f64 / 1000.0) * 10.0).round() / 10.0))
            .unwrap_or(Value::Null);
        let discharge_w = bs
            .first()
            .and_then(|r| r.get("DischargeRate"))
            .and_then(|v| v.as_i64())
            .filter(|&d| d > 0 && d < 1000000)
            .map(|d| json!(((d as f64 / 1000.0) * 10.0).round() / 10.0))
            .unwrap_or(Value::Null);
        let health = match (design, full) {
            (Some(d), Some(f)) if d > 0 => json!(((100.0 * f as f64) / d as f64).round() as i64),
            _ => Value::Null,
        };
        json!({
            "percent": pct,
            "charger": charger,
            "minutesLeft": minutes_left,
            "designMWh": design,
            "fullMWh": full,
            "cycles": cycles,
            "nowMWh": now_mwh,
            "chargeW": charge_w,
            "dischargeW": discharge_w,
            "health": health,
        })
    } else {
        Value::Null
    };

    let mut out = serde_json::Map::new();
    out.insert("ok".into(), json!(true));
    if !set_obj.is_null() {
        out.insert("set".into(), set_obj);
    }
    out.insert("maker".into(), json!(maker));
    out.insert("model".into(), json!(model));
    out.insert("portable".into(), json!(portable));
    out.insert("battery".into(), battery);
    out.insert("powerMode".into(), json!(overlay_get()));
    out.insert("legion".into(), Value::Null);
    Value::Object(out)
}

pub fn learn_hid_list() -> Value {
    #[repr(C)]
    #[derive(Default)]
    struct HidpCaps {
        usage: u16,
        usage_page: u16,
        in_len: u16,
        out_len: u16,
        feat_len: u16,
        reserved: [u16; 17],
        num_link_nodes: u16,
        num_in_btn: u16,
        num_in_val: u16,
        num_in_data: u16,
        num_out_btn: u16,
        num_out_val: u16,
        num_out_data: u16,
        num_feat_btn: u16,
        num_feat_val: u16,
        num_feat_data: u16,
    }
    #[allow(clashing_extern_declarations)]
    extern "system" {
        fn CreateFileW(
            name: *const u16,
            access: u32,
            share: u32,
            sa: *const c_void,
            disp: u32,
            flags: u32,
            tmpl: isize,
        ) -> isize;
    }
    // SAFETY: Dynamic library/symbol lookup and FFI invocation using null-terminated names and ABI-matched signatures.
    unsafe {
        let h_hid = LoadLibraryA(b"hid.dll\0".as_ptr());
        if h_hid == 0 {
            return json!({ "collections": [] });
        }
        type FnGetPP = unsafe extern "system" fn(isize, *mut isize) -> u8;
        type FnFreePP = unsafe extern "system" fn(isize) -> u8;
        type FnGetCaps = unsafe extern "system" fn(isize, *mut HidpCaps) -> i32;
        type FnGetVal = unsafe extern "system" fn(i32, *mut u8, *mut u16, isize) -> i32;
        type FnGetBtn = unsafe extern "system" fn(i32, *mut u8, *mut u16, isize) -> i32;
        type FnGetProd = unsafe extern "system" fn(isize, *mut u8, u32) -> u8;
        let p_gpp = GetProcAddress(h_hid, b"HidD_GetPreparsedData\0".as_ptr());
        let p_fpp = GetProcAddress(h_hid, b"HidD_FreePreparsedData\0".as_ptr());
        let p_caps = GetProcAddress(h_hid, b"HidP_GetCaps\0".as_ptr());
        let p_val = GetProcAddress(h_hid, b"HidP_GetValueCaps\0".as_ptr());
        let p_btn = GetProcAddress(h_hid, b"HidP_GetButtonCaps\0".as_ptr());
        let p_prod = GetProcAddress(h_hid, b"HidD_GetProductString\0".as_ptr());
        if p_gpp.is_null() || p_fpp.is_null() || p_caps.is_null() || p_val.is_null() || p_btn.is_null() || p_prod.is_null() {
            return json!({ "collections": [] });
        }
        let get_pp: FnGetPP = std::mem::transmute(p_gpp);
        let free_pp: FnFreePP = std::mem::transmute(p_fpp);
        let get_caps: FnGetCaps = std::mem::transmute(p_caps);
        let get_val: FnGetVal = std::mem::transmute(p_val);
        let get_btn: FnGetBtn = std::mem::transmute(p_btn);
        let get_prod: FnGetProd = std::mem::transmute(p_prod);

        let devs = wmi::query(
            "root\\CIMV2",
            "SELECT DeviceID, Name FROM Win32_PnPEntity WHERE Present = TRUE AND DeviceID LIKE 'HID\\\\VID_%'",
            &["DeviceID", "Name"],
        )
        .unwrap_or_default();

        let mut cols = Vec::new();
        for d in devs {
            let id = match d.get("DeviceID").and_then(|v| v.as_str()) {
                Some(s) => s,
                None => continue,
            };
            let upper = id.to_ascii_uppercase();
            let vpos = match upper.find("VID_") {
                Some(p) if p + 8 <= upper.len() => p,
                _ => continue,
            };
            let ppos = match upper.find("PID_") {
                Some(p) if p + 8 <= upper.len() => p,
                _ => continue,
            };
            let vid = &upper[vpos + 4..vpos + 8];
            let pid = &upper[ppos + 4..ppos + 8];
            if !vid.bytes().all(|b| b.is_ascii_hexdigit()) || !pid.bytes().all(|b| b.is_ascii_hexdigit()) {
                continue;
            }
            let iface = upper
                .find("&MI_")
                .and_then(|p| upper.get(p + 4..p + 6))
                .and_then(|s| u32::from_str_radix(s, 16).ok());
            let col = upper
                .find("&COL")
                .and_then(|p| upper.get(p + 4..p + 6))
                .and_then(|s| u32::from_str_radix(s, 16).ok());

            let dev_path = format!(
                "\\\\?\\{}#{{4d1e55b2-f16f-11cf-88cb-001111000030}}",
                id.replace('\\', "#")
            );
            let wpath = wide(&dev_path);
            let h = CreateFileW(wpath.as_ptr(), 0, 3, std::ptr::null(), 3, 0, 0);
            if h == -1 || h == 0 {
                continue;
            }
            let mut pp = 0isize;
            if get_pp(h, &mut pp) != 0 && pp != 0 {
                let mut c = HidpCaps::default();
                get_caps(pp, &mut c);
                let ids_of = |ty: i32, nv: u16, nb: u16| -> Vec<u8> {
                    let mut set = std::collections::BTreeSet::new();
                    if nv > 0 {
                        let cap = (nv as usize).max(16);
                        let mut buf = vec![0u8; 72 * cap];
                        let mut n = cap as u16;
                        if get_val(ty, buf.as_mut_ptr(), &mut n, pp) >= 0 {
                            for i in 0..(n as usize).min(cap) {
                                set.insert(buf[i * 72 + 2]);
                            }
                        }
                    }
                    if nb > 0 {
                        let cap = (nb as usize).max(16);
                        let mut buf = vec![0u8; 72 * cap];
                        let mut n = cap as u16;
                        if get_btn(ty, buf.as_mut_ptr(), &mut n, pp) >= 0 {
                            for i in 0..(n as usize).min(cap) {
                                set.insert(buf[i * 72 + 2]);
                            }
                        }
                    }
                    set.into_iter().collect()
                };
                let mut pbuf = [0u8; 512];
                let product = if get_prod(h, pbuf.as_mut_ptr(), pbuf.len() as u32) != 0 {
                    let u16s: Vec<u16> = pbuf
                        .chunks_exact(2)
                        .map(|ch| u16::from_le_bytes([ch[0], ch[1]]))
                        .collect();
                    let s = String::from_utf16_lossy(&u16s);
                    let end = s.find('\0').unwrap_or(s.len());
                    Value::String(s[..end].trim().to_string())
                } else {
                    Value::Null
                };
                cols.push(json!({
                    "vid": vid,
                    "pid": pid,
                    "iface": iface,
                    "col": col,
                    "page": format!("{:04X}", c.usage_page),
                    "usage": format!("{:04X}", c.usage),
                    "inLen": c.in_len,
                    "outLen": c.out_len,
                    "featLen": c.feat_len,
                    "inIds": ids_of(0, c.num_in_val, c.num_in_btn),
                    "outIds": ids_of(1, c.num_out_val, c.num_out_btn),
                    "featIds": ids_of(2, c.num_feat_val, c.num_feat_btn),
                    "product": product,
                    "name": d.get("Name").cloned().unwrap_or(Value::Null),
                }));
                free_pp(pp);
            }
            CloseHandle(h);
        }
        json!({ "collections": cols })
    }
}

fn expand_env(s: &str) -> String {
    extern "system" {
        fn ExpandEnvironmentStringsW(src: *const u16, dst: *mut u16, n: u32) -> u32;
    }
    let w = wide(s);
    let mut buf = vec![0u16; 1024];
    // SAFETY: Win32 system/process API call with valid handles and caller-owned output buffers.
    let n = unsafe { ExpandEnvironmentStringsW(w.as_ptr(), buf.as_mut_ptr(), buf.len() as u32) };
    if n > 0 && (n as usize) <= buf.len() {
        String::from_utf16_lossy(&buf[..(n as usize).saturating_sub(1)])
    } else {
        s.to_string()
    }
}

fn exe_of(cmd: &str) -> String {
    let c = expand_env(cmd.trim());
    let mut p = if let Some(rest) = c.strip_prefix('"') {
        rest.split('"').next().unwrap_or("").to_string()
    } else {
        let lower = c.to_ascii_lowercase();
        let mut found = None;
        for ext in [".exe", ".com", ".bat", ".cmd"] {
            if let Some(idx) = lower.find(ext) {
                let end = idx + ext.len();
                if end == lower.len() || lower.as_bytes()[end].is_ascii_whitespace() {
                    found = Some(c[..end].to_string());
                    break;
                }
            }
        }
        found.unwrap_or_else(|| c.split_whitespace().next().unwrap_or("").to_string())
    };
    if !p.is_empty() && !Path::new(&p).is_absolute() {
        let sr = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        for dir in [format!("{sr}\\System32"), sr] {
            let cand = Path::new(&dir).join(&p);
            if cand.exists() {
                p = cand.to_string_lossy().to_string();
                break;
            }
        }
    }
    p
}

fn file_version_info(path: &str) -> (String, String) {
    // SAFETY: Dynamic library/symbol lookup and FFI invocation using null-terminated names and ABI-matched signatures.
    unsafe {
        let h_ver = LoadLibraryA(b"version.dll\0".as_ptr());
        if h_ver == 0 {
            return (String::new(), String::new());
        }
        type FnSize = unsafe extern "system" fn(*const u16, *mut u32) -> u32;
        type FnInfo = unsafe extern "system" fn(*const u16, u32, u32, *mut u8) -> i32;
        type FnQuery = unsafe extern "system" fn(*const u8, *const u16, *mut *const c_void, *mut u32) -> i32;
        let p_sz = GetProcAddress(h_ver, b"GetFileVersionInfoSizeW\0".as_ptr());
        let p_inf = GetProcAddress(h_ver, b"GetFileVersionInfoW\0".as_ptr());
        let p_qry = GetProcAddress(h_ver, b"VerQueryValueW\0".as_ptr());
        if p_sz.is_null() || p_inf.is_null() || p_qry.is_null() {
            return (String::new(), String::new());
        }
        let get_sz: FnSize = std::mem::transmute(p_sz);
        let get_inf: FnInfo = std::mem::transmute(p_inf);
        let ver_qry: FnQuery = std::mem::transmute(p_qry);
        let wp = wide(path);
        let mut dummy = 0u32;
        let sz = get_sz(wp.as_ptr(), &mut dummy);
        if sz == 0 {
            return (String::new(), String::new());
        }
        let mut buf = vec![0u8; sz as usize];
        if get_inf(wp.as_ptr(), 0, sz, buf.as_mut_ptr()) == 0 {
            return (String::new(), String::new());
        }
        let mut ptr: *const c_void = std::ptr::null();
        let mut len = 0u32;
        let mut lang = 0x040904B0u32;
        if ver_qry(buf.as_ptr(), wide("\\VarFileInfo\\Translation").as_ptr(), &mut ptr, &mut len) != 0
            && !ptr.is_null()
            && len >= 4
        {
            let pair = std::slice::from_raw_parts(ptr as *const u16, 2);
            lang = ((pair[0] as u32) << 16) | (pair[1] as u32);
        }
        let read_key = |key: &str| -> String {
            let sub = format!("\\StringFileInfo\\{:08X}\\{}", lang, key);
            let mut p2: *const c_void = std::ptr::null();
            let mut l2 = 0u32;
            if ver_qry(buf.as_ptr(), wide(&sub).as_ptr(), &mut p2, &mut l2) != 0 && !p2.is_null() && l2 > 0 {
                let slice = std::slice::from_raw_parts(p2 as *const u16, l2 as usize);
                let s = String::from_utf16_lossy(slice);
                s.trim_end_matches('\0').to_string()
            } else {
                String::new()
            }
        };
        (read_key("CompanyName"), read_key("FileDescription"))
    }
}

fn resolve_lnk(path: &str) -> (String, String) {
    // Minimal COM IShellLinkW + IPersistFile resolver; returns (target, args)
    #[repr(C)]
    struct GuidRaw { d1: u32, d2: u16, d3: u16, d4: [u8; 8] }
    const CLSID_SHELL_LINK: GuidRaw = GuidRaw { d1: 0x00021401, d2: 0, d3: 0, d4: [0xC0, 0, 0, 0, 0, 0, 0, 0x46] };
    const IID_ISHELL_LINK_W: GuidRaw = GuidRaw { d1: 0x000214F9, d2: 0, d3: 0, d4: [0xC0, 0, 0, 0, 0, 0, 0, 0x46] };
    const IID_IPERSIST_FILE: GuidRaw = GuidRaw { d1: 0x0000010b, d2: 0, d3: 0, d4: [0xC0, 0, 0, 0, 0, 0, 0, 0x46] };
    // SAFETY: Dynamic library/symbol lookup and FFI invocation using null-terminated names and ABI-matched signatures.
    unsafe {
        let ole = LoadLibraryA(b"ole32.dll\0".as_ptr());
        if ole == 0 {
            return (path.to_string(), String::new());
        }
        type FnCoInit = unsafe extern "system" fn(*const c_void, u32) -> i32;
        type FnCoCreate = unsafe extern "system" fn(*const GuidRaw, *const c_void, u32, *const GuidRaw, *mut *mut *const usize) -> i32;
        let co_init: FnCoInit = std::mem::transmute(GetProcAddress(ole, b"CoInitializeEx\0".as_ptr()));
        let co_create: FnCoCreate = std::mem::transmute(GetProcAddress(ole, b"CoCreateInstance\0".as_ptr()));
        let _ = co_init(std::ptr::null(), 0);
        let mut psl: *mut *const usize = std::ptr::null_mut();
        if co_create(&CLSID_SHELL_LINK, std::ptr::null(), 1, &IID_ISHELL_LINK_W, &mut psl) != 0 || psl.is_null() {
            return (path.to_string(), String::new());
        }
        let vt = *psl;
        type FnQi = unsafe extern "system" fn(*mut *const usize, *const GuidRaw, *mut *mut *const usize) -> i32;
        type FnRel = unsafe extern "system" fn(*mut *const usize) -> u32;
        type FnGetPath = unsafe extern "system" fn(*mut *const usize, *mut u16, i32, *mut c_void, u32) -> i32;
        type FnGetArgs = unsafe extern "system" fn(*mut *const usize, *mut u16, i32) -> i32;
        let qi: FnQi = std::mem::transmute(*vt.add(0));
        let rel: FnRel = std::mem::transmute(*vt.add(2));
        let mut ppf: *mut *const usize = std::ptr::null_mut();
        let mut target = path.to_string();
        let mut args = String::new();
        if qi(psl, &IID_IPERSIST_FILE, &mut ppf) == 0 && !ppf.is_null() {
            let pf_vt = *ppf;
            type FnLoad = unsafe extern "system" fn(*mut *const usize, *const u16, u32) -> i32;
            let pf_rel: FnRel = std::mem::transmute(*pf_vt.add(2));
            let pf_load: FnLoad = std::mem::transmute(*pf_vt.add(5));
            if pf_load(ppf, wide(path).as_ptr(), 0) == 0 {
                let get_path: FnGetPath = std::mem::transmute(*vt.add(3));
                let get_args: FnGetArgs = std::mem::transmute(*vt.add(10));
                let mut tbuf = [0u16; 520];
                if get_path(psl, tbuf.as_mut_ptr(), tbuf.len() as i32, std::ptr::null_mut(), 0) == 0 {
                    let s = String::from_utf16_lossy(&tbuf);
                    let end = s.find('\0').unwrap_or(s.len());
                    if end > 0 {
                        target = s[..end].to_string();
                    }
                }
                let mut abuf = [0u16; 520];
                if get_args(psl, abuf.as_mut_ptr(), abuf.len() as i32) == 0 {
                    let s = String::from_utf16_lossy(&abuf);
                    let end = s.find('\0').unwrap_or(s.len());
                    args = s[..end].to_string();
                }
            }
            pf_rel(ppf);
        }
        rel(psl);
        (target, args)
    }
}

fn info_of(file: &str) -> (String, String, String, String, bool) {
    if file.is_empty() {
        return (String::new(), String::new(), String::new(), String::new(), false);
    }
    let (target, args) = if file.to_ascii_lowercase().ends_with(".lnk") {
        resolve_lnk(file)
    } else {
        (file.to_string(), String::new())
    };
    let found = !target.is_empty() && Path::new(&target).is_file();
    let (publisher, description) = if found {
        file_version_info(&target)
    } else {
        (String::new(), String::new())
    };
    (target, args, publisher, description, found)
}

fn reg_enum_values(hkey: isize) -> Vec<(String, u32, Vec<u8>)> {
    let mut out = Vec::new();
    let mut idx = 0u32;
    loop {
        let mut nbuf = [0u16; 512];
        let mut nlen = nbuf.len() as u32;
        let mut ty = 0u32;
        let mut dlen = 0u32;
        // SAFETY: Win32 registry call using null-terminated UTF-16 strings and properly sized stack/Vec buffers.
        let r = unsafe {
            RegEnumValueW(
                hkey,
                idx,
                nbuf.as_mut_ptr(),
                &mut nlen,
                std::ptr::null_mut(),
                &mut ty,
                std::ptr::null_mut(),
                &mut dlen,
            )
        };
        if r == 259 {
            break; // ERROR_NO_MORE_ITEMS
        }
        if r != 0 {
            idx += 1;
            continue;
        }
        let mut dbuf = vec![0u8; dlen as usize];
        let mut nlen2 = nbuf.len() as u32;
        let mut dlen2 = dlen;
        // SAFETY: Win32 registry call using null-terminated UTF-16 strings and properly sized stack/Vec buffers.
        let r2 = unsafe {
            RegEnumValueW(
                hkey,
                idx,
                nbuf.as_mut_ptr(),
                &mut nlen2,
                std::ptr::null_mut(),
                &mut ty,
                dbuf.as_mut_ptr(),
                &mut dlen2,
            )
        };
        idx += 1;
        if r2 == 0 {
            let name = String::from_utf16_lossy(&nbuf[..nlen2 as usize]);
            dbuf.truncate(dlen2 as usize);
            out.push((name, ty, dbuf));
        }
    }
    out
}

pub fn startup_apps_read() -> Value {
    use std::collections::HashMap;
    let approved_base = "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved";
    let mut approved_exists: HashMap<String, bool> = HashMap::new();
    let mut approved_vals: HashMap<String, HashMap<String, String>> = HashMap::new();

    for (scope, root) in [("HKCU", HKEY_CURRENT_USER), ("HKLM", HKEY_LOCAL_MACHINE)] {
        for k in ["Run", "Run32", "StartupFolder"] {
            let id = format!("{scope}|{k}");
            let mut map = HashMap::new();
            let exists = if let Some(h) = reg_open(root, &format!("{approved_base}\\{k}")) {
                for (name, ty, data) in reg_enum_values(h) {
                    if ty == 3 {
                        let hex: String = data.iter().map(|b| format!("{b:02x}")).collect();
                        map.insert(name, hex);
                    } else {
                        map.insert(name, String::new());
                    }
                }
                // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
                unsafe { RegCloseKey(h) };
                true
            } else {
                false
            };
            approved_exists.insert(id.clone(), exists);
            approved_vals.insert(id, map);
        }
    }

    let mut items = Vec::new();
    let runs = [
        ("HKCU", HKEY_CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Run", "Run"),
        ("HKLM", HKEY_LOCAL_MACHINE, "Software\\Microsoft\\Windows\\CurrentVersion\\Run", "Run"),
        ("HKLM", HKEY_LOCAL_MACHINE, "Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run", "Run32"),
    ];
    for (scope, root, sub, key) in runs {
        if let Some(h) = reg_open(root, sub) {
            let app_map = approved_vals.get(&format!("{scope}|{key}"));
            for (name, ty, data) in reg_enum_values(h) {
                if name.is_empty() || (ty != 1 && ty != 2) {
                    continue;
                }
                let u16s: Vec<u16> = data
                    .chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .collect();
                let cmd = String::from_utf16_lossy(&u16s).trim_end_matches('\0').to_string();
                let (target, _args, publisher, description, found) = info_of(&exe_of(&cmd));
                let approved = app_map.and_then(|m| m.get(&name)).cloned();
                items.push(json!({
                    "scope": scope,
                    "key": key,
                    "name": name,
                    "source": format!("{scope}\\{sub}"),
                    "command": cmd,
                    "target": target,
                    "found": found,
                    "publisher": publisher,
                    "description": description,
                    "approved": approved,
                }));
            }
            // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
            unsafe { RegCloseKey(h) };
        }
    }

    let user_startup = std::env::var("APPDATA")
        .map(|a| format!("{a}\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"))
        .unwrap_or_default();
    let common_startup = std::env::var("ProgramData")
        .map(|p| format!("{p}\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"))
        .unwrap_or_default();
    for (scope, dir) in [("HKCU", user_startup), ("HKLM", common_startup)] {
        if dir.is_empty() || !Path::new(&dir).is_dir() {
            continue;
        }
        let app_map = approved_vals.get(&format!("{scope}|StartupFolder"));
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for ent in rd.flatten() {
                let p = ent.path();
                if !p.is_file() {
                    continue;
                }
                let fname = p.file_name().and_then(|x| x.to_str()).unwrap_or("").to_string();
                if fname.eq_ignore_ascii_case("desktop.ini") {
                    continue;
                }
                let full = p.to_string_lossy().to_string();
                let (target, args, publisher, description, found) = info_of(&full);
                let approved = app_map.and_then(|m| m.get(&fname)).cloned();
                items.push(json!({
                    "scope": scope,
                    "key": "StartupFolder",
                    "name": fname,
                    "source": dir,
                    "command": full,
                    "target": target,
                    "args": args,
                    "found": found,
                    "publisher": publisher,
                    "description": description,
                    "approved": approved,
                }));
            }
        }
    }

    // Diagnostics-Performance/Operational event log (requires admin; ordinary users get access denied)
    let mut impact = json!({ "readable": false, "why": "", "apps": [], "boot": null });
    // SAFETY: Win32 HID/file I/O call with valid handle, overlapped struct, and bounded byte buffer.
    unsafe {
        extern "system" {
            fn GetLastError() -> u32;
        }
        let wevt = LoadLibraryA(b"wevtapi.dll\0".as_ptr());
        if wevt != 0 {
            type FnEvtQuery = unsafe extern "system" fn(isize, *const u16, *const u16, u32) -> isize;
            type FnEvtClose = unsafe extern "system" fn(isize) -> i32;
            let p_q = GetProcAddress(wevt, b"EvtQuery\0".as_ptr());
            let p_c = GetProcAddress(wevt, b"EvtClose\0".as_ptr());
            if !p_q.is_null() && !p_c.is_null() {
                let evt_query: FnEvtQuery = std::mem::transmute(p_q);
                let evt_close: FnEvtClose = std::mem::transmute(p_c);
                let h = evt_query(
                    0,
                    wide("Microsoft-Windows-Diagnostics-Performance/Operational").as_ptr(),
                    wide("*[System[(EventID=100 or EventID=101)]]").as_ptr(),
                    1 | 0x200, // EvtQueryChannelPath | EvtQueryReverseDirection
                );
                if h == 0 {
                    let err = GetLastError();
                    if err == 5 {
                        impact["why"] = json!("Attempted to perform an unauthorized operation.");
                    } else if err == 15007 {
                        impact["readable"] = json!(true);
                    } else {
                        impact["why"] = json!(format!("Windows event log error {err}"));
                    }
                } else {
                    impact["readable"] = json!(true);
                    evt_close(h);
                }
            }
        }
    }

    json!({
        "items": items,
        "approvedKeys": approved_exists,
        "impact": impact,
    })
}

pub fn startup_impact_read(test_seconds: u64) -> Value {
    extern "system" {
        fn GetCurrentProcessId() -> u32;
        fn ProcessIdToSessionId(pid: u32, sid: *mut u32) -> i32;
    }
    let mut sid = 0u32;
    // SAFETY: Win32 system/process API call with valid handles and caller-owned output buffers.
    unsafe {
        if ProcessIdToSessionId(GetCurrentProcessId(), &mut sid) == 0 {
            return json!({ "error": "session id unavailable" });
        }
    }
    let exps = wmi::query(
        "root\\CIMV2",
        &format!("SELECT CreationDate FROM Win32_Process WHERE Name = 'explorer.exe' AND SessionId = {sid}"),
        &["CreationDate"],
    )
    .unwrap_or_default();
    let mut dates: Vec<String> = exps
        .iter()
        .filter_map(|r| r.get("CreationDate").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .collect();
    dates.sort();
    let first = match dates.first() {
        Some(s) => s.clone(),
        None => return json!({ "error": "no explorer.exe in this session" }),
    };

    fn parse_wmi_unix(s: &str) -> Option<i64> {
        if s.len() < 14 {
            return None;
        }
        let y: i64 = s[0..4].parse().ok()?;
        let m: i64 = s[4..6].parse().ok()?;
        let d: i64 = s[6..8].parse().ok()?;
        let hh: i64 = s[8..10].parse().ok()?;
        let mm: i64 = s[10..12].parse().ok()?;
        let ss: i64 = s[12..14].parse().ok()?;
        let tz_min: i64 = if s.len() >= 25 {
            let sign = if &s[21..22] == "-" { -1 } else { 1 };
            let off: i64 = s[22..25].parse().unwrap_or(0);
            sign * off
        } else {
            0
        };
        // Civil-from-days inverse (Howard Hinnant)
        let y2 = y - if m <= 2 { 1 } else { 0 };
        let era = y2.div_euclid(400);
        let yoe = y2.rem_euclid(400);
        let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        let days = era * 146097 + doe - 719468;
        let local_sec = days * 86400 + hh * 3600 + mm * 60 + ss;
        Some(local_sec - tz_min * 60)
    }

    fn fmt_iso(sec: i64) -> String {
        let days = sec.div_euclid(86400) + 719468;
        let rem = sec.rem_euclid(86400);
        let hh = rem / 3600;
        let mm = (rem % 3600) / 60;
        let ss = rem % 60;
        let era = days.div_euclid(146097);
        let doe = days.rem_euclid(146097);
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        let y = yoe + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = mp + if mp < 10 { 3 } else { -9 };
        let y = y + if m <= 2 { 1 } else { 0 };
        format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}.000Z")
    }

    let now_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let mut sign_in_unix = parse_wmi_unix(&first).unwrap_or(now_unix);
    let mut until_unix = sign_in_unix + 150;
    if test_seconds > 0 {
        sign_in_unix = now_unix;
        until_unix = now_unix + test_seconds as i64;
    }
    if test_seconds == 0 && (now_unix - sign_in_unix) > 240 {
        return json!({ "late": true, "signIn": fmt_iso(sign_in_unix) });
    }

    let mut seen: std::collections::HashMap<String, Value> = std::collections::HashMap::new();
    loop {
        let procs = wmi::query(
            "root\\CIMV2",
            &format!("SELECT Name, ExecutablePath, CommandLine, ProcessId, ParentProcessId, CreationDate, KernelModeTime, UserModeTime, ReadTransferCount, WriteTransferCount FROM Win32_Process WHERE SessionId = {sid}"),
            &["Name", "ExecutablePath", "CommandLine", "ProcessId", "ParentProcessId", "CreationDate", "KernelModeTime", "UserModeTime", "ReadTransferCount", "WriteTransferCount"],
        )
        .unwrap_or_default();
        for p in procs {
            let cd = match p.get("CreationDate").and_then(|v| v.as_str()) {
                Some(s) => s,
                None => continue,
            };
            let cu = match parse_wmi_unix(cd) {
                Some(u) => u,
                None => continue,
            };
            if cu < sign_in_unix - 10 {
                continue;
            }
            let pid = p.get("ProcessId").and_then(|v| v.as_i64()).unwrap_or(0);
            let ppid = p.get("ParentProcessId").and_then(|v| v.as_i64()).unwrap_or(0);
            let k = p.get("KernelModeTime").and_then(|v| v.as_i64()).unwrap_or(0);
            let u = p.get("UserModeTime").and_then(|v| v.as_i64()).unwrap_or(0);
            let rt = p.get("ReadTransferCount").and_then(|v| v.as_i64()).unwrap_or(0);
            let wt = p.get("WriteTransferCount").and_then(|v| v.as_i64()).unwrap_or(0);
            seen.insert(
                format!("{pid}|{cd}"),
                json!({
                    "name": p.get("Name").and_then(|v| v.as_str()).unwrap_or(""),
                    "path": p.get("ExecutablePath").cloned().unwrap_or(Value::Null),
                    "cmd": p.get("CommandLine").cloned().unwrap_or(Value::Null),
                    "pid": pid,
                    "ppid": ppid,
                    "startS": cu - sign_in_unix,
                    "cpuMs": (k + u) / 10000,
                    "ioKB": (rt + wt) / 1024,
                }),
            );
        }
        let cur = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        if cur >= until_unix {
            break;
        }
        std::thread::sleep(std::time::Duration::from_secs(10));
    }
    let at_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let procs_vec: Vec<Value> = seen.into_values().collect();
    json!({
        "signIn": fmt_iso(sign_in_unix),
        "at": fmt_iso(at_unix),
        "procs": procs_vec,
    })
}

pub fn sleep_monitors(probe: bool) -> Value {
    let modern = modern_standby();
    if probe {
        return json!(if modern { "modern" } else { "s3" });
    }
    if modern {
        return json!("modern");
    }
    std::thread::spawn(|| {
        #[allow(clashing_extern_declarations)]
        extern "system" {
            fn CreateWindowExW(
                ex_style: u32,
                class_name: *const u16,
                window_name: *const u16,
                style: u32,
                x: i32,
                y: i32,
                w: i32,
                h: i32,
                parent: isize,
                menu: isize,
                inst: isize,
                param: *const c_void,
            ) -> isize;
            fn DestroyWindow(hwnd: isize) -> i32;
            fn SendMessageW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize;
        }
        std::thread::sleep(std::time::Duration::from_millis(2000));
        // SAFETY: Win32 window/tray/GDI call on valid HWND/HINSTANCE/resource with initialized structs.
        unsafe {
            let hwnd = CreateWindowExW(
                0,
                wide("STATIC").as_ptr(),
                wide("").as_ptr(),
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                std::ptr::null(),
            );
            if hwnd != 0 {
                SendMessageW(hwnd, 0x0112, 0xF170, 2);
                DestroyWindow(hwnd);
            }
        }
    });
    json!("s3")
}

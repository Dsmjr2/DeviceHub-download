use serde_json::{json, Map, Value};
use std::thread;
use std::time::Duration;

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct RECT {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[repr(C)]
struct MONITORINFOEXW {
    cb_size: u32,
    rc_monitor: RECT,
    rc_work: RECT,
    dw_flags: u32,
    sz_device: [u16; 32],
}

#[repr(C)]
struct DISPLAY_DEVICEW {
    cb: u32,
    device_name: [u16; 32],
    device_string: [u16; 128],
    state_flags: u32,
    device_id: [u16; 128],
    device_key: [u16; 128],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct PHYSICAL_MONITOR {
    h_physical_monitor: isize,
    sz_physical_monitor_description: [u16; 128],
}

type MonitorEnumProc = unsafe extern "system" fn(isize, isize, *mut RECT, isize) -> i32;

#[link(name = "user32")]
extern "system" {
    fn EnumDisplayMonitors(
        hdc: isize,
        lprc_clip: *const RECT,
        lpfn_enum: MonitorEnumProc,
        dw_data: isize,
    ) -> i32;
    fn GetMonitorInfoW(h_monitor: isize, lpmi: *mut MONITORINFOEXW) -> i32;
    fn EnumDisplayDevicesW(
        lp_device: *const u16,
        i_dev_num: u32,
        lp_display_device: *mut DISPLAY_DEVICEW,
        dw_flags: u32,
    ) -> i32;
}

#[link(name = "dxva2")]
extern "system" {
    fn GetNumberOfPhysicalMonitorsFromHMONITOR(
        h_monitor: isize,
        pdw_number_of_physical_monitors: *mut u32,
    ) -> i32;
    fn GetPhysicalMonitorsFromHMONITOR(
        h_monitor: isize,
        dw_physical_monitor_array_size: u32,
        p_physical_monitor_array: *mut PHYSICAL_MONITOR,
    ) -> i32;
    fn DestroyPhysicalMonitors(
        dw_physical_monitor_array_size: u32,
        p_physical_monitor_array: *const PHYSICAL_MONITOR,
    ) -> i32;
    fn GetCapabilitiesStringLength(
        h_monitor: isize,
        pdw_capabilities_string_length_in_characters: *mut u32,
    ) -> i32;
    fn CapabilitiesRequestAndCapabilitiesReply(
        h_monitor: isize,
        psz_ascii_capabilities_string: *mut u8,
        dw_capabilities_string_length_in_characters: u32,
    ) -> i32;
    fn GetVCPFeatureAndVCPFeatureReply(
        h_monitor: isize,
        b_vcp_code: u8,
        pvct: *mut u32,
        pdw_current_value: *mut u32,
        pdw_maximum_value: *mut u32,
    ) -> i32;
    fn SetVCPFeature(h_monitor: isize, b_vcp_code: u8, dw_new_value: u32) -> i32;
}

const ALLOWED: [u8; 10] = [0x10, 0x12, 0x62, 0x14, 0x16, 0x18, 0x1A, 0x6C, 0x6E, 0x70];

struct Mon {
    id: String,
    screen: String,
    name: String,
    h_mon: isize,
    index: usize,
}

fn wide_to_string(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

fn parse_display_id(dev_id: &str) -> Option<String> {
    let pos = dev_id.find("DISPLAY#")?;
    let rest = &dev_id[pos + "DISPLAY#".len()..];
    let mut parts = rest.split('#');
    let p1 = parts.next()?;
    let p2 = parts.next()?;
    if p1.is_empty() || p2.is_empty() {
        return None;
    }
    Some(format!("{p1}#{p2}"))
}

// SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
unsafe extern "system" fn enum_cb(
    h_mon: isize,
    _hdc: isize,
    _rect: *mut RECT,
    data: isize,
) -> i32 {
    let list = &mut *(data as *mut Vec<Mon>);
    let mut mi: MONITORINFOEXW = std::mem::zeroed();
    mi.cb_size = std::mem::size_of::<MONITORINFOEXW>() as u32;
    GetMonitorInfoW(h_mon, &mut mi);
    let mut n: u32 = 0;
    if GetNumberOfPhysicalMonitorsFromHMONITOR(h_mon, &mut n) == 0 || n == 0 {
        return 1;
    }
    let screen = wide_to_string(&mi.sz_device);
    let mut screen_w: Vec<u16> = screen.encode_utf16().collect();
    screen_w.push(0);

    for i in 0..n {
        let mut dd: DISPLAY_DEVICEW = std::mem::zeroed();
        dd.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
        let mut id = format!("{screen}#{i}");
        let mut name = "Monitor".to_string();
        if EnumDisplayDevicesW(screen_w.as_ptr(), i, &mut dd, 1) != 0 {
            let dev_id = wide_to_string(&dd.device_id);
            if let Some(parsed) = parse_display_id(&dev_id) {
                id = parsed;
            }
            let dev_str = wide_to_string(&dd.device_string);
            if !dev_str.is_empty() {
                name = dev_str;
            }
        }
        list.push(Mon {
            id,
            screen: screen.clone(),
            name,
            h_mon,
            index: i as usize,
        });
    }
    1
}

fn enumerate() -> Vec<Mon> {
    let mut list = Vec::new();
    // SAFETY: Win32 display/monitor API call with valid HMONITOR/handle and stack-allocated output buffers.
    unsafe {
        EnumDisplayMonitors(
            0,
            std::ptr::null(),
            enum_cb,
            (&mut list as *mut Vec<Mon>) as isize,
        );
    }
    list
}

fn with_handle<T, F: FnOnce(isize) -> Result<T, String>>(m: &Mon, f: F) -> Result<T, String> {
    let mut n: u32 = 0;
    // SAFETY: Win32 display/monitor API call with valid HMONITOR/handle and stack-allocated output buffers.
    if unsafe { GetNumberOfPhysicalMonitorsFromHMONITOR(m.h_mon, &mut n) } == 0
        || (n as usize) <= m.index
    {
        return Err("monitor not found".into());
    }
    let mut arr = vec![
        PHYSICAL_MONITOR {
            h_physical_monitor: 0,
            sz_physical_monitor_description: [0; 128],
        };
        n as usize
    ];
    // SAFETY: Win32 display/monitor API call with valid HMONITOR/handle and stack-allocated output buffers.
    if unsafe { GetPhysicalMonitorsFromHMONITOR(m.h_mon, n, arr.as_mut_ptr()) } == 0 {
        return Err("monitor not reachable".into());
    }
    let res = f(arr[m.index].h_physical_monitor);
    // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
    unsafe { DestroyPhysicalMonitors(n, arr.as_ptr()) };
    res
}

fn read_mon(h: isize, caps: bool) -> Map<String, Value> {
    let mut o = Map::new();
    if caps {
        let mut cap_str: Option<String> = None;
        for _ in 0..2 {
            let mut len: u32 = 0;
            // SAFETY: Win32 display/monitor API call with valid HMONITOR/handle and stack-allocated output buffers.
            if unsafe { GetCapabilitiesStringLength(h, &mut len) } != 0 && len > 0 {
                let mut buf = vec![0u8; len as usize];
                // SAFETY: Win32 display/monitor API call with valid HMONITOR/handle and stack-allocated output buffers.
                if unsafe { CapabilitiesRequestAndCapabilitiesReply(h, buf.as_mut_ptr(), len) } != 0
                {
                    let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
                    cap_str = Some(String::from_utf8_lossy(&buf[..end]).into_owned());
                    break;
                }
            }
            thread::sleep(Duration::from_millis(60));
        }
        o.insert(
            "caps".into(),
            cap_str.map(Value::String).unwrap_or(Value::Null),
        );
    }
    let mut vals = Map::new();
    for code in ALLOWED {
        let mut ok = false;
        let mut cur: u32 = 0;
        let mut max: u32 = 0;
        for _ in 0..2 {
            // SAFETY: Win32 display/monitor API call with valid HMONITOR/handle and stack-allocated output buffers.
            if unsafe {
                GetVCPFeatureAndVCPFeatureReply(h, code, std::ptr::null_mut(), &mut cur, &mut max)
            } != 0
            {
                vals.insert(format!("{code:02X}"), json!({ "cur": cur, "max": max }));
                ok = true;
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
        let _ = ok;
    }
    o.insert("values".into(), Value::Object(vals));
    o
}

pub fn list(caps: bool) -> Value {
    let mut r = Vec::new();
    for m in enumerate() {
        let mut o = Map::new();
        o.insert("id".into(), json!(m.id));
        o.insert("screen".into(), json!(m.screen));
        o.insert("name".into(), json!(m.name));
        match with_handle(&m, |h| Ok(read_mon(h, caps))) {
            Ok(map) => {
                let has_vals = map
                    .get("values")
                    .and_then(|v| v.as_object())
                    .map(|v| !v.is_empty())
                    .unwrap_or(false);
                for (k, v) in map {
                    o.insert(k, v);
                }
                o.insert("ddc".into(), json!(has_vals));
            }
            Err(e) => {
                o.insert("ddc".into(), json!(false));
                o.insert("error".into(), json!(e));
            }
        }
        r.push(Value::Object(o));
    }
    Value::Array(r)
}

pub fn set(id: &str, code: i32, value: i32, live: bool) -> Result<Map<String, Value>, String> {
    if !ALLOWED.contains(&(code as u8)) {
        return Err("not an allowed setting".into());
    }
    if !(0..=65535).contains(&value) {
        return Err("bad value".into());
    }
    for m in enumerate() {
        if m.id != id {
            continue;
        }
        return with_handle(&m, |h| {
            // SAFETY: Win32 display/monitor API call with valid HMONITOR/handle and stack-allocated output buffers.
            if unsafe { SetVCPFeature(h, code as u8, value as u32) } == 0 {
                return Err("the monitor refused it".into());
            }
            let mut out = Map::new();
            if live {
                thread::sleep(Duration::from_millis(50));
                out.insert("ok".into(), json!(true));
                out.insert("cur".into(), json!(value as u32));
                out.insert("live".into(), json!(true));
                return Ok(out);
            }
            thread::sleep(Duration::from_millis(if code == 0x14 { 800 } else { 120 }));
            let mut cur: u32 = 0;
            let mut max: u32 = 0;
            let mut ok = false;
            for _ in 0..4 {
                // SAFETY: Win32 display/monitor API call with valid HMONITOR/handle and stack-allocated output buffers.
                if unsafe {
                    GetVCPFeatureAndVCPFeatureReply(
                        h,
                        code as u8,
                        std::ptr::null_mut(),
                        &mut cur,
                        &mut max,
                    )
                } != 0
                {
                    ok = true;
                    break;
                }
                thread::sleep(Duration::from_millis(150));
            }
            out.insert("ok".into(), json!(ok));
            out.insert("cur".into(), json!(cur));
            out.insert("max".into(), json!(max));
            Ok(out)
        });
    }
    Err("monitor not found".into())
}

pub fn handle(rest: &str) -> Result<String, String> {
    let q: Value = serde_json::from_str(rest).map_err(|e| e.to_string())?;
    let op = q.get("op").and_then(|v| v.as_str()).unwrap_or("");
    match op {
        "monitors" => {
            let caps = q.get("caps").and_then(|v| v.as_bool()).unwrap_or(false);
            Ok(json!({ "ok": true, "monitors": list(caps) }).to_string())
        }
        "monitor-set" => {
            let id = q.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let code = q.get("code").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            let value = q.get("value").and_then(|v| v.as_i64()).unwrap_or(-1) as i32;
            let live = q.get("live").and_then(|v| v.as_bool()).unwrap_or(false);
            let res = set(id, code, value, live)?;
            let mut o = Map::new();
            o.insert("ok".into(), json!(true));
            for (k, v) in res {
                o.insert(k, v);
            }
            Ok(Value::Object(o).to_string())
        }
        _ => Ok(json!({ "ok": false, "error": "unknown monitor op" }).to_string()),
    }
}

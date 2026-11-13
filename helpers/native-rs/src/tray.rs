use serde_json::{json, Value};
use std::ffi::c_void;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

const WM_USER: u32 = 0x0400;
const WM_APP: u32 = 0x8000;
const WM_TRAY: u32 = WM_USER + 1;
const WM_APP_WAKE: u32 = WM_APP + 1;
const WM_APP_REFRESH_DONE: u32 = WM_APP + 2;
const WM_APP_BALLOON: u32 = WM_APP + 3;
const WM_APP_STOP: u32 = WM_APP + 4;

const WM_DESTROY: u32 = 0x0002;
const WM_TIMER: u32 = 0x0113;
const WM_INPUT: u32 = 0x00FF;
const WM_POWERBROADCAST: u32 = 0x0218;
const WM_DEVICECHANGE: u32 = 0x0219;
const WM_LBUTTONUP: u32 = 0x0202;
const WM_LBUTTONDBLCLK: u32 = 0x0203;
const WM_RBUTTONUP: u32 = 0x0205;
const WM_CONTEXTMENU: u32 = 0x007B;

const NIM_ADD: u32 = 0;
const NIM_MODIFY: u32 = 1;
const NIM_DELETE: u32 = 2;
const NIF_MESSAGE: u32 = 0x01;
const NIF_ICON: u32 = 0x02;
const NIF_TIP: u32 = 0x04;
const NIF_INFO: u32 = 0x10;
const NIIF_INFO: u32 = 0x01;
const NIIF_ERROR: u32 = 0x03;

const MF_STRING: u32 = 0x0000;
const MF_GRAYED: u32 = 0x0001;
const MF_CHECKED: u32 = 0x0008;
const MF_POPUP: u32 = 0x0010;
const MF_SEPARATOR: u32 = 0x0800;
const TPM_RIGHTBUTTON: u32 = 0x0002;
const TPM_RETURNCMD: u32 = 0x0100;

const IMAGE_ICON: u32 = 1;
const LR_LOADFROMFILE: u32 = 0x0010;
const LR_DEFAULTSIZE: u32 = 0x0040;

#[repr(C)]
struct WNDCLASSEXW {
    cb_size: u32,
    style: u32,
    lpfn_wnd_proc: unsafe extern "system" fn(isize, u32, usize, isize) -> isize,
    cb_cls_extra: i32,
    cb_wnd_extra: i32,
    h_instance: isize,
    h_icon: isize,
    h_cursor: isize,
    h_br_background: isize,
    lpsz_menu_name: *const u16,
    lpsz_class_name: *const u16,
    h_icon_sm: isize,
}

#[repr(C)]
struct MSG {
    hwnd: isize,
    message: u32,
    w_param: usize,
    l_param: isize,
    time: u32,
    pt_x: i32,
    pt_y: i32,
}

#[repr(C)]
struct POINT {
    x: i32,
    y: i32,
}

#[repr(C)]
struct RAWINPUTDEVICE {
    us_usage_page: u16,
    us_usage: u16,
    dw_flags: u32,
    hwnd_target: isize,
}

#[repr(C)]
struct NOTIFYICONDATAW {
    cb_size: u32,
    h_wnd: isize,
    u_id: u32,
    u_flags: u32,
    u_callback_message: u32,
    h_icon: isize,
    sz_tip: [u16; 128],
    dw_state: u32,
    dw_state_mask: u32,
    sz_info: [u16; 256],
    u_timeout_or_version: u32,
    sz_info_title: [u16; 64],
    dw_info_flags: u32,
    guid_item: [u8; 16],
    h_balloon_icon: isize,
}

#[repr(C)]
struct ICONINFO {
    f_icon: i32,
    x_hotspot: u32,
    y_hotspot: u32,
    hbm_mask: isize,
    hbm_color: isize,
}

#[repr(C)]
struct BITMAPINFOHEADER {
    bi_size: u32,
    bi_width: i32,
    bi_height: i32,
    bi_planes: u16,
    bi_bit_count: u16,
    bi_compression: u32,
    bi_size_image: u32,
    bi_x_pels_per_meter: i32,
    bi_y_pels_per_meter: i32,
    bi_clr_used: u32,
    bi_clr_important: u32,
}

#[link(name = "kernel32")]
extern "system" {
    fn GetModuleHandleW(lp_module_name: *const u16) -> isize;
}

#[link(name = "user32")]
extern "system" {
    fn RegisterClassExW(lpwcx: *const WNDCLASSEXW) -> u16;
    #[allow(clashing_extern_declarations)]
    fn CreateWindowExW(
        dw_ex_style: u32,
        lp_class_name: *const u16,
        lp_window_name: *const u16,
        dw_style: u32,
        x: i32,
        y: i32,
        n_width: i32,
        n_height: i32,
        h_wnd_parent: isize,
        h_menu: isize,
        h_instance: isize,
        lp_param: *mut c_void,
    ) -> isize;
    fn DefWindowProcW(hwnd: isize, msg: u32, w_param: usize, l_param: isize) -> isize;
    fn GetMessageW(lp_msg: *mut MSG, hwnd: isize, w_msg_filter_min: u32, w_msg_filter_max: u32) -> i32;
    fn TranslateMessage(lp_msg: *const MSG) -> i32;
    fn DispatchMessageW(lp_msg: *const MSG) -> isize;
    fn PostMessageW(hwnd: isize, msg: u32, w_param: usize, l_param: isize) -> i32;
    fn PostQuitMessage(n_exit_code: i32);
    fn SetTimer(hwnd: isize, n_id_event: usize, u_elapse: u32, lp_timer_func: *const c_void) -> usize;
    fn RegisterRawInputDevices(p_raw_input_devices: *const RAWINPUTDEVICE, ui_num_devices: u32, cb_size: u32) -> i32;
    fn LoadImageW(h_inst: isize, name: *const u16, ty: u32, cx: i32, cy: i32, fu_load: u32) -> isize;
    fn DestroyIcon(h_icon: isize) -> i32;
    fn GetSystemMetrics(n_index: i32) -> i32;
    fn DrawIconEx(hdc: isize, x_left: i32, y_top: i32, h_icon: isize, cx_width: i32, cy_width: i32, istep: u32, hbr: isize, di_flags: u32) -> i32;
    fn CreateIconIndirect(piconinfo: *const ICONINFO) -> isize;
    fn CreatePopupMenu() -> isize;
    fn DestroyMenu(h_menu: isize) -> i32;
    fn AppendMenuW(h_menu: isize, u_flags: u32, u_id_new_item: usize, lp_new_item: *const u16) -> i32;
    fn TrackPopupMenu(h_menu: isize, u_flags: u32, x: i32, y: i32, n_reserved: i32, hwnd: isize, prc_rect: *const c_void) -> i32;
    fn GetCursorPos(lp_point: *mut POINT) -> i32;
    fn SetForegroundWindow(hwnd: isize) -> i32;
}

#[link(name = "gdi32")]
extern "system" {
    fn CreateCompatibleDC(hdc: isize) -> isize;
    fn DeleteDC(hdc: isize) -> i32;
    fn SelectObject(hdc: isize, h: isize) -> isize;
    fn DeleteObject(ho: isize) -> i32;
    fn CreateDIBSection(hdc: isize, pbmi: *const BITMAPINFOHEADER, usage: u32, ppv_bits: *mut *mut u8, h_section: isize, offset: u32) -> isize;
    fn CreateBitmap(n_width: i32, n_height: i32, n_planes: u32, n_bit_count: u32, lp_bits: *const c_void) -> isize;
}

#[link(name = "shell32")]
extern "system" {
    fn Shell_NotifyIconW(dw_message: u32, lp_data: *const NOTIFYICONDATAW) -> i32;
}

struct TrayConfig {
    port: u16,
    root: String,
}

static STARTED: AtomicBool = AtomicBool::new(false);
static HWND_VAL: AtomicIsize = AtomicIsize::new(0);
static LISTENING_RAW: AtomicBool = AtomicBool::new(false);
static CONFIG: Mutex<Option<TrayConfig>> = Mutex::new(None);
static STATE: Mutex<Option<Value>> = Mutex::new(None);
static PENDING_STATE: Mutex<Option<Option<Value>>> = Mutex::new(None);
static PENDING_BALLOON: Mutex<Option<(String, String, bool)>> = Mutex::new(None);
static LAST_OPEN: Mutex<Option<Instant>> = Mutex::new(None);

struct IconState {
    base_icon: isize,
    dot_icon: isize,
    shown_dot: String,
    misses: u32,
}

static ICON_STATE: Mutex<Option<IconState>> = Mutex::new(None);

fn to_wide(s: &str) -> Vec<u16> {
    let mut w: Vec<u16> = s.encode_utf16().collect();
    w.push(0);
    w
}

fn write_wide_fixed<const N: usize>(dst: &mut [u16; N], s: &str) {
    dst.fill(0);
    for (i, u) in s.encode_utf16().take(N - 1).enumerate() {
        dst[i] = u;
    }
}

fn api(path: &str, body: Option<&Value>) -> Option<Value> {
    let port = CONFIG.lock().unwrap().as_ref()?.port;
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse().ok()?;
    let timeout = Duration::from_secs(if body.is_some() { 60 } else { 15 });
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(3)).ok()?;
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let req = if let Some(b) = body {
        let json_str = b.to_string();
        format!(
            "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{json_str}",
            json_str.len()
        )
    } else {
        format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n")
    };
    stream.write_all(req.as_bytes()).ok()?;
    let mut resp = Vec::new();
    stream.read_to_end(&mut resp).ok()?;
    let text = String::from_utf8_lossy(&resp);
    let (_, body_part) = text.split_once("\r\n\r\n")?;
    serde_json::from_str(body_part.trim()).ok()
}

fn open_app() {
    let mut last = LAST_OPEN.lock().unwrap();
    if let Some(t) = *last {
        if t.elapsed() < Duration::from_secs(2) {
            return;
        }
    }
    *last = Some(Instant::now());
    drop(last);

    let root = match CONFIG.lock().unwrap().as_ref() {
        Some(c) => c.root.clone(),
        None => return,
    };
    let vbs = Path::new(&root).join("DeviceHub.vbs");
    let win_dir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
    let wscript = Path::new(&win_dir).join("System32").join("wscript.exe");
    let _ = Command::new(wscript).arg(vbs).spawn();
}

fn post_balloon(title: String, msg: String, is_err: bool) {
    *PENDING_BALLOON.lock().unwrap() = Some((title, msg, is_err));
    let hwnd = HWND_VAL.load(Ordering::SeqCst);
    if hwnd != 0 {
        // SAFETY: Win32 window/tray/GDI call on valid HWND/HINSTANCE/resource with initialized structs.
        unsafe { PostMessageW(hwnd, WM_APP_BALLOON, 0, 0) };
    }
}

fn show_balloon(hwnd: isize, title: &str, msg: &str, is_err: bool) {
    // SAFETY: Win32 C struct is plain-old-data and zero-initialization is valid before setting cbSize.
    let mut nid: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
    nid.cb_size = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
    nid.h_wnd = hwnd;
    nid.u_id = 1;
    nid.u_flags = NIF_INFO;
    write_wide_fixed(&mut nid.sz_info_title, title);
    write_wide_fixed(&mut nid.sz_info, msg);
    nid.dw_info_flags = if is_err { NIIF_ERROR } else { NIIF_INFO };
    // SAFETY: Win32 window/tray/GDI call on valid HWND/HINSTANCE/resource with initialized structs.
    unsafe { Shell_NotifyIconW(NIM_MODIFY, &nid) };
}

fn make_dot_icon(base_icon: isize, dot: &str) -> isize {
    // SAFETY: Win32 window/tray/GDI call on valid HWND/HINSTANCE/resource with initialized structs.
    let size = unsafe { GetSystemMetrics(49) }.max(16); // SM_CXSMICON
    let bmi = BITMAPINFOHEADER {
        bi_size: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        bi_width: size,
        bi_height: -size, // top-down
        bi_planes: 1,
        bi_bit_count: 32,
        bi_compression: 0,
        bi_size_image: 0,
        bi_x_pels_per_meter: 0,
        bi_y_pels_per_meter: 0,
        bi_clr_used: 0,
        bi_clr_important: 0,
    };
    // SAFETY: Win32 window/tray/GDI call on valid HWND/HINSTANCE/resource with initialized structs.
    unsafe {
        let dc = CreateCompatibleDC(0);
        let mut bits: *mut u8 = std::ptr::null_mut();
        let hbm_color = CreateDIBSection(dc, &bmi, 0, &mut bits, 0, 0);
        if hbm_color == 0 || bits.is_null() {
            DeleteDC(dc);
            return base_icon;
        }
        let old = SelectObject(dc, hbm_color);
        std::ptr::write_bytes(bits, 0, (size * size * 4) as usize);
        DrawIconEx(dc, 0, 0, base_icon, size, size, 0, 0, 0x0003); // DI_NORMAL

        // Paint dot in bottom-right corner directly into BGRA buffer
        let r = size as f32 * 0.42;
        let radius = r * 0.5;
        let cx = size as f32 - radius - 0.5;
        let cy = size as f32 - radius - 0.5;
        let (cr, cg, cb) = match dot {
            "red" => (224u8, 103u8, 90u8),
            "yellow" => (226u8, 193u8, 78u8),
            _ => (127u8, 191u8, 149u8),
        };
        let outer_r = radius + 1.5;
        for y in 0..size {
            for x in 0..size {
                let dx = x as f32 + 0.5 - cx;
                let dy = y as f32 + 0.5 - cy;
                let dist = (dx * dx + dy * dy).sqrt();
                let idx = ((y * size + x) * 4) as usize;
                let px = std::slice::from_raw_parts_mut(bits.add(idx), 4);
                if dist <= radius {
                    px[0] = cb;
                    px[1] = cg;
                    px[2] = cr;
                    px[3] = 255;
                } else if dist <= outer_r {
                    px[0] = 27;
                    px[1] = 22;
                    px[2] = 21;
                    px[3] = 255;
                }
            }
        }

        SelectObject(dc, old);
        DeleteDC(dc);

        let hbm_mask = CreateBitmap(size, size, 1, 1, std::ptr::null());
        let ii = ICONINFO {
            f_icon: 1,
            x_hotspot: 0,
            y_hotspot: 0,
            hbm_mask,
            hbm_color,
        };
        let h_icon = CreateIconIndirect(&ii);
        DeleteObject(hbm_color);
        if hbm_mask != 0 {
            DeleteObject(hbm_mask);
        }
        if h_icon != 0 { h_icon } else { base_icon }
    }
}

fn update_tray_icon(hwnd: isize, dot: Option<&str>, tip: &str) {
    let mut guard = ICON_STATE.lock().unwrap();
    let Some(st) = guard.as_mut() else { return };
    let key = dot.unwrap_or("none");
    let mut h_icon = if st.shown_dot == key {
        if st.dot_icon != 0 { st.dot_icon } else { st.base_icon }
    } else {
        st.shown_dot = key.to_string();
        if let Some(d) = dot {
            let new_ic = make_dot_icon(st.base_icon, d);
            if st.dot_icon != 0 && st.dot_icon != st.base_icon {
                // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
                unsafe { DestroyIcon(st.dot_icon) };
            }
            st.dot_icon = if new_ic != st.base_icon { new_ic } else { 0 };
            new_ic
        } else {
            if st.dot_icon != 0 && st.dot_icon != st.base_icon {
                // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
                unsafe { DestroyIcon(st.dot_icon) };
            }
            st.dot_icon = 0;
            st.base_icon
        }
    };
    if h_icon == 0 {
        h_icon = st.base_icon;
    }

    // SAFETY: Win32 C struct is plain-old-data and zero-initialization is valid before setting cbSize.
    let mut nid: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
    nid.cb_size = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
    nid.h_wnd = hwnd;
    nid.u_id = 1;
    nid.u_flags = NIF_ICON | NIF_TIP;
    nid.h_icon = h_icon;
    let tip_short: String = tip.chars().take(63).collect();
    write_wide_fixed(&mut nid.sz_tip, &tip_short);
    // SAFETY: Win32 window/tray/GDI call on valid HWND/HINSTANCE/resource with initialized structs.
    unsafe { Shell_NotifyIconW(NIM_MODIFY, &nid) };
}

fn spawn_refresh() {
    thread::spawn(|| {
        let s = api("/api/agent/state", None);
        *PENDING_STATE.lock().unwrap() = Some(s);
        let hwnd = HWND_VAL.load(Ordering::SeqCst);
        if hwnd != 0 {
            // SAFETY: Win32 window/tray/GDI call on valid HWND/HINSTANCE/resource with initialized structs.
            unsafe { PostMessageW(hwnd, WM_APP_REFRESH_DONE, 0, 0) };
        }
    });
}

fn device_line(d: &Value) -> String {
    let id = d.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let n = match id {
        "mouse" => "Mouse",
        "headset" => "Headset",
        "keyboard" => "Keyboard",
        _ => id,
    };
    let st = d.get("status").and_then(|v| v.as_str()).unwrap_or("");
    let bat = d.get("battery");
    let pct = bat.and_then(|b| b.get("percent")).and_then(|v| v.as_i64());
    let charging = bat
        .and_then(|b| b.get("charging"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    match st {
        "connected" => {
            if let Some(p) = pct {
                format!("{n}  {p}%{}", if charging { " (charging)" } else { "" })
            } else {
                format!("{n}  connected")
            }
        }
        "asleep" => format!("{n}  asleep"),
        "connecting" => format!("{n}  connecting"),
        "error" => format!("{n}  needs attention"),
        _ => format!("{n}  not connected"),
    }
}

fn handle_refresh_done(hwnd: isize) {
    let s_opt = PENDING_STATE.lock().unwrap().take();
    let Some(s_val) = s_opt else { return };
    let Some(s) = s_val else {
        let mut guard = ICON_STATE.lock().unwrap();
        if let Some(st) = guard.as_mut() {
            st.misses += 1;
            if st.misses >= 6 {
                drop(guard);
                // SAFETY: Win32 window/tray/GDI call on valid HWND/HINSTANCE/resource with initialized structs.
                unsafe {
                    PostMessageW(hwnd, WM_APP_STOP, 0, 0);
                }
            }
        }
        return;
    };
    if let Some(st) = ICON_STATE.lock().unwrap().as_mut() {
        st.misses = 0;
    }
    *STATE.lock().unwrap() = Some(s.clone());

    let devices = s.get("devices").and_then(|v| v.as_array());
    let mut parts = Vec::new();
    let mut dot: Option<&'static str> = None;
    let mut why: Option<String> = None;

    for id in ["mouse", "headset", "keyboard"] {
        let label = match id {
            "mouse" => "Mouse",
            "headset" => "Headset",
            _ => "Keyboard",
        };
        let Some(d) = devices.and_then(|arr| {
            arr.iter()
                .find(|x| x.get("id").and_then(|v| v.as_str()) == Some(id))
        }) else {
            continue;
        };
        let status = d.get("status").and_then(|v| v.as_str()).unwrap_or("");
        let bat = d.get("battery");
        let pct = bat.and_then(|b| b.get("percent")).and_then(|v| v.as_i64());
        let charging = bat
            .and_then(|b| b.get("charging"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if status == "connected" {
            if let Some(pc) = pct {
                parts.push(format!("{label} {pc}%"));
                if !charging {
                    if pc <= 10 && dot != Some("red") {
                        dot = Some("red");
                        why = Some(format!("{label} battery low"));
                    } else if pc <= 20 && dot.is_none() {
                        dot = Some("yellow");
                        why = Some(format!("{label} battery low"));
                    }
                }
            }
        } else if status == "asleep" {
            parts.push(format!("{label} asleep"));
        }
    }

    if dot.is_none() {
        if let Some(active) = s
            .get("auto")
            .and_then(|a| a.get("active"))
            .and_then(|v| v.as_str())
            .filter(|x| !x.is_empty())
        {
            dot = Some("green");
            why = Some(format!("{active} profile on"));
        }
    }

    let tip = format!(
        "DeviceHub{}  {}",
        why.map(|w| format!(" - {w}")).unwrap_or_default(),
        parts.join("  ")
    );
    update_tray_icon(hwnd, dot, &tip);
}

fn show_context_menu(hwnd: isize) {
    let state_snap = STATE.lock().unwrap().clone();
    let profiles: Vec<String> = api("/api/profiles", None)
        .and_then(|v| v.as_array().cloned())
        .map(|arr| {
            arr.into_iter()
                .filter_map(|p| p.get("name").and_then(|n| n.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let auto_switch = api("/api/settings", None)
        .and_then(|v| v.get("autoSwitch").and_then(|b| b.as_bool()))
        .unwrap_or(false);
    let gm = api("/api/gaming-mode", None);
    let gm_ok = gm
        .as_ref()
        .and_then(|v| v.get("ok"))
        .and_then(|b| b.as_bool())
        .unwrap_or(false);
    let gm_on = gm
        .as_ref()
        .and_then(|v| v.get("on"))
        .and_then(|b| b.as_bool())
        .unwrap_or(false);
    let replay_rec = api("/api/replay", None)
        .and_then(|v| v.get("phase").and_then(|p| p.as_str()).map(|s| s == "recording"))
        .unwrap_or(false);

    // SAFETY: Win32 window/tray/GDI call on valid HWND/HINSTANCE/resource with initialized structs.
    unsafe {
        let h_menu = CreatePopupMenu();
        let h_prof = CreatePopupMenu();
        AppendMenuW(h_menu, MF_STRING | MF_GRAYED, 0, to_wide("DeviceHub").as_ptr());
        if let Some(arr) = state_snap
            .as_ref()
            .and_then(|s| s.get("devices"))
            .and_then(|v| v.as_array())
        {
            for id in ["mouse", "headset", "keyboard"] {
                if let Some(d) = arr
                    .iter()
                    .find(|x| x.get("id").and_then(|v| v.as_str()) == Some(id))
                {
                    AppendMenuW(
                        h_menu,
                        MF_STRING | MF_GRAYED,
                        0,
                        to_wide(&device_line(d)).as_ptr(),
                    );
                }
            }
        }
        AppendMenuW(h_menu, MF_SEPARATOR, 0, std::ptr::null());
        AppendMenuW(h_menu, MF_STRING, 1, to_wide("Open DeviceHub").as_ptr());

        if profiles.is_empty() {
            AppendMenuW(
                h_prof,
                MF_STRING | MF_GRAYED,
                0,
                to_wide("No profiles yet").as_ptr(),
            );
        } else {
            for (idx, name) in profiles.iter().enumerate() {
                AppendMenuW(h_prof, MF_STRING, 100 + idx, to_wide(name).as_ptr());
            }
        }
        AppendMenuW(
            h_menu,
            MF_POPUP,
            h_prof as usize,
            to_wide("Apply profile").as_ptr(),
        );
        AppendMenuW(
            h_menu,
            MF_STRING | if auto_switch { MF_CHECKED } else { 0 },
            2,
            to_wide("Auto-switch for games").as_ptr(),
        );
        if gm_ok {
            AppendMenuW(
                h_menu,
                MF_STRING | if gm_on { MF_CHECKED } else { 0 },
                3,
                to_wide("Gaming mode").as_ptr(),
            );
        }
        if replay_rec {
            AppendMenuW(
                h_menu,
                MF_STRING,
                4,
                to_wide("Save replay (Record last)").as_ptr(),
            );
        }
        AppendMenuW(h_menu, MF_SEPARATOR, 0, std::ptr::null());
        AppendMenuW(h_menu, MF_STRING, 5, to_wide("Quit DeviceHub").as_ptr());

        let mut pt = POINT { x: 0, y: 0 };
        GetCursorPos(&mut pt);
        SetForegroundWindow(hwnd);
        let cmd = TrackPopupMenu(
            h_menu,
            TPM_RIGHTBUTTON | TPM_RETURNCMD,
            pt.x,
            pt.y,
            0,
            hwnd,
            std::ptr::null(),
        );
        DestroyMenu(h_prof);
        DestroyMenu(h_menu);

        match cmd {
            1 => open_app(),
            2 => {
                thread::spawn(|| {
                    if let Some(s) = api("/api/settings", None) {
                        let cur = s
                            .get("autoSwitch")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        let _ = api("/api/settings", Some(&json!({ "autoSwitch": !cur })));
                    }
                });
            }
            3 => {
                let target = !gm_on;
                thread::spawn(move || {
                    let r = api("/api/gaming-mode", Some(&json!({ "on": target })));
                    let title = if target {
                        "Gaming mode on"
                    } else {
                        "Gaming mode off"
                    };
                    if let Some(resp) = r {
                        if resp.get("on").and_then(|v| v.as_bool()) == Some(target) {
                            let msg = if target {
                                "Best performance, no sleep, instant replay on."
                            } else {
                                "Everything is back as it was."
                            };
                            post_balloon(title.into(), msg.into(), false);
                        } else {
                            let why = resp
                                .get("why")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Open DeviceHub to see why.");
                            post_balloon(format!("{title}: not done"), why.into(), true);
                        }
                    } else {
                        post_balloon(
                            format!("{title}: not done"),
                            "DeviceHub did not answer, or said no. Open DeviceHub to see why."
                                .into(),
                            true,
                        );
                    }
                });
            }
            4 => {
                thread::spawn(|| {
                    let r = api("/api/replay/save", Some(&json!({})));
                    if let Some(resp) = r {
                        if resp.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                            let file = resp
                                .get("file")
                                .and_then(|v| v.as_str())
                                .unwrap_or("OBS is writing it.");
                            post_balloon("Replay saved".into(), file.into(), false);
                        } else {
                            let why = resp
                                .get("why")
                                .and_then(|v| v.as_str())
                                .unwrap_or("Open DeviceHub to see why.");
                            post_balloon("Replay saved: not done".into(), why.into(), true);
                        }
                    } else {
                        post_balloon(
                            "Replay saved: not done".into(),
                            "DeviceHub did not answer, or said no. Open DeviceHub to see why."
                                .into(),
                            true,
                        );
                    }
                });
            }
            5 => {
                thread::spawn(|| {
                    let _ = api("/api/quit", Some(&json!({})));
                });
                PostMessageW(hwnd, WM_APP_STOP, 0, 0);
            }
            c if c >= 100 => {
                if let Some(name) = profiles.get((c - 100) as usize).cloned() {
                    thread::spawn(move || {
                        let r = api("/api/agent/apply-profile", Some(&json!({ "name": name })));
                        if let Some(resp) = r {
                            let done = resp.get("done").and_then(|v| v.as_i64()).unwrap_or(0);
                            let failed = resp.get("failed").and_then(|v| v.as_i64()).unwrap_or(0);
                            let skipped = resp.get("skipped").and_then(|v| v.as_i64()).unwrap_or(0);
                            let mut msg = format!("{done} changed");
                            if failed > 0 {
                                msg.push_str(&format!(", {failed} failed"));
                            }
                            if skipped > 0 {
                                msg.push_str(&format!(", {skipped} skipped (not connected)"));
                            }
                            post_balloon(format!("Profile \"{name}\""), msg, false);
                        } else {
                            post_balloon(
                                format!("Profile \"{name}\" not applied"),
                                "DeviceHub did not answer. Open DeviceHub to see why.".into(),
                                true,
                            );
                        }
                    });
                }
            }
            _ => {}
        }
    }
}

fn set_raw_listen(hwnd: isize, on: bool) {
    let cur = LISTENING_RAW.load(Ordering::SeqCst);
    if cur == on {
        return;
    }
    let dev = RAWINPUTDEVICE {
        us_usage_page: 1,
        us_usage: 2,
        dw_flags: if on { 0x100 } else { 0x1 },
        hwnd_target: if on { hwnd } else { 0 },
    };
    // SAFETY: Win32 window/tray/GDI call on valid HWND/HINSTANCE/resource with initialized structs.
    let ok = unsafe {
        RegisterRawInputDevices(&dev, 1, std::mem::size_of::<RAWINPUTDEVICE>() as u32) != 0
    };
    if ok {
        LISTENING_RAW.store(on, Ordering::SeqCst);
    }
}

// SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
unsafe extern "system" fn wnd_proc(
    hwnd: isize,
    msg: u32,
    w_param: usize,
    l_param: isize,
) -> isize {
    match msg {
        WM_INPUT => {
            if LISTENING_RAW.load(Ordering::SeqCst) {
                set_raw_listen(hwnd, false);
                crate::say("input EVT 00 1");
            }
            0
        }
        WM_DEVICECHANGE => {
            if w_param == 7 || w_param == 0x8000 || w_param == 0x8004 {
                crate::say("dev EVT 00 1");
            }
            1
        }
        WM_POWERBROADCAST => {
            if w_param == 4 {
                crate::say("power EVT 00 1");
            } else if w_param == 0x12 || w_param == 7 {
                crate::say("power EVT 01 1");
            }
            1
        }
        WM_TIMER => {
            spawn_refresh();
            0
        }
        WM_APP_WAKE => {
            set_raw_listen(hwnd, w_param != 0);
            0
        }
        WM_APP_REFRESH_DONE => {
            handle_refresh_done(hwnd);
            0
        }
        WM_APP_BALLOON => {
            if let Some((title, text, err)) = PENDING_BALLOON.lock().unwrap().take() {
                show_balloon(hwnd, &title, &text, err);
            }
            0
        }
        WM_APP_STOP => {
            let mut nid: NOTIFYICONDATAW = std::mem::zeroed();
            nid.cb_size = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
            nid.h_wnd = hwnd;
            nid.u_id = 1;
            Shell_NotifyIconW(NIM_DELETE, &nid);
            PostQuitMessage(0);
            0
        }
        WM_TRAY => {
            let ev = (l_param & 0xFFFF) as u32;
            if ev == WM_LBUTTONUP || ev == WM_LBUTTONDBLCLK {
                open_app();
            } else if ev == WM_RBUTTONUP || ev == WM_CONTEXTMENU {
                show_context_menu(hwnd);
            }
            0
        }
        WM_DESTROY => {
            let mut nid: NOTIFYICONDATAW = std::mem::zeroed();
            nid.cb_size = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
            nid.h_wnd = hwnd;
            nid.u_id = 1;
            Shell_NotifyIconW(NIM_DELETE, &nid);
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, msg, w_param, l_param),
    }
}

pub fn start(port: u16, folder: &str) -> String {
    if STARTED.swap(true, Ordering::SeqCst) {
        return "OK".into();
    }
    *CONFIG.lock().unwrap() = Some(TrayConfig {
        port,
        root: folder.to_string(),
    });
    let root = folder.to_string();
    // SAFETY: Win32 window/tray/GDI call on valid HWND/HINSTANCE/resource with initialized structs.
    thread::spawn(move || unsafe {
        let h_inst = GetModuleHandleW(std::ptr::null());
        let cls_name = to_wide("DeviceHubTrayWnd");
        let wc = WNDCLASSEXW {
            cb_size: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: 0,
            lpfn_wnd_proc: wnd_proc,
            cb_cls_extra: 0,
            cb_wnd_extra: 0,
            h_instance: h_inst,
            h_icon: 0,
            h_cursor: 0,
            h_br_background: 0,
            lpsz_menu_name: std::ptr::null(),
            lpsz_class_name: cls_name.as_ptr(),
            h_icon_sm: 0,
        };
        RegisterClassExW(&wc);
        let hwnd = CreateWindowExW(
            0,
            cls_name.as_ptr(),
            to_wide("DeviceHub").as_ptr(),
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            h_inst,
            std::ptr::null_mut(),
        );
        if hwnd == 0 {
            return;
        }
        HWND_VAL.store(hwnd, Ordering::SeqCst);

        let ico_path = Path::new(&root).join("DeviceHub.ico");
        let sm = GetSystemMetrics(49).max(16);
        let base_icon = LoadImageW(
            0,
            to_wide(&ico_path.to_string_lossy()).as_ptr(),
            IMAGE_ICON,
            sm,
            sm,
            LR_LOADFROMFILE | LR_DEFAULTSIZE,
        );
        *ICON_STATE.lock().unwrap() = Some(IconState {
            base_icon,
            dot_icon: 0,
            shown_dot: "none".into(),
            misses: 0,
        });

        let mut nid: NOTIFYICONDATAW = std::mem::zeroed();
        nid.cb_size = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
        nid.h_wnd = hwnd;
        nid.u_id = 1;
        nid.u_flags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
        nid.u_callback_message = WM_TRAY;
        nid.h_icon = base_icon;
        write_wide_fixed(&mut nid.sz_tip, "DeviceHub");
        Shell_NotifyIconW(NIM_ADD, &nid);

        SetTimer(hwnd, 1, 10000, std::ptr::null());
        spawn_refresh();

        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, 0, 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        HWND_VAL.store(0, Ordering::SeqCst);
    });
    "OK".into()
}

pub fn wake(on: bool) -> String {
    let hwnd = HWND_VAL.load(Ordering::SeqCst);
    if hwnd == 0 {
        return "NO".into();
    }
    // SAFETY: Win32 window/tray/GDI call on valid HWND/HINSTANCE/resource with initialized structs.
    unsafe { PostMessageW(hwnd, WM_APP_WAKE, if on { 1 } else { 0 }, 0) };
    "OK".into()
}

pub fn stop() {
    let hwnd = HWND_VAL.load(Ordering::SeqCst);
    if hwnd != 0 {
        // SAFETY: Win32 window/tray/GDI call on valid HWND/HINSTANCE/resource with initialized structs.
        unsafe { PostMessageW(hwnd, WM_APP_STOP, 0, 0) };
    }
}

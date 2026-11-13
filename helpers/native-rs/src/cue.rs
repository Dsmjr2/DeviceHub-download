use libloading::{Library, Symbol};
use serde_json::{json, Value};
use std::ffi::{c_char, c_void, CString};
use std::path::Path;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

static STATE: AtomicI32 = AtomicI32::new(0);
static CUE: Mutex<Option<CueApi>> = Mutex::new(None);

#[link(name = "kernel32")]
extern "system" {
    fn SetDllDirectoryW(lpPathName: *const u16) -> i32;
}

type StateHandler = unsafe extern "C" fn(*mut c_void, *const i32);
type FnConnect = unsafe extern "C" fn(StateHandler, *mut c_void) -> i32;
type FnGetInfo = unsafe extern "C" fn(*const c_char, i32, u32, *mut i32, *mut u32) -> i32;
type FnReadProp = unsafe extern "C" fn(*const c_char, i32, u32, *mut u8) -> i32;
type FnWriteProp = unsafe extern "C" fn(*const c_char, i32, u32, *const u8) -> i32;
type FnFreeProp = unsafe extern "C" fn(*mut u8) -> i32;

struct CueApi {
    _lib: Library,
    get_info: FnGetInfo,
    read_prop: FnReadProp,
    write_prop: FnWriteProp,
    free_prop: FnFreeProp,
}

unsafe impl Send for CueApi {}

// SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
unsafe extern "C" fn on_state(_ctx: *mut c_void, evt: *const i32) {
    if !evt.is_null() {
        STATE.store(*evt, Ordering::SeqCst);
    }
}

fn prop_name(prop: i32) -> &'static str {
    match prop {
        2 => "micEnabled",
        3 => "surroundEnabled",
        4 => "sidetoneEnabled",
        5 => "equalizerPreset",
        9 => "batteryLevel",
        _ => "unknown",
    }
}

pub fn ensure(dll_path: Option<&str>) -> bool {
    let mut guard = CUE.lock().unwrap();
    if guard.is_none() {
        let Some(dll) = dll_path else {
            return false;
        };
        if let Some(dir) = Path::new(dll).parent() {
            let mut wide: Vec<u16> = dir.to_string_lossy().encode_utf16().collect();
            wide.push(0);
            // SAFETY: Dynamic library/symbol lookup and FFI invocation using null-terminated names and ABI-matched signatures.
            unsafe { SetDllDirectoryW(wide.as_ptr()) };
        }
        // SAFETY: Dynamic library/symbol lookup and FFI invocation using null-terminated names and ABI-matched signatures.
        let Ok(lib) = (unsafe { Library::new(dll) }) else {
            return false;
        };
        // SAFETY: Win32/COM FFI call with valid pointers, handles, and initialized buffers.
        unsafe {
            let Ok(connect): Result<Symbol<FnConnect>, _> = lib.get(b"CorsairConnect\0") else {
                return false;
            };
            let Ok(get_info): Result<Symbol<FnGetInfo>, _> = lib.get(b"CorsairGetDevicePropertyInfo\0")
            else {
                return false;
            };
            let Ok(read_prop): Result<Symbol<FnReadProp>, _> = lib.get(b"CorsairReadDeviceProperty\0")
            else {
                return false;
            };
            let Ok(write_prop): Result<Symbol<FnWriteProp>, _> =
                lib.get(b"CorsairWriteDeviceProperty\0")
            else {
                return false;
            };
            let Ok(free_prop): Result<Symbol<FnFreeProp>, _> = lib.get(b"CorsairFreeProperty\0")
            else {
                return false;
            };

            connect(on_state, std::ptr::null_mut());
            let api = CueApi {
                get_info: *get_info,
                read_prop: *read_prop,
                write_prop: *write_prop,
                free_prop: *free_prop,
                _lib: lib,
            };
            *guard = Some(api);
        }
        drop(guard);
        for _ in 0..200 {
            if STATE.load(Ordering::SeqCst) == 6 {
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
    }
    STATE.load(Ordering::SeqCst) == 6
}

fn read_prop_with(api: &CueApi, id: &str, prop: i32) -> Option<Value> {
    let c_id = CString::new(id).ok()?;
    let mut data_type: i32 = 0;
    let mut flags: u32 = 0;
    // SAFETY: Dynamic library/symbol lookup and FFI invocation using null-terminated names and ABI-matched signatures.
    let rc = unsafe { (api.get_info)(c_id.as_ptr(), prop, 0, &mut data_type, &mut flags) };
    if rc != 0 {
        return None;
    }
    let can_read = (flags & 1) != 0;
    let can_write = (flags & 2) != 0;
    let mut obj = json!({
        "prop": prop,
        "name": prop_name(prop),
        "type": data_type,
        "canRead": can_read,
        "canWrite": can_write,
        "value": Value::Null,
    });
    if !can_read {
        return Some(obj);
    }
    let mut buf = [0u8; 24];
    // SAFETY: Dynamic library/symbol lookup and FFI invocation using null-terminated names and ABI-matched signatures.
    let e = unsafe { (api.read_prop)(c_id.as_ptr(), prop, 0, buf.as_mut_ptr()) };
    if e == 0 {
        let ty = i32::from_le_bytes(buf[0..4].try_into().unwrap());
        let val = match ty {
            0 => Value::Bool(buf[8] != 0),
            1 => Value::from(i32::from_le_bytes(buf[8..12].try_into().unwrap())),
            2 => Value::from(f64::from_le_bytes(buf[8..16].try_into().unwrap())),
            _ => Value::Null,
        };
        obj["value"] = val;
        // SAFETY: Dynamic library/symbol lookup and FFI invocation using null-terminated names and ABI-matched signatures.
        unsafe { (api.free_prop)(buf.as_mut_ptr()) };
    } else {
        obj["error"] = Value::from(e);
    }
    Some(obj)
}

pub fn handle(dll_path: Option<&str>, rest: &str) -> Result<String, String> {
    let q: Value = serde_json::from_str(rest).map_err(|e| e.to_string())?;
    let op = q.get("op").and_then(|v| v.as_str()).unwrap_or("");
    if !ensure(dll_path) {
        return Ok(
            json!({ "ok": false, "error": "iCUE SDK not connected (is iCUE running?)" })
                .to_string(),
        );
    }
    let guard = CUE.lock().unwrap();
    let api = guard.as_ref().ok_or("iCUE SDK not loaded")?;
    let id = q.get("id").and_then(|v| v.as_str()).unwrap_or("");
    match op {
        "props" => {
            let props: Vec<Value> = [2, 3, 4, 5, 9]
                .iter()
                .filter_map(|&k| read_prop_with(api, id, k))
                .collect();
            Ok(json!({ "ok": true, "props": props }).to_string())
        }
        "write" => {
            let prop = q.get("prop").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            let value = q.get("value").ok_or("missing value")?;
            let info = read_prop_with(api, id, prop)
                .ok_or_else(|| format!("property {prop} not supported"))?;
            if !info["canWrite"].as_bool().unwrap_or(false) {
                return Err(format!(
                    "property {} is read-only on this device",
                    prop_name(prop)
                ));
            }
            let ty = info["type"].as_i64().unwrap_or(-1) as i32;
            let mut buf = [0u8; 24];
            buf[0..4].copy_from_slice(&ty.to_le_bytes());
            match ty {
                0 => {
                    let b = value.as_bool().unwrap_or_else(|| value.as_i64().unwrap_or(0) != 0);
                    buf[8] = if b { 1 } else { 0 };
                }
                1 => {
                    let n = value
                        .as_i64()
                        .ok_or_else(|| "expected integer value".to_string())?
                        as i32;
                    buf[8..12].copy_from_slice(&n.to_le_bytes());
                }
                _ => return Err(format!("unsupported type {ty}")),
            }
            let c_id = CString::new(id).map_err(|e| e.to_string())?;
            // SAFETY: Dynamic library/symbol lookup and FFI invocation using null-terminated names and ABI-matched signatures.
            let e = unsafe { (api.write_prop)(c_id.as_ptr(), prop, 0, buf.as_ptr()) };
            if e != 0 {
                return Err(format!("iCUE refused the write (error {e})"));
            }
            let after = read_prop_with(api, id, prop).ok_or("readback failed")?;
            if after["value"] != *value {
                return Err(format!(
                    "headset reports {} after writing {}",
                    after["value"], value
                ));
            }
            Ok(json!({ "ok": true, "prop": after }).to_string())
        }
        _ => Ok(json!({ "ok": false, "error": format!("unknown op {op}") }).to_string()),
    }
}

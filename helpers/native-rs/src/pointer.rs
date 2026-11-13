use serde_json::{json, Value};
use std::ffi::c_void;

#[link(name = "user32")]
extern "system" {
    fn SystemParametersInfoW(uiAction: u32, uiParam: u32, pvParam: *mut c_void, fWinIni: u32)
        -> i32;
    fn GetDoubleClickTime() -> u32;
}

const SAVE: u32 = 3; // SPIF_UPDATEINIFILE | SPIF_SENDCHANGE

fn speed() -> i32 {
    let mut v: i32 = 0;
    // SAFETY: Win32 pointer/mouse SPI call with valid primitive or fixed-size array buffer.
    unsafe { SystemParametersInfoW(0x70, 0, &mut v as *mut i32 as *mut c_void, 0) };
    v
}

fn accel() -> [i32; 3] {
    let mut a = [0i32; 3];
    // SAFETY: Win32 pointer/mouse SPI call with valid primitive or fixed-size array buffer.
    unsafe { SystemParametersInfoW(0x03, 0, a.as_mut_ptr() as *mut c_void, 0) };
    a
}

fn lines() -> i32 {
    let mut v: i32 = 0;
    // SAFETY: Win32 pointer/mouse SPI call with valid primitive or fixed-size array buffer.
    unsafe { SystemParametersInfoW(0x68, 0, &mut v as *mut i32 as *mut c_void, 0) };
    v
}

pub fn read() -> Value {
    let l = lines();
    // SAFETY: Win32 pointer/mouse SPI call with valid primitive or fixed-size array buffer.
    let dbl = unsafe { GetDoubleClickTime() };
    json!({
        "ok": true,
        "speed": speed(),
        "precision": accel()[2] != 0,
        "scrollLines": if l == -1 || l > 100 { -1 } else { l },
        "doubleClick": dbl as i32,
    })
}

pub fn set(key: &str, v: i32) -> Result<Value, String> {
    let ok = match key {
        "speed" => {
            if !(1..=20).contains(&v) {
                return Err("speed 1-20".into());
            }
            // SAFETY: Win32 pointer/mouse SPI call with valid primitive or fixed-size array buffer.
            unsafe { SystemParametersInfoW(0x71, 0, v as usize as *mut c_void, SAVE) != 0 }
        }
        "precision" => {
            let mut arr = if v != 0 { [6i32, 10, 1] } else { [0i32, 0, 0] };
            // SAFETY: Win32 pointer/mouse SPI call with valid primitive or fixed-size array buffer.
            unsafe { SystemParametersInfoW(0x04, 0, arr.as_mut_ptr() as *mut c_void, SAVE) != 0 }
        }
        "scrollLines" => {
            if v != -1 && !(1..=100).contains(&v) {
                return Err("lines 1-100 or -1".into());
            }
            // SAFETY: Win32 pointer/mouse SPI call with valid primitive or fixed-size array buffer.
            unsafe { SystemParametersInfoW(0x69, v as u32, std::ptr::null_mut(), SAVE) != 0 }
        }
        "doubleClick" => {
            if !(200..=900).contains(&v) {
                return Err("200-900 ms".into());
            }
            // SAFETY: Win32 pointer/mouse SPI call with valid primitive or fixed-size array buffer.
            unsafe { SystemParametersInfoW(0x20, v as u32, std::ptr::null_mut(), SAVE) != 0 }
        }
        _ => return Err(format!("unknown setting {key}")),
    };
    if !ok {
        return Err("Windows refused".into());
    }
    Ok(read())
}

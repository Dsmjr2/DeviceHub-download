use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::sync::Mutex;
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
struct VARIANT {
    vt: u16,
    r1: u16,
    r2: u16,
    r3: u16,
    data: usize,
    data2: usize,
}

const CLSID_SYSTEM_DEVICE_ENUM: GUID = GUID {
    data1: 0x62BE_5D10,
    data2: 0x60EB,
    data3: 0x11D0,
    data4: [0xBD, 0x3B, 0x00, 0xA0, 0xC9, 0x11, 0xCE, 0x86],
};
const CLSID_VIDEO_INPUT_CATEGORY: GUID = GUID {
    data1: 0x860B_B310,
    data2: 0x5D01,
    data3: 0x11D0,
    data4: [0xBD, 0x3B, 0x00, 0xA0, 0xC9, 0x11, 0xCE, 0x86],
};
const IID_ICREATE_DEV_ENUM: GUID = GUID {
    data1: 0x2984_0822,
    data2: 0x5B84,
    data3: 0x11D0,
    data4: [0xBD, 0x3B, 0x00, 0xA0, 0xC9, 0x11, 0xCE, 0x86],
};
const IID_IPROPERTY_BAG: GUID = GUID {
    data1: 0x5527_2A00,
    data2: 0x42CB,
    data3: 0x11CE,
    data4: [0x81, 0x35, 0x00, 0xAA, 0x00, 0x4B, 0xB8, 0x51],
};
const IID_IBASE_FILTER: GUID = GUID {
    data1: 0x56A8_6895,
    data2: 0x0AD4,
    data3: 0x11CE,
    data4: [0xB0, 0x3A, 0x00, 0x20, 0xAF, 0x0B, 0xA7, 0x70],
};
const IID_IAM_VIDEO_PROC_AMP: GUID = GUID {
    data1: 0xC6E1_3360,
    data2: 0x30AC,
    data3: 0x11D0,
    data4: [0xA1, 0x8C, 0x00, 0xA0, 0xC9, 0x11, 0x89, 0x56],
};
const IID_IAM_CAMERA_CONTROL: GUID = GUID {
    data1: 0xC6E1_3370,
    data2: 0x30AC,
    data3: 0x11D0,
    data4: [0xA1, 0x8C, 0x00, 0xA0, 0xC9, 0x11, 0x89, 0x56],
};

#[link(name = "ole32")]
extern "system" {
    fn CoInitializeEx(pv_reserved: *mut c_void, dw_co_init: u32) -> i32;
    fn CoCreateInstance(
        rclsid: *const GUID,
        p_unk_outer: *mut c_void,
        dw_cls_context: u32,
        riid: *const GUID,
        ppv: *mut *mut c_void,
    ) -> i32;
}

#[link(name = "oleaut32")]
extern "system" {
    fn VariantClear(pvarg: *mut VARIANT) -> i32;
}

#[repr(C)]
struct IUnknownVtbl {
    query_interface: unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> i32,
    add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    release: unsafe extern "system" fn(*mut c_void) -> u32,
}

#[repr(C)]
struct ICreateDevEnumVtbl {
    unk: IUnknownVtbl,
    create_class_enumerator:
        // SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
        unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void, u32) -> i32,
}

#[repr(C)]
struct IEnumMonikerVtbl {
    unk: IUnknownVtbl,
    next: unsafe extern "system" fn(*mut c_void, u32, *mut *mut c_void, *mut u32) -> i32,
}

// IMoniker: IUnknown (3) + IPersist (1) + IPersistStream (4) + BindToObject (8) + BindToStorage (9)
#[repr(C)]
struct IMonikerVtbl {
    unk: IUnknownVtbl,
    get_class_id: *const c_void,
    is_dirty: *const c_void,
    load: *const c_void,
    save: *const c_void,
    get_size_max: *const c_void,
    bind_to_object: unsafe extern "system" fn(
        *mut c_void,
        *mut c_void,
        *mut c_void,
        *const GUID,
        *mut *mut c_void,
    ) -> i32,
    bind_to_storage: unsafe extern "system" fn(
        *mut c_void,
        *mut c_void,
        *mut c_void,
        *const GUID,
        *mut *mut c_void,
    ) -> i32,
}

#[repr(C)]
struct IPropertyBagVtbl {
    unk: IUnknownVtbl,
    read: unsafe extern "system" fn(*mut c_void, *const u16, *mut VARIANT, *mut c_void) -> i32,
}

#[repr(C)]
struct CamControlVtbl {
    unk: IUnknownVtbl,
    get_range: unsafe extern "system" fn(
        *mut c_void,
        i32,
        *mut i32,
        *mut i32,
        *mut i32,
        *mut i32,
        *mut i32,
    ) -> i32,
    set: unsafe extern "system" fn(*mut c_void, i32, i32, i32) -> i32,
    get: unsafe extern "system" fn(*mut c_void, i32, *mut i32, *mut i32) -> i32,
}

// SAFETY: Caller must pass valid, non-dangling COM/Win32 pointers with matching lifetimes.
unsafe fn vtbl<T>(obj: *mut c_void) -> &'static T {
    &**(obj as *const *const T)
}

// SAFETY: Caller must pass valid, non-dangling COM/Win32 pointers with matching lifetimes.
unsafe fn release(obj: *mut c_void) {
    if !obj.is_null() {
        (vtbl::<IUnknownVtbl>(obj).release)(obj);
    }
}

// SAFETY: Caller must pass valid, non-dangling COM/Win32 pointers with matching lifetimes.
unsafe fn read_bag_str(bag: *mut c_void, name: &str) -> Option<String> {
    let mut w: Vec<u16> = name.encode_utf16().collect();
    w.push(0);
    let mut var: VARIANT = std::mem::zeroed();
    let hr = (vtbl::<IPropertyBagVtbl>(bag).read)(bag, w.as_ptr(), &mut var, std::ptr::null_mut());
    if hr != 0 {
        return None;
    }
    let res = if var.vt == 8 && var.data != 0 {
        // VT_BSTR: length in bytes at ptr - 4
        let ptr = var.data as *const u16;
        let mut len = 0usize;
        while *ptr.add(len) != 0 {
            len += 1;
        }
        Some(String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len)))
    } else {
        None
    };
    VariantClear(&mut var);
    res
}

const CONTROLS: &[(&str, u8, i32)] = &[
    ("brightness", 0, 0),
    ("contrast", 0, 1),
    ("saturation", 0, 3),
    ("sharpness", 0, 4),
    ("gamma", 0, 5),
    ("whiteBalance", 0, 7),
    ("backlight", 0, 8),
    ("gain", 0, 9),
    ("zoom", 1, 3),
    ("exposure", 1, 4),
    ("focus", 1, 6),
];

const AUTO: i32 = 1;
const MANUAL: i32 = 2;

struct BoundFilter(*mut c_void);
unsafe impl Send for BoundFilter {}

struct CamCache {
    bound: HashMap<String, BoundFilter>,
    last_use: Instant,
    idle_started: bool,
}

static CACHE: Mutex<Option<CamCache>> = Mutex::new(None);

fn drop_all(bound: &mut HashMap<String, BoundFilter>) {
    for (_, bf) in bound.drain() {
        // SAFETY: COM apartment is initialized and interface pointers/vtable slots follow Windows ABI.
        unsafe { release(bf.0) };
    }
}

fn touch_idle(cache: &mut CamCache) {
    cache.last_use = Instant::now();
    if !cache.idle_started {
        cache.idle_started = true;
        thread::spawn(|| loop {
            thread::sleep(Duration::from_secs(15));
            let mut guard = CACHE.lock().unwrap();
            if let Some(c) = guard.as_mut() {
                if !c.bound.is_empty() && c.last_use.elapsed() > Duration::from_secs(30) {
                    drop_all(&mut c.bound);
                }
            }
        });
    }
}

// SAFETY: Caller must pass valid, non-dangling COM/Win32 pointers with matching lifetimes.
unsafe fn open_cameras(cache: &mut CamCache) -> Result<Vec<(String, *mut c_void)>, String> {
    CoInitializeEx(std::ptr::null_mut(), 0); // COINIT_MULTITHREADED
    let mut de: *mut c_void = std::ptr::null_mut();
    let hr = CoCreateInstance(
        &CLSID_SYSTEM_DEVICE_ENUM,
        std::ptr::null_mut(),
        1, // CLSCTX_INPROC_SERVER
        &IID_ICREATE_DEV_ENUM,
        &mut de,
    );
    if hr != 0 || de.is_null() {
        return Err(format!("CoCreateInstance failed 0x{hr:08X}"));
    }

    let mut list = Vec::new();
    let mut seen = HashSet::new();
    let mut em: *mut c_void = std::ptr::null_mut();
    let hr_em =
        (vtbl::<ICreateDevEnumVtbl>(de).create_class_enumerator)(de, &CLSID_VIDEO_INPUT_CATEGORY, &mut em, 0);
    if hr_em == 0 && !em.is_null() {
        loop {
            let mut m: *mut c_void = std::ptr::null_mut();
            let mut fetched: u32 = 0;
            if (vtbl::<IEnumMonikerVtbl>(em).next)(em, 1, &mut m, &mut fetched) != 0 || m.is_null() {
                break;
            }
            let mut bag: *mut c_void = std::ptr::null_mut();
            if (vtbl::<IMonikerVtbl>(m).bind_to_storage)(
                m,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &IID_IPROPERTY_BAG,
                &mut bag,
            ) == 0
                && !bag.is_null()
            {
                let name = read_bag_str(bag, "FriendlyName").unwrap_or_else(|| "Camera".into());
                let path = read_bag_str(bag, "DevicePath").unwrap_or_default();
                release(bag);
                let key = format!("{name}|{path}");
                seen.insert(key.clone());
                if let Some(bf) = cache.bound.get(&key) {
                    list.push((key, bf.0));
                } else {
                    let mut filter: *mut c_void = std::ptr::null_mut();
                    if (vtbl::<IMonikerVtbl>(m).bind_to_object)(
                        m,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        &IID_IBASE_FILTER,
                        &mut filter,
                    ) == 0
                        && !filter.is_null()
                    {
                        cache.bound.insert(key.clone(), BoundFilter(filter));
                        list.push((key, filter));
                    }
                }
            }
            release(m);
        }
        release(em);
    }
    release(de);

    let gone: Vec<String> = cache
        .bound
        .keys()
        .filter(|k| !seen.contains(*k))
        .cloned()
        .collect();
    for k in gone {
        if let Some(bf) = cache.bound.remove(&k) {
            release(bf.0);
        }
    }
    Ok(list)
}

// SAFETY: Caller must pass valid, non-dangling COM/Win32 pointers with matching lifetimes.
unsafe fn query_iface(filter: *mut c_void, iid: &GUID) -> *mut c_void {
    let mut out: *mut c_void = std::ptr::null_mut();
    if (vtbl::<IUnknownVtbl>(filter).query_interface)(filter, iid, &mut out) == 0 {
        out
    } else {
        std::ptr::null_mut()
    }
}

// SAFETY: Caller must pass valid, non-dangling COM/Win32 pointers with matching lifetimes.
unsafe fn read_controls(filter: *mut c_void) -> Map<String, Value> {
    let mut o = Map::new();
    let amp = query_iface(filter, &IID_IAM_VIDEO_PROC_AMP);
    let cam = query_iface(filter, &IID_IAM_CAMERA_CONTROL);

    for &(name, kind, prop) in CONTROLS {
        let iface = if kind == 0 { amp } else { cam };
        if iface.is_null() {
            continue;
        }
        let vt = vtbl::<CamControlVtbl>(iface);
        let (mut min, mut max, mut step, mut def, mut caps, mut val, mut flags) =
            (0i32, 0i32, 0i32, 0i32, 0i32, 0i32, 0i32);
        if (vt.get_range)(iface, prop, &mut min, &mut max, &mut step, &mut def, &mut caps) != 0 {
            continue;
        }
        if (vt.get)(iface, prop, &mut val, &mut flags) != 0 {
            continue;
        }
        if max <= min {
            continue;
        }
        o.insert(
            name.into(),
            json!({
                "value": val,
                "min": min,
                "max": max,
                "step": step,
                "default": def,
                "canAuto": (caps & AUTO) != 0,
                "auto": (flags & AUTO) != 0,
            }),
        );
    }

    release(amp);
    release(cam);
    o
}

pub fn list() -> Result<Value, String> {
    let mut guard = CACHE.lock().unwrap();
    let cache = guard.get_or_insert_with(|| CamCache {
        bound: HashMap::new(),
        last_use: Instant::now(),
        idle_started: false,
    });
    // SAFETY: COM apartment is initialized and interface pointers/vtable slots follow Windows ABI.
    let res = unsafe { open_cameras(cache) };
    let cams = match res {
        Ok(c) => c,
        Err(e) => {
            drop_all(&mut cache.bound);
            return Err(e);
        }
    };
    let mut out = Vec::new();
    for (key, filter) in cams {
        let (name, path) = key.split_once('|').unwrap_or((&key, ""));
        // SAFETY: COM apartment is initialized and interface pointers/vtable slots follow Windows ABI.
        let controls = unsafe { read_controls(filter) };
        out.push(json!({
            "name": name,
            "path": path,
            "controls": controls,
        }));
    }
    touch_idle(cache);
    Ok(Value::Array(out))
}

pub fn set(path: &str, key: &str, value: i32, auto: bool) -> Result<Value, String> {
    let ctl = CONTROLS
        .iter()
        .find(|c| c.0 == key)
        .ok_or_else(|| format!("unknown control {key}"))?;

    let mut guard = CACHE.lock().unwrap();
    let cache = guard.get_or_insert_with(|| CamCache {
        bound: HashMap::new(),
        last_use: Instant::now(),
        idle_started: false,
    });
    // SAFETY: COM apartment is initialized and interface pointers/vtable slots follow Windows ABI.
    let cams = match unsafe { open_cameras(cache) } {
        Ok(c) => c,
        Err(e) => {
            drop_all(&mut cache.bound);
            return Err(e);
        }
    };
    for (k, filter) in cams {
        let (_, p) = k.split_once('|').unwrap_or((&k, ""));
        if p != path {
            continue;
        }
        // SAFETY: Win32/COM FFI call with valid pointers, handles, and initialized buffers.
        unsafe {
            let iface = if ctl.1 == 0 {
                query_iface(filter, &IID_IAM_VIDEO_PROC_AMP)
            } else {
                query_iface(filter, &IID_IAM_CAMERA_CONTROL)
            };
            if iface.is_null() {
                touch_idle(cache);
                return Err(if ctl.1 == 0 {
                    "no picture controls".into()
                } else {
                    "no lens controls".into()
                });
            }
            let hr = (vtbl::<CamControlVtbl>(iface).set)(
                iface,
                ctl.2,
                value,
                if auto { AUTO } else { MANUAL },
            );
            release(iface);
            if hr != 0 {
                touch_idle(cache);
                return Err(format!("the camera refused {key} (0x{hr:08X})"));
            }
            let after = read_controls(filter);
            touch_idle(cache);
            return Ok(json!({ "ok": true, "controls": after }));
        }
    }
    touch_idle(cache);
    Err("camera not found".into())
}

pub fn handle(rest: &str) -> Result<String, String> {
    let q: Value = serde_json::from_str(rest).map_err(|e| e.to_string())?;
    let op = q.get("op").and_then(|v| v.as_str()).unwrap_or("");
    match op {
        "cameras" => Ok(json!({ "ok": true, "cameras": list()? }).to_string()),
        "camera-set" => {
            let path = q.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let key = q.get("key").and_then(|v| v.as_str()).unwrap_or("");
            let value = q.get("value").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            let auto = q.get("auto").and_then(|v| v.as_bool()).unwrap_or(false);
            Ok(set(path, key, value, auto)?.to_string())
        }
        _ => Ok(json!({ "ok": false, "error": "unknown camera op" }).to_string()),
    }
}

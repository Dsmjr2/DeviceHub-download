use std::collections::HashSet;
use std::ffi::c_void;
use std::path::Path;
use std::sync::Mutex;

#[repr(C)]
#[derive(Clone, Copy)]
struct GUID {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

#[repr(C)]
struct PROPERTYKEY {
    fmtid: GUID,
    pid: u32,
}

#[repr(C)]
struct PROPVARIANT {
    vt: u16,
    r1: u16,
    r2: u16,
    r3: u16,
    p: *mut c_void,
    p2: *mut c_void,
}

#[repr(C)]
struct IPropertyStoreVtbl {
    query_interface: unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> i32,
    add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    release: unsafe extern "system" fn(*mut c_void) -> u32,
    get_count: unsafe extern "system" fn(*mut c_void, *mut u32) -> i32,
    get_at: unsafe extern "system" fn(*mut c_void, u32, *mut PROPERTYKEY) -> i32,
    get_value: unsafe extern "system" fn(*mut c_void, *const PROPERTYKEY, *mut PROPVARIANT) -> i32,
    set_value: unsafe extern "system" fn(*mut c_void, *const PROPERTYKEY, *const PROPVARIANT) -> i32,
    commit: unsafe extern "system" fn(*mut c_void) -> i32,
}

#[repr(C)]
struct IPropertyStore {
    vtbl: *const IPropertyStoreVtbl,
}

const IID_IPROPERTYSTORE: GUID = GUID {
    data1: 0x886D_8EEB,
    data2: 0x8CF2,
    data3: 0x4446,
    data4: [0x8D, 0x02, 0xCD, 0xBA, 0x1D, 0xBD, 0xCF, 0x99],
};

const AUMI: GUID = GUID {
    data1: 0x9F4C_2855,
    data2: 0x9F79,
    data3: 0x4B39,
    data4: [0xA8, 0xD0, 0xE1, 0xD4, 0x2D, 0xE1, 0xD5, 0xF3],
};

const WM_SETICON: u32 = 0x80;
const IMAGE_ICON: u32 = 1;
const LR_LOADFROMFILE: u32 = 0x10;
const GW_OWNER: u32 = 4;

type EnumWindowsProc = unsafe extern "system" fn(isize, isize) -> i32;

#[link(name = "user32")]
extern "system" {
    fn EnumWindows(lp_enum_func: EnumWindowsProc, l_param: isize) -> i32;
    fn IsWindowVisible(hwnd: isize) -> i32;
    fn GetWindow(hwnd: isize, u_cmd: u32) -> isize;
    fn GetClassNameW(hwnd: isize, lp_class_name: *mut u16, n_max_count: i32) -> i32;
    fn GetWindowTextW(hwnd: isize, lp_string: *mut u16, n_max_count: i32) -> i32;
    fn SendMessageW(hwnd: isize, msg: u32, w_param: usize, l_param: isize) -> isize;
    fn LoadImageW(
        h_inst: isize,
        name: *const u16,
        ty: u32,
        cx: i32,
        cy: i32,
        fu_load: u32,
    ) -> isize;
    fn GetSystemMetrics(n_index: i32) -> i32;
}

#[link(name = "shell32")]
extern "system" {
    fn SHGetPropertyStoreForWindow(
        hwnd: isize,
        riid: *const GUID,
        ppv: *mut *mut IPropertyStore,
    ) -> i32;
}

#[link(name = "ole32")]
extern "system" {
    fn CoTaskMemAlloc(cb: usize) -> *mut c_void;
    #[allow(clashing_extern_declarations)]
    fn PropVariantClear(pvar: *mut PROPVARIANT) -> i32;
}

struct BrandState {
    done: HashSet<isize>,
    big_icon: isize,
    small_icon: isize,
}

static STATE: Mutex<Option<BrandState>> = Mutex::new(None);

// SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
unsafe extern "system" fn enum_cb(hwnd: isize, lparam: isize) -> i32 {
    if IsWindowVisible(hwnd) == 0 || GetWindow(hwnd, GW_OWNER) != 0 {
        return 1;
    }
    let mut cls = [0u16; 64];
    let clen = GetClassNameW(hwnd, cls.as_mut_ptr(), 64).max(0) as usize;
    let cls_s = String::from_utf16_lossy(&cls[..clen]);
    if !cls_s.starts_with("Chrome_WidgetWin") {
        return 1;
    }
    let mut t = [0u16; 256];
    let tlen = GetWindowTextW(hwnd, t.as_mut_ptr(), 256).max(0) as usize;
    let title = String::from_utf16_lossy(&t[..tlen]);
    if title == "DeviceHub" || title.ends_with(" \u{00B7} DeviceHub") {
        let found = &mut *(lparam as *mut Vec<isize>);
        found.push(hwnd);
    }
    1
}

// SAFETY: Caller must pass valid, non-dangling COM/Win32 pointers with matching lifetimes.
unsafe fn set_prop(ps: *mut IPropertyStore, pid: u32, value: &str) {
    let mut wide: Vec<u16> = value.encode_utf16().collect();
    wide.push(0);
    let bytes = wide.len() * 2;
    let mem = CoTaskMemAlloc(bytes) as *mut u16;
    if mem.is_null() {
        return;
    }
    std::ptr::copy_nonoverlapping(wide.as_ptr(), mem, wide.len());
    let k = PROPERTYKEY { fmtid: AUMI, pid };
    let mut v = PROPVARIANT {
        vt: 31, // VT_LPWSTR
        r1: 0,
        r2: 0,
        r3: 0,
        p: mem as *mut c_void,
        p2: std::ptr::null_mut(),
    };
    ((*(*ps).vtbl).set_value)(ps as *mut c_void, &k, &v);
    PropVariantClear(&mut v);
}

fn ico_hash(ico: &str) -> Option<&str> {
    let fname = Path::new(ico).file_name()?.to_str()?;
    let rest = fname.strip_prefix("DeviceHub-")?.strip_suffix(".ico")?;
    if !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_hexdigit()) {
        Some(rest)
    } else {
        None
    }
}

pub fn brand(ico: &str, relaunch: &str) -> String {
    let mut found = Vec::<isize>::new();
    // SAFETY: Win32 window/tray/GDI call on valid HWND/HINSTANCE/resource with initialized structs.
    unsafe {
        EnumWindows(enum_cb, (&mut found as *mut Vec<isize>) as isize);
    }

    let mut guard = STATE.lock().unwrap();
    let st = guard.get_or_insert_with(|| BrandState {
        done: HashSet::new(),
        big_icon: 0,
        small_icon: 0,
    });

    let mut ico_w: Vec<u16> = ico.encode_utf16().collect();
    ico_w.push(0);
    if st.big_icon == 0 {
        // SAFETY: Win32 window/tray/GDI call on valid HWND/HINSTANCE/resource with initialized structs.
        st.big_icon = unsafe {
            LoadImageW(
                0,
                ico_w.as_ptr(),
                IMAGE_ICON,
                GetSystemMetrics(11),
                GetSystemMetrics(12),
                LR_LOADFROMFILE,
            )
        };
    }
    if st.small_icon == 0 {
        // SAFETY: Win32 window/tray/GDI call on valid HWND/HINSTANCE/resource with initialized structs.
        st.small_icon = unsafe {
            LoadImageW(
                0,
                ico_w.as_ptr(),
                IMAGE_ICON,
                GetSystemMetrics(49),
                GetSystemMetrics(50),
                LR_LOADFROMFILE,
            )
        };
    }

    let mut n = 0;
    let aumid = match ico_hash(ico) {
        Some(h) => format!("DeviceHub.{h}"),
        None => "DeviceHub".to_string(),
    };
    let icon_res = format!("{ico},0");

    for hwnd in found {
        if st.done.contains(&hwnd) {
            continue;
        }
        // SAFETY: Win32 window/tray/GDI call on valid HWND/HINSTANCE/resource with initialized structs.
        unsafe {
            if st.big_icon != 0 {
                SendMessageW(hwnd, WM_SETICON, 1, st.big_icon);
            }
            if st.small_icon != 0 {
                SendMessageW(hwnd, WM_SETICON, 0, st.small_icon);
            }
            let mut ps: *mut IPropertyStore = std::ptr::null_mut();
            if SHGetPropertyStoreForWindow(hwnd, &IID_IPROPERTYSTORE, &mut ps) != 0 || ps.is_null() {
                continue;
            }
            set_prop(ps, 5, &aumid);
            set_prop(ps, 3, &icon_res);
            set_prop(ps, 4, "DeviceHub");
            set_prop(ps, 2, relaunch);
            ((*(*ps).vtbl).commit)(ps as *mut c_void);
            ((*(*ps).vtbl).release)(ps as *mut c_void);
        }
        st.done.insert(hwnd);
        n += 1;
    }
    n.to_string()
}

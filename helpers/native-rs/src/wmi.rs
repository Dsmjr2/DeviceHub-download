use crate::audio_com::{release, vtbl, CoCreateInstance, CoInitializeEx, IUnknownVtbl, GUID};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::ffi::c_void;

#[repr(C)]
#[derive(Clone, Copy)]
pub union VarVal {
    pub ptr: *mut c_void,
    pub i64_val: i64,
    pub i32_val: i32,
    pub i16_val: i16,
    pub u8_val: u8,
    pub f64_val: f64,
    pub f32_val: f32,
}

#[repr(C)]
pub struct VARIANT {
    pub vt: u16,
    pub r1: u16,
    pub r2: u16,
    pub r3: u16,
    pub val: VarVal,
    pub pad: usize,
}

const CLSID_WBEM_LOCATOR: GUID = GUID {
    data1: 0x4590_F811,
    data2: 0x1D3A,
    data3: 0x11D0,
    data4: [0x89, 0x1F, 0x00, 0xAA, 0x00, 0x4B, 0x2E, 0x24],
};
const IID_IWBEM_LOCATOR: GUID = GUID {
    data1: 0xDC12_A687,
    data2: 0x737F,
    data3: 0x11CF,
    data4: [0x88, 0x4D, 0x00, 0xAA, 0x00, 0x4B, 0x2E, 0x24],
};

#[link(name = "ole32")]
extern "system" {
    fn CoSetProxyBlanket(
        p_proxy: *mut c_void,
        dw_authn_svc: u32,
        dw_authz_svc: u32,
        p_server_princ_name: *const u16,
        dw_authn_level: u32,
        dw_imp_level: u32,
        p_auth_info: *mut c_void,
        dw_capabilities: u32,
    ) -> i32;
}

#[link(name = "oleaut32")]
extern "system" {
    fn SysAllocString(psz: *const u16) -> *mut u16;
    fn SysFreeString(bstr: *mut u16);
    #[allow(clashing_extern_declarations)]
    fn VariantClear(pvarg: *mut VARIANT) -> i32;
}

#[repr(C)]
struct IWbemLocatorVtbl {
    unk: IUnknownVtbl,
    connect_server: unsafe extern "system" fn(
        *mut c_void,
        *mut u16,
        *mut u16,
        *mut u16,
        *mut u16,
        i32,
        *mut u16,
        *mut c_void,
        *mut *mut c_void,
    ) -> i32,
}

#[repr(C)]
struct IWbemServicesVtbl {
    unk: IUnknownVtbl,
    _s: [*const c_void; 17],
    exec_query: unsafe extern "system" fn(
        *mut c_void,
        *mut u16,
        *mut u16,
        i32,
        *mut c_void,
        *mut *mut c_void,
    ) -> i32,
}

#[repr(C)]
struct IEnumWbemClassObjectVtbl {
    unk: IUnknownVtbl,
    _reset: *const c_void,
    next: unsafe extern "system" fn(*mut c_void, i32, u32, *mut *mut c_void, *mut u32) -> i32,
}

#[repr(C)]
struct IWbemClassObjectVtbl {
    unk: IUnknownVtbl,
    _get_qual: *const c_void,
    get: unsafe extern "system" fn(
        *mut c_void,
        *const u16,
        i32,
        *mut VARIANT,
        *mut i32,
        *mut i32,
    ) -> i32,
}

fn to_wide(s: &str) -> Vec<u16> {
    let mut w: Vec<u16> = s.encode_utf16().collect();
    w.push(0);
    w
}

// SAFETY: Caller must pass valid, non-dangling COM/Win32 pointers with matching lifetimes.
unsafe fn bstr(s: &str) -> *mut u16 {
    SysAllocString(to_wide(s).as_ptr())
}

// SAFETY: Caller must pass valid, non-dangling COM/Win32 pointers with matching lifetimes.
unsafe fn variant_to_value(v: &VARIANT) -> Value {
    match v.vt {
        0 | 1 => Value::Null, // VT_EMPTY | VT_NULL
        2 => json!(v.val.i16_val),
        3 | 19 | 22 | 23 => json!(v.val.i32_val),
        4 => json!(v.val.f32_val),
        5 => json!(v.val.f64_val),
        11 => json!(v.val.i16_val != 0),
        16 | 17 => json!(v.val.u8_val),
        18 => json!(v.val.i16_val as u16),
        20 | 21 => json!(v.val.i64_val),
        8 => {
            if v.val.ptr.is_null() {
                Value::Null
            } else {
                let p = v.val.ptr as *const u16;
                let mut len = 0usize;
                while *p.add(len) != 0 {
                    len += 1;
                }
                Value::String(String::from_utf16_lossy(std::slice::from_raw_parts(p, len)))
            }
        }
        _ => Value::Null,
    }
}

pub fn query(scope: &str, wql: &str, props: &[&str]) -> Result<Vec<HashMap<String, Value>>, String> {
    // SAFETY: COM apartment is initialized and interface pointers/vtable slots follow Windows ABI.
    unsafe {
        CoInitializeEx(std::ptr::null_mut(), 0);
        let mut loc: *mut c_void = std::ptr::null_mut();
        let hr = CoCreateInstance(
            &CLSID_WBEM_LOCATOR,
            std::ptr::null_mut(),
            1, // CLSCTX_INPROC_SERVER
            &IID_IWBEM_LOCATOR,
            &mut loc,
        );
        if hr != 0 || loc.is_null() {
            return Err(format!("WbemLocator failed 0x{hr:08X}"));
        }

        let b_scope = bstr(scope);
        let mut svc: *mut c_void = std::ptr::null_mut();
        let hr_c = (vtbl::<IWbemLocatorVtbl>(loc).connect_server)(
            loc,
            b_scope,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut svc,
        );
        SysFreeString(b_scope);
        release(loc);
        if hr_c != 0 || svc.is_null() {
            return Err(format!("WMI ConnectServer({scope}) failed 0x{hr_c:08X}"));
        }

        CoSetProxyBlanket(
            svc,
            10, // RPC_C_AUTHN_WINNT
            0,  // RPC_C_AUTHZ_NONE
            std::ptr::null(),
            3, // RPC_C_AUTHN_LEVEL_CALL
            3, // RPC_C_IMP_LEVEL_IMPERSONATE
            std::ptr::null_mut(),
            0,
        );

        let b_wql = bstr("WQL");
        let b_q = bstr(wql);
        let mut en: *mut c_void = std::ptr::null_mut();
        // WBEM_FLAG_FORWARD_ONLY (0x20) | WBEM_FLAG_RETURN_IMMEDIATELY (0x10) = 0x30
        let hr_e = (vtbl::<IWbemServicesVtbl>(svc).exec_query)(
            svc,
            b_wql,
            b_q,
            0x30,
            std::ptr::null_mut(),
            &mut en,
        );
        SysFreeString(b_wql);
        SysFreeString(b_q);
        release(svc);
        if hr_e != 0 || en.is_null() {
            return Err(format!("WMI ExecQuery failed 0x{hr_e:08X}"));
        }

        let mut rows = Vec::new();
        loop {
            let mut obj: *mut c_void = std::ptr::null_mut();
            let mut ret: u32 = 0;
            let hr_n = (vtbl::<IEnumWbemClassObjectVtbl>(en).next)(en, 15000, 1, &mut obj, &mut ret);
            if hr_n != 0 || ret == 0 || obj.is_null() {
                break;
            }
            let mut row = HashMap::new();
            for &prop in props {
                let w = to_wide(prop);
                let mut var: VARIANT = std::mem::zeroed();
                if (vtbl::<IWbemClassObjectVtbl>(obj).get)(
                    obj,
                    w.as_ptr(),
                    0,
                    &mut var,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                ) == 0
                {
                    row.insert(prop.to_string(), variant_to_value(&var));
                    VariantClear(&mut var);
                } else {
                    row.insert(prop.to_string(), Value::Null);
                }
            }
            release(obj);
            rows.push(row);
        }
        release(en);
        Ok(rows)
    }
}

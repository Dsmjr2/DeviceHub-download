use std::ffi::c_void;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct GUID {
    pub data1: u32,
    pub data2: u16,
    pub data3: u16,
    pub data4: [u8; 8],
}

impl GUID {
    pub const ZERO: Self = Self {
        data1: 0,
        data2: 0,
        data3: 0,
        data4: [0; 8],
    };
}

#[repr(C)]
pub struct PROPERTYKEY {
    pub fmtid: GUID,
    pub pid: u32,
}

#[repr(C)]
pub union PropVal {
    pub ptr: *mut c_void,
    pub u32_val: u32,
    pub i64_val: i64,
}

#[repr(C)]
pub struct PROPVARIANT {
    pub vt: u16,
    pub r1: u16,
    pub r2: u16,
    pub r3: u16,
    pub val: PropVal,
    pub pad: usize,
}

pub const CLSID_MMDEVICE_ENUMERATOR: GUID = GUID {
    data1: 0xBCDE_0395,
    data2: 0xE52F,
    data3: 0x467C,
    data4: [0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E],
};
pub const IID_IMMDEVICE_ENUMERATOR: GUID = GUID {
    data1: 0xA956_64D2,
    data2: 0x9614,
    data3: 0x4F35,
    data4: [0xA7, 0x46, 0xDE, 0x8D, 0xB6, 0x36, 0x17, 0xE6],
};
pub const IID_IAUDIO_ENDPOINT_VOLUME: GUID = GUID {
    data1: 0x5CDF_2C82,
    data2: 0x841E,
    data3: 0x4546,
    data4: [0x97, 0x22, 0x0C, 0xF7, 0x40, 0x78, 0x22, 0x9A],
};
pub const IID_IDEVICE_TOPOLOGY: GUID = GUID {
    data1: 0x2A07_407E,
    data2: 0x6497,
    data3: 0x4A18,
    data4: [0x97, 0x87, 0x32, 0xF7, 0x9B, 0xD0, 0xD9, 0x8F],
};
pub const IID_IPART: GUID = GUID {
    data1: 0xAE2D_E0E4,
    data2: 0x5BCA,
    data3: 0x4F2D,
    data4: [0xAA, 0x46, 0x5D, 0x13, 0xF8, 0xFD, 0xB3, 0xA9],
};
pub const IID_IAUDIO_VOLUME_LEVEL: GUID = GUID {
    data1: 0x7FB7_B48F,
    data2: 0x531D,
    data3: 0x44A2,
    data4: [0xBC, 0xB3, 0x5A, 0xD5, 0xA1, 0x34, 0xB3, 0xDC],
};
pub const IID_IAUDIO_MUTE: GUID = GUID {
    data1: 0xDF45_AEEA,
    data2: 0xB74A,
    data3: 0x4B6B,
    data4: [0xAF, 0xAD, 0x23, 0x66, 0xB6, 0xAA, 0x01, 0x2E],
};
pub const CLSID_POLICY_CONFIG: GUID = GUID {
    data1: 0x870A_F99C,
    data2: 0x171D,
    data3: 0x4F9E,
    data4: [0xAF, 0x0D, 0xE6, 0x3D, 0xF4, 0x0C, 0x2B, 0xC9],
};
pub const IID_IPOLICY_CONFIG: GUID = GUID {
    data1: 0xF867_9F50,
    data2: 0x850A,
    data3: 0x41CF,
    data4: [0x9C, 0x72, 0x43, 0x0F, 0x29, 0x02, 0x90, 0xC8],
};
pub const IID_IAUDIO_SESSION_MANAGER2: GUID = GUID {
    data1: 0x77AA_99A0,
    data2: 0x1BD6,
    data3: 0x484F,
    data4: [0x8B, 0xC7, 0x2C, 0x65, 0x4C, 0x9A, 0x9B, 0x6F],
};
pub const IID_IAUDIO_SESSION_CONTROL2: GUID = GUID {
    data1: 0xBFB7_FF88,
    data2: 0x7239,
    data3: 0x4FC9,
    data4: [0x8F, 0xA2, 0x07, 0xC9, 0x50, 0xBE, 0x9C, 0x6D],
};
pub const IID_IAUDIO_POLICY_CONFIG_FACTORY: GUID = GUID {
    data1: 0xAB3D_4648,
    data2: 0xE242,
    data3: 0x459F,
    data4: [0xB0, 0x2F, 0x54, 0x1C, 0x70, 0x30, 0x63, 0x24],
};
pub const IID_IAUDIO_CLIENT: GUID = GUID {
    data1: 0x1CB9_AD4C,
    data2: 0xDBFA,
    data3: 0x4C32,
    data4: [0xB1, 0x78, 0xC2, 0xF5, 0x68, 0xA7, 0x03, 0xB2],
};
pub const IID_IAUDIO_CAPTURE_CLIENT: GUID = GUID {
    data1: 0xC8AD_BD64,
    data2: 0xE71E,
    data3: 0x48A0,
    data4: [0xA4, 0xDE, 0x18, 0x5C, 0x39, 0x5C, 0xD3, 0x17],
};

#[link(name = "ole32")]
extern "system" {
    pub fn CoInitializeEx(pv_reserved: *mut c_void, dw_co_init: u32) -> i32;
    pub fn CoCreateInstance(
        rclsid: *const GUID,
        p_unk_outer: *mut c_void,
        dw_cls_context: u32,
        riid: *const GUID,
        ppv: *mut *mut c_void,
    ) -> i32;
    pub fn CoTaskMemFree(pv: *mut c_void);
    pub fn PropVariantClear(pvar: *mut PROPVARIANT) -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    fn LoadLibraryA(lp_lib_file_name: *const u8) -> isize;
    fn GetProcAddress(h_module: isize, lp_proc_name: *const u8) -> *const c_void;
}

type FnRoGetActivationFactory =
    // SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
    unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> i32;
type FnWindowsCreateString =
    // SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
    unsafe extern "system" fn(*const u16, u32, *mut *mut c_void) -> i32;
type FnWindowsDeleteString = unsafe extern "system" fn(*mut c_void) -> i32;

// SAFETY: Caller must pass valid, non-dangling COM/Win32 pointers with matching lifetimes.
pub unsafe fn combase_ro_get_activation_factory(
    activatable_class_id: *mut c_void,
    iid: *const GUID,
    factory: *mut *mut c_void,
) -> i32 {
    let h = LoadLibraryA(b"combase.dll\0".as_ptr());
    if h == 0 {
        return -1;
    }
    let p = GetProcAddress(h, b"RoGetActivationFactory\0".as_ptr());
    if p.is_null() {
        return -1;
    }
    let f: FnRoGetActivationFactory = std::mem::transmute(p);
    f(activatable_class_id, iid, factory)
}

// SAFETY: Caller must pass valid, non-dangling COM/Win32 pointers with matching lifetimes.
pub unsafe fn combase_windows_create_string(
    source_string: *const u16,
    length: u32,
    string: *mut *mut c_void,
) -> i32 {
    let h = LoadLibraryA(b"combase.dll\0".as_ptr());
    if h == 0 {
        return -1;
    }
    let p = GetProcAddress(h, b"WindowsCreateString\0".as_ptr());
    if p.is_null() {
        return -1;
    }
    let f: FnWindowsCreateString = std::mem::transmute(p);
    f(source_string, length, string)
}

// SAFETY: Caller must pass valid, non-dangling COM/Win32 pointers with matching lifetimes.
pub unsafe fn combase_windows_delete_string(string: *mut c_void) -> i32 {
    let h = LoadLibraryA(b"combase.dll\0".as_ptr());
    if h == 0 {
        return -1;
    }
    let p = GetProcAddress(h, b"WindowsDeleteString\0".as_ptr());
    if p.is_null() {
        return -1;
    }
    let f: FnWindowsDeleteString = std::mem::transmute(p);
    f(string)
}

#[repr(C)]
pub struct IUnknownVtbl {
    pub query_interface:
        // SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
        unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> i32,
    pub add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    pub release: unsafe extern "system" fn(*mut c_void) -> u32,
}

#[repr(C)]
pub struct IMMDeviceEnumeratorVtbl {
    pub unk: IUnknownVtbl,
    pub enum_audio_endpoints:
        // SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
        unsafe extern "system" fn(*mut c_void, i32, u32, *mut *mut c_void) -> i32,
    pub get_default_audio_endpoint:
        // SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
        unsafe extern "system" fn(*mut c_void, i32, i32, *mut *mut c_void) -> i32,
    pub get_device: unsafe extern "system" fn(*mut c_void, *const u16, *mut *mut c_void) -> i32,
}

#[repr(C)]
pub struct IMMDeviceCollectionVtbl {
    pub unk: IUnknownVtbl,
    pub get_count: unsafe extern "system" fn(*mut c_void, *mut u32) -> i32,
    pub item: unsafe extern "system" fn(*mut c_void, u32, *mut *mut c_void) -> i32,
}

#[repr(C)]
pub struct IMMDeviceVtbl {
    pub unk: IUnknownVtbl,
    pub activate: unsafe extern "system" fn(
        *mut c_void,
        *const GUID,
        u32,
        *mut c_void,
        *mut *mut c_void,
    ) -> i32,
    pub open_property_store:
        // SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
        unsafe extern "system" fn(*mut c_void, u32, *mut *mut c_void) -> i32,
    pub get_id: unsafe extern "system" fn(*mut c_void, *mut *mut u16) -> i32,
    pub get_state: unsafe extern "system" fn(*mut c_void, *mut u32) -> i32,
}

#[repr(C)]
pub struct IPropertyStoreVtbl {
    pub unk: IUnknownVtbl,
    pub get_count: unsafe extern "system" fn(*mut c_void, *mut u32) -> i32,
    pub get_at: unsafe extern "system" fn(*mut c_void, u32, *mut PROPERTYKEY) -> i32,
    pub get_value:
        // SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
        unsafe extern "system" fn(*mut c_void, *const PROPERTYKEY, *mut PROPVARIANT) -> i32,
}

#[repr(C)]
pub struct IAudioEndpointVolumeVtbl {
    pub unk: IUnknownVtbl,
    pub _reg: *const c_void,
    pub _unreg: *const c_void,
    pub _ch_count: *const c_void,
    pub _set_db: *const c_void,
    pub set_master_volume_level_scalar:
        // SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
        unsafe extern "system" fn(*mut c_void, f32, *const GUID) -> i32,
    pub _get_db: *const c_void,
    pub get_master_volume_level_scalar: unsafe extern "system" fn(*mut c_void, *mut f32) -> i32,
    pub _c1: *const c_void,
    pub _c2: *const c_void,
    pub _c3: *const c_void,
    pub _c4: *const c_void,
    pub set_mute: unsafe extern "system" fn(*mut c_void, i32, *const GUID) -> i32,
    pub get_mute: unsafe extern "system" fn(*mut c_void, *mut i32) -> i32,
}

#[repr(C)]
pub struct IDeviceTopologyVtbl {
    pub unk: IUnknownVtbl,
    pub get_connector_count: *const c_void,
    pub get_connector: unsafe extern "system" fn(*mut c_void, u32, *mut *mut c_void) -> i32,
    pub get_subunit_count: unsafe extern "system" fn(*mut c_void, *mut u32) -> i32,
    pub get_subunit: unsafe extern "system" fn(*mut c_void, u32, *mut *mut c_void) -> i32,
    pub get_part_by_id: unsafe extern "system" fn(*mut c_void, u32, *mut *mut c_void) -> i32,
    pub get_device_id: unsafe extern "system" fn(*mut c_void, *mut *mut u16) -> i32,
}

#[repr(C)]
pub struct IConnectorVtbl {
    pub unk: IUnknownVtbl,
    pub _get_type: *const c_void,
    pub _get_data_flow: *const c_void,
    pub _connect_to: *const c_void,
    pub _disconnect: *const c_void,
    pub _is_connected: *const c_void,
    pub get_connected_to: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> i32,
}

#[repr(C)]
pub struct IPartVtbl {
    pub unk: IUnknownVtbl,
    pub get_name: unsafe extern "system" fn(*mut c_void, *mut *mut u16) -> i32,
    pub get_local_id: unsafe extern "system" fn(*mut c_void, *mut u32) -> i32,
    pub _get_global_id: *const c_void,
    pub _get_part_type: *const c_void,
    pub _get_sub_type: *const c_void,
    pub _get_ctrl_count: *const c_void,
    pub _get_ctrl: *const c_void,
    pub _enum_in: *const c_void,
    pub _enum_out: *const c_void,
    pub get_topology_object: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> i32,
    pub activate:
        // SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
        unsafe extern "system" fn(*mut c_void, u32, *const GUID, *mut *mut c_void) -> i32,
}

#[repr(C)]
pub struct IAudioVolumeLevelVtbl {
    pub unk: IUnknownVtbl,
    pub _ch_count: *const c_void,
    pub get_level_range:
        // SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
        unsafe extern "system" fn(*mut c_void, u32, *mut f32, *mut f32, *mut f32) -> i32,
    pub get_level: unsafe extern "system" fn(*mut c_void, u32, *mut f32) -> i32,
    pub _set_level: *const c_void,
    pub set_level_uniform: unsafe extern "system" fn(*mut c_void, f32, *const GUID) -> i32,
}

#[repr(C)]
pub struct IAudioMuteVtbl {
    pub unk: IUnknownVtbl,
    pub set_mute: unsafe extern "system" fn(*mut c_void, i32, *const GUID) -> i32,
    pub get_mute: unsafe extern "system" fn(*mut c_void, *mut i32) -> i32,
}

#[repr(C)]
pub struct IPolicyConfigVtbl {
    pub unk: IUnknownVtbl,
    pub _s: [*const c_void; 10],
    pub set_default_endpoint: unsafe extern "system" fn(*mut c_void, *const u16, i32) -> i32,
    pub set_endpoint_visibility: unsafe extern "system" fn(*mut c_void, *const u16, i32) -> i32,
}

#[repr(C)]
pub struct IAudioSessionManager2Vtbl {
    pub unk: IUnknownVtbl,
    pub _s1: *const c_void,
    pub _s2: *const c_void,
    pub get_session_enumerator: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> i32,
}

#[repr(C)]
pub struct IAudioSessionEnumeratorVtbl {
    pub unk: IUnknownVtbl,
    pub get_count: unsafe extern "system" fn(*mut c_void, *mut i32) -> i32,
    pub get_session: unsafe extern "system" fn(*mut c_void, i32, *mut *mut c_void) -> i32,
}

#[repr(C)]
pub struct IAudioSessionControl2Vtbl {
    pub unk: IUnknownVtbl,
    pub get_state: unsafe extern "system" fn(*mut c_void, *mut i32) -> i32,
    pub _s: [*const c_void; 10],
    pub get_process_id: unsafe extern "system" fn(*mut c_void, *mut u32) -> i32,
    pub is_system_sounds_session: unsafe extern "system" fn(*mut c_void) -> i32,
}

#[repr(C)]
pub struct IAudioPolicyConfigFactoryVtbl {
    pub unk: IUnknownVtbl,
    pub _s: [*const c_void; 19],
    pub set_persisted_default_audio_endpoint:
        // SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
        unsafe extern "system" fn(*mut c_void, u32, i32, i32, *mut c_void) -> i32,
    pub get_persisted_default_audio_endpoint:
        // SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
        unsafe extern "system" fn(*mut c_void, u32, i32, i32, *mut *mut c_void) -> i32,
    pub clear_all_persisted_application_default_endpoints:
        // SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
        unsafe extern "system" fn(*mut c_void) -> i32,
}

#[repr(C)]
pub struct IAudioClientVtbl {
    pub unk: IUnknownVtbl,
    pub initialize: unsafe extern "system" fn(
        *mut c_void,
        i32,
        u32,
        i64,
        i64,
        *const u8,
        *const GUID,
    ) -> i32,
    pub _s: [*const c_void; 4],
    pub get_mix_format: unsafe extern "system" fn(*mut c_void, *mut *mut u8) -> i32,
    pub _p: *const c_void,
    pub start: unsafe extern "system" fn(*mut c_void) -> i32,
    pub stop: unsafe extern "system" fn(*mut c_void) -> i32,
    pub _reset: *const c_void,
    pub _set_ev: *const c_void,
    pub get_service:
        // SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
        unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> i32,
}

#[repr(C)]
pub struct IAudioCaptureClientVtbl {
    pub unk: IUnknownVtbl,
    pub get_buffer: unsafe extern "system" fn(
        *mut c_void,
        *mut *const f32,
        *mut u32,
        *mut u32,
        *mut u64,
        *mut u64,
    ) -> i32,
    pub release_buffer: unsafe extern "system" fn(*mut c_void, u32) -> i32,
    pub get_next_packet_size: unsafe extern "system" fn(*mut c_void, *mut u32) -> i32,
}

// SAFETY: Caller must pass valid, non-dangling COM/Win32 pointers with matching lifetimes.
pub unsafe fn vtbl<T>(obj: *mut c_void) -> &'static T {
    &**(obj as *const *const T)
}

// SAFETY: Caller must pass valid, non-dangling COM/Win32 pointers with matching lifetimes.
pub unsafe fn release(obj: *mut c_void) {
    if !obj.is_null() {
        (vtbl::<IUnknownVtbl>(obj).release)(obj);
    }
}

// SAFETY: Caller must pass valid, non-dangling COM/Win32 pointers with matching lifetimes.
pub unsafe fn cotask_to_string(ptr: *mut u16) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let mut len = 0usize;
    while *ptr.add(len) != 0 {
        len += 1;
    }
    let s = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
    CoTaskMemFree(ptr as *mut c_void);
    s
}

// SAFETY: Caller must pass valid, non-dangling COM/Win32 pointers with matching lifetimes.
pub unsafe fn create_enumerator() -> Result<*mut c_void, String> {
    CoInitializeEx(std::ptr::null_mut(), 0);
    let mut en: *mut c_void = std::ptr::null_mut();
    let hr = CoCreateInstance(
        &CLSID_MMDEVICE_ENUMERATOR,
        std::ptr::null_mut(),
        23, // CLSCTX_ALL
        &IID_IMMDEVICE_ENUMERATOR,
        &mut en,
    );
    if hr != 0 || en.is_null() {
        return Err(format!("MMDeviceEnumerator failed 0x{hr:08X}"));
    }
    Ok(en)
}

// SAFETY: Caller must pass valid, non-dangling COM/Win32 pointers with matching lifetimes.
pub unsafe fn prop_str(ps: *mut c_void, fmtid: GUID, pid: u32) -> String {
    let k = PROPERTYKEY { fmtid, pid };
    let mut pv: PROPVARIANT = std::mem::zeroed();
    if (vtbl::<IPropertyStoreVtbl>(ps).get_value)(ps, &k, &mut pv) != 0 {
        return String::new();
    }
    let res = if pv.vt == 31 && !pv.val.ptr.is_null() {
        let p = pv.val.ptr as *const u16;
        let mut len = 0usize;
        while *p.add(len) != 0 {
            len += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(p, len))
    } else {
        String::new()
    };
    PropVariantClear(&mut pv);
    res
}

// SAFETY: Caller must pass valid, non-dangling COM/Win32 pointers with matching lifetimes.
pub unsafe fn prop_u32(ps: *mut c_void, fmtid: GUID, pid: u32) -> u32 {
    let k = PROPERTYKEY { fmtid, pid };
    let mut pv: PROPVARIANT = std::mem::zeroed();
    if (vtbl::<IPropertyStoreVtbl>(ps).get_value)(ps, &k, &mut pv) != 0 {
        return 0;
    }
    let res = if pv.vt == 19 { pv.val.u32_val } else { 0 };
    PropVariantClear(&mut pv);
    res
}

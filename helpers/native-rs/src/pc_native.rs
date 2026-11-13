use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::ffi::c_void;

const ENUM_CURRENT_SETTINGS: u32 = u32::MAX; // -1
const ATTACHED_TO_DESKTOP: u32 = 0x1;
const PRIMARY_DEVICE: u32 = 0x4;
const QDC_ONLY_ACTIVE_PATHS: u32 = 2;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct LUID {
    low: u32,
    high: i32,
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
struct DEVMODEW {
    dm_device_name: [u16; 32],
    dm_spec_version: u16,
    dm_driver_version: u16,
    dm_size: u16,
    dm_driver_extra: u16,
    dm_fields: u32,
    dm_position_x: i32,
    dm_position_y: i32,
    dm_display_orientation: u32,
    dm_display_fixed_output: u32,
    dm_color: i16,
    dm_duplex: i16,
    dm_y_resolution: i16,
    dm_tt_option: i16,
    dm_collate: i16,
    dm_form_name: [u16; 32],
    dm_log_pixels: u16,
    dm_bits_per_pel: u32,
    dm_pels_width: u32,
    dm_pels_height: u32,
    dm_display_flags: u32,
    dm_display_frequency: u32,
    dm_icm_method: u32,
    dm_icm_intent: u32,
    dm_media_type: u32,
    dm_dither_type: u32,
    dm_reserved1: u32,
    dm_reserved2: u32,
    dm_panning_width: u32,
    dm_panning_height: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct DISPLAYCONFIG_PATH_SOURCE_INFO {
    adapter_id: LUID,
    id: u32,
    mode_info_idx: u32,
    status_flags: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct DISPLAYCONFIG_RATIONAL {
    numerator: u32,
    denominator: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct DISPLAYCONFIG_PATH_TARGET_INFO {
    adapter_id: LUID,
    id: u32,
    mode_info_idx: u32,
    output_technology: u32,
    rotation: u32,
    scaling: u32,
    refresh_rate: DISPLAYCONFIG_RATIONAL,
    scan_line_ordering: u32,
    target_available: i32,
    status_flags: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct DISPLAYCONFIG_PATH_INFO {
    source_info: DISPLAYCONFIG_PATH_SOURCE_INFO,
    target_info: DISPLAYCONFIG_PATH_TARGET_INFO,
    flags: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct DISPLAYCONFIG_MODE_INFO {
    info_type: u32,
    id: u32,
    adapter_id: LUID,
    data: [u8; 48],
}

impl Default for DISPLAYCONFIG_MODE_INFO {
    fn default() -> Self {
        Self {
            info_type: 0,
            id: 0,
            adapter_id: LUID::default(),
            data: [0; 48],
        }
    }
}

#[repr(C)]
struct DISPLAYCONFIG_DEVICE_INFO_HEADER {
    ty: i32,
    size: u32,
    adapter_id: LUID,
    id: u32,
}

#[repr(C)]
struct DISPLAYCONFIG_SOURCE_DEVICE_NAME {
    header: DISPLAYCONFIG_DEVICE_INFO_HEADER,
    view_gdi_device_name: [u16; 32],
}

#[repr(C)]
struct DISPLAYCONFIG_TARGET_DEVICE_NAME {
    header: DISPLAYCONFIG_DEVICE_INFO_HEADER,
    flags: u32,
    output_technology: i32,
    edid_manufacture_id: u16,
    edid_product_code_id: u16,
    connector_instance: u32,
    monitor_friendly_device_name: [u16; 64],
    monitor_device_path: [u16; 128],
}

#[repr(C)]
struct DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO {
    header: DISPLAYCONFIG_DEVICE_INFO_HEADER,
    value: u32,
    color_encoding: i32,
    bits_per_color_channel: i32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct D3DKMT_ADAPTERINFO {
    h_adapter: u32,
    luid_low: u32,
    luid_high: i32,
    num_sources: u32,
    precise_present_regions_preferred: i32,
}

#[repr(C)]
struct D3DKMT_ENUMADAPTERS2 {
    num_adapters: u32,
    p_adapters: *mut D3DKMT_ADAPTERINFO,
}

#[repr(C)]
struct D3DKMT_QUERYADAPTERINFO {
    h_adapter: u32,
    ty: i32,
    p_private_driver_data: *mut c_void,
    private_driver_data_size: u32,
}

#[repr(C)]
struct D3DKMT_CLOSEADAPTER {
    h_adapter: u32,
}

#[link(name = "user32")]
extern "system" {
    fn EnumDisplayDevicesW(
        lp_device: *const u16,
        i_dev_num: u32,
        lp_display_device: *mut DISPLAY_DEVICEW,
        dw_flags: u32,
    ) -> i32;
    fn EnumDisplaySettingsExW(
        lpsz_device_name: *const u16,
        i_mode_num: u32,
        lp_dev_mode: *mut DEVMODEW,
        dw_flags: u32,
    ) -> i32;
    fn GetDisplayConfigBufferSizes(
        flags: u32,
        num_path_array_elements: *mut u32,
        num_mode_info_array_elements: *mut u32,
    ) -> i32;
    fn QueryDisplayConfig(
        flags: u32,
        num_path_array_elements: *mut u32,
        path_array: *mut DISPLAYCONFIG_PATH_INFO,
        num_mode_info_array_elements: *mut u32,
        mode_info_array: *mut DISPLAYCONFIG_MODE_INFO,
        current_topology_id: *mut c_void,
    ) -> i32;
    fn DisplayConfigGetDeviceInfo(request_packet: *mut c_void) -> i32;
    fn DisplayConfigSetDeviceInfo(set_packet: *mut c_void) -> i32;
    fn ChangeDisplaySettingsExW(
        lpsz_device_name: *const u16,
        lp_dev_mode: *const DEVMODEW,
        hwnd: isize,
        dwflags: u32,
        lparam: *mut c_void,
    ) -> i32;
}

#[link(name = "gdi32")]
extern "system" {
    fn D3DKMTEnumAdapters2(p_enum_adapters: *mut D3DKMT_ENUMADAPTERS2) -> i32;
    fn D3DKMTQueryAdapterInfo(p_data: *mut D3DKMT_QUERYADAPTERINFO) -> i32;
    fn D3DKMTCloseAdapter(p_close: *mut D3DKMT_CLOSEADAPTER) -> i32;
}

fn wide_str(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

fn monitor_id(device_path: &str) -> Option<String> {
    let pos = device_path.find("DISPLAY#")?;
    let rest = &device_path[pos + 8..];
    let mut parts = rest.split('#');
    let p1 = parts.next()?;
    let p2 = parts.next()?;
    if p1.is_empty() || p2.is_empty() {
        return None;
    }
    Some(format!("{p1}#{p2}"))
}

struct DisplayPath {
    gdi: String,
    friendly: String,
    device_path: String,
    adapter: LUID,
    target_id: u32,
    hdr_supported: bool,
    hdr_on: bool,
    hdr_force_disabled: bool,
    bits: i32,
}

fn get_paths() -> Vec<DisplayPath> {
    let mut r = Vec::new();
    // SAFETY: Win32 display/monitor API call with valid HMONITOR/handle and stack-allocated output buffers.
    unsafe {
        let mut np: u32 = 0;
        let mut nm: u32 = 0;
        if GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut np, &mut nm) != 0 {
            return r;
        }
        let mut p = vec![DISPLAYCONFIG_PATH_INFO::default(); np as usize];
        let mut m = vec![DISPLAYCONFIG_MODE_INFO::default(); nm as usize];
        if QueryDisplayConfig(
            QDC_ONLY_ACTIVE_PATHS,
            &mut np,
            p.as_mut_ptr(),
            &mut nm,
            m.as_mut_ptr(),
            std::ptr::null_mut(),
        ) != 0
        {
            return r;
        }
        for path in p.iter().take(np as usize) {
            let adapter = path.target_info.adapter_id;
            let target_id = path.target_info.id;

            let mut s: DISPLAYCONFIG_SOURCE_DEVICE_NAME = std::mem::zeroed();
            s.header.ty = 1;
            s.header.size = std::mem::size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32;
            s.header.adapter_id = path.source_info.adapter_id;
            s.header.id = path.source_info.id;
            let gdi = if DisplayConfigGetDeviceInfo(&mut s as *mut _ as *mut c_void) == 0 {
                wide_str(&s.view_gdi_device_name)
            } else {
                String::new()
            };

            let mut t: DISPLAYCONFIG_TARGET_DEVICE_NAME = std::mem::zeroed();
            t.header.ty = 2;
            t.header.size = std::mem::size_of::<DISPLAYCONFIG_TARGET_DEVICE_NAME>() as u32;
            t.header.adapter_id = adapter;
            t.header.id = target_id;
            let (friendly, device_path) =
                if DisplayConfigGetDeviceInfo(&mut t as *mut _ as *mut c_void) == 0 {
                    (
                        wide_str(&t.monitor_friendly_device_name),
                        wide_str(&t.monitor_device_path),
                    )
                } else {
                    (String::new(), String::new())
                };

            let mut c: DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO = std::mem::zeroed();
            c.header.ty = 9;
            c.header.size = std::mem::size_of::<DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO>() as u32;
            c.header.adapter_id = adapter;
            c.header.id = target_id;
            let (hdr_supported, hdr_on, hdr_force_disabled, bits) =
                if DisplayConfigGetDeviceInfo(&mut c as *mut _ as *mut c_void) == 0 {
                    (
                        (c.value & 1) != 0,
                        (c.value & 2) != 0,
                        (c.value & 8) != 0,
                        c.bits_per_color_channel,
                    )
                } else {
                    (false, false, false, 0)
                };

            r.push(DisplayPath {
                gdi,
                friendly,
                device_path,
                adapter,
                target_id,
                hdr_supported,
                hdr_on,
                hdr_force_disabled,
                bits,
            });
        }
    }
    r
}

pub fn display_read() -> Vec<Value> {
    let paths = get_paths();
    let mut list = Vec::new();
    // SAFETY: Win32 C struct is plain-old-data and zero-initialization is valid before setting cbSize.
    unsafe {
        for i in 0u32.. {
            let mut dd: DISPLAY_DEVICEW = std::mem::zeroed();
            dd.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
            if EnumDisplayDevicesW(std::ptr::null(), i, &mut dd, 0) == 0 {
                break;
            }
            if (dd.state_flags & ATTACHED_TO_DESKTOP) == 0 {
                continue;
            }
            let dev_name = wide_str(&dd.device_name);
            let mut dev_name_w: Vec<u16> = dev_name.encode_utf16().collect();
            dev_name_w.push(0);

            let mut cur: DEVMODEW = std::mem::zeroed();
            cur.dm_size = std::mem::size_of::<DEVMODEW>() as u16;
            if EnumDisplaySettingsExW(dev_name_w.as_ptr(), ENUM_CURRENT_SETTINGS, &mut cur, 0) == 0
            {
                continue;
            }

            let mut modes = Vec::new();
            let mut seen = HashSet::new();
            for k in 0u32.. {
                let mut dm: DEVMODEW = std::mem::zeroed();
                dm.dm_size = std::mem::size_of::<DEVMODEW>() as u16;
                if EnumDisplaySettingsExW(dev_name_w.as_ptr(), k, &mut dm, 0) == 0 {
                    break;
                }
                if dm.dm_bits_per_pel != 32 || dm.dm_display_frequency <= 1 {
                    continue;
                }
                let key = format!(
                    "{}x{}@{}",
                    dm.dm_pels_width, dm.dm_pels_height, dm.dm_display_frequency
                );
                if seen.insert(key) {
                    modes.push(json!([
                        dm.dm_pels_width,
                        dm.dm_pels_height,
                        dm.dm_display_frequency
                    ]));
                }
            }

            let mut mon: DISPLAY_DEVICEW = std::mem::zeroed();
            mon.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
            let mon_ok = EnumDisplayDevicesW(dev_name_w.as_ptr(), 0, &mut mon, 1) != 0;
            let mon_path = if mon_ok {
                wide_str(&mon.device_id)
            } else {
                String::new()
            };
            let mon_str = if mon_ok {
                wide_str(&mon.device_string)
            } else {
                String::new()
            };

            let path = paths.iter().find(|p| p.gdi == dev_name);
            let id = path
                .and_then(|p| monitor_id(&p.device_path))
                .or_else(|| monitor_id(&mon_path));
            let name = path
                .filter(|p| !p.friendly.is_empty())
                .map(|p| p.friendly.clone())
                .unwrap_or_else(|| {
                    if mon_str.is_empty() {
                        "Screen".into()
                    } else {
                        mon_str
                    }
                });
            let hdr = path.map(|p| {
                json!({
                    "supported": p.hdr_supported,
                    "on": p.hdr_on,
                    "forceDisabled": p.hdr_force_disabled,
                    "bits": p.bits,
                })
            });

            let mut obj = Map::new();
            obj.insert("screen".into(), json!(dev_name));
            obj.insert("adapter".into(), json!(wide_str(&dd.device_string)));
            obj.insert("id".into(), json!(id));
            obj.insert("name".into(), json!(name));
            obj.insert("primary".into(), json!((dd.state_flags & PRIMARY_DEVICE) != 0));
            obj.insert("width".into(), json!(cur.dm_pels_width));
            obj.insert("height".into(), json!(cur.dm_pels_height));
            obj.insert("hz".into(), json!(cur.dm_display_frequency));
            obj.insert("x".into(), json!(cur.dm_position_x));
            obj.insert("y".into(), json!(cur.dm_position_y));
            obj.insert("modes".into(), Value::Array(modes));
            obj.insert("hdr".into(), hdr.unwrap_or(Value::Null));
            list.push(Value::Object(obj));
        }
    }
    list
}

pub fn gpu_sensors_read() -> Vec<Value> {
    let mut r = Vec::new();
    // SAFETY: Win32 display/monitor API call with valid HMONITOR/handle and stack-allocated output buffers.
    unsafe {
        let mut e = D3DKMT_ENUMADAPTERS2 {
            num_adapters: 0,
            p_adapters: std::ptr::null_mut(),
        };
        if D3DKMTEnumAdapters2(&mut e) != 0 || e.num_adapters == 0 {
            return r;
        }
        let mut arr = vec![
            D3DKMT_ADAPTERINFO {
                h_adapter: 0,
                luid_low: 0,
                luid_high: 0,
                num_sources: 0,
                precise_present_regions_preferred: 0,
            };
            e.num_adapters as usize
        ];
        e.p_adapters = arr.as_mut_ptr();
        if D3DKMTEnumAdapters2(&mut e) != 0 {
            return r;
        }
        for a in arr.iter().take(e.num_adapters as usize) {
            let mut name_buf = vec![0u16; 1040];
            let mut q_name = D3DKMT_QUERYADAPTERINFO {
                h_adapter: a.h_adapter,
                ty: 8, // KMTQAITYPE_ADAPTERREGISTRYINFO
                p_private_driver_data: name_buf.as_mut_ptr() as *mut c_void,
                private_driver_data_size: (name_buf.len() * 2) as u32,
            };
            let n = if D3DKMTQueryAdapterInfo(&mut q_name) == 0 {
                Some(wide_str(&name_buf))
            } else {
                None
            };

            let mut perf = [0u8; 64];
            let mut q_perf = D3DKMT_QUERYADAPTERINFO {
                h_adapter: a.h_adapter,
                ty: 62, // KMTQAITYPE_ADAPTERPERFDATA
                p_private_driver_data: perf.as_mut_ptr() as *mut c_void,
                private_driver_data_size: perf.len() as u32,
            };
            if D3DKMTQueryAdapterInfo(&mut q_perf) == 0 {
                let rpm = u32::from_le_bytes(perf[48..52].try_into().unwrap());
                let temp = u32::from_le_bytes(perf[56..60].try_into().unwrap());
                if rpm > 0 || temp > 0 {
                    let temp_c = if temp > 0 {
                        json!(((temp as f64) / 10.0 * 10.0).round() / 10.0)
                    } else {
                        Value::Null
                    };
                    let fan_rpm = if rpm > 0 { json!(rpm) } else { Value::Null };
                    r.push(json!({
                        "name": n,
                        "tempC": temp_c,
                        "fanRpm": fan_rpm,
                    }));
                }
            }

            let mut close = D3DKMT_CLOSEADAPTER {
                h_adapter: a.h_adapter,
            };
            D3DKMTCloseAdapter(&mut close);
        }
    }
    r
}

fn cds_why(code: i32) -> Option<String> {
    match code {
        0 => None,
        1 => Some("Windows needs a restart for this mode".into()),
        -1 => Some("the graphics driver refused this mode".into()),
        -2 => Some("this screen does not offer that mode".into()),
        -3 => Some("Windows could not save the setting".into()),
        -4 | -5 | -6 => Some("Windows refused the request".into()),
        _ => Some(format!("Windows answered {code}")),
    }
}

fn wide_z(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn display_set_mode(screen: &str, width: u32, height: u32, hz: u32, persist: bool) -> Result<Value, String> {
    const DM_PELSWIDTH: u32 = 0x80000;
    const DM_PELSHEIGHT: u32 = 0x100000;
    const DM_DISPLAYFREQUENCY: u32 = 0x400000;
    const CDS_UPDATEREGISTRY: u32 = 0x1;
    const CDS_TEST: u32 = 0x2;
    let wscreen = wide_z(screen);
    // SAFETY: Win32 C struct is plain-old-data and zero-initialization is valid before setting cbSize.
    unsafe {
        let mut dm: DEVMODEW = std::mem::zeroed();
        dm.dm_size = std::mem::size_of::<DEVMODEW>() as u16;
        if EnumDisplaySettingsExW(wscreen.as_ptr(), ENUM_CURRENT_SETTINGS, &mut dm, 0) == 0 {
            return Err("that screen is not there now".into());
        }
        dm.dm_pels_width = width;
        dm.dm_pels_height = height;
        dm.dm_display_frequency = hz;
        dm.dm_fields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY;
        if let Some(w) = cds_why(ChangeDisplaySettingsExW(wscreen.as_ptr(), &dm, 0, CDS_TEST, std::ptr::null_mut())) {
            return Err(format!("not changed: {w}"));
        }
        let flags = if persist { CDS_UPDATEREGISTRY } else { 0 };
        if let Some(w) = cds_why(ChangeDisplaySettingsExW(wscreen.as_ptr(), &dm, 0, flags, std::ptr::null_mut())) {
            return Err(format!("not changed: {w}"));
        }
    }
    Ok(json!(true))
}

pub fn display_set_primary(screen: &str) -> Result<Value, String> {
    const DM_POSITION: u32 = 0x20;
    const CDS_UPDATEREGISTRY: u32 = 0x1;
    const CDS_SET_PRIMARY: u32 = 0x10;
    const CDS_NORESET: u32 = 0x10000000;
    let mut all: Vec<(String, DEVMODEW)> = Vec::new();
    let mut target: Option<(i32, i32)> = None;
    // SAFETY: Win32 C struct is plain-old-data and zero-initialization is valid before setting cbSize.
    unsafe {
        for i in 0u32.. {
            let mut dd: DISPLAY_DEVICEW = std::mem::zeroed();
            dd.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
            if EnumDisplayDevicesW(std::ptr::null(), i, &mut dd, 0) == 0 {
                break;
            }
            if (dd.state_flags & ATTACHED_TO_DESKTOP) == 0 {
                continue;
            }
            let dev = wide_str(&dd.device_name);
            let wdev = wide_z(&dev);
            let mut dm: DEVMODEW = std::mem::zeroed();
            dm.dm_size = std::mem::size_of::<DEVMODEW>() as u16;
            if EnumDisplaySettingsExW(wdev.as_ptr(), ENUM_CURRENT_SETTINGS, &mut dm, 0) == 0 {
                continue;
            }
            if dev == screen {
                target = Some((dm.dm_position_x, dm.dm_position_y));
            }
            all.push((dev, dm));
        }
        let (dx, dy) = target.ok_or_else(|| "that screen is not there now".to_string())?;
        for (dev, mut dm) in all {
            dm.dm_position_x -= dx;
            dm.dm_position_y -= dy;
            dm.dm_fields = DM_POSITION;
            let flags = CDS_UPDATEREGISTRY | CDS_NORESET | if dev == screen { CDS_SET_PRIMARY } else { 0 };
            let wdev = wide_z(&dev);
            if let Some(w) = cds_why(ChangeDisplaySettingsExW(wdev.as_ptr(), &dm, 0, flags, std::ptr::null_mut())) {
                return Err(format!("not changed: {w}"));
            }
        }
        if let Some(w) = cds_why(ChangeDisplaySettingsExW(std::ptr::null(), std::ptr::null(), 0, 0, std::ptr::null_mut())) {
            return Err(format!("not changed: {w}"));
        }
    }
    Ok(json!(true))
}

pub fn display_set_hdr(screen: &str, on: bool) -> Result<Value, String> {
    #[repr(C)]
    struct ColorState {
        header: DISPLAYCONFIG_DEVICE_INFO_HEADER,
        value: u32,
    }
    for p in get_paths() {
        if p.gdi != screen {
            continue;
        }
        if !p.hdr_supported {
            return Err("this screen does not offer HDR".into());
        }
        let mut s = ColorState {
            header: DISPLAYCONFIG_DEVICE_INFO_HEADER {
                ty: 10,
                size: std::mem::size_of::<ColorState>() as u32,
                adapter_id: p.adapter,
                id: p.target_id,
            },
            value: if on { 1 } else { 0 },
        };
        // SAFETY: Win32 display/monitor API call with valid HMONITOR/handle and stack-allocated output buffers.
        let r = unsafe { DisplayConfigSetDeviceInfo(&mut s as *mut ColorState as *mut c_void) };
        if r != 0 {
            return Err(format!("Windows refused HDR ({r})"));
        }
        return Ok(json!(true));
    }
    Err("that screen is not there now".into())
}

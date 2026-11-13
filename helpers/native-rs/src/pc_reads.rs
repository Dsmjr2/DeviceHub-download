use crate::{pc_native, wmi};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Registry::{
    RegCloseKey, RegEnumKeyExW, RegEnumValueW, RegOpenKeyExW, RegQueryValueExW, HKEY,
    HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, REG_BINARY, REG_DWORD, REG_EXPAND_SZ,
    REG_MULTI_SZ, REG_QWORD, REG_SZ, REG_VALUE_TYPE,
};

#[repr(C)]
#[derive(Clone, Copy)]
struct GUID {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct DEVPROPKEY {
    fmtid: GUID,
    pid: u32,
}

const CM_LOCATE_DEVNODE_PHANTOM: u32 = 1;
const DN_HAS_PROBLEM: u32 = 0x400;
const DN_NEED_RESTART: u32 = 0x0100_0000;
const CM_PROB_PHANTOM: u32 = 45;

const PKEY_DESC: DEVPROPKEY = DEVPROPKEY {
    fmtid: GUID {
        data1: 0xA45C_254E,
        data2: 0xDF1C,
        data3: 0x4EFD,
        data4: [0x80, 0x20, 0x67, 0xD1, 0x46, 0xA8, 0x50, 0xE0],
    },
    pid: 2,
};
const PKEY_HWIDS: DEVPROPKEY = DEVPROPKEY {
    fmtid: PKEY_DESC.fmtid,
    pid: 3,
};
const PKEY_CLASS: DEVPROPKEY = DEVPROPKEY {
    fmtid: PKEY_DESC.fmtid,
    pid: 9,
};
const PKEY_FRIENDLY: DEVPROPKEY = DEVPROPKEY {
    fmtid: PKEY_DESC.fmtid,
    pid: 14,
};
const PKEY_POWERDATA: DEVPROPKEY = DEVPROPKEY {
    fmtid: PKEY_DESC.fmtid,
    pid: 32,
};
const PKEY_BATTERY: DEVPROPKEY = DEVPROPKEY {
    fmtid: GUID {
        data1: 0x104E_A319,
        data2: 0x6EE2,
        data3: 0x4701,
        data4: [0xBD, 0x47, 0x8D, 0xDB, 0xF4, 0x25, 0xBB, 0xE5],
    },
    pid: 2,
};
const PKEY_CONNECTED: DEVPROPKEY = DEVPROPKEY {
    fmtid: GUID {
        data1: 0x83DA_6326,
        data2: 0x97A6,
        data3: 0x4088,
        data4: [0x94, 0x53, 0xA1, 0x92, 0x3F, 0x57, 0x3B, 0x29],
    },
    pid: 15,
};
const PKEY_LASTCONNECTED: DEVPROPKEY = DEVPROPKEY {
    fmtid: GUID {
        data1: 0x2BD6_7D8B,
        data2: 0x8BEB,
        data3: 0x48D5,
        data4: [0x87, 0xE0, 0x6C, 0xDA, 0x34, 0x28, 0x04, 0x0A],
    },
    pid: 11,
};

#[link(name = "cfgmgr32")]
extern "system" {
    fn CM_Get_Device_ID_List_SizeW(pul_len: *mut u32, psz_filter: *const u16, ul_flags: u32) -> i32;
    fn CM_Get_Device_ID_ListW(
        psz_filter: *const u16,
        buffer: *mut u16,
        buffer_len: u32,
        ul_flags: u32,
    ) -> i32;
    fn CM_Locate_DevNodeW(pdn_dev_inst: *mut u32, p_device_id: *const u16, ul_flags: u32) -> i32;
    fn CM_Get_DevNode_Status(
        pul_status: *mut u32,
        pul_problem_number: *mut u32,
        dn_dev_inst: u32,
        ul_flags: u32,
    ) -> i32;
    fn CM_Get_DevNode_PropertyW(
        dn_dev_inst: u32,
        property_key: *const DEVPROPKEY,
        property_type: *mut u32,
        property_buffer: *mut u8,
        property_buffer_size: *mut u32,
        ul_flags: u32,
    ) -> i32;
}

#[link(name = "powrprof")]
extern "system" {
    fn PowerGetActiveScheme(user_root_power_key: isize, active_policy_guid: *mut *mut GUID) -> u32;
    fn PowerEnumerate(
        root_power_key: isize,
        scheme_guid: *const GUID,
        sub_group_of_power_settings_guid: *const GUID,
        access_flags: u32,
        index: u32,
        buffer: *mut u8,
        buffer_size: *mut u32,
    ) -> u32;
    fn PowerReadFriendlyName(
        root_power_key: isize,
        scheme_guid: *const GUID,
        sub_group_of_power_settings_guid: *const GUID,
        power_setting_guid: *const GUID,
        buffer: *mut u8,
        buffer_size: *mut u32,
    ) -> u32;
    fn PowerReadACValueIndex(
        root_power_key: isize,
        scheme_guid: *const GUID,
        sub_group_of_power_settings_guid: *const GUID,
        power_setting_guid: *const GUID,
        ac_value_index: *mut u32,
    ) -> u32;
}

#[link(name = "kernel32")]
extern "system" {
    fn LocalFree(hmem: *mut c_void) -> *mut c_void;
    fn FileTimeToSystemTime(lp_file_time: *const u64, lp_system_time: *mut SYSTEMTIME) -> i32;
}

#[repr(C)]
#[derive(Default)]
struct SYSTEMTIME {
    w_year: u16,
    w_month: u16,
    w_day_of_week: u16,
    w_day: u16,
    w_hour: u16,
    w_minute: u16,
    w_second: u16,
    w_milliseconds: u16,
}

fn to_wide(s: &str) -> Vec<u16> {
    let mut w: Vec<u16> = s.encode_utf16().collect();
    w.push(0);
    w
}

fn guid_to_string(g: &GUID) -> String {
    format!(
        "{:08x}-{:04x}-{:04x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        g.data1,
        g.data2,
        g.data3,
        g.data4[0],
        g.data4[1],
        g.data4[2],
        g.data4[3],
        g.data4[4],
        g.data4[5],
        g.data4[6],
        g.data4[7]
    )
}

fn contains_ci(hay: &str, needle: &str) -> bool {
    hay.to_ascii_lowercase()
        .contains(&needle.to_ascii_lowercase())
}

// ---- cfgmgr32 ----

#[derive(Clone)]
struct Dev {
    id: String,
    name: Option<String>,
    status: String,
    problem: u32,
    inst: u32,
}

fn dev_prop_raw(inst: u32, key: DEVPROPKEY) -> Option<(u32, Vec<u8>)> {
    // SAFETY: Win32/COM FFI call with valid pointers, handles, and initialized buffers.
    unsafe {
        let mut ptype: u32 = 0;
        let mut size: u32 = 0;
        CM_Get_DevNode_PropertyW(
            inst,
            &key,
            &mut ptype,
            std::ptr::null_mut(),
            &mut size,
            0,
        );
        if size == 0 {
            return None;
        }
        let mut buf = vec![0u8; size as usize];
        if CM_Get_DevNode_PropertyW(
            inst,
            &key,
            &mut ptype,
            buf.as_mut_ptr(),
            &mut size,
            0,
        ) != 0
        {
            return None;
        }
        buf.truncate(size as usize);
        Some((ptype, buf))
    }
}

fn dev_prop_str(inst: u32, key: DEVPROPKEY) -> Option<String> {
    let (ty, buf) = dev_prop_raw(inst, key)?;
    if ty != 0x12 {
        return None;
    }
    let u16s: Vec<u16> = buf
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .take_while(|&w| w != 0)
        .collect();
    Some(String::from_utf16_lossy(&u16s))
}

fn dev_prop_str_list(inst: u32, key: DEVPROPKEY) -> Vec<String> {
    let Some((ty, buf)) = dev_prop_raw(inst, key) else {
        return Vec::new();
    };
    if ty != 0x2012 {
        return Vec::new();
    }
    let u16s: Vec<u16> = buf
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    let s = String::from_utf16_lossy(&u16s);
    s.split('\0')
        .filter(|x| !x.is_empty())
        .map(String::from)
        .collect()
}

fn dev_prop_bool(inst: u32, key: DEVPROPKEY) -> Option<bool> {
    let (ty, buf) = dev_prop_raw(inst, key)?;
    if ty == 0x11 && !buf.is_empty() {
        Some(buf[0] != 0)
    } else {
        None
    }
}

fn dev_prop_int(inst: u32, key: DEVPROPKEY) -> Option<i64> {
    let (ty, buf) = dev_prop_raw(inst, key)?;
    match ty {
        0x03 if !buf.is_empty() => Some(buf[0] as i64),
        0x02 if !buf.is_empty() => Some((buf[0] as i8) as i64),
        0x05 if buf.len() >= 2 => Some(u16::from_le_bytes([buf[0], buf[1]]) as i64),
        0x07 if buf.len() >= 4 => Some(u32::from_le_bytes(buf[0..4].try_into().unwrap()) as i64),
        0x06 if buf.len() >= 4 => Some(i32::from_le_bytes(buf[0..4].try_into().unwrap()) as i64),
        _ => None,
    }
}

fn dev_prop_filetime(inst: u32, key: DEVPROPKEY) -> Option<String> {
    let (ty, buf) = dev_prop_raw(inst, key)?;
    if ty != 0x10 || buf.len() < 8 {
        return None;
    }
    let ft = u64::from_le_bytes(buf[0..8].try_into().unwrap());
    if ft == 0 {
        return None;
    }
    let mut st = SYSTEMTIME::default();
    // SAFETY: Win32 system/process API call with valid handles and caller-owned output buffers.
    if unsafe { FileTimeToSystemTime(&ft, &mut st) } == 0 {
        return None;
    }
    let sub_100ns = ft % 10_000_000;
    let frac = sub_100ns - (sub_100ns % 10);
    Some(format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:07}Z",
        st.w_year, st.w_month, st.w_day, st.w_hour, st.w_minute, st.w_second, frac
    ))
}

fn devices(present_only: bool) -> Vec<Dev> {
    let mut r = Vec::new();
    // SAFETY: Win32/COM FFI call with valid pointers, handles, and initialized buffers.
    unsafe {
        let mut len: u32 = 0;
        if CM_Get_Device_ID_List_SizeW(&mut len, std::ptr::null(), 0) != 0 || len == 0 {
            return r;
        }
        let mut buf = vec![0u16; len as usize];
        if CM_Get_Device_ID_ListW(std::ptr::null(), buf.as_mut_ptr(), len, 0) != 0 {
            return r;
        }
        let full = String::from_utf16_lossy(&buf);
        for id in full.split('\0').filter(|s| !s.is_empty()) {
            let id_w = to_wide(id);
            let mut inst: u32 = 0;
            if CM_Locate_DevNodeW(&mut inst, id_w.as_ptr(), CM_LOCATE_DEVNODE_PHANTOM) != 0 {
                continue;
            }
            let (mut st, mut prob) = (0u32, 0u32);
            let present = CM_Get_DevNode_Status(&mut st, &mut prob, inst, 0) == 0;
            if present_only && !present {
                continue;
            }
            if !present {
                prob = CM_PROB_PHANTOM;
            } else if (st & DN_HAS_PROBLEM) == 0 {
                prob = 0;
            }
            let status = if !present {
                "Unknown"
            } else if prob != 0 {
                "Error"
            } else if (st & DN_NEED_RESTART) != 0 {
                "Degraded"
            } else {
                "OK"
            };
            let name = dev_prop_str(inst, PKEY_FRIENDLY).or_else(|| dev_prop_str(inst, PKEY_DESC));
            r.push(Dev {
                id: id.to_ascii_uppercase(),
                name,
                status: status.into(),
                problem: prob,
                inst,
            });
        }
    }
    r
}

// ---- Registry helpers ----

fn reg_open(hive: HKEY, path: &str) -> Option<HKEY> {
    let w = to_wide(path);
    let mut hk = HKEY::default();
    // SAFETY: Win32 registry call using null-terminated UTF-16 strings and properly sized stack/Vec buffers.
    if unsafe { RegOpenKeyExW(hive, PCWSTR(w.as_ptr()), 0, KEY_READ, &mut hk) }.is_ok() {
        Some(hk)
    } else {
        None
    }
}

fn reg_exists(hive: HKEY, path: &str) -> bool {
    if let Some(hk) = reg_open(hive, path) {
        // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
        unsafe {
            let _ = RegCloseKey(hk);
        }
        true
    } else {
        false
    }
}

fn reg_value(hive: HKEY, path: &str, name: &str) -> Value {
    let Some(hk) = reg_open(hive, path) else {
        return Value::Null;
    };
    let val = reg_value_hk(hk, name);
    // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
    unsafe {
        let _ = RegCloseKey(hk);
    }
    val
}

fn reg_value_hk(hk: HKEY, name: &str) -> Value {
    // SAFETY: Win32/COM FFI call with valid pointers, handles, and initialized buffers.
    unsafe {
        let w = to_wide(name);
        let mut ty = REG_VALUE_TYPE::default();
        let mut sz: u32 = 0;
        if RegQueryValueExW(hk, PCWSTR(w.as_ptr()), None, Some(&mut ty), None, Some(&mut sz))
            .is_err()
            || sz == 0
        {
            return Value::Null;
        }
        let mut buf = vec![0u8; sz as usize];
        if RegQueryValueExW(
            hk,
            PCWSTR(w.as_ptr()),
            None,
            Some(&mut ty),
            Some(buf.as_mut_ptr()),
            Some(&mut sz),
        )
        .is_err()
        {
            return Value::Null;
        }
        buf.truncate(sz as usize);
        match ty {
            t if t == REG_SZ || t == REG_EXPAND_SZ => {
                let u16s: Vec<u16> = buf
                    .chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .take_while(|&c| c != 0)
                    .collect();
                Value::String(String::from_utf16_lossy(&u16s))
            }
            t if t == REG_MULTI_SZ => {
                let u16s: Vec<u16> = buf
                    .chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .collect();
                let s = String::from_utf16_lossy(&u16s);
                Value::Array(
                    s.split('\0')
                        .filter(|x| !x.is_empty())
                        .map(|x| Value::String(x.to_string()))
                        .collect(),
                )
            }
            t if t == REG_DWORD && buf.len() >= 4 => {
                json!(u32::from_le_bytes(buf[0..4].try_into().unwrap()))
            }
            t if t == REG_QWORD && buf.len() >= 8 => {
                json!(u64::from_le_bytes(buf[0..8].try_into().unwrap()))
            }
            t if t == REG_BINARY => Value::Array(buf.into_iter().map(|b| json!(b)).collect()),
            _ => Value::Null,
        }
    }
}

fn reg_subkeys(hk: HKEY) -> Vec<String> {
    let mut out = Vec::new();
    // SAFETY: Win32/COM FFI call with valid pointers, handles, and initialized buffers.
    unsafe {
        for i in 0u32.. {
            let mut buf = [0u16; 260];
            let mut len = buf.len() as u32;
            if RegEnumKeyExW(
                hk,
                i,
                PWSTR(buf.as_mut_ptr()),
                &mut len,
                None,
                PWSTR::null(),
                None,
                None,
            )
            .is_err()
            {
                break;
            }
            out.push(String::from_utf16_lossy(&buf[..len as usize]));
        }
    }
    out
}

fn reg_value_names(hk: HKEY) -> Vec<String> {
    let mut out = Vec::new();
    // SAFETY: Win32/COM FFI call with valid pointers, handles, and initialized buffers.
    unsafe {
        for i in 0u32.. {
            let mut buf = [0u16; 260];
            let mut len = buf.len() as u32;
            if RegEnumValueW(
                hk,
                i,
                PWSTR(buf.as_mut_ptr()),
                &mut len,
                None,
                None,
                None,
                None,
            )
            .is_err()
            {
                break;
            }
            out.push(String::from_utf16_lossy(&buf[..len as usize]));
        }
    }
    out
}

// ---- Ops ----

fn extract_hex_after(s: &str, prefix: &str, len: usize) -> Option<String> {
    let u = s.to_ascii_uppercase();
    let idx = u.find(prefix)?;
    let rest = &u[idx + prefix.len()..];
    if rest.len() >= len && rest[..len].bytes().all(|b| b.is_ascii_hexdigit()) {
        Some(rest[..len].to_string())
    } else {
        None
    }
}

fn extract_vid_pid(s: &str) -> Option<(String, String)> {
    let u = s.to_ascii_uppercase();
    let idx = u.find("VID_")?;
    let rest = &u[idx + 4..];
    if rest.len() < 13 || &rest[4..9] != "&PID_" {
        return None;
    }
    let vid = &rest[0..4];
    let pid = &rest[9..13];
    if vid.bytes().all(|b| b.is_ascii_hexdigit()) && pid.bytes().all(|b| b.is_ascii_hexdigit()) {
        Some((vid.to_string(), pid.to_string()))
    } else {
        None
    }
}

pub fn gpu_power() -> Vec<Value> {
    let mut r = Vec::new();
    for d in devices(true) {
        let cls = dev_prop_str(d.inst, PKEY_CLASS).unwrap_or_default();
        if !cls.eq_ignore_ascii_case("Display") {
            continue;
        }
        let mut ds = -1i32;
        if let Some((_, buf)) = dev_prop_raw(d.inst, PKEY_POWERDATA) {
            if buf.len() >= 8 {
                ds = i32::from_le_bytes(buf[4..8].try_into().unwrap()) - 1;
            }
        }
        r.push(json!({ "name": d.name, "id": d.id, "d": ds }));
    }
    r
}

pub fn bluetooth() -> Vec<Value> {
    let all = devices(false);
    let top: Vec<&Dev> = all
        .iter()
        .filter(|d| {
            (d.id.starts_with("BTHENUM\\DEV_") || d.id.starts_with("BTHLE\\DEV_"))
                && extract_hex_after(&d.id, "DEV_", 12).is_some()
        })
        .collect();
    let hid: Vec<&Dev> = all
        .iter()
        .filter(|d| {
            d.status == "OK" && d.id.starts_with("HID\\") && extract_vid_pid(&d.id).is_some()
        })
        .collect();

    let mut bats: Vec<(String, i64)> = Vec::new();
    let mut bat_of: HashMap<String, i64> = HashMap::new();
    for d in &all {
        let is_bt = d.id.starts_with("BTHENUM\\")
            || d.id.starts_with("BTHLE\\")
            || d.id.starts_with("BTHLEDEVICE\\");
        let is_hid =
            d.status == "OK" && d.id.starts_with("HID\\") && extract_vid_pid(&d.id).is_some();
        if !is_bt && !is_hid {
            continue;
        }
        if let Some(v) = dev_prop_int(d.inst, PKEY_BATTERY) {
            bats.push((d.id.clone(), v));
            bat_of.insert(d.id.to_ascii_uppercase(), v);
        }
    }

    let mut out = Vec::new();
    for d in top {
        let mac = extract_hex_after(&d.id, "DEV_", 12).unwrap_or_default();
        let bat = bats
            .iter()
            .find(|(k, _)| contains_ci(k, &mac))
            .map(|(_, v)| json!(v))
            .unwrap_or(Value::Null);
        let conn = dev_prop_bool(d.inst, PKEY_CONNECTED).unwrap_or(false);
        out.push(json!({
            "name": d.name,
            "le": d.id.starts_with("BTHLE"),
            "connected": conn,
            "battery": bat,
        }));
    }
    let mut seen_usb = HashSet::new();
    for h in hid {
        let Some(&v) = bat_of.get(&h.id.to_ascii_uppercase()) else {
            continue;
        };
        let Some(ref name) = h.name else { continue };
        if name.is_empty() {
            continue;
        }
        if let Some((vid, pid)) = extract_vid_pid(&h.id) {
            let vp = format!("VID_{vid}&PID_{pid}");
            if seen_usb.insert(vp) {
                out.push(json!({
                    "name": name,
                    "le": false,
                    "connected": true,
                    "battery": v,
                }));
            }
        }
    }
    out
}

pub fn std_battery_bt() -> Value {
    let pnp = devices(false);
    let all: Vec<&Dev> = pnp
        .iter()
        .filter(|d| {
            (d.id.starts_with("BTHLE\\DEV_") || d.id.starts_with("BTHENUM\\DEV_"))
                && extract_hex_after(&d.id, "DEV_", 12).is_some()
        })
        .collect();
    let kids: Vec<&Dev> = pnp
        .iter()
        .filter(|d| d.id.starts_with("BTHLEDEVICE\\{") || d.id.starts_with("BTHENUM\\{"))
        .collect();
    let mut bt = Vec::new();
    for d in all {
        let addr = extract_hex_after(&d.id, "DEV_", 12).unwrap_or_default();
        let mine: Vec<&&Dev> = kids.iter().filter(|k| contains_ci(&k.id, &addr)).collect();
        let ids = mine
            .iter()
            .find(|k| extract_hex_after(&k.id, "VID&", 6).is_some())
            .map(|k| k.id.clone())
            .unwrap_or_default();
        let mut bat = dev_prop_int(d.inst, PKEY_BATTERY);
        if bat.is_none() {
            for k in &mine {
                if let Some(kb) = dev_prop_int(k.inst, PKEY_BATTERY) {
                    bat = Some(kb);
                    break;
                }
            }
        }
        let conn = dev_prop_bool(d.inst, PKEY_CONNECTED).unwrap_or(d.status == "OK");
        let last = dev_prop_filetime(d.inst, PKEY_LASTCONNECTED);
        bt.push(json!({
            "instanceId": d.id,
            "name": d.name,
            "status": d.status,
            "connected": conn,
            "battery": bat,
            "address": addr,
            "ids": ids,
            "lastConnected": last,
        }));
    }
    json!({ "bt": bt, "hid": Value::Null })
}

pub fn pc_map() -> Value {
    let cpu = wmi::query("root\\cimv2", "SELECT Name FROM Win32_Processor", &["Name"])
        .ok()
        .and_then(|rows| rows.into_iter().next())
        .and_then(|r| r.get("Name").and_then(|v| v.as_str()).map(|s| s.trim().to_string()));

    let gpus: Vec<Value> = wmi::query(
        "root\\cimv2",
        "SELECT Name, PNPDeviceID FROM Win32_VideoController",
        &["Name", "PNPDeviceID"],
    )
    .unwrap_or_default()
    .into_iter()
    .filter(|g| {
        g.get("PNPDeviceID")
            .and_then(|v| v.as_str())
            .map(|s| s.to_ascii_uppercase().starts_with("PCI"))
            .unwrap_or(false)
    })
    .map(|g| json!({ "name": g.get("Name"), "pnp": g.get("PNPDeviceID") }))
    .collect();

    let board = wmi::query(
        "root\\cimv2",
        "SELECT Manufacturer, Product FROM Win32_BaseBoard",
        &["Manufacturer", "Product"],
    )
    .ok()
    .and_then(|rows| rows.into_iter().next());
    let board_val = json!({
        "maker": board.as_ref().and_then(|b| b.get("Manufacturer")),
        "model": board.as_ref().and_then(|b| b.get("Product")),
    });

    let ram: Vec<Value> = wmi::query(
        "root\\cimv2",
        "SELECT PartNumber, Capacity, DeviceLocator, BankLabel FROM Win32_PhysicalMemory",
        &["PartNumber", "Capacity", "DeviceLocator", "BankLabel"],
    )
    .unwrap_or_default()
    .into_iter()
    .map(|m| {
        let part = m
            .get("PartNumber")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let cap = m
            .get("Capacity")
            .and_then(|v| {
                v.as_f64()
                    .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()))
            })
            .unwrap_or(0.0);
        let gb = (cap / 1_073_741_824.0).round();
        json!({
            "part": part,
            "gb": gb,
            "slot": m.get("DeviceLocator"),
            "bank": m.get("BankLabel"),
        })
    })
    .collect();

    let present = devices(true);
    let mut usb = Vec::new();
    let mut lamp_arrays = 0usize;
    let mut smbus = Vec::new();

    for d in &present {
        if d.name.as_deref().map(|n| contains_ci(n, "SMBus")).unwrap_or(false) {
            if let Some(ref n) = d.name {
                smbus.push(json!(n));
            }
        }
        let hw = dev_prop_str_list(d.inst, PKEY_HWIDS);
        if d.id.starts_with("HID\\") && hw.iter().any(|h| contains_ci(h, "UP:0059")) {
            lamp_arrays += 1;
        }
        if !(d.id.starts_with("USB\\") || d.id.starts_with("HID\\")) {
            continue;
        }
        let Some((vid, pid)) = extract_vid_pid(&d.id) else {
            continue;
        };
        let mut pages = Vec::new();
        for h in &hw {
            let hu = h.to_ascii_uppercase();
            if let Some(pos) = hu.find("UP:FF") {
                if hu.len() >= pos + 12 && &hu[pos + 7..pos + 10] == "_U:" {
                    let up = &hu[pos + 3..pos + 7];
                    let u = &hu[pos + 10..pos + 14];
                    if u.len() == 4
                        && up.bytes().all(|b| b.is_ascii_hexdigit())
                        && u.bytes().all(|b| b.is_ascii_hexdigit())
                    {
                        pages.push(json!(format!("{up}:{u}")));
                    }
                }
            }
        }
        usb.push(json!({
            "vid": vid.to_ascii_lowercase(),
            "pid": pid.to_ascii_lowercase(),
            "name": d.name,
            "kb": hw.iter().any(|h| contains_ci(h, "UP:0001_U:0006")),
            "mouse": hw.iter().any(|h| contains_ci(h, "UP:0001_U:0002")),
            "onUsb": d.id.starts_with("USB\\"),
            "pages": pages,
        }));
    }

    json!({
        "cpu": cpu,
        "gpus": gpus,
        "board": board_val,
        "ram": ram,
        "usb": usb,
        "lampArrays": lamp_arrays,
        "smbus": smbus,
    })
}

pub fn display_read() -> Value {
    let key = r"Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.bluelightreduction.bluelightreductionstate\windows.data.bluelightreduction.bluelightreductionstate";
    let nl = match reg_value(HKEY_CURRENT_USER, key, "Data") {
        Value::Array(arr) => {
            let s = arr
                .iter()
                .filter_map(|v| v.as_u64().map(|b| format!("{b:02X}")))
                .collect::<Vec<_>>()
                .join(" ");
            Value::String(s)
        }
        _ => Value::Null,
    };
    json!({
        "screens": pc_native::display_read(),
        "nightLight": nl,
    })
}

pub fn sensors() -> Value {
    let mut errors = Vec::<String>::new();
    let cpu_info = wmi::query(
        "root\\cimv2",
        "SELECT Name, MaxClockSpeed FROM Win32_Processor",
        &["Name", "MaxClockSpeed"],
    )
    .ok()
    .and_then(|rows| rows.into_iter().next());
    let cpu_name = cpu_info
        .as_ref()
        .and_then(|p| p.get("Name").and_then(|v| v.as_str()).map(|s| s.trim().to_string()));
    let base_mhz = cpu_info
        .as_ref()
        .and_then(|p| p.get("MaxClockSpeed").and_then(|v| v.as_f64()))
        .unwrap_or(0.0);

    let cpu = match wmi::query(
        "root\\cimv2",
        "SELECT PercentProcessorUtility, PercentProcessorPerformance FROM Win32_PerfFormattedData_Counters_ProcessorInformation WHERE Name='_Total'",
        &["PercentProcessorUtility", "PercentProcessorPerformance"],
    ) {
        Ok(rows) => {
            if let Some(pi) = rows.into_iter().next() {
                let util = pi
                    .get("PercentProcessorUtility")
                    .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
                    .unwrap_or(0.0);
                let perf = pi
                    .get("PercentProcessorPerformance")
                    .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
                    .unwrap_or(0.0);
                let mhz = if base_mhz != 0.0 && perf != 0.0 {
                    json!((base_mhz * perf / 100.0).round() as i64)
                } else {
                    Value::Null
                };
                let load = (util.round() as i64).min(100);
                json!({ "name": cpu_name, "loadPct": load, "clockMHz": mhz })
            } else {
                errors.push("cpu: no processor counters".into());
                json!({ "name": cpu_name, "loadPct": Value::Null, "clockMHz": Value::Null })
            }
        }
        Err(e) => {
            errors.push(format!("cpu: {e}"));
            json!({ "name": cpu_name, "loadPct": Value::Null, "clockMHz": Value::Null })
        }
    };

    let gpus = pc_native::gpu_sensors_read();
    let zones = match wmi::query(
        "root\\cimv2",
        "SELECT Name, HighPrecisionTemperature, Temperature FROM Win32_PerfFormattedData_Counters_ThermalZoneInformation",
        &["Name", "HighPrecisionTemperature", "Temperature"],
    ) {
        Ok(rows) => rows
            .into_iter()
            .map(|z| {
                let tk = z
                    .get("HighPrecisionTemperature")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                let k = z.get("Temperature").and_then(|v| v.as_i64()).unwrap_or(0);
                json!({ "name": z.get("Name"), "tenthsK": tk, "kelvin": k })
            })
            .collect(),
        Err(e) => {
            errors.push(format!("zones: {e}"));
            Vec::new()
        }
    };

    json!({
        "gpus": gpus,
        "zones": zones,
        "cpu": cpu,
        "errors": errors,
    })
}

pub fn installed() -> Vec<Value> {
    let mut r = Vec::new();
    let roots = [
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            HKEY_CURRENT_USER,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
    ];
    for (hive, path) in roots {
        let Some(hk) = reg_open(hive, path) else {
            continue;
        };
        for sub in reg_subkeys(hk) {
            let full = format!("{path}\\{sub}");
            let Some(sk) = reg_open(hive, &full) else {
                continue;
            };
            if let Value::String(name) = reg_value_hk(sk, "DisplayName") {
                if !name.is_empty() {
                    let ver = match reg_value_hk(sk, "DisplayVersion") {
                        Value::String(s) if !s.is_empty() => Value::String(s),
                        _ => Value::Null,
                    };
                    r.push(json!({ "name": name, "version": ver }));
                }
            }
            // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
            unsafe {
                let _ = RegCloseKey(sk);
            }
        }
        // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
        unsafe {
            let _ = RegCloseKey(hk);
        }
    }
    r
}

pub fn eqapo(list: &[Value]) -> Vec<Value> {
    const APO_CLSID: &str = "EACD2258-FCAC-4FF4-B36D-419E924A6D79";
    let mut r = Vec::new();
    for item in list {
        let Some(arr) = item.as_array() else { continue };
        if arr.len() < 2 {
            continue;
        }
        let Some(flow) = arr[0].as_str() else { continue };
        let Some(guid) = arr[1].as_str() else { continue };
        if (flow != "Render" && flow != "Capture")
            || guid.len() != 38
            || !guid.starts_with('{')
            || !guid.ends_with('}')
        {
            continue;
        }
        let base = format!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\{flow}\{guid}");
        let mut state = String::new();
        let mut name = Value::Null;
        let mut on = false;
        if let Some(hk) = reg_open(HKEY_LOCAL_MACHINE, &base) {
            match reg_value_hk(hk, "DeviceState") {
                Value::Number(n) => state = n.to_string(),
                Value::String(s) => state = s,
                _ => {}
            }
            // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
            unsafe {
                let _ = RegCloseKey(hk);
            }
        }
        if let Some(fx) = reg_open(HKEY_LOCAL_MACHINE, &format!("{base}\\FxProperties")) {
            for vn in reg_value_names(fx) {
                match reg_value_hk(fx, &vn) {
                    Value::String(s) if contains_ci(&s, APO_CLSID) => {
                        on = true;
                        break;
                    }
                    Value::Array(arr)
                        if arr.iter().any(|x| {
                            x.as_str().map(|s| contains_ci(s, APO_CLSID)).unwrap_or(false)
                        }) =>
                    {
                        on = true;
                        break;
                    }
                    _ => {}
                }
            }
            // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
            unsafe {
                let _ = RegCloseKey(fx);
            }
        }
        if let Some(pr) = reg_open(HKEY_LOCAL_MACHINE, &format!("{base}\\Properties")) {
            let v = reg_value_hk(pr, "{a45c254e-df1c-4efd-8020-67d146a850e0},2");
            if let Value::String(s) = v {
                name = Value::String(s);
            }
            // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
            unsafe {
                let _ = RegCloseKey(pr);
            }
        }
        r.push(json!({
            "flow": flow,
            "guid": guid,
            "state": state,
            "on": on,
            "name": name,
        }));
    }
    r
}

fn proc_snapshot() -> Vec<(u32, String)> {
    let mut out = Vec::new();
    // SAFETY: Win32 system/process API call with valid handles and caller-owned output buffers.
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return out;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snap, &mut entry).is_ok() {
            loop {
                let len = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                out.push((entry.th32ProcessID, name));
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    out
}

pub fn procs() -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for (pid, name) in proc_snapshot() {
        let label = if pid == 0 {
            "System Idle Process".to_string()
        } else {
            name
        };
        let key = label.to_ascii_lowercase();
        if !label.is_empty() && seen.insert(key) {
            out.push(label);
        }
    }
    out
}

pub fn running(names: &[Value]) -> Value {
    let procs_lower: HashSet<String> = proc_snapshot()
        .into_iter()
        .map(|(_, n)| {
            let lower = n.to_ascii_lowercase();
            lower.strip_suffix(".exe").unwrap_or(&lower).to_string()
        })
        .collect();
    let mut r = Map::new();
    for x in names {
        let Some(n) = x.as_str() else { continue };
        if n.is_empty() || n.len() > 64 {
            continue;
        }
        r.insert(n.into(), json!(procs_lower.contains(&n.to_ascii_lowercase())));
    }
    Value::Object(r)
}

pub fn pawnio() -> Value {
    let mut app = false;
    let mut ver = Value::Null;
    let path = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
    if let Some(hk) = reg_open(HKEY_LOCAL_MACHINE, path) {
        for sub in reg_subkeys(hk) {
            if let Some(sk) = reg_open(HKEY_LOCAL_MACHINE, &format!("{path}\\{sub}")) {
                if let Value::String(dn) = reg_value_hk(sk, "DisplayName") {
                    if dn.eq_ignore_ascii_case("PawnIO") {
                        app = true;
                        if let Value::String(v) = reg_value_hk(sk, "DisplayVersion") {
                            if !v.is_empty() {
                                ver = Value::String(v);
                            }
                        }
                        // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
                        unsafe {
                            let _ = RegCloseKey(sk);
                        }
                        break;
                    }
                }
                // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
                unsafe {
                    let _ = RegCloseKey(sk);
                }
            }
        }
        // SAFETY: Handle/key/icon is valid and owned by this scope or checked before closing.
        unsafe {
            let _ = RegCloseKey(hk);
        }
    }
    let svc = !reg_value(
        HKEY_LOCAL_MACHINE,
        r"SYSTEM\CurrentControlSet\Services\PawnIO",
        "ImagePath",
    )
    .is_null();
    json!({ "app": app, "version": ver, "service": svc })
}

// ---- PcCheck ----

fn run_cmd(exe: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(exe).args(args).output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn format_wmi_date(s: &str) -> Value {
    if s.len() >= 8 && s[..8].bytes().all(|b| b.is_ascii_digit()) {
        json!(format!("{}-{}-{}", &s[0..4], &s[4..6], &s[6..8]))
    } else {
        Value::Null
    }
}

fn parse_wevt_events(xml: &str, is_whea: bool) -> Vec<Value> {
    let mut out = Vec::new();
    for chunk in xml.split("<Event ").skip(1) {
        let at = chunk
            .split("SystemTime='")
            .nth(1)
            .and_then(|s| s.split('\'').next())
            .map(String::from);
        if is_whea {
            let id = chunk
                .split("<EventID")
                .nth(1)
                .and_then(|s| s.split('>').nth(1))
                .and_then(|s| s.split('<').next())
                .and_then(|s| s.parse::<i64>().ok());
            let level = chunk
                .split("<Level>")
                .nth(1)
                .and_then(|s| s.split('<').next())
                .and_then(|s| s.parse::<i64>().ok());
            out.push(json!({ "at": at, "id": id, "level": level }));
        } else {
            let param = chunk
                .split("<Data")
                .nth(1)
                .and_then(|s| s.split('>').nth(1))
                .and_then(|s| s.split('<').next())
                .unwrap_or("")
                .to_string();
            out.push(json!({ "at": at, "param": param }));
        }
    }
    out
}

fn power_facts() -> Result<Value, String> {
    // SAFETY: Win32 power management API with valid GUID/struct pointers.
    unsafe {
        let mut ap: *mut GUID = std::ptr::null_mut();
        if PowerGetActiveScheme(0, &mut ap) != 0 || ap.is_null() {
            return Err("the active power plan could not be read".into());
        }
        let act = *ap;
        LocalFree(ap as *mut c_void);

        let mut plans = Vec::new();
        for i in 0u32.. {
            let mut gb = [0u8; 16];
            let mut gs: u32 = 16;
            if PowerEnumerate(
                0,
                std::ptr::null(),
                std::ptr::null(),
                16, // ACCESS_SCHEME
                i,
                gb.as_mut_ptr(),
                &mut gs,
            ) != 0
            {
                break;
            }
            let g: GUID = std::ptr::read_unaligned(gb.as_ptr() as *const GUID);
            let mut ns: u32 = 0;
            PowerReadFriendlyName(0, &g, std::ptr::null(), std::ptr::null(), std::ptr::null_mut(), &mut ns);
            let mut name = String::new();
            if ns > 0 {
                let mut nb = vec![0u8; ns as usize];
                if PowerReadFriendlyName(
                    0,
                    &g,
                    std::ptr::null(),
                    std::ptr::null(),
                    nb.as_mut_ptr(),
                    &mut ns,
                ) == 0
                {
                    let u16s: Vec<u16> = nb[..ns as usize]
                        .chunks_exact(2)
                        .map(|c| u16::from_le_bytes([c[0], c[1]]))
                        .take_while(|&w| w != 0)
                        .collect();
                    name = String::from_utf16_lossy(&u16s);
                }
            }
            plans.push(json!({ "guid": guid_to_string(&g), "name": name }));
        }

        let overlay = match reg_value(
            HKEY_LOCAL_MACHINE,
            r"SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes",
            "ActiveOverlayAcPowerScheme",
        ) {
            Value::String(s) => s,
            _ => String::new(),
        };
        let mut power = Map::new();
        power.insert("active".into(), json!(guid_to_string(&act)));
        power.insert("plans".into(), Value::Array(plans));
        power.insert("overlay".into(), json!(overlay));

        let sub = GUID {
            data1: 0x19CB_B8FA,
            data2: 0x5279,
            data3: 0x450E,
            data4: [0x9F, 0xAC, 0x8A, 0x3D, 0x5F, 0xED, 0xD0, 0xC1],
        };
        let set = GUID {
            data1: 0x12BB_EBE6,
            data2: 0x58D6,
            data3: 0x4636,
            data4: [0x95, 0xBB, 0x32, 0x17, 0xEF, 0x86, 0x7C, 0x1A],
        };
        let mut idx: u32 = 0;
        if PowerReadACValueIndex(0, &act, &sub, &set, &mut idx) == 0 {
            power.insert("wifiSaveAc".into(), json!(idx));
        }
        Ok(Value::Object(power))
    }
}

fn wifi_field(text: &str, label: &str) -> Option<String> {
    let lower_lbl = label.to_ascii_lowercase();
    for line in text.lines() {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().to_ascii_lowercase() == lower_lbl {
                let val = v.trim();
                if !val.is_empty() {
                    return Some(val.to_string());
                }
            }
        }
    }
    None
}

pub fn pc_check() -> Value {
    let o = Arc::new(Mutex::new(json!({
        "volumes": [],
        "disks": [],
        "reliability": [],
        "video": [],
        "ram": [],
        "board": Value::Null,
        "devices": [],
        "events": Value::Null,
        "restart": Value::Null,
        "denied": [],
        "errors": [],
    })));
    let tune = Arc::new(Mutex::new(Map::new()));

    let note = |o_ref: &Arc<Mutex<Value>>, part: &str, msg: &str| {
        let mut g = o_ref.lock().unwrap();
        let m = msg.to_ascii_lowercase();
        if m.contains("denied")
            || m.contains("not available to the client")
            || m.contains("unauthorized")
            || m.contains("privilege")
        {
            if let Some(arr) = g.get_mut("denied").and_then(|v| v.as_array_mut()) {
                arr.push(json!(part));
            }
        } else if let Some(arr) = g.get_mut("errors").and_then(|v| v.as_array_mut()) {
            arr.push(json!(format!("{part}: {msg}")));
        }
    };

    let mut handles = Vec::new();

    // 1. Hardware
    {
        let o_c = Arc::clone(&o);
        handles.push(thread::spawn(move || {
            match wmi::query(
                "root\\cimv2",
                "SELECT DeviceID, VolumeName, Size, FreeSpace FROM Win32_LogicalDisk WHERE DriveType=3",
                &["DeviceID", "VolumeName", "Size", "FreeSpace"],
            ) {
                Ok(rows) => {
                    let vols: Vec<Value> = rows
                        .into_iter()
                        .map(|v| {
                            let sz = v.get("Size").and_then(|x| x.as_f64().or_else(|| x.as_str().and_then(|s| s.parse().ok()))).unwrap_or(0.0);
                            let fr = v.get("FreeSpace").and_then(|x| x.as_f64().or_else(|| x.as_str().and_then(|s| s.parse().ok()))).unwrap_or(0.0);
                            json!({ "drive": v.get("DeviceID"), "label": v.get("VolumeName"), "size": sz, "free": fr })
                        })
                        .collect();
                    o_c.lock().unwrap()["volumes"] = Value::Array(vols);
                }
                Err(e) => note(&o_c, "volumes", &e),
            }

            match wmi::query(
                "root\\Microsoft\\Windows\\Storage",
                "SELECT DeviceId, FriendlyName, MediaType, BusType, HealthStatus, Size FROM MSFT_PhysicalDisk",
                &["DeviceId", "FriendlyName", "MediaType", "BusType", "HealthStatus", "Size"],
            ) {
                Ok(rows) => {
                    const BUS: &[&str] = &["Unknown", "SCSI", "ATAPI", "ATA", "1394", "SSA", "Fibre Channel", "USB", "RAID", "iSCSI", "SAS", "SATA", "SD", "MMC", "Virtual", "File Backed Virtual", "Spaces", "NVMe", "SCM", "UFS"];
                    let disks: Vec<Value> = rows
                        .into_iter()
                        .map(|d| {
                            let media = match d.get("MediaType").and_then(|x| x.as_i64()) {
                                Some(0) => "Unspecified",
                                Some(3) => "HDD",
                                Some(4) => "SSD",
                                Some(5) => "SCM",
                                _ => "Unspecified",
                            };
                            let bus_idx = d.get("BusType").and_then(|x| x.as_i64()).unwrap_or(-1);
                            let bus = if bus_idx >= 0 && (bus_idx as usize) < BUS.len() {
                                BUS[bus_idx as usize]
                            } else {
                                "Unknown"
                            };
                            let health = match d.get("HealthStatus").and_then(|x| x.as_i64()) {
                                Some(0) => "Healthy",
                                Some(1) => "Warning",
                                Some(2) => "Unhealthy",
                                _ => "Unknown",
                            };
                            let sz = d.get("Size").and_then(|x| x.as_f64().or_else(|| x.as_str().and_then(|s| s.parse().ok()))).unwrap_or(0.0);
                            json!({
                                "id": d.get("DeviceId").and_then(|x| x.as_str()).unwrap_or(""),
                                "name": d.get("FriendlyName"),
                                "media": media,
                                "bus": bus,
                                "health": health,
                                "status": "",
                                "size": sz,
                            })
                        })
                        .collect();
                    o_c.lock().unwrap()["disks"] = Value::Array(disks);
                }
                Err(e) => note(&o_c, "disks", &e),
            }

            match wmi::query(
                "root\\cimv2",
                "SELECT Name, AdapterCompatibility, DriverVersion, DriverDate, PNPDeviceID FROM Win32_VideoController",
                &["Name", "AdapterCompatibility", "DriverVersion", "DriverDate", "PNPDeviceID"],
            ) {
                Ok(rows) => {
                    let vids: Vec<Value> = rows
                        .into_iter()
                        .map(|v| {
                            let date = v.get("DriverDate").and_then(|x| x.as_str()).map(format_wmi_date).unwrap_or(Value::Null);
                            json!({
                                "name": v.get("Name"),
                                "maker": v.get("AdapterCompatibility"),
                                "version": v.get("DriverVersion"),
                                "date": date,
                                "pnp": v.get("PNPDeviceID"),
                            })
                        })
                        .collect();
                    o_c.lock().unwrap()["video"] = Value::Array(vids);
                }
                Err(e) => note(&o_c, "video", &e),
            }

            match wmi::query(
                "root\\cimv2",
                "SELECT DeviceLocator, Manufacturer, PartNumber, BankLabel, Speed, ConfiguredClockSpeed, Capacity, SMBIOSMemoryType FROM Win32_PhysicalMemory",
                &["DeviceLocator", "Manufacturer", "PartNumber", "BankLabel", "Speed", "ConfiguredClockSpeed", "Capacity", "SMBIOSMemoryType"],
            ) {
                Ok(rows) => {
                    let ram: Vec<Value> = rows
                        .into_iter()
                        .map(|m| {
                            let part = m.get("PartNumber").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
                            let cap = m.get("Capacity").and_then(|x| x.as_f64().or_else(|| x.as_str().and_then(|s| s.parse().ok()))).unwrap_or(0.0);
                            json!({
                                "slot": m.get("DeviceLocator"),
                                "maker": m.get("Manufacturer"),
                                "part": part,
                                "bank": m.get("BankLabel").and_then(|x| x.as_str()).unwrap_or(""),
                                "speed": m.get("Speed"),
                                "configured": m.get("ConfiguredClockSpeed"),
                                "gb": (cap / 1_073_741_824.0).round(),
                                "type": m.get("SMBIOSMemoryType"),
                            })
                        })
                        .collect();
                    o_c.lock().unwrap()["ram"] = Value::Array(ram);
                }
                Err(e) => note(&o_c, "ram", &e),
            }

            match wmi::query("root\\cimv2", "SELECT Manufacturer, Product FROM Win32_BaseBoard", &["Manufacturer", "Product"]) {
                Ok(rows) => {
                    let b = rows.into_iter().next();
                    o_c.lock().unwrap()["board"] = json!({
                        "maker": b.as_ref().and_then(|x| x.get("Manufacturer")),
                        "model": b.as_ref().and_then(|x| x.get("Product")),
                    });
                }
                Err(e) => note(&o_c, "board", &e),
            }
        }));
    }

    // 2. Devices
    {
        let o_c = Arc::clone(&o);
        handles.push(thread::spawn(move || {
            let devs: Vec<Value> = devices(true)
                .into_iter()
                .filter(|d| d.problem != 0 || d.status == "Error")
                .map(|d| {
                    let cls = dev_prop_str(d.inst, PKEY_CLASS);
                    json!({
                        "name": d.name,
                        "cls": cls,
                        "status": d.status,
                        "problem": d.problem,
                        "id": d.id,
                    })
                })
                .collect();
            o_c.lock().unwrap()["devices"] = Value::Array(devs);
        }));
    }

    // 3. Events
    {
        let o_c = Arc::clone(&o);
        handles.push(thread::spawn(move || {
            let win_dir = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
            let wevt = Path::new(&win_dir).join("System32").join("wevtutil.exe");
            let wevt_s = wevt.to_string_lossy().into_owned();
            let q1 = "*[System[Provider[@Name='Microsoft-Windows-WER-SystemErrorReporting'] and (EventID=1001) and TimeCreated[timediff(@SystemTime) <= 2592000000]]]";
            let q2 = "*[System[Provider[@Name='Microsoft-Windows-WHEA-Logger'] and (Level=1 or Level=2 or Level=3) and TimeCreated[timediff(@SystemTime) <= 2592000000]]]";
            let bugchecks = run_cmd(&wevt_s, &["qe", "System", &format!("/q:{q1}"), "/f:xml", "/rd:true"])
                .map(|x| parse_wevt_events(&x, false))
                .unwrap_or_default();
            let whea = run_cmd(&wevt_s, &["qe", "System", &format!("/q:{q2}"), "/f:xml", "/rd:true"])
                .map(|x| parse_wevt_events(&x, true))
                .unwrap_or_default();
            o_c.lock().unwrap()["events"] = json!({ "bugchecks": bugchecks, "whea": whea });
        }));
    }

    // 4. Restart & DriverApps & Nvidia
    {
        let o_c = Arc::clone(&o);
        let t_c = Arc::clone(&tune);
        handles.push(thread::spawn(move || {
            let wu = reg_exists(
                HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired",
            );
            let cbs = reg_exists(
                HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending",
            );
            let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".into());
            let nv_app = Path::new(&pf).join(r"NVIDIA Corporation\NVIDIA App\CEF\NVIDIA App.exe");
            let amd_app = Path::new(&pf).join(r"AMD\CNext\CNext\RadeonSoftware.exe");
            {
                let mut g = o_c.lock().unwrap();
                g["restart"] = json!({ "cbs": cbs, "wu": wu });
                g["driverApps"] = json!({
                    "nvidia": if nv_app.exists() { json!(nv_app.to_string_lossy()) } else { Value::Null },
                    "amd": if amd_app.exists() { json!(amd_app.to_string_lossy()) } else { Value::Null },
                });
            }

            let win_dir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
            let nv_smi = Path::new(&win_dir).join(r"System32\nvidia-smi.exe");
            if nv_smi.exists() {
                let nv_s = nv_smi.to_string_lossy().into_owned();
                if let Some(v) = run_cmd(&nv_s, &["--query-gpu=driver_version", "--format=csv,noheader"]) {
                    if let Some(first) = v.lines().next().map(str::trim).filter(|s| !s.is_empty()) {
                        o_c.lock().unwrap()["nvidiaVersion"] = json!(first);
                    }
                }
                if let Some(mq) = run_cmd(&nv_s, &["-q", "-d", "MEMORY"]) {
                    let mut bar1 = None;
                    let mut vram = None;
                    for line in mq.lines() {
                        let t = line.trim();
                        if t.starts_with("BAR1 Memory Usage") {
                            bar1 = None;
                        }
                        if let Some((_, val)) = t.split_once(':') {
                            let val_n = val.trim().strip_suffix("MiB").map(str::trim).and_then(|s| s.parse::<i64>().ok());
                            if t.starts_with("Total") {
                                if bar1.is_none() && mq.contains("BAR1 Memory Usage") {
                                    // Handled below via section scan
                                }
                                let _ = val_n;
                            }
                        }
                    }
                    let mut sec = "";
                    for line in mq.lines() {
                        let t = line.trim();
                        if t.starts_with("FB Memory Usage") {
                            sec = "fb";
                        } else if t.starts_with("BAR1 Memory Usage") {
                            sec = "bar1";
                        } else if t.starts_with("Total") {
                            if let Some((_, val)) = t.split_once(':') {
                                if let Some(n) = val.trim().strip_suffix("MiB").map(str::trim).and_then(|s| s.parse::<i64>().ok()) {
                                    if sec == "fb" {
                                        vram = Some(n);
                                    } else if sec == "bar1" {
                                        bar1 = Some(n);
                                    }
                                }
                            }
                        }
                    }
                    if let Some(b) = bar1 {
                        let mut tg = t_c.lock().unwrap();
                        tg.insert("bar1MiB".into(), json!(b));
                        tg.insert("vramMiB".into(), vram.map(|x| json!(x)).unwrap_or(Value::Null));
                    }
                }
            }
        }));
    }

    // 5. Power + Settings
    {
        let o_c = Arc::clone(&o);
        let t_c = Arc::clone(&tune);
        handles.push(thread::spawn(move || {
            match power_facts() {
                Ok(p) => {
                    t_c.lock().unwrap().insert("power".into(), p);
                }
                Err(e) => {
                    if let Some(arr) = o_c.lock().unwrap().get_mut("errors").and_then(|v| v.as_array_mut()) {
                        arr.push(json!(format!("power: {e}")));
                    }
                }
            }
            let battery = wmi::query("root\\cimv2", "SELECT DeviceID FROM Win32_Battery", &["DeviceID"])
                .map(|r| json!(!r.is_empty()))
                .unwrap_or(Value::Null);
            let build = reg_value(
                HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Microsoft\Windows NT\CurrentVersion",
                "CurrentBuildNumber",
            )
            .as_str()
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
            let mut tg = t_c.lock().unwrap();
            tg.insert("battery".into(), battery);
            tg.insert("gameMode".into(), reg_value(HKEY_CURRENT_USER, r"Software\Microsoft\GameBar", "AutoGameModeEnabled"));
            tg.insert("bgRecord".into(), reg_value(HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\GameDVR", "HistoricalCaptureEnabled"));
            tg.insert("hags".into(), reg_value(HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\GraphicsDrivers", "HwSchMode"));
            tg.insert("dxGlobal".into(), match reg_value(HKEY_CURRENT_USER, r"Software\Microsoft\DirectX\UserGpuPreferences", "DirectXUserGlobalSettings") {
                Value::String(s) => json!(s),
                _ => json!(""),
            });
            tg.insert("windowsBuild".into(), json!(build));
            tg.insert("firmware".into(), reg_value(HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control", "PEFirmwareType"));
            tg.insert("mouseAccel".into(), match reg_value(HKEY_CURRENT_USER, r"Control Panel\Mouse", "MouseSpeed") {
                Value::String(s) => json!(s),
                _ => json!(""),
            });
        }));
    }

    // 6. Wired + Wifi + Latency
    {
        let t_c = Arc::clone(&tune);
        handles.push(thread::spawn(move || {
            if let Ok(rows) = wmi::query(
                "root\\StandardCimv2",
                "SELECT InterfaceDescription, ReceiveLinkSpeed, NdisMedium, InterfaceOperationalStatus, Hidden FROM MSFT_NetAdapter WHERE ConnectorPresent = TRUE",
                &["InterfaceDescription", "ReceiveLinkSpeed", "NdisMedium", "InterfaceOperationalStatus", "Hidden"],
            ) {
                let wired: Vec<Value> = rows
                    .into_iter()
                    .filter(|a| {
                        !a.get("Hidden").and_then(|v| v.as_bool()).unwrap_or(false)
                            && a.get("InterfaceOperationalStatus").and_then(|v| v.as_i64()).unwrap_or(0) == 1
                            && a.get("NdisMedium").and_then(|v| v.as_i64()).unwrap_or(-1) == 0
                    })
                    .map(|a| {
                        let bps = a.get("ReceiveLinkSpeed").and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))).unwrap_or(0.0);
                        json!({ "name": a.get("InterfaceDescription"), "bps": bps })
                    })
                    .collect();
                t_c.lock().unwrap().insert("wired".into(), Value::Array(wired));
            }
        }));
    }

    {
        let t_c = Arc::clone(&tune);
        handles.push(thread::spawn(move || {
            let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
            let netsh = Path::new(&sys_root).join(r"System32\netsh.exe");
            let netsh_s = netsh.to_string_lossy().into_owned();
            if let Some(wi) = run_cmd(&netsh_s, &["wlan", "show", "interfaces"]) {
                if wifi_field(&wi, "State").map(|s| s.eq_ignore_ascii_case("connected")).unwrap_or(false) {
                    let mut band = wifi_field(&wi, "Band").unwrap_or_default();
                    let ch_val: i32 = wifi_field(&wi, "Channel")
                        .unwrap_or_default()
                        .chars()
                        .filter(|c| c.is_ascii_digit())
                        .collect::<String>()
                        .parse()
                        .unwrap_or(0);
                    let rad = wifi_field(&wi, "Radio type");
                    if band.is_empty() || contains_ci(&band, "invalid") || contains_ci(&band, "unknown") {
                        if rad.as_deref().map(|r| contains_ci(r, "802.11be")).unwrap_or(false)
                            || ch_val == 133
                            || (ch_val > 14 && ch_val < 36)
                            || ch_val > 177
                        {
                            band = "6 GHz".into();
                        } else if ch_val > 14 {
                            band = "5 GHz".into();
                        } else if ch_val > 0 {
                            band = "2.4 GHz".into();
                        }
                    }
                    let ssid = wifi_field(&wi, "SSID");
                    let num_of = |s: Option<String>| -> f64 {
                        s.unwrap_or_default()
                            .chars()
                            .filter(|c| c.is_ascii_digit() || *c == '.')
                            .collect::<String>()
                            .parse()
                            .unwrap_or(0.0)
                    };
                    let ac = run_cmd(&netsh_s, &["wlan", "show", "autoconfig"]).unwrap_or_default();
                    let dr = run_cmd(&netsh_s, &["wlan", "show", "drivers"]).unwrap_or_default();
                    let radios = wifi_field(&dr, "Radio types supported").unwrap_or_default();
                    let mut five = false;
                    if let Some(nets) = run_cmd(&netsh_s, &["wlan", "show", "networks", "mode=bssid"]) {
                        let mut cur = String::new();
                        for ln in nets.lines() {
                            let t = ln.trim();
                            if t.starts_with("SSID ") {
                                if let Some((_, v)) = t.split_once(':') {
                                    cur = v.trim().to_string();
                                }
                            } else if t.starts_with("Channel") {
                                if let Some((_, v)) = t.split_once(':') {
                                    if let Ok(c) = v.trim().parse::<i32>() {
                                        if c > 14 && !cur.is_empty() {
                                            if ssid.as_deref().map(|s| s.eq_ignore_ascii_case(&cur)).unwrap_or(false) {
                                                five = true;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    t_c.lock().unwrap().insert(
                        "wifi".into(),
                        json!({
                            "name": wifi_field(&wi, "Name"),
                            "ssid": ssid,
                            "band": if band.is_empty() { Value::Null } else { json!(band) },
                            "channel": wifi_field(&wi, "Channel"),
                            "signal": wifi_field(&wi, "Signal"),
                            "radio": rad,
                            "rxMbps": num_of(wifi_field(&wi, "Receive rate (Mbps)")),
                            "txMbps": num_of(wifi_field(&wi, "Transmit rate (Mbps)")),
                            "autoConfig": contains_ci(&ac, "enabled on interface"),
                            "radios": radios,
                            "fiveNearby": five,
                        }),
                    );
                }
            }
        }));
    }

    // 7. Latency (default gateway + 1.1.1.1 via IcmpSendEcho)
    {
        let t_c = Arc::clone(&tune);
        handles.push(std::thread::spawn(move || {
            let routes = wmi::query(
                "root\\StandardCimv2",
                "SELECT NextHop, RouteMetric FROM MSFT_NetRoute WHERE DestinationPrefix='0.0.0.0/0'",
                &["NextHop", "RouteMetric"],
            )
            .unwrap_or_default();
            let mut best_gw: Option<(i64, String)> = None;
            for r in routes {
                let nh = r.get("NextHop").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if nh.is_empty() {
                    continue;
                }
                let metric = r.get("RouteMetric").and_then(|v| v.as_i64()).unwrap_or(0);
                if best_gw.as_ref().map(|(m, _)| metric < *m).unwrap_or(true) {
                    best_gw = Some((metric, nh));
                }
            }
            let gw = match best_gw {
                Some((_, s)) => s,
                None => return,
            };
            fn ping_three(host: &str) -> Vec<i64> {
                use std::net::Ipv4Addr;
                use std::str::FromStr;
                let ip = match Ipv4Addr::from_str(host) {
                    Ok(v) => v,
                    Err(_) => return Vec::new(),
                };
                let dest = u32::from_ne_bytes(ip.octets());
                extern "system" {
                    fn LoadLibraryA(lp_lib_file_name: *const u8) -> isize;
                    fn GetProcAddress(h_module: isize, lp_proc_name: *const u8) -> *const std::ffi::c_void;
                }
                // SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
                unsafe {
                    type FnCreate = unsafe extern "system" fn() -> *mut std::ffi::c_void;
                    type FnClose = unsafe extern "system" fn(*mut std::ffi::c_void) -> i32;
                    type FnSend = unsafe extern "system" fn(
                        *mut std::ffi::c_void,
                        u32,
                        *const std::ffi::c_void,
                        u16,
                        *const std::ffi::c_void,
                        *mut std::ffi::c_void,
                        u32,
                        u32,
                    ) -> u32;
                    let lib = LoadLibraryA(b"iphlpapi.dll\0".as_ptr());
                    if lib == 0 {
                        return Vec::new();
                    }
                    let p_create = GetProcAddress(lib, b"IcmpCreateFile\0".as_ptr());
                    let p_send = GetProcAddress(lib, b"IcmpSendEcho\0".as_ptr());
                    let p_close = GetProcAddress(lib, b"IcmpCloseHandle\0".as_ptr());
                    if p_create.is_null() || p_send.is_null() || p_close.is_null() {
                        return Vec::new();
                    }
                    let icmp_create: FnCreate = std::mem::transmute(p_create);
                    let icmp_send: FnSend = std::mem::transmute(p_send);
                    let icmp_close: FnClose = std::mem::transmute(p_close);
                    let h = icmp_create();
                    if h.is_null() || h as isize == -1 {
                        return Vec::new();
                    }
                    let payload = [b'd'; 32];
                    let mut reply = [0u8; 128];
                    let mut times = Vec::new();
                    for _ in 0..3 {
                        let cnt = icmp_send(
                            h,
                            dest,
                            payload.as_ptr() as *const _,
                            payload.len() as u16,
                            std::ptr::null(),
                            reply.as_mut_ptr() as *mut _,
                            reply.len() as u32,
                            200,
                        );
                        if cnt > 0 {
                            let status = u32::from_ne_bytes([reply[4], reply[5], reply[6], reply[7]]);
                            let rtt = u32::from_ne_bytes([reply[8], reply[9], reply[10], reply[11]]);
                            if status == 0 {
                                times.push(rtt as i64);
                            }
                        }
                    }
                    icmp_close(h);
                    times
                }
            }
            let gw_t = ping_three(&gw);
            if gw_t.is_empty() {
                return;
            }
            let in_t = ping_three("1.1.1.1");
            let gw_ms = ((gw_t.iter().sum::<i64>() as f64 / gw_t.len() as f64) * 10.0).round() / 10.0;
            let gw_jit = if gw_t.len() > 1 {
                gw_t.iter().max().unwrap() - gw_t.iter().min().unwrap()
            } else {
                0
            };
            let in_ms = if in_t.is_empty() {
                Value::Null
            } else {
                json!(((in_t.iter().sum::<i64>() as f64 / in_t.len() as f64) * 10.0).round() / 10.0)
            };
            let in_jit = if in_t.len() > 1 {
                in_t.iter().max().unwrap() - in_t.iter().min().unwrap()
            } else {
                0
            };
            t_c.lock().unwrap().insert(
                "latency".into(),
                json!({
                    "gw": gw,
                    "gwMs": gw_ms,
                    "gwJitter": gw_jit,
                    "inMs": in_ms,
                    "inJitter": in_jit,
                }),
            );
        }));
    }

    for h in handles {
        let _ = h.join();
    }

    let mut out = Arc::try_unwrap(o).unwrap().into_inner().unwrap();
    let t = Arc::try_unwrap(tune).unwrap().into_inner().unwrap();
    out["tune"] = Value::Object(t);
    out
}

pub fn handle(rest: &str) -> String {
    let q: Value = match serde_json::from_str(rest) {
        Ok(v) => v,
        Err(e) => return json!({ "ok": false, "error": e.to_string() }).to_string(),
    };
    let op = q.get("op").and_then(|v| v.as_str()).unwrap_or("");
    let res = match op {
        "bluetooth" => json!(bluetooth()),
        "pc-map" => pc_map(),
        "display-read" => display_read(),
        "sensors" => sensors(),
        "gpu-power" => json!(gpu_power()),
        "installed" => json!(installed()),
        "pc-check" => pc_check(),
        "std-battery-bt" => std_battery_bt(),
        "procs" => json!(procs()),
        "pawnio" => pawnio(),
        "running" => {
            let names = q.get("names").and_then(|v| v.as_array()).map(|v| v.as_slice()).unwrap_or(&[]);
            running(names)
        }
        "eqapo" => {
            let list = q.get("list").and_then(|v| v.as_array()).map(|v| v.as_slice()).unwrap_or(&[]);
            json!(eqapo(list))
        }
        "sleep-timer" => crate::ps_ops::sleep_timer(&q),
        "close-app-window" => {
            let title = q.get("title").and_then(|v| v.as_str()).unwrap_or("");
            crate::ps_ops::close_app_window(title)
        }
        "corsair-apo-read" => {
            let eps = q.get("endpoints").and_then(|v| v.as_str()).unwrap_or("");
            crate::ps_ops::corsair_apo_read(eps)
        }
        "laptop" => {
            let mode = q.get("mode").and_then(|v| v.as_str());
            crate::ps_ops::laptop(mode)
        }
        "learn-hid-list" => crate::ps_ops::learn_hid_list(),
        "startup-apps-read" => crate::ps_ops::startup_apps_read(),
        "startup-impact-read" => {
            let secs = q.get("testSeconds").and_then(|v| v.as_u64()).unwrap_or(0);
            crate::ps_ops::startup_impact_read(secs)
        }
        "sleep-monitors" => {
            let probe = q.get("probe").and_then(|v| v.as_bool()).unwrap_or(false);
            crate::ps_ops::sleep_monitors(probe)
        }
        "display-mode" => {
            let screen = q.get("screen").and_then(|v| v.as_str()).unwrap_or("");
            let width = q.get("width").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let height = q.get("height").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let hz = q.get("hz").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let persist = q.get("persist").and_then(|v| v.as_bool()).unwrap_or(false)
                || q.get("persist").and_then(|v| v.as_i64()) == Some(1);
            match crate::pc_native::display_set_mode(screen, width, height, hz, persist) {
                Ok(v) => v,
                Err(e) => return json!({ "ok": false, "error": e }).to_string(),
            }
        }
        "display-primary" => {
            let screen = q.get("screen").and_then(|v| v.as_str()).unwrap_or("");
            match crate::pc_native::display_set_primary(screen) {
                Ok(v) => v,
                Err(e) => return json!({ "ok": false, "error": e }).to_string(),
            }
        }
        "display-hdr" => {
            let screen = q.get("screen").and_then(|v| v.as_str()).unwrap_or("");
            let on = q.get("on").and_then(|v| v.as_bool()).unwrap_or(false)
                || q.get("on").and_then(|v| v.as_i64()) == Some(1);
            match crate::pc_native::display_set_hdr(screen, on) {
                Ok(v) => v,
                Err(e) => return json!({ "ok": false, "error": e }).to_string(),
            }
        }
        _ => return json!({ "ok": false, "error": format!("unknown pc op {op}") }).to_string(),
    };
    json!({ "ok": true, "result": res }).to_string()
}

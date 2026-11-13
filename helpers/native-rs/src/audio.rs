use crate::audio_com::*;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const PKEY_FRIENDLY_NAME: GUID = GUID {
    data1: 0xA45C_254E,
    data2: 0xDF1C,
    data3: 0x4EFD,
    data4: [0x80, 0x20, 0x67, 0xD1, 0x46, 0xA8, 0x50, 0xE0],
};
const PKEY_INSTANCE_ID: GUID = GUID {
    data1: 0xB3F8_FA53,
    data2: 0x0004,
    data3: 0x438E,
    data4: [0x90, 0x03, 0x51, 0xA4, 0x6E, 0x13, 0x9B, 0xFC],
};
const PKEY_IFACE_NAME: GUID = GUID {
    data1: 0x026E_516E,
    data2: 0xB814,
    data3: 0x414B,
    data4: [0x83, 0xCD, 0x85, 0x6D, 0x6F, 0xEF, 0x48, 0x22],
};
const PKEY_FORM_FACTOR: GUID = GUID {
    data1: 0x1DA5_D803,
    data2: 0xD492,
    data3: 0x4EDD,
    data4: [0x8C, 0x23, 0xE0, 0xC0, 0xFF, 0xEE, 0x7F, 0x0E],
};

fn to_wide(s: &str) -> Vec<u16> {
    let mut w: Vec<u16> = s.encode_utf16().collect();
    w.push(0);
    w
}

fn contains_ci(hay: &str, needle: &str) -> bool {
    hay.to_ascii_lowercase()
        .contains(&needle.to_ascii_lowercase())
}

// ---- WinAudio (audio-list, audio-set) ----

pub fn win_audio_list(m: Option<&str>) -> Result<Vec<Value>, String> {
    // SAFETY: COM apartment is initialized and interface pointers/vtable slots follow Windows ABI.
    unsafe {
        let en = create_enumerator()?;
        let mut out = Vec::new();
        for flow in 0..=1i32 {
            let mut col: *mut c_void = std::ptr::null_mut();
            if (vtbl::<IMMDeviceEnumeratorVtbl>(en).enum_audio_endpoints)(en, flow, 1, &mut col) != 0
                || col.is_null()
            {
                continue;
            }
            let mut n: u32 = 0;
            (vtbl::<IMMDeviceCollectionVtbl>(col).get_count)(col, &mut n);
            for i in 0..n {
                let mut d: *mut c_void = std::ptr::null_mut();
                if (vtbl::<IMMDeviceCollectionVtbl>(col).item)(col, i, &mut d) != 0 || d.is_null() {
                    continue;
                }
                let mut ps: *mut c_void = std::ptr::null_mut();
                let name = if (vtbl::<IMMDeviceVtbl>(d).open_property_store)(d, 0, &mut ps) == 0
                    && !ps.is_null()
                {
                    let s = prop_str(ps, PKEY_FRIENDLY_NAME, 14);
                    release(ps);
                    s
                } else {
                    String::new()
                };
                if let Some(pat) = m {
                    if !contains_ci(&name, pat) {
                        release(d);
                        continue;
                    }
                }
                let mut id_ptr: *mut u16 = std::ptr::null_mut();
                (vtbl::<IMMDeviceVtbl>(d).get_id)(d, &mut id_ptr);
                let id = cotask_to_string(id_ptr);

                let mut vol_ptr: *mut c_void = std::ptr::null_mut();
                if (vtbl::<IMMDeviceVtbl>(d).activate)(
                    d,
                    &IID_IAUDIO_ENDPOINT_VOLUME,
                    23,
                    std::ptr::null_mut(),
                    &mut vol_ptr,
                ) == 0
                    && !vol_ptr.is_null()
                {
                    let mut lvl: f32 = 0.0;
                    let mut muted: i32 = 0;
                    (vtbl::<IAudioEndpointVolumeVtbl>(vol_ptr).get_master_volume_level_scalar)(
                        vol_ptr, &mut lvl,
                    );
                    (vtbl::<IAudioEndpointVolumeVtbl>(vol_ptr).get_mute)(vol_ptr, &mut muted);
                    release(vol_ptr);
                    out.push(json!({
                        "flow": if flow == 0 { "playback" } else { "recording" },
                        "name": name,
                        "id": id,
                        "volume": (lvl * 100.0).round() as i32,
                        "muted": muted != 0,
                    }));
                }
                release(d);
            }
            release(col);
        }
        release(en);
        Ok(out)
    }
}

pub fn win_audio_set(id: &str, volume: i32, muted: i32) -> Result<Value, String> {
    // SAFETY: COM apartment is initialized and interface pointers/vtable slots follow Windows ABI.
    unsafe {
        let en = create_enumerator()?;
        let id_w = to_wide(id);
        let mut d: *mut c_void = std::ptr::null_mut();
        let hr = (vtbl::<IMMDeviceEnumeratorVtbl>(en).get_device)(en, id_w.as_ptr(), &mut d);
        release(en);
        if hr != 0 || d.is_null() {
            return Err("audio device not found".into());
        }
        let mut vol_ptr: *mut c_void = std::ptr::null_mut();
        let hr_a = (vtbl::<IMMDeviceVtbl>(d).activate)(
            d,
            &IID_IAUDIO_ENDPOINT_VOLUME,
            23,
            std::ptr::null_mut(),
            &mut vol_ptr,
        );
        release(d);
        if hr_a != 0 || vol_ptr.is_null() {
            return Err("audio device not found".into());
        }
        if volume >= 0 {
            let s = (volume.min(100) as f32) / 100.0;
            (vtbl::<IAudioEndpointVolumeVtbl>(vol_ptr).set_master_volume_level_scalar)(
                vol_ptr,
                s,
                &GUID::ZERO,
            );
        }
        if muted >= 0 {
            (vtbl::<IAudioEndpointVolumeVtbl>(vol_ptr).set_mute)(
                vol_ptr,
                if muted == 1 { 1 } else { 0 },
                &GUID::ZERO,
            );
        }
        release(vol_ptr);
    }
    let list = win_audio_list(None)?;
    list.into_iter()
        .find(|e| e.get("id").and_then(|v| v.as_str()) == Some(id))
        .ok_or_else(|| "audio device not found".into())
}

// ---- AudioDefault (usb-headsets, hs80-endpoints, set-enabled, set-default) ----

fn extract_usb_vid_pid(inst: &str) -> Option<String> {
    let upper = inst.to_ascii_uppercase();
    let idx = upper.find("USB\\VID_")?;
    let rest = &upper[idx + 8..];
    if rest.len() < 13 || &rest[4..9] != "&PID_" {
        return None;
    }
    let vid = &rest[0..4];
    let pid = &rest[9..13];
    if vid.bytes().all(|b| b.is_ascii_hexdigit()) && pid.bytes().all(|b| b.is_ascii_hexdigit()) {
        Some(format!("VID_{vid}&PID_{pid}"))
    } else {
        None
    }
}

pub fn headsets() -> Result<Vec<Value>, String> {
    struct Entry {
        usb: String,
        device: String,
        playback: Vec<Value>,
        recording: Vec<Value>,
        headphones: bool,
    }
    let mut by: HashMap<String, Entry> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    // SAFETY: COM apartment is initialized and interface pointers/vtable slots follow Windows ABI.
    unsafe {
        let en = create_enumerator()?;
        for flow in 0..2i32 {
            let mut col: *mut c_void = std::ptr::null_mut();
            if (vtbl::<IMMDeviceEnumeratorVtbl>(en).enum_audio_endpoints)(en, flow, 1, &mut col) != 0
                || col.is_null()
            {
                continue;
            }
            let mut n: u32 = 0;
            (vtbl::<IMMDeviceCollectionVtbl>(col).get_count)(col, &mut n);
            for i in 0..n {
                let mut d: *mut c_void = std::ptr::null_mut();
                if (vtbl::<IMMDeviceCollectionVtbl>(col).item)(col, i, &mut d) != 0 || d.is_null() {
                    continue;
                }
                let mut id_ptr: *mut u16 = std::ptr::null_mut();
                (vtbl::<IMMDeviceVtbl>(d).get_id)(d, &mut id_ptr);
                let id = cotask_to_string(id_ptr);

                let mut ps: *mut c_void = std::ptr::null_mut();
                if (vtbl::<IMMDeviceVtbl>(d).open_property_store)(d, 0, &mut ps) == 0
                    && !ps.is_null()
                {
                    let inst = prop_str(ps, PKEY_INSTANCE_ID, 2);
                    if let Some(usb) = extract_usb_vid_pid(&inst) {
                        if !by.contains_key(&usb) {
                            let dev_name = prop_str(ps, PKEY_IFACE_NAME, 2);
                            order.push(usb.clone());
                            by.insert(
                                usb.clone(),
                                Entry {
                                    usb: usb.clone(),
                                    device: dev_name,
                                    playback: Vec::new(),
                                    recording: Vec::new(),
                                    headphones: false,
                                },
                            );
                        }
                        let ff = prop_u32(ps, PKEY_FORM_FACTOR, 0);
                        let ep_name = prop_str(ps, PKEY_FRIENDLY_NAME, 2);
                        let entry = by.get_mut(&usb).unwrap();
                        if flow == 0 && (ff == 3 || ff == 5) {
                            entry.headphones = true;
                        }
                        let item = json!({ "id": id, "name": ep_name, "formFactor": ff });
                        if flow == 0 {
                            entry.playback.push(item);
                        } else {
                            entry.recording.push(item);
                        }
                    }
                    release(ps);
                }
                release(d);
            }
            release(col);
        }
        release(en);
    }
    let mut out = Vec::new();
    for k in order {
        if let Some(e) = by.remove(&k) {
            if e.headphones && !e.recording.is_empty() {
                out.push(json!({
                    "usb": e.usb,
                    "device": e.device,
                    "playback": e.playback,
                    "recording": e.recording,
                    "headphones": e.headphones,
                }));
            }
        }
    }
    Ok(out)
}

pub fn list_endpoints(match_str: &str) -> Result<Vec<(String, String, u32, String, String)>, String> {
    let mut r = Vec::new();
    // SAFETY: COM apartment is initialized and interface pointers/vtable slots follow Windows ABI.
    unsafe {
        let en = create_enumerator()?;
        for flow in 0..2i32 {
            let mut col: *mut c_void = std::ptr::null_mut();
            if (vtbl::<IMMDeviceEnumeratorVtbl>(en).enum_audio_endpoints)(en, flow, 0xF, &mut col)
                != 0
                || col.is_null()
            {
                continue;
            }
            let mut n: u32 = 0;
            (vtbl::<IMMDeviceCollectionVtbl>(col).get_count)(col, &mut n);
            for i in 0..n {
                let mut d: *mut c_void = std::ptr::null_mut();
                if (vtbl::<IMMDeviceCollectionVtbl>(col).item)(col, i, &mut d) != 0 || d.is_null() {
                    continue;
                }
                let mut id_ptr: *mut u16 = std::ptr::null_mut();
                (vtbl::<IMMDeviceVtbl>(d).get_id)(d, &mut id_ptr);
                let id = cotask_to_string(id_ptr);
                let mut st: u32 = 0;
                (vtbl::<IMMDeviceVtbl>(d).get_state)(d, &mut st);
                let mut ps: *mut c_void = std::ptr::null_mut();
                if (vtbl::<IMMDeviceVtbl>(d).open_property_store)(d, 0, &mut ps) == 0
                    && !ps.is_null()
                {
                    let inst = prop_str(ps, PKEY_INSTANCE_ID, 2);
                    if match_str.is_empty() || contains_ci(&inst, match_str) {
                        let name = prop_str(ps, PKEY_FRIENDLY_NAME, 2);
                        r.push((
                            if flow == 0 {
                                "playback".into()
                            } else {
                                "recording".into()
                            },
                            id,
                            st,
                            name,
                            inst,
                        ));
                    }
                    release(ps);
                }
                release(d);
            }
            release(col);
        }
        release(en);
    }
    Ok(r)
}

pub fn default_endpoint(flow: i32) -> Option<String> {
    // SAFETY: COM apartment is initialized and interface pointers/vtable slots follow Windows ABI.
    unsafe {
        let en = create_enumerator().ok()?;
        let mut d: *mut c_void = std::ptr::null_mut();
        let hr = (vtbl::<IMMDeviceEnumeratorVtbl>(en).get_default_audio_endpoint)(en, flow, 0, &mut d);
        release(en);
        if hr != 0 || d.is_null() {
            return None;
        }
        let mut id_ptr: *mut u16 = std::ptr::null_mut();
        (vtbl::<IMMDeviceVtbl>(d).get_id)(d, &mut id_ptr);
        release(d);
        Some(cotask_to_string(id_ptr))
    }
}

pub fn set_enabled(id: &str, on: bool) -> Result<i32, String> {
    // SAFETY: COM apartment is initialized and interface pointers/vtable slots follow Windows ABI.
    unsafe {
        CoInitializeEx(std::ptr::null_mut(), 0);
        let mut pc: *mut c_void = std::ptr::null_mut();
        let hr = CoCreateInstance(
            &CLSID_POLICY_CONFIG,
            std::ptr::null_mut(),
            23,
            &IID_IPOLICY_CONFIG,
            &mut pc,
        );
        if hr != 0 || pc.is_null() {
            return Err(format!("PolicyConfig failed 0x{hr:08X}"));
        }
        let id_w = to_wide(id);
        let hr2 = (vtbl::<IPolicyConfigVtbl>(pc).set_endpoint_visibility)(
            pc,
            id_w.as_ptr(),
            if on { 1 } else { 0 },
        );
        release(pc);
        if hr2 != 0 {
            return Err(format!("SetEndpointVisibility failed 0x{hr2:08X}"));
        }
        let en = create_enumerator()?;
        let mut st_out = -1i32;
        for flow in [0, 1] {
            let mut col: *mut c_void = std::ptr::null_mut();
            if (vtbl::<IMMDeviceEnumeratorVtbl>(en).enum_audio_endpoints)(en, flow, 0xF, &mut col)
                != 0
                || col.is_null()
            {
                continue;
            }
            let mut n: u32 = 0;
            (vtbl::<IMMDeviceCollectionVtbl>(col).get_count)(col, &mut n);
            for i in 0..n {
                let mut d: *mut c_void = std::ptr::null_mut();
                if (vtbl::<IMMDeviceCollectionVtbl>(col).item)(col, i, &mut d) != 0 || d.is_null() {
                    continue;
                }
                let mut id_ptr: *mut u16 = std::ptr::null_mut();
                (vtbl::<IMMDeviceVtbl>(d).get_id)(d, &mut id_ptr);
                let did = cotask_to_string(id_ptr);
                if did == id {
                    let mut st: u32 = 0;
                    (vtbl::<IMMDeviceVtbl>(d).get_state)(d, &mut st);
                    st_out = st as i32;
                    release(d);
                    break;
                }
                release(d);
            }
            release(col);
            if st_out >= 0 {
                break;
            }
        }
        release(en);
        Ok(st_out)
    }
}

pub fn set_default(id: &str, flow: i32) -> Result<Option<String>, String> {
    // SAFETY: COM apartment is initialized and interface pointers/vtable slots follow Windows ABI.
    unsafe {
        CoInitializeEx(std::ptr::null_mut(), 0);
        let mut pc: *mut c_void = std::ptr::null_mut();
        let hr = CoCreateInstance(
            &CLSID_POLICY_CONFIG,
            std::ptr::null_mut(),
            23,
            &IID_IPOLICY_CONFIG,
            &mut pc,
        );
        if hr != 0 || pc.is_null() {
            return Err(format!("PolicyConfig failed 0x{hr:08X}"));
        }
        let id_w = to_wide(id);
        for role in 0..3i32 {
            let hr2 = (vtbl::<IPolicyConfigVtbl>(pc).set_default_endpoint)(pc, id_w.as_ptr(), role);
            if hr2 != 0 {
                release(pc);
                return Err(format!("SetDefaultEndpoint failed 0x{hr2:08X}"));
            }
        }
        release(pc);
    }
    Ok(default_endpoint(flow))
}

// ---- AudioTopology (sidetone, sidetone-set) ----

struct TopoCtrl {
    unit: u32,
    name: String,
    kind: &'static str,
    min: f32,
    max: f32,
    level: f32,
    muted: bool,
}

// SAFETY: Caller must pass valid, non-dangling COM/Win32 pointers with matching lifetimes.
unsafe fn enumerate_device_topologies(match_str: &str) -> Result<Vec<(String, *mut c_void)>, String> {
    let en = create_enumerator()?;
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for flow in 0..2i32 {
        let mut col: *mut c_void = std::ptr::null_mut();
        if (vtbl::<IMMDeviceEnumeratorVtbl>(en).enum_audio_endpoints)(en, flow, 1, &mut col) != 0
            || col.is_null()
        {
            continue;
        }
        let mut n: u32 = 0;
        (vtbl::<IMMDeviceCollectionVtbl>(col).get_count)(col, &mut n);
        for i in 0..n {
            let mut d: *mut c_void = std::ptr::null_mut();
            if (vtbl::<IMMDeviceCollectionVtbl>(col).item)(col, i, &mut d) != 0 || d.is_null() {
                continue;
            }
            let mut t: *mut c_void = std::ptr::null_mut();
            if (vtbl::<IMMDeviceVtbl>(d).activate)(
                d,
                &IID_IDEVICE_TOPOLOGY,
                23,
                std::ptr::null_mut(),
                &mut t,
            ) == 0
                && !t.is_null()
            {
                let mut c: *mut c_void = std::ptr::null_mut();
                if (vtbl::<IDeviceTopologyVtbl>(t).get_connector)(t, 0, &mut c) == 0 && !c.is_null()
                {
                    let mut other: *mut c_void = std::ptr::null_mut();
                    if (vtbl::<IConnectorVtbl>(c).get_connected_to)(c, &mut other) == 0
                        && !other.is_null()
                    {
                        let mut other_part: *mut c_void = std::ptr::null_mut();
                        if (vtbl::<IUnknownVtbl>(other).query_interface)(
                            other,
                            &IID_IPART,
                            &mut other_part,
                        ) == 0
                            && !other_part.is_null()
                        {
                            let mut dt: *mut c_void = std::ptr::null_mut();
                            if (vtbl::<IPartVtbl>(other_part).get_topology_object)(
                                other_part, &mut dt,
                            ) == 0
                                && !dt.is_null()
                            {
                                let mut did_ptr: *mut u16 = std::ptr::null_mut();
                                (vtbl::<IDeviceTopologyVtbl>(dt).get_device_id)(dt, &mut did_ptr);
                                let did = cotask_to_string(did_ptr);
                                if contains_ci(&did, match_str) && seen.insert(did.clone()) {
                                    out.push((did, dt));
                                } else {
                                    release(dt);
                                }
                            }
                            release(other_part);
                        }
                        release(other);
                    }
                    release(c);
                }
                release(t);
            }
            release(d);
        }
        release(col);
    }
    release(en);
    Ok(out)
}

fn sidetone_read(usb: &str) -> Result<Option<Value>, String> {
    let mut rows = Vec::new();
    // SAFETY: COM apartment is initialized and interface pointers/vtable slots follow Windows ABI.
    unsafe {
        let dts = enumerate_device_topologies(usb)?;
        for (_dev, dt) in dts {
            let mut n: u32 = 0;
            (vtbl::<IDeviceTopologyVtbl>(dt).get_subunit_count)(dt, &mut n);
            for i in 0..n {
                let mut s: *mut c_void = std::ptr::null_mut();
                if (vtbl::<IDeviceTopologyVtbl>(dt).get_subunit)(dt, i, &mut s) != 0 || s.is_null() {
                    continue;
                }
                let mut p: *mut c_void = std::ptr::null_mut();
                if (vtbl::<IUnknownVtbl>(s).query_interface)(s, &IID_IPART, &mut p) == 0
                    && !p.is_null()
                {
                    let mut name_ptr: *mut u16 = std::ptr::null_mut();
                    (vtbl::<IPartVtbl>(p).get_name)(p, &mut name_ptr);
                    let name = cotask_to_string(name_ptr);
                    let mut lid: u32 = 0;
                    (vtbl::<IPartVtbl>(p).get_local_id)(p, &mut lid);

                    let mut v_ptr: *mut c_void = std::ptr::null_mut();
                    if (vtbl::<IPartVtbl>(p).activate)(p, 23, &IID_IAUDIO_VOLUME_LEVEL, &mut v_ptr)
                        == 0
                        && !v_ptr.is_null()
                    {
                        let (mut mn, mut mx, mut st, mut lv) = (0f32, 0f32, 0f32, 0f32);
                        (vtbl::<IAudioVolumeLevelVtbl>(v_ptr).get_level_range)(
                            v_ptr, 0, &mut mn, &mut mx, &mut st,
                        );
                        (vtbl::<IAudioVolumeLevelVtbl>(v_ptr).get_level)(v_ptr, 0, &mut lv);
                        release(v_ptr);
                        rows.push(TopoCtrl {
                            unit: lid,
                            name: name.clone(),
                            kind: "volume",
                            min: mn,
                            max: mx,
                            level: lv,
                            muted: false,
                        });
                    }
                    let mut m_ptr: *mut c_void = std::ptr::null_mut();
                    if (vtbl::<IPartVtbl>(p).activate)(p, 23, &IID_IAUDIO_MUTE, &mut m_ptr) == 0
                        && !m_ptr.is_null()
                    {
                        let mut m: i32 = 0;
                        (vtbl::<IAudioMuteVtbl>(m_ptr).get_mute)(m_ptr, &mut m);
                        release(m_ptr);
                        rows.push(TopoCtrl {
                            unit: lid,
                            name,
                            kind: "mute",
                            min: 0.0,
                            max: 0.0,
                            level: 0.0,
                            muted: m != 0,
                        });
                    }
                    release(p);
                }
                release(s);
            }
            release(dt);
        }
    }

    let vol = rows
        .iter()
        .find(|c| c.kind == "volume" && c.min == -42.0 && c.max == 4.0)
        .or_else(|| {
            rows.iter()
                .find(|c| c.kind == "volume" && contains_ci(&c.name, "sidetone"))
        });
    let Some(vol) = vol else {
        return Ok(None);
    };
    let mute = rows
        .iter()
        .find(|c| c.kind == "mute" && c.unit + 1 == vol.unit);
    let db = ((vol.level as f64) * 100.0).round() / 100.0;
    Ok(Some(json!({
        "unit": vol.unit,
        "muteUnit": mute.map(|m| json!(m.unit)).unwrap_or(Value::Null),
        "db": db,
        "on": mute.map(|m| json!(!m.muted)).unwrap_or(Value::Null),
        "min": vol.min as f64,
        "max": vol.max as f64,
    })))
}

fn topology_set_level(usb: &str, unit: u32, db: f32) -> Result<(), String> {
    // SAFETY: COM apartment is initialized and interface pointers/vtable slots follow Windows ABI.
    unsafe {
        let dts = enumerate_device_topologies(usb)?;
        let mut done = false;
        for (_dev, dt) in dts {
            if !done {
                let mut p: *mut c_void = std::ptr::null_mut();
                if (vtbl::<IDeviceTopologyVtbl>(dt).get_part_by_id)(dt, unit, &mut p) == 0
                    && !p.is_null()
                {
                    let mut v: *mut c_void = std::ptr::null_mut();
                    if (vtbl::<IPartVtbl>(p).activate)(p, 23, &IID_IAUDIO_VOLUME_LEVEL, &mut v) == 0
                        && !v.is_null()
                    {
                        let hr = (vtbl::<IAudioVolumeLevelVtbl>(v).set_level_uniform)(
                            v,
                            db,
                            &GUID::ZERO,
                        );
                        release(v);
                        release(p);
                        if hr != 0 {
                            release(dt);
                            return Err(format!("SetLevelUniform failed 0x{hr:08X}"));
                        }
                        done = true;
                    } else {
                        release(p);
                    }
                }
            }
            release(dt);
        }
        if !done {
            return Err(format!("no volume control {unit}"));
        }
    }
    Ok(())
}

fn topology_set_mute(usb: &str, unit: u32, mute: bool) -> Result<(), String> {
    // SAFETY: COM apartment is initialized and interface pointers/vtable slots follow Windows ABI.
    unsafe {
        let dts = enumerate_device_topologies(usb)?;
        let mut done = false;
        for (_dev, dt) in dts {
            if !done {
                let mut p: *mut c_void = std::ptr::null_mut();
                if (vtbl::<IDeviceTopologyVtbl>(dt).get_part_by_id)(dt, unit, &mut p) == 0
                    && !p.is_null()
                {
                    let mut m: *mut c_void = std::ptr::null_mut();
                    if (vtbl::<IPartVtbl>(p).activate)(p, 23, &IID_IAUDIO_MUTE, &mut m) == 0
                        && !m.is_null()
                    {
                        let hr = (vtbl::<IAudioMuteVtbl>(m).set_mute)(
                            m,
                            if mute { 1 } else { 0 },
                            &GUID::ZERO,
                        );
                        release(m);
                        release(p);
                        if hr != 0 {
                            release(dt);
                            return Err(format!("SetMute failed 0x{hr:08X}"));
                        }
                        done = true;
                    } else {
                        release(p);
                    }
                }
            }
            release(dt);
        }
        if !done {
            return Err(format!("no mute control {unit}"));
        }
    }
    Ok(())
}

// ---- AudioApps (outputs, follow, switch-output) ----

fn pid_name_map() -> HashMap<u32, String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    let mut map = HashMap::new();
    // SAFETY: Win32 system/process API call with valid handles and caller-owned output buffers.
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return map;
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
                let stem = name.strip_suffix(".exe").or_else(|| name.strip_suffix(".EXE")).unwrap_or(&name);
                map.insert(entry.th32ProcessID, stem.to_string());
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    map
}

pub fn outputs() -> Result<Vec<Value>, String> {
    let procs = pid_name_map();
    let def_id = default_endpoint(0);
    let mut r = Vec::new();
    // SAFETY: COM apartment is initialized and interface pointers/vtable slots follow Windows ABI.
    unsafe {
        let en = create_enumerator()?;
        let mut col: *mut c_void = std::ptr::null_mut();
        if (vtbl::<IMMDeviceEnumeratorVtbl>(en).enum_audio_endpoints)(en, 0, 1, &mut col) == 0
            && !col.is_null()
        {
            let mut n: u32 = 0;
            (vtbl::<IMMDeviceCollectionVtbl>(col).get_count)(col, &mut n);
            for i in 0..n {
                let mut d: *mut c_void = std::ptr::null_mut();
                if (vtbl::<IMMDeviceCollectionVtbl>(col).item)(col, i, &mut d) != 0 || d.is_null() {
                    continue;
                }
                let mut id_ptr: *mut u16 = std::ptr::null_mut();
                (vtbl::<IMMDeviceVtbl>(d).get_id)(d, &mut id_ptr);
                let id = cotask_to_string(id_ptr);

                let mut ps: *mut c_void = std::ptr::null_mut();
                let name = if (vtbl::<IMMDeviceVtbl>(d).open_property_store)(d, 0, &mut ps) == 0
                    && !ps.is_null()
                {
                    let s = prop_str(ps, PKEY_FRIENDLY_NAME, 14);
                    release(ps);
                    s
                } else {
                    String::new()
                };

                let mut apps = Vec::new();
                let mut sm: *mut c_void = std::ptr::null_mut();
                if (vtbl::<IMMDeviceVtbl>(d).activate)(
                    d,
                    &IID_IAUDIO_SESSION_MANAGER2,
                    23,
                    std::ptr::null_mut(),
                    &mut sm,
                ) == 0
                    && !sm.is_null()
                {
                    let mut se: *mut c_void = std::ptr::null_mut();
                    if (vtbl::<IAudioSessionManager2Vtbl>(sm).get_session_enumerator)(sm, &mut se)
                        == 0
                        && !se.is_null()
                    {
                        let mut sn: i32 = 0;
                        (vtbl::<IAudioSessionEnumeratorVtbl>(se).get_count)(se, &mut sn);
                        for j in 0..sn {
                            let mut sc_raw: *mut c_void = std::ptr::null_mut();
                            if (vtbl::<IAudioSessionEnumeratorVtbl>(se).get_session)(
                                se,
                                j,
                                &mut sc_raw,
                            ) != 0
                                || sc_raw.is_null()
                            {
                                continue;
                            }
                            let mut sc: *mut c_void = std::ptr::null_mut();
                            if (vtbl::<IUnknownVtbl>(sc_raw).query_interface)(
                                sc_raw,
                                &IID_IAUDIO_SESSION_CONTROL2,
                                &mut sc,
                            ) == 0
                                && !sc.is_null()
                            {
                                if (vtbl::<IAudioSessionControl2Vtbl>(sc).is_system_sounds_session)(
                                    sc,
                                ) != 0
                                {
                                    let mut st: i32 = 0;
                                    let mut pid: u32 = 0;
                                    (vtbl::<IAudioSessionControl2Vtbl>(sc).get_state)(sc, &mut st);
                                    (vtbl::<IAudioSessionControl2Vtbl>(sc).get_process_id)(
                                        sc, &mut pid,
                                    );
                                    if let Some(pn) = procs.get(&pid) {
                                        apps.push(json!({
                                            "pid": pid,
                                            "name": pn,
                                            "playing": st == 1,
                                        }));
                                    }
                                }
                                release(sc);
                            }
                            release(sc_raw);
                        }
                        release(se);
                    }
                    release(sm);
                }

                let is_def = def_id.as_deref() == Some(id.as_str());
                r.push(json!({
                    "id": id,
                    "name": name,
                    "default": is_def,
                    "apps": apps,
                }));
                release(d);
            }
            release(col);
        }
        release(en);
    }
    Ok(r)
}

// SAFETY: Caller must pass valid, non-dangling COM/Win32 pointers with matching lifetimes.
unsafe fn get_policy_factory() -> Result<*mut c_void, String> {
    CoInitializeEx(std::ptr::null_mut(), 0);
    let cls_w = to_wide("Windows.Media.Internal.AudioPolicyConfig");
    let mut hstr: *mut c_void = std::ptr::null_mut();
    combase_windows_create_string(cls_w.as_ptr(), 40, &mut hstr);
    let mut fac: *mut c_void = std::ptr::null_mut();
    let hr = combase_ro_get_activation_factory(hstr, &IID_IAUDIO_POLICY_CONFIG_FACTORY, &mut fac);
    combase_windows_delete_string(hstr);
    if hr != 0 || fac.is_null() {
        return Err(format!("AudioPolicyConfig failed 0x{hr:08X}"));
    }
    Ok(fac)
}

pub fn follow(id: &str) -> Result<Vec<String>, String> {
    let outs = outputs()?;
    let mut moved = Vec::new();
    let mut seen = HashSet::new();
    // SAFETY: COM apartment is initialized and interface pointers/vtable slots follow Windows ABI.
    unsafe {
        let fac = get_policy_factory()?;
        let full = format!("\\\\?\\SWD#MMDEVAPI#{id}#{{e6327cad-dcec-4949-ae8a-991e976a79d2}}");
        let full_w = to_wide(&full);
        let mut hstr: *mut c_void = std::ptr::null_mut();
        combase_windows_create_string(full_w.as_ptr(), (full_w.len() - 1) as u32, &mut hstr);

        for o in &outs {
            if o.get("id").and_then(|v| v.as_str()) == Some(id) {
                continue;
            }
            if let Some(apps) = o.get("apps").and_then(|v| v.as_array()) {
                for a in apps {
                    let pid = a.get("pid").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                    let name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    if pid == 0 || !seen.insert(pid) {
                        continue;
                    }
                    let mut ok = true;
                    for role in 0..2i32 {
                        if (vtbl::<IAudioPolicyConfigFactoryVtbl>(fac)
                            .set_persisted_default_audio_endpoint)(
                            fac, pid, 0, role, hstr
                        ) != 0
                        {
                            ok = false;
                        }
                    }
                    if ok {
                        moved.push(name.to_string());
                    }
                }
            }
        }
        combase_windows_delete_string(hstr);
        if !moved.is_empty() {
            thread::sleep(Duration::from_millis(300));
            (vtbl::<IAudioPolicyConfigFactoryVtbl>(fac)
                .clear_all_persisted_application_default_endpoints)(fac);
        }
        release(fac);
    }
    Ok(moved)
}

// ---- MicGuard ----

#[link(name = "user32")]
extern "system" {
    fn EnumWindows(lp_enum_func: unsafe extern "system" fn(isize, isize) -> i32, l_param: isize) -> i32;
    fn IsWindowVisible(hwnd: isize) -> i32;
    fn GetWindowTextW(hwnd: isize, lp_string: *mut u16, n_max_count: i32) -> i32;
    fn GetWindowThreadProcessId(hwnd: isize, lpdw_process_id: *mut u32) -> u32;
}

struct EnumCtx {
    pids: HashSet<u32>,
    titles: Vec<String>,
}

// SAFETY: FFI callback invoked by Windows/SDK with valid ABI and caller-provided context pointer.
unsafe extern "system" fn enum_chrome_cb(hwnd: isize, lparam: isize) -> i32 {
    if IsWindowVisible(hwnd) == 0 {
        return 1;
    }
    let ctx = &mut *(lparam as *mut EnumCtx);
    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, &mut pid);
    if !ctx.pids.contains(&pid) {
        return 1;
    }
    let mut buf = [0u16; 512];
    let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), 512);
    if len > 0 {
        ctx.titles
            .push(String::from_utf16_lossy(&buf[..len as usize]));
    }
    1
}

fn chrome_mic_in_use() -> bool {
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER,
        KEY_READ,
    };
    // SAFETY: Win32 registry call using null-terminated UTF-16 strings and properly sized stack/Vec buffers.
    unsafe {
        let sub = to_wide("Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged");
        let mut hkey = HKEY::default();
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            windows::core::PCWSTR(sub.as_ptr()),
            0,
            KEY_READ,
            &mut hkey,
        )
        .is_err()
        {
            return false;
        }
        let mut in_use = false;
        for idx in 0u32.. {
            let mut name_buf = [0u16; 260];
            let mut name_len = name_buf.len() as u32;
            if RegEnumKeyExW(
                hkey,
                idx,
                windows::core::PWSTR(name_buf.as_mut_ptr()),
                &mut name_len,
                None,
                windows::core::PWSTR::null(),
                None,
                None,
            )
            .is_err()
            {
                break;
            }
            let name = String::from_utf16_lossy(&name_buf[..name_len as usize]);
            if !contains_ci(&name, "chrome.exe") {
                continue;
            }
            let mut sub_key = HKEY::default();
            if RegOpenKeyExW(
                hkey,
                windows::core::PCWSTR(name_buf.as_ptr()),
                0,
                KEY_READ,
                &mut sub_key,
            )
            .is_ok()
            {
                let mut start_v: u64 = 0;
                let mut stop_v: u64 = 1;
                let mut sz = 8u32;
                let s_name = to_wide("LastUsedTimeStart");
                let e_name = to_wide("LastUsedTimeStop");
                let ok1 = RegQueryValueExW(
                    sub_key,
                    windows::core::PCWSTR(s_name.as_ptr()),
                    None,
                    None,
                    Some(&mut start_v as *mut u64 as *mut u8),
                    Some(&mut sz),
                )
                .is_ok();
                sz = 8;
                let ok2 = RegQueryValueExW(
                    sub_key,
                    windows::core::PCWSTR(e_name.as_ptr()),
                    None,
                    None,
                    Some(&mut stop_v as *mut u64 as *mut u8),
                    Some(&mut sz),
                )
                .is_ok();
                let _ = RegCloseKey(sub_key);
                if ok1 && ok2 && start_v != 0 && stop_v == 0 {
                    in_use = true;
                    break;
                }
            }
        }
        let _ = RegCloseKey(hkey);
        in_use
    }
}

pub fn mic_guard_look() -> Value {
    let pids: HashSet<u32> = pid_name_map()
        .into_iter()
        .filter(|(_, name)| name.eq_ignore_ascii_case("chrome"))
        .map(|(pid, _)| pid)
        .collect();
    let mut ctx = EnumCtx {
        pids,
        titles: Vec::new(),
    };
    // SAFETY: Win32 window/tray/GDI call on valid HWND/HINSTANCE/resource with initialized structs.
    unsafe {
        EnumWindows(enum_chrome_cb, (&mut ctx as *mut EnumCtx) as isize);
    }
    json!({
        "titles": ctx.titles,
        "chromeMic": chrome_mic_in_use(),
    })
}

pub fn mics() -> Result<Vec<Value>, String> {
    let rows = list_endpoints("")?;
    Ok(rows
        .into_iter()
        .filter(|(flow, ..)| flow == "recording")
        .map(|(_, id, st, name, _)| json!({ "id": id, "state": st, "name": name }))
        .collect())
}

// ---- MicRec ----

const MAX_SECONDS: i32 = 30;

struct RecInner {
    pcm: Option<Vec<u8>>,
    running: bool,
    rate: i32,
    level: f64,
    error: Option<String>,
    stop_flag: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}

static REC: Mutex<Option<RecInner>> = Mutex::new(None);

fn mic_status_locked(r: &RecInner) -> Value {
    let bytes = r.pcm.as_ref().map(|v| v.len()).unwrap_or(0) as i64;
    let seconds = if r.rate > 0 {
        (bytes as f64) / 2.0 / (r.rate as f64)
    } else {
        0.0
    };
    json!({
        "recording": r.running,
        "rate": r.rate,
        "seconds": seconds,
        "bytes": bytes,
        "level": (r.level * 10.0).round() / 10.0,
        "error": r.error,
        "max": MAX_SECONDS,
    })
}

pub fn mic_rec_status() -> Value {
    let mut guard = REC.lock().unwrap();
    let r = guard.get_or_insert_with(|| RecInner {
        pcm: None,
        running: false,
        rate: 0,
        level: -90.0,
        error: None,
        stop_flag: Arc::new(AtomicBool::new(false)),
        worker: None,
    });
    mic_status_locked(r)
}

pub fn mic_rec_stop() -> Value {
    let handle = {
        let mut guard = REC.lock().unwrap();
        if let Some(r) = guard.as_mut() {
            r.running = false;
            r.stop_flag.store(true, Ordering::SeqCst);
            r.worker.take()
        } else {
            None
        }
    };
    if let Some(h) = handle {
        let _ = h.join();
    }
    mic_rec_status()
}

pub fn mic_rec_clear() {
    let mut guard = REC.lock().unwrap();
    if let Some(r) = guard.as_mut() {
        if let Some(buf) = r.pcm.as_mut() {
            buf.fill(0);
        }
        r.pcm = None;
        r.level = -90.0;
    }
}

pub fn mic_rec_start(id: Option<String>) -> Value {
    mic_rec_stop();
    mic_rec_clear();

    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_c = Arc::clone(&stop_flag);
    {
        let mut guard = REC.lock().unwrap();
        *guard = Some(RecInner {
            pcm: Some(Vec::new()),
            running: true,
            rate: 0,
            level: -90.0,
            error: None,
            stop_flag,
            worker: None,
        });
    }

    // SAFETY: COM apartment is initialized and interface pointers/vtable slots follow Windows ABI.
    let handle = thread::spawn(move || unsafe {
        let started = Instant::now();
        let res: Result<(), String> = (|| {
            let en = create_enumerator()?;
            let mut d: *mut c_void = std::ptr::null_mut();
            let hr_d = if let Some(ref did) = id {
                let w = to_wide(did);
                (vtbl::<IMMDeviceEnumeratorVtbl>(en).get_device)(en, w.as_ptr(), &mut d)
            } else {
                (vtbl::<IMMDeviceEnumeratorVtbl>(en).get_default_audio_endpoint)(en, 1, 0, &mut d)
            };
            release(en);
            if hr_d != 0 || d.is_null() {
                return Err(format!("GetDevice failed 0x{hr_d:08X}"));
            }
            let mut ac: *mut c_void = std::ptr::null_mut();
            let hr_ac = (vtbl::<IMMDeviceVtbl>(d).activate)(
                d,
                &IID_IAUDIO_CLIENT,
                23,
                std::ptr::null_mut(),
                &mut ac,
            );
            release(d);
            if hr_ac != 0 || ac.is_null() {
                return Err(format!("Activate IAudioClient failed 0x{hr_ac:08X}"));
            }
            let mut fmt: *mut u8 = std::ptr::null_mut();
            let hr_fmt = (vtbl::<IAudioClientVtbl>(ac).get_mix_format)(ac, &mut fmt);
            if hr_fmt != 0 || fmt.is_null() {
                release(ac);
                return Err(format!("GetMixFormat failed 0x{hr_fmt:08X}"));
            }
            let ch = i16::from_le_bytes([*fmt.add(2), *fmt.add(3)]) as usize;
            let sr = i32::from_le_bytes([*fmt.add(4), *fmt.add(5), *fmt.add(6), *fmt.add(7)]);
            let bits = i16::from_le_bytes([*fmt.add(14), *fmt.add(15)]);
            if bits != 32 {
                CoTaskMemFree(fmt as *mut c_void);
                release(ac);
                return Err(format!("unexpected mic format ({bits}-bit)"));
            }
            let hr_init = (vtbl::<IAudioClientVtbl>(ac).initialize)(
                ac,
                0,
                0,
                2_000_000,
                0,
                fmt,
                std::ptr::null(),
            );
            CoTaskMemFree(fmt as *mut c_void);
            if hr_init != 0 {
                release(ac);
                return Err(format!("IAudioClient::Initialize failed 0x{hr_init:08X}"));
            }
            let mut cc: *mut c_void = std::ptr::null_mut();
            let hr_cc = (vtbl::<IAudioClientVtbl>(ac).get_service)(
                ac,
                &IID_IAUDIO_CAPTURE_CLIENT,
                &mut cc,
            );
            if hr_cc != 0 || cc.is_null() {
                release(ac);
                return Err(format!("GetService failed 0x{hr_cc:08X}"));
            }
            (vtbl::<IAudioClientVtbl>(ac).start)(ac);
            if let Some(r) = REC.lock().unwrap().as_mut() {
                r.rate = sr;
            }
            let mut outb = vec![0u8; (sr as usize) * 2];
            while !stop_c.load(Ordering::SeqCst) {
                if started.elapsed().as_secs_f64() >= MAX_SECONDS as f64 {
                    break;
                }
                thread::sleep(Duration::from_millis(15));
                let mut pk: u32 = 0;
                if (vtbl::<IAudioCaptureClientVtbl>(cc).get_next_packet_size)(cc, &mut pk) != 0 {
                    release(cc);
                    release(ac);
                    return Err("the mic was disconnected".into());
                }
                while !stop_c.load(Ordering::SeqCst) && pk > 0 {
                    let mut data: *const f32 = std::ptr::null();
                    let (mut frames, mut flags, mut p1, mut p2) = (0u32, 0u32, 0u64, 0u64);
                    if (vtbl::<IAudioCaptureClientVtbl>(cc).get_buffer)(
                        cc, &mut data, &mut frames, &mut flags, &mut p1, &mut p2,
                    ) != 0
                    {
                        break;
                    }
                    let n = (frames as usize).min(sr as usize);
                    let mut peak = 0.0f64;
                    if (flags & 2) != 0 || data.is_null() {
                        outb[..n * 2].fill(0);
                    } else {
                        let samples = std::slice::from_raw_parts(data, n * ch);
                        for i in 0..n {
                            let v = samples[i * ch] as f64;
                            if v.abs() > peak {
                                peak = v.abs();
                            }
                            let s = (v.clamp(-1.0, 1.0) * 32767.0).round() as i16;
                            let le = s.to_le_bytes();
                            outb[i * 2] = le[0];
                            outb[i * 2 + 1] = le[1];
                        }
                    }
                    (vtbl::<IAudioCaptureClientVtbl>(cc).release_buffer)(cc, frames);
                    if let Some(r) = REC.lock().unwrap().as_mut() {
                        if let Some(pcm) = r.pcm.as_mut() {
                            pcm.extend_from_slice(&outb[..n * 2]);
                        }
                        r.level = if peak > 0.0 {
                            (20.0 * peak.log10()).max(-90.0)
                        } else {
                            -90.0
                        };
                    }
                    if (vtbl::<IAudioCaptureClientVtbl>(cc).get_next_packet_size)(cc, &mut pk) != 0
                    {
                        release(cc);
                        release(ac);
                        return Err("the mic was disconnected".into());
                    }
                }
            }
            (vtbl::<IAudioClientVtbl>(ac).stop)(ac);
            release(cc);
            release(ac);
            Ok(())
        })();
        if let Some(r) = REC.lock().unwrap().as_mut() {
            r.running = false;
            if let Err(e) = res {
                r.error = Some(e);
            }
        }
    });

    if let Some(r) = REC.lock().unwrap().as_mut() {
        r.worker = Some(handle);
    }
    for _ in 0..40 {
        let done = {
            let guard = REC.lock().unwrap();
            let r = guard.as_ref().unwrap();
            !r.running || r.rate != 0 || r.error.is_some()
        };
        if done {
            break;
        }
        thread::sleep(Duration::from_millis(25));
    }
    mic_rec_status()
}

fn b64_encode(data: &[u8]) -> String {
    const TBL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = chunk.get(1).copied().unwrap_or(0) as usize;
        let b2 = chunk.get(2).copied().unwrap_or(0) as usize;
        out.push(TBL[b0 >> 2] as char);
        out.push(TBL[((b0 & 3) << 4) | (b1 >> 4)] as char);
        out.push(if chunk.len() > 1 {
            TBL[((b1 & 0xF) << 2) | (b2 >> 6)] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TBL[b2 & 0x3F] as char
        } else {
            '='
        });
    }
    out
}

pub fn mic_rec_read(offset: i64, length: i32) -> String {
    let guard = REC.lock().unwrap();
    let Some(r) = guard.as_ref() else {
        return String::new();
    };
    let Some(pcm) = r.pcm.as_ref() else {
        return String::new();
    };
    if offset < 0 || (offset as usize) >= pcm.len() || length <= 0 {
        return String::new();
    }
    let off = offset as usize;
    let len = (length as usize).min(1 << 20).min(pcm.len() - off);
    b64_encode(&pcm[off..off + len])
}

// ---- Dispatcher for audio channel ----

const HS80_USB: &str = "VID_1B1C&PID_0A6";

pub fn handle(rest: &str) -> Result<String, String> {
    let q: Value = serde_json::from_str(rest).map_err(|e| e.to_string())?;
    let op = q.get("op").and_then(|v| v.as_str()).unwrap_or("");
    let mut o = Map::new();
    o.insert("ok".into(), json!(true));

    match op {
        "audio-list" => {
            let m = q.get("match").and_then(|v| v.as_str()).unwrap_or("HS80");
            o.insert("endpoints".into(), json!(win_audio_list(Some(m))?));
        }
        "audio-set" => {
            let id = q.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let vol = q.get("volume").and_then(|v| v.as_i64()).unwrap_or(-1) as i32;
            let muted = match q.get("muted").and_then(|v| v.as_bool()) {
                Some(true) => 1,
                Some(false) => 0,
                None => -1,
            };
            o.insert("endpoint".into(), win_audio_set(id, vol, muted)?);
        }
        "usb-headsets" => {
            o.insert("headsets".into(), json!(headsets()?));
        }
        "hs80-endpoints" => {
            let usb = q.get("usb").and_then(|v| v.as_str()).unwrap_or(HS80_USB);
            let eps: Vec<Value> = list_endpoints(usb)?
                .into_iter()
                .map(|(flow, id, state, name, inst)| {
                    json!({
                        "flow": flow,
                        "id": id,
                        "state": state,
                        "name": name,
                        "wired": inst.contains("PID_0A69"),
                        "wireless": inst.contains("PID_0A6B"),
                    })
                })
                .collect();
            o.insert("endpoints".into(), json!(eps));
            o.insert(
                "defaults".into(),
                json!({
                    "playback": default_endpoint(0),
                    "recording": default_endpoint(1),
                }),
            );
        }
        "set-enabled" => {
            let id = q.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let on = q.get("on").and_then(|v| v.as_bool()).unwrap_or(true);
            o.insert("state".into(), json!(set_enabled(id, on)?));
        }
        "set-default" => {
            let id = q.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let flow = q.get("flow").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            o.insert("now".into(), json!(set_default(id, flow)?));
        }
        "outputs" => {
            o.insert("outputs".into(), json!(outputs()?));
        }
        "mic-rec-start" => {
            let id = q.get("id").and_then(|v| v.as_str()).map(String::from);
            o.insert("rec".into(), mic_rec_start(id));
        }
        "mic-rec-status" => {
            o.insert("rec".into(), mic_rec_status());
        }
        "mic-rec-stop" => {
            o.insert("rec".into(), mic_rec_stop());
        }
        "mic-rec-read" => {
            let off = q.get("offset").and_then(|v| v.as_i64()).unwrap_or(0);
            let len = q.get("length").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            o.insert("data".into(), json!(mic_rec_read(off, len)));
        }
        "mic-rec-clear" => {
            mic_rec_clear();
            o.insert("rec".into(), mic_rec_status());
        }
        "mic-guard" => {
            o.insert("look".into(), mic_guard_look());
        }
        "mics" => {
            o.insert("mics".into(), json!(mics()?));
        }
        "procs" => {
            o.insert("names".into(), json!(crate::list_process_names()?));
        }
        "power" => {
            return Ok(crate::get_power_status().to_string());
        }
        "follow" => {
            let id = q.get("id").and_then(|v| v.as_str()).unwrap_or("");
            o.insert("moved".into(), json!(follow(id)?));
        }
        "switch-output" => {
            let id = q.get("id").and_then(|v| v.as_str()).unwrap_or("");
            set_default(id, 0)?;
            o.insert("moved".into(), json!(follow(id)?));
        }
        "sidetone" => {
            let usb = q.get("usb").and_then(|v| v.as_str()).unwrap_or(HS80_USB);
            o.insert(
                "sidetone".into(),
                sidetone_read(usb)?.unwrap_or(Value::Null),
            );
        }
        "sidetone-set" => {
            let usb = q.get("usb").and_then(|v| v.as_str()).unwrap_or(HS80_USB);
            let s = sidetone_read(usb)?
                .ok_or("no sidetone control in Windows for this headset (is it connected?)")?;
            if let Some(db) = q.get("db").and_then(|v| v.as_f64()) {
                if !(-42.0..=4.0).contains(&db) {
                    return Err("sidetone must be between -42 and +4 dB".into());
                }
                let unit = s["unit"].as_u64().unwrap_or(0) as u32;
                topology_set_level(usb, unit, db as f32)?;
            }
            if let Some(on) = q.get("on").and_then(|v| v.as_bool()) {
                let mute_unit = s["muteUnit"]
                    .as_u64()
                    .ok_or("this headset has no sidetone on/off control")?
                    as u32;
                topology_set_mute(usb, mute_unit, !on)?;
            }
            o.insert(
                "sidetone".into(),
                sidetone_read(usb)?.unwrap_or(Value::Null),
            );
        }
        _ => return Ok(json!({ "ok": false, "error": format!("unknown op {op}") }).to_string()),
    }
    Ok(Value::Object(o).to_string())
}

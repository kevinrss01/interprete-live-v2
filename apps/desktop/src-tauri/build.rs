fn main() {
    let configuration: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string("tauri.conf.json").expect("read app configuration"),
    )
    .expect("parse app configuration");
    let name = configuration["productName"]
        .as_str()
        .expect("app productName");
    let identifier = configuration["identifier"]
        .as_str()
        .expect("app identifier");
    println!("cargo:rustc-env=INTERPRETE_MICROPHONE_NAME={name}");
    println!("cargo:rustc-env=INTERPRETE_MICROPHONE_UID={identifier}.microphone");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("src/call_probe.m")
            .file("src/virtual_microphone.m")
            .file("src/system_audio.m")
            .file("src/call_microphone.m")
            .file("src/setup.m")
            .flag("-fobjc-arc")
            .compile("interprete_call_probe");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=CoreAudio");
        println!("cargo:rustc-link-lib=framework=CoreMediaIO");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=ApplicationServices");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=QuartzCore");
        println!("cargo:rerun-if-changed=src/call_probe.m");
        println!("cargo:rerun-if-changed=src/virtual_microphone.m");
        println!("cargo:rerun-if-changed=src/system_audio.m");
        println!("cargo:rerun-if-changed=src/call_microphone.m");
        println!("cargo:rerun-if-changed=src/setup.m");
    }
    tauri_build::build();
    // `generate_context!` reads the icon files from a proc macro, which Cargo
    // does not track. Stamp their bytes so the crate rebuilds when they change.
    println!("cargo:rustc-env=INTERPRETE_ICON_STAMP={}", icon_stamp());
}

fn icon_stamp() -> u64 {
    use std::hash::{Hash, Hasher};

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for path in [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/128x128@2x.png",
        "icons/icon.icns",
        "icons/icon.ico",
        "icons/icon.png",
    ] {
        println!("cargo:rerun-if-changed={path}");
        match std::fs::read(path) {
            Ok(bytes) => bytes.hash(&mut hasher),
            Err(_) => path.hash(&mut hasher),
        }
    }
    hasher.finish()
}

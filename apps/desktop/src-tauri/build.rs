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
            .flag("-fobjc-arc")
            .compile("interprete_call_probe");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=CoreAudio");
        println!("cargo:rerun-if-changed=src/call_probe.m");
        println!("cargo:rerun-if-changed=src/virtual_microphone.m");
    }
    tauri_build::build()
}

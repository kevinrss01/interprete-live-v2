fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("src/call_probe.m")
            .flag("-fobjc-arc")
            .compile("interprete_call_probe");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=CoreAudio");
        println!("cargo:rerun-if-changed=src/call_probe.m");
    }
    tauri_build::build()
}

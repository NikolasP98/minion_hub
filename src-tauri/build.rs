fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_update_status",
            "desktop_update_install",
            "desktop_update_continue",
            "desktop_update_check",
            "desktop_update_download",
        ]),
    ))
    .expect("build desktop capabilities")
}

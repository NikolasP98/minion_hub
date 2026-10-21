use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::json;
use tauri_plugin_updater::UpdaterExt;

const KEY: &str = "untrusted comment: minisign public key: A49EF4746FA6E6D7\nRWTX5qZvdPSepDGWg2bz8n6ArQnBMwgQK1geVosorcbLzcunD+KJ+cYe";
const SIGNATURE: &str = "untrusted comment: signature from tauri secret key\nRUTX5qZvdPSepPF2zsjvP/L/TQtBLRnWRvaq+4omK1UEugtQp/USrGiI1v762sDy3id3aor7bRC9ETyeot6lMHHrWoZ5hjUM1Qc=\ntrusted comment: timestamp:1791649051\tfile:payload\tversion:2.0.0\nDDq2CLOEl5cQmC2eJRHlnZPVViOZsu1CjpPKQoei4A/XBfkDqGO0B+QMrcrHgEQ5qV3mne75tdFWhJpqUXh9AA==";

#[test]
fn native_updater_rejects_tampering_version_substitution_and_downgrades() {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".into(),
        json!({
            "pubkey": STANDARD.encode(KEY), "requireSignedVersion": true,
            "endpoints": ["https://example.invalid/update"]
        }),
    );
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    let updater = app
        .updater_builder()
        .target("test")
        .executable_path("/tmp/minion-test")
        .configure_client(|_| panic!("cached verification must not make a network request"))
        .build()
        .unwrap();
    let mut feed = json!({ "version": "2.0.0", "platforms": { "test": {
        "url": "https://example.invalid/app", "signature": STANDARD.encode(SIGNATURE)
    }}});
    let update = updater.restore_update(feed.clone()).unwrap().unwrap();
    update.verify(b"test").unwrap();
    assert!(update.verify(b"changed").is_err());
    feed["version"] = json!("9.9.9");
    assert!(updater
        .restore_update(feed.clone())
        .unwrap()
        .unwrap()
        .verify(b"test")
        .is_err());
    feed["version"] = json!(app.package_info().version.to_string());
    assert!(updater.restore_update(feed.clone()).unwrap().is_none());
    feed["version"] = json!("0.0.0");
    assert!(updater.restore_update(feed).unwrap().is_none());
}

// Use the actual generated capability manifest, exercising the IPC authorization
// boundary before invoking a harmless command with the same protected name.
#[tauri::command]
fn desktop_update_install() -> bool {
    true
}

#[test]
fn update_commands_are_local_window_only_even_on_the_trusted_hosted_origin() {
    let local = if cfg!(target_os = "windows") {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    };
    for (label, url, allowed) in [
        ("updater", local, true),
        ("main", local, false),
        ("main", "https://hub.minion-ai.org", false),
        ("updater", "https://hub.minion-ai.org", false),
        ("updater", "https://evil.test", false),
    ] {
        let app = tauri::test::mock_builder()
            .invoke_handler(tauri::generate_handler![desktop_update_install])
            .build(crate::app_context())
            .unwrap();
        let window = tauri::WebviewWindowBuilder::new(
            &app,
            label,
            tauri::WebviewUrl::External(url.parse().unwrap()),
        )
        .build()
        .unwrap();
        let result = tauri::test::get_ipc_response(
            &window,
            tauri::webview::InvokeRequest {
                cmd: "desktop_update_install".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: url.parse().unwrap(),
                body: tauri::ipc::InvokeBody::default(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        );
        assert_eq!(
            result.is_ok(),
            allowed,
            "{label} at {url}: {:?}",
            result.err()
        );
    }
}

// Minion Hub desktop shell (Tauri v2)
//
// Responsibilities:
//   1. Spawn the local SvelteKit (adapter-node) server as a child process
//      bound to 127.0.0.1:5959.
//   2. Open a single WebView window pointing at the bundled `loading-dist`
//      page, which polls 127.0.0.1:5959 and redirects when the server is up.
//   3. Kill the child server when the last window closes.
//
// The server is spawned outside Tauri's plugin-shell system so the shell stays
// minimal and dependency-free. When we move to packaged installers we'll
// switch to tauri-plugin-shell's `externalBin` sidecar so the bundled Node
// binary is signed alongside the app.

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

#[derive(Default)]
struct ServerHandle(Mutex<Option<Child>>);

#[cfg_attr(debug_assertions, allow(dead_code))]
fn spawn_server(handle: &ServerHandle) -> std::io::Result<()> {
    // Resolve the hub project root: src-tauri/.. — works in `cargo tauri dev`
    // and in the bundled app because the binary's working dir is the app
    // resource dir at runtime, which we set up at build time.
    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let hub_root = cwd
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| cwd.clone());

    let mut cmd = Command::new("node");
    cmd.arg("build/index.js")
        .current_dir(&hub_root)
        .env("DESKTOP", "1")
        .env("VITE_DESKTOP", "1")
        .env("PORT", "5959")
        .env("HOST", "127.0.0.1")
        .env("ORIGIN", "http://localhost:5959")
        // Don't inherit a TTY; the child should be silent unless we wire logs.
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    let child = cmd.spawn()?;
    *handle.0.lock().unwrap() = Some(child);
    Ok(())
}

#[cfg_attr(debug_assertions, allow(dead_code))]
fn kill_server(handle: &ServerHandle) {
    if let Some(mut child) = handle.0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let handle = ServerHandle::default();

    tauri::Builder::default()
        .manage(handle)
        .setup(|app| {
            // In dev mode (`bunx tauri dev`), Tauri's `beforeDevCommand` already
            // starts the Node sidecar via `bun run desktop:serve`. Spawning here
            // would race + EADDRINUSE on :5959. Only spawn in release builds
            // (i.e. inside a bundled installer, where no beforeDevCommand runs).
            #[cfg(not(debug_assertions))]
            {
                let server = app.state::<ServerHandle>();
                if let Err(e) = spawn_server(server.inner()) {
                    eprintln!("[desktop] failed to spawn server: {e}");
                }
            }
            #[cfg(debug_assertions)]
            {
                let _ = app;
                eprintln!("[desktop] dev build — relying on beforeDevCommand for sidecar");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                kill_server(&app.state::<ServerHandle>());
            }
        });
}

use crate::update_feed::{client_builder, download_package, trusted_artifact, Feed, ENDPOINT};
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    revision: u64,
    phase: &'static str,
    version: Option<String>,
    percent: Option<u64>,
    manual: bool,
    installer_url: Option<String>,
}

impl Default for Status {
    fn default() -> Self {
        Self {
            revision: 0,
            phase: "checking",
            version: None,
            percent: None,
            manual: false,
            installer_url: None,
        }
    }
}

#[derive(Default)]
pub struct Updates {
    status: Mutex<Status>,
    pending: Mutex<Option<Update>>,
    announced: Mutex<Option<String>>,
    feed: tokio::sync::Mutex<Feed>,
    flight: tokio::sync::Mutex<()>,
    startup: AtomicBool,
    generation: AtomicU64,
    cancel: tokio::sync::Notify,
}

fn publish(app: &tauri::AppHandle, mut status: Status) {
    let state = app.state::<Updates>();
    let mut current = state.status.lock().unwrap();
    status.revision = current.revision + 1;
    *current = status.clone();
    drop(current);
    let _ = app.emit_to("updater", "desktop-update", status);
}

pub fn show(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("updater") {
        window.show()?;
        window.set_focus()?;
    } else {
        WebviewWindowBuilder::new(app, "updater", WebviewUrl::App("index.html".into()))
            .title("Minion Hub — Updates")
            .inner_size(460.0, 340.0)
            .min_inner_size(360.0, 300.0)
            .resizable(true)
            .on_navigation(|url| {
                matches!(url.scheme(), "tauri" | "http" | "https")
                    && matches!(url.host_str(), Some("localhost" | "tauri.localhost"))
            })
            .build()?;
    }
    Ok(())
}

pub fn is_starting(app: &tauri::AppHandle) -> bool {
    app.state::<Updates>().startup.load(Ordering::SeqCst)
}

impl Updates {
    fn leave(&self) -> Option<Status> {
        let mut current = self.status.lock().unwrap();
        if current.phase == "installing" {
            return None;
        }
        self.startup.store(false, Ordering::SeqCst);
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.cancel.notify_waiters();
        if current.phase == "downloading" {
            current.phase = "available";
        }
        current.revision += 1;
        Some(current.clone())
    }

    fn commit_install(&self, generation: u64, mut next: Status) -> Option<Status> {
        let mut current = self.status.lock().unwrap();
        if self.generation.load(Ordering::SeqCst) != generation {
            return None;
        }
        next.revision = current.revision + 1;
        *current = next.clone();
        Some(next)
    }
}

fn publish_generation(app: &tauri::AppHandle, status: Status, generation: u64) -> bool {
    if let Some(status) = app.state::<Updates>().commit_install(generation, status) {
        let _ = app.emit_to("updater", "desktop-update", status);
        true
    } else {
        false
    }
}

fn continue_app(app: &tauri::AppHandle) -> bool {
    let Some(status) = app.state::<Updates>().leave() else {
        return false;
    };
    let _ = app.emit_to("updater", "desktop-update", status);
    if let Some(window) = app.get_webview_window("updater") {
        let _ = window.hide();
    }
    crate::show(app);
    true
}

fn platform() -> (&'static str, &'static str, &'static str) {
    #[cfg(target_os = "linux")]
    {
        ("linux-x64", "linux-x86_64", "AppImage")
    }
    #[cfg(target_os = "windows")]
    {
        ("windows-x64", "windows-x86_64", "exe")
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        ("macos-arm64", "darwin-aarch64", "app.tar.gz")
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        ("macos-x64", "darwin-x86_64", "app.tar.gz")
    }
}

fn manual_install() -> bool {
    // System-managed Linux packages must never invoke a privilege/password helper.
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("APPIMAGE").is_none()
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

async fn check(app: &tauri::AppHandle, auto: bool, visible: bool) -> Result<(), String> {
    let state = app.state::<Updates>();
    let Ok(_flight) = state.flight.try_lock() else {
        return Ok(());
    };
    if visible || auto {
        publish(app, Status::default());
    }
    let generation = state.generation.load(Ordering::SeqCst);
    let client = client_builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("Minion-Hub-Updater")
        .build()
        .map_err(|_| "metadata client failed")?;
    let json = state.feed.lock().await.fetch(&client, ENDPOINT).await?;
    if state.generation.load(Ordering::SeqCst) != generation {
        return Ok(());
    }
    let (platform, target, extension) = platform();
    // restore_update reuses this single conditional request and enforces the
    // signed version, trusted local key, and strict newer-version comparison.
    let updater = app
        .updater_builder()
        .target(target)
        .build()
        .map_err(|_| "updater unavailable")?;
    let update = updater
        .restore_update(json)
        .map_err(|_| "invalid release")?;
    *state.pending.lock().unwrap() = None;
    match update {
        Some(mut update) => {
            if !trusted_artifact(&update.download_url, &update.version, platform, extension) {
                return Err("untrusted artifact location".into());
            }
            update.timeout = Some(Duration::from_secs(600));
            let status = Status {
                phase: "available",
                version: Some(update.version.clone()),
                manual: manual_install(),
                installer_url: Some(format!(
                    "https://github.com/NikolasP98/minion_hub/releases/tag/desktop-v{}",
                    update.version
                )),
                ..Status::default()
            };
            *state.pending.lock().unwrap() = Some(update);
            if !publish_generation(app, status, generation) {
                return Ok(());
            }
            let announce = {
                let mut announced = state.announced.lock().unwrap();
                let version = state
                    .pending
                    .lock()
                    .unwrap()
                    .as_ref()
                    .map(|update| update.version.clone());
                let changed = *announced != version;
                *announced = version;
                changed
            };
            if auto && !manual_install() && is_starting(app) {
                install(app, generation).await?;
            } else if auto || visible || announce {
                show(app).map_err(|_| "update notice unavailable")?;
            }
        }
        None => {
            publish(
                app,
                Status {
                    phase: "current",
                    ..Status::default()
                },
            );
            if auto && is_starting(app) {
                continue_app(app);
            }
        }
    }
    Ok(())
}

async fn install(app: &tauri::AppHandle, generation: u64) -> Result<(), String> {
    let state = app.state::<Updates>();
    if manual_install() {
        return Err("package manager installation required".into());
    }
    let update = state.pending.lock().unwrap().clone().ok_or("no update")?;
    let mut status = Status {
        phase: "downloading",
        version: Some(update.version.clone()),
        ..Status::default()
    };
    if !publish_generation(app, status.clone(), generation) {
        return Ok(());
    }
    let client = client_builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("Minion-Hub-Updater")
        .build()
        .map_err(|_| "download client failed")?;
    let mut downloaded = 0u64;
    let mut previous = None;
    let cancelled = state.cancel.notified();
    let bytes = tokio::select! {
        result = download_package(&client, update.download_url.clone(), |n, total| {
            downloaded += n as u64;
            let percent = total.filter(|total| *total > 0).map(|total| (downloaded.saturating_mul(100) / total).min(100));
            if percent != previous {
                previous = percent;
                publish_generation(app, Status { percent, ..status.clone() }, generation);
            }
        }) => result?,
        _ = cancelled => return Ok(()),
    };
    // Closing/continuing the startup screen fences late completions. Once the
    // app is active, no startup job may replace its executable or restart it.
    if state.generation.load(Ordering::SeqCst) != generation {
        return Ok(());
    }
    status.phase = "installing";
    status.percent = Some(100);
    update
        .verify(&bytes)
        .map_err(|_| "integrity verification failed")?;
    if !publish_generation(app, status, generation) {
        return Ok(());
    }
    // TODO(handoff): Qualify installed old-to-new updates and relaunch on all
    // four OS targets before the first updater publication. Mock IPC, signed
    // payload tests and packaging CI do not prove OS installation. Tracked by
    // minion-meta/proposals/2026-10-21-hub-desktop-updates.md.
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // install verifies the bytes again; Windows hands off to NSIS and exits.
        update.install(&bytes).map_err(|_| "installation failed")?;
        handle.restart();
        #[allow(unreachable_code)]
        Ok::<(), String>(())
    })
    .await
    .map_err(|_| "installer task failed")??;
    Ok(())
}

fn failed(app: &tauri::AppHandle, visible: bool) {
    if visible || is_starting(app) {
        publish(
            app,
            Status {
                phase: "failed",
                ..Status::default()
            },
        );
        let _ = show(app);
    }
}

#[tauri::command]
pub fn desktop_update_status(state: tauri::State<'_, Updates>) -> Status {
    state.status.lock().unwrap().clone()
}

#[tauri::command]
pub fn desktop_update_continue(app: tauri::AppHandle) -> Result<(), String> {
    if continue_app(&app) {
        Ok(())
    } else {
        Err("installation in progress".into())
    }
}

#[tauri::command]
pub async fn desktop_update_install(app: tauri::AppHandle, revision: u64) -> Result<(), String> {
    let state = app.state::<Updates>();
    let Ok(_flight) = state.flight.try_lock() else {
        return Ok(());
    };
    let generation = {
        let status = state.status.lock().unwrap();
        if status.revision != revision || status.phase != "available" {
            return Err("update notice changed".into());
        }
        state.generation.load(Ordering::SeqCst)
    };
    if let Err(error) = install(&app, generation).await {
        if state.generation.load(Ordering::SeqCst) != generation {
            return Ok(());
        }
        failed(&app, true);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub async fn desktop_update_check(app: tauri::AppHandle) {
    let auto = is_starting(&app);
    let generation = app.state::<Updates>().generation.load(Ordering::SeqCst);
    if check(&app, auto, true).await.is_err()
        && app.state::<Updates>().generation.load(Ordering::SeqCst) == generation
    {
        failed(&app, true);
    }
}

#[tauri::command]
pub fn desktop_update_download(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Updates>();
    let pending = state.pending.lock().unwrap();
    let update = pending.as_ref().ok_or("no update")?;
    // No URL is accepted from JavaScript. Only the already admitted release page.
    let url = format!(
        "https://github.com/NikolasP98/minion_hub/releases/tag/desktop-v{}",
        update.version
    );
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "could not open download page".into())
}

pub fn menu(app: &tauri::AppHandle) {
    let _ = show(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        desktop_update_check(app).await;
    });
}

pub fn start(app: &tauri::AppHandle) {
    app.state::<Updates>().startup.store(true, Ordering::SeqCst);
    if show(app).is_err() {
        continue_app(app);
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if check(&app, true, true).await.is_err() {
            // Offline metadata must not prevent ordinary use of the hosted app.
            let phase = app.state::<Updates>().status.lock().unwrap().phase;
            if matches!(phase, "downloading" | "installing") {
                failed(&app, true);
            } else {
                continue_app(&app);
            }
        }
        let jitter = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .subsec_nanos() as u64
            % 900;
        loop {
            tokio::time::sleep(Duration::from_secs(6 * 60 * 60 + jitter)).await;
            if check(&app, false, false).await.is_err() {
                failed(&app, false);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn continuing_fences_late_downloads_and_prevents_stale_install_intents() {
        let state = Updates::default();
        state.startup.store(true, Ordering::SeqCst);
        state.status.lock().unwrap().phase = "downloading";
        let generation = state.generation.load(Ordering::SeqCst);
        assert!(state.leave().is_some());
        assert!(!state.startup.load(Ordering::SeqCst));
        assert_eq!(state.status.lock().unwrap().phase, "available");
        assert!(state
            .commit_install(
                generation,
                Status {
                    phase: "installing",
                    ..Status::default()
                }
            )
            .is_none());
        assert!(state
            .commit_install(
                generation,
                Status {
                    phase: "downloading",
                    ..Status::default()
                }
            )
            .is_none());
    }

    #[test]
    fn once_installation_commits_continue_cannot_open_an_editing_session() {
        let state = Updates::default();
        state.startup.store(true, Ordering::SeqCst);
        let generation = state.generation.load(Ordering::SeqCst);
        assert!(state
            .commit_install(
                generation,
                Status {
                    phase: "installing",
                    ..Status::default()
                }
            )
            .is_some());
        assert!(state.leave().is_none());
        assert!(state.startup.load(Ordering::SeqCst));
        assert_eq!(state.generation.load(Ordering::SeqCst), generation);
    }
}

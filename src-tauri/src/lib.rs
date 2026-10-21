// Hosted Hub shell. Authentication and all application services stay on the
// configured HTTPS origin; there is no Node sidecar or local server.
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_deep_link::DeepLinkExt;

const HUB_ORIGIN: &str = "https://hub.minion-ai.org";

fn deep_link_target(raw: &str) -> Option<tauri::Url> {
    let link = tauri::Url::parse(raw).ok()?;
    if link.scheme() != "minion"
        || !link.username().is_empty()
        || link.password().is_some()
        || link.port().is_some()
    {
        return None;
    }
    // minion://hub/crm/customers?id=... maps only to our trusted origin.
    // An arbitrary authority must never become a navigation destination.
    if link.host_str() != Some("hub") {
        return None;
    }
    let mut target = tauri::Url::parse(HUB_ORIGIN).ok()?;
    target.set_path(link.path());
    target.set_query(link.query());
    target.set_fragment(link.fragment());
    Some(target)
}

fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn open_links(app: &tauri::AppHandle, links: impl IntoIterator<Item = tauri::Url>) {
    for link in links {
        if let Some(target) = deep_link_target(link.as_str()) {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.navigate(target);
                show(app);
                break;
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            open_links(
                app,
                argv.iter().filter_map(|arg| tauri::Url::parse(arg).ok()),
            );
            show(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            let quit =
                MenuItem::with_id(app, "quit", "Quit Minion Hub", true, Some("CmdOrCtrl+Q"))?;
            let show_item = MenuItem::with_id(app, "show", "Show Minion Hub", true, None::<&str>)?;
            let reload = MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?;
            let app_menu =
                Submenu::with_items(app, "Minion Hub", true, &[&show_item, &reload, &quit])?;
            let edit = Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?;
            app.set_menu(Menu::with_items(app, &[&app_menu, &edit])?)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("Minion Hub");
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            let origin = tauri::Url::parse(HUB_ORIGIN)?;
            let trusted_origin = origin.origin();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(origin))
                .title("Minion Hub")
                .inner_size(1400.0, 900.0)
                .min_inner_size(900.0, 600.0)
                .decorations(false)
                .initialization_script(
                    "Object.defineProperty(window, '__MINION_DESKTOP__', { value: true });",
                )
                // TODO(handoff): Qualify provider sign-in in installed OS webviews
                // before distributing installers; this headless lane compiles/tests
                // the shell only. Tracked by minion-meta proposal
                // 2026-10-19-hub-tauri-native-shell and the verification receipt.
                // OAuth may visit an external identity provider; its pages have
                // no remote IPC capability. Only HTTPS navigation is allowed.
                .on_navigation(move |url| url.origin() == trusted_origin || url.scheme() == "https")
                .build()?;
            if let Some(urls) = app.deep_link().get_current()? {
                open_links(app.handle(), urls);
            }
            let handle = app.handle().clone();
            app.deep_link()
                .on_open_url(move |event| open_links(&handle, event.urls()));
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => app.exit(0),
            "show" => show(app),
            "reload" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.reload();
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running Minion Hub");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_deep_links_without_changing_the_trusted_origin() {
        assert_eq!(
            deep_link_target("minion://hub/es/crm/customers?q=ana#row")
                .unwrap()
                .as_str(),
            "https://hub.minion-ai.org/es/crm/customers?q=ana#row"
        );
        assert_eq!(
            deep_link_target("minion://hub//evil.test/a")
                .unwrap()
                .host_str(),
            Some("hub.minion-ai.org")
        );
        for raw in [
            "https://evil.test",
            "minion://evil.test/crm",
            "minion://user@hub/crm",
            "minion://hub:99/crm",
            "garbage",
        ] {
            assert!(deep_link_target(raw).is_none(), "accepted {raw}");
        }
    }
}

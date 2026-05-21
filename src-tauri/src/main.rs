// Prevents additional console window on Windows in release builds; harmless on
// macOS / Linux. The `windows_subsystem` attribute must be at crate root.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    minion_hub_desktop_lib::run()
}

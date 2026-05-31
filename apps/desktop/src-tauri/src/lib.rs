#[cfg(desktop)]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let stronghold = tauri_plugin_stronghold::Builder::new(|password| {
    blake3::hash(password.as_ref()).as_bytes().to_vec()
  })
  .build();

  #[allow(unused_mut)]
  let mut builder = tauri::Builder::default();

  // Single-instance must be registered first: a second launch (e.g. clicking
  // the shortcut while the app is tray-resident) just focuses the running
  // window instead of starting a duplicate process.
  #[cfg(desktop)]
  {
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
      reveal_main_window(app);
    }));
  }

  builder
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_notification::init())
    .plugin(stronghold)
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      #[cfg(desktop)]
      {
        app.handle()
          .plugin(tauri_plugin_updater::Builder::new().build())?;

        // Launch-on-login so background meeting notifications survive a reboot.
        // The "--minimized" flag makes the autostarted instance boot to tray.
        app.handle().plugin(tauri_plugin_autostart::init(
          tauri_plugin_autostart::MacosLauncher::LaunchAgent,
          Some(vec!["--minimized"]),
        ))?;

        if !cfg!(debug_assertions) {
          use tauri_plugin_autostart::ManagerExt;
          let _ = app.autolaunch().enable();
        }

        build_tray(app.handle())?;

        // If autostarted with --minimized, start hidden in the tray.
        if std::env::args().any(|arg| arg == "--minimized") {
          if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
          }
        }
      }

      Ok(())
    })
    .on_window_event(|window, event| {
      // Close-to-tray for the main window: hide instead of quitting so the
      // background auto-sync keeps running and firing notifications. Secondary
      // windows (e.g. "current-meeting") close normally.
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" {
          let _ = window.hide();
          api.prevent_close();
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(desktop)]
fn reveal_main_window(app: &tauri::AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

#[cfg(desktop)]
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
  use tauri::menu::{Menu, MenuItem};
  use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

  let show = MenuItem::with_id(app, "show", "Open OpsUI Meetings", true, None::<&str>)?;
  let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&show, &quit])?;

  TrayIconBuilder::with_id("main-tray")
    .icon(app.default_window_icon().unwrap().clone())
    .tooltip("OpsUI Meetings")
    .menu(&menu)
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id.as_ref() {
      "show" => reveal_main_window(app),
      "quit" => app.exit(0),
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        reveal_main_window(tray.app_handle());
      }
    })
    .build(app)?;

  Ok(())
}

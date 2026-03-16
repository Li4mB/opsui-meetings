#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let stronghold = tauri_plugin_stronghold::Builder::new(|password| {
    blake3::hash(password.as_ref()).as_bytes().to_vec()
  })
  .build();

  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_sql::Builder::default().build())
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
      app.handle()
        .plugin(tauri_plugin_updater::Builder::new().build())?;

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

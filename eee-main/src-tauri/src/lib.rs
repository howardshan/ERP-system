#[tauri::command]
fn print_png(png_base64: String, printer: String) -> Result<(), String> {
    use base64::{Engine, engine::general_purpose::STANDARD};
    use std::fs;

    let bytes = STANDARD.decode(&png_base64).map_err(|e| e.to_string())?;
    let temp_path = std::env::temp_dir().join("erp_sticker_print.png");
    fs::write(&temp_path, &bytes).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        // PNG is a portrait 812×1218 image (landscape design rotated 90° CCW)
        // rendered at 203 DPI for the printer's w4h6 label (4×6 inch).
        // The PNG dimensions exactly match w4h6 at 203 DPI so no scaling is needed.
        std::process::Command::new("lp")
            .arg("-d").arg(&printer)
            .arg("-o").arg("media=w4h6")
            .arg(temp_path.to_str().unwrap())
            .output()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn get_default_printer() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let out = Command::new("lpstat")
            .arg("-d")
            .output()
            .map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&out.stdout);
        // Output is: "system default destination: PrinterName"
        if let Some(pos) = stdout.find(": ") {
            return Ok(stdout[pos + 2..].trim().to_string());
        }
        Err("No default printer found".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(String::new())
    }
}

#[tauri::command]
fn print_html(html: String, printer: String) -> Result<(), String> {
    use std::fs;
    use std::process::Command;

    let temp_path = std::env::temp_dir().join("erp_sticker_print.html");
    fs::write(&temp_path, &html).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("lp");
        cmd.arg("-d").arg(&printer)
           .arg("-o").arg("media=w105mmh80mm")
           .arg("-o").arg("fit-to-page")
           .arg(temp_path.to_str().unwrap());
        cmd.output().map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        // On Windows, kiosk-printing handles this via window.print()
        // This branch is a no-op — the frontend falls back to window.print()
        let _ = printer;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![print_html, print_png, get_default_printer])
        .run(tauri::generate_context!())
        .expect("error while running ERP Financials");
}

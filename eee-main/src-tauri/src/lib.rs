/// Print a portrait 812×1218 PNG on the label printer.
///
/// The PNG is the landscape sticker design pre-rotated 90° CCW by the browser.
/// CUPS submits it to rastertolabel with the w4h6 media option so the full
/// 4×6 inch label is filled.  (Run `lpoptions -p <printer> -o PageSize=w4h6`
/// once to make w4h6 the persistent default for this queue.)
#[tauri::command]
fn print_png(png_base64: String, printer: String) -> Result<String, String> {
    use base64::{Engine, engine::general_purpose::STANDARD};
    use std::fs;
    use std::process::Command;
    use std::time::Instant;

    let t0 = Instant::now();

    let bytes = STANDARD.decode(&png_base64).map_err(|e| e.to_string())?;
    let temp_path = std::env::temp_dir().join("erp_sticker_print.png");
    fs::write(&temp_path, &bytes).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        let out = Command::new("lp")
            .arg("-d").arg(&printer)
            .arg("-o").arg("media=w4h6")
            .arg("-o").arg("fit-to-page=false")
            .arg("-o").arg("print-scaling=none")
            .arg(temp_path.to_str().unwrap())
            .output()
            .map_err(|e| e.to_string())?;

        if !out.status.success() {
            return Err(format!(
                "lp failed (exit {}): {}",
                out.status.code().unwrap_or(-1),
                String::from_utf8_lossy(&out.stderr).trim(),
            ));
        }

        return Ok(format!("submitted in {}ms", t0.elapsed().as_millis()));
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (printer, bytes);
    }
    Ok(format!("done in {}ms", t0.elapsed().as_millis()))
}

/// Return all CUPS printer queue names that are currently accepting jobs.
/// Parses `lpstat -a` output — each line starts with the queue name.
#[tauri::command]
fn list_printers() -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        // `lpstat -e` prints only queue names, one per line — locale-independent.
        let out = Command::new("lpstat").arg("-e").output().map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&out.stdout);
        let names: Vec<String> = stdout
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        return Ok(names);
    }
    #[cfg(not(target_os = "macos"))]
    Ok(vec![])
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
        Command::new("lp")
            .arg("-d").arg(&printer)
            .arg("-o").arg("media=w105mmh80mm")
            .arg("-o").arg("fit-to-page")
            .arg(temp_path.to_str().unwrap())
            .output()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        let _ = printer;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![print_html, print_png, get_default_printer, list_printers])
        .run(tauri::generate_context!())
        .expect("error while running ERP Financials");
}

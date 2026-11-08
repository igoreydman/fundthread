#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use fundthread_core::exports::{ExportPreview, ExportSpec};
use fundthread_core::{Document, FundInput, ImportOutcome, ReviewInput, Snapshot, Vault};
use serde::Serialize;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;
use zeroize::Zeroizing;

type R<T> = Result<T, String>;
struct Session {
    root: PathBuf,
    database_url: Zeroizing<String>,
    vault: Option<Vault>,
}
#[derive(Clone)]
struct Store(Arc<Mutex<Session>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    exists: bool,
    unlocked: bool,
}
fn guard_export_destination(root: &Path, destination: &Path) -> R<()> {
    let owned = root
        .canonicalize()
        .map_err(|_| "Workspace location is unavailable.")?;
    let target = destination
        .canonicalize()
        .or_else(|_| {
            destination
                .parent()
                .ok_or(std::io::Error::other("Missing export directory"))
                .and_then(|p| p.canonicalize())
                .map(|p| p.join(destination.file_name().unwrap_or_default()))
        })
        .map_err(|_| "Choose an existing local export directory.")?;
    if target.starts_with(owned)
        || target
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("fundthread"))
    {
        return Err("Save exported copies outside the workspace directory, using a CSV or PDF filename. Application state and legacy workspace files are protected.".into());
    }
    Ok(())
}
fn write_export(root: &Path, destination: &Path, bytes: &[u8]) -> R<()> {
    guard_export_destination(root, destination)?;
    let temporary =
        destination.with_file_name(format!(".fundthread-export-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|_| "Could not create the export file.")?;
        std::io::Write::write_all(&mut file, bytes)
            .map_err(|_| "Could not finish writing the export.")?;
        file.sync_all().map_err(|_| "Could not flush the export.")?;
        drop(file);
        fs::rename(&temporary, destination)
            .map_err(|_| "Could not finish the selected export file.")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
fn main_only(window: &WebviewWindow) -> R<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("This window is not authorized.".into())
    }
}
async fn work<T: Send + 'static>(
    store: Store,
    f: impl FnOnce(&mut Session) -> R<T> + Send + 'static,
) -> R<T> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut s = store.0.lock().map_err(|_| "Workspace is unavailable.")?;
        f(&mut s)
    })
    .await
    .map_err(|_| "The local operation could not finish.".to_string())?
}
fn vault(s: &mut Session) -> R<&mut Vault> {
    s.vault
        .as_mut()
        .ok_or_else(|| "Connect to your workspace first.".into())
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportResult {
    outcomes: Vec<ImportOutcome>,
    failures: Vec<ImportFailure>,
}
#[derive(Clone, Serialize)]
struct ImportFailure {
    filename: String,
    reason: String,
}
fn import_paths(s: &mut Session, paths: Vec<PathBuf>) -> R<ImportResult> {
    let v = vault(s)?;
    let mut result = ImportResult::default();
    for p in paths {
        let filename = p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("receipt")
            .to_string();
        let imported = (|| {
            let mut file = fs::File::open(&p).map_err(|_| "Could not read a selected file.")?;
            if file
                .metadata()
                .map_err(|_| "Could not inspect the file.")?
                .len()
                > fundthread_core::MAX_DOCUMENT_BYTES as u64
            {
                return Err("This file exceeds 20 MB.".to_string());
            }
            let mut bytes = Vec::new();
            file.by_ref()
                .take(fundthread_core::MAX_DOCUMENT_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "Could not finish reading the receipt.")?;
            v.import_bytes(&filename, &bytes)
        })();
        match imported {
            Ok(item) => result.outcomes.push(item),
            Err(reason) => result.failures.push(ImportFailure { filename, reason }),
        }
    }
    Ok(result)
}
#[tauri::command]
async fn workspace_status(window: WebviewWindow, store: State<'_, Store>) -> R<Status> {
    main_only(&window)?;
    work(store.inner().clone(), |s| {
        Ok(Status {
            exists: Vault::exists(&s.database_url)?,
            unlocked: s.vault.is_some(),
        })
    })
    .await
}
#[tauri::command]
async fn create_workspace(
    window: WebviewWindow,
    store: State<'_, Store>,
    organization: String,
    operator: String,
) -> R<Snapshot> {
    main_only(&window)?;
    work(store.inner().clone(), move |s| {
        let v = Vault::create(&s.database_url, &organization, &operator)?;
        let snap = v.snapshot()?;
        s.vault = Some(v);
        Ok(snap)
    })
    .await
}
#[tauri::command]
async fn unlock_workspace(window: WebviewWindow, store: State<'_, Store>) -> R<Snapshot> {
    main_only(&window)?;
    work(store.inner().clone(), move |s| {
        let v = Vault::open(&s.database_url)?;
        let snap = v.snapshot()?;
        s.vault = Some(v);
        Ok(snap)
    })
    .await
}
#[tauri::command]
async fn lock_workspace(window: WebviewWindow, store: State<'_, Store>) -> R<()> {
    main_only(&window)?;
    work(store.inner().clone(), |s| {
        s.vault = None;
        Ok(())
    })
    .await
}
#[tauri::command]
async fn get_snapshot(window: WebviewWindow, store: State<'_, Store>) -> R<Snapshot> {
    main_only(&window)?;
    work(store.inner().clone(), |s| vault(s)?.snapshot()).await
}
#[tauri::command]
async fn pick_receipts(
    app: tauri::AppHandle,
    window: WebviewWindow,
    store: State<'_, Store>,
) -> R<ImportResult> {
    main_only(&window)?;
    work(store.inner().clone(), move |s| {
        vault(s)?;
        let paths = app
            .dialog()
            .file()
            .add_filter("Receipt documents", &["pdf", "png", "jpg", "jpeg"])
            .blocking_pick_files();
        match paths {
            None => Ok(ImportResult::default()),
            Some(paths) => {
                let paths = paths
                    .into_iter()
                    .map(|p| {
                        p.into_path()
                            .map_err(|_| "This file location is not supported.".to_string())
                    })
                    .collect::<R<Vec<_>>>()?;
                import_paths(s, paths)
            }
        }
    })
    .await
}
#[tauri::command]
async fn get_document(
    window: WebviewWindow,
    store: State<'_, Store>,
    document_id: String,
) -> R<Document> {
    main_only(&window)?;
    work(store.inner().clone(), move |s| {
        vault(s)?.document(&document_id)
    })
    .await
}
#[tauri::command]
async fn save_review(
    window: WebviewWindow,
    store: State<'_, Store>,
    input: ReviewInput,
) -> R<Snapshot> {
    main_only(&window)?;
    work(store.inner().clone(), move |s| {
        let v = vault(s)?;
        v.save_review(input)?;
        v.snapshot()
    })
    .await
}
#[tauri::command]
async fn add_fund(window: WebviewWindow, store: State<'_, Store>, input: FundInput) -> R<Snapshot> {
    main_only(&window)?;
    work(store.inner().clone(), move |s| {
        let v = vault(s)?;
        v.add_fund(input)?;
        v.snapshot()
    })
    .await
}
#[tauri::command]
async fn record_approval(
    window: WebviewWindow,
    store: State<'_, Store>,
    expense_id: String,
    revision: i64,
    approver: String,
    reference: String,
) -> R<Snapshot> {
    main_only(&window)?;
    work(store.inner().clone(), move |s| {
        let v = vault(s)?;
        v.approve(&expense_id, revision, &approver, &reference)?;
        v.snapshot()
    })
    .await
}
#[tauri::command]
async fn record_payment(
    window: WebviewWindow,
    store: State<'_, Store>,
    expense_id: String,
    amount_minor: String,
    reference: String,
    date: String,
) -> R<Snapshot> {
    main_only(&window)?;
    work(store.inner().clone(), move |s| {
        let v = vault(s)?;
        v.record_payment(&expense_id, &amount_minor, &reference, &date)?;
        v.snapshot()
    })
    .await
}
#[tauri::command]
async fn reconcile_payment(
    window: WebviewWindow,
    store: State<'_, Store>,
    payment_id: String,
) -> R<Snapshot> {
    main_only(&window)?;
    work(store.inner().clone(), move |s| {
        let v = vault(s)?;
        v.reconcile(&payment_id)?;
        v.snapshot()
    })
    .await
}
#[tauri::command]
async fn save_extraction(
    window: WebviewWindow,
    store: State<'_, Store>,
    expense_id: String,
    data: serde_json::Value,
) -> R<Snapshot> {
    main_only(&window)?;
    work(store.inner().clone(), move |s| {
        let v = vault(s)?;
        v.save_extraction(&expense_id, data)?;
        v.snapshot()
    })
    .await
}
#[tauri::command]
async fn get_history(
    window: WebviewWindow,
    store: State<'_, Store>,
    expense_id: String,
) -> R<serde_json::Value> {
    main_only(&window)?;
    work(store.inner().clone(), move |s| {
        vault(s)?.history(&expense_id)
    })
    .await
}
#[tauri::command]
async fn get_privacy_plan(
    window: WebviewWindow,
    store: State<'_, Store>,
    document_id: String,
) -> R<serde_json::Value> {
    main_only(&window)?;
    work(store.inner().clone(), move |s| {
        vault(s)?.privacy_plan(&document_id)
    })
    .await
}
#[tauri::command]
async fn save_privacy_plan(
    window: WebviewWindow,
    store: State<'_, Store>,
    document_id: String,
    regions: serde_json::Value,
) -> R<()> {
    main_only(&window)?;
    work(store.inner().clone(), move |s| {
        vault(s)?.save_privacy_plan(&document_id, regions)
    })
    .await
}
fn check_export_revision(expected: &str, current: &ExportPreview) -> R<()> {
    if current.revision_token != expected {
        return Err("Records or organization details changed. Preview the export again.".into());
    }
    Ok(())
}
fn validate_report_pdf(bytes: &[u8]) -> R<()> {
    if !bytes.starts_with(b"%PDF-") || bytes.len() > 100 * 1024 * 1024 {
        return Err("Preview a supported PDF before saving it.".into());
    }
    Ok(())
}
fn write_current_export(
    root: &Path,
    destination: &Path,
    expected: &str,
    current: &ExportPreview,
    format: &str,
    pdf: &[u8],
) -> R<()> {
    check_export_revision(expected, current)?;
    match format {
        "csv" => write_export(root, destination, current.csv.as_bytes()),
        "pdf" => {
            validate_report_pdf(pdf)?;
            write_export(root, destination, pdf)
        }
        _ => Err("Choose CSV or PDF.".into()),
    }
}
#[tauri::command]
async fn preview_export(
    window: WebviewWindow,
    store: State<'_, Store>,
    spec: ExportSpec,
) -> R<ExportPreview> {
    main_only(&window)?;
    work(store.inner().clone(), move |s| {
        fundthread_core::exports::preview(vault(s)?, &spec)
    })
    .await
}
#[tauri::command]
async fn save_export(
    app: tauri::AppHandle,
    window: WebviewWindow,
    store: State<'_, Store>,
    spec: ExportSpec,
    revision_token: String,
    format: String,
    bytes: Vec<u8>,
) -> R<bool> {
    main_only(&window)?;
    work(store.inner().clone(), move |s| {
        if format != "csv" && format != "pdf" {
            return Err("Choose CSV or PDF.".into());
        }
        if format == "pdf" {
            validate_report_pdf(&bytes)?;
        }
        let before = fundthread_core::exports::preview(vault(s)?, &spec)?;
        check_export_revision(&revision_token, &before)?;
        let label = match &spec {
            ExportSpec::Report { profile } => profile.as_str(),
            ExportSpec::Analytics { .. } => "analytics",
        };
        let selected = app
            .dialog()
            .file()
            .set_file_name(format!("fundthread-{label}.{format}"))
            .add_filter(
                if format == "pdf" {
                    "PDF report"
                } else {
                    "CSV report"
                },
                &[format.as_str()],
            )
            .blocking_save_file();
        let Some(file) = selected else {
            return Ok(false);
        };
        let destination = file
            .into_path()
            .map_err(|_| "Choose a local destination.")?;
        // The dialog may remain open while another PostgreSQL client changes the
        // workspace. Re-read the full snapshot, including organization and scope.
        let current = fundthread_core::exports::preview(vault(s)?, &spec)?;
        write_current_export(
            &s.root,
            &destination,
            &revision_token,
            &current,
            &format,
            &bytes,
        )?;
        Ok(true)
    })
    .await
}
#[tauri::command]
async fn preview_report(
    window: WebviewWindow,
    store: State<'_, Store>,
    profile: String,
) -> R<ExportPreview> {
    preview_export(window, store, ExportSpec::Report { profile }).await
}
#[tauri::command]
async fn write_report(
    app: tauri::AppHandle,
    window: WebviewWindow,
    store: State<'_, Store>,
    profile: String,
    revision_token: String,
) -> R<bool> {
    save_export(
        app,
        window,
        store,
        ExportSpec::Report { profile },
        revision_token,
        "csv".into(),
        Vec::new(),
    )
    .await
}
#[tauri::command]
async fn write_reviewed_pdf(
    app: tauri::AppHandle,
    window: WebviewWindow,
    store: State<'_, Store>,
    expense_id: String,
    revision: i64,
    bytes: Vec<u8>,
    confirmed: bool,
) -> R<bool> {
    main_only(&window)?;
    work(store.inner().clone(), move |s| {
        if !confirmed || !bytes.starts_with(b"%PDF-") || bytes.len() > 100 * 1024 * 1024 {
            return Err("Review every page before saving a supported PDF derivative.".into());
        }
        let snap = vault(s)?.snapshot()?;
        let e = snap
            .expenses
            .iter()
            .find(|e| e.id == expense_id)
            .ok_or("Claim not found.")?;
        if e.revision != revision {
            return Err("This claim changed. Review its export again.".into());
        }
        if let Some(file) = app
            .dialog()
            .file()
            .set_file_name(format!(
                "reviewed-receipt-{}.pdf",
                expense_id.chars().take(8).collect::<String>()
            ))
            .add_filter("Reviewed PDF copy", &["pdf"])
            .blocking_save_file()
        {
            let destination = file
                .into_path()
                .map_err(|_| "Choose a local destination.")?;
            write_export(&s.root, &destination, &bytes)?;
            vault(s)?.record_derivative(
                &expense_id,
                revision,
                &fundthread_core::content_hash(&bytes),
            )?;
            Ok(true)
        } else {
            Ok(false)
        }
    })
    .await
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = app.path().app_local_data_dir()?;
            fs::create_dir_all(&root)?;
            let database_url =
                Zeroizing::new(std::env::var("FUNDTHREAD_DATABASE_URL").unwrap_or_default());
            app.manage(Store(Arc::new(Mutex::new(Session {
                database_url,
                root,
                vault: None,
            }))));
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("FundThread")
            .inner_size(1480.0, 960.0)
            .min_inner_size(1100.0, 740.0)
            .center()
            .on_navigation(|url| {
                (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                    || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
                    || (cfg!(debug_assertions)
                        && url.host_str() == Some("127.0.0.1")
                        && url.port() == Some(1420))
            })
            .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let app = window.app_handle().clone();
                let store = app.state::<Store>().inner().clone();
                let paths = paths.clone();
                tauri::async_runtime::spawn(async move {
                    let result = work(store, move |s| import_paths(s, paths)).await;
                    match result {
                        Ok(items) => {
                            let _ = app.emit("receipts-imported", items);
                        }
                        Err(message) => {
                            let _ = app.emit("import-error", message);
                        }
                    }
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            workspace_status,
            create_workspace,
            unlock_workspace,
            lock_workspace,
            get_snapshot,
            pick_receipts,
            get_document,
            save_review,
            add_fund,
            record_approval,
            record_payment,
            reconcile_payment,
            save_extraction,
            get_history,
            get_privacy_plan,
            save_privacy_plan,
            preview_export,
            save_export,
            preview_report,
            write_report,
            write_reviewed_pdf
        ])
        .run(tauri::generate_context!())
        .expect("FundThread could not start");
}

#[cfg(test)]
mod export_tests {
    use super::*;
    fn report(token: &str) -> ExportPreview {
        ExportPreview {
            csv: "approved,rows\r\n53.25,1".into(),
            rows: vec![],
            organization: "Organization".into(),
            revision_token: token.into(),
            spec: ExportSpec::Report {
                profile: "funder".into(),
            },
        }
    }
    #[test]
    fn changed_snapshot_after_destination_selection_does_not_replace_a_file() {
        let base = std::env::temp_dir().join(format!("fundthread-stale-export-{}", Uuid::new_v4()));
        let root = base.join("owned");
        fs::create_dir_all(&root).unwrap();
        let destination = base.join("report.csv");
        fs::write(&destination, b"existing file").unwrap();
        assert!(
            write_current_export(
                &root,
                &destination,
                "preview-before-dialog",
                &report("changed-after-dialog"),
                "csv",
                &[]
            )
            .is_err()
        );
        assert_eq!(fs::read(&destination).unwrap(), b"existing file");
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn csv_uses_authoritative_rows_and_invalid_pdf_never_writes() {
        let base = std::env::temp_dir().join(format!("fundthread-typed-export-{}", Uuid::new_v4()));
        let root = base.join("owned");
        fs::create_dir_all(&root).unwrap();
        let csv = base.join("report.csv");
        let current = report("current");
        write_current_export(
            &root,
            &csv,
            "current",
            &current,
            "csv",
            b"untrusted supplied bytes",
        )
        .unwrap();
        assert_eq!(fs::read(&csv).unwrap(), current.csv.as_bytes());
        let pdf = base.join("report.pdf");
        assert!(
            write_current_export(&root, &pdf, "current", &current, "pdf", b"not a PDF").is_err()
        );
        assert!(!pdf.exists());
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn export_cannot_overwrite_vault_files_or_backup_extensions() {
        let base = std::env::temp_dir().join(format!("fundthread-export-test-{}", Uuid::new_v4()));
        let root = base.join("owned");
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("workspace.fundthread"),
            b"synthetic encrypted placeholder",
        )
        .unwrap();
        assert!(guard_export_destination(&root, &root.join("workspace.fundthread")).is_err());
        assert!(guard_export_destination(&root, &root.join("active-workspace.json")).is_err());
        assert!(guard_export_destination(&root, &base.join("backup.FUNDTHREAD")).is_err());
        assert!(guard_export_destination(&root, &base.join("report.csv")).is_ok());
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn atomic_export_does_not_truncate_a_hard_linked_original() {
        let base = std::env::temp_dir().join(format!("fundthread-export-test-{}", Uuid::new_v4()));
        let root = base.join("owned");
        fs::create_dir_all(&root).unwrap();
        let vault = root.join("workspace.fundthread");
        fs::write(&vault, b"preserve original").unwrap();
        let alias = base.join("report.csv");
        fs::hard_link(&vault, &alias).unwrap();
        write_export(&root, &alias, b"selected report").unwrap();
        assert_eq!(fs::read(&vault).unwrap(), b"preserve original");
        assert_eq!(fs::read(&alias).unwrap(), b"selected report");
        fs::remove_dir_all(base).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn export_detects_a_symbolic_link_to_the_owned_workspace() {
        let base = std::env::temp_dir().join(format!("fundthread-export-test-{}", Uuid::new_v4()));
        let root = base.join("owned");
        fs::create_dir_all(&root).unwrap();
        let vault = root.join("workspace.fundthread");
        fs::write(&vault, b"synthetic").unwrap();
        let alias = base.join("report.csv");
        std::os::unix::fs::symlink(&vault, &alias).unwrap();
        assert!(guard_export_destination(&root, &alias).is_err());
        fs::remove_dir_all(base).unwrap();
    }
}

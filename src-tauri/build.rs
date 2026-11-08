fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "workspace_status",
            "create_workspace",
            "unlock_workspace",
            "lock_workspace",
            "get_snapshot",
            "pick_receipts",
            "get_document",
            "save_review",
            "add_fund",
            "record_approval",
            "record_payment",
            "reconcile_payment",
            "save_extraction",
            "get_history",
            "get_privacy_plan",
            "save_privacy_plan",
            "preview_export",
            "save_export",
            "preview_report",
            "write_report",
            "write_reviewed_pdf",
        ]),
    ))
    .expect("FundThread application manifest could not be built");
}

use fundthread_core::*;
use postgres::{Client, NoTls};
use std::sync::{Arc, Barrier};

struct Database {
    admin_url: String,
    name: String,
    url: String,
}
impl Database {
    fn new() -> Self {
        let admin_url = std::env::var("FUNDTHREAD_TEST_DATABASE_URL").expect(
            "Set FUNDTHREAD_TEST_DATABASE_URL to a disposable local PostgreSQL admin database.",
        );
        let name = format!("fundthread_test_{}", uuid::Uuid::new_v4().simple());
        let mut admin = Client::connect(&admin_url, NoTls).unwrap();
        admin
            .batch_execute(&format!("CREATE DATABASE {name}"))
            .unwrap();
        let mut config: postgres::Config = admin_url.parse().unwrap();
        config.dbname(&name);
        // Tests use libpq keyword connections; reconstruct from the loopback test settings.
        let port = config.get_ports().first().copied().unwrap_or(5432);
        let user = config.get_user().unwrap_or("postgres");
        let url = format!("host=127.0.0.1 port={port} user={user} dbname={name} sslmode=disable");
        Self {
            admin_url,
            name,
            url,
        }
    }
}
impl Drop for Database {
    fn drop(&mut self) {
        if let Ok(mut admin) = Client::connect(&self.admin_url, NoTls) {
            let _ = admin.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1",
                &[&self.name],
            );
            let _ = admin.batch_execute(&format!("DROP DATABASE {}", self.name));
        }
    }
}
fn fixture() -> (Database, Vault, String, String) {
    let db = Database::new();
    let mut v = Vault::create(&db.url, "Tidepath demo", "Bookkeeper").unwrap();
    let fid = v
        .add_fund(FundInput {
            name: "Youth workshops".into(),
            code: "YOUTH-26".into(),
            budget_minor: "100000".into(),
            period_start: "2026-01-01".into(),
            period_end: "2026-12-31".into(),
            categories: vec!["Workshop supplies".into()],
            restrictions: "Supplies for school workshops".into(),
        })
        .unwrap();
    let eid = v
        .import_bytes("receipt.pdf", b"%PDF-1.7 synthetic evidence")
        .unwrap()
        .expense_id;
    (db, v, fid, eid)
}
fn review(id: &str, fid: &str) -> ReviewInput {
    ReviewInput {
        id: id.into(),
        expected_revision: 0,
        merchant: "Community Supply".into(),
        claimant: "Volunteer A".into(),
        purpose: "School workshop materials".into(),
        expense_date: "2026-10-22".into(),
        category: "Workshop supplies".into(),
        total_minor: "12000".into(),
        eligible_minor: "10000".into(),
        reviewed: true,
        allocations: vec![Allocation {
            fund_id: fid.into(),
            amount_minor: "10000".into(),
        }],
    }
}
#[test]
#[ignore = "requires disposable PostgreSQL"]
fn export_preview_detects_concurrent_organization_and_payment_changes() {
    let (db, mut v, f, e) = fixture();
    v.save_review(review(&e, &f)).unwrap();
    v.approve(&e, 1, "Director", "APPROVAL").unwrap();
    let spec = exports::ExportSpec::Report {
        profile: "funder".into(),
    };
    let before = exports::preview(&v, &spec).unwrap();
    let mut other = Client::connect(&db.url, NoTls).unwrap();
    other
        .execute(
            "UPDATE fundthread.workspace SET organization=$1",
            &[&"Niñez · 北京"],
        )
        .unwrap();
    let renamed = exports::preview(&v, &spec).unwrap();
    assert_eq!(before.csv, renamed.csv);
    assert_ne!(before.revision_token, renamed.revision_token);
    assert_eq!(renamed.organization, "Niñez · 北京");
    let mut second = Vault::open(&db.url).unwrap();
    second
        .record_payment(&e, "2000", "AFTER-DIALOG", "2026-10-24")
        .unwrap();
    let paid = exports::preview(&v, &spec).unwrap();
    assert_ne!(renamed.revision_token, paid.revision_token);
    assert!(paid.csv.contains("partially paid"));
    let range = exports::preview(
        &v,
        &exports::ExportSpec::Analytics {
            start: "2026-10-22".into(),
            end: "2026-10-22".into(),
        },
    )
    .unwrap();
    assert!(range.csv.contains("\"100.00\""));
    assert!(range.csv.contains("\"20.00\""));
    assert!(range.csv.contains("\"80.00\""));
    assert!(!range.csv.contains("Volunteer A"));
}
#[test]
#[ignore = "requires disposable PostgreSQL"]
fn approval_payment_and_reconciliation_are_distinct() {
    let (_dir, mut v, f, e) = fixture();
    assert!(v.record_payment(&e, "100", "R", "2026-10-23").is_err());
    v.save_review(review(&e, &f)).unwrap();
    v.approve(&e, 1, "Director", "A42").unwrap();
    v.record_payment(&e, "6000", "P1", "2026-10-23").unwrap();
    assert!(v.record_payment(&e, "6000", "P2", "2026-10-23").is_err());
    assert!(v.record_payment(&e, "100", "P1", "2026-10-23").is_err());
    let s = v.snapshot().unwrap();
    assert_eq!(s.funds[0].used_minor, "10000");
    assert_eq!(s.expenses[0].reconciled_minor, "0");
    v.reconcile(&s.payments[0].id).unwrap();
    v.record_payment(&e, "4000", "P2", "2026-10-24").unwrap();
    let s = v.snapshot().unwrap();
    assert_eq!(s.funds[0].used_minor, "10000");
    assert_eq!(s.expenses[0].paid_minor, "10000");
    assert_eq!(s.expenses[0].reconciled_minor, "6000");
}
#[test]
#[ignore = "requires disposable PostgreSQL"]
fn stale_approval_and_incorrect_allocations_fail() {
    let (_dir, mut v, f, e) = fixture();
    let mut r = review(&e, &f);
    r.allocations[0].amount_minor = "9000".into();
    assert!(v.save_review(r).is_err());
    assert_eq!(v.snapshot().unwrap().expenses[0].revision, 0);
    v.save_review(review(&e, &f)).unwrap();
    assert!(v.approve(&e, 0, "Director", "ref").is_err());
    v.approve(&e, 1, "Director", "ref").unwrap();
    let mut r = review(&e, &f);
    r.expected_revision = 1;
    r.purpose = "Corrected purpose".into();
    v.save_review(r).unwrap();
    assert!(!v.snapshot().unwrap().expenses[0].approved);
}
#[test]
#[ignore = "requires disposable PostgreSQL"]
fn configured_grant_rules_block_bad_approval() {
    let (_dir, mut v, f, e) = fixture();
    let mut r = review(&e, &f);
    r.category = "Meals".into();
    v.save_review(r).unwrap();
    assert!(
        v.approve(&e, 1, "Director", "ref")
            .unwrap_err()
            .contains("categories")
    );
    let mut r = review(&e, &f);
    r.expected_revision = 1;
    r.expense_date = "2027-01-01".into();
    v.save_review(r).unwrap();
    assert!(
        v.approve(&e, 2, "Director", "ref")
            .unwrap_err()
            .contains("period")
    );
}
#[test]
#[ignore = "requires disposable PostgreSQL"]
fn duplicates_and_extraction_preserve_review() {
    let (_dir, mut v, f, e) = fixture();
    assert!(
        v.import_bytes("same.pdf", b"%PDF-1.7 synthetic evidence")
            .unwrap()
            .duplicate
    );
    v.save_review(review(&e, &f)).unwrap();
    v.save_extraction(
        &e,
        serde_json::json!({"total":"12000","engine":"synthetic-test"}),
    )
    .unwrap();
    let s = v.snapshot().unwrap();
    assert_eq!(s.expenses.len(), 1);
    assert_eq!(s.expenses[0].eligible_minor, "10000");
    assert_eq!(s.expenses[0].revision, 1);
}
#[test]
#[ignore = "requires disposable PostgreSQL"]
fn safe_minimal_funder_report() {
    let (_dir, mut v, f, e) = fixture();
    let mut r = review(&e, &f);
    r.purpose = "=HYPERLINK(unsafe)".into();
    v.save_review(r).unwrap();
    v.approve(&e, 1, "Director", "A42").unwrap();
    let csv = v.report_csv("funder").unwrap();
    assert!(!csv.contains("Volunteer A"));
    assert!(!csv.contains("Director"));
    assert!(!csv.contains("HYPERLINK"));
    assert!(v.report_csv("bookkeeper").unwrap().contains("'=HYPERLINK"));
    assert!(v.report_csv("bookkeeper").unwrap().contains("Volunteer A"));
}
#[test]
#[ignore = "requires disposable PostgreSQL"]
fn budget_approval_is_counted_once_and_blocked_when_exceeded() {
    let (_dir, mut v, f, e) = fixture();
    let mut r = review(&e, &f);
    r.total_minor = "100000".into();
    r.eligible_minor = "100000".into();
    r.allocations[0].amount_minor = "100000".into();
    v.save_review(r).unwrap();
    v.approve(&e, 1, "Director", "one").unwrap();
    assert!(v.approve(&e, 1, "Director", "again").is_err());
    let e2 = v
        .import_bytes("another.pdf", b"%PDF-1.7 another original")
        .unwrap()
        .expense_id;
    v.save_review(review(&e2, &f)).unwrap();
    assert!(
        v.approve(&e2, 1, "Director", "two")
            .unwrap_err()
            .contains("budget")
    );
    assert!(
        !v.snapshot()
            .unwrap()
            .expenses
            .iter()
            .find(|x| x.id == e2)
            .unwrap()
            .approved
    );
}
#[test]
#[ignore = "requires disposable PostgreSQL"]
fn image_headers_are_bounded_before_archiving() {
    let (_dir, mut v, _, _) = fixture();
    let pixel = image::RgbImage::new(2, 2);
    let mut bytes = std::io::Cursor::new(Vec::new());
    pixel.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
    assert!(
        !v.import_bytes("tiny.png", bytes.get_ref())
            .unwrap()
            .duplicate
    );
    assert!(
        v.import_bytes(
            "oversized.png",
            include_bytes!("../tests/fixtures/oversized-header.png")
        )
        .unwrap_err()
        .contains("24 megapixels")
    );
    assert!(v.import_bytes("broken.jpg", &[255, 216, 255]).is_err());
}
#[test]
#[ignore = "requires disposable PostgreSQL"]
fn reopen_history_masks_and_constraints() {
    let (db, mut v, f, e) = fixture();
    v.save_review(review(&e, &f)).unwrap();
    v.save_extraction(&e, serde_json::json!({"engine":"one"}))
        .unwrap();
    v.save_extraction(&e, serde_json::json!({"engine":"two"}))
        .unwrap();
    let did = v.snapshot().unwrap().expenses[0].document_id.clone();
    let masks = serde_json::json!([{"x":0.1,"y":0.2,"w":0.3,"h":0.1,"page":1}]);
    v.save_privacy_plan(&did, masks.clone()).unwrap();
    assert!(
        v.save_privacy_plan(
            &did,
            serde_json::json!([{"x":0.9,"y":0.,"w":0.3,"h":0.1,"page":1}])
        )
        .is_err()
    );
    assert!(
        v.save_privacy_plan("missing", serde_json::json!([]))
            .is_err()
    );
    drop(v);
    let v = Vault::open(&db.url).unwrap();
    v.verify().unwrap();
    assert_eq!(v.privacy_plan(&did).unwrap(), masks);
    assert_eq!(
        v.history(&e).unwrap()["reviews"].as_array().unwrap().len(),
        1
    );
    assert_eq!(
        v.history(&e).unwrap()["extractions"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        v.snapshot().unwrap().expenses[0]
            .extraction
            .as_ref()
            .unwrap()["engine"],
        "two"
    );
    assert_eq!(
        v.document(&did).unwrap().bytes,
        b"%PDF-1.7 synthetic evidence"
    );
    assert!(Vault::create(&db.url, "Other", "Operator").is_err());
    let mut c = Client::connect(&db.url, NoTls).unwrap();
    c.batch_execute("SET search_path=fundthread,pg_catalog")
        .unwrap();
    assert!(
        c.execute(
            "UPDATE reviews SET eligible=total+1 WHERE expense_id=$1",
            &[&e]
        )
        .is_err()
    );
    assert!(
        c.execute("INSERT INTO fund_categories VALUES('missing','Meals')", &[])
            .is_err()
    );
    assert!(
        c.execute(
            "INSERT INTO fund_categories VALUES($1,'Workshop supplies')",
            &[&f]
        )
        .is_err()
    );
    assert!(
        c.execute(
            "INSERT INTO review_allocations VALUES($1,999,$2,1)",
            &[&e, &f]
        )
        .is_err()
    );
    assert!(
        c.execute(
            "INSERT INTO approvals(expense_id,revision,approver,reference) VALUES($1,999,'A','R')",
            &[&e]
        )
        .is_err()
    );
}
#[test]
#[ignore = "requires disposable PostgreSQL"]
fn concurrent_reviews_reject_stale_revision() {
    let (db, mut v, f, e) = fixture();
    let other = Vault::open(&db.url).unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let b = barrier.clone();
    let r = review(&e, &f);
    let r2 = r.clone();
    let t = std::thread::spawn(move || {
        let mut v = other;
        b.wait();
        v.save_review(r)
    });
    barrier.wait();
    let first = v.save_review(r2);
    let second = t.join().unwrap();
    assert_ne!(first.is_ok(), second.is_ok());
    assert_eq!(v.snapshot().unwrap().expenses[0].revision, 1);
}
#[test]
#[ignore = "requires disposable PostgreSQL"]
fn concurrent_payments_cannot_overpay() {
    let (db, mut v, f, e) = fixture();
    v.save_review(review(&e, &f)).unwrap();
    v.approve(&e, 1, "A", "R").unwrap();
    let other = Vault::open(&db.url).unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let b = barrier.clone();
    let e2 = e.clone();
    let t = std::thread::spawn(move || {
        let mut v = other;
        b.wait();
        v.record_payment(&e2, "7000", "B", "2026-10-24")
    });
    barrier.wait();
    let first = v.record_payment(&e, "7000", "A", "2026-10-24");
    let second = t.join().unwrap();
    assert_ne!(first.is_ok(), second.is_ok());
    assert_eq!(v.snapshot().unwrap().expenses[0].paid_minor, "7000");
}
#[test]
#[ignore = "requires disposable PostgreSQL"]
fn concurrent_approvals_cannot_overspend_shared_fund() {
    let (db, mut v, f, e) = fixture();
    let e2 = v
        .import_bytes("other.pdf", b"%PDF-1.7 other")
        .unwrap()
        .expense_id;
    for eid in [&e, &e2] {
        let mut r = review(eid, &f);
        r.total_minor = "70000".into();
        r.eligible_minor = "70000".into();
        r.allocations[0].amount_minor = "70000".into();
        v.save_review(r).unwrap();
    }
    let other = Vault::open(&db.url).unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let b = barrier.clone();
    let t = std::thread::spawn(move || {
        let mut v = other;
        b.wait();
        v.approve(&e2, 1, "A", "B")
    });
    barrier.wait();
    let first = v.approve(&e, 1, "A", "A");
    let second = t.join().unwrap();
    assert_ne!(first.is_ok(), second.is_ok());
    assert_eq!(v.snapshot().unwrap().funds[0].used_minor, "70000");
}
#[test]
#[ignore = "requires disposable PostgreSQL"]
fn review_failure_rolls_back_and_preserves_historical_approval() {
    let (_db, mut v, f, e) = fixture();
    v.save_review(review(&e, &f)).unwrap();
    v.approve(&e, 1, "Director", "A42").unwrap();
    let mut r = review(&e, &f);
    r.expected_revision = 1;
    r.allocations[0].fund_id = "missing".into();
    assert!(v.save_review(r).is_err());
    assert_eq!(v.snapshot().unwrap().expenses[0].revision, 1);
    assert!(v.snapshot().unwrap().expenses[0].approved);
    let mut r = review(&e, &f);
    r.expected_revision = 1;
    r.purpose = "Changed purpose".into();
    v.save_review(r).unwrap();
    assert!(!v.snapshot().unwrap().expenses[0].approved);
    assert_eq!(v.snapshot().unwrap().funds[0].used_minor, "0");
    assert_eq!(
        v.history(&e).unwrap()["reviews"].as_array().unwrap().len(),
        2
    );
}
#[test]
#[ignore = "requires disposable PostgreSQL"]
fn concurrent_duplicate_imports_resolve_to_one_claim() {
    let (db, mut v, _, _) = fixture();
    let other = Vault::open(&db.url).unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let b = barrier.clone();
    let t = std::thread::spawn(move || {
        let mut v = other;
        b.wait();
        v.import_bytes("new.pdf", b"%PDF-1.7 concurrent duplicate")
            .unwrap()
    });
    barrier.wait();
    let a = v
        .import_bytes("new.pdf", b"%PDF-1.7 concurrent duplicate")
        .unwrap();
    let b = t.join().unwrap();
    assert_eq!(a.expense_id, b.expense_id);
    assert_ne!(a.duplicate, b.duplicate);
    assert_eq!(v.snapshot().unwrap().expenses.len(), 2);
}
#[cfg(feature = "legacy-sqlcipher")]
#[test]
#[ignore = "requires disposable PostgreSQL"]
fn legacy_import_preserves_source_history_masks_payments_and_rolls_back() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("legacy.fundthread");
    let key = "a separate synthetic recovery secret";
    let mut old = legacy::Vault::create(&path, key, "Legacy nonprofit", "Bookkeeper").unwrap();
    let f = old
        .add_fund(legacy::FundInput {
            name: "Supplies".into(),
            code: "SUP".into(),
            budget_minor: "100000".into(),
            period_start: "2026-01-01".into(),
            period_end: "2026-12-31".into(),
            categories: vec!["Workshop supplies".into()],
            restrictions: "Supplies".into(),
        })
        .unwrap();
    let e = old
        .import_bytes("receipt.pdf", b"%PDF-1.7 synthetic evidence")
        .unwrap()
        .expense_id;
    let r = review(&e, &f);
    let r: legacy::ReviewInput = serde_json::from_value(serde_json::to_value(r).unwrap()).unwrap();
    old.save_review(r.clone()).unwrap();
    let mut r = r;
    r.expected_revision = 1;
    r.purpose = "Second version".into();
    old.save_review(r).unwrap();
    old.approve(&e, 2, "Director", "Approval").unwrap();
    old.record_payment(&e, "6000", "P1", "2026-10-23").unwrap();
    let snap = old.snapshot().unwrap();
    old.reconcile(&snap.payments[0].id).unwrap();
    for engine in ["one", "two"] {
        old.save_extraction(&e, serde_json::json!({"engine":engine}))
            .unwrap();
    }
    let did = snap.expenses[0].document_id.clone();
    let masks = serde_json::json!([{"page":1,"x":0.1,"y":0.2,"w":0.3,"h":0.1}]);
    old.save_privacy_plan(&did, masks.clone()).unwrap();
    // More than the application snapshot's 200-event limit: all must migrate.
    for _ in 0..205 {
        old.record_derivative(&e, 2, "synthetic").unwrap();
    }
    drop(old);
    let bytes = std::fs::read(&path).unwrap();
    let db = Database::new();
    let mut v = Vault::create(&db.url, "Pending", "Operator").unwrap();
    assert!(v.import_sqlcipher(&path, "wrong passphrase").is_err());
    assert!(v.snapshot().unwrap().expenses.is_empty());
    v.import_sqlcipher(&path, key).unwrap();
    v.verify().unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    let s = v.snapshot().unwrap();
    assert_eq!(s.organization, "Legacy nonprofit");
    assert_eq!(s.expenses[0].paid_minor, "6000");
    assert_eq!(s.expenses[0].reconciled_minor, "6000");
    assert_eq!(s.funds[0].used_minor, "10000");
    assert_eq!(
        v.history(&e).unwrap()["reviews"].as_array().unwrap().len(),
        2
    );
    assert_eq!(
        v.history(&e).unwrap()["extractions"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(v.privacy_plan(&did).unwrap(), masks);
    assert!(v.import_sqlcipher(&path, key).is_err());
    let mut c = Client::connect(&db.url, NoTls).unwrap();
    let events: i64 = c
        .query_one("SELECT count(*) FROM fundthread.events", &[])
        .unwrap()
        .get(0);
    assert!(events > 205);
    v.save_extraction(&e, serde_json::json!({"engine":"three"}))
        .unwrap(); // identity sequence reset
    // Corrupt the legacy content using its own API's raw-independent review flow:
    // invalid historical fund references must abort the entire target transaction.
    let db2 = Database::new();
    let mut other = Vault::create(&db2.url, "Pending", "Operator").unwrap();
    let old = legacy::Vault::open(&path, key).unwrap();
    old.verify().unwrap();
    drop(old);
    let c = rusqlite::Connection::open(&path).unwrap();
    c.pragma_update(None, "key", key).unwrap();
    c.execute("UPDATE revisions SET payload='{}' WHERE revision=1", [])
        .unwrap();
    drop(c);
    assert!(other.import_sqlcipher(&path, key).is_err());
    assert!(other.snapshot().unwrap().expenses.is_empty());
    assert!(other.snapshot().unwrap().funds.is_empty());
    // Cross-row inconsistency must fail before commit, rather than only in a
    // post-import verify that would leave an invalid populated destination.
    std::fs::write(&path, &bytes).unwrap();
    let c = rusqlite::Connection::open(&path).unwrap();
    c.pragma_update(None, "key", key).unwrap();
    c.execute("UPDATE payments SET amount=20000", []).unwrap();
    drop(c);
    assert!(other.import_sqlcipher(&path, key).is_err());
    assert!(other.snapshot().unwrap().expenses.is_empty());
    assert!(other.snapshot().unwrap().funds.is_empty());
}
#[test]
#[ignore = "requires disposable PostgreSQL and pg_dump/pg_restore on PATH"]
fn postgres_archive_round_trip_and_failed_restore_are_safe() {
    let (db, mut v, f, e) = fixture();
    v.save_review(review(&e, &f)).unwrap();
    v.approve(&e, 1, "Director", "R").unwrap();
    v.record_payment(&e, "6000", "P1", "2026-10-23").unwrap();
    v.save_extraction(&e, serde_json::json!({"engine":"archive-test"}))
        .unwrap();
    let did = v.snapshot().unwrap().expenses[0].document_id.clone();
    let masks = serde_json::json!([{"page":1,"x":0.1,"y":0.2,"w":0.3,"h":0.1}]);
    v.save_privacy_plan(&did, masks.clone()).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let dump = dir.path().join("new.dump");
    let binary = env!("CARGO_BIN_EXE_fundthread-db");
    let output = std::process::Command::new(binary)
        .args(["backup", dump.to_str().unwrap()])
        .env("FUNDTHREAD_DATABASE_URL", &db.url)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(std::fs::read(&dump).unwrap().starts_with(b"PGDMP"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&dump).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    assert!(
        !std::process::Command::new(binary)
            .args(["backup", dump.to_str().unwrap()])
            .env("FUNDTHREAD_DATABASE_URL", &db.url)
            .output()
            .unwrap()
            .status
            .success()
    );
    let target = Database::new();
    let output = std::process::Command::new(binary)
        .args(["restore", dump.to_str().unwrap()])
        .env("FUNDTHREAD_DATABASE_URL", &target.url)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let restored = Vault::open(&target.url).unwrap();
    restored.verify().unwrap();
    assert_eq!(restored.snapshot().unwrap().expenses[0].paid_minor, "6000");
    assert_eq!(restored.privacy_plan(&did).unwrap(), masks);
    assert_eq!(
        restored.history(&e).unwrap()["extractions"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(
        !std::process::Command::new(binary)
            .args(["restore", dump.to_str().unwrap()])
            .env("FUNDTHREAD_DATABASE_URL", &db.url)
            .output()
            .unwrap()
            .status
            .success()
    );
    let invalid = dir.path().join("bad.dump");
    std::fs::write(&invalid, b"not an archive").unwrap();
    let empty = Database::new();
    assert!(Vault::restore_archive(&empty.url, &invalid).is_err());
    assert!(!Vault::exists(&empty.url).unwrap());
    // Original source unchanged by restore or failed overwrite attempts.
    assert_eq!(v.snapshot().unwrap().expenses[0].paid_minor, "6000");
}
#[test]
#[ignore = "requires disposable PostgreSQL"]
fn schema_version_checks_and_financial_verification_detect_corruption() {
    let (db, mut v, f, e) = fixture();
    v.save_review(review(&e, &f)).unwrap();
    v.verify().unwrap();
    let mut c = Client::connect(&db.url, NoTls).unwrap();
    c.execute(
        "UPDATE fundthread.review_allocations SET amount=1 WHERE expense_id=$1",
        &[&e],
    )
    .unwrap();
    assert!(v.verify().is_err());
    c.execute("UPDATE fundthread.schema_migrations SET version=999", &[])
        .unwrap();
    assert!(Vault::open(&db.url).is_err());
    assert!(Vault::exists(&db.url).is_err());
}

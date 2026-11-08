use chrono::NaiveDate;
use native_tls::TlsConnector;
use postgres::{Client, Config, GenericClient, IsolationLevel, Transaction};
use postgres_native_tls::MakeTlsConnector;
use sha2::{Digest, Sha256};
use std::{cell::RefCell, path::Path};
use uuid::Uuid;
pub mod exports;
mod types;
pub use types::*;
#[cfg(feature = "legacy-sqlcipher")]
#[allow(dead_code)]
pub mod legacy;
#[cfg(feature = "legacy-sqlcipher")]
mod migration;

pub type Result<T> = std::result::Result<T, String>;
pub const MAX_DOCUMENT_BYTES: usize = 20 * 1024 * 1024;
const MAX_MONEY: i64 = 1_000_000_000_000_000;
const SCHEMA: i64 = 1;
fn err(e: postgres::Error) -> String {
    // PostgreSQL errors can include failing rows (private receipt fields).
    match e.code().map(|c| c.code()) {
        Some("23505") => "This record already exists.".into(),
        Some("23503") => "A referenced record is unavailable.".into(),
        Some("23514" | "23502" | "22003") => "The record violates a database constraint.".into(),
        Some("55P03" | "57014" | "40001" | "40P01") => {
            "The workspace is busy. Reload and retry the operation.".into()
        }
        _ => "The database operation failed. Check the connection and database setup.".into(),
    }
}
fn id() -> String {
    Uuid::new_v4().to_string()
}
pub fn content_hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn money(value: &str) -> Result<i64> {
    if value.is_empty() || !value.bytes().all(|c| c.is_ascii_digit()) {
        return Err("Enter a non-negative amount in minor units.".into());
    }
    let n = value.parse::<i64>().map_err(|_| "Amount is too large.")?;
    if n > MAX_MONEY {
        return Err("Amount exceeds the supported range.".into());
    }
    Ok(n)
}
fn required(value: &str, label: &str) -> Result<()> {
    if value.trim().is_empty() {
        Err(format!("{label} is required."))
    } else if value.len() > 4000 {
        Err(format!("{label} is too long."))
    } else {
        Ok(())
    }
}
fn date(value: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| "Choose a valid date.".into())
}
fn event(c: &mut impl GenericClient, target: &str, action: &str, detail: &str) -> Result<()> {
    c.execute(
        "INSERT INTO events(target_id,action,detail) VALUES($1,$2,$3)",
        &[&target, &action, &detail],
    )
    .map_err(err)?;
    Ok(())
}

/// Native-only PostgreSQL connection. No credentials cross into the WebView.
/// One workspace per database; all application writes lock its singleton row.
pub struct Vault {
    conn: RefCell<Client>,
}
impl Vault {
    fn connect(url: &str) -> Result<Client> {
        if url.trim().is_empty() {
            return Err("Set FUNDTHREAD_DATABASE_URL before starting FundThread.".into());
        }
        let mut config: Config = url
            .parse()
            .map_err(|_| "Invalid FUNDTHREAD_DATABASE_URL.")?;
        let local = config.get_hostaddrs().iter().all(|a| a.is_loopback())
            && !config.get_hosts().is_empty()
            && config.get_hosts().iter().all(|h| match h {
                postgres::config::Host::Tcp(h) => {
                    matches!(h.as_str(), "localhost" | "127.0.0.1" | "::1")
                }
                #[cfg(unix)]
                postgres::config::Host::Unix(_) => true,
            });
        if !local && config.get_ssl_mode() != postgres::config::SslMode::Require {
            return Err("Remote PostgreSQL connections require sslmode=require and a trusted server certificate.".into());
        }
        config.connect_timeout(std::time::Duration::from_secs(10));
        config.application_name("FundThread");
        let tls = TlsConnector::new().map_err(|_| "TLS initialization failed.")?;
        let mut c = config.connect(MakeTlsConnector::new(tls)).map_err(
            |_| "Could not connect to PostgreSQL. Check database configuration and credentials.",
        )?;
        c.batch_execute("SET search_path TO fundthread, pg_catalog; SET statement_timeout TO '30s'; SET lock_timeout TO '10s'; SET TIME ZONE 'UTC';").map_err(err)?;
        Ok(c)
    }
    pub fn exists(url: &str) -> Result<bool> {
        let mut c = Self::connect(url)?;
        let schema: bool = c
            .query_one(
                "SELECT to_regclass('fundthread.schema_migrations') IS NOT NULL",
                &[],
            )
            .map_err(err)?
            .get(0);
        if !schema {
            return Ok(false);
        }
        Self::check_schema(&mut c)?;
        Ok(c.query_one("SELECT EXISTS(SELECT 1 FROM workspace)", &[])
            .map_err(err)?
            .get(0))
    }
    fn check_schema(c: &mut impl GenericClient) -> Result<()> {
        let v: i64 = c
            .query_one(
                "SELECT COALESCE(MAX(version),0)::bigint FROM schema_migrations",
                &[],
            )
            .map_err(err)?
            .get(0);
        if v != SCHEMA {
            return Err("This workspace needs a different application version.".into());
        }
        Ok(())
    }
    pub fn create(url: &str, organization: &str, operator: &str) -> Result<Self> {
        required(organization, "Organization")?;
        required(operator, "Operator name")?;
        let mut c = Self::connect(url)?;
        let mut tx = c.transaction().map_err(err)?;
        tx.query_one("SELECT pg_advisory_xact_lock(719440018)", &[])
            .map_err(err)?;
        tx.batch_execute("CREATE SCHEMA IF NOT EXISTS fundthread; CREATE TABLE IF NOT EXISTS schema_migrations(version bigint PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT clock_timestamp());").map_err(err)?;
        let v: i64 = tx
            .query_one(
                "SELECT COALESCE(MAX(version),0)::bigint FROM schema_migrations",
                &[],
            )
            .map_err(err)?
            .get(0);
        if v == 0 {
            tx.batch_execute(include_str!("../migrations/0001_postgres.sql"))
                .map_err(err)?;
            tx.execute(
                "INSERT INTO schema_migrations(version) VALUES($1)",
                &[&SCHEMA],
            )
            .map_err(err)?;
        }
        Self::check_schema(&mut tx)?;
        if tx
            .query_opt("SELECT singleton FROM workspace", &[])
            .map_err(err)?
            .is_some()
        {
            return Err("A workspace already exists in this database.".into());
        }
        tx.execute(
            "INSERT INTO workspace(organization,operator_name) VALUES($1,$2)",
            &[&organization.trim(), &operator.trim()],
        )
        .map_err(err)?;
        event(
            &mut tx,
            "workspace",
            "Workspace created",
            "PostgreSQL workspace initialized.",
        )?;
        tx.commit().map_err(err)?;
        Ok(Self {
            conn: RefCell::new(c),
        })
    }
    pub fn open(url: &str) -> Result<Self> {
        let mut c = Self::connect(url)?;
        Self::check_schema(&mut c)?;
        if c.query_opt("SELECT singleton FROM workspace", &[])
            .map_err(err)?
            .is_none()
        {
            return Err("Create a workspace in this database first.".into());
        }
        Ok(Self {
            conn: RefCell::new(c),
        })
    }
    fn write<T>(&self, f: impl FnOnce(&mut Transaction<'_>) -> Result<T>) -> Result<T> {
        let mut c = self.conn.borrow_mut();
        let mut tx = c.transaction().map_err(err)?;
        // Acquire before all reads; subsequent statements see the previous writer's commit.
        tx.query_one(
            "SELECT singleton FROM workspace WHERE singleton FOR UPDATE",
            &[],
        )
        .map_err(err)?;
        let value = f(&mut tx)?;
        tx.commit().map_err(err)?;
        Ok(value)
    }
    pub fn snapshot(&self) -> Result<Snapshot> {
        let mut c = self.conn.borrow_mut();
        let mut tx = c
            .build_transaction()
            .isolation_level(IsolationLevel::RepeatableRead)
            .read_only(true)
            .start()
            .map_err(err)?;
        let s = snapshot(&mut tx)?;
        tx.commit().map_err(err)?;
        Ok(s)
    }
    pub fn add_fund(&mut self, input: FundInput) -> Result<String> {
        required(&input.name, "Fund name")?;
        required(&input.code, "Grant code")?;
        let budget = money(&input.budget_minor)?;
        let start = date(&input.period_start)?;
        let end = date(&input.period_end)?;
        if start > end {
            return Err("Choose a valid grant period.".into());
        }
        for category in &input.categories {
            required(category, "Category")?;
        }
        self.write(|tx| {
            let fid = id();
            tx.execute("INSERT INTO funds(id,name,code,budget,period_start,period_end,restrictions) VALUES($1,$2,$3,$4,$5,$6,$7)", &[&fid,&input.name,&input.code,&budget,&start,&end,&input.restrictions]).map_err(err)?;
            for category in &input.categories {
                tx.execute("INSERT INTO fund_categories VALUES($1,$2) ON CONFLICT DO NOTHING", &[&fid,&category]).map_err(err)?;
            }
            event(tx,&fid,"Fund created","Opening budget and grant rules recorded.")?; Ok(fid)
        })
    }
    pub fn import_bytes(&mut self, filename: &str, bytes: &[u8]) -> Result<ImportOutcome> {
        if bytes.len() > MAX_DOCUMENT_BYTES {
            return Err("This file exceeds the 20 MB limit for this build.".into());
        }
        let mime = if bytes.starts_with(b"%PDF-") {
            "application/pdf"
        } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            "image/png"
        } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
            "image/jpeg"
        } else {
            return Err("Import a PDF, PNG or JPEG receipt.".into());
        };
        if mime != "application/pdf" {
            let (w, h) = image::ImageReader::new(std::io::Cursor::new(bytes))
                .with_guessed_format()
                .map_err(|_| "Could not identify this image.")?
                .into_dimensions()
                .map_err(|_| "The image header is not supported or is damaged.")?;
            if w == 0 || h == 0 || u64::from(w) * u64::from(h) > 24_000_000 {
                return Err(
                    "Import an image of up to 24 megapixels. Resize a larger scan first.".into(),
                );
            }
        }
        let hash = content_hash(bytes);
        self.write(|tx| {
            if let Some(r) = tx.query_opt("SELECT e.id FROM expenses e JOIN documents d ON d.id=e.document_id WHERE d.hash=$1", &[&hash]).map_err(err)? {
                return Ok(ImportOutcome { expense_id: r.get(0), duplicate: true });
            }
            let did = id(); let eid = id();
            let filename = Path::new(filename).file_name().and_then(|n| n.to_str()).unwrap_or("receipt");
            tx.execute("INSERT INTO documents VALUES($1,$2,$3,$4,$5)", &[&did,&filename,&mime,&hash,&bytes]).map_err(err)?;
            tx.execute("INSERT INTO expenses(id,document_id) VALUES($1,$2)", &[&eid,&did]).map_err(err)?;
            tx.execute("INSERT INTO reviews(expense_id,revision) VALUES($1,0)", &[&eid]).map_err(err)?;
            event(tx,&eid,"Original archived","Original bytes copied into the PostgreSQL workspace.")?;
            Ok(ImportOutcome {expense_id:eid,duplicate:false})
        })
    }
    pub fn document(&self, document_id: &str) -> Result<Document> {
        let r = self
            .conn
            .borrow_mut()
            .query_one(
                "SELECT bytes,mime,filename FROM documents WHERE id=$1",
                &[&document_id],
            )
            .map_err(err)?;
        Ok(Document {
            bytes: r.get(0),
            mime: r.get(1),
            filename: r.get(2),
        })
    }
    pub fn save_review(&mut self, input: ReviewInput) -> Result<()> {
        validate_review(&input)?;
        self.write(|tx| {
            let r = tx.query_one("SELECT current_revision,COALESCE((SELECT sum(amount)::bigint FROM payments WHERE expense_id=e.id),0) FROM expenses e WHERE id=$1", &[&input.id]).map_err(err)?;
            let revision: i64 = r.get(0); let paid: i64 = r.get(1);
            if revision != input.expected_revision { return Err("This claim has changed. Reload it before saving.".into()); }
            if paid > 0 { return Err("This claim has payment records. Corrections require a reversal workflow, which is not available in this build.".into()); }
            insert_review(tx, &input, revision+1, None)?;
            tx.execute("UPDATE expenses SET current_revision=$2 WHERE id=$1", &[&input.id,&(revision+1)]).map_err(err)?;
            event(tx,&input.id,if input.reviewed {"Review completed"} else {"Draft saved"},"New revision saved. Previous approvals remain attached to their historical revisions.")?;
            Ok(())
        })
    }
    pub fn save_extraction(&mut self, expense_id: &str, data: serde_json::Value) -> Result<()> {
        if data.to_string().len() > 2_000_000 {
            return Err("Extraction result is too large.".into());
        }
        self.write(|tx| {
            tx.execute(
                "INSERT INTO extraction_runs(expense_id,payload) VALUES($1,$2)",
                &[&expense_id, &data],
            )
            .map_err(err)?;
            event(
                tx,
                expense_id,
                "Local extraction completed",
                "Suggestions stored separately; reviewed fields were not changed.",
            )
        })
    }
    pub fn history(&self, expense_id: &str) -> Result<serde_json::Value> {
        let mut c = self.conn.borrow_mut();
        let mut tx = c
            .build_transaction()
            .isolation_level(IsolationLevel::RepeatableRead)
            .read_only(true)
            .start()
            .map_err(err)?;
        let mut reviews = Vec::new();
        for r in tx.query("SELECT revision,merchant,claimant,purpose,expense_date::text,category,total,eligible,reviewed,at::text FROM reviews WHERE expense_id=$1 AND revision>0 ORDER BY revision DESC", &[&expense_id]).map_err(err)? {
            let rev: i64 = r.get(0);
            let input = ReviewInput {id:expense_id.into(),expected_revision:rev-1,merchant:r.get(1),claimant:r.get(2),purpose:r.get(3),expense_date:r.get::<_,Option<String>>(4).unwrap_or_default(),category:r.get(5),total_minor:r.get::<_,i64>(6).to_string(),eligible_minor:r.get::<_,i64>(7).to_string(),reviewed:r.get(8),allocations:allocations(&mut tx,expense_id,rev)?};
            reviews.push(serde_json::json!({"revision":rev,"payload":input,"at":r.get::<_,String>(9)}));
        }
        let extractions: Vec<_> = tx.query("SELECT id,payload,at::text FROM extraction_runs WHERE expense_id=$1 ORDER BY id DESC", &[&expense_id]).map_err(err)?.iter().map(|r| serde_json::json!({"id":r.get::<_,i64>(0),"payload":r.get::<_,serde_json::Value>(1),"at":r.get::<_,String>(2)})).collect();
        tx.commit().map_err(err)?;
        Ok(serde_json::json!({"reviews":reviews,"extractions":extractions}))
    }
    pub fn privacy_plan(&self, document_id: &str) -> Result<serde_json::Value> {
        let rows = self
            .conn
            .borrow_mut()
            .query(
                "SELECT page,x,y,w,h FROM privacy_regions WHERE document_id=$1 ORDER BY ordinal",
                &[&document_id],
            )
            .map_err(err)?;
        Ok(serde_json::Value::Array(rows.iter().map(|r| serde_json::json!({"page":r.get::<_,i32>(0),"x":r.get::<_,f64>(1),"y":r.get::<_,f64>(2),"w":r.get::<_,f64>(3),"h":r.get::<_,f64>(4)})).collect()))
    }
    pub fn save_privacy_plan(&self, document_id: &str, regions: serde_json::Value) -> Result<()> {
        let regions = regions.as_array().ok_or("Invalid mask regions.")?;
        if regions.len() > 1000 {
            return Err("Too many mask regions.".into());
        }
        self.write(|tx| {
            tx.query_one("SELECT id FROM documents WHERE id=$1", &[&document_id])
                .map_err(err)?;
            tx.execute(
                "DELETE FROM privacy_regions WHERE document_id=$1",
                &[&document_id],
            )
            .map_err(err)?;
            for (ordinal, r) in regions.iter().enumerate() {
                let get = |k: &str| {
                    r.get(k)
                        .and_then(|v| v.as_f64())
                        .filter(|v| v.is_finite())
                        .ok_or("Invalid mask bounds.")
                };
                let (x, y, w, h) = (get("x")?, get("y")?, get("w")?, get("h")?);
                let page = r
                    .get("page")
                    .and_then(|v| v.as_i64())
                    .filter(|p| (1..=100).contains(p))
                    .ok_or("Invalid mask page.")? as i32;
                tx.execute(
                    "INSERT INTO privacy_regions VALUES($1,$2,$3,$4,$5,$6,$7)",
                    &[&document_id, &(ordinal as i32), &page, &x, &y, &w, &h],
                )
                .map_err(err)?;
            }
            Ok(())
        })
    }
    pub fn record_derivative(&self, expense_id: &str, revision: i64, hash: &str) -> Result<()> {
        self.write(|tx| event(tx,expense_id,"Reviewed receipt copy exported",&format!("Source revision {revision}; derivative SHA-256 {hash}; visual review attested by the operator.")))
    }
    pub fn approve(
        &mut self,
        expense_id: &str,
        expected_revision: i64,
        approver: &str,
        reference: &str,
    ) -> Result<()> {
        required(approver, "Approver")?;
        required(reference, "Approval evidence reference")?;
        self.write(|tx| {
            let snap = snapshot(tx)?;
            let e = snap.expenses.iter().find(|e|e.id==expense_id).ok_or("Claim not found.")?;
            if e.revision != expected_revision { return Err("The claim has changed. Review the current revision.".into()); }
            if !e.reviewed { return Err("Complete the receipt review first.".into()); }
            if e.approved { return Err("Approval is already recorded for this revision.".into()); }
            for a in &e.allocations {
                let f = snap.funds.iter().find(|f| f.id==a.fund_id).ok_or("Fund not found.")?;
                if e.expense_date<f.period_start || e.expense_date>f.period_end { return Err(format!("Receipt date is outside the configured period for {}.",f.name)); }
                if !f.categories.is_empty() && !f.categories.contains(&e.category) { return Err(format!("{} is outside the configured categories for {}.",e.category,f.name)); }
                if money(&f.used_minor)?.checked_add(money(&a.amount_minor)?).ok_or("Amount overflow.")?>money(&f.budget_minor)? {return Err(format!("This would exceed the recorded budget for {}.",f.name));}
            }
            tx.execute("INSERT INTO approvals(expense_id,revision,approver,reference) VALUES($1,$2,$3,$4)", &[&expense_id,&expected_revision,&approver.trim(),&reference.trim()]).map_err(err)?;
            event(tx,expense_id,"External approval recorded",&format!("Approval applies to revision {expected_revision}; attribution entered by the operator."))
        })
    }
    pub fn record_payment(
        &mut self,
        expense_id: &str,
        amount: &str,
        reference: &str,
        payment_date: &str,
    ) -> Result<()> {
        required(reference, "External payment reference")?;
        let payment_date = date(payment_date)?;
        let amount = money(amount)?;
        if amount == 0 {
            return Err("Payment amount must be greater than zero.".into());
        }
        self.write(|tx| {
            let r = tx.query_one("SELECT r.eligible,ap.expense_id IS NOT NULL,COALESCE((SELECT sum(amount)::bigint FROM payments WHERE expense_id=e.id),0) FROM expenses e JOIN reviews r ON (r.expense_id,r.revision)=(e.id,e.current_revision) LEFT JOIN approvals ap ON (ap.expense_id,ap.revision)=(e.id,e.current_revision) WHERE e.id=$1", &[&expense_id]).map_err(err)?;
            let eligible:i64=r.get(0); let approved:bool=r.get(1); let paid:i64=r.get(2);
            if !approved { return Err("Record approval before recording a payment.".into()); }
            if amount>eligible-paid { return Err("Payment exceeds the amount still owed.".into()); }
            tx.execute("INSERT INTO payments(id,expense_id,amount,reference,payment_date) VALUES($1,$2,$3,$4,$5)", &[&id(),&expense_id,&amount,&reference.trim(),&payment_date]).map_err(err)?;
            event(tx,expense_id,"Payment recorded","External payment confirmation recorded; bank reconciliation is separate.")
        })
    }
    pub fn reconcile(&mut self, payment_id: &str) -> Result<()> {
        self.write(|tx| {
            let r=tx.query_opt("UPDATE payments SET reconciled=true WHERE id=$1 AND NOT reconciled RETURNING expense_id", &[&payment_id]).map_err(err)?.ok_or("This payment is unavailable or already reconciled.")?;
            event(tx,&r.get::<_,String>(0),"Bank reconciliation recorded","Operator confirmed the external bank record.")
        })
    }
    pub fn verify(&self) -> Result<()> {
        let mut c = self.conn.borrow_mut();
        let mut tx = c
            .build_transaction()
            .isolation_level(IsolationLevel::RepeatableRead)
            .read_only(true)
            .start()
            .map_err(err)?;
        Self::check_schema(&mut tx)?;
        for r in tx
            .query("SELECT hash,bytes FROM documents", &[])
            .map_err(err)?
        {
            if r.get::<_, String>(0) != content_hash(&r.get::<_, Vec<u8>>(1)) {
                return Err("Original document verification failed.".into());
            }
        }
        let s = snapshot(&mut tx)?;
        verify_finances(&s)?;
        tx.commit().map_err(err)?;
        Ok(())
    }
    /// Restore only our schema into a separately created, empty database.
    /// Advisory lock coordinates application initialization; no --clean/overwrite.
    pub fn restore_archive(url: &str, path: &Path) -> Result<()> {
        let mut c = Self::connect(url)?;
        c.query_one("SELECT pg_advisory_lock(719440018)", &[])
            .map_err(err)?;
        let occupied:bool=c.query_one("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='fundthread') OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%')", &[]).map_err(err)?.get(0);
        if occupied {
            return Err(
                "Restore requires an empty, separate database with no fundthread schema.".into(),
            );
        }
        let status = postgres_tool("pg_restore", url)?
            .args([
                "--single-transaction",
                "--exit-on-error",
                "--no-owner",
                "--no-privileges",
                "--no-password",
                "--dbname",
                "",
            ])
            .arg(path)
            .env("PGAPPNAME", "FundThread restore")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map_err(
                |_| "Install pg_restore matching the archive/server version and add it to PATH.",
            )?;
        if !status.success() {
            return Err("Restore failed; its transaction was rolled back. Check the archive and tool version.".into());
        }
        // Connection drop releases the initializer lock, even on earlier errors.
        Ok(())
    }
    pub fn report_csv(&self, profile: &str) -> Result<String> {
        report_csv_from_snapshot(&self.snapshot()?, profile)
    }
}
pub fn report_rows(s: &Snapshot, profile: &str) -> Result<Vec<Vec<String>>> {
    let people = profile == "bookkeeper";
    if !people && profile != "funder" {
        return Err("Unknown export profile.".into());
    }
    let mut header = vec![
        "claim_id",
        "revision",
        "expense_date",
        "fund_code",
        "currency",
        "approved_allocation_minor",
        "payment_status",
    ];
    if people {
        header.extend([
            "merchant",
            "purpose",
            "claimant",
            "approver",
            "approval_reference",
        ]);
    }
    let mut rows = vec![header.into_iter().map(str::to_string).collect()];
    for e in s.expenses.iter().filter(|e| e.approved) {
        for a in &e.allocations {
            let fund = s
                .funds
                .iter()
                .find(|f| f.id == a.fund_id)
                .ok_or("Fund not found.")?;
            let status = if money(&e.paid_minor)? == 0 {
                "unpaid"
            } else if e.paid_minor == e.eligible_minor {
                "paid"
            } else {
                "partially paid"
            };
            let mut row = vec![
                e.id.clone(),
                e.revision.to_string(),
                e.expense_date.clone(),
                fund.code.clone(),
                s.currency.clone(),
                a.amount_minor.clone(),
                status.into(),
            ];
            if people {
                row.extend([
                    e.merchant.clone(),
                    e.purpose.clone(),
                    e.claimant.clone(),
                    e.approver.clone(),
                    e.approval_reference.clone(),
                ]);
            }
            rows.push(row);
        }
    }
    Ok(rows)
}
pub fn report_csv_from_snapshot(s: &Snapshot, profile: &str) -> Result<String> {
    exports::dollar_csv(&report_rows(s, profile)?)
}
pub fn csv_cell(value: &str) -> String {
    let normalized = value.replace(['\r', '\n', '\t'], " ");
    let value = if normalized.trim_start().starts_with(['=', '+', '-', '@']) {
        format!("'{normalized}")
    } else {
        normalized
    };
    format!("\"{}\"", value.replace('"', "\"\""))
}
fn validate_review(input: &ReviewInput) -> Result<()> {
    for v in [
        &input.merchant,
        &input.claimant,
        &input.purpose,
        &input.expense_date,
        &input.category,
    ] {
        if v.len() > 4000 {
            return Err("A review field exceeds the supported length.".into());
        }
    }
    let total = money(&input.total_minor)?;
    let eligible = money(&input.eligible_minor)?;
    if eligible > total {
        return Err("Eligible reimbursement cannot exceed the receipt total.".into());
    }
    if !input.expense_date.is_empty() {
        date(&input.expense_date)?;
    }
    let mut sum = 0_i64;
    let mut seen = std::collections::HashSet::new();
    for a in &input.allocations {
        if !seen.insert(&a.fund_id) {
            return Err("Use each fund once per claim.".into());
        }
        sum = sum
            .checked_add(money(&a.amount_minor)?)
            .ok_or("Allocation total is too large.")?;
    }
    if sum > eligible {
        return Err("Fund allocations exceed the eligible reimbursement.".into());
    }
    if input.reviewed {
        for (v, label) in [
            (&input.merchant, "Merchant"),
            (&input.claimant, "Person being reimbursed"),
            (&input.purpose, "Purpose"),
            (&input.category, "Category"),
        ] {
            required(v, label)?;
        }
        date(&input.expense_date)?;
        if eligible == 0 || sum != eligible {
            return Err("Allocate the full eligible amount before marking reviewed.".into());
        }
    }
    Ok(())
}
fn insert_review(
    tx: &mut impl GenericClient,
    input: &ReviewInput,
    revision: i64,
    at: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<()> {
    validate_review(input)?;
    let expense_date = if input.expense_date.is_empty() {
        None
    } else {
        Some(date(&input.expense_date)?)
    };
    tx.execute("INSERT INTO reviews(expense_id,revision,merchant,claimant,purpose,expense_date,category,total,eligible,reviewed,at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,clock_timestamp()))", &[&input.id,&revision,&input.merchant.trim(),&input.claimant.trim(),&input.purpose.trim(),&expense_date,&input.category,&money(&input.total_minor)?,&money(&input.eligible_minor)?,&input.reviewed,&at]).map_err(err)?;
    for a in &input.allocations {
        tx.execute(
            "INSERT INTO review_allocations VALUES($1,$2,$3,$4)",
            &[&input.id, &revision, &a.fund_id, &money(&a.amount_minor)?],
        )
        .map_err(err)?;
    }
    Ok(())
}
fn allocations(
    c: &mut impl GenericClient,
    expense_id: &str,
    revision: i64,
) -> Result<Vec<Allocation>> {
    Ok(c.query("SELECT fund_id,amount FROM review_allocations WHERE expense_id=$1 AND revision=$2 ORDER BY fund_id", &[&expense_id,&revision]).map_err(err)?.iter().map(|r|Allocation {fund_id:r.get(0),amount_minor:r.get::<_,i64>(1).to_string()}).collect())
}
fn snapshot(c: &mut impl GenericClient) -> Result<Snapshot> {
    let ws = c
        .query_one(
            "SELECT organization,operator_name,currency FROM workspace",
            &[],
        )
        .map_err(err)?;
    let mut funds = Vec::new();
    for r in c.query("SELECT f.id,f.name,f.code,f.budget,f.period_start::text,f.period_end::text,f.restrictions,COALESCE((SELECT sum(a.amount)::bigint FROM review_allocations a JOIN expenses e ON (e.id,e.current_revision)=(a.expense_id,a.revision) JOIN approvals ap ON (ap.expense_id,ap.revision)=(e.id,e.current_revision) WHERE a.fund_id=f.id),0) FROM funds f ORDER BY f.name,f.id", &[]).map_err(err)? {
        let fid:String=r.get(0);
        let categories=c.query("SELECT category FROM fund_categories WHERE fund_id=$1 ORDER BY category", &[&fid]).map_err(err)?.iter().map(|r|r.get(0)).collect();
        funds.push(Fund {id:fid,name:r.get(1),code:r.get(2),budget_minor:r.get::<_,i64>(3).to_string(),period_start:r.get(4),period_end:r.get(5),restrictions:r.get(6),used_minor:r.get::<_,i64>(7).to_string(),categories});
    }
    let rows=c.query("SELECT e.id,e.document_id,d.filename,d.mime,d.hash,e.current_revision,r.merchant,r.claimant,r.purpose,COALESCE(r.expense_date::text,''),r.category,r.total,r.eligible,r.reviewed,ap.expense_id IS NOT NULL,COALESCE(ap.approver,''),COALESCE(ap.reference,''),COALESCE((SELECT sum(amount)::bigint FROM payments WHERE expense_id=e.id),0),COALESCE((SELECT sum(amount)::bigint FROM payments WHERE expense_id=e.id AND reconciled),0),(SELECT payload FROM extraction_runs WHERE expense_id=e.id ORDER BY id DESC LIMIT 1) FROM expenses e JOIN documents d ON d.id=e.document_id JOIN reviews r ON (r.expense_id,r.revision)=(e.id,e.current_revision) LEFT JOIN approvals ap ON (ap.expense_id,ap.revision)=(e.id,e.current_revision) ORDER BY e.created_at DESC,e.id", &[]).map_err(err)?;
    let mut expenses = Vec::new();
    for r in rows {
        let eid: String = r.get(0);
        let revision: i64 = r.get(5);
        expenses.push(Expense {
            allocations: allocations(c, &eid, revision)?,
            id: eid,
            document_id: r.get(1),
            filename: r.get(2),
            mime: r.get(3),
            hash: r.get(4),
            revision,
            merchant: r.get(6),
            claimant: r.get(7),
            purpose: r.get(8),
            expense_date: r.get(9),
            category: r.get(10),
            total_minor: r.get::<_, i64>(11).to_string(),
            eligible_minor: r.get::<_, i64>(12).to_string(),
            reviewed: r.get(13),
            approved: r.get(14),
            approver: r.get(15),
            approval_reference: r.get(16),
            paid_minor: r.get::<_, i64>(17).to_string(),
            reconciled_minor: r.get::<_, i64>(18).to_string(),
            extraction: r.get(19),
        });
    }
    let payments=c.query("SELECT id,expense_id,amount,reference,payment_date::text,reconciled FROM payments ORDER BY created_at DESC,id", &[]).map_err(err)?.iter().map(|r|Payment {id:r.get(0),expense_id:r.get(1),amount_minor:r.get::<_,i64>(2).to_string(),reference:r.get(3),date:r.get(4),reconciled:r.get(5)}).collect();
    let events = c
        .query(
            "SELECT id,target_id,action,detail,at::text FROM events ORDER BY id DESC LIMIT 200",
            &[],
        )
        .map_err(err)?
        .iter()
        .map(|r| Event {
            id: r.get(0),
            target_id: r.get(1),
            action: r.get(2),
            detail: r.get(3),
            at: r.get(4),
        })
        .collect();
    Ok(Snapshot {
        organization: ws.get(0),
        operator: ws.get(1),
        currency: ws.get(2),
        storage_engine: "PostgreSQL".into(),
        funds,
        expenses,
        payments,
        events,
    })
}
fn verify_finances(s: &Snapshot) -> Result<()> {
    for e in &s.expenses {
        let allocated: i64 = e
            .allocations
            .iter()
            .map(|a| money(&a.amount_minor))
            .collect::<Result<Vec<_>>>()?
            .iter()
            .try_fold(0_i64, |a, b| {
                a.checked_add(*b).ok_or("Allocation overflow.")
            })?;
        if allocated > money(&e.eligible_minor)?
            || (e.reviewed && allocated != money(&e.eligible_minor)?)
            || money(&e.paid_minor)? > money(&e.eligible_minor)?
            || (money(&e.paid_minor)? > 0 && !e.approved)
        {
            return Err("Workspace financial consistency check failed.".into());
        }
    }
    if s.funds
        .iter()
        .any(|f| money(&f.used_minor).unwrap_or(i64::MAX) > money(&f.budget_minor).unwrap_or(0))
    {
        return Err("Workspace budget consistency check failed.".into());
    }
    Ok(())
}
/// Configure libpq subprocesses without putting credentials into argv.
/// Admin tools intentionally support a single explicit endpoint only.
pub fn postgres_tool(program: &str, url: &str) -> Result<std::process::Command> {
    let config: Config = url
        .parse()
        .map_err(|_| "Invalid FUNDTHREAD_DATABASE_URL.")?;
    if config.get_hosts().len() != 1
        || config.get_ports().len() > 1
        || !config.get_hostaddrs().is_empty()
    {
        return Err("Database administration tools require one explicit host and port, without hostaddr overrides.".into());
    }
    let host = match &config.get_hosts()[0] {
        postgres::config::Host::Tcp(h) => h.as_str(),
        #[cfg(unix)]
        postgres::config::Host::Unix(p) => p.to_str().ok_or("Invalid database socket path.")?,
    };
    let local = matches!(host, "localhost" | "127.0.0.1" | "::1") || host.starts_with('/');
    if !local && config.get_ssl_mode() != postgres::config::SslMode::Require {
        return Err("Remote database administration requires TLS.".into());
    }
    let mut cmd = std::process::Command::new(program);
    for key in [
        "PGSERVICE",
        "PGSERVICEFILE",
        "PGHOSTADDR",
        "PGTARGETSESSIONATTRS",
        "PGOPTIONS",
    ] {
        cmd.env_remove(key);
    }
    cmd.env("PGHOST", host).env(
        "PGPORT",
        config
            .get_ports()
            .first()
            .copied()
            .unwrap_or(5432)
            .to_string(),
    );
    let user = config
        .get_user()
        .ok_or("Database administration requires an explicit user in the connection URL.")?;
    cmd.env("PGUSER", user)
        .env("PGDATABASE", config.get_dbname().unwrap_or(user));
    cmd.env(
        "PGPASSWORD",
        std::str::from_utf8(config.get_password().unwrap_or_default())
            .map_err(|_| "Database administration requires a UTF-8 password.")?,
    );
    cmd.env("PGCONNECT_TIMEOUT", "10");
    cmd.env(
        "PGSSLMODE",
        if local {
            match config.get_ssl_mode() {
                postgres::config::SslMode::Disable => "disable",
                postgres::config::SslMode::Require => "verify-full",
                _ => "prefer",
            }
        } else {
            "verify-full"
        },
    );
    // libpq reads PGSSLROOTCERT (or ~/.postgresql/root.crt). The native client
    // uses OS trust; configure both trust stores for a private database CA.
    Ok(cmd)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_money_and_csv() {
        assert_eq!(money("99999999999999").unwrap(), 99999999999999);
        for s in ["-1", "1.1", "NaN", "999999999999999999999"] {
            assert!(money(s).is_err());
        }
        assert_eq!(csv_cell(" =formula\n"), "\"' =formula \"");
    }
}

#[cfg(test)]
mod connection_policy_tests {
    use super::*;
    #[test]
    fn remote_connection_policy_fails_before_network_access() {
        assert!(
            Vault::exists("")
                .unwrap_err()
                .contains("FUNDTHREAD_DATABASE_URL")
        );
        assert!(
            Vault::exists("host=example.invalid user=test dbname=test sslmode=disable")
                .unwrap_err()
                .contains("require")
        );
        assert!(
            Vault::exists(
                "host=localhost hostaddr=192.0.2.1 user=test dbname=test sslmode=disable"
            )
            .unwrap_err()
            .contains("require")
        );
    }
    #[test]
    fn subprocess_configuration_keeps_credentials_out_of_arguments_and_requires_remote_verification()
     {
        let cmd=postgres_tool("pg_dump","postgresql://test:synthetic-password@db.example.invalid:5433/workspace?sslmode=require").unwrap();
        assert_eq!(cmd.get_args().count(), 0);
        let vars: std::collections::HashMap<_, _> = cmd.get_envs().collect();
        assert_eq!(
            vars[std::ffi::OsStr::new("PGSSLMODE")],
            Some(std::ffi::OsStr::new("verify-full"))
        );
        assert_eq!(
            vars[std::ffi::OsStr::new("PGDATABASE")],
            Some(std::ffi::OsStr::new("workspace"))
        );
        assert_eq!(
            vars[std::ffi::OsStr::new("PGPORT")],
            Some(std::ffi::OsStr::new("5433"))
        );
        assert!(
            postgres_tool("pg_dump", "host=a,b user=test dbname=test sslmode=require").is_err()
        );
        assert!(
            postgres_tool(
                "pg_dump",
                "host=localhost hostaddr=127.0.0.1 user=test dbname=test"
            )
            .is_err()
        );
    }
}

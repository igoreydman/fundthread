use chrono::{NaiveDate, Utc};
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, path::Path, time::Duration};
use uuid::Uuid;
use zeroize::Zeroizing;

pub type Result<T> = std::result::Result<T, String>;
const SCHEMA: i64 = 1;
pub const MAX_DOCUMENT_BYTES: usize = 20 * 1024 * 1024;
const MAX_MONEY: i64 = 1_000_000_000_000_000;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn now() -> String {
    Utc::now().to_rfc3339()
}
fn id() -> String {
    Uuid::new_v4().to_string()
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn content_hash(bytes: &[u8]) -> String {
    digest(bytes)
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

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Allocation {
    pub fund_id: String,
    pub amount_minor: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Fund {
    pub id: String,
    pub name: String,
    pub code: String,
    pub budget_minor: String,
    pub used_minor: String,
    pub period_start: String,
    pub period_end: String,
    pub categories: Vec<String>,
    pub restrictions: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FundInput {
    pub name: String,
    pub code: String,
    pub budget_minor: String,
    pub period_start: String,
    pub period_end: String,
    pub categories: Vec<String>,
    pub restrictions: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Expense {
    pub id: String,
    pub document_id: String,
    pub filename: String,
    pub mime: String,
    pub hash: String,
    pub revision: i64,
    pub merchant: String,
    pub claimant: String,
    pub purpose: String,
    pub expense_date: String,
    pub category: String,
    pub total_minor: String,
    pub eligible_minor: String,
    pub reviewed: bool,
    pub approved: bool,
    pub approver: String,
    pub approval_reference: String,
    pub paid_minor: String,
    pub reconciled_minor: String,
    pub allocations: Vec<Allocation>,
    pub extraction: Option<serde_json::Value>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReviewInput {
    pub id: String,
    pub expected_revision: i64,
    pub merchant: String,
    pub claimant: String,
    pub purpose: String,
    pub expense_date: String,
    pub category: String,
    pub total_minor: String,
    pub eligible_minor: String,
    pub reviewed: bool,
    pub allocations: Vec<Allocation>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Payment {
    pub id: String,
    pub expense_id: String,
    pub amount_minor: String,
    pub reference: String,
    pub date: String,
    pub reconciled: bool,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: i64,
    pub target_id: String,
    pub action: String,
    pub detail: String,
    pub at: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub organization: String,
    pub operator: String,
    pub currency: String,
    pub cipher_version: String,
    pub funds: Vec<Fund>,
    pub expenses: Vec<Expense>,
    pub payments: Vec<Payment>,
    pub events: Vec<Event>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub bytes: Vec<u8>,
    pub mime: String,
    pub filename: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub expense_id: String,
    pub duplicate: bool,
}

pub struct Vault {
    pub(crate) conn: Connection,
    key: Zeroizing<String>,
    _lease: fs::File,
}

impl Vault {
    fn connect(path: &Path, key: &str, create: bool) -> Result<Self> {
        if key.is_empty() {
            return Err("A workspace passphrase is required.".into());
        }
        let lease_path = path.with_file_name(format!(
            "{}.lock",
            path.file_name()
                .and_then(|n| n.to_str())
                .ok_or("Invalid workspace location.")?
        ));
        let lease = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lease_path)
            .map_err(|_| "Could not reserve this workspace.")?;
        lease.try_lock().map_err(|_|"This workspace is already open in another FundThread process. Close it there first.")?;
        let flags = if create {
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE
        } else {
            OpenFlags::SQLITE_OPEN_READ_ONLY
        };
        let conn = Connection::open_with_flags(path, flags)
            .map_err(|_| "Could not open this workspace.")?;
        conn.pragma_update(None, "key", key)
            .map_err(|_| "Could not unlock this workspace.")?;
        let version: String = conn
            .query_row("PRAGMA cipher_version", [], |r| r.get(0))
            .map_err(|_| "The encrypted database engine is unavailable.")?;
        let status: String = conn
            .query_row("PRAGMA cipher_status", [], |r| r.get(0))
            .map_err(|_| "Encryption verification failed.")?;
        if version.is_empty() || status != "1" {
            return Err("Encryption verification failed. Workspace was not opened.".into());
        }
        conn.query_row("SELECT count(*) FROM sqlite_schema", [], |r| {
            r.get::<_, i64>(0)
        })
        .map_err(|_| "The passphrase is incorrect, or the workspace is damaged.")?;
        let schema: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(err)?;
        if !create && schema != SCHEMA {
            return Err("This workspace needs a different application version.".into());
        }
        conn.busy_timeout(Duration::from_secs(5)).map_err(err)?;
        if create {
            conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA temp_store=MEMORY; PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE;").map_err(err)?;
            conn.execute_batch("CREATE TABLE IF NOT EXISTS extraction_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, expense_id TEXT NOT NULL REFERENCES expenses(id), payload TEXT NOT NULL, at TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS privacy_plans (document_id TEXT PRIMARY KEY, regions TEXT NOT NULL, at TEXT NOT NULL);").map_err(err)?;
        }
        Ok(Self {
            conn,
            key: Zeroizing::new(key.to_string()),
            _lease: lease,
        })
    }
    pub fn create(path: &Path, key: &str, organization: &str, operator: &str) -> Result<Self> {
        if path.exists() {
            return Err("A workspace already exists at this location.".into());
        }
        required(organization, "Organization")?;
        required(operator, "Operator name")?;
        if key.chars().count() < 12 {
            return Err(
                "Use a passphrase of at least 12 characters, stored separately for recovery."
                    .into(),
            );
        }
        let vault = Self::connect(path, key, true)?;
        vault.conn.execute_batch(
            "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE documents (id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, bytes BLOB NOT NULL);
             CREATE TABLE funds (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, budget INTEGER NOT NULL CHECK(budget>=0), start TEXT NOT NULL, end TEXT NOT NULL, categories TEXT NOT NULL, restrictions TEXT NOT NULL);
             CREATE TABLE expenses (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id), revision INTEGER NOT NULL DEFAULT 0, merchant TEXT NOT NULL DEFAULT '', claimant TEXT NOT NULL DEFAULT '', purpose TEXT NOT NULL DEFAULT '', expense_date TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'Workshop supplies', total INTEGER NOT NULL DEFAULT 0, eligible INTEGER NOT NULL DEFAULT 0, reviewed INTEGER NOT NULL DEFAULT 0, approved INTEGER NOT NULL DEFAULT 0, approver TEXT NOT NULL DEFAULT '', approval_ref TEXT NOT NULL DEFAULT '', extraction TEXT);
             CREATE TABLE allocations (expense_id TEXT NOT NULL REFERENCES expenses(id), fund_id TEXT NOT NULL REFERENCES funds(id), amount INTEGER NOT NULL CHECK(amount>=0), PRIMARY KEY(expense_id,fund_id));
             CREATE TABLE revisions (expense_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(expense_id,revision));
             CREATE TABLE payments (id TEXT PRIMARY KEY, expense_id TEXT NOT NULL REFERENCES expenses(id), amount INTEGER NOT NULL CHECK(amount>0), reference TEXT NOT NULL, date TEXT NOT NULL, reconciled INTEGER NOT NULL DEFAULT 0, UNIQUE(expense_id,reference));
             CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, target_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, at TEXT NOT NULL);
             PRAGMA user_version=1;"
        ).map_err(err)?;
        for (k, v) in [
            ("organization", organization),
            ("operator", operator),
            ("currency", "USD"),
            ("format", "fundthread-1"),
        ] {
            vault
                .conn
                .execute("INSERT INTO meta VALUES(?1,?2)", params![k, v])
                .map_err(err)?;
        }
        vault.event(
            "workspace",
            "Workspace created",
            "Recovery requires your organizational passphrase.",
        )?;
        Ok(vault)
    }
    pub fn open(path: &Path, key: &str) -> Result<Self> {
        Self::connect(path, key, false)
    }
    fn event(&self, target: &str, action: &str, detail: &str) -> Result<()> {
        self.conn
            .execute(
                "INSERT INTO events(target_id,action,detail,at) VALUES(?1,?2,?3,?4)",
                params![target, action, detail, now()],
            )
            .map_err(err)?;
        Ok(())
    }
    fn meta(&self, key: &str) -> Result<String> {
        self.conn
            .query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0))
            .map_err(err)
    }
    pub fn snapshot(&self) -> Result<Snapshot> {
        let mut funds = self.conn.prepare("SELECT f.id,f.name,f.code,f.budget,f.start,f.end,f.categories,f.restrictions,COALESCE((SELECT SUM(a.amount) FROM allocations a JOIN expenses e ON e.id=a.expense_id WHERE a.fund_id=f.id AND e.approved=1),0) FROM funds f ORDER BY name").map_err(err)?;
        let funds = funds
            .query_map([], |r| {
                Ok(Fund {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    code: r.get(2)?,
                    budget_minor: r.get::<_, i64>(3)?.to_string(),
                    period_start: r.get(4)?,
                    period_end: r.get(5)?,
                    categories: serde_json::from_str(&r.get::<_, String>(6)?).unwrap_or_default(),
                    restrictions: r.get(7)?,
                    used_minor: r.get::<_, i64>(8)?.to_string(),
                })
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        let mut es = self.conn.prepare("SELECT e.id,e.document_id,d.filename,d.mime,d.hash,e.revision,e.merchant,e.claimant,e.purpose,e.expense_date,e.category,e.total,e.eligible,e.reviewed,e.approved,e.approver,e.approval_ref,COALESCE((SELECT SUM(amount) FROM payments WHERE expense_id=e.id),0),COALESCE((SELECT SUM(amount) FROM payments WHERE expense_id=e.id AND reconciled=1),0),e.extraction FROM expenses e JOIN documents d ON d.id=e.document_id ORDER BY e.rowid DESC").map_err(err)?;
        let mut expenses = es
            .query_map([], |r| {
                Ok(Expense {
                    id: r.get(0)?,
                    document_id: r.get(1)?,
                    filename: r.get(2)?,
                    mime: r.get(3)?,
                    hash: r.get(4)?,
                    revision: r.get(5)?,
                    merchant: r.get(6)?,
                    claimant: r.get(7)?,
                    purpose: r.get(8)?,
                    expense_date: r.get(9)?,
                    category: r.get(10)?,
                    total_minor: r.get::<_, i64>(11)?.to_string(),
                    eligible_minor: r.get::<_, i64>(12)?.to_string(),
                    reviewed: r.get(13)?,
                    approved: r.get(14)?,
                    approver: r.get(15)?,
                    approval_reference: r.get(16)?,
                    paid_minor: r.get::<_, i64>(17)?.to_string(),
                    reconciled_minor: r.get::<_, i64>(18)?.to_string(),
                    allocations: vec![],
                    extraction: r
                        .get::<_, Option<String>>(19)?
                        .and_then(|x| serde_json::from_str(&x).ok()),
                })
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        for e in &mut expenses {
            let mut a = self
                .conn
                .prepare(
                    "SELECT fund_id,amount FROM allocations WHERE expense_id=?1 ORDER BY fund_id",
                )
                .map_err(err)?;
            e.allocations = a
                .query_map([&e.id], |r| {
                    Ok(Allocation {
                        fund_id: r.get(0)?,
                        amount_minor: r.get::<_, i64>(1)?.to_string(),
                    })
                })
                .map_err(err)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(err)?;
        }
        let mut ps=self.conn.prepare("SELECT id,expense_id,amount,reference,date,reconciled FROM payments ORDER BY rowid DESC").map_err(err)?;
        let payments = ps
            .query_map([], |r| {
                Ok(Payment {
                    id: r.get(0)?,
                    expense_id: r.get(1)?,
                    amount_minor: r.get::<_, i64>(2)?.to_string(),
                    reference: r.get(3)?,
                    date: r.get(4)?,
                    reconciled: r.get(5)?,
                })
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        let mut ev = self
            .conn
            .prepare("SELECT id,target_id,action,detail,at FROM events ORDER BY id DESC LIMIT 200")
            .map_err(err)?;
        let events = ev
            .query_map([], |r| {
                Ok(Event {
                    id: r.get(0)?,
                    target_id: r.get(1)?,
                    action: r.get(2)?,
                    detail: r.get(3)?,
                    at: r.get(4)?,
                })
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        let cipher_version = self
            .conn
            .query_row("PRAGMA cipher_version", [], |r| r.get(0))
            .map_err(err)?;
        Ok(Snapshot {
            organization: self.meta("organization")?,
            operator: self.meta("operator")?,
            currency: self.meta("currency")?,
            cipher_version,
            funds,
            expenses,
            payments,
            events,
        })
    }
    pub fn add_fund(&mut self, input: FundInput) -> Result<String> {
        required(&input.name, "Fund name")?;
        required(&input.code, "Grant code")?;
        let budget = money(&input.budget_minor)?;
        if NaiveDate::parse_from_str(&input.period_start, "%Y-%m-%d").is_err()
            || NaiveDate::parse_from_str(&input.period_end, "%Y-%m-%d").is_err()
            || input.period_start > input.period_end
        {
            return Err("Choose a valid grant period.".into());
        }
        let fid = id();
        let tx = self.conn.transaction().map_err(err)?;
        tx.execute(
            "INSERT INTO funds VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                fid,
                input.name,
                input.code,
                budget,
                input.period_start,
                input.period_end,
                serde_json::to_string(&input.categories).map_err(err)?,
                input.restrictions
            ],
        )
        .map_err(|_| "That grant code already exists, or the fund could not be saved.")?;
        tx.execute("INSERT INTO events(target_id,action,detail,at) VALUES(?1,'Fund created','Opening budget and grant rules recorded.',?2)",params![fid,now()]).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(fid)
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
            return Err(
                "Import a PDF, PNG or JPEG receipt. Other formats are not supported in this build."
                    .into(),
            );
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
        let hash = digest(bytes);
        let duplicate:Option<String>=self.conn.query_row("SELECT e.id FROM expenses e JOIN documents d ON d.id=e.document_id WHERE d.hash=?1",[&hash],|r|r.get(0)).optional().map_err(err)?;
        if let Some(expense_id) = duplicate {
            return Ok(ImportOutcome {
                expense_id,
                duplicate: true,
            });
        }
        let document_id = id();
        let expense_id = id();
        let safe_name = Path::new(filename)
            .file_name()
            .and_then(|x| x.to_str())
            .unwrap_or("receipt");
        let tx = self.conn.transaction().map_err(err)?;
        tx.execute(
            "INSERT INTO documents VALUES(?1,?2,?3,?4,?5)",
            params![document_id, safe_name, mime, hash, bytes],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO expenses(id,document_id) VALUES(?1,?2)",
            params![expense_id, document_id],
        )
        .map_err(err)?;
        tx.execute("INSERT INTO events(target_id,action,detail,at) VALUES(?1,'Original archived','Original bytes copied into the encrypted workspace.',?2)",params![expense_id,now()]).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(ImportOutcome {
            expense_id,
            duplicate: false,
        })
    }
    pub fn document(&self, document_id: &str) -> Result<Document> {
        self.conn
            .query_row(
                "SELECT bytes,mime,filename FROM documents WHERE id=?1",
                [document_id],
                |r| {
                    Ok(Document {
                        bytes: r.get(0)?,
                        mime: r.get(1)?,
                        filename: r.get(2)?,
                    })
                },
            )
            .map_err(|_| "This receipt is unavailable.".into())
    }
    pub fn save_review(&mut self, input: ReviewInput) -> Result<()> {
        for value in [
            &input.merchant,
            &input.claimant,
            &input.purpose,
            &input.expense_date,
            &input.category,
        ] {
            if value.len() > 4000 {
                return Err("A review field exceeds the supported length.".into());
            }
        }
        let total = money(&input.total_minor)?;
        let eligible = money(&input.eligible_minor)?;
        if eligible > total {
            return Err("Eligible reimbursement cannot exceed the receipt total.".into());
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
            if NaiveDate::parse_from_str(&input.expense_date, "%Y-%m-%d").is_err() {
                return Err("Choose the actual receipt date.".into());
            }
            if eligible == 0 || sum != eligible {
                return Err("Allocate the full eligible amount before marking reviewed.".into());
            }
        }
        let tx = self.conn.transaction().map_err(err)?;
        let (revision,paid):(i64,i64)=tx.query_row("SELECT revision,COALESCE((SELECT SUM(amount) FROM payments WHERE expense_id=e.id),0) FROM expenses e WHERE id=?1",[&input.id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
        if revision != input.expected_revision {
            return Err("This claim has changed. Reload it before saving.".into());
        }
        if paid > 0 {
            return Err("This claim has payment records. Corrections require a reversal workflow, which is not available in this build.".into());
        }
        tx.execute("UPDATE expenses SET revision=revision+1,merchant=?2,claimant=?3,purpose=?4,expense_date=?5,category=?6,total=?7,eligible=?8,reviewed=?9,approved=0,approver='',approval_ref='' WHERE id=?1",params![input.id,input.merchant.trim(),input.claimant.trim(),input.purpose.trim(),input.expense_date,input.category,total,eligible,input.reviewed]).map_err(err)?;
        tx.execute("DELETE FROM allocations WHERE expense_id=?1", [&input.id])
            .map_err(err)?;
        for a in &input.allocations {
            tx.execute(
                "INSERT INTO allocations VALUES(?1,?2,?3)",
                params![input.id, a.fund_id, money(&a.amount_minor)?],
            )
            .map_err(|_| "One of the selected funds is unavailable.")?;
        }
        tx.execute(
            "INSERT INTO revisions VALUES(?1,?2,?3,?4)",
            params![
                input.id,
                revision + 1,
                serde_json::to_string(&input).map_err(err)?,
                now()
            ],
        )
        .map_err(err)?;
        tx.execute("INSERT INTO events(target_id,action,detail,at) VALUES(?1,?2,'New revision saved. Any previous approval was cleared.',?3)",params![input.id,if input.reviewed{"Review completed"}else{"Draft saved"},now()]).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(())
    }
    pub fn save_extraction(&mut self, expense_id: &str, data: serde_json::Value) -> Result<()> {
        let text = serde_json::to_string(&data).map_err(err)?;
        if text.len() > 2_000_000 {
            return Err("Extraction result is too large.".into());
        }
        let tx = self.conn.transaction().map_err(err)?;
        let n = tx
            .execute(
                "UPDATE expenses SET extraction=?2 WHERE id=?1",
                params![expense_id, text],
            )
            .map_err(err)?;
        if n != 1 {
            return Err("Claim not found.".into());
        }
        tx.execute(
            "INSERT INTO extraction_runs(expense_id,payload,at) VALUES(?1,?2,?3)",
            params![expense_id, text, now()],
        )
        .map_err(err)?;
        tx.execute("INSERT INTO events(target_id,action,detail,at) VALUES(?1,'Local extraction completed','Suggestions stored separately; reviewed fields were not changed.',?2)",params![expense_id,now()]).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(())
    }
    pub fn history(&self, expense_id: &str) -> Result<serde_json::Value> {
        let mut rev=self.conn.prepare("SELECT revision,payload,at FROM revisions WHERE expense_id=?1 ORDER BY revision DESC").map_err(err)?;
        let reviews=rev.query_map([expense_id],|r|Ok(serde_json::json!({"revision":r.get::<_,i64>(0)?,"payload":serde_json::from_str::<serde_json::Value>(&r.get::<_,String>(1)?).unwrap_or_default(),"at":r.get::<_,String>(2)?}))).map_err(err)?.collect::<std::result::Result<Vec<_>,_>>().map_err(err)?;
        let mut ex = self
            .conn
            .prepare(
                "SELECT id,payload,at FROM extraction_runs WHERE expense_id=?1 ORDER BY id DESC",
            )
            .map_err(err)?;
        let extractions=ex.query_map([expense_id],|r|Ok(serde_json::json!({"id":r.get::<_,i64>(0)?,"payload":serde_json::from_str::<serde_json::Value>(&r.get::<_,String>(1)?).unwrap_or_default(),"at":r.get::<_,String>(2)?}))).map_err(err)?.collect::<std::result::Result<Vec<_>,_>>().map_err(err)?;
        Ok(serde_json::json!({"reviews":reviews,"extractions":extractions}))
    }
    pub fn privacy_plan(&self, document_id: &str) -> Result<serde_json::Value> {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT regions FROM privacy_plans WHERE document_id=?1",
                [document_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        match raw {
            Some(raw) => serde_json::from_str(&raw).map_err(err),
            None => Ok(serde_json::json!([])),
        }
    }
    pub fn save_privacy_plan(&self, document_id: &str, regions: serde_json::Value) -> Result<()> {
        let regions = regions.as_array().ok_or("Invalid mask regions.")?;
        if regions.len() > 1000 {
            return Err("Too many mask regions.".into());
        }
        for r in regions {
            let get = |k: &str| {
                r.get(k)
                    .and_then(|n| n.as_f64())
                    .filter(|n| n.is_finite())
                    .ok_or("Invalid mask bounds.")
            };
            let x = get("x")?;
            let y = get("y")?;
            let w = get("w")?;
            let h = get("h")?;
            let page = r
                .get("page")
                .and_then(|n| n.as_u64())
                .ok_or("Invalid mask page.")?;
            if x < 0.
                || y < 0.
                || w <= 0.
                || h <= 0.
                || x + w > 1.000001
                || y + h > 1.000001
                || page == 0
                || page > 100
            {
                return Err("Invalid mask region.".into());
            }
        }
        self.document(document_id)?;
        self.conn.execute("INSERT INTO privacy_plans VALUES(?1,?2,?3) ON CONFLICT(document_id) DO UPDATE SET regions=excluded.regions,at=excluded.at",params![document_id,serde_json::to_string(&regions).map_err(err)?,now()]).map_err(err)?;
        Ok(())
    }
    pub fn record_derivative(&self, expense_id: &str, revision: i64, hash: &str) -> Result<()> {
        self.event(expense_id,"Reviewed receipt copy exported",&format!("Source revision {revision}; derivative SHA-256 {hash}; visual review attested by the local operator."))
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
        let snap = self.snapshot()?;
        let e = snap
            .expenses
            .iter()
            .find(|e| e.id == expense_id)
            .ok_or("Claim not found.")?;
        if e.revision != expected_revision {
            return Err("The claim has changed. Review the current revision.".into());
        }
        if !e.reviewed {
            return Err("Complete the receipt review first.".into());
        }
        if e.approved {
            return Err("Approval is already recorded for this revision.".into());
        }
        for a in &e.allocations {
            let f = snap
                .funds
                .iter()
                .find(|f| f.id == a.fund_id)
                .ok_or("Fund not found.")?;
            if e.expense_date < f.period_start || e.expense_date > f.period_end {
                return Err(format!(
                    "Receipt date is outside the configured period for {}.",
                    f.name
                ));
            }
            if !f.categories.is_empty() && !f.categories.contains(&e.category) {
                return Err(format!(
                    "{} is outside the configured categories for {}.",
                    e.category, f.name
                ));
            }
            if money(&f.used_minor)?
                .checked_add(money(&a.amount_minor)?)
                .ok_or("Amount overflow.")?
                > money(&f.budget_minor)?
            {
                return Err(format!(
                    "This would exceed the recorded budget for {}.",
                    f.name
                ));
            }
        }
        let tx = self.conn.transaction().map_err(err)?;
        tx.execute(
            "UPDATE expenses SET approved=1,approver=?2,approval_ref=?3 WHERE id=?1",
            params![expense_id, approver.trim(), reference.trim()],
        )
        .map_err(err)?;
        tx.execute("INSERT INTO events(target_id,action,detail,at) VALUES(?1,'External approval recorded',?2,?3)",params![expense_id,format!("Approval applies to revision {expected_revision}; attribution entered by the local operator."),now()]).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(())
    }
    pub fn record_payment(
        &mut self,
        expense_id: &str,
        amount: &str,
        reference: &str,
        date: &str,
    ) -> Result<()> {
        required(reference, "External payment reference")?;
        if NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
            return Err("Choose a valid payment date.".into());
        }
        let amount = money(amount)?;
        if amount == 0 {
            return Err("Payment amount must be greater than zero.".into());
        }
        let tx = self.conn.transaction().map_err(err)?;
        let (approved,eligible,paid):(bool,i64,i64)=tx.query_row("SELECT approved,eligible,COALESCE((SELECT SUM(amount) FROM payments WHERE expense_id=e.id),0) FROM expenses e WHERE id=?1",[expense_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(err)?;
        if !approved {
            return Err("Record approval before recording a payment.".into());
        }
        if amount > eligible - paid {
            return Err("Payment exceeds the amount still owed.".into());
        }
        tx.execute(
            "INSERT INTO payments VALUES(?1,?2,?3,?4,?5,0)",
            params![id(), expense_id, amount, reference.trim(), date],
        )
        .map_err(|_| "This payment reference is already recorded for the claim.")?;
        tx.execute("INSERT INTO events(target_id,action,detail,at) VALUES(?1,'Payment recorded','External payment confirmation recorded; bank reconciliation is separate.',?2)",params![expense_id,now()]).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(())
    }
    pub fn reconcile(&mut self, payment_id: &str) -> Result<()> {
        let tx = self.conn.transaction().map_err(err)?;
        let eid: String = tx
            .query_row(
                "SELECT expense_id FROM payments WHERE id=?1 AND reconciled=0",
                [payment_id],
                |r| r.get(0),
            )
            .map_err(|_| "This payment is unavailable or already reconciled.")?;
        tx.execute("UPDATE payments SET reconciled=1 WHERE id=?1", [payment_id])
            .map_err(err)?;
        tx.execute("INSERT INTO events(target_id,action,detail,at) VALUES(?1,'Bank reconciliation recorded','Local operator confirmed the external bank record.',?2)",params![eid,now()]).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(())
    }
    pub fn verify(&self) -> Result<()> {
        let integrity: String = self
            .conn
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))
            .map_err(err)?;
        if integrity != "ok" {
            return Err("Database integrity check failed.".into());
        }
        let mut st = self
            .conn
            .prepare("PRAGMA cipher_integrity_check")
            .map_err(err)?;
        if st.query([]).map_err(err)?.next().map_err(err)?.is_some() {
            return Err("Encrypted page integrity check failed.".into());
        }
        let mut st = self
            .conn
            .prepare("SELECT hash,bytes FROM documents")
            .map_err(err)?;
        let mut rows = st.query([]).map_err(err)?;
        while let Some(r) = rows.next().map_err(err)? {
            let hash: String = r.get(0).map_err(err)?;
            let bytes: Vec<u8> = r.get(1).map_err(err)?;
            if hash != digest(&bytes) {
                return Err("Original document verification failed.".into());
            }
        }
        if self.meta("format")? != "fundthread-1" {
            return Err("Unrecognized workspace format.".into());
        }
        Ok(())
    }
    pub fn backup(&self, destination: &Path) -> Result<()> {
        if destination.exists() {
            return Err("Choose a new backup filename to preserve existing copies.".into());
        }
        let temp = destination.with_file_name(format!(".fundthread-{}.tmp", id()));
        let result = (|| {
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .map_err(|_| "Could not create the backup destination.")?;
            self.conn
                .execute(
                    "ATTACH DATABASE ?1 AS ft_backup KEY ?2",
                    params![temp.to_string_lossy(), self.key.as_str()],
                )
                .map_err(|_| "Could not initialize the encrypted snapshot.")?;
            let copied = self
                .conn
                .query_row("SELECT sqlcipher_export('ft_backup')", [], |_| Ok(()))
                .map_err(|_| "Encrypted snapshot export failed.");
            let header = self
                .conn
                .execute_batch("PRAGMA ft_backup.user_version=1;")
                .map_err(err);
            let detach = self
                .conn
                .execute_batch("DETACH DATABASE ft_backup;")
                .map_err(err);
            copied?;
            header?;
            detach?;
            let checked = Self::open(&temp, &self.key)?;
            checked.verify()?;
            let a = self.snapshot()?;
            let b = checked.snapshot()?;
            if a.expenses.len() != b.expenses.len()
                || a.payments.len() != b.payments.len()
                || a.funds.len() != b.funds.len()
            {
                return Err("Snapshot record counts did not match.".into());
            }
            drop(checked);
            fs::File::open(&temp)
                .and_then(|f| f.sync_all())
                .map_err(err)?;
            fs::rename(&temp, destination).map_err(|_| "Could not finish the backup file.")?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result
    }
    pub fn report_csv(&self, profile: &str) -> Result<String> {
        let s = self.snapshot()?;
        let with_people = profile == "bookkeeper";
        if !with_people && profile != "funder" {
            return Err("Unknown export profile.".into());
        }
        let mut out = String::from(
            "claim_id,revision,expense_date,fund_code,currency,approved_allocation_minor,payment_status",
        );
        if with_people {
            out.push_str(",merchant,purpose,claimant,approver,approval_reference");
        }
        out.push_str("\r\n");
        for e in &s.expenses {
            if !e.approved {
                continue;
            }
            for a in &e.allocations {
                let f = s
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
                    f.code.clone(),
                    s.currency.clone(),
                    a.amount_minor.clone(),
                    status.into(),
                ];
                if with_people {
                    row.extend([
                        e.merchant.clone(),
                        e.purpose.clone(),
                        e.claimant.clone(),
                        e.approver.clone(),
                        e.approval_reference.clone(),
                    ]);
                }
                out.push_str(
                    &row.iter()
                        .map(|x| csv_cell(x))
                        .collect::<Vec<_>>()
                        .join(","),
                );
                out.push_str("\r\n");
            }
        }
        Ok(out)
    }
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

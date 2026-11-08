//! One-time, all-or-nothing import. SQLCipher is only compiled with the explicit
//! legacy-sqlcipher feature; its connection is read-only and the source is retained.
use super::*;

impl Vault {
    pub fn import_sqlcipher(&mut self, source: &Path, passphrase: &str) -> Result<()> {
        let old = legacy::Vault::open(source, passphrase)?;
        old.verify()?;
        // Hold a stable source snapshot throughout the export.
        old.conn
            .execute_batch("BEGIN")
            .map_err(|_| "Could not read the legacy workspace.")?;
        let s = old.snapshot()?;
        self.write(|tx| import_records(tx, &old, &s))
    }
}

fn import_records(
    tx: &mut Transaction<'_>,
    old: &legacy::Vault,
    s: &legacy::Snapshot,
) -> Result<()> {
    let legacy_error = |_| "Could not decode a legacy record; nothing was imported.".to_string();

    // Import only to a newly initialized, empty target, preserving its schema.
    let count:i64=tx.query_one("SELECT (SELECT count(*) FROM expenses)+(SELECT count(*) FROM funds)+(SELECT count(*) FROM documents)+(SELECT count(*) FROM reviews)+(SELECT count(*) FROM payments)+(SELECT count(*) FROM extraction_runs)+(SELECT count(*) FROM privacy_regions)+(SELECT count(*) FROM approvals)", &[]).map_err(err)?.get(0);
    let events: i64 = tx
        .query_one(
            "SELECT count(*) FROM events WHERE action <> 'Workspace created'",
            &[],
        )
        .map_err(err)?
        .get(0);
    if count != 0 || events != 0 {
        return Err("Legacy import requires an empty target workspace.".into());
    }
    tx.execute(
        "UPDATE workspace SET organization=$1,operator_name=$2,currency=$3",
        &[&s.organization, &s.operator, &s.currency],
    )
    .map_err(err)?;
    tx.execute("DELETE FROM events", &[]).map_err(err)?;
    for f in &s.funds {
        tx.execute(
            "INSERT INTO funds VALUES($1,$2,$3,$4,$5,$6,$7)",
            &[
                &f.id,
                &f.name,
                &f.code,
                &money(&f.budget_minor)?,
                &date(&f.period_start)?,
                &date(&f.period_end)?,
                &f.restrictions,
            ],
        )
        .map_err(err)?;
        for cat in &f.categories {
            tx.execute(
                "INSERT INTO fund_categories VALUES($1,$2) ON CONFLICT DO NOTHING",
                &[&f.id, &cat],
            )
            .map_err(err)?;
        }
    }
    for e in s.expenses.iter().rev() {
        let d = old.document(&e.document_id)?;
        if content_hash(&d.bytes) != e.hash {
            return Err("Legacy original hash mismatch.".into());
        }
        tx.execute(
            "INSERT INTO documents VALUES($1,$2,$3,$4,$5)",
            &[&e.document_id, &d.filename, &d.mime, &e.hash, &d.bytes],
        )
        .map_err(err)?;
        tx.execute(
            "INSERT INTO expenses(id,document_id,current_revision) VALUES($1,$2,$3)",
            &[&e.id, &e.document_id, &e.revision],
        )
        .map_err(err)?;
        let current = ReviewInput {
            id: e.id.clone(),
            expected_revision: e.revision.saturating_sub(1),
            merchant: e.merchant.clone(),
            claimant: e.claimant.clone(),
            purpose: e.purpose.clone(),
            expense_date: e.expense_date.clone(),
            category: e.category.clone(),
            total_minor: e.total_minor.clone(),
            eligible_minor: e.eligible_minor.clone(),
            reviewed: e.reviewed,
            allocations: e
                .allocations
                .iter()
                .map(|a| Allocation {
                    fund_id: a.fund_id.clone(),
                    amount_minor: a.amount_minor.clone(),
                })
                .collect(),
        };
        let history = old.history(&e.id)?;
        for h in history["reviews"]
            .as_array()
            .ok_or("Invalid legacy review history.")?
        {
            let rev = h["revision"].as_i64().ok_or("Invalid legacy revision.")?;
            if rev >= e.revision {
                continue;
            }
            let mut input: ReviewInput = serde_json::from_value(h["payload"].clone())
                .map_err(|_| "Invalid legacy review payload.")?;
            input.id = e.id.clone();
            let at = h["at"]
                .as_str()
                .ok_or("Invalid legacy review timestamp.")?
                .parse()
                .map_err(|_| "Invalid legacy review timestamp.")?;
            insert_review(tx, &input, rev, Some(at))?;
        }
        let at = history["reviews"]
            .as_array()
            .unwrap()
            .iter()
            .find(|h| h["revision"].as_i64() == Some(e.revision))
            .and_then(|h| h["at"].as_str())
            .map(str::parse)
            .transpose()
            .map_err(|_| "Invalid legacy review timestamp.")?;
        insert_review(tx, &current, e.revision, at)?;
        if e.approved {
            tx.execute(
                "INSERT INTO approvals(expense_id,revision,approver,reference) VALUES($1,$2,$3,$4)",
                &[&e.id, &e.revision, &e.approver, &e.approval_reference],
            )
            .map_err(err)?;
        }
        let mut st = old
            .conn
            .prepare("SELECT id,payload,at FROM extraction_runs WHERE expense_id=?1 ORDER BY id")
            .map_err(legacy_error)?;
        let runs = st
            .query_map([&e.id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(legacy_error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(legacy_error)?;
        let last = runs
            .last()
            .map(|r| serde_json::from_str::<serde_json::Value>(&r.1))
            .transpose()
            .map_err(|_| "Invalid legacy extraction.")?;
        for (run, payload, at) in runs {
            let payload: serde_json::Value =
                serde_json::from_str(&payload).map_err(|_| "Invalid legacy extraction.")?;
            let at: chrono::DateTime<chrono::Utc> = at
                .parse()
                .map_err(|_| "Invalid legacy extraction timestamp.")?;
            tx.execute(
                "INSERT INTO extraction_runs(id,expense_id,payload,at) VALUES($1,$2,$3,$4)",
                &[&run, &e.id, &payload, &at],
            )
            .map_err(err)?;
        }
        if last.as_ref() != e.extraction.as_ref() {
            return Err("Legacy extraction cache differs from its history. Resolve the source inconsistency before importing.".into());
        }
        let masks = old.privacy_plan(&e.document_id)?;
        for (n, r) in masks
            .as_array()
            .ok_or("Invalid legacy masks.")?
            .iter()
            .enumerate()
        {
            let get = |k: &str| r[k].as_f64().ok_or("Invalid legacy mask bounds.");
            let page = r["page"]
                .as_i64()
                .and_then(|p| i32::try_from(p).ok())
                .ok_or("Invalid legacy mask page.")?;
            tx.execute(
                "INSERT INTO privacy_regions VALUES($1,$2,$3,$4,$5,$6,$7)",
                &[
                    &e.document_id,
                    &(n as i32),
                    &page,
                    &get("x")?,
                    &get("y")?,
                    &get("w")?,
                    &get("h")?,
                ],
            )
            .map_err(err)?;
        }
    }
    for p in s.payments.iter().rev() {
        tx.execute("INSERT INTO payments(id,expense_id,amount,reference,payment_date,reconciled) VALUES($1,$2,$3,$4,$5,$6)", &[&p.id,&p.expense_id,&money(&p.amount_minor)?,&p.reference,&date(&p.date)?,&p.reconciled]).map_err(err)?;
    }
    let mut st = old
        .conn
        .prepare("SELECT id,target_id,action,detail,at FROM events ORDER BY id")
        .map_err(legacy_error)?;
    let events = st
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })
        .map_err(legacy_error)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(legacy_error)?;
    for (eid, target, action, detail, at) in events {
        let at: chrono::DateTime<chrono::Utc> =
            at.parse().map_err(|_| "Invalid legacy event timestamp.")?;
        tx.execute(
            "INSERT INTO events VALUES($1,$2,$3,$4,$5)",
            &[&eid, &target, &action, &detail, &at],
        )
        .map_err(err)?;
    }
    tx.batch_execute("SELECT setval(pg_get_serial_sequence('extraction_runs','id'),COALESCE((SELECT max(id) FROM extraction_runs),1),EXISTS(SELECT 1 FROM extraction_runs)); SELECT setval(pg_get_serial_sequence('events','id'),COALESCE((SELECT max(id) FROM events),1),EXISTS(SELECT 1 FROM events));").map_err(err)?;
    let imported = snapshot(tx)?;
    verify_finances(&imported)?;
    // Compare the full application projection before commit (timestamps/events
    // are checked separately). Any normalization discrepancy aborts the import.
    let mut before = serde_json::to_value(&s).map_err(|_| "Could not verify legacy import.")?;
    let mut after =
        serde_json::to_value(&imported).map_err(|_| "Could not verify legacy import.")?;
    for value in [&mut before, &mut after] {
        let obj = value.as_object_mut().unwrap();
        obj.remove("cipherVersion");
        obj.remove("storageEngine");
        obj.remove("events");
        for key in ["funds", "expenses", "payments"] {
            let rows = obj[key].as_array_mut().unwrap();
            rows.sort_by_key(|v| v["id"].as_str().unwrap_or_default().to_string());
            if key == "funds" {
                for f in rows {
                    f["categories"]
                        .as_array_mut()
                        .unwrap()
                        .sort_by_key(|v| v.as_str().unwrap_or_default().to_string());
                }
            }
        }
    }
    if before != after {
        return Err(
            "Legacy import verification failed; all imported records were rolled back.".into(),
        );
    }
    event(
        tx,
        "workspace",
        "SQLCipher import completed",
        "Original hashes and application records verified; source file retained.",
    )?;
    Ok(())
}

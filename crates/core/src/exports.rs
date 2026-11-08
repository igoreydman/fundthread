use crate::{Result, Snapshot, Vault, content_hash, csv_cell, report_rows};
use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ExportSpec {
    Report { profile: String },
    Analytics { start: String, end: String },
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPreview {
    pub csv: String,
    pub rows: Vec<Vec<String>>,
    pub organization: String,
    pub revision_token: String,
    pub spec: ExportSpec,
}
pub fn preview(vault: &Vault, spec: &ExportSpec) -> Result<ExportPreview> {
    from_snapshot(&vault.snapshot()?, spec)
}
pub fn from_snapshot(snapshot: &Snapshot, spec: &ExportSpec) -> Result<ExportPreview> {
    let rows = match spec {
        ExportSpec::Report { profile } => report_rows(snapshot, profile)?,
        ExportSpec::Analytics { start, end } => analytics_rows(snapshot, start, end)?,
    };
    let csv = dollar_csv(&rows)?;
    let canonical = serde_json::to_value((spec, &snapshot.organization, snapshot))
        .map_err(|_| "Could not prepare the export snapshot.")?;
    let revision_token = content_hash(
        &serde_json::to_vec(&canonical).map_err(|_| "Could not prepare the export snapshot.")?,
    );
    Ok(ExportPreview {
        csv,
        rows,
        organization: snapshot.organization.clone(),
        revision_token,
        spec: spec.clone(),
    })
}
fn date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .ok()
        .filter(|d| d.format("%Y-%m-%d").to_string() == value)
}
fn amount(value: &str) -> Result<i128> {
    if !value.bytes().all(|b| b.is_ascii_digit()) || value.is_empty() {
        return Err("Invalid stored amount.".into());
    }
    value.parse().map_err(|_| "Invalid stored amount.".into())
}
#[derive(Default)]
struct Group {
    amount: i128,
    count: usize,
}
fn add(map: &mut BTreeMap<String, Group>, key: String, value: i128) {
    let row = map.entry(key).or_default();
    row.amount += value;
    row.count += 1;
}
pub fn analytics_rows(s: &Snapshot, start: &str, end: &str) -> Result<Vec<Vec<String>>> {
    if (!start.is_empty() && date(start).is_none())
        || (!end.is_empty() && date(end).is_none())
        || (!start.is_empty() && !end.is_empty() && start > end)
    {
        return Err("Choose a valid receipt-date range.".into());
    }
    let has_range = !start.is_empty() || !end.is_empty();
    let selected: Vec<_> = s
        .expenses
        .iter()
        .filter(|e| {
            if date(&e.expense_date).is_none() {
                !has_range
            } else {
                (start.is_empty() || e.expense_date.as_str() >= start)
                    && (end.is_empty() || e.expense_date.as_str() <= end)
            }
        })
        .collect();
    let mut gross = 0i128;
    let mut approved = 0i128;
    let mut paid = 0i128;
    let mut approved_count = 0usize;
    let mut review_count = 0usize;
    let mut decision_count = 0usize;
    let mut days = BTreeMap::new();
    let mut day_categories: BTreeMap<String, BTreeMap<String, Group>> = BTreeMap::new();
    let mut categories = BTreeMap::new();
    let mut funds = BTreeMap::new();
    for e in &selected {
        gross += amount(&e.total_minor)?;
        if !e.reviewed {
            review_count += 1;
        } else if !e.approved {
            decision_count += 1;
        }
        if !e.approved {
            continue;
        }
        let eligible = amount(&e.eligible_minor)?;
        approved += eligible;
        paid += amount(&e.paid_minor)?;
        approved_count += 1;
        if date(&e.expense_date).is_some() {
            add(&mut days, e.expense_date.clone(), eligible);
            add(
                day_categories.entry(e.expense_date.clone()).or_default(),
                if e.category.is_empty() {
                    "Uncategorized".into()
                } else {
                    e.category.clone()
                },
                eligible,
            );
        }
        add(
            &mut categories,
            if e.category.is_empty() {
                "Uncategorized".into()
            } else {
                e.category.clone()
            },
            eligible,
        );
        for a in &e.allocations {
            let f = s
                .funds
                .iter()
                .find(|f| f.id == a.fund_id)
                .ok_or("A selected fund is unavailable.")?;
            add(
                &mut funds,
                format!("{} · {}", f.code, f.name),
                amount(&a.amount_minor)?,
            );
        }
    }
    let first = if start.is_empty() {
        selected.iter().filter_map(|e| date(&e.expense_date)).min()
    } else {
        date(start)
    };
    let last = if end.is_empty() {
        selected.iter().filter_map(|e| date(&e.expense_date)).max()
    } else {
        date(end)
    };
    if let (Some(first), Some(last)) = (first, last) {
        let count = (last - first).num_days() + 1;
        if count > 0 && count <= 366 {
            for i in 0..count {
                days.entry((first + Duration::days(i)).format("%Y-%m-%d").to_string())
                    .or_default();
            }
        }
    }
    let mut undated = 0i128;
    let mut undated_count = 0usize;
    for e in s
        .expenses
        .iter()
        .filter(|e| date(&e.expense_date).is_none())
    {
        undated += amount(&e.total_minor)?;
        undated_count += 1;
    }
    let label = if !has_range {
        "All receipt dates".to_string()
    } else {
        format!(
            "{} to {}",
            if start.is_empty() {
                "First receipt"
            } else {
                start
            },
            if end.is_empty() {
                "Latest receipt"
            } else {
                end
            }
        )
    };
    let c = s.currency.clone();
    let mut rows = vec![
        vec![
            "section".into(),
            "metric".into(),
            "period_or_date".into(),
            "amount_minor".into(),
            "count".into(),
            "currency".into(),
        ],
        vec![
            "scope".into(),
            "Receipt dates".into(),
            label,
            "".into(),
            "".into(),
            c.clone(),
        ],
    ];
    for (name, value, count) in [
        ("Approved expense", Some(approved), Some(approved_count)),
        ("Recorded receipt total", Some(gross), Some(selected.len())),
        ("Paid on these expenses", Some(paid), None),
        ("Still owed", Some(approved - paid), None),
        ("Needs review", None, Some(review_count)),
        ("Awaiting decision", None, Some(decision_count)),
    ] {
        rows.push(vec![
            "summary".into(),
            name.into(),
            "".into(),
            value.map(|n| n.to_string()).unwrap_or_default(),
            count.map(|n| n.to_string()).unwrap_or_default(),
            c.clone(),
        ]);
    }
    rows.push(vec![
        "undated".into(),
        if has_range {
            "Undated receipts outside date filter".into()
        } else {
            "Undated receipts included in receipt total".into()
        },
        "No receipt date".into(),
        undated.to_string(),
        undated_count.to_string(),
        c.clone(),
    ]);
    for (label, group) in days {
        rows.push(vec![
            "daily".into(),
            "Approved expense".into(),
            label.clone(),
            group.amount.to_string(),
            group.count.to_string(),
            c.clone(),
        ]);
        if let Some(map) = day_categories.remove(&label) {
            let mut sorted: Vec<_> = map.into_iter().collect();
            sorted.sort_by(|a, b| a.0.encode_utf16().cmp(b.0.encode_utf16()));
            for (category, value) in sorted {
                rows.push(vec![
                    "daily".into(),
                    format!("Category · {category}"),
                    label.clone(),
                    value.amount.to_string(),
                    value.count.to_string(),
                    c.clone(),
                ]);
            }
        }
    }
    for (section, map) in [("category", categories), ("fund", funds)] {
        let mut sorted: Vec<_> = map.into_iter().collect();
        sorted.sort_by(|a, b| a.0.encode_utf16().cmp(b.0.encode_utf16()));
        for (label, group) in sorted {
            rows.push(vec![
                section.into(),
                label,
                "".into(),
                group.amount.to_string(),
                group.count.to_string(),
                c.clone(),
            ]);
        }
    }
    Ok(rows)
}
pub fn dollar_csv(rows: &[Vec<String>]) -> Result<String> {
    let header = rows.first().cloned().unwrap_or_default();
    rows.iter()
        .enumerate()
        .map(|(index, row)| {
            row.iter()
                .enumerate()
                .map(|(column, value)| {
                    let display = if header.get(column).is_some_and(|h| h.ends_with("_minor")) {
                        if index == 0 {
                            value.trim_end_matches("_minor").to_string() + "_usd"
                        } else if value.is_empty() {
                            String::new()
                        } else {
                            let amount: i128 =
                                value.parse().map_err(|_| "Invalid stored money value.")?;
                            let absolute =
                                amount.checked_abs().ok_or("Invalid stored money value.")?;
                            format!(
                                "{}{}.{:02}",
                                if amount < 0 { "-" } else { "" },
                                absolute / 100,
                                absolute % 100
                            )
                        }
                    } else {
                        value.clone()
                    };
                    Ok(csv_cell(&display))
                })
                .collect::<Result<Vec<_>>>()
                .map(|row| row.join(","))
        })
        .collect::<Result<Vec<_>>>()
        .map(|rows| rows.join("\r\n"))
}
pub fn analytics_csv(s: &Snapshot, start: &str, end: &str) -> Result<String> {
    dollar_csv(&analytics_rows(s, start, end)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Allocation, Expense, Fund, Payment};
    fn fixture() -> Snapshot {
        let funds = (0..2)
            .map(|i| Fund {
                id: format!("f{i}"),
                name: format!("Fund {i}"),
                code: format!("F{i}"),
                budget_minor: "100000".into(),
                used_minor: "0".into(),
                period_start: "2026-01-01".into(),
                period_end: "2026-12-31".into(),
                categories: vec![],
                restrictions: String::new(),
            })
            .collect();
        let approved = Expense {
            id: "claim".into(),
            document_id: "doc".into(),
            filename: "receipt.pdf".into(),
            mime: "application/pdf".into(),
            hash: "hash".into(),
            revision: 1,
            merchant: "PRIVATE_MERCHANT".into(),
            claimant: "PRIVATE_PERSON".into(),
            purpose: "=PRIVATE_FORMULA()".into(),
            expense_date: "2026-10-22".into(),
            category: "Supplies".into(),
            total_minor: "1501".into(),
            eligible_minor: "1001".into(),
            reviewed: true,
            approved: true,
            approver: "PRIVATE_APPROVER".into(),
            approval_reference: "PRIVATE_REF".into(),
            paid_minor: "200".into(),
            reconciled_minor: "0".into(),
            allocations: vec![
                Allocation {
                    fund_id: "f0".into(),
                    amount_minor: "600".into(),
                },
                Allocation {
                    fund_id: "f1".into(),
                    amount_minor: "401".into(),
                },
            ],
            extraction: None,
        };
        let mut undated = approved.clone();
        undated.id = "undated".into();
        undated.expense_date = String::new();
        undated.total_minor = "6500".into();
        undated.eligible_minor = "6500".into();
        undated.approved = false;
        undated.reviewed = false;
        undated.paid_minor = "0".into();
        undated.allocations.clear();
        Snapshot {
            organization: "Niñez · 北京".into(),
            operator: "Operator".into(),
            currency: "USD".into(),
            storage_engine: "PostgreSQL".into(),
            funds,
            expenses: vec![approved, undated],
            payments: (0..2)
                .map(|i| Payment {
                    id: format!("p{i}"),
                    expense_id: "claim".into(),
                    amount_minor: "100".into(),
                    reference: format!("P{i}"),
                    date: "2026-10-23".into(),
                    reconciled: false,
                })
                .collect(),
            events: vec![],
        }
    }
    #[test]
    fn aggregate_export_counts_split_claim_once_and_keeps_undated_and_settlement_separate() {
        let s = fixture();
        let rows = analytics_rows(&s, "", "").unwrap();
        let row = |name: &str| {
            rows.iter()
                .find(|r| r[0] == "summary" && r[1] == name)
                .unwrap()
        };
        assert_eq!(row("Approved expense")[3..5], ["1001", "1"]);
        assert_eq!(row("Recorded receipt total")[3], "8001");
        assert_eq!(row("Paid on these expenses")[3], "200");
        assert_eq!(row("Still owed")[3], "801");
        assert_eq!(
            rows.iter()
                .filter(|r| r[0] == "fund")
                .map(|r| r[3].parse::<i128>().unwrap())
                .sum::<i128>(),
            1001
        );
        assert!(!analytics_csv(&s, "", "").unwrap().contains("PRIVATE"));
    }
    #[test]
    fn date_range_export_has_honest_zero_days_and_rejects_invalid_ranges() {
        let s = fixture();
        let rows = analytics_rows(&s, "2026-10-20", "2026-10-24").unwrap();
        assert_eq!(
            rows.iter()
                .filter(|r| r[0] == "daily" && r[1] == "Approved expense")
                .count(),
            5
        );
        assert_eq!(
            rows.iter()
                .find(|r| r[0] == "daily" && r[2] == "2026-10-20")
                .unwrap()[3],
            "0"
        );
        assert_eq!(
            rows.iter()
                .find(|r| r[1] == "Recorded receipt total")
                .unwrap()[3],
            "1501"
        );
        assert!(analytics_csv(&s, "2026-10-25", "2026-10-20").is_err());
        assert!(analytics_csv(&s, "2026-02-30", "").is_err());
    }
    #[test]
    fn daily_category_rows_reconcile_without_double_counting_splits_or_undated_expenses() {
        let mut s = fixture();
        let mut undated = s.expenses[0].clone();
        undated.id = "approved-undated".into();
        undated.expense_date = String::new();
        undated.category = "Undated only".into();
        s.expenses.push(undated);
        let rows = analytics_rows(&s, "", "").unwrap();
        let totals: Vec<_> = rows
            .iter()
            .filter(|r| r[0] == "daily" && r[1] == "Approved expense")
            .collect();
        let categories: Vec<_> = rows
            .iter()
            .filter(|r| r[0] == "daily" && r[1].starts_with("Category · "))
            .collect();
        assert_eq!(totals.len(), 1);
        assert_eq!(categories.len(), 1);
        assert_eq!(totals[0][3], "1001");
        assert_eq!(categories[0][3], totals[0][3]);
        assert_eq!(categories[0][4], "1");
        assert!(!categories[0][1].contains("Undated only"));
        assert!(dollar_csv(&rows).unwrap().contains("Category · Supplies"));
    }

    #[test]
    fn dollar_csv_has_exact_numeric_usd_columns_without_changing_canonical_rows() {
        let rows = vec![
            vec!["amount_minor".into(), "code".into()],
            vec!["1000000000000000".into(), "+Care".into()],
            vec!["1".into(), "B".into()],
            vec!["-123".into(), "C".into()],
        ];
        let csv = dollar_csv(&rows).unwrap();
        assert!(csv.contains("\"amount_usd\""));
        assert!(csv.contains("\"10000000000000.00\""));
        assert!(csv.contains("\"0.01\""));
        assert!(csv.contains("-1.23"));
        assert!(csv.contains("'+Care"));
        assert_eq!(rows[1][0], "1000000000000000");
    }

    #[test]
    fn export_token_binds_organization_scope_and_current_snapshot_not_only_csv() {
        let mut s = fixture();
        let spec = ExportSpec::Report {
            profile: "funder".into(),
        };
        let old = from_snapshot(&s, &spec).unwrap();
        s.organization = "New organization".into();
        let changed = from_snapshot(&s, &spec).unwrap();
        assert_eq!(old.csv, changed.csv);
        assert_ne!(old.revision_token, changed.revision_token);
        s.expenses[1].total_minor = "6600".into();
        assert_ne!(
            changed.revision_token,
            from_snapshot(&s, &spec).unwrap().revision_token
        );
        assert_ne!(
            changed.revision_token,
            from_snapshot(
                &s,
                &ExportSpec::Analytics {
                    start: String::new(),
                    end: String::new()
                }
            )
            .unwrap()
            .revision_token
        );
    }
    #[test]
    fn raw_recipient_rows_preserve_spreadsheet_prefixes_without_leaking_people_to_funder() {
        let mut s = fixture();
        s.funds[0].code = "+Care".into();
        let f = from_snapshot(
            &s,
            &ExportSpec::Report {
                profile: "funder".into(),
            },
        )
        .unwrap();
        assert!(f.csv.contains("'+Care"));
        assert_eq!(f.rows[1][3], "+Care");
        assert!(!f.csv.contains("PRIVATE"));
        let b = from_snapshot(
            &s,
            &ExportSpec::Report {
                profile: "bookkeeper".into(),
            },
        )
        .unwrap();
        assert!(b.csv.contains("'=PRIVATE_FORMULA"));
        assert_eq!(b.rows[1][8], "=PRIVATE_FORMULA()");
        s.funds[0].code = "'+Care".into();
        assert_eq!(
            from_snapshot(
                &s,
                &ExportSpec::Report {
                    profile: "funder".into()
                }
            )
            .unwrap()
            .rows[1][3],
            "'+Care"
        );
    }
}

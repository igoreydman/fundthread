use serde::{Deserialize, Serialize};
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
    pub storage_engine: String,
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

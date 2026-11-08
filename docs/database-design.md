# PostgreSQL schema, normalization and indexing

The runtime desktop store is PostgreSQL 16 or newer, accessed through the synchronous Rust `postgres` driver on Tauri's blocking worker. The migration and integration tests used PostgreSQL 18.0. All objects live in `fundthread`; a database contains one organization/workspace. Browser demo/personal sessions remain temporary JavaScript memory and never connect to PostgreSQL.

The executable schema is [`0001_postgres.sql`](../crates/core/migrations/0001_postgres.sql). Creation is transactional and serialized with an advisory lock. `schema_migrations` tracks the version; connections reject unsupported versions. Future changes require ordered, versioned migrations rather than editing a deployed version in place.

## 3NF design

Each relation stores facts determined by its candidate key. Collections have rows, and monetary aggregates and current display states are computed. Merchant, claimant, category and approver names are textual observations, not assumed identity keys. A repeated name does not imply the same person or business; separate identity entities become appropriate when the product introduces stable identity IDs and their own attributes.

| Relation | Key | Responsibility |
| --- | --- | --- |
| `workspace` | singleton `true` | Organization, configured operator and USD currency, once per database |
| `documents` | `id`; alternate unique `hash` | Original bytes, file name, media type, SHA-256 |
| `funds` | `id`; alternate unique `code` | Fund rules, grant dates and opening budget |
| `fund_categories` | `(fund_id, category)` | One permitted category per row; no rows means unrestricted categories |
| `expenses` | `id`; alternate unique `document_id` | Claim identity, document link, current review pointer, import time |
| `reviews` | `(expense_id, revision)` | Immutable saved review facts for a particular version; revision 0 is the imported draft |
| `review_allocations` | `(expense_id, revision, fund_id)` | Amount charged to each fund in a saved review |
| `approvals` | `(expense_id, revision)` | Attribution/reference for one externally approved review version |
| `payments` | `id`; alternate unique `(expense_id, reference)` | Recorded external payment, date, reconciliation flag |
| `extraction_runs` | identity `id` | One unstructured engine artifact and run time for a claim |
| `privacy_regions` | `(document_id, ordinal)` | One ordered page/mask rectangle per row |
| `events` | identity `id` | Action, detail, time and opaque audit subject identifier |
| `schema_migrations` | version | Applied application schema version |

The current review is a foreign key, not a second copy of its fields. Allocations refer to their review. Approvals refer to that same review, so editing creates a new unapproved version while retaining prior approvals as history. There is no persistent `used`, `paid`, `reconciled amount`, `approved` flag or duplicate latest-extraction cache on the claim. Current flags and totals are derived through joins and sums. Review history is reconstructed from typed rows, rather than JSON copies of operational entities.

OCR payload JSONB is an opaque document-processing artifact, not the authoritative store for reviewed financial facts or repeating fund/mask relationships. It is returned as a whole and retained once per run. The audit subject spans workspace, funds and claims; it is a textual event subject, not a polymorphic business foreign key. Audit records are not independent tamper-proof evidence.

The database uses `bigint` minor units with bounds, `date` grant/expense/payment dates, `timestamptz` event/run times, and `boolean` flags. Constraints reject missing references, duplicate fund codes/hashes/references, invalid date ranges, negative/oversized amounts, eligible amounts above total, reviewed records without required fields, and invalid mask coordinates/pages. Original bytes are stored as `bytea` within the existing 20 MB limit. IDs remain text to preserve existing identifiers during import.

## Transactions and concurrent clients

Every supported application mutation starts a database transaction and locks the `workspace` singleton row **before reading**. Validation queries then see the preceding writer's committed state under Read Committed. This makes revisions, duplicate imports, grant-budget approval and partial-payment checks safe across multiple FundThread processes. Multi-statement snapshots/history/verification use a read-only Repeatable Read transaction. A process-local mutex alone would not protect two database connections.

This coarse write lock deliberately favors correctness for the current small nonprofit workspace. Reads remain concurrent. If write contention becomes material, replace it with consistently ordered claim/fund row locks and equivalent concurrency tests; do not remove it without replacing its protection. Timeouts return a retry message. Initialization/restoration uses a separate advisory lock.

Cross-row business rules (allocation totals, budget availability and payment totals) are enforced in the application transaction, not SQL CHECK expressions that query other rows. PostgreSQL [documents why cross-row CHECK constraints cannot guarantee these rules](https://www.postgresql.org/docs/current/ddl-constraints.html). Direct SQL writers can bypass application validation and must remain restricted to trusted administration. The `verify` command checks original hashes and current financial consistency; it is not a PostgreSQL physical-page certification.

## Indexes chosen for current queries

Primary and unique constraints create their own B-tree indexes; PostgreSQL does not automatically index referencing foreign-key columns. See [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html). Avoid duplicating those existing indexes.

| Query/access | Index | Reason |
| --- | --- | --- |
| Import byte-duplicate lookup | `documents(hash)` unique | Fast exact SHA-256 match |
| Grant-code lookup/uniqueness | `funds(code)` unique | Prevent duplicate grant codes |
| Category lookup | `fund_categories(fund_id,category)` PK | Covers fund foreign key and permitted-category reads |
| Document-to-claim join | `expenses(document_id)` unique | One claim per original; covers document FK |
| Newest imported claims | `expenses(created_at DESC,id)` | Deterministic ordering without SQLite rowid |
| Fund display ordering | `funds(name,id)` | Name order with stable tie-breaker |
| Current review/history | `reviews(expense_id,revision)` PK | Supports exact current version, FK and descending version history |
| Allocations for a review | `review_allocations(expense_id,revision,fund_id)` PK | Covers review FK and allocation read |
| Approved usage per fund | `allocations_fund_idx(fund_id,expense_id,revision) INCLUDE(amount)` | Reverse lookup by fund; covers fund FK and supplies amount/join keys |
| Current approval | `approvals(expense_id,revision)` PK | One decision per review; exact join and review FK |
| Claim payment sums/reference | `payments(expense_id,reference)` unique | Leading expense column covers payment FK/sums and enforces duplicate-reference rule |
| Newest payments | `payments(created_at DESC,id)` | Deterministic snapshot ordering |
| Latest OCR/history | `extraction_runs(expense_id,id DESC)` | Claim FK, latest-run LIMIT 1 and run history |
| Document masks | `privacy_regions(document_id,ordinal)` PK | Document FK and saved mask ordering |
| Latest 200 audit events | `events(id)` PK, scanned backward | Avoid an unnecessary duplicate descending index |

There are no broad boolean indexes, JSONB GIN indexes, name-identity indexes or speculative indexes on every column. Current queries do not filter OCR payloads or search inside them. Add a partial reconciliation index only if an actual outstanding-payment query needs it. A separate event-subject index becomes useful when filtering history in SQL; current UI filtering operates on the latest 200 loaded events.

[`scripts/explain-postgres.sql`](../scripts/explain-postgres.sql) seeds a transaction with 10,000 synthetic claims, 100 funds, 10,000 payments and 30,000 extraction artifacts, runs `EXPLAIN (ANALYZE, BUFFERS)` on representative queries, then rolls everything back. Run it only in a disposable initialized database. Planner choices and timings depend on cardinality, cache, visibility and hardware; an index is not a guarantee of a particular plan. The full snapshot still loads all claims and uses per-claim allocation/per-fund category queries. Pagination/batched joins are a future scaling improvement, separate from normalization and indexing.

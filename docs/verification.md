# PostgreSQL migration verification — November 8, 2026

The current desktop implementation uses PostgreSQL. The SQLCipher test/package results below are retained as historical evidence and do **not** validate this migrated native tree.

Current migration checks:

- **16 real PostgreSQL integration tests passed** on a project-local PostgreSQL 18.0 instance: persistence, domain rules, constraints, current/history projections, rollback, concurrent reviews/approvals/payments/duplicate imports, original-preserving SQLCipher migration, identity-sequence continuity, malformed-source rollback, actual `pg_dump`/`pg_restore` round trip, no-clobber backup, Unix 0600 archive, invalid/existing-target restore refusal and corrupted financial/schema detection.
- **3 native export safeguards passed** against the migrated Tauri source: owned application state/legacy extensions protected, symbolic links checked, atomic replacement preserves a hard-linked source.
- `cargo check -p fundthread` and core/optional importer compile checks passed. Frontend production build passed after the API/storage metadata contract change; a concurrent UI owner continues frontend verification and packaging separately.
- Query-plan experiment used 10,000 synthetic claims/100 funds/10,000 payments/30,000 extraction artifacts in a disposable database. PostgreSQL selected the document hash unique index, fund allocation reverse index, payment reference index's expense prefix, latest-extraction index, backward review PK and expense ordering index. The fund-usage plan also scanned the 5,000-row approval table; the experiment is not a universal performance guarantee. Rows were rolled back and the disposable database removed.

Evidence and commands: [operations](postgres-operations.md), [schema/index rationale](database-design.md), [integration tests](../crates/core/tests/postgres.rs), [query experiment](../scripts/explain-postgres.sql). A machine-readable migration checkpoint is in [postgres-verification.json](postgres-verification.json). Query-plan output is stored in the workspace's `output/fundthread-experience-polish-2026-11-08/postgres-query-plans.txt`.

No live organization database was cut over or source vault deleted. The test server was isolated on loopback; no hosted service was provisioned. Native UI/create/import/save-dialog behavior, remote TLS/private CA configuration, Windows packaging, clean-device recovery and a new signed/notarized distribution remain unverified. Old app bundles must not be presented as PostgreSQL builds. Browser memory behavior and browser test results do not validate native database persistence.

## Historical pre-PostgreSQL verification

# Prior SQLCipher verification — November 8, 2026

## Passed checks

| Check | Evidence and scope |
| --- | --- |
| Actual encrypted storage/domain core | 12 Rust tests: encrypted reopen/original preservation; keyed backup/restoration; review/approval/payment/reconciliation separation; stale revisions and invalid allocations; configured grant rules; independent OCR suggestions; minimal/formula-safe report; exact bounded money; exclusive workspace lease/release; histories/masks surviving backup; budget consumption once/overspend rejection; malformed and oversized image headers rejected before archive |
| Native export safeguards | Three Rust tests: owned-vault/backup destinations rejected, symbolic-link aliases detected, and atomic replacement preserves a hard-linked original |
| Frontend parsing/money/import safety | 12 Vitest tests: integer-cent arithmetic, invalid input rejection, source-page parsing, missing values, quoted CSV, actual original preservation, byte duplicates, partial import success, sample/personal isolation, image-header limits, review/payment validation, workspace-switch race prevention and stale/unconfirmed PDF rejection |
| Browser workflows | Nine Playwright scenarios: candidate/review separation; draft navigation; approval/partial payment/minimal report; reversible persisted masks/new attestation and burned-in pixels in a fresh image-only PDF; fund/recovery states; compact layout and keyboard tab navigation; scanned-PDF OCR; actual uploaded PDF through inline fund creation, approval, duplicate check and CSV download; actual PNG/JPEG OCR and masked photo-to-PDF export with partial import failure; canceling file imports/drops/reset and resuming a paused personal session. All run against the standalone browser build with CSP response headers on page and workers. |
| Frontend production build | TypeScript build and Vite build succeed with bundled PDF/OCR assets and verified English model checksum |
| Native source | `cargo check -p fundthread` succeeds for the actual Tauri shell and command manifest/capabilities |
| macOS package | Optimized aarch64 macOS `FundThread.app` produced by Tauri; roughly 36 MiB. Local linker ad-hoc signature; no Developer ID identity, notarization or production signing claim. |

The successful browser runs selected the machine's existing Chromium 154 headless shell and software rendering. The freshly downloaded Chromium 158 headless renderer stalled during page rendering/capture; those interrupted attempts are not counted as passing. The pinned Playwright runner accepts `FUNDTHREAD_TEST_BROWSER` for reproducing the successful browser selection.

## Captured and exported evidence

`docs/screenshots/` contains actual operated browser-preview captures: receipt workspace, grant funds, report preview, privacy review, compact workspace, paused sample/entry screen, actual uploaded synthetic receipt session, and import dialog. `docs/examples/` contains the actual synthetic funder CSV and reviewed receipt PDF produced by the workflow checks. They contain fictional demonstration data. No native UI screenshot is mislabeled as tested native behavior.

The privacy tests inspect PDF resources for zero text fonts (an empty Font dictionary is valid) and absent embedded-file names, inflates the fresh page image, and samples the masked region for black RGB pixels. It also reopens the mask plan and verifies the checkbox is not pre-confirmed. That is evidence about the selected region and export structure; it does not prove every PII item was detected or visually reviewed by a real bookkeeper.

## Not yet established

The Mac was locked during the native UI check, and the user chose to continue without that check. The tool reported that an unlocked Mac was required; no unlock was bypassed. Actual native create/import/save-dialog/close interactions and packaged-webview PDF/OCR worker behavior still need to be operated. Browser preview and native-core tests cannot substitute for that integration pass. Windows compilation/installation, clean-device offline operation and recovery, real receipt accuracy, nonprofit user comprehension, complete PII detection and independent security review remain open release gates.

The requested new Interactive Experience Research Team skill has 93 regression tests passing, but its final live synthesis hit a fixed adapter timeout. Its creation session is repairing the timeout and rerunning synthesis; it has not confirmed readiness. Review evidence and a focused prompt are prepared in `docs/design-review/`. This checkpoint does not claim a completed skill-led design review.

## Browser packaging and custody

`npm run build:browser` emits a standalone static directory and an explicit `_headers` response-policy file. The preview server on port 1421 supplied CSP, no-referrer, nosniff and frame denial on the actual OCR worker response. PDF rendering, WebAssembly OCR and real downloads were tested together under that policy. Tests observed no receipt POST or external HTTP request during the exercised real-PDF path; this is bounded evidence, not a claim about every future deployment or extension. No real nonprofit records were used.

Original browser bytes and application records are held only in memory. A separate personal session begins on file selection/import; the default remains a fictional sample. Reload/reset clears personal records. Pausing retains them but supplies no encryption/authentication. The browser close reminder remains active while paused and is best effort. Native encryption/recovery tests establish a different storage boundary. See [the browser guide](browser-demo.md).

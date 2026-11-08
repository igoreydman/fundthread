> Storage architecture update, November 8, 2026: PostgreSQL with normalized/versioned relations now supersedes this plan's SQLCipher/passphrase/file-lease/encrypted-file-recovery assumptions. See [database design](database-design.md), [operations/import/recovery](postgres-operations.md) and [current verification](verification.md). The earlier implementation/verification details below are historical, not current native release claims. Database credentials, server storage encryption and recovery are now administrator-managed; browser sessions remain temporary memory.

# FundThread — hackathon build plan

Working name: **FundThread**. Tagline: **Keep the receipt. Follow the funds.**

The name describes the thread connecting original evidence, a reviewed expense, funding source, approval and external payment. A basic name search found a parked domain listing, rather than establishing legal clearance. No domain is purchased or required for the local app.

## Current authorization and design dependency

The user requested another readiness check, iteration/polish, a hackathon name and the start of implementation. The Interactive Experience Research Team is installed but its creation session is still in live validation. Its specialists and 93 regression tests have passed; its final live synthesis is still running after a transport-timeout repair. The foundation starts from the previously researched plan. The completed skill will be used when its final handoff confirms readiness; no partial result will be called validated design research.

The user identified the DevDay Exchange Community Hackathon and supplied the Tidepath Family Alliance challenges. Challenge 6 is a useful demonstration story for Claudette and the bookkeeper; the user explicitly asked for an ambitious product that preserves the earlier vision rather than being limited by that challenge. The submission deadline remains unknown. The project includes the required MIT license; public repository publication is still pending. No submission, registration, bank transaction or deployment is part of this build request.

## Full product direction

FundThread connects documents, reimbursement decisions, restricted funds, settlement and reporting in one recoverable local workspace. The product direction includes receipt photos/scans, local extraction with source evidence, corrections and revision history, multiple fund allocations, configured grant rules, explicit external approvals, partial payments, privacy review with original-preserving redacted derivatives, and encrypted backup/restore. These capabilities are sequenced to produce an actual end-to-end tool. The first foundation milestone is not the ceiling of the product.

The experience skill is intended to improve navigation, acknowledgement, continuity, explanation and recovery throughout that whole product. A clean dashboard alone is not the design outcome. Tidepath's fictional workshop spending supplies safe demo data; counseling records and real family information are not required to demonstrate the product.

## First runnable scope

1. Create/unlock a local SQLCipher workspace, explicit lock and encrypted recovery snapshots.
2. Import PDF/JPEG/PNG files using a native picker or drag/drop; archive original bytes, hash and document metadata.
3. A receipt-first review desk with queue, page view, manual fields, local extraction candidates and clear saved/reviewed status.
4. Exact-money fund allocations, recorded external approval, partial payment and bank-reconciliation states.
5. Fund-usage view, record history, minimal report preview and safe CSV export. Receipt document sharing stays unavailable until reviewed derivative/redaction behavior is verified.
6. Local backup and restore-as-new, with wrong-key, integrity and original-hash checks.

## Architecture

- Tauri 2 / React / TypeScript / Vite; Rust owns storage and domain validation.
- A deliberately configured rusqlite + SQLCipher build. Startup verifies the actual cipher; plain SQLite is never an encryption fallback.
- Originals as BLOBs for this measured first implementation. No live cloud-synced vault.
- One active workspace; no cloud service, runtime document API, bank credentials or remote approvals.
- Organizational passphrase. A separately held copy is recovery material; no reset backdoor is implied.
- Narrow typed commands; no arbitrary SQL/filesystem/shell interface in the frontend.
- PDF.js and optional Tesseract.js assets bundled locally. OCR cannot mark a claim approved or paid.

## Interaction and visual starting hypotheses

Use a quiet warm-white document desk, deep teal navigation and restrained amber exceptions. Keep evidence central. Use tabular numerals, clear field origins, one primary next action and visible unsaved state. Preserve queue position when moving through claims. Approval, payment and reconciliation get separate labels. Motion communicates selection/progress only, and respects reduced motion. These are starting hypotheses for the forthcoming skill review, not user-tested findings.

## Build sequence and verification

| Stage | Deliverable | Verification |
| --- | --- | --- |
| 1 | Repository, pinned build dependencies, native encrypted domain core | Cargo compile; wrong key/plain SQLite rejection; exact-money and transaction tests |
| 2 | Original import, manual review, funds and payment records | Original hash survives source deletion/reopen; stale approvals and overpayment rejected |
| 3 | Polished desktop UI wired to the real backend | Complete create → import → review → approve → partially pay → report task; keyboard/error states |
| 4 | Local PDF/OCR assistance and export controls | No remote assets; candidate provenance; manual fallback; export preview matches written output |
| 5 | Backup/restore and packaged local build | Restore into a new workspace; verify originals/amounts; build artifact and launch checks |
| 6 | Apply the finished design skill and iterate | Preserve validated handoff, exercise proposed interactions, fix observed problems and rerun relevant checks |

Meaningful tests cover financial and recovery behavior. Fixture data is synthetic. Windows code/configuration can be prepared on this Mac, but a Windows install or clean-machine offline test will not be claimed without an actual run. Production signing, independent security review, nonprofit policy acceptance and a real receipt corpus remain separate release work.

## References

The earlier feasibility research is retained in the parent workspace’s research output. This application repository is self-contained through its [product brief](product-brief.md), [security design](../SECURITY.md), [verification notes](verification.md) and the staged plan here. Future capabilities are not reclassified as completed work.

## Implemented checkpoint — November 8, 2026

The source application, encrypted core, typed native boundary, fictional sample and actual-file temporary browser workspace now exist. The receipt workspace, original-preserving import, embedded text and local scan OCR, independent extraction/review histories, exact fund splits, revision-bound external approval, partial settlement/reconciliation, audience previews, persisted privacy mask plans, fresh image-only derivatives, and keyed verified backup/restore are implemented. A macOS arm64 app bundle has built. The implementation uses the actual SQLCipher 4.19.0 runtime rather than an encryption placeholder.

Meaningful verification currently includes 12 actual encrypted-core tests, three native export-safety tests, 12 frontend parsing, money, import-isolation and export-guard tests, and nine operated browser workflows against the standalone build with production security headers. The native UI could not be operated while the Mac was locked. Browser captures are labeled as browser captures; Windows installation, independent security assessment and real nonprofit usability are not claimed.

### Browser demo checkpoint

The browser accepts actual PDF/PNG/JPEG originals into a separate empty temporary session, performs embedded-text or local English OCR, keeps suggestions distinct from reviewed fields, supports inline fund creation without losing an unsaved receipt, and downloads actual reviewed CSV/PDF outputs. Exact byte duplicates select the existing receipt. Mixed import errors preserve successful files. Original storage is limited and in memory; browser reload is deliberate data loss, explained in the interface. Native encrypted storage remains a distinct build. Browser security headers, local OCR assets and privacy export were exercised together. No public deployment has been made.

### Next experience gate

The new Interactive Experience Research Team creation session has passed its specialist gates and 93 regression tests; its final live synthesis hit an adapter timeout and its creation session is repairing/rerunning that step at this checkpoint. Prepared inputs are in `docs/design-review/`: actual captures and neutral operated-flow notes. Once its creation session confirms completion, run the focused review mode against this build, preserve the validated handoff, implement the strongest changes and verify the affected behavior. No review report has been fabricated from partial source-session output.

### Next product layers

1. **Careful correction and richer evidence.** Add multiple supporting originals to a claim; missing/related-evidence states; authenticated decision integrations only when actually available; exact duplicate history and human-reviewed near-duplicate warnings. Preserve original bytes and source relationships. Verify source deletion/reopen, corrections and stale approvals with varied documents.
2. **Grant intelligence with provenance.** Attach grant agreements and configured policy sources, separate quoted rules from interpretations, allow reviewed exceptions and budget amendments with history. Add funder-specific report specifications and program context. Verify conflicting terms, date/category edge cases and no unsupported eligibility claims.
3. **Settlement completeness.** Add payment corrections/reversals, bank-statement import with explicit mapping/reconciliation, duplicate confirmation handling and grant recovery recorded separately from expense usage. Verify partial payments, refunds and no double-counting.
4. **Custody and reliable recovery.** Test suspend/idle locking with encrypted incomplete-draft recovery, passphrase rotation, backup retention, substitute-operator custody and clean-device recovery. Keep live-vault single-writer semantics. Independently review native IPC, file export destinations, dependencies and installers.
5. **Inclusive privacy and reporting.** Evaluate English, Spanish and Haitian Creole receipts with real consented corpora; add language packages only with local bundling and license/checksum control; measure OCR/PII misses. Add accessible redaction/export alternatives, structured recipient profiles, retention/deletion workflows and reviewed evidence packages.
6. **Release and hackathon evidence.** Complete native UI operation, Windows validation, signing/notarization, field usability tasks, artifact hashes and a truthful demo. Publish the isolated application repository publicly with its MIT license by the event deadline, once publication is requested. The deadline and registration/submission state remain unknown.

These layers preserve the full product ambition. The challenge is the demonstration context; it does not remove privacy, evidence custody, recovery or settlement from the product.

# Security design and current limits

FundThread separates native PostgreSQL custody from temporary browser sessions. Browser mode offers a fictional sample and actual receipt import into a separate temporary session. Both use in-memory records; browser mode is not an encrypted persistent archive.

## Protected records

Originals, reviewed facts, allocations, version-specific external approvals, payments, extraction artifacts, masks and activity are stored in PostgreSQL. Native Rust connects using `FUNDTHREAD_DATABASE_URL` from the process environment, never a WebView input or `VITE_` variable. The URL is held in a zeroizing string; copies in driver/runtime memory are not a secure-erasure guarantee. Connection errors suppress database messages that could contain failing private rows.

Non-loopback hosts require TLS (`sslmode=require`) with native certificate chain/hostname validation using OS trust. Local development may explicitly disable TLS. This has been tested only with a loopback PostgreSQL instance; remote/private-CA validation is a deployment check. Server disk encryption, restricted database roles, network policy, credential rotation and encrypted backup storage are administrator responsibilities. PostgreSQL does not retain SQLCipher's organizational-passphrase file encryption. Disconnect closes one native client; it is not authentication, credential revocation or an organizational lock.

Supported mutations lock the workspace row inside a PostgreSQL transaction before validation reads, coordinating all app connections. Money uses bounded integer cents; optimistic expected revisions prevent stale edits; approvals refer to saved review versions. Current flags/balances are derived. A paid claim cannot be edited before a future reversal workflow. Period/category/budget approval and outstanding-payment checks happen under the same lock as their writes. Foreign/unique/check constraints add structural protection. Direct SQL writers can bypass cross-row application rules; allow only trusted database administration. No application RBAC or multiuser operator authentication is provided.

Document SHA-256 checks detect changed archived bytes; they do not prove receipt authenticity. Database administrators or credential holders can change records and audit history. The history is not independent tamper-proof evidence. See [schema and concurrency design](docs/database-design.md).

## Application boundary

The webview has only named workspace commands, event handling and the close operation. It has no generic frontend SQL, filesystem, shell or network plugin. Native document paths originate in native dialogs or OS file drops; the frontend cannot supply arbitrary paths to a read command. Navigation is restricted to the application origin (and the local development origin in debug builds). The packaged CSP restricts connections/resources to local application/IPC resources, permits required local WebAssembly, and excludes objects and frames. This is defense in depth, not an independent assessment of the entire dependency chain.

The renderer processes untrusted documents. File and rendering bounds limit resource use but are not a malware scanner or parser sandbox. Keep PDF/OCR/image libraries patched, use synthetic files for hackathon demos, and evaluate a real receipt corpus before operational use.

## Temporary browser session

Choosing files while viewing the sample clears fictional data and starts an empty personal workspace. Document bytes, hashes, extracted text, review history and masks remain in JavaScript memory; they are not written to localStorage, IndexedDB or an application server. Reloading, closing or explicitly returning to the sample clears the session. An unload prompt is a best-effort browser reminder, not recovery. Pausing hides the workspace but does not encrypt memory or authenticate a returning operator. Browser process swapping, crash reporting, extensions and the device remain outside this storage boundary.

Imports check file signatures, allow PDF/PNG/JPEG only, limit batches to 20 files, enforce 20 MB/file, bound image headers to 24 megapixels and cap retained personal originals at 100 MB/session. These bounds reduce accidental resource exhaustion; they do not validate every parser behavior. Duplicate checks compare SHA-256 of original bytes. The browser store independently validates monetary/review/fund/payment rules; Rust remains the PostgreSQL desktop authority. The two implementations need parity verification as rules grow.

The production browser build restricts scripts, connections, workers and assets to the application origin, with local WebAssembly and required blob/data images. Its preview server supplies CSP on worker responses as well as the page. Hosting must preserve the supplied security headers and use HTTPS (or localhost for development); a meta tag alone cannot set worker response headers. There is no analytics, runtime document-processing request, service worker, or third-party asset fetch in this build. Same-origin application assets are downloaded from the host. A compromised host could serve different code; deployer custody and trusted updates remain material.

## Export and PII behavior

Minimal funder CSVs omit claimant, merchant, purpose, approval attribution and originals. Bookkeeper CSVs deliberately include identity-bearing fields and say so. Preview tokens bind report export to current content in both modes. Browser PDF export checks confirmation and the current document/review revision, and closing its review cancels the pending download. Cells that begin with spreadsheet formula syntax are prefixed defensively. Native exports reject destinations inside the owned application-state directory and filenames with the encrypted-vault extension. They write to a new owner-private temporary file on Unix, flush it, then rename it into place; they do not truncate an existing hard-linked original. Names, custom fund codes, dates and amounts can still be identifying; the application cannot promise anonymous output.

Receipt derivatives are rendered to page pixels, masks are burned into the image, and a fresh PDF contains those images. The original PDF's searchable text, attachments, annotations and metadata are not copied. The browser test checks both absent font resources and black pixels inside the selected mask. It does not prove that every private detail was selected. Automated suggestions cover limited patterns and known recipient tokens, and can miss names, identifiers, context and multilingual text. A visual review and new attestation are required each time. Saved mask plans do not mark a future export reviewed automatically. Rasterizing removes document accessibility/searchability, a tradeoff that needs an accessible export workflow in a later release.

Saved CSV/PDF copies have their own custody boundary. The destination, email channel, cloud-sync client, thumbnails, print spool and recipient policy are separate custody decisions. The app does not claim to control the OS or third-party software.

## Recovery

PostgreSQL recovery uses administrator-operated `pg_dump` / `pg_restore` through the `fundthread-db` helper, with a separate empty destination and transactional restore. The helper validates native source configuration, passes tool credentials through the child environment, restricts administration to an explicit single endpoint, and uses libpq `verify-full` for remote tools. Configure libpq CA trust separately from native OS trust. Dumps contain private originals and are **not encrypted**; Unix creation mode is 0600. Use encrypted backup storage and a practiced operating procedure. A listed archive is not a proven recovery; the verification command checks original hashes and current financial consistency after restore. Roles/passwords/ownership grants and production PITR are separate administrator work.

Legacy SQLCipher import is an explicit optional feature/CLI. It opens and verifies the source read-only, holds a stable read transaction, imports to an empty target transactionally, compares current records before commit, preserves available history/masks/payments/events and retains the original file. It does not automatically replace or delete a user's vault. Malformed/inconsistent source records fail closed instead of being silently omitted. See [operational instructions](docs/postgres-operations.md).

## Before real nonprofit data

Release work includes an independent code/dependency review, signed/notarized installers, a Windows test run, clean-device restore/offline checks, a tested auto-lock/suspend/draft-recovery policy, key rotation, role-based custody requirements, reversal workflows, multilingual/document quality evaluation, accessible redaction alternatives, retention/deletion policy, and a real-user usability study. Device compromise and a malicious authorized operator remain outside what application/database controls alone can solve.

For this local prototype, report issues privately to the repository owner through an appropriate channel once a public repository and disclosure contact are established. Do not post real receipts, passphrases or beneficiary details in a public issue.

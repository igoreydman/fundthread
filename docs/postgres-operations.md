# PostgreSQL setup, migration and recovery

FundThread now requires PostgreSQL for persistent desktop records. It does not provision a hosted service, automatically migrate or delete an existing SQLCipher file, or make the browser persistent. The native process reads `FUNDTHREAD_DATABASE_URL`; connection details never go to the renderer. `.env.example` documents the variable but is not loaded automatically.

## Configure a database

Use PostgreSQL 16 or newer and an explicitly named host, login and database. Create a dedicated database owned by a dedicated application role. The role needs schema creation for initialization and subsequent reads/writes on FundThread objects; it does not need cluster superuser rights. Do not use the test administrator account for real records.

For a locally administered installation, the administrator can run:

```sh
createuser --pwprompt fundthread
createdb --owner=fundthread fundthread
```

Inject the connection URL through your secret manager or native launch environment. For local development only, an example shape is `postgresql://fundthread:PASSWORD@127.0.0.1:5432/fundthread?sslmode=disable`. Percent-encode reserved characters in URL credentials, or use the Rust driver's libpq keyword format with correct quoting. Do not put credentials in source, command arguments, screenshots or shell history, and never use a `VITE_` variable for them. `.env*` and `*.dump` files are ignored by Git, with only the nonsecret example tracked.

For a remote host, use `sslmode=require`. The native Rust connector always validates the certificate chain and hostname using OS trust. Install a private CA in the OS trust store if needed; do not disable validation. The Rust driver accepts `require`, not libpq's `verify-full`, in this URL. The backup/restore helper translates it to libpq **verify-full** and requires libpq trust configured separately with `PGSSLROOTCERT` or `~/.postgresql/root.crt`. See [PostgreSQL SSL modes](https://www.postgresql.org/docs/current/libpq-ssl.html). Remote/private-CA connections have not been exercised by the local test suite.

The native app can initialize an empty database using the organization/operator form:

```sh
npm ci
npm run desktop
```

Alternatively, initialize from an environment configured with `FUNDTHREAD_ORGANIZATION` and `FUNDTHREAD_OPERATOR`:

```sh
cargo run -p fundthread-core --bin fundthread-db -- init
```

Reconnect opens the configured database; disconnect drops this app's connection. It is not a password lock, credential revocation or multiuser sign-in. One organization lives in each database. Use separate databases for separate organizations. Changing the URL requires restarting the native process. A Finder-launched macOS app may not inherit terminal environment variables; configure its launch environment rather than putting credentials into the UI.

## Import an existing SQLCipher workspace

Close the old FundThread process, preserve a backup of its `.fundthread` file and retain the organizational passphrase. Set the destination URL to a **new, empty PostgreSQL database**. The importer initializes that destination if necessary, then performs one transaction for the imported records. An existing initialized workspace must have no imported/fund/payment/history data.

Set `FUNDTHREAD_LEGACY_PASSPHRASE` using a secret mechanism without recording it in shell history. It is used only by the explicitly enabled importer:

```sh
cargo run -p fundthread-core --features legacy-sqlcipher --bin import-sqlcipher -- /absolute/path/to/source.fundthread
```

The importer:

1. Opens SQLCipher read-only, verifies its key, engine, schema, database integrity and original SHA-256 hashes, and holds a source read transaction. An adjacent lease file prevents simultaneous old-app use; the source directory must allow that lease.
2. Copies original IDs/bytes, funds and category rows, current reviews plus available saved review history, versioned allocations, current approval evidence, payments/reconciliation, all extraction runs, mask regions and **all** audit events, including older events beyond the 200-event UI window.
3. Preserves available review/run/event timestamps. Import/payment creation times did not exist in the source schema, so their destination times establish migration order rather than inventing historical times. Older approval versions/attribution absent from the source cannot be recovered; only retained current approval evidence migrates.
4. Verifies current financial consistency and the full application projection before committing. Mismatched cached OCR/history, missing funds, invalid dates/bounds, malformed historical review payloads or other discrepancies abort the import. No records are silently dropped or money rounded.
5. Retains the original SQLCipher file unchanged and resets destination event/run identity sequences. A failed import rolls back imported records; a newly initialized empty destination schema may remain for a corrected retry.

Verify afterward:

```sh
cargo run -p fundthread-core --bin fundthread-db -- verify
```

The command checks source-document hashes and current financial consistency and prints non-identifying record counts. Compare counts, sample originals, totals, privacy plans, histories and exports before changing your operating process. The default desktop build has no SQLCipher dependency or fallback; `rusqlite` and its encryption libraries are retained only behind `legacy-sqlcipher`.

## Back up and recover

Install `pg_dump` and `pg_restore` compatible with the server version on PATH. The helper accepts one explicit endpoint; failover host lists and `hostaddr` overrides are deliberately rejected for administration rather than risking a different backup destination. Credentials are passed through the child environment, not command arguments. OS administrators can inspect process environments; treat the host accordingly.

```sh
cargo run -p fundthread-core --bin fundthread-db -- backup /secure/location/fundthread-2026-11-08.dump
```

The helper verifies source hashes/financial consistency, then invokes `pg_dump` in custom format for the complete `fundthread` schema. It lists the resulting archive, flushes it and publishes a new filename without overwriting an existing copy. Unix dump files start at mode 0600. It does not claim the source precheck and dump are the same snapshot; `pg_dump` obtains its own consistent database snapshot. See [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html).

**The archive contains private original documents and is not encrypted.** Use administrator-managed encrypted backup storage/media and retention. PostgreSQL does not reproduce SQLCipher's organizational-passphrase file encryption automatically. Configure server storage encryption, login restrictions, network access and protected backup custody explicitly. A dump omits login roles, passwords and ownership/ACL grants; the administrator must create the recovery role/database and restore appropriate permissions. For production, scheduled backups/PITR, key management and recovery objectives belong in the deployment's database operating plan.

To recover, create a separate empty database and point `FUNDTHREAD_DATABASE_URL` at it, then:

```sh
cargo run -p fundthread-core --bin fundthread-db -- restore /secure/location/fundthread-2026-11-08.dump
cargo run -p fundthread-core --bin fundthread-db -- verify
```

Restore refuses a database with an existing `fundthread` schema or non-system relations, coordinates against app initialization with an advisory lock and uses `pg_restore --single-transaction --exit-on-error`, without `--clean`. A restore error rolls back that restore transaction. After a successful restore, it checks hashes/financial consistency. A failed post-restore verification leaves the separate destination available for diagnosis; it never switches the native app's URL or deletes the source. Restore only trusted administrator-produced archives: database archives can contain executable SQL.

Practice this round trip and compare records before directing operators to the recovered database. The tested local drill used synthetic receipts and a separate database on the same machine; this is not a clean-device, remote-service or disaster recovery certification.

## Run the database tests

The ignored integration suite needs a disposable **local** PostgreSQL administrator database and creates/drops only randomly named `fundthread_test_<uuid>` databases. Use trust only in an isolated loopback test cluster; the test fixture intentionally supports a local non-password connection. Add matching dump/restore binaries to PATH:

```sh
FUNDTHREAD_TEST_DATABASE_URL='host=127.0.0.1 port=5432 user=postgres dbname=postgres sslmode=disable' cargo test -p fundthread-core --features legacy-sqlcipher --test postgres -- --ignored
cargo test -p fundthread-core
cargo test -p fundthread --bin fundthread
cargo check -p fundthread
```

Tests cover actual PostgreSQL constraints and persistence, stale revisions and rollback, budget/date/category checks, independent extraction, reports, mask validation, concurrent approvals/payments/reviews/duplicates, legacy import preservation/rollback, and custom-format backup/recovery. The ignored marker prevents an ordinary unit run from unexpectedly creating databases; database validation must explicitly run this suite.

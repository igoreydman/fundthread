//! Native administration helper. Credentials come exclusively from environment.
use fundthread_core::{Result, Vault, postgres_tool};
use std::{env, fs, path::Path, process::Command};
use zeroize::Zeroizing;
fn database() -> Result<Zeroizing<String>> {
    Ok(Zeroizing::new(
        env::var("FUNDTHREAD_DATABASE_URL").map_err(|_| "Set FUNDTHREAD_DATABASE_URL.")?,
    ))
}
fn dump(url: &str, path: &Path) -> Result<()> {
    if path.exists() {
        return Err("Choose a new backup filename; existing copies are preserved.".into());
    }
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let temp = parent.join(format!(".fundthread-{}.dump", uuid::Uuid::new_v4()));
    let result = (|| {
        // Verify configuration/TLS and source hashes before opening an archive file.
        Vault::open(url)?.verify()?;
        let mut options = fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options
            .open(&temp)
            .map_err(|_| "Could not create the backup file.")?;
        let status = postgres_tool("pg_dump", url)?
            .args([
                "--format=custom",
                "--no-owner",
                "--no-privileges",
                "--schema=fundthread",
                "--no-password",
            ])
            .env("PGAPPNAME", "FundThread backup")
            .stdout(file)
            .stderr(std::process::Stdio::null())
            .status()
            .map_err(|_| "Install pg_dump matching the server major version and add it to PATH.")?;
        if !status.success() {
            return Err(
                "pg_dump failed; backup was not saved. Check database access and tool version."
                    .into(),
            );
        }
        let status = Command::new("pg_restore")
            .arg("--list")
            .arg(&temp)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map_err(|_| "Install pg_restore and add it to PATH.")?;
        if !status.success() {
            return Err("The backup archive could not be listed.".into());
        }
        fs::File::open(&temp)
            .and_then(|f| f.sync_all())
            .map_err(|_| "Could not flush the backup.")?;
        // Atomic no-clobber publication on the same filesystem.
        fs::hard_link(&temp, path)
            .map_err(|_| "Could not save the backup under a new filename.")?;
        Ok(())
    })();
    let _ = fs::remove_file(temp);
    result
}
fn run() -> Result<()> {
    let args: Vec<_> = env::args().collect();
    let url = database()?;
    match args.get(1).map(String::as_str) {
        Some("verify") => {
            let v = Vault::open(&url)?;
            v.verify()?;
            let s = v.snapshot()?;
            println!(
                "{}",
                serde_json::json!({"verified":true,"storageEngine":"PostgreSQL","funds":s.funds.len(),"expenses":s.expenses.len(),"payments":s.payments.len()})
            );
        }
        Some("init") => {
            let org =
                env::var("FUNDTHREAD_ORGANIZATION").map_err(|_| "Set FUNDTHREAD_ORGANIZATION.")?;
            let operator =
                env::var("FUNDTHREAD_OPERATOR").map_err(|_| "Set FUNDTHREAD_OPERATOR.")?;
            Vault::create(&url, &org, &operator)?;
            println!("Workspace initialized.");
        }
        Some("backup") => {
            let path = args.get(2).ok_or("Usage: fundthread-db backup NEW.dump")?;
            dump(&url, Path::new(path))?;
            println!(
                "Backup archive saved and listed. This dump is not encrypted. Verify recovery by restoring to a separate database."
            );
        }
        Some("restore") => {
            let path = args.get(2).ok_or(
                "Usage: fundthread-db restore BACKUP.dump (set URL to an empty, separate database)",
            )?;
            // Validate TLS policy through exists; no workspace/schema creation occurs.
            if Vault::exists(&url)? {
                return Err("Restore requires an empty, separate database.".into());
            }
            // The preflight check and restore must be atomic against other FundThread
            // initializers. A session advisory lock spans the pg_restore subprocess.
            // Do not use a second insecure client: the native connector enforces TLS.
            restore(&url, Path::new(path))?;
            Vault::open(&url)?.verify()?;
            println!(
                "Restore complete. Original hashes and financial consistency verified. Source database and archive retained."
            );
        }
        _ => {
            return Err(
                "Usage: fundthread-db init | verify | backup NEW.dump | restore BACKUP.dump".into(),
            );
        }
    }
    Ok(())
}
fn restore(url: &str, path: &Path) -> Result<()> {
    // Implemented by the core so the preflight connection uses its TLS policy.
    Vault::restore_archive(url, path)
}
fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

use fundthread_core::Vault;
use std::{env, path::Path};
use zeroize::Zeroizing;
fn run() -> Result<(), String> {
    let source=env::args().nth(1).ok_or("Usage: import-sqlcipher SOURCE.fundthread; set FUNDTHREAD_DATABASE_URL and FUNDTHREAD_LEGACY_PASSPHRASE.")?;
    let url = Zeroizing::new(
        env::var("FUNDTHREAD_DATABASE_URL").map_err(|_| "Set FUNDTHREAD_DATABASE_URL.")?,
    );
    let key = Zeroizing::new(
        env::var("FUNDTHREAD_LEGACY_PASSPHRASE")
            .map_err(|_| "Set FUNDTHREAD_LEGACY_PASSPHRASE without placing it in shell history.")?,
    );
    // Initialize an empty destination if necessary; import replaces placeholder metadata.
    let mut target = if Vault::exists(&url)? {
        Vault::open(&url)?
    } else {
        Vault::create(&url, "Pending legacy import", "Migration custodian")?
    };
    target.import_sqlcipher(Path::new(&source), &key)?;
    target.verify()?;
    println!("Import complete. Originals and financial records verified. Legacy source retained.");
    Ok(())
}
fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

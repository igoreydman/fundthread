# Windows validation gate

The initial Windows validation target is Windows 11 x64. The current development machine is an Apple Silicon Mac. Windows packaging configuration is prepared; no successful Windows build or installation is claimed.

On the intended Windows build machine, install the official Tauri 2 platform prerequisites and the Rust/MSVC toolchain. The vendored SQLCipher/OpenSSL toolchain also needs the appropriate native compiler/build prerequisites. Use the locked dependencies and check their Windows licenses rather than copying the Mac dependency inventory as proof.

```powershell
npm ci
cargo test -p fundthread-core
npm test
npm run desktop:build -- --config src-tauri/tauri.windows.conf.json
```

The Windows override selects an NSIS installer and includes the offline WebView2 installer. Validate the actual resulting installer on a clean supported Windows device without relying on the developer's caches. Record platform, architecture, OS/WebView version and artifact hash.

Acceptance: create an empty vault; import JPEG/PNG/PDF; delete or move the source and reopen the archived original; run OCR with networking unavailable; split a claim across two funds; reject an invalid category/date and over-budget approval; record partial settlement; preview and export both report profiles; burn a receipt mask into an image-only PDF; back up; close the app; restore with the correct passphrase into a new workspace; reject a wrong passphrase; compare record totals and original hashes. Verify a second process cannot open the same active vault, and test a native close with unsaved changes.

Signing, security scanning, an operating-system suspend/lock policy and clean-machine recovery remain release gates after the functional pass.

Installer behavior and offline WebView2 options follow the [official Tauri Windows installer guide](https://v2.tauri.app/distribute/windows-installer/). The platform override is merged according to the [configuration reference](https://v2.tauri.app/reference/config/#platform-specific-configuration).

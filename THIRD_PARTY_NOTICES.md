# Third-party notices

FundThread's own code is MIT licensed. Bundled dependencies, fonts, models and native libraries retain their upstream licenses. Copies of key runtime notices are in `public/licenses/`, with additional PDF font/CMap notices retained beside their copied support assets.

| Component | Role | Upstream license |
| --- | --- | --- |
| React / React DOM | Interface | MIT |
| Tauri / Rust ecosystem dependencies | Native shell and domain core | See package license inventory; Tauri uses MIT or Apache-2.0 |
| postgres / tokio-postgres / postgres-native-tls | PostgreSQL client and TLS adapter | MIT or Apache-2.0 |
| native-tls | Native TLS | MIT or Apache-2.0 |
| rusqlite (optional importer only) | Legacy database binding | MIT |
| SQLCipher Community (optional importer only) | Legacy encrypted database engine | BSD-style, retained in `LICENSE-sqlcipher` |
| OpenSSL | Legacy importer cryptography; TLS on some target platforms | Apache-2.0 |
| LibTomCrypt source notice | Retained with SQLCipher source distribution | Upstream notice in `LICENSE-libtomcrypt` |
| PDF.js | Local PDF parsing/rendering and support assets | Apache-2.0, plus retained font notices |
| pdf-lib | Fresh PDF generation | MIT |
| Tesseract.js / core | Local OCR worker and WebAssembly | Apache-2.0 |
| Tesseract `tessdata_fast` English model | Bundled language data | Apache-2.0 |
| Lucide | Code-native UI icons | ISC, with upstream portions/notice |

The model was obtained from `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata`. The checked-in file is verified by SHA-256 `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`. Updating it requires changing the checked checksum intentionally and retesting OCR.

Machine-readable inventories are in `docs/npm-dependency-licenses.json` and `docs/rust-dependency-licenses.json`. The default Rust inventory is filtered for the current aarch64 macOS build; the optional SQLCipher importer feature has a separate `docs/rust-legacy-importer-dependency-licenses.json` inventory; platform packaging needs its own dependency review. Inventory metadata does not replace retaining required upstream notices or reviewing redistribution obligations.

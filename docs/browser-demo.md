# FundThread browser demo

The browser demo is a functioning receipt-to-report workflow. A visitor can explore fictional Tidepath records or import actual PDF, JPEG and PNG files into a separate empty session. Uploaded originals are held in this tab's memory. The application does not upload receipt contents to a server or create an encrypted browser archive.

Without local setup, [open the public browser demo](https://fundthread.tarpit-ai.chatgpt.site) or [watch the video on YouTube](https://youtu.be/EU2lbzVB3sE). The hosted demo uses the same temporary browser workspace described above.

## Start and serve

Install Node.js 22.12+ and npm, then run these commands from the repository folder:

```sh
npm ci --cache .local/npm-cache
npm run build:browser
npm run preview:browser
```

Keep the terminal running and wait for Vite to report that the preview server is ready. Then open `http://127.0.0.1:1421/` on the same computer. This is a local server address; it only works after starting the preview. On subsequent runs, start it again with `npm run preview:browser`. If port 1421 is occupied, stop the other server or run `npm run preview:browser -- --port 1422` and use the address Vite prints.

Use a modern browser with WebAssembly, Web Workers, Canvas and Web Crypto. The tested browser is Chromium 154 on macOS arm64; other browser/device combinations still need their own run. The browser path avoids a native Windows installation, but Windows browser operation has not been tested on this Mac.

For public hosting, serve the contents of `browser-dist/` from an HTTPS site's root. Retain the `ocr/`, `pdf/`, `licenses/` and hashed `assets/` directories. Do not open `index.html` with a `file://` URL. The build uses root-relative asset paths; deploying under a subdirectory needs a separate base-path change and verification. There is no backend, secret, bank connection or runtime AI API key.

The generated `_headers` file contains the response policy for hosts supporting that format. Otherwise apply its headers through the host's configuration to **all responses, including OCR/PDF worker scripts**. `npm run preview:browser` supplies those headers locally. The HTML CSP meta tag is an additional page-level restriction; it cannot replace response headers on worker scripts. Do not remove `wasm-unsafe-eval`, which is needed for local OCR WebAssembly. Do not add general `unsafe-eval`, remote script origins, analytics or third-party widgets without re-evaluating private document handling.

The complete asset directory is roughly 54 MiB because it includes local PDF/OCR support and English language data. Only required modules/assets are fetched for a task; the browser does not eagerly download every engine variant. Once loaded, document processing is local, but a fresh offline start is not supported through a service worker or installed PWA. The public demo is hosted with Sites at https://fundthread.tarpit-ai.chatgpt.site.

## Inputs and outputs

| Step | Stakeholder supplies | Application returns |
| --- | --- | --- |
| Import | PDF, JPEG or PNG receipt; up to 20 files per batch, 20 MB/file, 24 MP/image and 100 MB retained originals/session | Original preview and SHA-256 identity; duplicate recognition; individual failure explanations without discarding successful files |
| Read | A readable scan/photo or PDF with embedded text | Editable merchant/date/total suggestions linked to source regions; human fields remain unchanged until accepted |
| Review | Verified receipt facts, person being reimbursed, purpose, category, eligible amount | Saved draft or reviewed revision; incomplete/invalid fields prevent completing the review |
| Funding | Fund name/code, opening budget, dates, configured categories and source notes; one or more exact allocations | Allocation balance and configured-rule warnings; approval checks grant dates/categories/budget |
| Decision | External approver attribution and evidence reference | Decision attached to the reviewed revision; it does not authenticate the approver |
| Settlement | External payment reference, date and amount; reconciliation action | Partial/full reimbursement and outstanding balance; no money is transferred |
| Report | Audience profile and a review of the preview | Downloaded CSV; minimal funder profile omits recipient, merchant, purpose and approval identities; money columns are labeled `_usd` and contain exact decimal dollars |
| Receipt sharing | Selected mask regions and a fresh visual confirmation of all pages | Downloaded image-only PDF with selected masks burned into its pixels; original bytes remain unchanged |

OCR and private-detail suggestions can miss information. English is the bundled OCR language. Multilingual receipts, poor photographs, handwriting, tax/tip variations and ambiguous totals need human correction and further evaluation. A minimal report can still be identifying through fund codes, dates and amounts.

## A short demonstration

1. Explore the fictional receipt desk; no account or organizational data is needed. For an actual-file trial, use [the synthetic PDF](examples/receipt-to-import.synthetic.pdf) or [synthetic photo](examples/receipt-photo.synthetic.png) retained from the passing browser tests. These are explicitly fictional test inputs, not receipts supplied by a nonprofit.
2. Choose **Import receipts** and select a synthetic receipt photo or PDF. Observe the separate temporary workspace and empty fund list.
3. Supported receipts read automatically, one at a time. Inspect the suggestions against the original; correct fields and enter recipient, purpose, category and eligible amount.
4. In **Funding**, create a fund inline and verify the allocation. Your unsaved receipt details remain in place.
5. Mark the receipt reviewed; record a fictional external approval reference. If useful, record part of a fictional payment and inspect the remainder owed.
6. Inspect daily approved expense in Analytics. Preview a minimal funder CSV/PDF, check the organization letterhead and omitted identity fields, then download after confirmation.
7. Open a receipt copy, mask selected private details, visually inspect each page and download a reviewed PDF. Compare with the unchanged original.
8. Returning to the sample asks before clearing the temporary session. Reloading also clears it. Neither action changes the source files on the device.

Use synthetic evidence for a public hackathon demonstration. A browser session is useful for evaluation; persistent desktop records now use organization-managed PostgreSQL, with database access, storage encryption and recovery handled by the administrator. See [PostgreSQL operations](postgres-operations.md). Production use still needs independent security review and nonprofit usability testing.

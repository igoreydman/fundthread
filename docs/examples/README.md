# Synthetic input and output examples

These examples are retained from the browser workflow checks. No real transaction, claimant, grant or approval is represented.

- `receipt-to-import.synthetic.pdf`: the actual synthetic PDF input used to exercise a personal temporary workspace. It includes a fictional recipient and an invalid example-domain email for privacy review.
- `receipt-photo.synthetic.png`: the actual generated photo-style input used for English OCR and manual mask export. It is a crisp test image, not evidence of accuracy on varied camera photographs.
- `funder-report.sample.csv`: approved fictional Tidepath allocation rows after a partial payment; claimant, merchant, purpose and approval identity fields omitted. Amount columns use integer cents.
- `reviewed-receipt.sample.pdf`: a fresh image-only receipt PDF with the fictional customer's name and email masked. Burned-in pixels and zero text fonts are checked during the workflow test. This does not establish complete automatic PII detection.

Browser records are temporary and held in memory. The desktop encrypted archive and recovery behavior are tested separately in Rust. Reloading or explicitly clearing the session does not alter these source files.

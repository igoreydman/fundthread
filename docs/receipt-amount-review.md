# Local receipt-amount correction

FundThread is being built with Codex. Runtime AI is not a product requirement. The unaccepted SDK experiment is preserved under `docs/proposals/paused-receipt-sdk/` as inactive text files; it is excluded from application code, builds, tests and dependency manifests. The earlier public-fact/story draft remains separately paused and unchanged.

The retained correction is deterministic: a printed GRAND TOTAL takes precedence over TOTAL, and either takes precedence over AMOUNT DUE. An amount due may describe a remaining balance rather than the original receipt total. Multiple amounts on one total-like line remain unresolved instead of choosing one silently. Subtotal, tax, tender and change lines do not replace a receipt total.

When different total-like values appear, the review desk displays a warning with buttons that reveal the corresponding source regions. Equal values produce no conflict notice. Clicking a source changes only the highlighted evidence. It does not fill a field, declare a payment or approve a claim. The existing suggestion still needs human acceptance. OCR, exact-money validation, allocations, external decisions/payments and report audiences remain under their existing controls.

Focused tests cover TOTAL and GRAND TOTAL followed by a lower amount due, subtotal/tax/tender/change exclusion, equal values, absent and ambiguous sources, and source-region mapping. A synthetic browser check clicks both source buttons, verifies distinct highlight positions and verifies that the reviewed total stays empty. This establishes the operated correction, not accuracy on every receipt format or native packaged UI behavior. Existing ZIPs predate this correction; no new package, commit, deployment or publication was made.

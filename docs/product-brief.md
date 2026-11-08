# FundThread: a durable thread from evidence to accountability

The product's useful unit is a traceable expense: what was paid for, what evidence exists, which funds can support it, who made the external decision, how much has actually been reimbursed, and what a particular audience should receive. Grant reporting is one consequence of this record, rather than another place to type the receipt again.

## Stakeholder inputs and outputs

| Person | Provides | Needs back |
| --- | --- | --- |
| Volunteer or staff claimant | Receipt photo/scan/PDF, date clarification, their recipient identifier, program purpose, missing evidence | A clear reviewed claim and amount still owed, with a reason for anything incomplete |
| Bookkeeper | Organizational context, reviewed receipt values, eligible amount, fund split, external decision/payment references, reconciliation check | Preserved originals, exact allocations and settlement balances, revision history, detailed accounting export, recoverable archive |
| Program manager | Program/activity context and eligibility clarification | An understandable queue of what needs attention and a path back to the original evidence |
| Director or external approver | A decision through the organization's existing process and evidence reference | The exact reviewed revision and grant checks they are deciding on; attribution does not authenticate them inside this single-operator app |
| Funder | Agreed reporting specification, applicable grant rules, approved audience/recipient | Only the allocation rows and evidence derivative authorized for that recipient, previewed before sharing |
| Records custodian | Device/storage choices, organizational passphrase custody, backup destination and recovery procedure | Verified encrypted snapshots and a tested way for a substitute operator to recover |

## A working demo story

Tidepath's volunteer buys $184.75 in workshop supplies. The bookkeeper reviews the original, applies source-linked local suggestions individually, and splits $140.00 to Safe Futures workshops and $44.75 to Community care. The director's external decision is recorded against that reviewed revision. A $100.00 bank payment leaves $84.75 outstanding without consuming the grant budget a second time. A funder report omits claimant/purpose/approval identity fields. If a receipt copy is necessary, the bookkeeper masks contact details and unnecessary context, reviews the image-only derivative, and keeps the original restricted. Recovery restores the complete thread into a new local workspace.

The synthetic sample also includes printing awaiting approval, a partially settled travel claim, a reconciled expense and an unreviewed scanned receipt. These are actual interactive states, not decorative dashboard values.

## What makes it polished

The receipt remains next to the values it supports. Reading a document produces suggestions, not unexplained certainty. Selecting a source-linked field reveals the evidence. The review separates receipt facts from organizational context. Unsaved edits are visible and navigation offers save/discard/stay. Approval names the current revision. Payments, reconciliation and grant usage describe different concepts. Report audiences show which identity fields they include. Privacy selections bring the relevant region into view and remain separate from the original. Recovery is an operational task with a verified result.

The broader vision adds evidence bundles, related/near-duplicate receipt checks, grant agreement provenance, configurable organization rules, exceptions and reversals, accessible audience-specific evidence packages, multilingual extraction, stronger custody controls, and policy-aware assistance that never invents eligibility or exposes raw private documents by default. These are product directions with separate verification gates; the current implementation does not advertise them as complete.

## Evidence still needed

Observed browser flows and encrypted-core tests establish implemented behavior. They do not establish nonprofit staff comprehension, OCR accuracy across real receipts, complete PII detection, Windows reliability, operational compliance or a production security guarantee. The next field study should ask a bookkeeper to complete a split-funded claim, correct a mistake, prepare a funder export and restore a backup without coaching. Measure wrong assumptions and recovery failures as well as completion time.

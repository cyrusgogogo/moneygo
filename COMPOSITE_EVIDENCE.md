# Composite evidence model contract

Model scope: roadmap 16–18, explicit user-confirmed personal versus funding evidence. No UI acceptance, real data, network, publishing, or source format compatibility claim.

## Public API

- R.previewComposite(state, { name, personalIds, fundingIds, paidCents, grossCents, discountCents }) returns a deeply frozen opaque review object containing action, record, before/after financial totals, affected months, existing snapshot comparisons and warnings. before/after and each monthly total include cash, personal, accountBalances (all-recorded scope), accountFlows and accountFlowsByAccount (flow scope follows the selected month). Both role arrays are explicitly selected. Every nullable price field must be provided as integer cents or null.
- R.createComposite(state, preview, { confirmed: true, reason }) validates the exact original full state against the opaque ticket, validates the proposed journal and all financial dependencies again, then returns a new state. Copied, forged, stale or reused tickets are rejected.
- R.previewCompositeRemoval(state, compositeId) prepares a full-state-bound removal review; R.unlinkComposite(state, preview, { confirmed: true, reason }) commits. Direct R.unlink of kind composite is rejected. Removal requires all refunds, claims, settlements and refund plans attached to members to be removed first.
- R.compositeProof(value) validates a self-contained captured record and returns a normalized copy. Records contain id, createdAt, name, personalIds, fundingIds, paidCents, grossCents, discountCents, reason, signatures. Each signature is {id,type,date,amountCents,accountId,toAccountId:null}.
- R.compositeCandidates(state, {fundingIds,candidatePersonalIds}, options) performs a bounded, explicitly scoped subset search. It never guesses authority, applies associations, fills differences or adds transactions. Results retain target, sum, difference, reasons and resource-limit disclosure.

## Invariants

Each role set contains 1–20 unique canonical active expense IDs. Shared IDs between role sets are legal. The union contains <=40 IDs, each captured exactly once; both role sums exactly equal positive paidCents. All source financial fields are locked while referenced. Gross/discount unknown is null, not zero; known gross >= paid, and both known implies gross - discount = paid. No value is inferred into an absent field.

Personal impact, refund and claim capacity follow personalIds at each original date; external-record cash, account balances and actual movement legs follow fundingIds at each original date. Shared IDs count once in each view. One composite identifies one user-confirmed purchase event without synthesizing a ledger transaction. Aggregate funding100 plus personal30/70 contributes100 to each view, never200. Wallet30+bank60 in both sets contributes90, and gross100/discount10 never becomes income.

Native transfers, paired transfer legs, duplicate shadows and another composite's members are ineligible. Existing canonical duplicate primaries remain possible and preserve all attached shadow locks. Funding-only rows cannot receive refunds, claims or refund plans. Existing fee or installment purchase references exclude every composite member, in both operation orders. Refund/claim allocations on personal members retain original per-record caps; group refunds are not implicitly redistributed.

Audit replay rejects transient role/overlap conflicts and unsafe removal, not just invalid final records. Preview captures the full state because raw edits need not increment Relations revision. Finite groups, members, journal capture cells and candidate nodes bound work and backup growth.

## Compatibility and reports

Outer ledger/backup versions4/5/6 remain. Relations VERSION/default2 and legacy1→2 migration remain until first composite, which promotes to COMPOSITE_VERSION3. Version2 must not contain composite fields/history/snapshot proofs. Organizer uses the same lazy2→3 rule on composite-bearing close proof. Old readers reject new inner3; legacy closes and audit rows remain byte-for-byte.

Snapshots use a distinct optional basis.composites full proof list, never legacy duplicate exclusions. Every due funding member for the relevant account must occur with exact signature in the basis; personal-only members must not occur. Proof changes are detectable even when totals stay equal. Difference candidates use actual funding authority.

New frozen closes carry compositeProofs once per close and rows reference compositeId. Every in-month union member is required for all-month closes; selected closes retain explicitly partial semantics and full proof. Cross-month proof is self-contained and survives later unlink/source edits. R.drilldown.accountFlows movements excludes personal-only rows; Obligations roleAwareActuals and unbilled credit evidence must use that funding authority. Legacy R.cash remains all-account external-record flows, never a claim of liquid cash.


Candidate API options: maxResults (default20, max100), maxMembers (default6, max20), maxNodes (default10000, max10000). Explicit candidatePersonalIds max24. Results contain fundingIds, candidatePersonalIds, targetCents, candidates, exploredNodes, searchComplete, truncated, limits and reasons. Each candidate contains personalIds, fundingIds, sumCents, targetCents, differenceCents, exactMatch, confirmed:false, reasons and warnings. Search completion is scoped to the explicitly chosen pool and disclosed membership limit; it is never a completeness claim about the ledger.

Implementation now also validates historical shared income/refund/settlement capacity and claim/refund-plan receipt totals at every audit event, including updates and records removed later. New inner3 data rejects inconsistent downgraded raw-state outer versions as well as backup envelopes. Both source and snapshot/group identifiers remain collision-checked.

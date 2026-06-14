# Three-Way Match Engine

Backend service for uploading PO, GRN, and Invoice PDFs, extracting structured
data via the Gemini API, storing it in MongoDB, and performing item-level
three-way matching.

## Setup

```bash
npm install
cp .env.example .env   # then fill in MONGO_URI and GEMINI_API_KEY
npm run dev            # or: npm start
```

## Approach

Each document type (PO, GRN, Invoice) is parsed independently via Gemini using
a type-specific prompt that forces JSON-only output with normalized
(`YYYY-MM-DD`) dates. Parsed data is stored in its own Mongoose collection,
keyed by `poNumber`. A separate `MatchResult` collection holds one row per
`poNumber`, which is fully recomputed (not incrementally patched) every time
any related document is uploaded.

## Data Model

- **PO**: `poNumber` (indexed, not unique - duplicates are detected and
  flagged rather than rejected), `poDate`, `vendorName`, `items[]`
- **GRN**: `grnNumber`, `poNumber` (indexed, many per PO), `grnDate`, `items[]`
  with `receivedQuantity`
- **Invoice**: `invoiceNumber`, `poNumber` (indexed, many per PO),
  `invoiceDate`, `items[]` with `quantity`
- **MatchResult**: one document per `poNumber`, holding `status`, `reasons[]`,
  per-item `itemDetails[]`, and references to all linked documents

All three document schemas store `rawExtraction` (Gemini's full response) for
debugging and for producing sample-output deliverables.

## Item Matching Key

`itemCode` is **not** a reliable cross-document key in this dataset: PO and
GRN share vendor SKU codes (e.g. `11423`), but the Invoice uses a different
internal code scheme (e.g. `FG-P-F-0503`) for the same physical item.

Instead, every item gets a computed `itemKey`: the item description,
lowercased, with parenthetical notes removed, `X.0` collapsed to `X`, a few
unit synonyms normalized (`pieces` -> `pcs`, etc.), and all
whitespace/punctuation stripped. This makes `"450.0 g"` and `"450g (5%)"`
resolve to the same key.

**Known limitation**: this does not bridge wording differences such as "Veg"
vs "Vegetable" between documents. If real extractions don't align well, the
next step would be a fuzzy fallback (e.g. word-overlap/Jaccard similarity
above a threshold) for items that don't find an exact `itemKey` match -
documented in "What I'd improve" below.

## Matching Logic

For each `poNumber`, on every upload:

1. Re-fetch the PO (most recent if duplicates exist - flagged via
   `duplicate_po`), all GRNs, and all Invoices for that `poNumber`.
2. If no PO exists -> `insufficient_documents` (`po_missing`).
3. If PO exists but no GRN and no Invoice -> `insufficient_documents`.
4. Otherwise, for each PO item, sum GRN `receivedQuantity` and Invoice
   `quantity` across all related documents by `itemKey`, and check:
   - `grn_qty_exceeds_po_qty`
   - `invoice_qty_exceeds_grn_qty`
   - `invoice_qty_exceeds_po_qty`
5. Any GRN/Invoice item with no matching PO item -> `item_missing_in_po`.
6. Any Invoice dated after the PO date -> `invoice_date_after_po_date`.
7. Status:
   - any reason present -> `mismatch`
   - no reasons, PO + GRN + Invoice all present -> `matched`
   - no reasons, but GRN or Invoice still missing -> `partially_matched`

## Out-of-Order Uploads

Every upload (regardless of type) triggers a full recompute of the
`MatchResult` for its `poNumber`, reading fresh from the DB rather than
patching prior state. So if an Invoice arrives before its PO, the result is
simply `insufficient_documents` (`po_missing`); once the PO arrives, the next
recompute finds everything and resolves normally. `GET /match/:poNumber` also
recomputes on read, so it always returns the latest state even for a
`poNumber` queried for the first time.

## Assumptions

- One PO per `poNumber` is expected; duplicates are flagged (`duplicate_po`)
  rather than rejected, using the most recently uploaded PO for comparisons.
- Gemini is instructed to normalize all dates to `YYYY-MM-DD`.
- `itemCode` is stored when available but not used as the join key (see above).

## Tradeoffs / What I'd Improve

- Add fuzzy description matching (word-overlap or edit-distance threshold) as
  a fallback when exact `itemKey` matching fails.
- Add a retry-with-correction loop for malformed Gemini JSON responses.
- Add authentication and per-vendor/tenant scoping.
- Add pagination for `GET /documents` style listing endpoints (not currently
  required by the spec).

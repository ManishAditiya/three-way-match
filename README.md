# Three-Way Match Engine

Backend service for uploading PO, GRN, and Invoice PDFs, extracting structured
data via the Gemini API, storing it in MongoDB, and performing item-level
three-way matching.

## Prerequisites

- Node.js 16+
- MongoDB (local or remote)
- Google Gemini API key

## Setup

```bash
# Clone repository
git clone https://github.com/ManishAditiya/three-way-match.git
cd three-way-match

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Configure .env:
# PORT=5000
# MONGO_URI=mongodb://localhost:27017/three_way_match
# GEMINI_API_KEY=your_gemini_api_key_here
# GEMINI_MODEL=gemini-2.0-flash

# Run server (development with hot-reload)
npm run dev

# Or run in production
npm start
```

Server will be running at `http://localhost:5000`

## API Endpoints

### 1. Health Check
```
GET /
```
Returns: `{ status: 'ok', service: 'three-way-match-engine' }`

### 2. Upload Document
```
POST /documents/upload
Content-Type: multipart/form-data

Parameters:
- file: PDF file to upload
- documentType: 'po' | 'grn' | 'invoice'
```

**Response (201):**
```json
{
  "message": "PO uploaded and parsed successfully",
  "document": {
    "_id": "507f1f77bcf86cd799439011",
    "poNumber": "CI4PO05788",
    "poDate": "2026-03-17",
    "vendorName": "ABC Suppliers Ltd",
    "items": [
      {
        "itemCode": "11423",
        "description": "450g Premium Item",
        "quantity": 100,
        "itemKey": "450gpremiumitem"
      }
    ],
    "sourceFile": "PO.pdf",
    "rawExtraction": "...",
    "parsingStatus": "success"
  },
  "matchResult": {
    "_id": "507f1f77bcf86cd799439012",
    "poNumber": "CI4PO05788",
    "status": "insufficient_documents",
    "reasons": ["grn_and_invoice_missing"],
    "itemDetails": [],
    "linkedDocuments": {
      "po": "507f1f77bcf86cd799439011",
      "grns": [],
      "invoices": []
    }
  }
}
```

**Error (422 - Validation):**
```json
{
  "error": "Extracted data failed validation: Missing required field: poNumber",
  "rawExtraction": { ... }
}
```

**Error (502 - Gemini):**
```json
{
  "error": "Gemini parsing failed: API rate limit exceeded"
}
```

### 3. Get Document by ID
```
GET /documents/:id
```

**Response (200):**
```json
{
  "documentType": "po",
  "document": {
    "_id": "507f1f77bcf86cd799439011",
    "poNumber": "CI4PO05788",
    ...
  }
}
```

### 4. Get Match Result by PO Number
```
GET /match/:poNumber
```

**Response (200) - Matched:**
```json
{
  "_id": "507f1f77bcf86cd799439013",
  "poNumber": "CI4PO05788",
  "status": "matched",
  "reasons": [],
  "itemDetails": [
    {
      "itemKey": "450gpremiumitem",
      "description": "450g Premium Item",
      "poQty": 100,
      "grnQty": 100,
      "invoiceQty": 100,
      "issues": []
    }
  ],
  "linkedDocuments": {
    "po": "507f1f77bcf86cd799439011",
    "grns": ["507f1f77bcf86cd799439012"],
    "invoices": ["507f1f77bcf86cd799439013"]
  },
  "lastComputedAt": "2026-03-20T10:30:45.123Z"
}
```

**Response (200) - Mismatch:**
```json
{
  "poNumber": "CI4PO05788",
  "status": "mismatch",
  "reasons": ["invoice_qty_exceeds_po_qty", "invoice_date_after_po_date"],
  "itemDetails": [
    {
      "itemKey": "450gpremiumitem",
      "description": "450g Premium Item",
      "poQty": 100,
      "grnQty": 110,
      "invoiceQty": 105,
      "issues": ["grn_qty_exceeds_po_qty", "invoice_qty_exceeds_grn_qty"]
    }
  ],
  "linkedDocuments": { ... }
}
```

**Response (200) - Partially Matched:**
```json
{
  "poNumber": "CI4PO05788",
  "status": "partially_matched",
  "reasons": ["invoice_missing"],
  "itemDetails": [ ... ],
  "linkedDocuments": {
    "po": "507f1f77bcf86cd799439011",
    "grns": ["507f1f77bcf86cd799439012"],
    "invoices": []
  }
}
```

**Response (200) - Insufficient Documents:**
```json
{
  "poNumber": "CI4PO05788",
  "status": "insufficient_documents",
  "reasons": ["po_missing"],
  "itemDetails": [],
  "linkedDocuments": {
    "po": null,
    "grns": ["507f1f77bcf86cd799439012"],
    "invoices": []
  }
}
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

## Example Workflow

```bash
# 1. Upload Invoice first (Invoice for PO-123 arrives early)
curl -X POST http://localhost:5000/documents/upload \
  -F "file=@invoice.pdf" \
  -F "documentType=invoice"
# Response: status = "insufficient_documents" (po_missing)

# 2. Upload GRN (GRN for PO-123 arrives)
curl -X POST http://localhost:5000/documents/upload \
  -F "file=@grn.pdf" \
  -F "documentType=grn"
# Response: status = "insufficient_documents" (po_missing)

# 3. Upload PO (Finally PO-123 arrives)
curl -X POST http://localhost:5000/documents/upload \
  -F "file=@po.pdf" \
  -F "documentType=po"
# Response: status = "matched" or "mismatch" (depending on quantities)

# 4. Query final result
curl http://localhost:5000/match/PO-123
# Response: Complete match result with all details
```

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
- Add webhook notifications when match status changes.
- Add bulk upload endpoints for multiple documents at once.

## Testing with Postman

A Postman collection is provided in `postman_collection.json`. Import it into
Postman and configure the `baseUrl` variable to `http://localhost:5000`.

## Project Structure

```
three-way-match/
├── src/
│   ├── app.js                 # Express app setup
│   ├── server.js              # Server entry point
│   ├── config/
│   │   └── db.js              # MongoDB connection
│   ├── models/
│   │   ├── P0.js              # PO schema
│   │   ├── GRN.js             # GRN schema
│   │   ├── Invoice.js         # Invoice schema
│   │   └── MatchResult.js     # Match result schema
│   ├── controllers/
│   │   ├── documentController.js  # Document upload & retrieval
│   │   └── matchController.js     # Match result retrieval
│   ├── services/
│   │   ├── geminiService.js   # Gemini API integration
│   │   └── matchingService.js # Three-way match logic
│   ├── routes/
│   │   ├── documentRoutes.js  # Document endpoints
│   │   └── matchRoutes.js     # Match endpoints
│   ├── middleware/
│   │   └── upload.js          # Multer file upload config
│   └── utils/
│       └── itemKey.js         # Item key normalization
├── package.json
├── .env.example
├── postman_collection.json
└── README.md
```

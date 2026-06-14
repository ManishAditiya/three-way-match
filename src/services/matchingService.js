const PO = require('../models/PO');
const GRN = require('../models/GRN');
const Invoice = require('../models/Invoice');
const MatchResult = require('../models/MatchResult');

/**
 * Sums a quantity field across all items, grouped by itemKey, across
 * an arbitrary number of documents (e.g. multiple GRNs for one PO).
 */
function sumQuantitiesByKey(documents, qtyField) {
  const totals = {};
  for (const doc of documents) {
    for (const item of doc.items) {
      const key = item.itemKey;
      totals[key] = (totals[key] || 0) + (item[qtyField] || 0);
    }
  }
  return totals;
}

/** Collects every distinct itemKey present across the given document arrays. */
function collectAllKeys(...docArrays) {
  const keys = new Set();
  for (const docs of docArrays) {
    for (const doc of docs) {
      for (const item of doc.items) {
        keys.add(item.itemKey);
      }
    }
  }
  return keys;
}

/** Finds a human-readable description for an itemKey by scanning given doc arrays. */
function getDescriptionForKey(key, ...docArrays) {
  for (const docs of docArrays) {
    for (const doc of docs) {
      const item = doc.items.find((i) => i.itemKey === key);
      if (item) return item.description;
    }
  }
  return key;
}

/**
 * Recomputes the full match state for a given poNumber from scratch by
 * re-reading PO, all GRNs, and all Invoices linked to it. This is what
 * makes out-of-order uploads work: every upload (regardless of type)
 * triggers this, and it always reflects the current state of the DB -
 * never an incremental patch on top of a possibly-stale previous result.
 */
async function runMatch(poNumber) {
  const normalizedPoNumber = poNumber.trim().toUpperCase();

  const allPOs = await PO.find({ poNumber: normalizedPoNumber }).sort({ createdAt: -1 });
  const grns = await GRN.find({ poNumber: normalizedPoNumber });
  const invoices = await Invoice.find({ poNumber: normalizedPoNumber });

  // --- No PO uploaded yet for this poNumber ---
  if (allPOs.length === 0) {
    return upsertResult(normalizedPoNumber, {
      status: 'insufficient_documents',
      reasons: ['po_missing'],
      itemDetails: [],
      linkedDocuments: {
        po: null,
        grns: grns.map((g) => g._id),
        invoices: invoices.map((i) => i._id),
      },
    });
  }

  const reasons = [];

  // --- Duplicate PO: more than one PO uploaded for the same poNumber ---
  // The assignment requires "only 1 PO" per poNumber. We don't reject the
  // upload outright (that would break the upload API); instead we flag it
  // and use the most recently uploaded PO as authoritative for comparisons.
  if (allPOs.length > 1) {
    reasons.push('duplicate_po');
  }
  const po = allPOs[0];

  // --- PO exists, but nothing to match against yet ---
  if (grns.length === 0 && invoices.length === 0) {
    return upsertResult(normalizedPoNumber, {
      status: 'insufficient_documents',
      reasons: [...reasons, 'grn_and_invoice_missing'],
      itemDetails: [],
      linkedDocuments: { po: po._id, grns: [], invoices: [] },
    });
  }

  const grnQtyByKey = sumQuantitiesByKey(grns, 'receivedQuantity');
  const invQtyByKey = sumQuantitiesByKey(invoices, 'quantity');

  // --- Item-level comparison, anchored on PO line items ---
  const itemDetails = po.items.map((poItem) => {
    const key = poItem.itemKey;
    const grnQty = grnQtyByKey[key] || 0;
    const invoiceQty = invQtyByKey[key] || 0;
    const issues = [];

    if (grnQty > poItem.quantity) issues.push('grn_qty_exceeds_po_qty');
    if (invoiceQty > grnQty) issues.push('invoice_qty_exceeds_grn_qty');
    if (invoiceQty > poItem.quantity) issues.push('invoice_qty_exceeds_po_qty');

    return {
      itemKey: key,
      description: poItem.description,
      poQty: poItem.quantity,
      grnQty,
      invoiceQty,
      issues,
    };
  });

  // --- Items that appear in GRN/Invoice but have no corresponding PO line ---
  const poKeys = new Set(po.items.map((i) => i.itemKey));
  const otherKeys = collectAllKeys(grns, invoices);
  for (const key of otherKeys) {
    if (!poKeys.has(key)) {
      itemDetails.push({
        itemKey: key,
        description: getDescriptionForKey(key, grns, invoices),
        poQty: 0,
        grnQty: grnQtyByKey[key] || 0,
        invoiceQty: invQtyByKey[key] || 0,
        issues: ['item_missing_in_po'],
      });
    }
  }

  // --- Document-level date check: invoice must not be dated after the PO ---
  for (const inv of invoices) {
    if (inv.invoiceDate > po.poDate) {
      reasons.push('invoice_date_after_po_date');
      break; // one flag at PO level is enough, no need to repeat per invoice
    }
  }

  // --- Roll item-level issues up into the top-level reasons list (deduped) ---
  const itemLevelReasons = new Set();
  for (const detail of itemDetails) {
    detail.issues.forEach((issue) => itemLevelReasons.add(issue));
  }
  const allReasons = [...new Set([...reasons, ...itemLevelReasons])];

  // --- Overall status ---
  // mismatch        -> any rule violation found, regardless of completeness
  // matched         -> PO + at least one GRN + at least one Invoice, no issues
  // partially_matched -> no issues, but GRN or Invoice side is still missing
  let status;
  if (allReasons.length > 0) {
    status = 'mismatch';
  } else if (grns.length > 0 && invoices.length > 0) {
    status = 'matched';
  } else {
    status = 'partially_matched';
  }

  return upsertResult(normalizedPoNumber, {
    status,
    reasons: allReasons,
    itemDetails,
    linkedDocuments: {
      po: po._id,
      grns: grns.map((g) => g._id),
      invoices: invoices.map((i) => i._id),
    },
  });
}

/** Upserts the single MatchResult row for a poNumber - "latest state" by construction. */
async function upsertResult(poNumber, data) {
  return MatchResult.findOneAndUpdate(
    { poNumber },
    { ...data, poNumber, lastComputedAt: new Date() },
    { upsert: true, new: true }
  );
}

module.exports = { runMatch };

const fs = require('fs');
const mongoose = require('mongoose');

const PO = require('../models/PO');
const GRN = require('../models/GRN');
const Invoice = require('../models/Invoice');
const { parseDocument } = require('../services/geminiService');
const { runMatch } = require('../services/matchingService');

const MODELS = { po: PO, grn: GRN, invoice: Invoice };

// Fields Gemini's JSON output must contain for each document type
const REQUIRED_FIELDS = {
  po: ['poNumber', 'poDate', 'vendorName', 'items'],
  grn: ['grnNumber', 'poNumber', 'grnDate', 'items'],
  invoice: ['invoiceNumber', 'poNumber', 'invoiceDate', 'items'],
};

function validateExtraction(documentType, data) {
  const required = REQUIRED_FIELDS[documentType];
  for (const field of required) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      return `Missing required field: ${field}`;
    }
  }
  if (!Array.isArray(data.items) || data.items.length === 0) {
    return 'items must be a non-empty array';
  }
  return null;
}

/**
 * POST /documents/upload
 * Body (multipart/form-data): file=<PDF>, documentType=po|grn|invoice
 *
 * Flow: save upload -> parse with Gemini -> validate -> persist ->
 * recompute match for the linked poNumber -> return both.
 */
exports.uploadDocument = async (req, res) => {
  try {
    const { documentType } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'file is required' });
    }
    if (!documentType || !MODELS[documentType]) {
      return res.status(400).json({ error: 'documentType must be one of: po, grn, invoice' });
    }

    const Model = MODELS[documentType];
    const filePath = req.file.path;

    let parsed, raw;
    try {
      ({ parsed, raw } = await parseDocument(filePath, documentType));
    } catch (err) {
      return res.status(502).json({ error: `Gemini parsing failed: ${err.message}` });
    }

    const validationError = validateExtraction(documentType, parsed);
    if (validationError) {
      return res.status(422).json({
        error: `Extracted data failed validation: ${validationError}`,
        rawExtraction: parsed,
      });
    }

    // Normalize the join key so trailing whitespace / casing differences
    // between documents never cause a missed match.
    parsed.poNumber = String(parsed.poNumber).trim().toUpperCase();

    const docPayload = {
      ...parsed,
      sourceFile: req.file.originalname,
      rawExtraction: raw,
      parsingStatus: 'success',
    };

    const savedDoc = await Model.create(docPayload);

    // Recompute the match state for this poNumber. This is the single
    // hook that makes out-of-order uploads work - every upload, of any
    // type, triggers a full recompute from the current DB state.
    const matchResult = await runMatch(savedDoc.poNumber);

    return res.status(201).json({
      message: `${documentType.toUpperCase()} uploaded and parsed successfully`,
      document: savedDoc,
      matchResult,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  } finally {
    // Clean up the temp upload regardless of success/failure
    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }
  }
};

/**
 * GET /documents/:id
 * Returns the stored parsed document, trying PO/GRN/Invoice collections in turn.
 */
exports.getDocumentById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid document id' });
    }

    for (const [type, Model] of Object.entries(MODELS)) {
      const doc = await Model.findById(id);
      if (doc) {
        return res.json({ documentType: type, document: doc });
      }
    }

    return res.status(404).json({ error: 'Document not found' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

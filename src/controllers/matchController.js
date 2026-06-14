const MatchResult = require('../models/MatchResult');

/**
 * GET /match/:poNumber
 * Returns the three-way match result for a given poNumber.
 * If no documents exist for that poNumber yet, returns 404.
 */
exports.getMatchByPoNumber = async (req, res) => {
  try {
    const { poNumber } = req.params;

    if (!poNumber || !poNumber.trim()) {
      return res.status(400).json({ error: 'poNumber is required' });
    }

    const normalizedPoNumber = poNumber.trim().toUpperCase();

    const matchResult = await MatchResult.findOne({ poNumber: normalizedPoNumber }).populate('linkedDocuments.po linkedDocuments.grns linkedDocuments.invoices');

    if (!matchResult) {
      return res.status(404).json({ error: `No match result found for poNumber: ${normalizedPoNumber}` });
    }

    return res.json(matchResult);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
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

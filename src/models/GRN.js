const mongoose = require('mongoose');
const { normalizeItemKey } = require('../utils/itemKey');

const grnItemSchema = new mongoose.Schema(
  {
    itemCode: { type: String, default: null },
    description: { type: String, required: true },
    receivedQuantity: { type: Number, required: true, min: 0 },
    itemKey: { type: String },
  },
  { _id: false }
);

const grnSchema = new mongoose.Schema(
  {
    grnNumber: { type: String, required: true, trim: true },
    poNumber: { type: String, required: true, trim: true, uppercase: true, index: true },
    grnDate: { type: Date, required: true },
    items: {
      type: [grnItemSchema],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'GRN must have at least one item',
      },
    },

    sourceFile: { type: String, default: null },
    documentType: { type: String, default: 'grn', immutable: true },
    rawExtraction: { type: mongoose.Schema.Types.Mixed },
    parsingStatus: { type: String, enum: ['success', 'failed'], default: 'success' },
    parsingError: { type: String, default: null },
  },
  { timestamps: true }
);

grnSchema.pre('save', function (next) {
  this.items.forEach((item) => {
    item.itemKey = normalizeItemKey(item.description);
  });
  next();
});

// NOTE: poNumber is intentionally NOT unique - multiple GRNs can exist per PO

module.exports = mongoose.model('GRN', grnSchema);

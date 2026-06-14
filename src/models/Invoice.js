const mongoose = require('mongoose');
const { normalizeItemKey } = require('../utils/itemKey');

const invoiceItemSchema = new mongoose.Schema(
  {
    itemCode: { type: String, default: null },
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    itemKey: { type: String },
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, trim: true },
    poNumber: { type: String, required: true, trim: true, uppercase: true, index: true },
    invoiceDate: { type: Date, required: true },
    items: {
      type: [invoiceItemSchema],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'Invoice must have at least one item',
      },
    },

    sourceFile: { type: String, default: null },
    documentType: { type: String, default: 'invoice', immutable: true },
    rawExtraction: { type: mongoose.Schema.Types.Mixed },
    parsingStatus: { type: String, enum: ['success', 'failed'], default: 'success' },
    parsingError: { type: String, default: null },
  },
  { timestamps: true }
);

invoiceSchema.pre('save', function (next) {
  this.items.forEach((item) => {
    item.itemKey = normalizeItemKey(item.description);
  });
  next();
});

// NOTE: poNumber is intentionally NOT unique - multiple Invoices can exist per PO

module.exports = mongoose.model('Invoice', invoiceSchema);

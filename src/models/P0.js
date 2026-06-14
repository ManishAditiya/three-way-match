const mongoose = require('mongoose');
const { normalizeItemKey } = require('../utils/itemKey');

const poItemSchema = new mongoose.Schema(
  {
    itemCode: { type: String, default: null },
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    itemKey: { type: String }, // auto-computed in pre-save hook
  },
  { _id: false }
);

const poSchema = new mongoose.Schema(
  {
    poNumber: { type: String, required: true, trim: true, uppercase: true, index: true },
    poDate: { type: Date, required: true },
    vendorName: { type: String, required: true },
    items: {
      type: [poItemSchema],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'PO must have at least one item',
      },
    },

    sourceFile: { type: String, default: null },
    documentType: { type: String, default: 'po', immutable: true },
    rawExtraction: { type: mongoose.Schema.Types.Mixed },
    parsingStatus: { type: String, enum: ['success', 'failed'], default: 'success' },
    parsingError: { type: String, default: null },
  },
  { timestamps: true }
);

poSchema.pre('save', function (next) {
  this.items.forEach((item) => {
    item.itemKey = normalizeItemKey(item.description);
  });
  next();
});

poSchema.index({ poNumber: 1 });

module.exports = mongoose.model('PO', poSchema);

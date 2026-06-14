const mongoose = require('mongoose');

const itemMatchSchema = new mongoose.Schema(
  {
    itemKey: String,
    description: String,
    poQty: { type: Number, default: 0 },
    grnQty: { type: Number, default: 0 },
    invoiceQty: { type: Number, default: 0 },
    issues: [String],
  },
  { _id: false }
);

const matchResultSchema = new mongoose.Schema(
  {
    poNumber: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
    status: {
      type: String,
      enum: ['matched', 'partially_matched', 'mismatch', 'insufficient_documents'],
      required: true,
    },
    reasons: [String],
    itemDetails: [itemMatchSchema],

    linkedDocuments: {
      po: { type: mongoose.Schema.Types.ObjectId, ref: 'PO', default: null },
      grns: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GRN' }],
      invoices: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' }],
    },

    lastComputedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('MatchResult', matchResultSchema);

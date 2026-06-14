const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

/**
 * One prompt per document type. Each prompt forces:
 *  - JSON-only output (no markdown fences, no commentary)
 *  - dates normalized to YYYY-MM-DD regardless of source format
 *  - a field shape that maps 1:1 onto the Mongoose schemas
 */
const PROMPTS = {
  po: `You are a document parsing engine. Extract data from this Purchase Order (PO) PDF.
Return ONLY valid JSON, with no markdown formatting, no code fences, and no explanation.
The JSON must exactly match this shape:
{
  "poNumber": string,
  "poDate": string (format YYYY-MM-DD),
  "vendorName": string,
  "items": [
    { "itemCode": string or null, "description": string, "quantity": number }
  ]
}
Rules:
- poDate must be normalized to YYYY-MM-DD regardless of the format shown in the document (e.g. "Mar 17, 2026" -> "2026-03-17").
- vendorName is the seller/supplier issuing the goods (the "M/s" party), NOT the buyer/purchaser placing the order.
- itemCode should be the vendor/SKU code shown in the item table if present; use null if not present.
- quantity must be a plain number (no units, no commas, no text).
- Include every line item from the items table, including ones that span multiple rows due to wrapped text.`,

  grn: `You are a document parsing engine. Extract data from this Goods Receipt Note (GRN) PDF.
Return ONLY valid JSON, with no markdown formatting, no code fences, and no explanation.
The JSON must exactly match this shape:
{
  "grnNumber": string,
  "poNumber": string,
  "grnDate": string (format YYYY-MM-DD),
  "items": [
    { "itemCode": string or null, "description": string, "receivedQuantity": number }
  ]
}
Rules:
- grnDate must be normalized to YYYY-MM-DD regardless of the format shown in the document (e.g. "24-3-2026" -> "2026-03-24").
- poNumber is the "PO No." referenced on the document.
- itemCode should be the SKU Code column if present; use null if not present.
- receivedQuantity is the actual received quantity column (e.g. "Recv Qty"), NOT the expected/ordered quantity ("Exp Qty").
- Include every line item from the items table.`,

  invoice: `You are a document parsing engine. Extract data from this Tax Invoice PDF.
Return ONLY valid JSON, with no markdown formatting, no code fences, and no explanation.
The JSON must exactly match this shape:
{
  "invoiceNumber": string,
  "poNumber": string,
  "invoiceDate": string (format YYYY-MM-DD),
  "items": [
    { "itemCode": string or null, "description": string, "quantity": number }
  ]
}
Rules:
- invoiceDate must be normalized to YYYY-MM-DD regardless of the format shown in the document (e.g. "24/03/2026" -> "2026-03-24").
- poNumber is the value shown as "Customer Order No." (this is the PO number the invoice was raised against).
- itemCode is the "Item Code" column if present; use null if not present.
- quantity is the billed Qty column for each line item.
- Include every line item from the items table.`,
};

/**
 * Strips ```json ... ``` or ``` ... ``` fences that Gemini sometimes adds
 * even when explicitly told not to.
 */
function cleanJsonResponse(text) {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
  cleaned = cleaned.replace(/```\s*$/i, '');
  return cleaned.trim();
}

/**
 * Sends the PDF (as inline base64 data) + the type-specific prompt to Gemini
 * and returns both the parsed JSON and the raw text response.
 */
async function parseDocument(filePath, documentType) {
  const prompt = PROMPTS[documentType];
  if (!prompt) {
    throw new Error(`Unsupported documentType: ${documentType}`);
  }

  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString('base64');

  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

  const result = await model.generateContent([
    { inlineData: { mimeType: 'application/pdf', data: base64Data } },
    { text: prompt },
  ]);

  const rawText = result.response.text();
  const cleaned = cleanJsonResponse(rawText);

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Gemini returned invalid JSON: ${err.message}. Raw response (truncated): ${rawText.slice(0, 500)}`
    );
  }

  return { parsed, raw: rawText };
}

module.exports = { parseDocument };

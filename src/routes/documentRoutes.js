const express = require('express');
const router = express.Router();

const upload = require('../middleware/upload');
const documentController = require('../controllers/documentController');

// POST /documents/upload  (multipart/form-data: file, documentType)
router.post('/upload', upload.single('file'), documentController.uploadDocument);

// GET /documents/:id
router.get('/:id', documentController.getDocumentById);

module.exports = router;

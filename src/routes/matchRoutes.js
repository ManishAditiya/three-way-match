const express = require('express');
const router = express.Router();

const matchController = require('../controllers/matchController');

// GET /match/:poNumber
router.get('/:poNumber', matchController.getMatchByPoNumber);

module.exports = router;

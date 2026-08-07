const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { internalError } = require('../utils/httpError');

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      message: 'Base de datos conectada',
      timestamp: result.rows[0].now
    });
  } catch (error) {
    internalError(res, error);
  }
});

module.exports = router;

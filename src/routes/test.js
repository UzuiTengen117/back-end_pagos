const express = require('express');
const router = express.Router();
const pool = require('../config/database');

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ 
      message: 'Base de datos conectada',
      timestamp: result.rows[0].now 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

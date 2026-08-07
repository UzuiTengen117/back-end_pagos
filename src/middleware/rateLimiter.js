const rateLimit = require('express-rate-limit');

const defaultMax = () => parseInt(process.env.RATE_LIMIT_MAX, 10) || 10;

const createLimiter = (max, windowMinutes) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({ message: 'Demasiados intentos. Intenta de nuevo más tarde.' }),
  });

module.exports = {
  loginLimiter: createLimiter(defaultMax(), 15),
  sensitiveLimiter: createLimiter(Math.max(defaultMax(), 30), 15),
};

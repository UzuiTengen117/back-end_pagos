const app = require('../src/index.js');

module.exports = function handler(req, res) {
  return app(req, res);
};

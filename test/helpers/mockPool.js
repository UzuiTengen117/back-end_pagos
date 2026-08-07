const pool = require('../../src/config/database');

const DEFAULT_HANDLERS = [
  {
    match: 'SELECT token_version FROM usuarios WHERE id = $1',
    result: () => ({ rows: [{ token_version: 0 }] }),
  },
  {
    match: 'SELECT NOW()',
    result: () => ({ rows: [{ now: new Date() }] }),
  },
];

function install(handlers = []) {
  const calls = [];
  const all = [...DEFAULT_HANDLERS, ...handlers];
  const original = pool.query.bind(pool);

  pool.query = async (text, params) => {
    const call = { text, params };
    calls.push(call);
    const handler = all.find((h) => text.includes(h.match));
    if (!handler) {
      throw new Error(`[mockPool] sin handler para: ${text}`);
    }
    return handler.result(call, calls);
  };

  return {
    calls,
    pool,
    restore() {
      pool.query = original;
    },
  };
}

module.exports = { install, pool };

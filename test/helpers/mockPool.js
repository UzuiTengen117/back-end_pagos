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

// Transacciones: el cliente usa el mismo despachador que pool.query, asi que
// BEGIN/COMMIT/ROLLBACK necesitan handlers o el mock lanzaria.
const TX_HANDLERS = [
  { match: 'BEGIN', result: () => ({ rows: [] }) },
  { match: 'COMMIT', result: () => ({ rows: [] }) },
  { match: 'ROLLBACK', result: () => ({ rows: [] }) },
];

function install(handlers = []) {
  const calls = [];
  const all = [...DEFAULT_HANDLERS, ...TX_HANDLERS, ...handlers];
  const original = pool.query.bind(pool);
  const originalConnect = pool.connect.bind(pool);

  const run = async (text, params) => {
    const call = { text, params };
    calls.push(call);
    const handler = all.find((h) => text.includes(h.match));
    if (!handler) {
      throw new Error(`[mockPool] sin handler para: ${text}`);
    }
    return handler.result(call, calls);
  };

  pool.query = run;

  // Cliente transaccional minimo: solo query() y release().
  pool.connect = async () => ({
    query: run,
    release() {},
  });

  return {
    calls,
    pool,
    restore() {
      pool.query = original;
      pool.connect = originalConnect;
    },
  };
}

module.exports = { install, pool };

const session = require('express-session');
const { query, queryOne, run } = require('./database');

class TursoStore extends session.Store {
  async get(sid, cb) {
    try {
      const row = await queryOne(
        'SELECT data FROM sessions WHERE sid = ? AND expires > ?',
        [sid, Date.now()]
      );
      cb(null, row ? JSON.parse(row.data) : null);
    } catch (e) { cb(e); }
  }

  async set(sid, sess, cb) {
    const expires = sess.cookie?.expires
      ? new Date(sess.cookie.expires).getTime()
      : Date.now() + 7 * 24 * 60 * 60 * 1000;
    try {
      await run(
        'INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)',
        [sid, JSON.stringify(sess), expires]
      );
      cb(null);
    } catch (e) { cb(e); }
  }

  async destroy(sid, cb) {
    try {
      await run('DELETE FROM sessions WHERE sid = ?', [sid]);
      cb(null);
    } catch (e) { cb(e); }
  }

  async touch(sid, sess, cb) {
    const expires = sess.cookie?.expires
      ? new Date(sess.cookie.expires).getTime()
      : Date.now() + 7 * 24 * 60 * 60 * 1000;
    try {
      await run('UPDATE sessions SET expires = ? WHERE sid = ?', [expires, sid]);
      cb(null);
    } catch (e) { cb(e); }
  }
}

module.exports = TursoStore;

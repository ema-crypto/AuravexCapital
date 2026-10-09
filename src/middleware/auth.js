function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

function requireGuest(req, res, next) {
  if (req.session && req.session.userId) return res.redirect('/dashboard');
  next();
}

function loadUser(req, res, next) {
  if (req.session && req.session.userId) {
    const { getDb } = require('../models/database');
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (user) {
      if (user.is_suspended) {
        req.session.destroy(() => {});
        res.locals.isLoggedIn = false;
        return res.redirect('/login?suspended=1');
      }
      res.locals.authUser = user;
      res.locals.isLoggedIn = true;
    } else {
      req.session.destroy();
      res.locals.isLoggedIn = false;
    }
  } else {
    res.locals.isLoggedIn = false;
  }
  next();
}

module.exports = { requireAuth, requireGuest, loadUser };

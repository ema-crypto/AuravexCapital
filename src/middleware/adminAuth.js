const { getDb } = require('../models/database');

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.adminId) {
    return res.redirect('/admin/login');
  }
  const db = getDb();
  const admin = db.prepare('SELECT * FROM users WHERE id = ? AND is_admin = 1').get(req.session.adminId);
  if (!admin) {
    req.session.destroy();
    return res.redirect('/admin/login');
  }
  res.locals.adminUser = admin;
  next();
}

function requireAdminGuest(req, res, next) {
  if (req.session && req.session.adminId) return res.redirect('/admin');
  next();
}

module.exports = { requireAdmin, requireAdminGuest };

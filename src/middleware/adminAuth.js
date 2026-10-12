const { queryOne } = require('../models/database');

async function requireAdmin(req, res, next) {
  if (!req.session || !req.session.adminId) return res.redirect('/admin/login');
  try {
    const admin = await queryOne('SELECT * FROM users WHERE id = ? AND is_admin = 1', [req.session.adminId]);
    if (!admin) { req.session.destroy(); return res.redirect('/admin/login'); }
    res.locals.adminUser = admin;
    next();
  } catch (e) {
    res.redirect('/admin/login');
  }
}

function requireAdminGuest(req, res, next) {
  if (req.session && req.session.adminId) return res.redirect('/admin');
  next();
}

module.exports = { requireAdmin, requireAdminGuest };

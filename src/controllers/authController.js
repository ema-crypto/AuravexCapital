const bcrypt = require('bcryptjs');
const { getDb } = require('../models/database');
const { generateReferralCode } = require('../helpers/format');
const mailer = require('../services/email');

exports.getLogin = (req, res) => {
  res.render('auth/login', { title: 'Login', errors: req.flash('error'), success: req.flash('success') });
};

exports.postLogin = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    req.flash('error', 'Please fill in all fields.');
    return res.redirect('/login');
  }
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !(await bcrypt.compare(password, user.password))) {
    req.flash('error', 'Invalid email or password.');
    return res.redirect('/login');
  }
  req.session.userId = user.id;
  const returnTo = req.session.returnTo || '/dashboard';
  delete req.session.returnTo;
  res.redirect(returnTo);
};

exports.getRegister = (req, res) => {
  const ref = req.query.ref || '';
  res.render('auth/register', { title: 'Create Account', ref, errors: req.flash('error') });
};

exports.postRegister = async (req, res) => {
  const { full_name, email, password, password_confirm, country, ref } = req.body;
  if (!full_name || !email || !password) {
    req.flash('error', 'All fields are required.');
    return res.redirect('/register');
  }
  if (password !== password_confirm) {
    req.flash('error', 'Passwords do not match.');
    return res.redirect('/register');
  }
  if (password.length < 8) {
    req.flash('error', 'Password must be at least 8 characters.');
    return res.redirect('/register');
  }
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) {
    req.flash('error', 'That email is already registered. Please login.');
    return res.redirect('/register');
  }
  const hash = await bcrypt.hash(password, 12);
  const referralCode = generateReferralCode(full_name);

  let referredBy = null;
  if (ref) {
    const referrer = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(ref);
    if (referrer) referredBy = referrer.id;
  }

  const stmt = db.prepare(`
    INSERT INTO users (full_name, email, password, country, referral_code, referred_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(full_name.trim(), email.toLowerCase().trim(), hash, country || 'Nigeria', referralCode, referredBy);

  // Record referral chain
  if (referredBy) {
    db.prepare('INSERT INTO referrals (referrer_id, referred_id, level) VALUES (?, ?, 1)').run(referredBy, result.lastInsertRowid);
    // Level 2
    const lvl2 = db.prepare('SELECT referred_by FROM users WHERE id = ?').get(referredBy);
    if (lvl2 && lvl2.referred_by) {
      db.prepare('INSERT INTO referrals (referrer_id, referred_id, level) VALUES (?, ?, 2)').run(lvl2.referred_by, result.lastInsertRowid);
      // Level 3
      const lvl3 = db.prepare('SELECT referred_by FROM users WHERE id = ?').get(lvl2.referred_by);
      if (lvl3 && lvl3.referred_by) {
        db.prepare('INSERT INTO referrals (referrer_id, referred_id, level) VALUES (?, ?, 3)').run(lvl3.referred_by, result.lastInsertRowid);
      }
    }
  }

  req.session.userId = result.lastInsertRowid;
  mailer.sendWelcome(email.toLowerCase().trim(), full_name.trim()).catch(() => {});
  res.redirect('/dashboard');
};

exports.getForgotPassword = (req, res) => {
  res.render('auth/forgot-password', { title: 'Reset Password', errors: req.flash('error'), success: req.flash('success') });
};

exports.postForgotPassword = (req, res) => {
  req.flash('success', 'If that email is registered, a reset link has been sent. Please check your inbox.');
  res.redirect('/forgot-password');
};

exports.logout = (req, res) => {
  req.session.destroy(() => res.redirect('/'));
};

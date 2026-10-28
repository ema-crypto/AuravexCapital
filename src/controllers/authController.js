const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { queryOne, run } = require('../models/database');
const { generateReferralCode } = require('../helpers/format');
const mailer = require('../services/email');

exports.getLogin = (req, res) => {
  res.render('auth/login', { title: 'Login', errors: req.flash('error'), success: req.flash('success') });
};

exports.postLogin = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) { req.flash('error', 'Please fill in all fields.'); return res.redirect('/login'); }
  const user = await queryOne('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    req.flash('error', 'Invalid email or password.');
    return res.redirect('/login');
  }
  if (user.is_suspended) { req.flash('error', 'Your account has been suspended.'); return res.redirect('/login'); }
  req.session.userId = Number(user.id);
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
  if (!full_name || !email || !password) { req.flash('error', 'All fields are required.'); return res.redirect('/register'); }
  if (password !== password_confirm) { req.flash('error', 'Passwords do not match.'); return res.redirect('/register'); }
  if (password.length < 8) { req.flash('error', 'Password must be at least 8 characters.'); return res.redirect('/register'); }

  const existing = await queryOne('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
  if (existing) { req.flash('error', 'That email is already registered. Please login.'); return res.redirect('/register'); }

  const hash = await bcrypt.hash(password, 12);
  const referralCode = generateReferralCode(full_name);

  let referredBy = null;
  if (ref) {
    const referrer = await queryOne('SELECT id FROM users WHERE referral_code = ?', [ref]);
    if (referrer) referredBy = Number(referrer.id);
  }

  const result = await run(
    'INSERT INTO users (full_name,email,password,country,referral_code,referred_by) VALUES (?,?,?,?,?,?)',
    [full_name.trim(), email.toLowerCase().trim(), hash, country || 'United Kingdom', referralCode, referredBy]
  );
  const newId = result.lastInsertRowid;

  if (referredBy) {
    await run('INSERT INTO referrals (referrer_id,referred_id,level) VALUES (?,?,1)', [referredBy, newId]);
    const lvl2 = await queryOne('SELECT referred_by FROM users WHERE id = ?', [referredBy]);
    if (lvl2 && lvl2.referred_by) {
      await run('INSERT INTO referrals (referrer_id,referred_id,level) VALUES (?,?,2)', [lvl2.referred_by, newId]);
      const lvl3 = await queryOne('SELECT referred_by FROM users WHERE id = ?', [lvl2.referred_by]);
      if (lvl3 && lvl3.referred_by) {
        await run('INSERT INTO referrals (referrer_id,referred_id,level) VALUES (?,?,3)', [lvl3.referred_by, newId]);
      }
    }
  }

  const verifyToken = crypto.randomBytes(32).toString('hex');
  const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await run('UPDATE users SET verification_token = ?, verification_expires = ? WHERE id = ?', [verifyToken, verifyExpires, newId]);

  const siteUrl = process.env.SITE_URL || 'https://auravexcapital.ltd';
  mailer.sendVerificationEmail(
    email.toLowerCase().trim(),
    full_name.trim(),
    `${siteUrl}/verify-email?token=${verifyToken}`
  ).catch(() => {});

  req.session.userId = newId;
  res.redirect('/verify-email-notice');
};

exports.getForgotPassword = (req, res) => {
  res.render('auth/forgot-password', { title: 'Reset Password', errors: req.flash('error'), success: req.flash('success') });
};

exports.postForgotPassword = async (req, res) => {
  const { email } = req.body;
  const user = await queryOne('SELECT * FROM users WHERE email = ?', [(email || '').toLowerCase().trim()]);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await run('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?', [token, expires, user.id]);
    const siteUrl = process.env.SITE_URL || 'https://auravexcapital.ltd';
    mailer.sendPasswordReset(user.email, user.full_name, `${siteUrl}/reset-password?token=${token}`).catch(() => {});
  }
  req.flash('success', "If that email is registered, a reset link has been sent. Please check your inbox.");
  res.redirect('/forgot-password');
};

exports.getResetPassword = async (req, res) => {
  const { token } = req.query;
  if (!token) { req.flash('error', 'Invalid reset link.'); return res.redirect('/forgot-password'); }
  const user = await queryOne('SELECT * FROM users WHERE reset_token = ?', [token]);
  if (!user || new Date(user.reset_expires) < new Date()) {
    req.flash('error', 'Reset link is invalid or has expired. Please request a new one.');
    return res.redirect('/forgot-password');
  }
  res.render('auth/reset-password', { title: 'Set New Password', token, errors: req.flash('error') });
};

exports.postResetPassword = async (req, res) => {
  const { token, password, password_confirm } = req.body;
  if (!password || password.length < 8) {
    req.flash('error', 'Password must be at least 8 characters.');
    return res.redirect(`/reset-password?token=${token}`);
  }
  if (password !== password_confirm) {
    req.flash('error', 'Passwords do not match.');
    return res.redirect(`/reset-password?token=${token}`);
  }
  const user = await queryOne('SELECT * FROM users WHERE reset_token = ?', [token]);
  if (!user || new Date(user.reset_expires) < new Date()) {
    req.flash('error', 'Reset link is invalid or has expired. Please request a new one.');
    return res.redirect('/forgot-password');
  }
  const hash = await bcrypt.hash(password, 12);
  await run('UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?', [hash, user.id]);
  req.flash('success', 'Password updated successfully! Please log in with your new password.');
  res.redirect('/login');
};

exports.logout = (req, res) => {
  req.session.destroy(() => res.redirect('/'));
};

exports.getVerifyEmailNotice = (req, res) => {
  res.render('auth/verify-email-notice', {
    title: 'Verify Your Email',
    success: req.flash('success'),
    errors: req.flash('error'),
  });
};

exports.getVerifyEmail = async (req, res) => {
  const { token } = req.query;
  if (!token) {
    req.flash('error', 'Invalid verification link.');
    return res.redirect('/login');
  }
  const user = await queryOne('SELECT * FROM users WHERE verification_token = ?', [token]);
  if (!user) {
    req.flash('error', 'Verification link is invalid or has already been used.');
    return res.redirect('/login');
  }
  if (new Date(user.verification_expires) < new Date()) {
    req.flash('error', 'Verification link has expired. Please request a new one.');
    return res.redirect(req.session.userId ? '/dashboard' : '/login');
  }
  await run(
    'UPDATE users SET email_verified = 1, verification_token = NULL, verification_expires = NULL WHERE id = ?',
    [user.id]
  );
  if (req.session.userId) {
    req.flash('success', 'Email verified! You can now start investing.');
    return res.redirect('/dashboard');
  }
  req.flash('success', 'Email verified! Please log in to continue.');
  res.redirect('/login');
};

exports.postResendVerification = async (req, res) => {
  const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  if (!user) return res.redirect('/login');
  if (user.email_verified) {
    req.flash('success', 'Your email is already verified.');
    return res.redirect('/dashboard');
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await run('UPDATE users SET verification_token = ?, verification_expires = ? WHERE id = ?', [token, expires, user.id]);
  const siteUrl = process.env.SITE_URL || 'https://auravexcapital.ltd';
  mailer.sendVerificationEmail(user.email, user.full_name, `${siteUrl}/verify-email?token=${token}`).catch(() => {});
  req.flash('success', 'Verification email resent! Check your inbox.');
  res.redirect('/dashboard');
};

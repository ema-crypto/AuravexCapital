const bcrypt = require('bcryptjs');
const { getDb, getSetting } = require('../models/database');
const { currency, dateStr } = require('../helpers/format');

// ── Auth ──────────────────────────────────────────────────
exports.getLogin = (req, res) => {
  res.render('admin/login', {
    title: 'Admin Login',
    errors: req.flash('error'),
    success: req.flash('success')
  });
};

exports.postLogin = async (req, res) => {
  const { email, password } = req.body;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_admin = 1').get((email || '').toLowerCase().trim());
  if (!user || !(await bcrypt.compare(password, user.password))) {
    req.flash('error', 'Invalid admin credentials.');
    return res.redirect('/admin/login');
  }
  req.session.adminId = user.id;
  res.redirect('/admin');
};

exports.logout = (req, res) => {
  delete req.session.adminId;
  res.redirect('/admin/login');
};

// ── Dashboard ─────────────────────────────────────────────
exports.getDashboard = (req, res) => {
  const db = getDb();
  const totalUsers       = db.prepare("SELECT COUNT(*) as c FROM users WHERE is_admin = 0").get().c;
  const activeUsers      = db.prepare("SELECT COUNT(*) as c FROM users WHERE is_admin = 0 AND is_suspended = 0").get().c;
  const suspendedUsers   = db.prepare("SELECT COUNT(*) as c FROM users WHERE is_suspended = 1").get().c;
  const totalInvested    = db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM investments WHERE status='active'").get().s;
  const totalDeposited   = db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE type='deposit' AND status='completed'").get().s;
  const totalWithdrawn   = db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE type='withdrawal' AND status='completed'").get().s;
  const pendingWithdrawals = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE type='withdrawal' AND status='pending'").get().c;
  const recentUsers      = db.prepare("SELECT * FROM users WHERE is_admin=0 ORDER BY created_at DESC LIMIT 8").all();
  const recentTxns       = db.prepare("SELECT t.*, u.full_name, u.email FROM transactions t JOIN users u ON t.user_id=u.id ORDER BY t.created_at DESC LIMIT 10").all();

  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    totalUsers, activeUsers, suspendedUsers,
    totalInvested, totalDeposited, totalWithdrawn, pendingWithdrawals,
    recentUsers, recentTxns,
    helpers: { currency, dateStr }
  });
};

// ── Users ─────────────────────────────────────────────────
exports.getUsers = (req, res) => {
  const db = getDb();
  const search = req.query.search || '';
  const filter = req.query.filter || 'all';

  let query = "SELECT * FROM users WHERE is_admin = 0";
  const params = [];
  if (search) { query += " AND (full_name LIKE ? OR email LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }
  if (filter === 'suspended') query += " AND is_suspended = 1";
  if (filter === 'active')    query += " AND is_suspended = 0";
  query += " ORDER BY created_at DESC";

  const users = db.prepare(query).all(...params);
  res.render('admin/users', {
    title: 'Manage Users',
    users, search, filter,
    success: req.flash('success'),
    errors: req.flash('error'),
    helpers: { currency, dateStr }
  });
};

exports.getUser = (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_admin = 0').get(req.params.id);
  if (!user) { req.flash('error', 'User not found.'); return res.redirect('/admin/users'); }

  const investments = db.prepare(`
    SELECT i.*, p.name as plan_name FROM investments i
    JOIN plans p ON i.plan_id = p.id
    WHERE i.user_id = ? ORDER BY i.created_at DESC LIMIT 20
  `).all(user.id);

  const transactions = db.prepare(
    'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
  ).all(user.id);

  const referrals = db.prepare(`
    SELECT u.full_name, u.email, r.level, r.commission, r.created_at
    FROM referrals r JOIN users u ON r.referred_id = u.id
    WHERE r.referrer_id = ? ORDER BY r.created_at DESC
  `).all(user.id);

  res.render('admin/user-detail', {
    title: `User: ${user.full_name}`,
    user, investments, transactions, referrals,
    success: req.flash('success'),
    errors: req.flash('error'),
    helpers: { currency, dateStr }
  });
};

exports.suspendUser = (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_admin = 0').get(req.params.id);
  if (!user) { req.flash('error', 'User not found.'); return res.redirect('/admin/users'); }
  const newState = user.is_suspended ? 0 : 1;
  db.prepare('UPDATE users SET is_suspended = ? WHERE id = ?').run(newState, user.id);
  req.flash('success', `${user.full_name} has been ${newState ? 'suspended' : 'reactivated'}.`);
  res.redirect(req.headers.referer || '/admin/users');
};

exports.deleteUser = (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_admin = 0').get(req.params.id);
  if (!user) { req.flash('error', 'User not found.'); return res.redirect('/admin/users'); }

  // Delete related data first
  db.prepare('DELETE FROM referrals WHERE referrer_id = ? OR referred_id = ?').run(user.id, user.id);
  db.prepare('DELETE FROM wallet_addresses WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM investments WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM transactions WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

  req.flash('success', `User "${user.full_name}" (${user.email}) has been permanently deleted.`);
  res.redirect('/admin/users');
};

exports.adjustBalance = (req, res) => {
  const db = getDb();
  const { amount, type, note } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_admin = 0').get(req.params.id);
  if (!user) { req.flash('error', 'User not found.'); return res.redirect('/admin/users'); }

  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) { req.flash('error', 'Invalid amount.'); return res.redirect(`/admin/users/${req.params.id}`); }

  if (type === 'credit') {
    db.prepare('UPDATE users SET balance = balance + ?, total_deposited = total_deposited + ? WHERE id = ?').run(amt, amt, user.id);
    db.prepare("INSERT INTO transactions (user_id, type, amount, status, note, txn_ref) VALUES (?, 'deposit', ?, 'completed', ?, ?)").run(user.id, amt, note || 'Admin credit', `ADM-${Date.now()}`);
    req.flash('success', `Credited $${amt.toFixed(2)} to ${user.full_name}'s balance.`);
  } else {
    db.prepare('UPDATE users SET balance = MAX(0, balance - ?) WHERE id = ?').run(amt, user.id);
    db.prepare("INSERT INTO transactions (user_id, type, amount, status, note, txn_ref) VALUES (?, 'debit', ?, 'completed', ?, ?)").run(user.id, amt, note || 'Admin debit', `ADM-${Date.now()}`);
    req.flash('success', `Debited $${amt.toFixed(2)} from ${user.full_name}'s balance.`);
  }
  res.redirect(`/admin/users/${req.params.id}`);
};

exports.approveWithdrawal = (req, res) => {
  const db = getDb();
  db.prepare("UPDATE transactions SET status='completed' WHERE id = ? AND type='withdrawal'").run(req.params.txnId);
  req.flash('success', 'Withdrawal marked as completed.');
  res.redirect(req.headers.referer || '/admin/transactions');
};

exports.rejectWithdrawal = (req, res) => {
  const db = getDb();
  const txn = db.prepare("SELECT * FROM transactions WHERE id = ? AND type='withdrawal' AND status='pending'").get(req.params.txnId);
  if (txn) {
    // Refund the amount
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(txn.amount, txn.user_id);
    db.prepare("UPDATE transactions SET status='failed' WHERE id = ?").run(txn.id);
  }
  req.flash('success', 'Withdrawal rejected and amount refunded to user.');
  res.redirect(req.headers.referer || '/admin/transactions');
};

// ── Transactions ──────────────────────────────────────────
exports.getTransactions = (req, res) => {
  const db = getDb();
  const allowed = ['deposit','withdrawal','earning','referral','debit'];
  const filter = allowed.includes(req.query.filter) ? req.query.filter : 'all';
  let query = "SELECT t.*, u.full_name, u.email FROM transactions t JOIN users u ON t.user_id=u.id";
  const params = [];
  if (filter !== 'all') { query += " WHERE t.type = ?"; params.push(filter); }
  query += " ORDER BY t.created_at DESC LIMIT 100";
  const transactions = db.prepare(query).all(...params);
  res.render('admin/transactions', {
    title: 'All Transactions',
    transactions, filter,
    success: req.flash('success'),
    helpers: { currency, dateStr }
  });
};

// ── Deposit Wallets ───────────────────────────────────────
exports.getWallets = (req, res) => {
  const db = getDb();
  const wallets = db.prepare('SELECT * FROM deposit_wallets ORDER BY sort_order').all();
  res.render('admin/wallets', {
    title: 'Deposit Wallet Addresses',
    wallets,
    success: req.flash('success'),
    errors: req.flash('error')
  });
};

exports.updateWallet = (req, res) => {
  const db = getDb();
  const { address, is_active } = req.body;
  db.prepare("UPDATE deposit_wallets SET address = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(address.trim(), is_active ? 1 : 0, req.params.id);
  req.flash('success', 'Wallet address updated.');
  res.redirect('/admin/wallets');
};

// ── Settings ──────────────────────────────────────────────
exports.getSettings = (req, res) => {
  const db = getDb();
  const settings = {};
  db.prepare('SELECT key, value FROM site_settings').all().forEach(r => { settings[r.key] = r.value; });
  res.render('admin/settings', {
    title: 'Site Settings',
    settings,
    success: req.flash('success')
  });
};

exports.postSettings = (req, res) => {
  const db = getDb();
  const allowed = ['whatsapp_number', 'site_name', 'support_email', 'min_withdrawal', 'withdrawal_fee_pct'];
  const upsert  = db.prepare("INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)");
  allowed.forEach(key => {
    if (req.body[key] !== undefined) upsert.run(key, req.body[key]);
  });
  req.flash('success', 'Settings saved.');
  res.redirect('/admin/settings');
};

const bcrypt = require('bcryptjs');
const { queryOne, query, run } = require('../models/database');
const { currency, dateStr } = require('../helpers/format');

exports.getLogin = (req, res) => {
  res.render('admin/login', { title: 'Admin Login', errors: req.flash('error'), success: req.flash('success') });
};

exports.postLogin = async (req, res) => {
  const { email, password } = req.body;
  const user = await queryOne('SELECT * FROM users WHERE email = ? AND is_admin = 1', [(email || '').toLowerCase().trim()]);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    req.flash('error', 'Invalid admin credentials.'); return res.redirect('/admin/login');
  }
  req.session.adminId = Number(user.id);
  res.redirect('/admin');
};

exports.logout = (req, res) => { delete req.session.adminId; res.redirect('/admin/login'); };

exports.getDashboard = async (req, res) => {
  const totalUsers        = Number((await queryOne("SELECT COUNT(*) as c FROM users WHERE is_admin = 0")).c);
  const activeUsers       = Number((await queryOne("SELECT COUNT(*) as c FROM users WHERE is_admin = 0 AND is_suspended = 0")).c);
  const suspendedUsers    = Number((await queryOne("SELECT COUNT(*) as c FROM users WHERE is_suspended = 1")).c);
  const totalInvested     = Number((await queryOne("SELECT COALESCE(SUM(amount),0) as s FROM investments WHERE status='active'")).s);
  const totalDeposited    = Number((await queryOne("SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE type='deposit' AND status='completed'")).s);
  const totalWithdrawn    = Number((await queryOne("SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE type='withdrawal' AND status='completed'")).s);
  const pendingWithdrawals = Number((await queryOne("SELECT COUNT(*) as c FROM transactions WHERE type='withdrawal' AND status='pending'")).c);
  const recentUsers       = await query("SELECT * FROM users WHERE is_admin=0 ORDER BY created_at DESC LIMIT 8");
  const recentTxns        = await query("SELECT t.*, u.full_name, u.email FROM transactions t JOIN users u ON t.user_id=u.id ORDER BY t.created_at DESC LIMIT 10");
  res.render('admin/dashboard', {
    title: 'Admin Dashboard', totalUsers, activeUsers, suspendedUsers,
    totalInvested, totalDeposited, totalWithdrawn, pendingWithdrawals,
    recentUsers, recentTxns, helpers: { currency, dateStr }
  });
};

exports.getUsers = async (req, res) => {
  const search = req.query.search || '';
  const filter = req.query.filter || 'all';
  let sql = "SELECT * FROM users WHERE is_admin = 0";
  const args = [];
  if (search) { sql += " AND (full_name LIKE ? OR email LIKE ?)"; args.push(`%${search}%`, `%${search}%`); }
  if (filter === 'suspended') sql += " AND is_suspended = 1";
  if (filter === 'active')    sql += " AND is_suspended = 0";
  sql += " ORDER BY created_at DESC";
  const users = await query(sql, args);
  res.render('admin/users', { title: 'Manage Users', users, search, filter, success: req.flash('success'), errors: req.flash('error'), helpers: { currency, dateStr } });
};

exports.getUser = async (req, res) => {
  const user = await queryOne('SELECT * FROM users WHERE id = ? AND is_admin = 0', [req.params.id]);
  if (!user) { req.flash('error', 'User not found.'); return res.redirect('/admin/users'); }
  const investments  = await query("SELECT i.*, p.name as plan_name FROM investments i JOIN plans p ON i.plan_id=p.id WHERE i.user_id=? ORDER BY i.created_at DESC LIMIT 20", [user.id]);
  const transactions = await query("SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 20", [user.id]);
  const referrals    = await query("SELECT u.full_name,u.email,r.level,r.commission,r.created_at FROM referrals r JOIN users u ON r.referred_id=u.id WHERE r.referrer_id=? ORDER BY r.created_at DESC", [user.id]);
  const kycSub       = await queryOne('SELECT * FROM kyc_submissions WHERE user_id=? ORDER BY submitted_at DESC LIMIT 1', [user.id]);
  res.render('admin/user-detail', {
    title: `User: ${user.full_name}`, user, investments, transactions, referrals, kycSub,
    success: req.flash('success'), errors: req.flash('error'), helpers: { currency, dateStr }
  });
};

exports.suspendUser = async (req, res) => {
  const user = await queryOne('SELECT * FROM users WHERE id = ? AND is_admin = 0', [req.params.id]);
  if (!user) { req.flash('error', 'User not found.'); return res.redirect('/admin/users'); }
  const newState = user.is_suspended ? 0 : 1;
  await run('UPDATE users SET is_suspended = ? WHERE id = ?', [newState, user.id]);
  req.flash('success', `${user.full_name} has been ${newState ? 'suspended' : 'reactivated'}.`);
  res.redirect(req.headers.referer || '/admin/users');
};

exports.deleteUser = async (req, res) => {
  const user = await queryOne('SELECT * FROM users WHERE id = ? AND is_admin = 0', [req.params.id]);
  if (!user) { req.flash('error', 'User not found.'); return res.redirect('/admin/users'); }
  await run('DELETE FROM referrals WHERE referrer_id = ? OR referred_id = ?', [user.id, user.id]);
  await run('DELETE FROM kyc_submissions WHERE user_id = ?', [user.id]);
  await run('DELETE FROM wallet_addresses WHERE user_id = ?', [user.id]);
  await run('DELETE FROM investments WHERE user_id = ?', [user.id]);
  await run('DELETE FROM transactions WHERE user_id = ?', [user.id]);
  await run('DELETE FROM users WHERE id = ?', [user.id]);
  req.flash('success', `User "${user.full_name}" (${user.email}) has been permanently deleted.`);
  res.redirect('/admin/users');
};

exports.adjustBalance = async (req, res) => {
  const { amount, type, note } = req.body;
  const user = await queryOne('SELECT * FROM users WHERE id = ? AND is_admin = 0', [req.params.id]);
  if (!user) { req.flash('error', 'User not found.'); return res.redirect('/admin/users'); }
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) { req.flash('error', 'Invalid amount.'); return res.redirect(`/admin/users/${req.params.id}`); }
  if (type === 'credit') {
    await run('UPDATE users SET balance = balance + ?, total_deposited = total_deposited + ? WHERE id = ?', [amt, amt, user.id]);
    await run("INSERT INTO transactions (user_id,type,amount,status,note,txn_ref) VALUES (?,'deposit',?,'completed',?,?)", [user.id, amt, note || 'Admin credit', `ADM-${Date.now()}`]);
    req.flash('success', `Credited $${amt.toFixed(2)} to ${user.full_name}'s balance.`);
  } else {
    await run('UPDATE users SET balance = MAX(0, balance - ?) WHERE id = ?', [amt, user.id]);
    await run("INSERT INTO transactions (user_id,type,amount,status,note,txn_ref) VALUES (?,'debit',?,'completed',?,?)", [user.id, amt, note || 'Admin debit', `ADM-${Date.now()}`]);
    req.flash('success', `Debited $${amt.toFixed(2)} from ${user.full_name}'s balance.`);
  }
  res.redirect(`/admin/users/${req.params.id}`);
};

exports.approveKyc = async (req, res) => {
  const sub = await queryOne('SELECT * FROM kyc_submissions WHERE id = ?', [req.params.submissionId]);
  if (sub) {
    await run("UPDATE kyc_submissions SET status='approved', reviewed_at=CURRENT_TIMESTAMP WHERE id=?", [sub.id]);
    await run("UPDATE users SET kyc_status='approved' WHERE id=?", [sub.user_id]);
    req.flash('success', 'KYC approved successfully.');
  } else {
    req.flash('error', 'Submission not found.');
  }
  res.redirect(req.headers.referer || '/admin/users');
};

exports.rejectKyc = async (req, res) => {
  const reason = (req.body.reason || 'Documents could not be verified').trim();
  const sub = await queryOne('SELECT * FROM kyc_submissions WHERE id = ?', [req.params.submissionId]);
  if (sub) {
    await run("UPDATE kyc_submissions SET status='rejected', rejection_reason=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?", [reason, sub.id]);
    await run("UPDATE users SET kyc_status='rejected' WHERE id=?", [sub.user_id]);
    req.flash('success', 'KYC rejected.');
  } else {
    req.flash('error', 'Submission not found.');
  }
  res.redirect(req.headers.referer || '/admin/users');
};

exports.confirmDeposit = async (req, res) => {
  const txn = await queryOne("SELECT * FROM transactions WHERE id=? AND type='deposit' AND status='pending'", [req.params.txnId]);
  if (txn) {
    await run("UPDATE transactions SET status='completed' WHERE id=?", [txn.id]);
    await run('UPDATE users SET balance = balance + ?, total_deposited = total_deposited + ? WHERE id = ?', [txn.amount, txn.amount, txn.user_id]);
  }
  req.flash('success', 'Deposit confirmed and user balance updated.');
  res.redirect(req.headers.referer || '/admin/transactions');
};

exports.approveWithdrawal = async (req, res) => {
  await run("UPDATE transactions SET status='completed' WHERE id=? AND type='withdrawal'", [req.params.txnId]);
  req.flash('success', 'Withdrawal marked as completed.');
  res.redirect(req.headers.referer || '/admin/transactions');
};

exports.rejectWithdrawal = async (req, res) => {
  const txn = await queryOne("SELECT * FROM transactions WHERE id=? AND type='withdrawal' AND status='pending'", [req.params.txnId]);
  if (txn) {
    await run('UPDATE users SET balance = balance + ? WHERE id = ?', [txn.amount, txn.user_id]);
    await run("UPDATE transactions SET status='failed' WHERE id=?", [txn.id]);
  }
  req.flash('success', 'Withdrawal rejected and amount refunded to user.');
  res.redirect(req.headers.referer || '/admin/transactions');
};

exports.getTransactions = async (req, res) => {
  const allowed = ['deposit','withdrawal','earning','referral','debit','investment'];
  const filter = allowed.includes(req.query.filter) ? req.query.filter : 'all';
  let sql = "SELECT t.*, u.full_name, u.email FROM transactions t JOIN users u ON t.user_id=u.id";
  const args = [];
  if (filter !== 'all') { sql += " WHERE t.type = ?"; args.push(filter); }
  sql += " ORDER BY t.created_at DESC LIMIT 100";
  const transactions = await query(sql, args);
  res.render('admin/transactions', { title: 'All Transactions', transactions, filter, success: req.flash('success'), helpers: { currency, dateStr } });
};

exports.getWallets = async (req, res) => {
  const wallets = await query('SELECT * FROM deposit_wallets ORDER BY sort_order');
  res.render('admin/wallets', { title: 'Deposit Wallet Addresses', wallets, success: req.flash('success'), errors: req.flash('error') });
};

exports.updateWallet = async (req, res) => {
  const { address, is_active } = req.body;
  await run("UPDATE deposit_wallets SET address=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [address.trim(), is_active ? 1 : 0, req.params.id]);
  req.flash('success', 'Wallet address updated.');
  res.redirect('/admin/wallets');
};

exports.getSettings = async (req, res) => {
  const rows = await query('SELECT key, value FROM site_settings');
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.render('admin/settings', { title: 'Site Settings', settings, success: req.flash('success') });
};

exports.postSettings = async (req, res) => {
  const allowed = ['whatsapp_number','site_name','support_email','min_withdrawal','withdrawal_fee_pct','auto_withdrawal_limit','tawkto_id'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      await run("INSERT OR REPLACE INTO site_settings (key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)", [key, req.body[key]]);
    }
  }
  req.flash('success', 'Settings saved.');
  res.redirect('/admin/settings');
};

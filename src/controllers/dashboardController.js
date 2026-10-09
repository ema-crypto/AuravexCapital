const { getDb } = require('../models/database');
const { currency, dateStr, timeAgo } = require('../helpers/format');

exports.getDashboard = (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  const activeInvestments = db.prepare(`
    SELECT i.*, p.name as plan_name FROM investments i
    JOIN plans p ON i.plan_id = p.id
    WHERE i.user_id = ? AND i.status = 'active'
    ORDER BY i.created_at DESC LIMIT 5
  `).all(user.id);

  const activeTotal = activeInvestments.reduce((s, i) => s + i.amount, 0);

  const recentTxns = db.prepare(`
    SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 5
  `).all(user.id);

  const totalReferrals = db.prepare('SELECT COUNT(*) as c FROM referrals WHERE referrer_id = ? AND level = 1').get(user.id);

  res.render('dashboard/index', {
    title: 'Dashboard',
    user,
    activeInvestments,
    activeTotal,
    recentTxns,
    totalReferrals: totalReferrals.c,
    helpers: { currency, dateStr, timeAgo }
  });
};

exports.getPlans = (req, res) => {
  const db = getDb();
  const plans = db.prepare('SELECT * FROM plans WHERE is_active = 1 ORDER BY sort_order').all();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  res.render('dashboard/plans', { title: 'Investment Plans', plans, user, helpers: { currency } });
};

exports.getInvestments = (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const investments = db.prepare(`
    SELECT i.*, p.name as plan_name FROM investments i
    JOIN plans p ON i.plan_id = p.id
    WHERE i.user_id = ?
    ORDER BY i.created_at DESC
  `).all(user.id);

  const totalInvested = investments.reduce((s, i) => s + i.amount, 0);
  const activeCount = investments.filter(i => i.status === 'active').length;
  const totalEarned = investments.reduce((s, i) => s + (i.earned || 0), 0);

  res.render('dashboard/investments', {
    title: 'My Investments',
    user, investments, totalInvested, activeCount, totalEarned,
    helpers: { currency, dateStr }
  });
};

exports.postInvest = (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const { plan_id, amount } = req.body;
  const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND is_active = 1').get(plan_id);

  if (!plan) { req.flash('error', 'Invalid plan.'); return res.redirect('/dashboard/plans'); }

  const amt = parseFloat(amount);
  if (isNaN(amt) || amt < plan.min_amount) {
    req.flash('error', `Minimum investment for this plan is $${plan.min_amount}.`);
    return res.redirect('/dashboard/plans');
  }
  if (plan.max_amount && amt > plan.max_amount) {
    req.flash('error', `Maximum investment for this plan is $${plan.max_amount}.`);
    return res.redirect('/dashboard/plans');
  }
  if (user.balance < amt) {
    req.flash('error', 'Insufficient balance. Please make a deposit first.');
    return res.redirect('/dashboard/deposit');
  }

  const endDate = new Date(Date.now() + plan.term_days * 86400000).toISOString();

  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amt, user.id);
  db.prepare(`
    INSERT INTO investments (user_id, plan_id, amount, daily_percent, term_days, end_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(user.id, plan.id, amt, plan.daily_percent, plan.term_days, endDate);

  db.prepare(`
    INSERT INTO transactions (user_id, type, amount, status, note)
    VALUES (?, 'investment', ?, 'completed', ?)
  `).run(user.id, amt, `Invested in ${plan.name}`);

  req.flash('success', `Investment of $${amt.toFixed(2)} in ${plan.name} created successfully!`);
  res.redirect('/dashboard/investments');
};

exports.getHistory = (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const transactions = db.prepare(`
    SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC
  `).all(user.id);
  res.render('dashboard/history', { title: 'Transaction History', user, transactions, helpers: { currency, dateStr, timeAgo } });
};

exports.getWithdraw = (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const wallets = db.prepare('SELECT * FROM wallet_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC').all(user.id);
  const withdrawals = db.prepare(`
    SELECT * FROM transactions WHERE user_id = ? AND type = 'withdrawal'
    ORDER BY created_at DESC LIMIT 20
  `).all(user.id);
  const totalReferrals = db.prepare('SELECT COUNT(*) as c FROM referrals WHERE referrer_id = ? AND level = 1').get(user.id);
  res.render('dashboard/withdraw', {
    title: 'Withdraw Funds',
    user, wallets, withdrawals,
    totalReferrals: totalReferrals.c,
    errors: req.flash('error'),
    success: req.flash('success'),
    helpers: { currency, dateStr, timeAgo }
  });
};

exports.postWithdraw = (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const { source, amount, wallet_id } = req.body;
  const amt = parseFloat(amount);

  if (isNaN(amt) || amt <= 0) {
    req.flash('error', 'Enter a valid amount.');
    return res.redirect('/dashboard/withdraw');
  }

  const wallet = db.prepare('SELECT * FROM wallet_addresses WHERE id = ? AND user_id = ?').get(wallet_id, user.id);
  if (!wallet) {
    req.flash('error', 'Please select a valid wallet address.');
    return res.redirect('/dashboard/withdraw');
  }

  if (source === 'wallet') {
    if (user.balance < amt) {
      req.flash('error', 'Insufficient wallet balance.');
      return res.redirect('/dashboard/withdraw');
    }
    db.prepare('UPDATE users SET balance = balance - ?, total_withdrawn = total_withdrawn + ? WHERE id = ?').run(amt, amt, user.id);
  } else {
    if (user.referral_balance < amt) {
      req.flash('error', 'Insufficient referral balance.');
      return res.redirect('/dashboard/withdraw');
    }
    db.prepare('UPDATE users SET referral_balance = referral_balance - ?, total_withdrawn = total_withdrawn + ? WHERE id = ?').run(amt, amt, user.id);
  }

  db.prepare(`
    INSERT INTO transactions (user_id, type, amount, status, wallet_address, note, txn_ref)
    VALUES (?, 'withdrawal', ?, 'pending', ?, ?, ?)
  `).run(user.id, amt, wallet.address, `Withdrawal to ${wallet.network} wallet`, `WD-${Date.now()}`);

  req.flash('success', `Withdrawal request of $${amt.toFixed(2)} submitted. Processing in 1–24 hours.`);
  res.redirect('/dashboard/withdraw');
};

exports.postAddWallet = (req, res) => {
  const db = getDb();
  const { label, address, network } = req.body;
  if (!label || !address || !network) {
    req.flash('error', 'All wallet fields are required.');
    return res.redirect('/dashboard/withdraw');
  }
  db.prepare(`
    INSERT INTO wallet_addresses (user_id, label, address, network) VALUES (?, ?, ?, ?)
  `).run(req.session.userId, label.trim(), address.trim(), network);
  req.flash('success', 'Wallet address added.');
  res.redirect('/dashboard/withdraw');
};

exports.getProfile = (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  res.render('dashboard/profile', {
    title: 'Profile',
    user,
    errors: req.flash('error'),
    success: req.flash('success')
  });
};

exports.postUpdateProfile = (req, res) => {
  const db = getDb();
  const { full_name, country } = req.body;
  if (!full_name) { req.flash('error', 'Name is required.'); return res.redirect('/dashboard/profile'); }
  db.prepare('UPDATE users SET full_name = ?, country = ? WHERE id = ?').run(full_name.trim(), country || 'Nigeria', req.session.userId);
  req.flash('success', 'Profile updated successfully.');
  res.redirect('/dashboard/profile');
};

exports.postChangePassword = async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { current_password, new_password, confirm_password } = req.body;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!(await bcrypt.compare(current_password, user.password))) {
    req.flash('error', 'Current password is incorrect.');
    return res.redirect('/dashboard/profile');
  }
  if (new_password !== confirm_password) {
    req.flash('error', 'New passwords do not match.');
    return res.redirect('/dashboard/profile');
  }
  if (new_password.length < 8) {
    req.flash('error', 'Password must be at least 8 characters.');
    return res.redirect('/dashboard/profile');
  }
  const hash = await bcrypt.hash(new_password, 12);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, user.id);
  req.flash('success', 'Password changed successfully.');
  res.redirect('/dashboard/profile');
};

exports.getDeposit = (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const depositWallets = db.prepare('SELECT * FROM deposit_wallets WHERE is_active = 1 ORDER BY sort_order').all();
  res.render('dashboard/deposit', {
    title: 'Make a Deposit',
    user,
    depositWallets,
    success: req.flash('success'),
    errors: req.flash('error')
  });
};

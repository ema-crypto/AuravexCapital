const { queryOne, query, run, getSetting, getKycSubmission } = require('../models/database');
const { currency, dateStr, timeAgo } = require('../helpers/format');
const mailer = require('../services/email');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

exports.getDashboard = async (req, res) => {
  const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  const activeInvestments = await query(`
    SELECT i.*, p.name as plan_name FROM investments i
    JOIN plans p ON i.plan_id = p.id
    WHERE i.user_id = ? AND i.status = 'active' ORDER BY i.created_at DESC LIMIT 5
  `, [user.id]);
  const activeTotal = activeInvestments.reduce((s, i) => s + Number(i.amount), 0);
  const recentTxns = await query('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 5', [user.id]);
  const refRow = await queryOne('SELECT COUNT(*) as c FROM referrals WHERE referrer_id = ? AND level = 1', [user.id]);
  res.render('dashboard/index', {
    title: 'Dashboard', user, activeInvestments, activeTotal, recentTxns,
    totalReferrals: Number(refRow.c),
    helpers: { currency, dateStr, timeAgo }
  });
};

exports.getPlans = async (req, res) => {
  const plans = await query('SELECT * FROM plans WHERE is_active = 1 ORDER BY sort_order');
  const user  = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  res.render('dashboard/plans', { title: 'Investment Plans', plans, user, helpers: { currency } });
};

exports.getInvestments = async (req, res) => {
  const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  const investments = await query(`
    SELECT i.*, p.name as plan_name FROM investments i
    JOIN plans p ON i.plan_id = p.id WHERE i.user_id = ? ORDER BY i.created_at DESC
  `, [user.id]);
  const totalInvested = investments.reduce((s, i) => s + Number(i.amount), 0);
  const activeCount   = investments.filter(i => i.status === 'active').length;
  const totalEarned   = investments.reduce((s, i) => s + Number(i.earned || 0), 0);
  res.render('dashboard/investments', {
    title: 'My Investments', user, investments, totalInvested, activeCount, totalEarned,
    helpers: { currency, dateStr }
  });
};

exports.postInvest = async (req, res) => {
  const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  if (!user.email_verified) {
    req.flash('error', 'Please verify your email address before investing. Check your inbox for the verification link.');
    return res.redirect('/dashboard');
  }
  const { plan_id, amount } = req.body;
  const plan = await queryOne('SELECT * FROM plans WHERE id = ? AND is_active = 1', [plan_id]);
  if (!plan) { req.flash('error', 'Invalid plan.'); return res.redirect('/dashboard/plans'); }
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt < Number(plan.min_amount)) {
    req.flash('error', `Minimum investment for this plan is $${plan.min_amount}.`);
    return res.redirect('/dashboard/plans');
  }
  if (plan.max_amount && amt > Number(plan.max_amount)) {
    req.flash('error', `Maximum investment for this plan is $${plan.max_amount}.`);
    return res.redirect('/dashboard/plans');
  }
  if (Number(user.balance) < amt) {
    req.flash('error', 'Insufficient balance. Please make a deposit first.');
    return res.redirect('/dashboard/deposit');
  }
  const endDate = new Date(Date.now() + Number(plan.term_days) * 86400000).toISOString();
  await run('UPDATE users SET balance = balance - ? WHERE id = ?', [amt, user.id]);
  await run('INSERT INTO investments (user_id,plan_id,amount,daily_percent,term_days,end_date) VALUES (?,?,?,?,?,?)', [user.id, plan.id, amt, plan.daily_percent, plan.term_days, endDate]);
  await run("INSERT INTO transactions (user_id,type,amount,status,note) VALUES (?,'investment',?,'completed',?)", [user.id, amt, `Invested in ${plan.name}`]);
  req.flash('success', `Investment of $${amt.toFixed(2)} in ${plan.name} created successfully!`);
  res.redirect('/dashboard/investments');
};

exports.postReinvest = async (req, res) => {
  const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  if (!user.email_verified) {
    req.flash('error', 'Please verify your email address before investing. Check your inbox for the verification link.');
    return res.redirect('/dashboard');
  }
  const { plan_id, amount } = req.body;
  const plan = await queryOne('SELECT * FROM plans WHERE id = ? AND is_active = 1', [plan_id]);
  if (!plan) { req.flash('error', 'Invalid plan.'); return res.redirect('/dashboard/plans?reinvest=1'); }
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt < Number(plan.min_amount)) {
    req.flash('error', `Minimum reinvestment is $${plan.min_amount}.`);
    return res.redirect('/dashboard/plans?reinvest=1');
  }
  if (plan.max_amount && amt > Number(plan.max_amount)) {
    req.flash('error', `Maximum for this plan is $${plan.max_amount}.`);
    return res.redirect('/dashboard/plans?reinvest=1');
  }
  if (Number(user.balance) < amt) {
    req.flash('error', 'Insufficient balance to reinvest.');
    return res.redirect('/dashboard/plans?reinvest=1');
  }
  const endDate = new Date(Date.now() + Number(plan.term_days) * 86400000).toISOString();
  await run('UPDATE users SET balance = balance - ? WHERE id = ?', [amt, user.id]);
  await run('INSERT INTO investments (user_id,plan_id,amount,daily_percent,term_days,end_date) VALUES (?,?,?,?,?,?)', [user.id, plan.id, amt, plan.daily_percent, plan.term_days, endDate]);
  await run("INSERT INTO transactions (user_id,type,amount,status,note) VALUES (?,'investment',?,'completed',?)", [user.id, amt, `Reinvested in ${plan.name}`]);
  req.flash('success', `Reinvestment of $${amt.toFixed(2)} in ${plan.name} placed!`);
  res.redirect('/dashboard/investments');
};

exports.getHistory = async (req, res) => {
  const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  const transactions = await query('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC', [user.id]);
  res.render('dashboard/history', { title: 'Transaction History', user, transactions, helpers: { currency, dateStr, timeAgo } });
};

exports.getWithdraw = async (req, res) => {
  const user      = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  const wallets   = await query('SELECT * FROM wallet_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC', [user.id]);
  const withdrawals = await query("SELECT * FROM transactions WHERE user_id = ? AND type = 'withdrawal' ORDER BY created_at DESC LIMIT 20", [user.id]);
  const refRow    = await queryOne('SELECT COUNT(*) as c FROM referrals WHERE referrer_id = ? AND level = 1', [user.id]);
  res.render('dashboard/withdraw', {
    title: 'Withdraw Funds', user, wallets, withdrawals,
    totalReferrals: Number(refRow.c),
    errors: req.flash('error'), success: req.flash('success'),
    helpers: { currency, dateStr, timeAgo }
  });
};

exports.postWithdraw = async (req, res) => {
  const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  const { source, amount, wallet_id } = req.body;
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) { req.flash('error', 'Enter a valid amount.'); return res.redirect('/dashboard/withdraw'); }

  const wallet = await queryOne('SELECT * FROM wallet_addresses WHERE id = ? AND user_id = ?', [wallet_id, user.id]);
  if (!wallet) { req.flash('error', 'Please select a valid wallet address.'); return res.redirect('/dashboard/withdraw'); }

  if (source === 'wallet') {
    if (Number(user.balance) < amt) { req.flash('error', 'Insufficient wallet balance.'); return res.redirect('/dashboard/withdraw'); }
    await run('UPDATE users SET balance = balance - ?, total_withdrawn = total_withdrawn + ? WHERE id = ?', [amt, amt, user.id]);
  } else {
    if (Number(user.referral_balance) < amt) { req.flash('error', 'Insufficient referral balance.'); return res.redirect('/dashboard/withdraw'); }
    await run('UPDATE users SET referral_balance = referral_balance - ?, total_withdrawn = total_withdrawn + ? WHERE id = ?', [amt, amt, user.id]);
  }

  const autoLimit = parseFloat((await getSetting('auto_withdrawal_limit')) || '0');
  const status    = (autoLimit > 0 && amt <= autoLimit) ? 'completed' : 'pending';
  const txnRef    = `WD-${Date.now()}`;

  await run(
    "INSERT INTO transactions (user_id,type,amount,status,wallet_address,note,txn_ref) VALUES (?,'withdrawal',?,?,?,?,?)",
    [user.id, amt, status, wallet.address, `Withdrawal to ${wallet.network} wallet`, txnRef]
  );

  mailer.sendWithdrawalSubmitted(user.email, user.full_name, amt.toFixed(2), wallet.address, txnRef).catch(() => {});

  if (status === 'completed') {
    req.flash('success', `Withdrawal of $${amt.toFixed(2)} approved and processed automatically.`);
  } else {
    req.flash('success', `Withdrawal of $${amt.toFixed(2)} submitted. Processing in 1–24 hours.`);
  }
  res.redirect('/dashboard/withdraw');
};

exports.postAddWallet = async (req, res) => {
  const { label, address, network } = req.body;
  if (!label || !address || !network) { req.flash('error', 'All wallet fields are required.'); return res.redirect('/dashboard/withdraw'); }
  await run('INSERT INTO wallet_addresses (user_id,label,address,network) VALUES (?,?,?,?)', [req.session.userId, label.trim(), address.trim(), network]);
  req.flash('success', 'Wallet address added.');
  res.redirect('/dashboard/withdraw');
};

exports.getProfile = async (req, res) => {
  const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  res.render('dashboard/profile', { title: 'Profile', user, errors: req.flash('error'), success: req.flash('success') });
};

exports.postUpdateProfile = async (req, res) => {
  const { full_name, country } = req.body;
  if (!full_name) { req.flash('error', 'Name is required.'); return res.redirect('/dashboard/profile'); }
  await run('UPDATE users SET full_name = ?, country = ? WHERE id = ?', [full_name.trim(), country || 'Nigeria', req.session.userId]);
  req.flash('success', 'Profile updated successfully.');
  res.redirect('/dashboard/profile');
};

exports.postChangePassword = async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { current_password, new_password, confirm_password } = req.body;
  const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  if (!(await bcrypt.compare(current_password, user.password))) {
    req.flash('error', 'Current password is incorrect.'); return res.redirect('/dashboard/profile');
  }
  if (new_password !== confirm_password) { req.flash('error', 'New passwords do not match.'); return res.redirect('/dashboard/profile'); }
  if (new_password.length < 8) { req.flash('error', 'Password must be at least 8 characters.'); return res.redirect('/dashboard/profile'); }
  const hash = await bcrypt.hash(new_password, 12);
  await run('UPDATE users SET password = ? WHERE id = ?', [hash, req.session.userId]);
  req.flash('success', 'Password changed successfully.');
  res.redirect('/dashboard/profile');
};

exports.getDeposit = async (req, res) => {
  const user         = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  const depositWallets = await query('SELECT * FROM deposit_wallets WHERE is_active = 1 ORDER BY sort_order');
  res.render('dashboard/deposit', { title: 'Make a Deposit', user, depositWallets, success: req.flash('success'), errors: req.flash('error') });
};

exports.postDepositConfirm = async (req, res) => {
  const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  const { coin, amount, txn_hash } = req.body;
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) { req.flash('error', 'Enter a valid deposit amount.'); return res.redirect('/dashboard/deposit'); }
  const txnRef = `DEP-${Date.now()}`;
  await run(
    "INSERT INTO transactions (user_id,type,amount,currency,status,txn_ref,note) VALUES (?,'deposit',?,?,'pending',?,?)",
    [user.id, amt, coin || 'USDT', txnRef, `Deposit via ${coin || 'crypto'}${txn_hash ? ' · Hash: ' + txn_hash : ''}`]
  );
  mailer.sendDepositPending(user.email, user.full_name, amt.toFixed(2), coin || 'Crypto', txnRef).catch(() => {});
  req.flash('success', 'Deposit submitted! We will confirm and credit your balance within 30–60 minutes.');
  res.redirect('/dashboard/deposit');
};

exports.getKyc = async (req, res) => {
  const user       = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  const submission = await getKycSubmission(user.id);
  res.render('dashboard/kyc', { title: 'KYC Verification', user, submission, errors: req.flash('error'), success: req.flash('success') });
};

exports.postKyc = [
  upload.fields([
    { name: 'front_image',  maxCount: 1 },
    { name: 'back_image',   maxCount: 1 },
    { name: 'selfie_image', maxCount: 1 },
  ]),
  async (req, res) => {
    const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    const existing = await getKycSubmission(user.id);
    if (existing && existing.status === 'pending')  { req.flash('error', 'Your KYC is already under review.');  return res.redirect('/dashboard/kyc'); }
    if (existing && existing.status === 'approved') { req.flash('error', 'Your KYC is already approved.');      return res.redirect('/dashboard/kyc'); }

    const { doc_type, doc_number, dob, country_of_issue } = req.body;
    if (!doc_type || !doc_number || !dob || !country_of_issue) {
      req.flash('error', 'All fields are required.'); return res.redirect('/dashboard/kyc');
    }

    await run(
      'INSERT INTO kyc_submissions (user_id,doc_type,doc_number,dob,country_of_issue) VALUES (?,?,?,?,?)',
      [user.id, doc_type, doc_number.trim(), dob, country_of_issue]
    );
    await run("UPDATE users SET kyc_status = 'pending' WHERE id = ?", [user.id]);
    req.flash('success', 'KYC submitted! Review takes 1–3 business days. Please email your document photos to kyc@auravexcapital.ltd with your reference number.');
    res.redirect('/dashboard/kyc');
  },
];

exports.getReferrals = async (req, res) => {
  const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  const referrals = await query(`
    SELECT u.full_name, u.email, r.level, r.commission, r.created_at
    FROM referrals r JOIN users u ON r.referred_id = u.id
    WHERE r.referrer_id = ? ORDER BY r.created_at DESC
  `, [user.id]);
  const l1Row = await queryOne('SELECT COUNT(*) as c FROM referrals WHERE referrer_id = ? AND level = 1', [user.id]);
  const l2Row = await queryOne('SELECT COUNT(*) as c FROM referrals WHERE referrer_id = ? AND level = 2', [user.id]);
  const l3Row = await queryOne('SELECT COUNT(*) as c FROM referrals WHERE referrer_id = ? AND level = 3', [user.id]);
  const totalCommission = referrals.reduce((s, r) => s + Number(r.commission || 0), 0);
  const siteUrl = process.env.SITE_URL || 'https://auravex-capital.vercel.app';
  const referralLink = `${siteUrl}/register?ref=${user.referral_code}`;
  res.render('dashboard/referrals', {
    title: 'Referral Program', user, referrals,
    l1: Number(l1Row.c), l2: Number(l2Row.c), l3: Number(l3Row.c),
    totalCommission, referralLink,
    helpers: { currency, dateStr }
  });
};

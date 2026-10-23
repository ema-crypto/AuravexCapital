const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');
const path = require('path');

let _client = null;
let _initPromise = null;

function _buildUrl() {
  if (process.env.TURSO_DATABASE_URL) return process.env.TURSO_DATABASE_URL;
  if (process.env.VERCEL) return 'file:/tmp/auravexcapital.db';
  return 'file:' + path.join(__dirname, '../../data/auravexcapital.db');
}

function _getClient() {
  if (!_client) {
    _client = createClient({ url: _buildUrl(), authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return _client;
}

async function getDb() {
  const client = _getClient();
  if (!_initPromise) {
    _initPromise = _initSchema(client).catch(err => { _initPromise = null; throw err; });
  }
  await _initPromise;
  return client;
}

async function query(sql, args = []) {
  const db = await getDb();
  const { rows } = await db.execute({ sql, args });
  return rows;
}

async function queryOne(sql, args = []) {
  const rows = await query(sql, args);
  return rows[0] || null;
}

async function run(sql, args = []) {
  const db = await getDb();
  const r = await db.execute({ sql, args });
  return { lastInsertRowid: Number(r.lastInsertRowid), rowsAffected: r.rowsAffected };
}

async function getSetting(key) {
  const row = await queryOne('SELECT value FROM site_settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

async function getKycSubmission(userId) {
  return queryOne(
    'SELECT * FROM kyc_submissions WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 1',
    [userId]
  );
}

async function _initSchema(db) {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      country TEXT DEFAULT 'Nigeria',
      email_verified INTEGER DEFAULT 0,
      is_admin INTEGER DEFAULT 0,
      is_suspended INTEGER DEFAULT 0,
      kyc_status TEXT DEFAULT 'none',
      referral_code TEXT UNIQUE NOT NULL,
      referred_by INTEGER REFERENCES users(id),
      balance REAL DEFAULT 0,
      referral_balance REAL DEFAULT 0,
      total_deposited REAL DEFAULT 0,
      total_withdrawn REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      label TEXT NOT NULL,
      daily_percent REAL NOT NULL,
      term_days INTEGER NOT NULL,
      min_amount REAL NOT NULL,
      max_amount REAL,
      deposit_returned INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      is_promo INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS investments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      plan_id INTEGER NOT NULL REFERENCES plans(id),
      amount REAL NOT NULL,
      daily_percent REAL NOT NULL,
      term_days INTEGER NOT NULL,
      earned REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      end_date DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USDT',
      status TEXT DEFAULT 'pending',
      txn_ref TEXT,
      wallet_address TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS wallet_addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      label TEXT NOT NULL,
      address TEXT NOT NULL,
      network TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id INTEGER NOT NULL REFERENCES users(id),
      referred_id INTEGER NOT NULL REFERENCES users(id),
      level INTEGER NOT NULL DEFAULT 1,
      commission REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS deposit_wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      network TEXT UNIQUE NOT NULL,
      symbol TEXT NOT NULL,
      address TEXT NOT NULL,
      label TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      sender TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kyc_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      doc_type TEXT NOT NULL,
      doc_number TEXT NOT NULL,
      dob TEXT NOT NULL,
      country_of_issue TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      rejection_reason TEXT,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME
    );
  `);

  await _runMigrations(db);
  await _seedPlans(db);
  await _seedDepositWallets(db);
  await _seedAdmin(db);
  await _seedSiteSettings(db);
}

async function _runMigrations(db) {
  const ucols = (await db.execute('PRAGMA table_info(users)')).rows.map(r => r.name);
  if (!ucols.includes('is_admin'))     await db.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0");
  if (!ucols.includes('is_suspended')) await db.execute("ALTER TABLE users ADD COLUMN is_suspended INTEGER DEFAULT 0");
  if (!ucols.includes('kyc_status'))   await db.execute("ALTER TABLE users ADD COLUMN kyc_status TEXT DEFAULT 'none'");

  if (!ucols.includes('verification_token'))   await db.execute("ALTER TABLE users ADD COLUMN verification_token TEXT");
  if (!ucols.includes('verification_expires')) await db.execute("ALTER TABLE users ADD COLUMN verification_expires DATETIME");

  const pcols = (await db.execute('PRAGMA table_info(plans)')).rows.map(r => r.name);
  if (!pcols.includes('is_promo')) await db.execute("ALTER TABLE plans ADD COLUMN is_promo INTEGER DEFAULT 0");

  const bnb = (await db.execute("SELECT id FROM deposit_wallets WHERE network = 'BNB'")).rows;
  if (!bnb.length) {
    await db.execute({ sql: "INSERT INTO deposit_wallets (network,symbol,address,label,sort_order) VALUES (?,?,?,?,?)", args: ['BNB','BNB','0x71C7656EC7ab88b098defB751B7401B5f6d8976F','BNB Smart Chain',10] });
  }

  const usdtTrc = (await db.execute("SELECT id FROM deposit_wallets WHERE network = 'USDT-TRC20'")).rows;
  if (!usdtTrc.length) {
    await db.execute({ sql: "INSERT INTO deposit_wallets (network,symbol,address,label,sort_order) VALUES (?,?,?,?,?)", args: ['USDT-TRC20','USDT','TXFBqBbqJommqZf67GQFGAnrisNQGGZhh5','Tether (TRC20)',3] });
  }

  await db.execute("INSERT OR IGNORE INTO site_settings (key,value) VALUES ('auto_withdrawal_limit','0')");
  await db.execute("INSERT OR IGNORE INTO site_settings (key,value) VALUES ('promo_active','0')");
  await db.execute("INSERT OR IGNORE INTO site_settings (key,value) VALUES ('tawkto_id','')");
}

async function _seedPlans(db) {
  const { rows } = await db.execute('SELECT COUNT(*) as c FROM plans');
  const count = Number(rows[0].c);
  const plans = [
    { name:'Starter Plan',  label:'STARTER',  daily_percent:4.5, term_days:7,  min_amount:50,    max_amount:499,  deposit_returned:1, is_promo:0, sort_order:1 },
    { name:'Velocity Plan', label:'VELOCITY', daily_percent:7,   term_days:10, min_amount:500,   max_amount:2499, deposit_returned:0, is_promo:0, sort_order:2 },
    { name:'Apex Plan',     label:'APEX',     daily_percent:11,  term_days:14, min_amount:2500,  max_amount:9999, deposit_returned:0, is_promo:0, sort_order:3 },
    { name:'Titan Plan',    label:'TITAN',    daily_percent:16,  term_days:21, min_amount:10000, max_amount:null, deposit_returned:0, is_promo:0, sort_order:4 },
    { name:'Flash Promo',   label:'PROMO',    daily_percent:100, term_days:2,  min_amount:1000,  max_amount:15000, deposit_returned:1, is_promo:1, sort_order:5 },
  ];
  if (count === 0) {
    for (const p of plans) {
      await db.execute({ sql:'INSERT INTO plans (name,label,daily_percent,term_days,min_amount,max_amount,deposit_returned,is_promo,sort_order) VALUES (?,?,?,?,?,?,?,?,?)', args:[p.name,p.label,p.daily_percent,p.term_days,p.min_amount,p.max_amount,p.deposit_returned,p.is_promo,p.sort_order] });
    }
  } else {
    for (const p of plans) {
      await db.execute({ sql:'UPDATE plans SET name=?,label=?,daily_percent=?,term_days=?,min_amount=?,max_amount=?,deposit_returned=?,is_promo=? WHERE sort_order=?', args:[p.name,p.label,p.daily_percent,p.term_days,p.min_amount,p.max_amount,p.deposit_returned,p.is_promo,p.sort_order] });
    }
    const promo = (await db.execute("SELECT id FROM plans WHERE is_promo=1")).rows;
    if (!promo.length) {
      const p = plans[4];
      await db.execute({ sql:'INSERT INTO plans (name,label,daily_percent,term_days,min_amount,max_amount,deposit_returned,is_promo,sort_order) VALUES (?,?,?,?,?,?,?,?,?)', args:[p.name,p.label,p.daily_percent,p.term_days,p.min_amount,p.max_amount,p.deposit_returned,p.is_promo,p.sort_order] });
    }
  }
}

async function _seedDepositWallets(db) {
  const wallets = [
    ['BTC','BTC','bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh','Bitcoin',1],
    ['ETH','ETH','0x71C7656EC7ab88b098defB751B7401B5f6d8976F','Ethereum',2],
    ['USDT-TRC20','USDT','TXFBqBbqJommqZf67GQFGAnrisNQGGZhh5','Tether (TRC20)',3],
    ['USDT-ERC20','USDT','0x71C7656EC7ab88b098defB751B7401B5f6d8976F','Tether (ERC20)',4],
    ['LTC','LTC','ltc1qhkgq8qx2lgez6kehvecnfhm5vvn5jmxsme46qc','Litecoin',5],
    ['DOGE','DOGE','DBXu2kgc3xtvCUWFcxFE3r9hEYgmuaaCyD','Dogecoin',6],
    ['TRX','TRX','TXFBqBbqJommqZf67GQFGAnrisNQGGZhh5','Tron',7],
    ['XRP','XRP','rN7n3473SaZBCG4dFL83w7PB5AMgGCgyQE','Ripple',8],
    ['DASH','DASH','XpESxaUmonkq8RaLLp46Brx2K39ggQe226','Dash',9],
    ['BNB','BNB','0x71C7656EC7ab88b098defB751B7401B5f6d8976F','BNB Smart Chain',10],
  ];
  for (const w of wallets) {
    await db.execute({ sql:'INSERT OR IGNORE INTO deposit_wallets (network,symbol,address,label,sort_order) VALUES (?,?,?,?,?)', args: w });
  }
}

async function _seedAdmin(db) {
  const { rows } = await db.execute('SELECT id FROM users WHERE is_admin = 1');
  if (rows.length > 0) return;
  const hash = await bcrypt.hash('Admin@2025!', 12);
  const code = 'ADMIN' + Math.random().toString(36).substr(2,6).toUpperCase();
  await db.execute({ sql:"INSERT INTO users (full_name,email,password,country,referral_code,is_admin,email_verified) VALUES (?,?,?,?,?,1,1)", args:['Site Administrator','admin@auravexcapital.ltd',hash,'United Kingdom',code] });
}

async function _seedSiteSettings(db) {
  const settings = [
    ['whatsapp_number','+447911123456'],['site_name','AuravexCapital'],
    ['support_email','support@auravexcapital.ltd'],['min_withdrawal','10'],
    ['withdrawal_fee_pct','0'],['auto_withdrawal_limit','0'],['tawkto_id',''],
  ];
  for (const [key,value] of settings) {
    await db.execute({ sql:'INSERT OR IGNORE INTO site_settings (key,value) VALUES (?,?)', args:[key,value] });
  }
}

module.exports = { getDb, query, queryOne, run, getSetting, getKycSubmission };

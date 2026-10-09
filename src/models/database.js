const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '../../data/auravexcapital.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      country TEXT DEFAULT 'Nigeria',
      email_verified INTEGER DEFAULT 0,
      is_admin INTEGER DEFAULT 0,
      is_suspended INTEGER DEFAULT 0,
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
  `);

  // Run migrations for existing DBs (add columns if missing)
  runMigrations();
  seedPlans();
  seedDepositWallets();
  seedAdmin();
  seedSiteSettings();
}

function runMigrations() {
  // Add is_admin and is_suspended if they don't exist
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!cols.includes('is_admin'))     db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0");
  if (!cols.includes('is_suspended')) db.exec("ALTER TABLE users ADD COLUMN is_suspended INTEGER DEFAULT 0");
}

function seedPlans() {
  const count = db.prepare('SELECT COUNT(*) as c FROM plans').get();
  if (count.c > 0) return;

  const insert = db.prepare(`
    INSERT INTO plans (name, label, daily_percent, term_days, min_amount, max_amount, deposit_returned, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run('Start Plan',   'START',   6,  5,   50,    500,  1, 1);
  insert.run('Basic Plan',   'BASIC',   8,  7,  500,   1000,  0, 2);
  insert.run('Silver Plan',  'SILVER',  12, 9,  1000,  4000,  0, 3);
  insert.run('Premium Plan', 'PREMIUM', 16, 11, 4000,  null,  0, 4);
}

function seedDepositWallets() {
  const count = db.prepare('SELECT COUNT(*) as c FROM deposit_wallets').get();
  if (count.c > 0) return;

  const insert = db.prepare(`
    INSERT INTO deposit_wallets (network, symbol, address, label, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Placeholder addresses — admin should update these in the panel
  insert.run('BTC',        'BTC',  'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',  'Bitcoin',         1);
  insert.run('ETH',        'ETH',  '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',  'Ethereum',        2);
  insert.run('USDT-TRC20', 'USDT', 'TXFBqBbqJommqZf67GQFGAnrisNQGGZhh5',          'Tether (TRC20)',   3);
  insert.run('USDT-ERC20', 'USDT', '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',  'Tether (ERC20)',   4);
  insert.run('LTC',        'LTC',  'ltc1qhkgq8qx2lgez6kehvecnfhm5vvn5jmxsme46qc', 'Litecoin',        5);
  insert.run('DOGE',       'DOGE', 'DBXu2kgc3xtvCUWFcxFE3r9hEYgmuaaCyD',           'Dogecoin',        6);
  insert.run('TRX',        'TRX',  'TXFBqBbqJommqZf67GQFGAnrisNQGGZhh5',           'Tron',            7);
  insert.run('XRP',        'XRP',  'rN7n3473SaZBCG4dFL83w7PB5AMgGCgyQE',           'Ripple',          8);
  insert.run('DASH',       'DASH', 'XpESxaUmonkq8RaLLp46Brx2K39ggQe226',           'Dash',            9);
}

function seedAdmin() {
  const existing = db.prepare("SELECT id FROM users WHERE is_admin = 1").get();
  if (existing) return;

  const hash = bcrypt.hashSync('Admin@2025!', 12);
  const code = 'ADMIN' + Math.random().toString(36).substr(2, 6).toUpperCase();

  db.prepare(`
    INSERT INTO users (full_name, email, password, country, referral_code, is_admin, email_verified)
    VALUES ('Site Administrator', 'admin@auravexcapital.ltd', ?, 'United Kingdom', ?, 1, 1)
  `).run(hash, code);
}

function seedSiteSettings() {
  const upsert = db.prepare(`
    INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)
  `);
  upsert.run('whatsapp_number', '+447911123456');
  upsert.run('site_name', 'AuravexCapital');
  upsert.run('support_email', 'support@auravexcapital.ltd');
  upsert.run('min_withdrawal', '10');
  upsert.run('withdrawal_fee_pct', '0');
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

module.exports = { getDb, getSetting };

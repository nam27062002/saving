const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'expenses.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      category TEXT DEFAULT 'Other',
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      date TEXT DEFAULT (date('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_expenses_user_date 
      ON expenses(user_id, date);

    CREATE INDEX IF NOT EXISTS idx_expenses_user_category 
      ON expenses(user_id, category);

    CREATE TABLE IF NOT EXISTS pairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      partner_id INTEGER,
      invite_code TEXT,
      user_name TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_pairs_invite_code
      ON pairs(invite_code);

    CREATE INDEX IF NOT EXISTS idx_pairs_user_id
      ON pairs(user_id);
  `);
}

function createInviteCode(userId, userName) {
  const code = crypto.randomBytes(3).toString('hex').toUpperCase();
  const existing = getDb().prepare('SELECT * FROM pairs WHERE user_id = ?').get(userId);

  if (existing && existing.partner_id) {
    return { error: 'already_linked', partnerId: existing.partner_id };
  }

  if (existing) {
    getDb().prepare('UPDATE pairs SET invite_code = ?, user_name = ? WHERE user_id = ?')
      .run(code, userName, userId);
  } else {
    getDb().prepare('INSERT INTO pairs (user_id, invite_code, user_name) VALUES (?, ?, ?)')
      .run(userId, code, userName);
  }

  return { code };
}

function linkWithCode(userId, userName, code) {
  code = code.toUpperCase().trim();

  const selfPair = getDb().prepare('SELECT * FROM pairs WHERE user_id = ?').get(userId);
  if (selfPair && selfPair.partner_id) {
    return { error: 'already_linked', partnerId: selfPair.partner_id };
  }

  const inviter = getDb().prepare('SELECT * FROM pairs WHERE invite_code = ?').get(code);
  if (!inviter) {
    return { error: 'invalid_code' };
  }

  if (inviter.user_id === userId) {
    return { error: 'self_link' };
  }

  if (inviter.partner_id) {
    return { error: 'code_used' };
  }

  const linkTransaction = getDb().transaction(() => {
    getDb().prepare('UPDATE pairs SET partner_id = ?, invite_code = NULL WHERE user_id = ?')
      .run(userId, inviter.user_id);

    if (selfPair) {
      getDb().prepare('UPDATE pairs SET partner_id = ?, invite_code = NULL, user_name = ? WHERE user_id = ?')
        .run(inviter.user_id, userName, userId);
    } else {
      getDb().prepare('INSERT INTO pairs (user_id, partner_id, user_name) VALUES (?, ?, ?)')
        .run(userId, inviter.user_id, userName);
    }
  });

  linkTransaction();
  return { success: true, partnerName: inviter.user_name, partnerId: inviter.user_id };
}

function unlinkPair(userId) {
  const pair = getDb().prepare('SELECT * FROM pairs WHERE user_id = ?').get(userId);
  if (!pair || !pair.partner_id) {
    return { error: 'not_linked' };
  }

  const partnerId = pair.partner_id;
  const partnerName = getPartnerName(userId);

  const unlinkTransaction = getDb().transaction(() => {
    getDb().prepare('UPDATE pairs SET partner_id = NULL WHERE user_id = ?').run(userId);
    getDb().prepare('UPDATE pairs SET partner_id = NULL WHERE user_id = ?').run(partnerId);
  });

  unlinkTransaction();
  return { success: true, partnerId, partnerName };
}

function getPartnerInfo(userId) {
  const pair = getDb().prepare('SELECT * FROM pairs WHERE user_id = ?').get(userId);
  if (!pair || !pair.partner_id) return null;

  const partner = getDb().prepare('SELECT * FROM pairs WHERE user_id = ?').get(pair.partner_id);
  return partner ? { id: partner.user_id, name: partner.user_name } : null;
}

function getPartnerName(userId) {
  const partner = getPartnerInfo(userId);
  return partner ? partner.name : null;
}

function getUserName(userId) {
  const pair = getDb().prepare('SELECT user_name FROM pairs WHERE user_id = ?').get(userId);
  return pair ? pair.user_name : '';
}

function getGroupUserIds(userId) {
  const pair = getDb().prepare('SELECT partner_id FROM pairs WHERE user_id = ?').get(userId);
  if (pair && pair.partner_id) {
    return [userId, pair.partner_id];
  }
  return [userId];
}

function inPlaceholders(ids) {
  return ids.map(() => '?').join(',');
}

function addExpense(userId, amount, description, category = 'Other') {
  const stmt = getDb().prepare(`
    INSERT INTO expenses (user_id, amount, description, category)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(userId, amount, description, category);
  return result.lastInsertRowid;
}

function deleteExpense(userId, expenseId) {
  const userIds = getGroupUserIds(userId);
  const stmt = getDb().prepare(`
    DELETE FROM expenses WHERE id = ? AND user_id IN (${inPlaceholders(userIds)})
  `);
  const result = stmt.run(expenseId, ...userIds);
  return result.changes > 0;
}

function getTodayExpenses(userId) {
  const userIds = getGroupUserIds(userId);
  const stmt = getDb().prepare(`
    SELECT id, user_id, amount, description, category, created_at
    FROM expenses
    WHERE user_id IN (${inPlaceholders(userIds)}) AND date = date('now', 'localtime')
    ORDER BY created_at DESC
  `);
  return stmt.all(...userIds);
}

function getTodayTotal(userId) {
  const userIds = getGroupUserIds(userId);
  const stmt = getDb().prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM expenses
    WHERE user_id IN (${inPlaceholders(userIds)}) AND date = date('now', 'localtime')
  `);
  return stmt.get(...userIds).total;
}

function getWeekExpenses(userId) {
  const userIds = getGroupUserIds(userId);
  const stmt = getDb().prepare(`
    SELECT id, user_id, amount, description, category, date, created_at
    FROM expenses
    WHERE user_id IN (${inPlaceholders(userIds)}) 
      AND date >= date('now', 'localtime', 'weekday 1', '-7 days')
      AND date <= date('now', 'localtime')
    ORDER BY date DESC, created_at DESC
  `);
  return stmt.all(...userIds);
}

function getWeekTotal(userId) {
  const userIds = getGroupUserIds(userId);
  const stmt = getDb().prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM expenses
    WHERE user_id IN (${inPlaceholders(userIds)}) 
      AND date >= date('now', 'localtime', 'weekday 1', '-7 days')
      AND date <= date('now', 'localtime')
  `);
  return stmt.get(...userIds).total;
}

function getMonthExpenses(userId) {
  const userIds = getGroupUserIds(userId);
  const stmt = getDb().prepare(`
    SELECT id, user_id, amount, description, category, date, created_at
    FROM expenses
    WHERE user_id IN (${inPlaceholders(userIds)}) 
      AND strftime('%Y-%m', date) = strftime('%Y-%m', date('now', 'localtime'))
    ORDER BY date DESC, created_at DESC
  `);
  return stmt.all(...userIds);
}

function getMonthTotal(userId) {
  const userIds = getGroupUserIds(userId);
  const stmt = getDb().prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM expenses
    WHERE user_id IN (${inPlaceholders(userIds)}) 
      AND strftime('%Y-%m', date) = strftime('%Y-%m', date('now', 'localtime'))
  `);
  return stmt.get(...userIds).total;
}

function getMonthCategoryStats(userId) {
  const userIds = getGroupUserIds(userId);
  const stmt = getDb().prepare(`
    SELECT category, 
           SUM(amount) as total, 
           COUNT(*) as count
    FROM expenses
    WHERE user_id IN (${inPlaceholders(userIds)}) 
      AND strftime('%Y-%m', date) = strftime('%Y-%m', date('now', 'localtime'))
    GROUP BY category
    ORDER BY total DESC
  `);
  return stmt.all(...userIds);
}

function getMonthDailyStats(userId) {
  const userIds = getGroupUserIds(userId);
  const stmt = getDb().prepare(`
    SELECT date, SUM(amount) as total
    FROM expenses
    WHERE user_id IN (${inPlaceholders(userIds)}) 
      AND strftime('%Y-%m', date) = strftime('%Y-%m', date('now', 'localtime'))
    GROUP BY date
    ORDER BY date ASC
  `);
  return stmt.all(...userIds);
}

function getRecentExpenses(userId, limit = 10) {
  const userIds = getGroupUserIds(userId);
  const stmt = getDb().prepare(`
    SELECT id, user_id, amount, description, category, date, created_at
    FROM expenses
    WHERE user_id IN (${inPlaceholders(userIds)})
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(...userIds, limit);
}

function getMonthlyOverview(userId) {
  const userIds = getGroupUserIds(userId);
  const stmt = getDb().prepare(`
    SELECT strftime('%Y-%m', date) as month,
           SUM(amount) as total,
           COUNT(*) as count
    FROM expenses
    WHERE user_id IN (${inPlaceholders(userIds)})
      AND date >= date('now', 'localtime', '-12 months')
    GROUP BY month
    ORDER BY month DESC
  `);
  return stmt.all(...userIds);
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  addExpense,
  deleteExpense,
  getTodayExpenses,
  getTodayTotal,
  getWeekExpenses,
  getWeekTotal,
  getMonthExpenses,
  getMonthTotal,
  getMonthCategoryStats,
  getMonthDailyStats,
  getRecentExpenses,
  getMonthlyOverview,
  createInviteCode,
  linkWithCode,
  unlinkPair,
  getPartnerInfo,
  getPartnerName,
  getUserName,
  getGroupUserIds,
  closeDb,
};

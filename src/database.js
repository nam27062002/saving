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
      original_amount REAL,
      original_currency TEXT,
      description TEXT,
      category TEXT DEFAULT 'Other',
      tags TEXT DEFAULT '',
      photo_id TEXT,
      is_split INTEGER DEFAULT 0,
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

    CREATE INDEX IF NOT EXISTS idx_pairs_invite_code ON pairs(invite_code);
    CREATE INDEX IF NOT EXISTS idx_pairs_user_id ON pairs(user_id);

    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      month TEXT NOT NULL,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      UNIQUE(user_id, month)
    );

    CREATE INDEX IF NOT EXISTS idx_budgets_user_month ON budgets(user_id, month);

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      chat_id INTEGER NOT NULL,
      reminder_time TEXT NOT NULL DEFAULT '21:00',
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS recurring (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      category TEXT DEFAULT 'Other',
      day_of_month INTEGER NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_run TEXT,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_recurring_user ON recurring(user_id);
  `);

  migrateDb();
}

function migrateDb() {
  const columns = db.prepare("PRAGMA table_info(expenses)").all().map(c => c.name);

  const migrations = [
    { col: 'original_amount', sql: 'ALTER TABLE expenses ADD COLUMN original_amount REAL' },
    { col: 'original_currency', sql: 'ALTER TABLE expenses ADD COLUMN original_currency TEXT' },
    { col: 'tags', sql: "ALTER TABLE expenses ADD COLUMN tags TEXT DEFAULT ''" },
    { col: 'photo_id', sql: 'ALTER TABLE expenses ADD COLUMN photo_id TEXT' },
    { col: 'is_split', sql: 'ALTER TABLE expenses ADD COLUMN is_split INTEGER DEFAULT 0' },
  ];

  migrations.forEach(({ col, sql }) => {
    if (!columns.includes(col)) {
      db.exec(sql);
      console.log(`Migration: added column '${col}' to expenses table.`);
    }
  });
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
  if (!inviter) return { error: 'invalid_code' };
  if (inviter.user_id === userId) return { error: 'self_link' };
  if (inviter.partner_id) return { error: 'code_used' };

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
  if (!pair || !pair.partner_id) return { error: 'not_linked' };

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
  if (pair && pair.partner_id) return [userId, pair.partner_id];
  return [userId];
}

function inPlaceholders(ids) {
  return ids.map(() => '?').join(',');
}

function addExpense(userId, amount, description, category = 'Other', options = {}) {
  const stmt = getDb().prepare(`
    INSERT INTO expenses (user_id, amount, original_amount, original_currency, description, category, tags, photo_id, is_split, date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const date = options.date || new Date().toISOString().split('T')[0];
  const result = stmt.run(
    userId, amount,
    options.originalAmount || null,
    options.originalCurrency || null,
    description, category,
    options.tags || '',
    options.photoId || null,
    options.isSplit ? 1 : 0,
    date
  );
  return result.lastInsertRowid;
}

function setExpensePhoto(expenseId, photoId) {
  getDb().prepare('UPDATE expenses SET photo_id = ? WHERE id = ?').run(photoId, expenseId);
}

function getExpenseById(expenseId) {
  return getDb().prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId);
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
    SELECT id, user_id, amount, description, category, tags, is_split, photo_id, created_at
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
    SELECT id, user_id, amount, description, category, tags, is_split, date, created_at
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
    SELECT id, user_id, amount, description, category, tags, is_split, date, created_at
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
    SELECT category, SUM(amount) as total, COUNT(*) as count
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
    SELECT id, user_id, amount, description, category, tags, is_split, date, created_at
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
    SELECT strftime('%Y-%m', date) as month, SUM(amount) as total, COUNT(*) as count
    FROM expenses
    WHERE user_id IN (${inPlaceholders(userIds)})
      AND date >= date('now', 'localtime', '-12 months')
    GROUP BY month
    ORDER BY month DESC
  `);
  return stmt.all(...userIds);
}

function getExpensesByTag(userId, tag) {
  const userIds = getGroupUserIds(userId);
  const stmt = getDb().prepare(`
    SELECT id, user_id, amount, description, category, tags, is_split, date, created_at
    FROM expenses
    WHERE user_id IN (${inPlaceholders(userIds)}) AND tags LIKE ?
    ORDER BY date DESC, created_at DESC
    LIMIT 50
  `);
  return stmt.all(...userIds, `%${tag}%`);
}

function getExpensesByMonth(userId, yearMonth) {
  const userIds = getGroupUserIds(userId);
  const stmt = getDb().prepare(`
    SELECT id, user_id, amount, description, category, tags, is_split, date, created_at
    FROM expenses
    WHERE user_id IN (${inPlaceholders(userIds)}) 
      AND strftime('%Y-%m', date) = ?
    ORDER BY date ASC, created_at ASC
  `);
  return stmt.all(...userIds, yearMonth);
}

function getPreviousMonthTotal(userId) {
  const userIds = getGroupUserIds(userId);
  const stmt = getDb().prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM expenses
    WHERE user_id IN (${inPlaceholders(userIds)}) 
      AND strftime('%Y-%m', date) = strftime('%Y-%m', date('now', 'localtime', '-1 month'))
  `);
  return stmt.get(...userIds).total;
}

function getPreviousMonthCategoryStats(userId) {
  const userIds = getGroupUserIds(userId);
  const stmt = getDb().prepare(`
    SELECT category, SUM(amount) as total, COUNT(*) as count
    FROM expenses
    WHERE user_id IN (${inPlaceholders(userIds)}) 
      AND strftime('%Y-%m', date) = strftime('%Y-%m', date('now', 'localtime', '-1 month'))
    GROUP BY category
    ORDER BY total DESC
  `);
  return stmt.all(...userIds);
}

function getSplitSummary(userId) {
  const userIds = getGroupUserIds(userId);
  if (userIds.length < 2) return null;

  const stmt = getDb().prepare(`
    SELECT user_id, SUM(amount) as total
    FROM expenses
    WHERE user_id IN (${inPlaceholders(userIds)}) 
      AND is_split = 1
      AND strftime('%Y-%m', date) = strftime('%Y-%m', date('now', 'localtime'))
    GROUP BY user_id
  `);
  return stmt.all(...userIds);
}

function setBudget(userId, amount) {
  const month = new Date().toISOString().slice(0, 7);
  const stmt = getDb().prepare(`
    INSERT INTO budgets (user_id, amount, month) VALUES (?, ?, ?)
    ON CONFLICT(user_id, month) DO UPDATE SET amount = ?
  `);
  stmt.run(userId, amount, month, amount);
}

function getBudget(userId) {
  const month = new Date().toISOString().slice(0, 7);
  const userIds = getGroupUserIds(userId);

  const budgets = [];
  for (const uid of userIds) {
    const b = getDb().prepare('SELECT * FROM budgets WHERE user_id = ? AND month = ?').get(uid, month);
    if (b) budgets.push(b);
  }

  if (budgets.length === 0) return null;

  const totalBudget = budgets.reduce((sum, b) => sum + b.amount, 0);
  return { amount: totalBudget, month };
}

function setReminder(userId, chatId, time, enabled = true) {
  const stmt = getDb().prepare(`
    INSERT INTO reminders (user_id, chat_id, reminder_time, enabled) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET chat_id = ?, reminder_time = ?, enabled = ?
  `);
  stmt.run(userId, chatId, time, enabled ? 1 : 0, chatId, time, enabled ? 1 : 0);
}

function getReminder(userId) {
  return getDb().prepare('SELECT * FROM reminders WHERE user_id = ?').get(userId);
}

function getActiveReminders(time) {
  return getDb().prepare('SELECT * FROM reminders WHERE reminder_time = ? AND enabled = 1').all(time);
}

function disableReminder(userId) {
  getDb().prepare('UPDATE reminders SET enabled = 0 WHERE user_id = ?').run(userId);
}

function addRecurring(userId, amount, description, category, dayOfMonth) {
  const stmt = getDb().prepare(`
    INSERT INTO recurring (user_id, amount, description, category, day_of_month)
    VALUES (?, ?, ?, ?, ?)
  `);
  return stmt.run(userId, amount, description, category, dayOfMonth).lastInsertRowid;
}

function getRecurringList(userId) {
  return getDb().prepare('SELECT * FROM recurring WHERE user_id = ? AND enabled = 1').all(userId);
}

function deleteRecurring(userId, recurringId) {
  const result = getDb().prepare('DELETE FROM recurring WHERE id = ? AND user_id = ?').run(recurringId, userId);
  return result.changes > 0;
}

function getDueRecurring(today) {
  const dayOfMonth = new Date(today).getDate();
  const currentMonth = today.slice(0, 7);
  return getDb().prepare(`
    SELECT * FROM recurring 
    WHERE day_of_month = ? AND enabled = 1 
      AND (last_run IS NULL OR last_run != ?)
  `).all(dayOfMonth, currentMonth);
}

function markRecurringRun(recurringId, month) {
  getDb().prepare('UPDATE recurring SET last_run = ? WHERE id = ?').run(month, recurringId);
}

function hasTodayExpenses(userId) {
  const stmt = getDb().prepare(`
    SELECT COUNT(*) as count FROM expenses
    WHERE user_id = ? AND date = date('now', 'localtime')
  `);
  return stmt.get(userId).count > 0;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  addExpense, deleteExpense, setExpensePhoto, getExpenseById,
  getTodayExpenses, getTodayTotal,
  getWeekExpenses, getWeekTotal,
  getMonthExpenses, getMonthTotal,
  getMonthCategoryStats, getMonthDailyStats,
  getRecentExpenses, getMonthlyOverview,
  getExpensesByTag, getExpensesByMonth,
  getPreviousMonthTotal, getPreviousMonthCategoryStats,
  getSplitSummary,
  createInviteCode, linkWithCode, unlinkPair,
  getPartnerInfo, getPartnerName, getUserName, getGroupUserIds,
  setBudget, getBudget,
  setReminder, getReminder, getActiveReminders, disableReminder,
  addRecurring, getRecurringList, deleteRecurring, getDueRecurring, markRecurringRun,
  hasTodayExpenses,
  closeDb,
};

const express = require('express');
const path = require('path');
const db = require('./database');
const fmt = require('./formatter');

const PORT = process.env.WEB_PORT || 3000;

let botInstance = null;

function getNameMap(userId) {
  const userIds = db.getGroupUserIds(userId);
  const map = {};
  userIds.forEach(uid => {
    map[uid] = db.getUserName(uid) || 'User';
  });
  return map;
}

async function notifyTelegram(userId, message) {
  if (!botInstance) return;
  try {
    await botInstance.sendMessage(userId, message, { parse_mode: 'HTML' });
    const partner = db.getPartnerInfo(userId);
    if (partner) {
      await botInstance.sendMessage(partner.id, message, { parse_mode: 'HTML' }).catch(() => {});
    }
  } catch (e) {
    console.error('Telegram notify error:', e.message);
  }
}

function startServer(bot) {
  botInstance = bot;
  const app = express();

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.json());

  app.get('/api/summary', (req, res) => {
    try {
      const userId = db.getFirstUserId();
      if (!userId) return res.json({ today: 0, week: 0, month: 0, prevMonth: 0 });

      const monthTotal = db.getMonthTotal(userId);
      const prevMonthTotal = db.getPreviousMonthTotal(userId);
      const budget = db.getBudget(userId);

      res.json({
        today: db.getTodayTotal(userId),
        week: db.getWeekTotal(userId),
        month: monthTotal,
        prevMonth: prevMonthTotal,
        monthChange: prevMonthTotal > 0
          ? ((monthTotal - prevMonthTotal) / prevMonthTotal * 100).toFixed(1)
          : null,
        budget: budget ? budget.amount : null,
        budgetPercent: budget ? (monthTotal / budget.amount * 100).toFixed(1) : null,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/expenses', (req, res) => {
    try {
      const userId = db.getFirstUserId();
      if (!userId) return res.json([]);

      const { period, category, tag } = req.query;
      let expenses;

      if (tag) {
        expenses = db.getExpensesByTag(userId, `#${tag}`);
      } else if (period === 'today') {
        expenses = db.getTodayExpenses(userId);
      } else if (period === 'week') {
        expenses = db.getWeekExpenses(userId);
      } else {
        expenses = db.getMonthExpenses(userId);
      }

      if (category && category !== 'all') {
        expenses = expenses.filter(e => e.category === category);
      }

      const nameMap = getNameMap(userId);
      res.json(expenses.map(e => ({ ...e, userName: nameMap[e.user_id] || 'Unknown' })));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/categories', (req, res) => {
    try {
      const userId = db.getFirstUserId();
      if (!userId) return res.json([]);
      res.json(db.getMonthCategoryStats(userId));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/daily', (req, res) => {
    try {
      const userId = db.getFirstUserId();
      if (!userId) return res.json([]);
      res.json(db.getMonthDailyStats(userId));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/monthly', (req, res) => {
    try {
      const userId = db.getFirstUserId();
      if (!userId) return res.json([]);
      res.json(db.getMonthlyOverview(userId));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/insights', (req, res) => {
    try {
      const userId = db.getFirstUserId();
      if (!userId) return res.json({ current: [], previous: [], currentTotal: 0, previousTotal: 0 });

      res.json({
        current: db.getMonthCategoryStats(userId),
        previous: db.getPreviousMonthCategoryStats(userId),
        currentTotal: db.getMonthTotal(userId),
        previousTotal: db.getPreviousMonthTotal(userId),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/expenses', async (req, res) => {
    try {
      const userId = db.getFirstUserId();
      if (!userId) return res.status(400).json({ error: 'No user found' });

      const { amount, description, category, tags, date, is_split } = req.body;
      if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

      const id = db.addExpense(userId, amount, description || 'No description', category || 'Other', {
        tags: tags || '',
        isSplit: is_split || false,
        date: date || undefined,
      });

      const expense = db.getExpenseById(id);

      await notifyTelegram(userId,
        `🌐 <b>Web Dashboard</b>\n\n` +
        `➕ New expense added:\n` +
        `${fmt.getCategoryEmoji(category || 'Other')} <b>${description || 'No description'}</b>\n` +
        `💸 ${fmt.formatMoney(amount)}\n` +
        `📂 ${category || 'Other'}\n🆔 #${id}`
      );

      res.json({ success: true, expense });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/expenses/:id', async (req, res) => {
    try {
      const userId = db.getFirstUserId();
      if (!userId) return res.status(400).json({ error: 'No user found' });

      const expenseId = parseInt(req.params.id);
      const { amount, description, category, tags, date } = req.body;
      const existing = db.getExpenseById(expenseId);
      if (!existing) return res.status(404).json({ error: 'Expense not found' });

      db.updateExpense(expenseId, {
        amount: amount !== undefined ? amount : existing.amount,
        description: description !== undefined ? description : existing.description,
        category: category !== undefined ? category : existing.category,
        tags: tags !== undefined ? tags : existing.tags,
        date: date !== undefined ? date : existing.date,
      });

      const updated = db.getExpenseById(expenseId);

      await notifyTelegram(userId,
        `🌐 <b>Web Dashboard</b>\n\n` +
        `✏️ Expense #${expenseId} edited:\n` +
        `${fmt.getCategoryEmoji(updated.category)} <b>${updated.description}</b>\n` +
        `💸 ${fmt.formatMoney(updated.amount)}\n📂 ${updated.category}`
      );

      res.json({ success: true, expense: updated });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/expenses/:id', async (req, res) => {
    try {
      const userId = db.getFirstUserId();
      if (!userId) return res.status(400).json({ error: 'No user found' });

      const expenseId = parseInt(req.params.id);
      const existing = db.getExpenseById(expenseId);
      if (!existing) return res.status(404).json({ error: 'Expense not found' });

      const success = db.deleteExpense(userId, expenseId);
      if (!success) return res.status(404).json({ error: 'Expense not found' });

      await notifyTelegram(userId,
        `🌐 <b>Web Dashboard</b>\n\n` +
        `🗑️ Expense #${expenseId} deleted:\n` +
        `${fmt.getCategoryEmoji(existing.category)} <b>${existing.description}</b>\n` +
        `💸 ${fmt.formatMoney(existing.amount)}`
      );

      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/budget', (req, res) => {
    try {
      const userId = db.getFirstUserId();
      if (!userId) return res.json({ budget: null });

      const budget = db.getBudget(userId);
      const monthTotal = db.getMonthTotal(userId);

      res.json({
        budget: budget ? budget.amount : null,
        month: budget ? budget.month : null,
        spent: monthTotal,
        percent: budget ? (monthTotal / budget.amount * 100).toFixed(1) : null,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/budget', async (req, res) => {
    try {
      const userId = db.getFirstUserId();
      if (!userId) return res.status(400).json({ error: 'No user found' });

      const { amount } = req.body;
      if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

      db.setBudget(userId, amount);
      const monthTotal = db.getMonthTotal(userId);

      await notifyTelegram(userId,
        `🌐 <b>Web Dashboard</b>\n\n` +
        `💰 Monthly budget updated:\n` +
        `📌 Budget: <b>${fmt.formatMoney(amount)}</b>\n` +
        `💸 Spent: <b>${fmt.formatMoney(monthTotal)}</b>\n` +
        `📊 ${(monthTotal / amount * 100).toFixed(1)}% used`
      );

      res.json({
        success: true,
        budget: amount,
        spent: monthTotal,
        percent: (monthTotal / amount * 100).toFixed(1),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/export', (req, res) => {
    try {
      const userId = db.getFirstUserId();
      if (!userId) return res.status(400).send('No data');

      const month = req.query.month || new Date().toISOString().slice(0, 7);
      const expenses = db.getExpensesByMonth(userId, month);
      const nameMap = getNameMap(userId);
      const csv = fmt.expensesToCSV(expenses, nameMap);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=expenses_${month}.csv`);
      res.send(csv);
    } catch (e) {
      res.status(500).send('Export failed');
    }
  });

  app.get('/api/partner', (req, res) => {
    try {
      const userId = db.getFirstUserId();
      if (!userId) return res.json({ paired: false });

      const partner = db.getPartnerInfo(userId);
      if (!partner) return res.json({ paired: false });

      const userName = db.getUserName(userId) || 'You';
      res.json({
        paired: true,
        you: userName,
        partner: partner.name,
        partnerId: partner.id,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/recurring', (req, res) => {
    try {
      const userId = db.getFirstUserId();
      if (!userId) return res.json([]);
      res.json(db.getRecurringList(userId));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/recurring', async (req, res) => {
    try {
      const userId = db.getFirstUserId();
      if (!userId) return res.status(400).json({ error: 'No user found' });

      const { amount, description, category, day_of_month } = req.body;
      if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
      if (!day_of_month || day_of_month < 1 || day_of_month > 28) return res.status(400).json({ error: 'Day must be 1-28' });

      const id = db.addRecurring(userId, amount, description || 'Recurring', category || 'Other', day_of_month);

      await notifyTelegram(userId,
        `🌐 <b>Web Dashboard</b>\n\n` +
        `🔄 New recurring expense added:\n` +
        `${fmt.getCategoryEmoji(category || 'Other')} <b>${description || 'Recurring'}</b>\n` +
        `💸 ${fmt.formatMoney(amount)}\n📅 Day ${day_of_month} of each month`
      );

      res.json({ success: true, id });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/recurring/:id', async (req, res) => {
    try {
      const userId = db.getFirstUserId();
      if (!userId) return res.status(400).json({ error: 'No user found' });

      const success = db.deleteRecurring(userId, parseInt(req.params.id));
      if (!success) return res.status(404).json({ error: 'Not found' });

      await notifyTelegram(userId,
        `🌐 <b>Web Dashboard</b>\n\n🔄 Recurring expense #${req.params.id} deleted`
      );

      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/quick-add', async (req, res) => {
    try {
      const userId = db.getFirstUserId();
      if (!userId) return res.status(400).json({ error: 'No user found' });

      const { amount, description, category } = req.body;
      const id = db.addExpense(userId, amount, description, category);
      const todayTotal = db.getTodayTotal(userId);

      await notifyTelegram(userId,
        `🌐 <b>Web Dashboard</b>\n\n` +
        `⚡ Quick add:\n` +
        `${fmt.getCategoryEmoji(category)} <b>${description}</b> • ${fmt.formatMoney(amount)}\n` +
        `📊 Today: ${fmt.formatMoney(todayTotal)}`
      );

      res.json({ success: true, id, todayTotal });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.use((err, req, res, next) => {
    console.error('Server error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  });

  app.listen(PORT, () => {
    console.log(`Dashboard: http://localhost:${PORT}`);
  });

  return app;
}

module.exports = { startServer };

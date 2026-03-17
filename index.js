require('dotenv').config({ override: true });
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const db = require('./src/database');
const fmt = require('./src/formatter');
const scheduler = require('./src/scheduler');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN!');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
console.log('Bot started successfully!');

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message || err.code || err);
  if (err.stack) console.error(err.stack);
});

bot.on('error', (err) => {
  console.error('Bot error:', err.message || err);
});

scheduler.init(bot);

const userStates = new Map();

const CURRENCY_RATES = {
  'USD': 25400, 'EUR': 27500, 'GBP': 32000,
  'JPY': 170, 'KRW': 19, 'CNY': 3500,
  'THB': 720, 'SGD': 19000, 'AUD': 16500,
};

function getNameMap(userId, userName) {
  const partner = db.getPartnerInfo(userId);
  const map = {};
  map[userId] = userName || db.getUserName(userId) || 'You';
  if (partner) {
    map[partner.id] = partner.name || 'Partner';
  }
  return map;
}

function checkBudgetWarning(userId) {
  const budget = db.getBudget(userId);
  if (!budget) return null;

  const spent = db.getMonthTotal(userId);
  const percentage = (spent / budget.amount * 100);

  if (percentage >= 100) {
    return `\n\n🚨 <b>OVER BUDGET!</b> Spent ${fmt.formatMoney(spent)} / ${fmt.formatMoney(budget.amount)} (${percentage.toFixed(0)}%)`;
  } else if (percentage >= 80) {
    return `\n\n⚠️ Budget warning: ${percentage.toFixed(0)}% used (${fmt.formatMoney(spent)} / ${fmt.formatMoney(budget.amount)})`;
  }
  return null;
}

function parseAmount(text) {
  text = text.trim().toLowerCase().replace(/,/g, '');

  let match = text.match(/^([\d.]+)\s*(tr|triệu)$/);
  if (match) return parseFloat(match[1]) * 1000000;

  match = text.match(/^([\d.]+)\s*(k|nghìn|ngàn)$/);
  if (match) return parseFloat(match[1]) * 1000;

  match = text.match(/^([\d.]+)\s*m$/);
  if (match) return parseFloat(match[1]) * 1000000;

  match = text.match(/^[\d.]+$/);
  if (match) {
    const cleaned = text.replace(/\./g, '');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }

  return null;
}

function parseCurrency(text) {
  text = text.trim();

  const symbolMap = { 'USD': '$', 'EUR': '€', 'GBP': '£', 'JPY': '¥', 'CNY': '¥', 'KRW': '₩', 'THB': '฿' };

  for (const [code, rate] of Object.entries(CURRENCY_RATES)) {
    const symbol = symbolMap[code];

    const patterns = [];

    if (symbol) {
      const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      patterns.push(new RegExp(`^${escaped}([\\d.,]+)$`));
    }

    patterns.push(new RegExp(`^([\\d.,]+)\\s*${code}$`, 'i'));

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const amount = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(amount) && amount > 0) {
          return { vnd: amount * rate, original: amount, currency: code };
        }
      }
    }
  }

  return null;
}

function parseDate(text) {
  const lower = text.toLowerCase().trim();

  if (lower === 'yesterday' || lower === 'hôm qua') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }

  let match = lower.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (match) {
    const day = parseInt(match[1]);
    const month = parseInt(match[2]);
    const year = new Date().getFullYear();
    const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    if (!isNaN(new Date(dateStr).getTime())) return dateStr;
  }

  match = lower.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const dateStr = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    if (!isNaN(new Date(dateStr).getTime())) return dateStr;
  }

  match = lower.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match && !isNaN(new Date(lower).getTime())) return lower;

  return null;
}

function extractTags(text) {
  const tagMatches = text.match(/#\w+/g);
  if (!tagMatches) return { cleanText: text, tags: '' };

  const tags = tagMatches.join(' ');
  const cleanText = text.replace(/#\w+/g, '').trim();
  return { cleanText, tags };
}

function autoDetectCategory(description) {
  const desc = description.toLowerCase();

  const rules = [
    { keywords: ['eat', 'pho', 'rice', 'noodle', 'cake', 'tea', 'coffee', 'cafe', 'drink', 'beer', 'restaurant', 'lunch', 'dinner', 'breakfast', 'hotpot', 'grill', 'chicken', 'beef', 'pork', 'fish', 'shrimp', 'milk tea', 'boba', 'snack', 'pizza', 'burger', 'sushi', 'ăn', 'phở', 'cơm', 'bún', 'mì', 'bánh', 'trà', 'cà phê', 'nước', 'bia', 'nhậu', 'quán', 'uống', 'trà sữa', 'sáng', 'trưa', 'tối', 'lẩu', 'nướng', 'gà', 'bò', 'heo', 'cá', 'tôm'], category: 'Food & Drinks' },
    { keywords: ['grab', 'gojek', 'be', 'taxi', 'car', 'gas', 'fuel', 'parking', 'bus', 'metro', 'train', 'flight', 'transport', 'uber', 'xe', 'xăng', 'gửi xe', 'di chuyển'], category: 'Transport' },
    { keywords: ['buy', 'shopping', 'pants', 'shirt', 'shoes', 'bag', 'accessory', 'shopee', 'lazada', 'tiki', 'amazon', 'mua', 'quần', 'áo', 'giày', 'dép', 'túi', 'đồ'], category: 'Shopping' },
    { keywords: ['game', 'movie', 'cinema', 'watch', 'netflix', 'spotify', 'youtube', 'travel', 'karaoke', 'bar', 'club', 'entertainment', 'play', 'phim', 'du lịch', 'giải trí', 'chơi'], category: 'Entertainment' },
    { keywords: ['medicine', 'hospital', 'doctor', 'dental', 'gym', 'exercise', 'vitamin', 'health', 'medical', 'thuốc', 'bệnh viện', 'khám', 'bác sĩ', 'tập', 'sức khỏe'], category: 'Health' },
    { keywords: ['study', 'book', 'course', 'school', 'tuition', 'education', 'udemy', 'học', 'sách', 'khóa', 'trường'], category: 'Education' },
    { keywords: ['electric', 'water', 'internet', 'wifi', 'phone', 'rent', 'bill', 'fee', 'insurance', 'installment', 'điện', 'nước', 'tiền nhà', 'hóa đơn', 'phí', 'bảo hiểm', 'trả góp'], category: 'Bills' },
    { keywords: ['save', 'saving', 'bank', 'invest', 'stock', 'crypto', 'tiết kiệm', 'đầu tư', 'chứng khoán'], category: 'Savings' },
  ];

  for (const rule of rules) {
    for (const keyword of rule.keywords) {
      if (desc.includes(keyword)) return rule.category;
    }
  }

  return 'Other';
}

function processExpenseInput(text, userId, userName, chatId, forcedCategory = null, isSplit = false) {
  const { cleanText: textNoTags, tags } = extractTags(text);

  const words = textNoTags.trim().split(/\s+/);
  let amount = null;
  let description = '';
  let customDate = null;
  let currencyInfo = null;

  currencyInfo = parseCurrency(words[0]);
  if (currencyInfo) {
    amount = currencyInfo.vnd;
    description = words.slice(1).join(' ');
  } else {
    amount = parseAmount(words[0]);
    if (amount) {
      description = words.slice(1).join(' ');
    }
  }

  if (!amount) return null;

  const descWords = description.split(/\s+/);
  const lastWord = descWords[descWords.length - 1];
  const parsedDate = parseDate(lastWord);
  if (parsedDate && descWords.length > 1) {
    customDate = parsedDate;
    description = descWords.slice(0, -1).join(' ');
  } else if (parsedDate && descWords.length === 1) {
    customDate = parsedDate;
    description = '';
  }

  if (amount <= 0) return null;
  if (amount > 10000000000) return null;

  const category = forcedCategory || autoDetectCategory(description);

  const options = {
    tags,
    isSplit,
    date: customDate || undefined,
    originalAmount: currencyInfo ? currencyInfo.original : null,
    originalCurrency: currencyInfo ? currencyInfo.currency : null,
  };

  const id = db.addExpense(userId, amount, description || 'No description', category, options);
  const todayTotal = db.getTodayTotal(userId);
  const budgetWarning = checkBudgetWarning(userId);
  const partner = db.getPartnerInfo(userId);
  const sharedNote = partner ? `\n👫 Shared wallet with ${partner.name}` : '';
  const dateNote = customDate ? `\n📅 Date: ${customDate}` : '';
  const splitNote = isSplit ? '\n🔀 Split expense' : '';
  const currencyNote = currencyInfo ? `\n💱 ${currencyInfo.original} ${currencyInfo.currency} → ${fmt.formatMoney(amount)}` : '';
  const tagNote = tags ? `\n🏷️ ${tags}` : '';

  const emoji = fmt.getCategoryEmoji(category);
  const confirmText =
    `✅ Recorded!\n\n` +
    `${emoji} <b>${description || 'No description'}</b>\n` +
    `💸 ${fmt.formatMoney(amount)}\n` +
    `📂 ${category}\n` +
    `🆔 #${id}` +
    dateNote + currencyNote + splitNote + tagNote +
    `\n\n📊 Today's total: <b>${fmt.formatMoney(todayTotal)}</b>` +
    sharedNote +
    (budgetWarning || '');

  bot.sendMessage(chatId, confirmText, { parse_mode: 'HTML' });

  if (partner) {
    bot.sendMessage(
      partner.id,
      `📢 <b>${userName}</b> just spent:\n\n` +
        `${emoji} <b>${description || 'No description'}</b>\n` +
        `💸 ${fmt.formatMoney(amount)}` +
        (isSplit ? ' 🔀 Split' : '') +
        `\n📂 ${category}\n\n` +
        `📊 Today's total (shared): <b>${fmt.formatMoney(todayTotal)}</b>`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }

  return id;
}

bot.onText(/^\/start(@\w+)?$/, (msg) => {
  const name = msg.from.first_name || 'there';
  bot.sendMessage(msg.chat.id, `
👋 Hi <b>${name}</b>! I'm your expense tracker bot 💰

<b>📌 Quick start:</b>
Send: <code>50k coffee</code> to add an expense!

<b>📋 All commands:</b>
/add - Add with category selection
/today /week /month - View expenses
/stats - Category breakdown
/overview - 12-month history
/budget - Set/view monthly budget
/insights - Compare vs last month
/export - Export to CSV
/chart - Visual charts
/split - Add a split expense
/recurring - Manage recurring expenses
/reminder - Daily reminder settings
/tag - Search by tag
/link - Pair with partner
/who - Shared wallet info
/delete - Remove an expense
/help - Full help guide

<b>💡 Quick tips:</b>
• <code>50k coffee #work</code> — add with tag
• <code>$20 gift</code> — auto-convert currency
• <code>35k lunch yesterday</code> — backdate entry
`, { parse_mode: 'HTML' });
});

bot.onText(/^\/help(@\w+)?$/, (msg) => {
  bot.sendMessage(msg.chat.id, `
📖 <b>Full Command Guide</b>

<b>💸 Add expenses:</b>
• <code>50k lunch</code> — quick add
• <code>50k lunch #work</code> — with tag
• <code>$20 gift</code> — foreign currency
• <code>35k lunch yesterday</code> — backdate
• <code>35k lunch 15/03</code> — specific date
• /add — pick category first
• /split <code>100k dinner</code> — split with partner

<b>📊 View & Analyze:</b>
• /today /week /month — expense lists
• /stats — category breakdown
• /overview — 12-month history
• /insights — this month vs last month
• /chart — pie chart by category
• /chart bar — daily bar chart

<b>💰 Budget:</b>
• /budget <code>5tr</code> — set monthly budget
• /budget — view budget status

<b>🔄 Recurring:</b>
• /recurring add <code>5tr rent 1</code> — auto-add on day 1
• /recurring list — view all
• /recurring delete <code>ID</code> — remove

<b>🔔 Reminder:</b>
• /reminder <code>21:00</code> — set time
• /reminder off — disable

<b>📤 Export:</b>
• /export — this month's CSV
• /export <code>2026-03</code> — specific month

<b>👫 Shared wallet:</b>
• /link — create/use invite code
• /unlink — unpair
• /who — wallet info
• /splitstatus — who owes who

<b>🏷️ Tags:</b>
• /tag <code>work</code> — search by tag

<b>💱 Currencies:</b>
• <code>$50</code>, <code>€30</code>, <code>£20</code>, <code>¥5000</code>
• <code>50 USD</code>, <code>30 EUR</code>, <code>100 THB</code>
`, { parse_mode: 'HTML' });
});

bot.onText(/^\/budget(@\w+)?\s*(.*)/, (msg, match) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const input = (match[2] || '').trim();

  if (!input) {
    const budget = db.getBudget(userId);
    if (!budget) {
      bot.sendMessage(chatId,
        '💰 No budget set for this month.\n\nSet one with: <code>/budget 5tr</code> or <code>/budget 5000000</code>',
        { parse_mode: 'HTML' });
      return;
    }

    const spent = db.getMonthTotal(userId);
    bot.sendMessage(chatId, fmt.formatBudgetStatus(budget, spent), { parse_mode: 'HTML' });
    return;
  }

  const amount = parseAmount(input);
  if (!amount || amount <= 0) {
    bot.sendMessage(chatId, '❌ Invalid amount. Example: <code>/budget 5tr</code>', { parse_mode: 'HTML' });
    return;
  }

  db.setBudget(userId, amount);
  const spent = db.getMonthTotal(userId);
  bot.sendMessage(chatId,
    `✅ Monthly budget set to <b>${fmt.formatMoney(amount)}</b>!\n\n` +
    fmt.formatBudgetStatus({ amount, month: new Date().toISOString().slice(0, 7) }, spent),
    { parse_mode: 'HTML' });
});

bot.onText(/^\/reminder(@\w+)?\s*(.*)/, (msg, match) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const input = (match[2] || '').trim().toLowerCase();

  if (!input) {
    const reminder = db.getReminder(userId);
    if (reminder && reminder.enabled) {
      bot.sendMessage(chatId,
        `🔔 Reminder is <b>ON</b> at <b>${reminder.reminder_time}</b> daily.\n\n` +
        `Change time: <code>/reminder 21:00</code>\nTurn off: <code>/reminder off</code>`,
        { parse_mode: 'HTML' });
    } else {
      bot.sendMessage(chatId,
        `🔕 Reminder is <b>OFF</b>.\n\nTurn on: <code>/reminder 21:00</code>`,
        { parse_mode: 'HTML' });
    }
    return;
  }

  if (input === 'off' || input === 'disable') {
    db.disableReminder(userId);
    bot.sendMessage(chatId, '🔕 Daily reminder disabled.');
    return;
  }

  const timeMatch = input.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) {
    bot.sendMessage(chatId, '❌ Invalid time format. Use: <code>/reminder 21:00</code>', { parse_mode: 'HTML' });
    return;
  }

  const hours = parseInt(timeMatch[1]);
  const minutes = parseInt(timeMatch[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    bot.sendMessage(chatId, '❌ Invalid time. Hours: 0-23, Minutes: 0-59.');
    return;
  }

  const time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  db.setReminder(userId, chatId, time, true);
  bot.sendMessage(chatId, `🔔 Daily reminder set to <b>${time}</b>!\n\nI'll remind you if you haven't logged any expenses by then.`, { parse_mode: 'HTML' });
});

bot.onText(/^\/recurring(@\w+)?\s*(.*)/, (msg, match) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const input = (match[2] || '').trim();

  if (!input || input === 'list') {
    const items = db.getRecurringList(userId);
    if (items.length === 0) {
      bot.sendMessage(chatId,
        '🔄 No recurring expenses.\n\nAdd one: <code>/recurring add 5tr rent 1</code>\n(amount, description, day of month)',
        { parse_mode: 'HTML' });
      return;
    }

    let text = '🔄 <b>Recurring Expenses</b>\n\n';
    items.forEach(item => {
      const emoji = fmt.getCategoryEmoji(item.category);
      text += `${emoji} #${item.id} - ${fmt.formatMoney(item.amount)} - ${item.description}\n   📅 Day ${item.day_of_month} of each month\n\n`;
    });
    text += 'Delete: <code>/recurring delete ID</code>';
    bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    return;
  }

  const deleteMatch = input.match(/^delete\s+(\d+)$/i);
  if (deleteMatch) {
    const success = db.deleteRecurring(userId, parseInt(deleteMatch[1]));
    bot.sendMessage(chatId, success
      ? `✅ Deleted recurring expense #${deleteMatch[1]}.`
      : `❌ Recurring expense #${deleteMatch[1]} not found.`);
    return;
  }

  const addMatch = input.match(/^add\s+([\d.,]+\s*(?:k|tr|triệu|m|nghìn|ngàn)?)\s+(.+?)\s+(\d{1,2})$/i);
  if (!addMatch) {
    bot.sendMessage(chatId,
      '❌ Format: <code>/recurring add AMOUNT DESCRIPTION DAY</code>\nExample: <code>/recurring add 5tr rent 1</code>',
      { parse_mode: 'HTML' });
    return;
  }

  const amount = parseAmount(addMatch[1]);
  const description = addMatch[2].trim();
  const day = parseInt(addMatch[3]);

  if (!amount || amount <= 0) {
    bot.sendMessage(chatId, '❌ Invalid amount.');
    return;
  }
  if (day < 1 || day > 28) {
    bot.sendMessage(chatId, '❌ Day must be between 1 and 28.');
    return;
  }

  const category = autoDetectCategory(description);
  const id = db.addRecurring(userId, amount, description, category, day);
  bot.sendMessage(chatId,
    `✅ Recurring expense added!\n\n` +
    `📝 ${description}\n💸 ${fmt.formatMoney(amount)}\n📂 ${category}\n📅 Day ${day} of each month\n🆔 #${id}`,
    { parse_mode: 'HTML' });
});

bot.onText(/^\/export(@\w+)?\s*(.*)/, (msg, match) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const monthInput = (match[2] || '').trim();
  const nameMap = getNameMap(userId, msg.from.first_name);

  const targetMonth = monthInput || new Date().toISOString().slice(0, 7);
  const monthMatch = targetMonth.match(/^\d{4}-\d{2}$/);
  if (!monthMatch) {
    bot.sendMessage(chatId, '❌ Format: <code>/export 2026-03</code>', { parse_mode: 'HTML' });
    return;
  }

  const expenses = db.getExpensesByMonth(userId, targetMonth);
  if (expenses.length === 0) {
    bot.sendMessage(chatId, `📭 No expenses found for ${targetMonth}.`);
    return;
  }

  const csv = fmt.expensesToCSV(expenses, nameMap);
  const filePath = path.join(__dirname, `expenses_${targetMonth}.csv`);
  fs.writeFileSync(filePath, csv, 'utf-8');

  bot.sendDocument(chatId, filePath, {
    caption: `📤 Expenses export for ${targetMonth} (${expenses.length} items)`,
  }).then(() => {
    fs.unlinkSync(filePath);
  }).catch(() => {
    fs.unlinkSync(filePath);
  });
});

bot.onText(/^\/insights(@\w+)?$/, (msg) => {
  const userId = msg.from.id;
  const currentStats = db.getMonthCategoryStats(userId);
  const prevStats = db.getPreviousMonthCategoryStats(userId);
  const currentTotal = db.getMonthTotal(userId);
  const prevTotal = db.getPreviousMonthTotal(userId);
  const text = fmt.formatInsights(currentStats, prevStats, currentTotal, prevTotal);
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
});

bot.onText(/^\/chart(@\w+)?\s*(.*)/, (msg, match) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const chartType = (match[2] || '').trim().toLowerCase();

  if (chartType === 'bar') {
    const dailyStats = db.getMonthDailyStats(userId);
    if (dailyStats.length === 0) {
      bot.sendMessage(chatId, '📭 No data for chart.');
      return;
    }

    const labels = dailyStats.map(d => d.date.slice(5));
    const data = dailyStats.map(d => d.total);
    const url = fmt.buildChartUrl('bar', labels, data, 'Daily Spending This Month');
    bot.sendPhoto(chatId, url, { caption: '📊 Daily spending bar chart' }).catch(() => {
      bot.sendMessage(chatId, '❌ Failed to generate chart. Try again later.');
    });
  } else {
    const stats = db.getMonthCategoryStats(userId);
    if (stats.length === 0) {
      bot.sendMessage(chatId, '📭 No data for chart.');
      return;
    }

    const labels = stats.map(s => `${fmt.getCategoryEmoji(s.category)} ${s.category}`);
    const data = stats.map(s => s.total);
    const url = fmt.buildChartUrl('pie', labels, data, 'Spending by Category This Month');
    bot.sendPhoto(chatId, url, { caption: '📊 Category pie chart' }).catch(() => {
      bot.sendMessage(chatId, '❌ Failed to generate chart. Try again later.');
    });
  }
});

bot.onText(/^\/split(@\w+)?\s+(.+)/, (msg, match) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const input = match[2].trim();

  const partner = db.getPartnerInfo(userId);
  if (!partner) {
    bot.sendMessage(chatId, '❌ You need to be paired first! Use /link to pair with your partner.');
    return;
  }

  processExpenseInput(input, userId, msg.from.first_name || 'User', chatId, null, true);
});

bot.onText(/^\/splitstatus(@\w+)?$/, (msg) => {
  const userId = msg.from.id;
  const nameMap = getNameMap(userId, msg.from.first_name);
  const splitData = db.getSplitSummary(userId);
  const text = fmt.formatSplitSummary(splitData, nameMap);
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
});

bot.onText(/^\/tag(@\w+)?\s+(.+)/, (msg, match) => {
  const userId = msg.from.id;
  const tag = match[2].trim().replace(/^#/, '');
  const nameMap = getNameMap(userId, msg.from.first_name);
  const expenses = db.getExpensesByTag(userId, `#${tag}`);
  const text = fmt.formatExpenseList(expenses, `🏷️ <b>Expenses tagged #${tag}</b>`, nameMap);
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
});

bot.onText(/^\/link(@\w+)?\s*(.*)/, (msg, match) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const userName = msg.from.first_name || 'User';
  const code = (match[2] || '').trim();

  if (!code) {
    const result = db.createInviteCode(userId, userName);
    if (result.error === 'already_linked') {
      const partner = db.getPartnerInfo(userId);
      bot.sendMessage(chatId,
        `💑 Already paired with <b>${partner ? partner.name : 'someone'}</b>!\nUse /unlink to unpair first.`,
        { parse_mode: 'HTML' });
      return;
    }
    bot.sendMessage(chatId,
      `🔗 <b>Invite code:</b>\n\n<code>${result.code}</code>\n\n📲 Share with your partner:\n<code>/link ${result.code}</code>`,
      { parse_mode: 'HTML' });
  } else {
    const result = db.linkWithCode(userId, userName, code);
    if (result.error === 'already_linked') { bot.sendMessage(chatId, '💑 Already paired! Use /unlink first.'); return; }
    if (result.error === 'invalid_code') { bot.sendMessage(chatId, '❌ Invalid code.'); return; }
    if (result.error === 'self_link') { bot.sendMessage(chatId, '🤔 Can\'t pair with yourself!'); return; }
    if (result.error === 'code_used') { bot.sendMessage(chatId, '❌ Code already used.'); return; }

    bot.sendMessage(chatId,
      `💑 <b>Paired with ${result.partnerName}!</b> 🎉\n\n📊 All expenses shown together.\n👤 Each expense shows who added it.`,
      { parse_mode: 'HTML' });
    bot.sendMessage(result.partnerId,
      `💑 <b>${userName}</b> paired with you! 🎉\n📊 Expenses are now shared.`,
      { parse_mode: 'HTML' }).catch(() => {});
  }
});

bot.onText(/^\/unlink(@\w+)?$/, (msg) => {
  const userId = msg.from.id;
  const result = db.unlinkPair(userId);
  if (result.error === 'not_linked') {
    bot.sendMessage(msg.chat.id, '🔓 Not paired. Use /link to pair.');
    return;
  }
  bot.sendMessage(msg.chat.id,
    `🔓 Unpaired from <b>${result.partnerName || 'partner'}</b>.`,
    { parse_mode: 'HTML' });
  bot.sendMessage(result.partnerId,
    `🔓 <b>${msg.from.first_name || 'Partner'}</b> unpaired from you.`,
    { parse_mode: 'HTML' }).catch(() => {});
});

bot.onText(/^\/who(@\w+)?$/, (msg) => {
  const userId = msg.from.id;
  const partner = db.getPartnerInfo(userId);
  if (!partner) {
    bot.sendMessage(msg.chat.id, '👤 Using <b>personal</b> wallet.\n💡 Use /link to pair!', { parse_mode: 'HTML' });
    return;
  }
  const todayTotal = db.getTodayTotal(userId);
  const monthTotal = db.getMonthTotal(userId);
  bot.sendMessage(msg.chat.id,
    `💑 <b>Shared wallet</b>\n\n👤 ${msg.from.first_name || 'You'}\n👤 ${partner.name || 'Partner'}\n\n` +
    `📅 Today: <b>${fmt.formatMoney(todayTotal)}</b>\n🗓️ Month: <b>${fmt.formatMoney(monthTotal)}</b>`,
    { parse_mode: 'HTML' });
});

bot.onText(/^\/add(@\w+)?$/, (msg) => {
  const keyboard = [];
  const categories = fmt.CATEGORIES;
  for (let i = 0; i < categories.length; i += 3) {
    const row = categories.slice(i, i + 3).map((cat) => ({
      text: `${fmt.getCategoryEmoji(cat)} ${cat}`,
      callback_data: `cat_${cat}`,
    }));
    keyboard.push(row);
  }
  bot.sendMessage(msg.chat.id, '📂 Choose a category:', {
    reply_markup: { inline_keyboard: keyboard },
  });
});

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  if (data.startsWith('cat_')) {
    const category = data.replace('cat_', '');
    userStates.set(userId, { step: 'waiting_amount', category });
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(chatId,
      `${fmt.getCategoryEmoji(category)} Selected: <b>${category}</b>\n\n💸 Enter amount and description:\nExample: <code>50k lunch</code>`,
      { parse_mode: 'HTML' });
  }
});

bot.onText(/^\/today(@\w+)?$/, (msg) => {
  const nameMap = getNameMap(msg.from.id, msg.from.first_name);
  const expenses = db.getTodayExpenses(msg.from.id);
  bot.sendMessage(msg.chat.id, fmt.formatExpenseList(expenses, '📅 <b>Today\'s expenses</b>', nameMap), { parse_mode: 'HTML' });
});

bot.onText(/^\/week(@\w+)?$/, (msg) => {
  const nameMap = getNameMap(msg.from.id, msg.from.first_name);
  const expenses = db.getWeekExpenses(msg.from.id);
  bot.sendMessage(msg.chat.id, fmt.formatExpenseList(expenses, '📆 <b>This week</b>', nameMap), { parse_mode: 'HTML' });
});

bot.onText(/^\/month(@\w+)?$/, (msg) => {
  const nameMap = getNameMap(msg.from.id, msg.from.first_name);
  const expenses = db.getMonthExpenses(msg.from.id);
  bot.sendMessage(msg.chat.id, fmt.formatExpenseList(expenses, '🗓️ <b>This month</b>', nameMap), { parse_mode: 'HTML' });
});

bot.onText(/^\/stats(@\w+)?$/, (msg) => {
  const stats = db.getMonthCategoryStats(msg.from.id);
  const monthTotal = db.getMonthTotal(msg.from.id);
  bot.sendMessage(msg.chat.id, fmt.formatCategoryStats(stats, monthTotal), { parse_mode: 'HTML' });
});

bot.onText(/^\/overview(@\w+)?$/, (msg) => {
  const months = db.getMonthlyOverview(msg.from.id);
  bot.sendMessage(msg.chat.id, fmt.formatMonthlyOverview(months), { parse_mode: 'HTML' });
});

bot.onText(/^\/delete(@\w+)?\s*(\d+)?$/, (msg, match) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const expenseId = match[2];
  const nameMap = getNameMap(userId, msg.from.first_name);

  if (!expenseId) {
    const recent = db.getRecentExpenses(userId, 10);
    if (recent.length === 0) { bot.sendMessage(chatId, '📭 Nothing to delete.'); return; }

    const isShared = Object.keys(nameMap).length > 1;
    let text = '🗑️ <b>Choose expense to delete:</b>\n\nSend: <code>/delete ID</code>\n\n';
    recent.forEach((e) => {
      const emoji = fmt.getCategoryEmoji(e.category);
      const who = isShared && nameMap[e.user_id] ? ` • 👤 ${nameMap[e.user_id]}` : '';
      text += `${emoji} #${e.id} - ${fmt.formatMoney(e.amount)} - ${e.description || 'No desc'} (${e.date})${who}\n`;
    });
    bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    return;
  }

  const success = db.deleteExpense(userId, parseInt(expenseId));
  bot.sendMessage(chatId, success ? `✅ Deleted #${expenseId}!` : `❌ #${expenseId} not found.`);
});

bot.on('photo', (msg) => {
  if (!msg.caption) return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const photoId = msg.photo[msg.photo.length - 1].file_id;
  const text = msg.caption.trim();

  const parts = text.match(/^([\d.,]+\s*(?:k|tr|triệu|m|nghìn|ngàn)?)\s*(.*)?$/i);
  if (!parts) {
    bot.sendMessage(chatId, '📸 Photo received! Add amount in caption: <code>50k lunch</code>', { parse_mode: 'HTML' });
    return;
  }

  const { cleanText, tags } = extractTags(parts[2] || '');
  const amount = parseAmount(parts[1]);
  if (!amount) { bot.sendMessage(chatId, '❌ Invalid amount.'); return; }

  const category = autoDetectCategory(cleanText);
  const id = db.addExpense(userId, amount, cleanText || 'No description', category, { tags, photoId });
  const todayTotal = db.getTodayTotal(userId);
  const budgetWarning = checkBudgetWarning(userId);

  bot.sendMessage(chatId,
    `✅ Recorded with receipt! 📸\n\n` +
    `${fmt.getCategoryEmoji(category)} <b>${cleanText || 'No description'}</b>\n` +
    `💸 ${fmt.formatMoney(amount)}\n📂 ${category}\n🆔 #${id}\n\n` +
    `📊 Today's total: <b>${fmt.formatMoney(todayTotal)}</b>` +
    (budgetWarning || ''),
    { parse_mode: 'HTML' });
});

bot.onText(/^\/receipt(@\w+)?\s+(\d+)$/, (msg, match) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const expenseId = parseInt(match[2]);

  const expense = db.getExpenseById(expenseId);
  if (!expense || !expense.photo_id) {
    bot.sendMessage(chatId, `❌ No receipt found for #${expenseId}.`);
    return;
  }

  bot.sendPhoto(chatId, expense.photo_id, {
    caption: `📸 Receipt for #${expenseId}\n${fmt.getCategoryEmoji(expense.category)} ${expense.description}\n💸 ${fmt.formatMoney(expense.amount)}`,
  });
});

bot.on('message', (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  if (msg.photo) return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  const state = userStates.get(userId);
  let category = null;

  if (state && state.step === 'waiting_amount') {
    category = state.category;
    userStates.delete(userId);
  }

  const currencyCheck = parseCurrency(text.split(/\s+/)[0]);
  const parts = text.match(/^([\d.,]+\s*(?:k|tr|triệu|m|nghìn|ngàn)?)\s*(.*)?$/i);

  if (!parts && !currencyCheck) {
    bot.sendMessage(chatId,
      '🤔 I didn\'t understand. Format: <code>amount description</code>\nExample: <code>50k breakfast</code>\n\nType /help for help.',
      { parse_mode: 'HTML' });
    return;
  }

  processExpenseInput(text, userId, msg.from.first_name || 'User', chatId, category);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  db.closeDb();
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGTERM', () => {
  db.closeDb();
  bot.stopPolling();
  process.exit(0);
});

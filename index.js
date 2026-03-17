require('dotenv').config({ override: true });
const TelegramBot = require('node-telegram-bot-api');
const db = require('./src/database');
const fmt = require('./src/formatter');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN! Create a .env file with your token from @BotFather.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
console.log('Bot started successfully!');

const userStates = new Map();

function getNameMap(userId, userName) {
  const partner = db.getPartnerInfo(userId);
  const map = {};
  map[userId] = userName || db.getUserName(userId) || 'You';
  if (partner) {
    map[partner.id] = partner.name || 'Partner';
  }
  return map;
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name || 'there';

  const welcomeText = `
👋 Hi <b>${name}</b>! I'm your expense tracker bot 💰

<b>📌 Quick start:</b>

1️⃣ <b>Quick add expense:</b>
   Send a message like: <code>50000 breakfast</code>
   or: <code>150k coffee</code>

2️⃣ <b>Main commands:</b>
   /add - Add expense with category selection
   /today - View today's expenses
   /week - View this week's expenses
   /month - View this month's expenses
   /stats - Category statistics
   /overview - 12-month overview
   /delete - Delete an expense
   /help - Show help

3️⃣ <b>Shared wallet (couples):</b>
   /link - Create invite code or enter code to pair up
   /unlink - Unlink from partner
   /who - View shared wallet info

💡 <i>Tip: You can quickly add expenses by just sending amount + description!</i>
`;

  bot.sendMessage(chatId, welcomeText, { parse_mode: 'HTML' });
});

bot.onText(/\/help/, (msg) => {
  const helpText = `
📖 <b>Expense Tracker Bot - Help</b>

<b>💸 Add expenses:</b>
• Send: <code>amount description</code>
• Example: <code>50000 pho noodles</code>
• Example: <code>35k grab ride</code>
• Example: <code>1.5m rent</code>

<b>📊 View expenses:</b>
• /today - Today's expenses
• /week - This week's expenses
• /month - This month's expenses

<b>📈 Statistics:</b>
• /stats - Category breakdown
• /overview - 12-month overview

<b>✏️ Manage:</b>
• /add - Add expense with category
• /delete <code>ID</code> - Delete expense (e.g. /delete 5)

<b>👫 Shared wallet:</b>
• /link - Create invite code
• /link <code>CODE</code> - Enter code to pair up
• /unlink - Unlink from partner
• /who - View shared wallet info

<b>💡 Supported amount formats:</b>
• <code>50000</code> or <code>50.000</code> = 50,000đ
• <code>50k</code> = 50,000đ
• <code>1.5tr</code> or <code>1.5m</code> = 1,500,000đ
`;

  bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'HTML' });
});

bot.onText(/\/link\s*(.*)/, (msg, match) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const userName = msg.from.first_name || 'User';
  const code = (match[1] || '').trim();

  if (!code) {
    const result = db.createInviteCode(userId, userName);

    if (result.error === 'already_linked') {
      const partner = db.getPartnerInfo(userId);
      bot.sendMessage(
        chatId,
        `💑 You're already paired with <b>${partner ? partner.name : 'someone'}</b>!\n\n` +
          `Use /unlink to unpair first.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    bot.sendMessage(
      chatId,
      `🔗 <b>Your invite code:</b>\n\n` +
        `<code>${result.code}</code>\n\n` +
        `📲 Share this code with your partner and ask them to send:\n` +
        `<code>/link ${result.code}</code>\n\n` +
        `⏳ The code is valid until it's used.`,
      { parse_mode: 'HTML' }
    );
  } else {
    const result = db.linkWithCode(userId, userName, code);

    if (result.error === 'already_linked') {
      bot.sendMessage(chatId, '💑 You\'re already paired with someone! Use /unlink to unpair first.');
      return;
    }
    if (result.error === 'invalid_code') {
      bot.sendMessage(chatId, '❌ Invalid invite code. Please check and try again!');
      return;
    }
    if (result.error === 'self_link') {
      bot.sendMessage(chatId, '🤔 You can\'t pair with yourself!');
      return;
    }
    if (result.error === 'code_used') {
      bot.sendMessage(chatId, '❌ This invite code has already been used.');
      return;
    }

    bot.sendMessage(
      chatId,
      `💑 <b>Paired successfully!</b>\n\n` +
        `You and <b>${result.partnerName}</b> now share a wallet! 🎉\n\n` +
        `📊 All expenses from both of you will be shown together.\n` +
        `👤 Each expense will show who added it.`,
      { parse_mode: 'HTML' }
    );

    bot.sendMessage(
      result.partnerId,
      `💑 <b>${userName}</b> just paired with you!\n\n` +
        `You now share a wallet! 🎉\n` +
        `📊 All expenses will be shown together.`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }
});

bot.onText(/\/unlink/, (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  const result = db.unlinkPair(userId);

  if (result.error === 'not_linked') {
    bot.sendMessage(chatId, '🔓 You\'re not paired with anyone.\n\nUse /link to create an invite code.');
    return;
  }

  bot.sendMessage(
    chatId,
    `🔓 Unpaired from <b>${result.partnerName || 'partner'}</b>.\n\n` +
      `📊 You'll now only see your own expenses.\n` +
      `💡 Use /link to pair again if needed.`,
    { parse_mode: 'HTML' }
  );

  bot.sendMessage(
    result.partnerId,
    `🔓 <b>${msg.from.first_name || 'Partner'}</b> has unpaired from you.\n\n` +
      `📊 You'll now only see your own expenses.`,
    { parse_mode: 'HTML' }
  ).catch(() => {});
});

bot.onText(/\/who/, (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  const partner = db.getPartnerInfo(userId);

  if (!partner) {
    bot.sendMessage(
      chatId,
      '👤 You\'re using a <b>personal</b> wallet.\n\n' +
        '💡 Use /link to pair up and share a wallet!',
      { parse_mode: 'HTML' }
    );
    return;
  }

  const todayTotal = db.getTodayTotal(userId);
  const monthTotal = db.getMonthTotal(userId);

  bot.sendMessage(
    chatId,
    `💑 <b>Your shared wallet</b>\n\n` +
      `👤 ${msg.from.first_name || 'You'}\n` +
      `👤 ${partner.name || 'Partner'}\n\n` +
      `📅 Today: <b>${fmt.formatMoney(todayTotal)}</b>\n` +
      `🗓️ This month: <b>${fmt.formatMoney(monthTotal)}</b>\n\n` +
      `🔓 Use /unlink to unpair.`,
    { parse_mode: 'HTML' }
  );
});

bot.onText(/\/add/, (msg) => {
  const chatId = msg.chat.id;

  const keyboard = [];
  const categories = fmt.CATEGORIES;
  for (let i = 0; i < categories.length; i += 3) {
    const row = categories.slice(i, i + 3).map((cat) => ({
      text: `${fmt.getCategoryEmoji(cat)} ${cat}`,
      callback_data: `cat_${cat}`,
    }));
    keyboard.push(row);
  }

  bot.sendMessage(chatId, '📂 Choose a category:', {
    reply_markup: {
      inline_keyboard: keyboard,
    },
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
    bot.sendMessage(
      chatId,
      `${fmt.getCategoryEmoji(category)} Selected: <b>${category}</b>\n\n` +
        `💸 Enter amount and description:\n` +
        `Example: <code>50000 lunch</code> or <code>35k coffee</code>`,
      { parse_mode: 'HTML' }
    );
  }
});

bot.onText(/\/today/, (msg) => {
  const userId = msg.from.id;
  const nameMap = getNameMap(userId, msg.from.first_name);
  const expenses = db.getTodayExpenses(userId);
  const text = fmt.formatExpenseList(expenses, '📅 <b>Today\'s expenses</b>', nameMap);
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
});

bot.onText(/\/week/, (msg) => {
  const userId = msg.from.id;
  const nameMap = getNameMap(userId, msg.from.first_name);
  const expenses = db.getWeekExpenses(userId);
  const text = fmt.formatExpenseList(expenses, '📆 <b>This week\'s expenses</b>', nameMap);
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
});

bot.onText(/\/month/, (msg) => {
  const userId = msg.from.id;
  const nameMap = getNameMap(userId, msg.from.first_name);
  const expenses = db.getMonthExpenses(userId);
  const text = fmt.formatExpenseList(expenses, '🗓️ <b>This month\'s expenses</b>', nameMap);
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
});

bot.onText(/\/stats/, (msg) => {
  const userId = msg.from.id;
  const stats = db.getMonthCategoryStats(userId);
  const monthTotal = db.getMonthTotal(userId);
  const text = fmt.formatCategoryStats(stats, monthTotal);
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
});

bot.onText(/\/overview/, (msg) => {
  const userId = msg.from.id;
  const months = db.getMonthlyOverview(userId);
  const text = fmt.formatMonthlyOverview(months);
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
});

bot.onText(/\/delete\s*(\d+)?/, (msg, match) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const expenseId = match[1];
  const nameMap = getNameMap(userId, msg.from.first_name);

  if (!expenseId) {
    const recent = db.getRecentExpenses(userId, 10);
    if (recent.length === 0) {
      bot.sendMessage(chatId, '📭 No expenses to delete.');
      return;
    }

    const isShared = Object.keys(nameMap).length > 1;
    let text = '🗑️ <b>Choose an expense to delete:</b>\n\n';
    text += 'Send: <code>/delete ID</code>\n\n';
    recent.forEach((e) => {
      const emoji = fmt.getCategoryEmoji(e.category);
      const who = isShared && nameMap[e.user_id] ? ` • 👤 ${nameMap[e.user_id]}` : '';
      text += `${emoji} #${e.id} - ${fmt.formatMoney(e.amount)} - ${e.description || 'No description'} (${e.date})${who}\n`;
    });

    bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    return;
  }

  const success = db.deleteExpense(userId, parseInt(expenseId));
  if (success) {
    bot.sendMessage(chatId, `✅ Deleted expense #${expenseId}!`);
  } else {
    bot.sendMessage(chatId, `❌ Expense #${expenseId} not found or you don't have permission to delete it.`);
  }
});

function parseAmount(text) {
  text = text.trim().toLowerCase().replace(/,/g, '');

  let match = text.match(/^([\d.]+)\s*(tr|triệu|m)$/);
  if (match) {
    return parseFloat(match[1]) * 1000000;
  }

  match = text.match(/^([\d.]+)\s*(k|nghìn|ngàn)$/);
  if (match) {
    return parseFloat(match[1]) * 1000;
  }

  match = text.match(/^[\d.]+$/);
  if (match) {
    const cleaned = text.replace(/\./g, '');
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num > 0) return num;
  }

  return null;
}

function autoDetectCategory(description) {
  const desc = description.toLowerCase();

  const rules = [
    { keywords: ['eat', 'pho', 'rice', 'noodle', 'cake', 'tea', 'coffee', 'cafe', 'drink', 'beer', 'restaurant', 'lunch', 'dinner', 'breakfast', 'hotpot', 'grill', 'chicken', 'beef', 'pork', 'fish', 'shrimp', 'milk tea', 'boba', 'snack', 'pizza', 'burger', 'sushi', 'ăn', 'phở', 'cơm', 'bún', 'mì', 'bánh', 'trà', 'cà phê', 'nước', 'bia', 'nhậu', 'quán', 'uống', 'trà sữa', 'sáng', 'trưa', 'tối', 'lẩu', 'nướng', 'gà', 'bò', 'heo', 'cá', 'tôm'], category: 'Food & Drinks' },
    { keywords: ['grab', 'gojek', 'be', 'taxi', 'car', 'gas', 'fuel', 'parking', 'bus', 'metro', 'train', 'flight', 'transport', 'uber', 'xe', 'xăng', 'gửi xe', 'xe buýt', 'vé tàu', 'vé máy bay', 'di chuyển'], category: 'Transport' },
    { keywords: ['buy', 'shopping', 'pants', 'shirt', 'shoes', 'bag', 'accessory', 'shopee', 'lazada', 'tiki', 'amazon', 'mua', 'quần', 'áo', 'giày', 'dép', 'túi', 'phụ kiện', 'đồ'], category: 'Shopping' },
    { keywords: ['game', 'movie', 'cinema', 'watch', 'netflix', 'spotify', 'youtube', 'travel', 'karaoke', 'bar', 'club', 'entertainment', 'play', 'billiard', 'phim', 'xem', 'du lịch', 'giải trí', 'chơi'], category: 'Entertainment' },
    { keywords: ['medicine', 'hospital', 'doctor', 'dental', 'gym', 'exercise', 'vitamin', 'health', 'medical', 'thuốc', 'bệnh viện', 'khám', 'bác sĩ', 'nha khoa', 'tập', 'thể dục', 'sức khỏe', 'y tế'], category: 'Health' },
    { keywords: ['study', 'book', 'course', 'school', 'tuition', 'material', 'education', 'udemy', 'học', 'sách', 'khóa', 'trường', 'học phí', 'tài liệu', 'giáo dục'], category: 'Education' },
    { keywords: ['electric', 'water', 'internet', 'wifi', 'phone', 'rent', 'bill', 'fee', 'insurance', 'installment', 'điện', 'nước', 'điện thoại', 'thuê', 'tiền nhà', 'hóa đơn', 'phí', 'bảo hiểm', 'trả góp'], category: 'Bills' },
    { keywords: ['save', 'saving', 'bank', 'invest', 'stock', 'crypto', 'tiết kiệm', 'gửi bank', 'đầu tư', 'chứng khoán'], category: 'Savings' },
  ];

  for (const rule of rules) {
    for (const keyword of rule.keywords) {
      if (desc.includes(keyword)) {
        return rule.category;
      }
    }
  }

  return 'Other';
}

bot.on('message', (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  const state = userStates.get(userId);
  let category = null;

  if (state && state.step === 'waiting_amount') {
    category = state.category;
    userStates.delete(userId);
  }

  const parts = text.match(/^([\d.,]+\s*(?:k|tr|triệu|m|nghìn|ngàn)?)\s*(.*)?$/i);

  if (!parts) {
    bot.sendMessage(
      chatId,
      '🤔 I didn\'t understand that. Please use the format:\n<code>amount description</code>\nExample: <code>50k breakfast</code>\n\nOr type /help for instructions.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  const amountText = parts[1];
  const description = parts[2] || '';
  const amount = parseAmount(amountText);

  if (!amount || amount <= 0) {
    bot.sendMessage(chatId, '❌ Invalid amount. Please try again.');
    return;
  }

  if (amount > 1000000000) {
    bot.sendMessage(chatId, '⚠️ Amount too large (> 1 billion). Are you sure?');
    return;
  }

  if (!category) {
    category = autoDetectCategory(description);
  }

  const id = db.addExpense(userId, amount, description || 'No description', category);
  const todayTotal = db.getTodayTotal(userId);

  const partner = db.getPartnerInfo(userId);
  const sharedNote = partner ? `\n👫 Shared wallet with ${partner.name}` : '';

  const emoji = fmt.getCategoryEmoji(category);
  const confirmText =
    `✅ Recorded!\n\n` +
    `${emoji} <b>${description || 'No description'}</b>\n` +
    `💸 ${fmt.formatMoney(amount)}\n` +
    `📂 ${category}\n` +
    `🆔 #${id}\n\n` +
    `📊 Today's total: <b>${fmt.formatMoney(todayTotal)}</b>${sharedNote}`;

  bot.sendMessage(chatId, confirmText, { parse_mode: 'HTML' });

  if (partner) {
    const userName = msg.from.first_name || 'Partner';
    bot.sendMessage(
      partner.id,
      `📢 <b>${userName}</b> just spent:\n\n` +
        `${emoji} <b>${description || 'No description'}</b>\n` +
        `💸 ${fmt.formatMoney(amount)}\n` +
        `📂 ${category}\n\n` +
        `📊 Today's total (shared): <b>${fmt.formatMoney(todayTotal)}</b>`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }
});

process.on('SIGINT', () => {
  console.log('\nShutting down bot...');
  db.closeDb();
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGTERM', () => {
  db.closeDb();
  bot.stopPolling();
  process.exit(0);
});

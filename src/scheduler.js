const cron = require('node-cron');
const db = require('./database');

let botInstance = null;

function init(bot) {
  botInstance = bot;

  cron.schedule('* * * * *', () => {
    checkReminders();
  });

  cron.schedule('0 0 * * *', () => {
    processRecurring();
  });

  console.log('Scheduler initialized.');
}

function checkReminders() {
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  const reminders = db.getActiveReminders(currentTime);

  reminders.forEach((reminder) => {
    const hasExpenses = db.hasTodayExpenses(reminder.user_id);
    if (!hasExpenses) {
      botInstance.sendMessage(
        reminder.chat_id,
        `🔔 <b>Daily Reminder</b>\n\n` +
          `You haven't logged any expenses today!\n` +
          `💡 Send your expenses now, e.g.: <code>50k lunch</code>\n\n` +
          `Use /reminder off to disable this reminder.`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  });
}

function processRecurring() {
  const today = new Date().toISOString().split('T')[0];
  const currentMonth = today.slice(0, 7);
  const dueItems = db.getDueRecurring(today);

  dueItems.forEach((item) => {
    const id = db.addExpense(item.user_id, item.amount, item.description, item.category, { date: today });
    db.markRecurringRun(item.id, currentMonth);

    const partner = db.getPartnerInfo(item.user_id);
    const chatId = item.user_id;

    botInstance.sendMessage(
      chatId,
      `🔄 <b>Recurring expense logged</b>\n\n` +
        `📝 ${item.description}\n` +
        `💸 ${require('./formatter').formatMoney(item.amount)}\n` +
        `📂 ${item.category}\n` +
        `🆔 #${id}`,
      { parse_mode: 'HTML' }
    ).catch(() => {});

    if (partner) {
      botInstance.sendMessage(
        partner.id,
        `🔄 Recurring expense auto-logged for <b>${db.getUserName(item.user_id) || 'Partner'}</b>:\n` +
          `📝 ${item.description} • 💸 ${require('./formatter').formatMoney(item.amount)}`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  });
}

module.exports = { init };

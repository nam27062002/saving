function formatMoney(amount) {
  return new Intl.NumberFormat('vi-VN').format(amount) + 'đ';
}

const CATEGORY_EMOJI = {
  'Food & Drinks': '🍜',
  'Transport': '🚗',
  'Shopping': '🛍️',
  'Entertainment': '🎮',
  'Health': '💊',
  'Education': '📚',
  'Bills': '📄',
  'Savings': '💰',
  'Other': '📦',
};

const CATEGORIES = Object.keys(CATEGORY_EMOJI);

function getCategoryEmoji(category) {
  return CATEGORY_EMOJI[category] || '📦';
}

function createProgressBar(value, max, length = 10) {
  const filled = Math.round((value / max) * length);
  const empty = length - filled;
  return '▓'.repeat(Math.min(filled, length)) + '░'.repeat(Math.max(empty, 0));
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = days[date.getDay()];
  return `${day}, ${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}`;
}

function formatDateTime(dateTimeStr) {
  const date = new Date(dateTimeStr);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function formatExpenseList(expenses, title, nameMap = null) {
  if (expenses.length === 0) {
    return `${title}\n\n📭 No expenses yet.`;
  }

  const isShared = nameMap && Object.keys(nameMap).length > 1;
  let total = 0;
  let lines = [`${title}\n`];

  expenses.forEach((expense) => {
    const emoji = getCategoryEmoji(expense.category);
    const time = expense.created_at ? ` (${formatDateTime(expense.created_at)})` : '';
    const who = isShared && expense.user_id && nameMap[expense.user_id]
      ? ` • 👤 ${nameMap[expense.user_id]}`
      : '';
    lines.push(
      `${emoji} <b>${expense.description || 'No description'}</b>` +
      `\n   💸 ${formatMoney(expense.amount)} • #${expense.id}${time}${who}`
    );
    total += expense.amount;
  });

  lines.push(`\n━━━━━━━━━━━━━━━━━━`);
  lines.push(`💰 <b>Total: ${formatMoney(total)}</b>`);

  return lines.join('\n');
}

function formatCategoryStats(stats, monthTotal) {
  if (stats.length === 0) {
    return '📊 <b>Category stats this month</b>\n\n📭 No data yet.';
  }

  let lines = ['📊 <b>Category stats this month</b>\n'];

  stats.forEach((stat) => {
    const emoji = getCategoryEmoji(stat.category);
    const percentage = monthTotal > 0 ? ((stat.total / monthTotal) * 100).toFixed(1) : 0;
    const bar = createProgressBar(stat.total, monthTotal);
    lines.push(
      `${emoji} <b>${stat.category}</b>` +
      `\n   ${bar} ${percentage}%` +
      `\n   ${formatMoney(stat.total)} (${stat.count} items)`
    );
  });

  lines.push(`\n━━━━━━━━━━━━━━━━━━`);
  lines.push(`💰 <b>Monthly total: ${formatMoney(monthTotal)}</b>`);

  return lines.join('\n');
}

function formatMonthlyOverview(months) {
  if (months.length === 0) {
    return '📈 <b>Monthly overview</b>\n\n📭 No data yet.';
  }

  let lines = ['📈 <b>Last 12 months overview</b>\n'];
  const maxTotal = Math.max(...months.map(m => m.total));

  months.forEach((month) => {
    const [year, mon] = month.month.split('-');
    const bar = createProgressBar(month.total, maxTotal, 8);
    lines.push(
      `📅 <b>${mon}/${year}</b>` +
      `\n   ${bar} ${formatMoney(month.total)} (${month.count} items)`
    );
  });

  return lines.join('\n');
}

module.exports = {
  formatMoney,
  formatDate,
  formatDateTime,
  formatExpenseList,
  formatCategoryStats,
  formatMonthlyOverview,
  getCategoryEmoji,
  CATEGORIES,
  CATEGORY_EMOJI,
};

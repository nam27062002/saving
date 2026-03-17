function formatMoney(amount) {
  return new Intl.NumberFormat('vi-VN').format(Math.round(amount)) + 'đ';
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
  if (max === 0) return '░'.repeat(length);
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
    const splitTag = expense.is_split ? ' 🔀' : '';
    const tags = expense.tags ? ` ${expense.tags}` : '';
    const photoIcon = expense.photo_id ? ' 📸' : '';
    lines.push(
      `${emoji} <b>${expense.description || 'No description'}</b>${splitTag}${photoIcon}${tags}` +
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

function formatBudgetStatus(budget, spent) {
  const remaining = budget.amount - spent;
  const percentage = budget.amount > 0 ? (spent / budget.amount * 100).toFixed(1) : 0;
  const bar = createProgressBar(spent, budget.amount, 15);

  let statusEmoji = '✅';
  let statusText = 'On track';
  if (percentage >= 100) {
    statusEmoji = '🚨';
    statusText = 'OVER BUDGET!';
  } else if (percentage >= 80) {
    statusEmoji = '⚠️';
    statusText = 'Almost at limit';
  } else if (percentage >= 50) {
    statusEmoji = '📊';
    statusText = 'Half spent';
  }

  return `💰 <b>Budget Status - ${budget.month}</b>\n\n` +
    `${bar}\n` +
    `${statusEmoji} ${statusText} (${percentage}%)\n\n` +
    `📌 Budget: <b>${formatMoney(budget.amount)}</b>\n` +
    `💸 Spent: <b>${formatMoney(spent)}</b>\n` +
    `💵 Remaining: <b>${formatMoney(Math.max(remaining, 0))}</b>` +
    (remaining < 0 ? `\n🚨 Over by: <b>${formatMoney(Math.abs(remaining))}</b>` : '');
}

function formatInsights(currentStats, prevStats, currentTotal, prevTotal) {
  let lines = ['🔍 <b>Spending Insights</b>\n'];

  if (prevTotal === 0 && currentTotal === 0) {
    return '🔍 <b>Spending Insights</b>\n\n📭 Not enough data. Start tracking to see insights!';
  }

  const changePercent = prevTotal > 0 ? ((currentTotal - prevTotal) / prevTotal * 100).toFixed(1) : 0;
  const changeIcon = currentTotal > prevTotal ? '📈' : currentTotal < prevTotal ? '📉' : '➡️';
  const changeWord = currentTotal > prevTotal ? 'more' : currentTotal < prevTotal ? 'less' : 'same';

  lines.push(`<b>This month vs Last month:</b>`);
  lines.push(`   This month: ${formatMoney(currentTotal)}`);
  lines.push(`   Last month: ${formatMoney(prevTotal)}`);
  lines.push(`   ${changeIcon} ${Math.abs(changePercent)}% ${changeWord}\n`);

  const prevMap = {};
  prevStats.forEach(s => { prevMap[s.category] = s.total; });

  lines.push(`<b>Category changes:</b>`);
  currentStats.forEach((stat) => {
    const emoji = getCategoryEmoji(stat.category);
    const prev = prevMap[stat.category] || 0;
    const diff = stat.total - prev;
    const diffPercent = prev > 0 ? ((diff / prev) * 100).toFixed(0) : (stat.total > 0 ? '+∞' : '0');
    const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
    lines.push(`   ${emoji} ${stat.category}: ${formatMoney(stat.total)} ${arrow} ${typeof diffPercent === 'string' ? diffPercent : (diff > 0 ? '+' : '') + diffPercent}%`);
  });

  return lines.join('\n');
}

function formatSplitSummary(splitData, nameMap) {
  if (!splitData || splitData.length < 2) {
    return '🔀 <b>Split Summary</b>\n\n📭 No split expenses this month or not paired.';
  }

  let lines = ['🔀 <b>Split Summary - This Month</b>\n'];

  const entries = splitData.map(s => ({
    name: nameMap[s.user_id] || 'Unknown',
    userId: s.user_id,
    total: s.total,
    share: s.total / 2,
  }));

  const totalSplit = entries.reduce((sum, e) => sum + e.total, 0);
  const fairShare = totalSplit / 2;

  entries.forEach(e => {
    lines.push(`👤 <b>${e.name}</b>: paid ${formatMoney(e.total)}`);
  });

  lines.push(`\n💰 Total split expenses: ${formatMoney(totalSplit)}`);
  lines.push(`📊 Fair share each: ${formatMoney(fairShare)}`);

  const diff = entries[0].total - fairShare;
  if (Math.abs(diff) > 100) {
    if (diff > 0) {
      lines.push(`\n💸 <b>${entries[1].name}</b> owes <b>${entries[0].name}</b>: <b>${formatMoney(diff)}</b>`);
    } else {
      lines.push(`\n💸 <b>${entries[0].name}</b> owes <b>${entries[1].name}</b>: <b>${formatMoney(Math.abs(diff))}</b>`);
    }
  } else {
    lines.push(`\n✅ You're even!`);
  }

  return lines.join('\n');
}

function expensesToCSV(expenses, nameMap = null) {
  const isShared = nameMap && Object.keys(nameMap).length > 1;
  let csv = 'ID,Date,Amount,Description,Category,Tags,Split';
  if (isShared) csv += ',Added By';
  csv += '\n';

  expenses.forEach(e => {
    const desc = (e.description || '').replace(/"/g, '""');
    const tags = (e.tags || '').replace(/"/g, '""');
    csv += `${e.id},${e.date},${e.amount},"${desc}",${e.category},"${tags}",${e.is_split ? 'Yes' : 'No'}`;
    if (isShared) csv += `,"${nameMap[e.user_id] || 'Unknown'}"`;
    csv += '\n';
  });

  return csv;
}

function buildChartUrl(type, labels, data, title) {
  const colors = [
    'rgba(255, 99, 132, 0.8)', 'rgba(54, 162, 235, 0.8)',
    'rgba(255, 206, 86, 0.8)', 'rgba(75, 192, 192, 0.8)',
    'rgba(153, 102, 255, 0.8)', 'rgba(255, 159, 64, 0.8)',
    'rgba(199, 199, 199, 0.8)', 'rgba(83, 102, 255, 0.8)',
    'rgba(255, 99, 255, 0.8)',
  ];

  const chartConfig = {
    type: type,
    data: {
      labels: labels,
      datasets: [{
        label: title,
        data: data,
        backgroundColor: colors.slice(0, data.length),
        borderColor: type === 'bar' ? colors.slice(0, data.length).map(c => c.replace('0.8', '1')) : undefined,
        borderWidth: type === 'pie' ? 2 : 1,
      }],
    },
    options: {
      plugins: {
        title: { display: true, text: title, font: { size: 16 } },
        legend: { display: type === 'pie', position: 'bottom' },
      },
      scales: type === 'bar' ? {
        y: { beginAtZero: true, ticks: { callback: (v) => (v / 1000) + 'k' } }
      } : undefined,
    },
  };

  const encoded = encodeURIComponent(JSON.stringify(chartConfig));
  return `https://quickchart.io/chart?c=${encoded}&w=600&h=400&bkg=white`;
}

module.exports = {
  formatMoney, formatDate, formatDateTime,
  formatExpenseList, formatCategoryStats, formatMonthlyOverview,
  formatBudgetStatus, formatInsights, formatSplitSummary,
  expensesToCSV, buildChartUrl,
  getCategoryEmoji, CATEGORIES, CATEGORY_EMOJI,
};

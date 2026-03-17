const CATEGORY_EMOJI = {
  'Food & Drinks': '🍜', 'Transport': '🚗', 'Shopping': '🛍️',
  'Entertainment': '🎮', 'Health': '💊', 'Education': '📚',
  'Bills': '📄', 'Savings': '💰', 'Other': '📦',
};

const CHART_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#3b82f6',
  '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b',
];

let currentPeriod = 'month';
let allExpenses = [];
let categoryChart, dailyChart, monthlyChart;

function formatMoney(amount) {
  return new Intl.NumberFormat('vi-VN').format(Math.round(amount)) + 'đ';
}

function formatShort(amount) {
  if (amount >= 1000000) return (amount / 1000000).toFixed(1) + 'M';
  if (amount >= 1000) return (amount / 1000).toFixed(0) + 'k';
  return amount.toString();
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    return res.json();
  } catch {
    return {};
  }
}

async function apiRequest(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function loadSummary() {
  const data = await fetchJSON('/api/summary');
  if (data.error) return;

  document.getElementById('statToday').textContent = formatMoney(data.today || 0);
  document.getElementById('statWeek').textContent = formatMoney(data.week || 0);
  document.getElementById('statMonth').textContent = formatMoney(data.month || 0);

  const changeEl = document.getElementById('statMonthChange');
  if (data.monthChange !== null && data.monthChange !== undefined) {
    const isUp = parseFloat(data.monthChange) > 0;
    changeEl.className = `stat-change ${isUp ? 'negative' : 'positive'}`;
    changeEl.textContent = `${isUp ? '↑' : '↓'} ${Math.abs(data.monthChange)}% vs last month`;
  } else {
    changeEl.className = 'stat-change neutral';
    changeEl.textContent = 'No previous data';
  }

  const budgetEl = document.getElementById('statBudget');
  const budgetChangeEl = document.getElementById('statBudgetChange');
  const budgetBar = document.getElementById('budgetBar');
  const budgetFill = document.getElementById('budgetFill');

  if (data.budget) {
    const remaining = data.budget - (data.month || 0);
    budgetEl.textContent = formatMoney(remaining > 0 ? remaining : 0);
    const pct = parseFloat(data.budgetPercent);

    budgetBar.style.display = 'block';
    budgetFill.style.width = Math.min(pct, 100) + '%';
    budgetFill.className = `budget-fill ${pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'safe'}`;

    if (pct >= 100) {
      budgetChangeEl.className = 'stat-change negative';
      budgetChangeEl.textContent = `🚨 Over by ${formatMoney(Math.abs(remaining))}`;
    } else {
      budgetChangeEl.className = 'stat-change positive';
      budgetChangeEl.textContent = `${pct}% used of ${formatMoney(data.budget)}`;
    }
  } else {
    budgetEl.textContent = 'Not set';
    budgetChangeEl.className = 'stat-change neutral';
    budgetChangeEl.textContent = 'Click to set budget';
    budgetBar.style.display = 'none';
  }
}

async function loadPartner() {
  const data = await fetchJSON('/api/partner');
  const el = document.getElementById('partnerStatus');
  if (data.paired) {
    el.innerHTML = `👫 Shared with <strong>${data.partner}</strong>`;
  } else {
    el.textContent = 'Your personal finance dashboard';
  }
}

async function loadCharts() {
  const [categories, daily, monthly] = await Promise.all([
    fetchJSON('/api/categories'),
    fetchJSON('/api/daily'),
    fetchJSON('/api/monthly'),
  ]);

  renderCategoryChart(Array.isArray(categories) ? categories : []);
  renderDailyChart(Array.isArray(daily) ? daily : []);
  renderMonthlyChart(Array.isArray(monthly) ? monthly : []);
}

function chartDefaults() {
  return { color: '#94a3b8', borderColor: 'rgba(255,255,255,0.06)', font: { family: 'Inter' } };
}

function renderCategoryChart(data) {
  const ctx = document.getElementById('categoryChart').getContext('2d');
  if (categoryChart) categoryChart.destroy();

  if (!data.length) {
    ctx.font = '14px Inter';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    ctx.fillText('No data yet', ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }

  categoryChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: data.map(d => `${CATEGORY_EMOJI[d.category] || '📦'} ${d.category}`),
      datasets: [{
        data: data.map(d => d.total),
        backgroundColor: CHART_COLORS.slice(0, data.length),
        borderWidth: 0,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'right',
          labels: { ...chartDefaults(), padding: 12, usePointStyle: true, pointStyleWidth: 10 },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${formatMoney(ctx.raw)} (${(ctx.raw / data.reduce((s, d) => s + d.total, 0) * 100).toFixed(1)}%)`,
          },
        },
      },
    },
  });
}

function renderDailyChart(data) {
  const ctx = document.getElementById('dailyChart').getContext('2d');
  if (dailyChart) dailyChart.destroy();
  if (!data.length) return;

  dailyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.date.slice(5)),
      datasets: [{
        data: data.map(d => d.total),
        backgroundColor: 'rgba(99, 102, 241, 0.6)',
        hoverBackgroundColor: 'rgba(99, 102, 241, 0.9)',
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => formatMoney(ctx.raw) } } },
      scales: {
        x: { grid: { display: false }, ticks: { ...chartDefaults(), font: { size: 11, family: 'Inter' } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { ...chartDefaults(), font: { size: 11, family: 'Inter' }, callback: (v) => formatShort(v) } },
      },
    },
  });
}

function renderMonthlyChart(data) {
  const ctx = document.getElementById('monthlyChart').getContext('2d');
  if (monthlyChart) monthlyChart.destroy();
  if (!data.length) return;

  const sorted = [...data].reverse();
  monthlyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: sorted.map(d => d.month),
      datasets: [{
        data: sorted.map(d => d.total),
        borderColor: '#6366f1', backgroundColor: 'rgba(99, 102, 241, 0.08)',
        fill: true, tension: 0.4, pointRadius: 5, pointHoverRadius: 8,
        pointBackgroundColor: '#6366f1', pointBorderColor: '#0a0a1a', pointBorderWidth: 3, borderWidth: 3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `Total: ${formatMoney(ctx.raw)} (${sorted[ctx.dataIndex].count} items)` } } },
      scales: {
        x: { grid: { display: false }, ticks: { ...chartDefaults(), font: { size: 11, family: 'Inter' } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { ...chartDefaults(), font: { size: 11, family: 'Inter' }, callback: (v) => formatShort(v) } },
      },
    },
  });
}

async function loadExpenses() {
  const category = document.getElementById('categoryFilter').value;
  const search = document.getElementById('searchInput').value.toLowerCase();

  allExpenses = await fetchJSON(`/api/expenses?period=${currentPeriod}&category=${category}`);
  if (!Array.isArray(allExpenses)) allExpenses = [];

  let filtered = allExpenses;
  if (search) {
    filtered = filtered.filter(e =>
      (e.description || '').toLowerCase().includes(search) ||
      (e.tags || '').toLowerCase().includes(search) ||
      (e.userName || '').toLowerCase().includes(search)
    );
  }
  renderTable(filtered);
}

function renderTable(expenses) {
  const container = document.getElementById('tableContent');
  if (!expenses.length) {
    container.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>No expenses found</p></div>';
    return;
  }

  let html = `<table class="expense-table"><thead><tr>
    <th>#</th><th>Date</th><th>Description</th><th>Category</th><th>Amount</th><th>By</th><th>Actions</th>
  </tr></thead><tbody>`;

  expenses.forEach(e => {
    const emoji = CATEGORY_EMOJI[e.category] || '📦';
    const tags = (e.tags || '').split(' ').filter(Boolean).map(t => `<span class="tag-badge">${t}</span>`).join('');
    const splitBadge = e.is_split ? ' <span class="split-badge">🔀 Split</span>' : '';
    const date = e.date || (e.created_at ? e.created_at.split(' ')[0] : '--');

    html += `<tr>
      <td style="color: var(--text-muted)">${e.id}</td>
      <td style="color: var(--text-secondary); white-space: nowrap">${date}</td>
      <td>${e.description || 'No description'}${tags}${splitBadge}</td>
      <td><span class="category-badge">${emoji} ${e.category}</span></td>
      <td class="amount-cell">${formatMoney(e.amount)}</td>
      <td style="color: var(--text-secondary)">${e.userName || '--'}</td>
      <td><div class="action-btns">
        <button class="action-btn edit" onclick="openEditModal(${e.id})" title="Edit">✏️</button>
        <button class="action-btn delete" onclick="deleteExpense(${e.id})" title="Delete">🗑️</button>
      </div></td>
    </tr>`;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

async function loadRecurring() {
  const data = await fetchJSON('/api/recurring');
  const container = document.getElementById('recurringContent');

  if (!Array.isArray(data) || !data.length) {
    container.innerHTML = '<div class="empty-state"><div class="icon">🔄</div><p>No recurring expenses. Add one to auto-track monthly costs.</p></div>';
    return;
  }

  let html = `<table class="recurring-table"><thead><tr>
    <th>#</th><th>Description</th><th>Category</th><th>Amount</th><th>Day</th><th>Actions</th>
  </tr></thead><tbody>`;

  data.forEach(r => {
    const emoji = CATEGORY_EMOJI[r.category] || '📦';
    html += `<tr>
      <td style="color: var(--text-muted)">${r.id}</td>
      <td>${r.description}</td>
      <td><span class="category-badge">${emoji} ${r.category}</span></td>
      <td class="amount-cell">${formatMoney(r.amount)}</td>
      <td style="color: var(--text-secondary)">Day ${r.day_of_month}</td>
      <td><button class="action-btn delete" onclick="deleteRecurring(${r.id})" title="Delete">🗑️</button></td>
    </tr>`;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

function openModal(mode = 'add', expense = null) {
  const overlay = document.getElementById('modalOverlay');
  const title = document.getElementById('modalTitle');
  const submitBtn = document.getElementById('formSubmitBtn');
  document.getElementById('expenseForm').reset();
  document.getElementById('formDate').value = new Date().toISOString().split('T')[0];

  if (mode === 'edit' && expense) {
    title.textContent = '✏️ Edit Expense';
    submitBtn.textContent = 'Save Changes';
    document.getElementById('formExpenseId').value = expense.id;
    document.getElementById('formAmount').value = expense.amount;
    document.getElementById('formDescription').value = expense.description || '';
    document.getElementById('formCategory').value = expense.category || 'Other';
    document.getElementById('formDate').value = expense.date || '';
    document.getElementById('formTags').value = expense.tags || '';
  } else {
    title.textContent = '➕ Add Expense';
    submitBtn.textContent = 'Add Expense';
    document.getElementById('formExpenseId').value = '';
  }
  overlay.classList.add('show');
}

function closeModal() { document.getElementById('modalOverlay').classList.remove('show'); }
function closeBudgetModal() { document.getElementById('budgetModalOverlay').classList.remove('show'); }
function closeRecurringModal() { document.getElementById('recurringModalOverlay').classList.remove('show'); }

function openEditModal(id) {
  const expense = allExpenses.find(e => e.id === id);
  if (expense) openModal('edit', expense);
}

async function deleteExpense(id) {
  const expense = allExpenses.find(e => e.id === id);
  if (!confirm(`Delete "${expense?.description || '#' + id}"?`)) return;
  try {
    const r = await apiRequest(`/api/expenses/${id}`, 'DELETE');
    if (r.success) { showToast('Deleted — Telegram notified'); loadAll(); }
    else showToast(r.error || 'Failed', 'error');
  } catch { showToast('Network error', 'error'); }
}

async function deleteRecurring(id) {
  if (!confirm('Delete this recurring expense?')) return;
  try {
    const r = await apiRequest(`/api/recurring/${id}`, 'DELETE');
    if (r.success) { showToast('Recurring deleted — Telegram notified'); loadRecurring(); }
    else showToast(r.error || 'Failed', 'error');
  } catch { showToast('Network error', 'error'); }
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const expenseId = document.getElementById('formExpenseId').value;
  const data = {
    amount: parseFloat(document.getElementById('formAmount').value),
    description: document.getElementById('formDescription').value.trim(),
    category: document.getElementById('formCategory').value,
    date: document.getElementById('formDate').value,
    tags: document.getElementById('formTags').value.trim(),
  };
  if (!data.amount || data.amount <= 0) { showToast('Invalid amount', 'error'); return; }

  try {
    const r = expenseId
      ? await apiRequest(`/api/expenses/${expenseId}`, 'PUT', data)
      : await apiRequest('/api/expenses', 'POST', data);
    if (r.success) { closeModal(); showToast(`${expenseId ? 'Updated' : 'Added'} — Telegram notified`); loadAll(); }
    else showToast(r.error || 'Failed', 'error');
  } catch { showToast('Network error', 'error'); }
}

function openBudgetModal() {
  document.getElementById('budgetModalOverlay').classList.add('show');
  fetchJSON('/api/budget').then(data => {
    if (data.budget) {
      document.getElementById('budgetAmount').value = data.budget;
      updateBudgetPreview(data.budget, data.spent);
    }
  });
}

function updateBudgetPreview(budget, spent) {
  const el = document.getElementById('budgetPreview');
  if (!budget || budget <= 0) { el.innerHTML = ''; return; }
  const pct = spent ? (spent / budget * 100).toFixed(1) : 0;
  const remaining = budget - (spent || 0);
  el.innerHTML = `<div style="background: var(--bg-card); border-radius: 10px; padding: 12px 16px; margin-top: 8px;">
    <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 6px;">Preview</div>
    <div style="font-size: 15px;">Budget: <b>${formatMoney(budget)}</b></div>
    ${spent ? `<div style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">Spent: ${formatMoney(spent)} (${pct}%) • Remaining: ${formatMoney(Math.max(remaining, 0))}</div>` : ''}
  </div>`;
}

async function handleBudgetSubmit(e) {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('budgetAmount').value);
  if (!amount || amount <= 0) { showToast('Invalid amount', 'error'); return; }
  try {
    const r = await apiRequest('/api/budget', 'POST', { amount });
    if (r.success) { closeBudgetModal(); showToast(`Budget set to ${formatMoney(amount)} — Telegram notified`); loadAll(); }
    else showToast(r.error || 'Failed', 'error');
  } catch { showToast('Network error', 'error'); }
}

async function handleRecurringSubmit(e) {
  e.preventDefault();
  const data = {
    amount: parseFloat(document.getElementById('recurringAmount').value),
    description: document.getElementById('recurringDesc').value.trim(),
    category: document.getElementById('recurringCategory').value,
    day_of_month: parseInt(document.getElementById('recurringDay').value),
  };
  if (!data.amount || data.amount <= 0) { showToast('Invalid amount', 'error'); return; }
  if (!data.day_of_month || data.day_of_month < 1 || data.day_of_month > 28) { showToast('Day must be 1-28', 'error'); return; }

  try {
    const r = await apiRequest('/api/recurring', 'POST', data);
    if (r.success) { closeRecurringModal(); showToast(`Recurring added — Telegram notified`); loadRecurring(); }
    else showToast(r.error || 'Failed', 'error');
  } catch { showToast('Network error', 'error'); }
}

async function quickAdd(amount, description, category) {
  try {
    const r = await apiRequest('/api/quick-add', 'POST', { amount, description, category });
    if (r.success) {
      showToast(`⚡ ${description} ${formatMoney(amount)} added — Telegram notified`);
      loadAll();
    } else showToast(r.error || 'Failed', 'error');
  } catch { showToast('Network error', 'error'); }
}

function populateCategoryFilter() {
  const select = document.getElementById('categoryFilter');
  const formSelect = document.getElementById('formCategory');
  const recurringSelect = document.getElementById('recurringCategory');

  select.innerHTML = '<option value="all">All Categories</option>';
  formSelect.innerHTML = '';
  recurringSelect.innerHTML = '';

  Object.entries(CATEGORY_EMOJI).forEach(([name, emoji]) => {
    const opt = `<option value="${name}">${emoji} ${name}</option>`;
    select.innerHTML += opt;
    formSelect.innerHTML += opt;
    recurringSelect.innerHTML += opt;
  });
}

function initEvents() {
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod = btn.dataset.period;
      loadExpenses();
    });
  });

  document.getElementById('refreshBtn').addEventListener('click', () => { showToast('Refreshing...', 'info'); loadAll(); });
  document.getElementById('categoryFilter').addEventListener('change', loadExpenses);

  let searchTimeout;
  document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(loadExpenses, 300);
  });

  document.getElementById('addExpenseBtn').addEventListener('click', () => openModal('add'));
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
  document.getElementById('expenseForm').addEventListener('submit', handleFormSubmit);
  document.getElementById('modalOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });

  document.getElementById('budgetCard').addEventListener('click', openBudgetModal);
  document.getElementById('budgetModalClose').addEventListener('click', closeBudgetModal);
  document.getElementById('budgetCancelBtn').addEventListener('click', closeBudgetModal);
  document.getElementById('budgetForm').addEventListener('submit', handleBudgetSubmit);
  document.getElementById('budgetModalOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeBudgetModal(); });

  document.getElementById('addRecurringBtn').addEventListener('click', () => {
    document.getElementById('recurringForm').reset();
    document.getElementById('recurringModalOverlay').classList.add('show');
  });
  document.getElementById('recurringModalClose').addEventListener('click', closeRecurringModal);
  document.getElementById('recurringCancelBtn').addEventListener('click', closeRecurringModal);
  document.getElementById('recurringForm').addEventListener('submit', handleRecurringSubmit);
  document.getElementById('recurringModalOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeRecurringModal(); });

  document.querySelectorAll('.budget-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('budgetAmount').value = btn.dataset.amount;
      document.querySelectorAll('.budget-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      fetchJSON('/api/budget').then(d => updateBudgetPreview(parseInt(btn.dataset.amount), d.spent || 0));
    });
  });

  document.querySelectorAll('.quick-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      quickAdd(parseInt(btn.dataset.amount), btn.dataset.desc, btn.dataset.cat);
    });
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    const month = new Date().toISOString().slice(0, 7);
    window.location.href = `/api/export?month=${month}`;
    showToast('Downloading CSV...', 'info');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); closeBudgetModal(); closeRecurringModal(); }
  });
}

async function loadAll() {
  await Promise.all([loadSummary(), loadCharts(), loadExpenses(), loadPartner(), loadRecurring()]);
}

populateCategoryFilter();
initEvents();
loadAll();
setInterval(loadAll, 60000);

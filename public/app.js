// ==========================================================================
// SAVING TRACKER - MODERN FINTECH DASHBOARD APPLICATION SCRIPT
// ==========================================================================

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

const CHART_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#38bdf8',
  '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6', '#64748b',
];

// STATE MANAGEMENT
let state = {
  period: 'month',
  category: 'all',
  user: 'all',
  search: '',
  startDate: '',
  endDate: '',
  page: 1,
  limit: 20,
  totalPages: 1,
  chartRange: 'all',
};

let monthlyChart = null;
let categoryChart = null;
let dailyChart = null;

// UTILITIES
function formatMoney(amount) {
  return new Intl.NumberFormat('vi-VN').format(Math.round(amount || 0)) + 'đ';
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return '--';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

function formatTimeDisplay(dateTimeStr) {
  if (!dateTimeStr) return '';
  const d = new Date(dateTimeStr);
  if (isNaN(d.getTime())) return '';
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : '⚠️'}</span> ${message}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Fetch error:', url, err);
    return null;
  }
}

async function apiRequest(url, method, body) {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return await res.json();
  } catch (err) {
    console.error('API error:', url, err);
    return { error: err.message };
  }
}

// --------------------------------------------------------------------------
// SUMMARY & KPI CARDS
// --------------------------------------------------------------------------
async function loadSummary() {
  const data = await fetchJSON('/api/summary');
  if (!data) return;

  // 1. Today
  document.getElementById('statToday').textContent = formatMoney(data.today);
  
  // 2. Week
  document.getElementById('statWeek').textContent = formatMoney(data.week);

  // 3. Month
  document.getElementById('statMonth').textContent = formatMoney(data.month);
  const monthChangeEl = document.getElementById('statMonthChange');
  if (data.monthChange !== null && data.monthChange !== undefined) {
    const isUp = parseFloat(data.monthChange) > 0;
    monthChangeEl.className = `kpi-footer ${isUp ? 'negative' : 'positive'}`;
    monthChangeEl.innerHTML = `${isUp ? '↑' : '↓'} ${Math.abs(data.monthChange)}% so với tháng trước`;
  } else {
    monthChangeEl.className = 'kpi-footer';
    monthChangeEl.textContent = 'Tháng hiện tại';
  }

  // 4. Year (MỚI)
  document.getElementById('statYear').textContent = formatMoney(data.year);
  document.getElementById('statYearSub').textContent = `${data.yearCount || 0} khoản chi trong năm`;

  // 5. All-Time (MỚI)
  document.getElementById('statAllTime').textContent = formatMoney(data.allTime);
  document.getElementById('statAllTimeSub').textContent = `${data.allTimeCount || 0} khoản chi từ trước đến nay`;

  // 6. Budget
  const budgetEl = document.getElementById('statBudget');
  const budgetChangeEl = document.getElementById('statBudgetChange');
  const budgetBar = document.getElementById('budgetBar');
  const budgetFill = document.getElementById('budgetFill');

  if (data.budget) {
    const remaining = data.budget - (data.month || 0);
    budgetEl.textContent = formatMoney(remaining > 0 ? remaining : 0);
    const pct = parseFloat(data.budgetPercent) || 0;

    budgetBar.style.display = 'block';
    budgetFill.style.width = Math.min(pct, 100) + '%';
    budgetFill.className = `budget-progress-fill ${pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'safe'}`;

    if (pct >= 100) {
      budgetChangeEl.className = 'kpi-footer negative';
      budgetChangeEl.textContent = `🚨 Vượt hạn mức: ${formatMoney(Math.abs(remaining))}`;
    } else {
      budgetChangeEl.className = 'kpi-footer positive';
      budgetChangeEl.textContent = `Đã tiêu ${pct}% của ${formatMoney(data.budget)}`;
    }
  } else {
    budgetEl.textContent = 'Chưa đặt';
    budgetChangeEl.className = 'kpi-footer';
    budgetChangeEl.textContent = 'Nhấp vào đây để cài đặt';
    budgetBar.style.display = 'none';
  }

  // 7. Shared Wallet Balance
  renderSharedWallet(data.sharedStats);
}

function renderSharedWallet(sharedStats) {
  const section = document.getElementById('sharedWalletSection');
  if (!sharedStats || sharedStats.length < 2) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';

  const userA = sharedStats[0];
  const userB = sharedStats[1];

  const pctA = parseFloat(userA.percent) || 50;
  const pctB = parseFloat(userB.percent) || 50;

  document.getElementById('sharedBarA').style.width = `${pctA}%`;
  document.getElementById('sharedBarB').style.width = `${pctB}%`;

  const total = userA.total + userB.total;
  const fairShare = total / 2;
  const diff = userA.total - fairShare;

  let splitSummaryText = "Đang cân bằng chi tiêu!";
  if (Math.abs(diff) > 1000) {
    if (diff > 0) {
      splitSummaryText = `💸 ${userB.name} chuyển lại cho ${userA.name}: ${formatMoney(diff)}`;
    } else {
      splitSummaryText = `💸 ${userA.name} chuyển lại cho ${userB.name}: ${formatMoney(Math.abs(diff))}`;
    }
  }
  document.getElementById('sharedSplitText').textContent = splitSummaryText;

  const legendEl = document.getElementById('sharedLegend');
  legendEl.innerHTML = `
    <div class="legend-item">
      <span class="legend-dot user-a"></span>
      <span class="legend-name">${userA.name}</span>
      <span class="legend-amount">${formatMoney(userA.total)}</span>
      <span class="legend-percent">(${userA.percent}% • ${userA.count} khoản)</span>
    </div>
    <div class="legend-item">
      <span class="legend-dot user-b"></span>
      <span class="legend-name">${userB.name}</span>
      <span class="legend-amount">${formatMoney(userB.total)}</span>
      <span class="legend-percent">(${userB.percent}% • ${userB.count} khoản)</span>
    </div>
  `;
}

// --------------------------------------------------------------------------
// PARTNER STATUS & USERS
// --------------------------------------------------------------------------
async function loadPartnerInfo() {
  const data = await fetchJSON('/api/partner');
  const textEl = document.getElementById('partnerStatusText');
  if (data && data.paired) {
    textEl.innerHTML = `Ví đôi đồng bộ cùng <strong>${data.partner}</strong>`;
  } else {
    textEl.textContent = 'Chế độ cá nhân';
  }
}

async function loadUsersFilter() {
  const users = await fetchJSON('/api/users');
  const select = document.getElementById('userFilter');
  select.innerHTML = '<option value="all">👤 Tất cả người chi</option>';
  if (Array.isArray(users)) {
    users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = `👤 ${u.name}`;
      select.appendChild(opt);
    });
  }
}

async function loadCategories() {
  const categories = Object.keys(CATEGORY_EMOJI);
  const filterSelect = document.getElementById('categoryFilter');
  const formSelect = document.getElementById('formCategory');
  const recurringSelect = document.getElementById('recurringCategory');

  filterSelect.innerHTML = '<option value="all">📂 Tất cả danh mục</option>';
  formSelect.innerHTML = '';
  recurringSelect.innerHTML = '';

  categories.forEach(cat => {
    const emoji = CATEGORY_EMOJI[cat] || '📦';
    
    // In filter
    const opt1 = document.createElement('option');
    opt1.value = cat;
    opt1.textContent = `${emoji} ${cat}`;
    filterSelect.appendChild(opt1);

    // In Add/Edit Form
    const opt2 = document.createElement('option');
    opt2.value = cat;
    opt2.textContent = `${emoji} ${cat}`;
    formSelect.appendChild(opt2);

    // In Recurring Form
    const opt3 = document.createElement('option');
    opt3.value = cat;
    opt3.textContent = `${emoji} ${cat}`;
    recurringSelect.appendChild(opt3);
  });
}

// --------------------------------------------------------------------------
// CHARTS
// --------------------------------------------------------------------------
async function loadCharts() {
  const [monthlyData, categoryData, dailyData] = await Promise.all([
    fetchJSON(`/api/monthly?range=${state.chartRange}`),
    fetchJSON('/api/categories'),
    fetchJSON('/api/daily'),
  ]);

  renderMonthlyChart(Array.isArray(monthlyData) ? monthlyData : []);
  renderCategoryChart(Array.isArray(categoryData) ? categoryData : []);
  renderDailyChart(Array.isArray(dailyData) ? dailyData : []);
}

function renderMonthlyChart(data) {
  const ctx = document.getElementById('monthlyChart').getContext('2d');
  if (monthlyChart) monthlyChart.destroy();

  if (!data.length) return;

  const labels = data.map(d => {
    const [y, m] = d.month.split('-');
    return `T${parseInt(m)}/${y}`;
  });
  const values = data.map(d => d.total);

  monthlyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Tổng chi tiêu',
        data: values,
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.12)',
        fill: true,
        tension: 0.35,
        borderWidth: 3,
        pointBackgroundColor: '#6366f1',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 7,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e293b',
          titleColor: '#ffffff',
          bodyColor: '#cbd5e1',
          padding: 12,
          cornerRadius: 8,
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          callbacks: {
            label: (ctx) => `Chi tiêu: ${formatMoney(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.04)' },
          ticks: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans' } },
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.04)' },
          ticks: {
            color: '#94a3b8',
            font: { family: 'Plus Jakarta Sans' },
            callback: (v) => v >= 1000000 ? (v / 1000000).toFixed(0) + 'M' : (v / 1000) + 'k',
          },
        },
      },
    },
  });
}

function renderCategoryChart(data) {
  const ctx = document.getElementById('categoryChart').getContext('2d');
  if (categoryChart) categoryChart.destroy();

  if (!data.length) return;

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
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#cbd5e1',
            font: { family: 'Plus Jakarta Sans', size: 12 },
            padding: 12,
            boxWidth: 12,
            boxHeight: 12,
          },
        },
        tooltip: {
          backgroundColor: '#1e293b',
          titleColor: '#ffffff',
          bodyColor: '#cbd5e1',
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) => ` ${formatMoney(ctx.raw)}`,
          },
        },
      },
      cutout: '68%',
    },
  });
}

function renderDailyChart(data) {
  const ctx = document.getElementById('dailyChart').getContext('2d');
  if (dailyChart) dailyChart.destroy();

  if (!data.length) return;

  const labels = data.map(d => d.date.split('-')[2]);
  const values = data.map(d => d.total);

  dailyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Chi tiêu ngày',
        data: values,
        backgroundColor: 'rgba(56, 189, 248, 0.75)',
        borderRadius: 4,
        hoverBackgroundColor: '#38bdf8',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e293b',
          titleColor: '#ffffff',
          bodyColor: '#cbd5e1',
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            title: (items) => `Ngày ${items[0].label}`,
            label: (ctx) => ` ${formatMoney(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', size: 10 } },
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.04)' },
          ticks: {
            color: '#94a3b8',
            font: { family: 'Plus Jakarta Sans', size: 10 },
            callback: (v) => v >= 1000000 ? (v / 1000000).toFixed(0) + 'M' : (v / 1000) + 'k',
          },
        },
      },
    },
  });
}

// --------------------------------------------------------------------------
// ADVANCED EXPENSES TABLE
// --------------------------------------------------------------------------
async function loadExpenses() {
  const params = new URLSearchParams({
    period: state.period,
    category: state.category,
    user: state.user,
    search: state.search,
    startDate: state.startDate,
    endDate: state.endDate,
    page: state.page,
    limit: state.limit,
  });

  const data = await fetchJSON(`/api/expenses?${params.toString()}`);
  const tbody = document.getElementById('expensesTableBody');
  const emptyState = document.getElementById('tableEmptyState');
  tbody.innerHTML = '';

  if (!data || !data.expenses || data.expenses.length === 0) {
    emptyState.style.display = 'block';
    document.getElementById('filteredCountBadge').textContent = '0 khoản';
    document.getElementById('filteredTotalAmount').textContent = '0đ';
    document.getElementById('paginationBar').style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  document.getElementById('paginationBar').style.display = 'flex';

  document.getElementById('filteredCountBadge').textContent = `${data.count} khoản`;
  document.getElementById('filteredTotalAmount').textContent = formatMoney(data.total);

  let descText = 'Đang hiển thị dữ liệu ';
  if (state.period === 'today') descText += 'Hôm nay';
  else if (state.period === 'week') descText += 'Tuần này';
  else if (state.period === 'month') descText += 'Tháng này';
  else if (state.period === 'year') descText += 'Năm nay (2026)';
  else if (state.period === 'all') descText += 'Toàn thời gian';
  else if (state.period === 'custom') descText += `từ ${formatDateDisplay(state.startDate)} đến ${formatDateDisplay(state.endDate)}`;
  document.getElementById('filterDescText').textContent = descText;

  data.expenses.forEach(e => {
    const tr = document.createElement('tr');

    const dateFormatted = formatDateDisplay(e.date);
    const timeFormatted = formatTimeDisplay(e.created_at);

    const userName = e.userName || 'Nam';
    const userClass = userName.toLowerCase().includes('nam') ? 'user-nam' : 'user-ngoc';

    const tagHtml = e.tags ? `<span class="tag-badge">${e.tags}</span>` : '';
    const splitHtml = e.is_split ? '<span class="split-badge">🔀 Chia đôi</span>' : '';
    const receiptHtml = e.photo_id ? '<span class="receipt-icon" title="Có ảnh hóa đơn">📸</span>' : '';

    const catEmoji = CATEGORY_EMOJI[e.category] || '📦';

    tr.innerHTML = `
      <td class="cell-date">
        ${dateFormatted}
        <span class="cell-time">${timeFormatted}</span>
      </td>
      <td>
        <span class="user-badge ${userClass}">${userName}</span>
      </td>
      <td>
        <div class="cell-desc-title">
          <span>${escapeHtml(e.description || 'Không mô tả')}</span>
          ${receiptHtml}
          ${tagHtml}
          ${splitHtml}
        </div>
      </td>
      <td>
        <span class="category-pill">${catEmoji} ${e.category}</span>
      </td>
      <td style="text-align: right;">
        <span class="amount-text">${formatMoney(e.amount)}</span>
      </td>
      <td>
        <div class="actions-cell">
          <button class="action-btn edit-btn" title="Chỉnh sửa" data-id="${e.id}">✏️</button>
          <button class="action-btn delete-btn" title="Xóa" data-id="${e.id}">🗑️</button>
        </div>
      </td>
    `;

    tr.querySelector('.edit-btn').addEventListener('click', () => openEditModal(e));
    tr.querySelector('.delete-btn').addEventListener('click', () => deleteExpense(e.id, e.description));

    tbody.appendChild(tr);
  });

  state.totalPages = data.totalPages || 1;
  document.getElementById('paginationInfo').textContent = `Trang ${state.page} / ${state.totalPages}`;
  document.getElementById('prevPageBtn').disabled = state.page <= 1;
  document.getElementById('nextPageBtn').disabled = state.page >= state.totalPages;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --------------------------------------------------------------------------
// RECURRING EXPENSES
// --------------------------------------------------------------------------
async function loadRecurring() {
  const list = await fetchJSON('/api/recurring');
  const container = document.getElementById('recurringContent');

  if (!list || list.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p class="empty-desc">Chưa có khoản chi tiêu định kỳ nào.</p>
      </div>
    `;
    return;
  }

  let html = `
    <table class="modern-table">
      <thead>
        <tr>
          <th>Mô tả</th>
          <th>Danh mục</th>
          <th>Ngày hàng tháng</th>
          <th style="text-align: right;">Số tiền</th>
          <th style="text-align: center; width: 80px;">Xóa</th>
        </tr>
      </thead>
      <tbody>
  `;

  list.forEach(item => {
    html += `
      <tr>
        <td><strong>${escapeHtml(item.description)}</strong></td>
        <td><span class="category-pill">${CATEGORY_EMOJI[item.category] || '📦'} ${item.category}</span></td>
        <td>Ngày ${item.day_of_month}</td>
        <td style="text-align: right;"><span class="amount-text">${formatMoney(item.amount)}</span></td>
        <td style="text-align: center;">
          <button class="action-btn delete-btn" data-recurring-id="${item.id}" title="Xóa định kỳ">🗑️</button>
        </td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;

  container.querySelectorAll('[data-recurring-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-recurring-id');
      if (confirm('Bạn có chắc muốn xóa khoản chi tiêu định kỳ này?')) {
        const res = await apiRequest(`/api/recurring/${id}`, 'DELETE');
        if (res.success) {
          showToast('Đã xóa khoản chi định kỳ');
          loadRecurring();
        } else {
          showToast('Không thể xóa khoản chi', 'error');
        }
      }
    });
  });
}

// --------------------------------------------------------------------------
// MODAL & ACTIONS
// --------------------------------------------------------------------------
function openAddModal() {
  document.getElementById('modalTitle').textContent = 'Thêm chi tiêu mới';
  document.getElementById('formExpenseId').value = '';
  document.getElementById('formAmount').value = '';
  document.getElementById('formDescription').value = '';
  document.getElementById('formTags').value = '';
  document.getElementById('formIsSplit').checked = false;
  document.getElementById('formDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('formSubmitBtn').textContent = 'Thêm chi tiêu';
  document.getElementById('modalOverlay').classList.add('active');
  document.getElementById('formAmount').focus();
}

function openEditModal(expense) {
  document.getElementById('modalTitle').textContent = `Chỉnh sửa #${expense.id}`;
  document.getElementById('formExpenseId').value = expense.id;
  document.getElementById('formAmount').value = expense.amount;
  document.getElementById('formDescription').value = expense.description;
  document.getElementById('formCategory').value = expense.category;
  document.getElementById('formDate').value = expense.date;
  document.getElementById('formTags').value = expense.tags || '';
  document.getElementById('formIsSplit').checked = !!expense.is_split;
  document.getElementById('formSubmitBtn').textContent = 'Lưu thay đổi';
  document.getElementById('modalOverlay').classList.add('active');
  document.getElementById('formAmount').focus();
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
}

async function deleteExpense(id, desc) {
  if (!confirm(`Bạn có chắc muốn xóa "${desc || 'khoản chi #' + id}"?`)) return;

  const res = await apiRequest(`/api/expenses/${id}`, 'DELETE');
  if (res.success) {
    showToast('Đã xóa khoản chi tiêu thành công');
    loadSummary();
    loadExpenses();
    loadCharts();
  } else {
    showToast('Xóa thất bại: ' + (res.error || 'Lỗi không xác định'), 'error');
  }
}

// --------------------------------------------------------------------------
// EVENT BINDINGS & INIT
// --------------------------------------------------------------------------
function setupEvents() {
  // Period Tabs
  document.getElementById('periodTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.period-tab');
    if (!tab) return;

    document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    const period = tab.getAttribute('data-period');
    state.period = period;
    state.page = 1;

    const customDateEl = document.getElementById('customDateRange');
    if (period === 'custom') {
      customDateEl.style.display = 'flex';
      return;
    } else {
      customDateEl.style.display = 'none';
      state.startDate = '';
      state.endDate = '';
    }

    loadExpenses();
  });

  // Custom Date Apply
  document.getElementById('applyCustomDateBtn').addEventListener('click', () => {
    state.startDate = document.getElementById('filterStartDate').value;
    state.endDate = document.getElementById('filterEndDate').value;
    state.page = 1;
    loadExpenses();
  });

  // Category Filter
  document.getElementById('categoryFilter').addEventListener('change', (e) => {
    state.category = e.target.value;
    state.page = 1;
    loadExpenses();
  });

  // User Filter
  document.getElementById('userFilter').addEventListener('change', (e) => {
    state.user = e.target.value;
    state.page = 1;
    loadExpenses();
  });

  // Search with Debounce
  let searchTimeout = null;
  const searchInput = document.getElementById('searchInput');
  const clearBtn = document.getElementById('clearSearchBtn');

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    clearBtn.style.display = searchInput.value ? 'block' : 'none';
    searchTimeout = setTimeout(() => {
      state.search = searchInput.value.trim();
      state.page = 1;
      loadExpenses();
    }, 300);
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.style.display = 'none';
    state.search = '';
    state.page = 1;
    loadExpenses();
  });

  // Reset Filters
  document.getElementById('resetFiltersBtn').addEventListener('click', () => {
    state.period = 'month';
    state.category = 'all';
    state.user = 'all';
    state.search = '';
    state.startDate = '';
    state.endDate = '';
    state.page = 1;

    searchInput.value = '';
    clearBtn.style.display = 'none';
    document.getElementById('categoryFilter').value = 'all';
    document.getElementById('userFilter').value = 'all';
    document.getElementById('customDateRange').style.display = 'none';

    document.querySelectorAll('.period-tab').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-period') === 'month');
    });

    loadExpenses();
    showToast('Đã đặt lại bộ lọc');
  });

  // Pagination
  document.getElementById('prevPageBtn').addEventListener('click', () => {
    if (state.page > 1) {
      state.page--;
      loadExpenses();
    }
  });

  document.getElementById('nextPageBtn').addEventListener('click', () => {
    if (state.page < state.totalPages) {
      state.page++;
      loadExpenses();
    }
  });

  // Chart Range Toggle
  document.getElementById('chartRangeAllBtn').addEventListener('click', function() {
    this.classList.add('active');
    document.getElementById('chartRange12Btn').classList.remove('active');
    state.chartRange = 'all';
    loadCharts();
  });

  document.getElementById('chartRange12Btn').addEventListener('click', function() {
    this.classList.add('active');
    document.getElementById('chartRangeAllBtn').classList.remove('active');
    state.chartRange = '12m';
    loadCharts();
  });

  // Quick Add Pills
  document.querySelectorAll('.quick-pill').forEach(btn => {
    btn.addEventListener('click', async () => {
      const amount = parseFloat(btn.getAttribute('data-amount'));
      const description = btn.getAttribute('data-desc');
      const category = btn.getAttribute('data-cat');

      btn.style.transform = 'scale(0.95)';
      setTimeout(() => btn.style.transform = '', 150);

      const res = await apiRequest('/api/quick-add', 'POST', { amount, description, category });
      if (res.success) {
        showToast(`Đã thêm nhanh: ${description} (${formatMoney(amount)})`);
        loadSummary();
        loadExpenses();
        loadCharts();
      } else {
        showToast('Lỗi khi thêm nhanh', 'error');
      }
    });
  });

  // Export CSV
  document.getElementById('exportBtn').addEventListener('click', () => {
    const params = new URLSearchParams({
      period: state.period,
      category: state.category,
      user: state.user,
      search: state.search,
    });
    window.location.href = `/api/export?${params.toString()}`;
  });

  // Refresh Button
  document.getElementById('refreshBtn').addEventListener('click', () => {
    const btn = document.getElementById('refreshBtn');
    btn.style.transform = 'rotate(180deg)';
    setTimeout(() => btn.style.transform = '', 300);
    loadAll();
    showToast('Dữ liệu đã được làm mới');
  });

  // Add Expense Button & Modals
  document.getElementById('addExpenseBtn').addEventListener('click', openAddModal);
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalCancelBtn').addEventListener('click', closeModal);

  // Amount Presets
  document.querySelectorAll('.preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const val = chip.getAttribute('data-val');
      const input = document.getElementById('formAmount');
      input.value = val;
      input.focus();
    });
  });

  // Submit Expense Form
  document.getElementById('expenseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('formExpenseId').value;
    const amount = parseFloat(document.getElementById('formAmount').value);
    const description = document.getElementById('formDescription').value.trim();
    const category = document.getElementById('formCategory').value;
    const date = document.getElementById('formDate').value;
    const tags = document.getElementById('formTags').value.trim();
    const isSplit = document.getElementById('formIsSplit').checked;

    if (!amount || amount <= 0) {
      showToast('Vui lòng nhập số tiền hợp lệ', 'error');
      return;
    }

    const payload = { amount, description, category, date, tags, is_split: isSplit };
    let res;
    if (id) {
      res = await apiRequest(`/api/expenses/${id}`, 'PUT', payload);
    } else {
      res = await apiRequest('/api/expenses', 'POST', payload);
    }

    if (res.success) {
      showToast(id ? 'Đã cập nhật khoản chi thành công' : 'Đã thêm khoản chi thành công');
      closeModal();
      loadSummary();
      loadExpenses();
      loadCharts();
    } else {
      showToast('Thao tác thất bại: ' + (res.error || 'Lỗi'), 'error');
    }
  });

  // Budget Modal
  const budgetModal = document.getElementById('budgetModalOverlay');
  document.getElementById('budgetCard').addEventListener('click', async () => {
    const b = await fetchJSON('/api/budget');
    if (b && b.budget) {
      document.getElementById('budgetAmount').value = b.budget;
    }
    budgetModal.classList.add('active');
  });

  document.getElementById('budgetModalClose').addEventListener('click', () => budgetModal.classList.remove('active'));
  document.getElementById('budgetCancelBtn').addEventListener('click', () => budgetModal.classList.remove('active'));

  document.querySelectorAll('.budget-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('budgetAmount').value = btn.getAttribute('data-amount');
    });
  });

  document.getElementById('budgetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('budgetAmount').value);
    const res = await apiRequest('/api/budget', 'POST', { amount });
    if (res.success) {
      showToast('Đã lưu hạn mức ngân sách tháng');
      budgetModal.classList.remove('active');
      loadSummary();
    } else {
      showToast('Lỗi khi lưu ngân sách', 'error');
    }
  });

  // Recurring Modal
  const recurringModal = document.getElementById('recurringModalOverlay');
  document.getElementById('addRecurringBtn').addEventListener('click', () => recurringModal.classList.add('active'));
  document.getElementById('recurringModalClose').addEventListener('click', () => recurringModal.classList.remove('active'));
  document.getElementById('recurringCancelBtn').addEventListener('click', () => recurringModal.classList.remove('active'));

  document.getElementById('recurringForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('recurringAmount').value);
    const description = document.getElementById('recurringDesc').value.trim();
    const category = document.getElementById('recurringCategory').value;
    const day_of_month = parseInt(document.getElementById('recurringDay').value);

    const res = await apiRequest('/api/recurring', 'POST', { amount, description, category, day_of_month });
    if (res.success) {
      showToast('Đã thêm khoản chi định kỳ');
      recurringModal.classList.remove('active');
      loadRecurring();
    } else {
      showToast('Lỗi: ' + (res.error || 'Không thể thêm'), 'error');
    }
  });
}

function loadAll() {
  loadSummary();
  loadPartnerInfo();
  loadUsersFilter();
  loadCategories();
  loadCharts();
  loadExpenses();
  loadRecurring();
}

// BOOTSTRAP
document.addEventListener('DOMContentLoaded', () => {
  setupEvents();
  loadAll();
});

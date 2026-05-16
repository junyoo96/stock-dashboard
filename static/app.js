const EYE_OPEN = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_CLOSED = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

const hiddenGraphStocks = new Set();
let _graphValidData = [];
const _graphReturns = new Map(); // symbol -> { ret, name, color }

function updateInvestResult() {
  const input    = document.getElementById('gvInvestAmount');
  const resultEl = document.getElementById('gvInvestResult');
  if (!input || !resultEl) return;

  const amount = parseFloat(input.value.replace(/,/g, ''));
  if (!amount || amount <= 0) { resultEl.classList.add('hidden'); return; }

  const active = [..._graphReturns.entries()]
    .filter(([sym]) => !hiddenGraphStocks.has(sym))
    .sort((a, b) => b[1].ret - a[1].ret);

  if (!active.length) { resultEl.classList.add('hidden'); return; }

  const fmt = v => '₩' + Math.round(Math.abs(v)).toLocaleString('ko-KR');

  resultEl.classList.remove('hidden');
  resultEl.innerHTML = `
    <table class="gv-invest-table">
      <thead>
        <tr>
          <th>종목</th>
          <th>수익률</th>
          <th>투자금액</th>
          <th>최종금액</th>
          <th>손익</th>
        </tr>
      </thead>
      <tbody>
        ${active.map(([sym, { ret, name, color }]) => {
          const final  = amount * (1 + ret / 100);
          const profit = final - amount;
          const sign   = profit >= 0 ? '+' : '-';
          const state  = profit > 0 ? 'up' : profit < 0 ? 'down' : 'flat';
          return `
            <tr>
              <td><span class="gv-it-dot" style="background:${color}"></span><span class="gv-it-sym">${sym}</span><span class="gv-it-name">${name || ''}</span></td>
              <td class="${state}">${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%</td>
              <td>${fmt(amount)}</td>
              <td class="${state}">${fmt(final)}</td>
              <td class="${state}">${sign}${fmt(profit)}</td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

const STOCK_CHART_COLORS = [
  '#4d96ff', '#ff6b6b', '#69db7c', '#ffd93d', '#cc5de8',
  '#ff922b', '#74c0fc', '#f06595', '#a9e34b', '#20c997',
  '#ff8787', '#63e6be', '#e599f7', '#ffec99', '#a5d8ff',
];

let graphViewChartInstance = null;
let graphViewCurrentPeriod = '1d';
let stockChartsInstances = {};
let stockChartsCurrentPeriod = '1d';

// ─── 공통: 모든 뷰 숨기고 대시보드 복원 ─────────────────────────
function hideAllViews() {
  document.querySelector('main').classList.remove('hidden');
  document.getElementById('graphView').classList.add('hidden');
  document.getElementById('stockChartsView').classList.add('hidden');
  document.getElementById('graphViewBtn').classList.remove('active');
  document.getElementById('stockChartsViewBtn').classList.remove('active');
  Object.values(stockChartsInstances).forEach(c => c?.destroy());
  stockChartsInstances = {};
  hiddenGraphStocks.clear();
}

function initGraphView() {
  document.getElementById('graphViewBtn').addEventListener('click', toggleGraphView);
  document.getElementById('graphBackBtn').addEventListener('click', hideAllViews);
  document.querySelectorAll('.gv-pbtn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.gv-pbtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      graphViewCurrentPeriod = btn.dataset.p;
      loadGraphView(graphViewCurrentPeriod);
    });
  });

  document.getElementById('gvInvestAmount').addEventListener('input', e => {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    e.target.value = raw ? parseInt(raw, 10).toLocaleString('ko-KR') : '';
    updateInvestResult();
  });

  document.getElementById('graphViewLegend').addEventListener('click', e => {
    if (!graphViewChartInstance) return;

    if (e.target.closest('#gvShowAll')) {
      _graphValidData.forEach((_, i) => graphViewChartInstance.setDatasetVisibility(i, true));
      graphViewChartInstance.update();
      hiddenGraphStocks.clear();
      document.querySelectorAll('#graphViewLegend .gv-legend-item').forEach(item => {
        item.classList.remove('gv-item-hidden');
        item.querySelector('.gv-eye-btn').innerHTML = EYE_OPEN;
      });
      updateInvestResult();
      return;
    }

    if (e.target.closest('#gvHideAll')) {
      _graphValidData.forEach(({ symbol }, i) => {
        graphViewChartInstance.setDatasetVisibility(i, false);
        hiddenGraphStocks.add(symbol);
      });
      graphViewChartInstance.update();
      document.querySelectorAll('#graphViewLegend .gv-legend-item').forEach(item => {
        item.classList.add('gv-item-hidden');
        item.querySelector('.gv-eye-btn').innerHTML = EYE_CLOSED;
      });
      updateInvestResult();
      return;
    }

    const btn = e.target.closest('.gv-eye-btn');
    if (!btn) return;
    const sym = btn.dataset.symbol;
    const idx = +btn.dataset.idx;
    const nowVisible = graphViewChartInstance.isDatasetVisible(idx);
    graphViewChartInstance.setDatasetVisibility(idx, !nowVisible);
    graphViewChartInstance.update();
    const item = btn.closest('.gv-legend-item');
    if (nowVisible) {
      hiddenGraphStocks.add(sym);
      btn.innerHTML = EYE_CLOSED;
      item.classList.add('gv-item-hidden');
    } else {
      hiddenGraphStocks.delete(sym);
      btn.innerHTML = EYE_OPEN;
      item.classList.remove('gv-item-hidden');
    }
    updateInvestResult();
  });
}

function toggleGraphView() {
  const showing = !document.getElementById('graphView').classList.contains('hidden');
  hideAllViews();
  if (!showing) {
    document.querySelector('main').classList.add('hidden');
    document.getElementById('graphView').classList.remove('hidden');
    document.getElementById('graphViewBtn').classList.add('active');
    loadGraphView(graphViewCurrentPeriod);
  }
}

// ─── 종목별 그래프 뷰 ─────────────────────────────────────────
function initStockChartsView() {
  document.getElementById('stockChartsViewBtn').addEventListener('click', toggleStockChartsView);
  document.getElementById('stockChartsBackBtn').addEventListener('click', hideAllViews);
  document.querySelectorAll('.scv-pbtn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.scv-pbtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      stockChartsCurrentPeriod = btn.dataset.p;
      loadStockChartsView(stockChartsCurrentPeriod);
    });
  });
}

function toggleStockChartsView() {
  const showing = !document.getElementById('stockChartsView').classList.contains('hidden');
  hideAllViews();
  if (!showing) {
    document.querySelector('main').classList.add('hidden');
    document.getElementById('stockChartsView').classList.remove('hidden');
    document.getElementById('stockChartsViewBtn').classList.add('active');
    loadStockChartsView(stockChartsCurrentPeriod);
  }
}

async function loadStockChartsView(period) {
  const grid = document.getElementById('stockChartsGrid');
  Object.values(stockChartsInstances).forEach(c => c?.destroy());
  stockChartsInstances = {};

  if (!stocks.length) {
    grid.innerHTML = '<p class="gv-empty">추가된 종목이 없습니다.<br>대시보드에서 종목을 먼저 추가해주세요.</p>';
    return;
  }

  grid.innerHTML = stocks.map(s => {
    const id = s.symbol.replace(/[^a-zA-Z0-9]/g, '_');
    return `
      <div class="scv-card">
        <div class="scv-card-head">
          <div class="scv-card-info">
            <span class="scv-card-name">${s.name || s.symbol}</span>
            <span class="scv-card-sym">${s.symbol}</span>
          </div>
          <div class="scv-card-vals">
            <span class="scv-price" id="scvp-${id}">—</span>
            <span class="scv-ret" id="scvr-${id}">—</span>
          </div>
        </div>
        <div class="scv-chart-wrap">
          <canvas id="scv-canvas-${id}"></canvas>
        </div>
      </div>`;
  }).join('');

  await Promise.allSettled(stocks.map(async s => {
    const id = s.symbol.replace(/[^a-zA-Z0-9]/g, '_');
    try {
      const res = await fetch(`/api/chart/${encodeURIComponent(s.symbol)}?period=${period}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (!data.close?.length) throw new Error();

      const first = data.close[0];
      const last  = data.close[data.close.length - 1];
      const ret   = (last - first) / first * 100;
      const sign  = ret >= 0 ? '+' : '';
      const cur   = s.currency || 'USD';

      const priceEl = document.getElementById(`scvp-${id}`);
      const retEl   = document.getElementById(`scvr-${id}`);
      if (priceEl) priceEl.textContent = formatPrice(last, cur);
      if (retEl) {
        retEl.textContent = `${sign}${ret.toFixed(2)}%`;
        retEl.className = `scv-ret ${ret > 0 ? 'up' : ret < 0 ? 'down' : 'flat'}`;
      }

      const ctx = document.getElementById(`scv-canvas-${id}`);
      if (!ctx) return;

      stockChartsInstances[s.symbol] = new Chart(ctx, {
        type: 'candlestick',
        data: {
          datasets: [{
            data: data.dates.map((d, i) => ({
              x: new Date(d).getTime(),
              o: data.open[i],
              h: data.high[i],
              l: data.low[i],
              c: data.close[i],
            })),
            color: {
              up:        '#ef5350',
              down:      '#1e88e5',
              unchanged: '#888888',
            },
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: c => {
                  const r = c.raw;
                  return [`시가 ${formatPrice(r.o, cur)}`, `고가 ${formatPrice(r.h, cur)}`, `저가 ${formatPrice(r.l, cur)}`, `종가 ${formatPrice(r.c, cur)}`];
                },
              },
            },
          },
          scales: {
            x: {
              type: 'timeseries',
              grid: { display: false },
              ticks: {
                color: '#7b7f97', font: { size: 9 }, maxTicksLimit: 5,
              },
              time: {
                displayFormats: { minute: 'HH:mm', hour: 'HH:mm', day: 'MM/dd', month: 'yyyy.MM', year: 'yyyy' },
              },
            },
            y: {
              position: 'right',
              grid: { color: '#252836' },
              ticks: {
                color: '#7b7f97', font: { size: 9 }, maxTicksLimit: 4,
                callback: v => formatPrice(v, cur),
              },
            },
          },
        },
      });
    } catch {
      const wrap = document.getElementById(`scv-canvas-${id}`)?.parentElement;
      if (wrap) wrap.innerHTML = '<p style="color:var(--muted);text-align:center;padding:30px;font-size:0.8rem">데이터 없음</p>';
    }
  }));
}

async function loadGraphView(period) {
  const legend = document.getElementById('graphViewLegend');
  if (!stocks.length) {
    legend.innerHTML = '';
    if (graphViewChartInstance) { graphViewChartInstance.destroy(); graphViewChartInstance = null; }
    const wrap = document.querySelector('.gv-chart-wrap');
    if (wrap) wrap.innerHTML = '<canvas id="graphViewCanvas"></canvas><p class="gv-empty">추가된 종목이 없습니다.<br>대시보드에서 종목을 먼저 추가해주세요.</p>';
    return;
  }

  legend.innerHTML = '<span style="color:var(--muted);font-size:0.85rem">로딩 중...</span>';

  const results = await Promise.allSettled(
    stocks.map(async s => {
      const res = await fetch(`/api/chart/${encodeURIComponent(s.symbol)}?period=${period}`);
      if (!res.ok) throw new Error();
      const d = await res.json();
      return { symbol: s.symbol, name: s.name, data: d };
    })
  );

  const valid = results
    .filter(r => r.status === 'fulfilled' && r.value.data.dates?.length)
    .map(r => r.value);

  if (!valid.length) {
    legend.innerHTML = '<span style="color:var(--muted)">데이터를 불러올 수 없습니다.</span>';
    return;
  }

  const datasets = valid.map(({ symbol, data }, i) => {
    const base = data.close[0];
    return {
      label: symbol,
      data: data.dates.map((d, j) => ({
        x: new Date(d).getTime(),
        y: base > 0 ? +(data.close[j] / base * 100).toFixed(2) : null,
      })),
      borderColor: STOCK_CHART_COLORS[i % STOCK_CHART_COLORS.length],
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.2,
      hidden: hiddenGraphStocks.has(symbol),
    };
  });

  const ctx = document.getElementById('graphViewCanvas');
  if (graphViewChartInstance) { graphViewChartInstance.destroy(); graphViewChartInstance = null; }

  graphViewChartInstance = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: c => `${c.dataset.label}: ${c.parsed.y?.toFixed(2)}`,
          },
        },
      },
      scales: {
        x: {
          type: 'timeseries',
          grid: { color: '#252836' },
          ticks: { color: '#7b7f97', maxTicksLimit: 10, font: { size: 10 } },
          time: {
            displayFormats: {
              minute: 'HH:mm',
              hour:   'HH:mm',
              day:    'MM/dd',
              week:   'yy.MM.dd',
              month:  'yyyy.MM',
              year:   'yyyy',
            },
          },
        },
        y: {
          position: 'right',
          grid: { color: '#252836' },
          ticks: {
            color: '#7b7f97',
            font: { size: 10 },
            callback: v => v.toFixed(1),
          },
        },
      },
    },
  });

  _graphValidData = valid;
  _graphReturns.clear();

  const legendItems = valid.map(({ symbol, name, data }, i) => {
    const first = data.close[0];
    const last  = data.close[data.close.length - 1];
    const ret   = first > 0 ? (last - first) / first * 100 : 0;
    const color = STOCK_CHART_COLORS[i % STOCK_CHART_COLORS.length];
    _graphReturns.set(symbol, { ret, name, color });
    return { symbol, name, ret, color, datasetIdx: i };
  }).sort((a, b) => b.ret - a.ret);

  updateInvestResult();

  legend.innerHTML = `
    <div class="gv-legend-ctrl">
      <button id="gvShowAll" class="gv-ctrl-btn">전체 활성화</button>
      <button id="gvHideAll" class="gv-ctrl-btn">전체 비활성화</button>
    </div>` +
    legendItems.map(({ symbol, name, ret, color, datasetIdx }) => {
    const sign    = ret >= 0 ? '+' : '';
    const state   = ret > 0 ? 'up' : ret < 0 ? 'down' : 'flat';
    const isHidden = hiddenGraphStocks.has(symbol);
    return `
      <div class="gv-legend-item${isHidden ? ' gv-item-hidden' : ''}">
        <button class="gv-eye-btn" data-symbol="${symbol}" data-idx="${datasetIdx}" title="숨기기/보이기">${isHidden ? EYE_CLOSED : EYE_OPEN}</button>
        <span class="gv-ld" style="background:${color}"></span>
        <div class="gv-legend-text">
          <span class="gv-ls">${symbol}</span>
          <span class="gv-ln">${name || ''}</span>
        </div>
        <span class="gv-lr ${state}">${sign}${ret.toFixed(2)}%</span>
      </div>`;
  }).join('');
}

const SECTOR_COLORS = {
  XLRE: '#ff8787', XLU: '#74c0fc', XLC: '#cc5de8', XLK: '#4d96ff',
  XLF:  '#ffd93d', XLV: '#6bcb77', XLI: '#ff922b', XLP: '#f06595',
  XLY:  '#20c997', XLB: '#a9e34b', XLE: '#ff6b6b',
};

let sectorChartInstance = null;

async function loadSectorChart(period = '1y') {
  const res = await fetch(`/api/sector-chart?period=${period}`);
  if (!res.ok) return;
  const { dates, series } = await res.json();
  if (!dates.length) return;

  const ctx = document.getElementById('sectorChartCanvas');
  if (!ctx) return;
  if (sectorChartInstance) sectorChartInstance.destroy();

  const datasets = Object.entries(series).map(([sym, values]) => ({
    label: sym,
    data: dates.map((d, i) => ({ x: new Date(d).getTime(), y: values[i] })),
    borderColor: SECTOR_COLORS[sym] || '#888',
    backgroundColor: 'transparent',
    borderWidth: 1.8,
    pointRadius: 0,
    tension: 0.3,
  }));

  // 수익률 패널
  const legend = document.getElementById('sectorChartLegend');
  if (legend) {
    const returns = Object.entries(series)
      .map(([sym, values]) => ({
        sym,
        label: SECTOR_ETFS.find(e => e.sym === sym)?.label || '',
        ret: values[values.length - 1] - 100,
      }))
      .sort((a, b) => b.ret - a.ret);

    legend.innerHTML = returns.map(({ sym, label, ret }) => {
      const sign  = ret >= 0 ? '+' : '';
      const state = ret > 0 ? 'up' : ret < 0 ? 'down' : 'flat';
      return `
        <div class="scl-item">
          <span class="scl-dot" style="background:${SECTOR_COLORS[sym]}"></span>
          <span class="scl-sym">${sym}</span>
          <span class="scl-label">${label}</span>
          <span class="scl-ret ${state}">${sign}${ret.toFixed(1)}%</span>
        </div>`;
    }).join('');
  }

  sectorChartInstance = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}`,
          },
        },
      },
      scales: {
        x: {
          type: 'timeseries',
          grid: { color: '#252836' },
          ticks: { color: '#7b7f97', maxTicksLimit: 10, font: { size: 10 } },
          time: {
            displayFormats: {
              day:   'yy.MM.dd',
              week:  'yy.MM.dd',
              month: 'yyyy.MM',
              year:  'yyyy',
            },
          },
        },
        y: {
          position: 'right',
          grid: { color: '#252836' },
          ticks: {
            color: '#7b7f97',
            font: { size: 10 },
            callback: v => v.toFixed(0),
          },
        },
      },
    },
  });
}

function initSectorChartToggle() {
  const toggle = document.getElementById('sectorChartToggle');
  const body   = document.getElementById('sectorChartBody');
  if (!toggle) return;

  toggle.addEventListener('click', () => {
    const collapsed = body.classList.toggle('hidden');
    toggle.querySelector('.scs-arrow').textContent = collapsed ? '▸' : '▾';
  });

  document.querySelectorAll('.scs-pbtn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll('.scs-pbtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadSectorChart(btn.dataset.p);
    });
  });
}

let macroIndicators = JSON.parse(localStorage.getItem('macroIndicators') || '[]');

function saveMacroIndicators() {
  localStorage.setItem('macroIndicators', JSON.stringify(macroIndicators));
}

function formatMacroValue(symbol, price) {
  if (['^TNX','^FVX','^IRX','^TYX'].includes(symbol)) return price.toFixed(2) + '%';
  if (symbol === 'KRW=X') return '₩' + Math.round(price).toLocaleString('ko-KR');
  if (symbol === 'JPY=X') return price.toFixed(2) + '¥';
  if (price >= 10000) return price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (price >= 100)   return price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return price.toFixed(2);
}

function initMacroSection() {
  renderMacroChips();
  initMacroSearch();
}

function renderMacroChips() {
  const row = document.getElementById('macroRow');
  if (!row) return;
  row.innerHTML = '';
  if (macroIndicators.length === 0) {
    row.innerHTML = '<span class="macro-empty">아직 추가된 지표가 없습니다. 위 검색창에서 추가하세요.</span>';
    return;
  }
  macroIndicators.forEach(({ symbol, name }) => {
    const chip = document.createElement('div');
    chip.className = 'macro-chip';
    chip.id = `mc-${symbol.replace(/[^a-zA-Z0-9]/g, '_')}`;
    chip.innerHTML = `
      <div class="mc-info">
        <span class="mc-name">${name}</span>
        <span class="mc-sym">${symbol}</span>
      </div>
      <div class="mc-vals">
        <span class="mc-val">—</span>
        <span class="mc-change">—</span>
      </div>
      <button class="mc-remove" title="제거">✕</button>
    `;
    chip.querySelector('.mc-remove').addEventListener('click', e => {
      e.stopPropagation();
      macroIndicators = macroIndicators.filter(m => m.symbol !== symbol);
      saveMacroIndicators();
      renderMacroChips();
    });
    chip.addEventListener('click', e => {
      if (e.target.closest('.mc-remove')) return;
      openChart(symbol);
    });

    // 드래그 앤 드롭
    chip.draggable = true;
    chip.addEventListener('dragstart', e => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', symbol);
      setTimeout(() => chip.classList.add('dragging'), 0);
    });
    chip.addEventListener('dragend', () => {
      chip.classList.remove('dragging');
      document.querySelectorAll('.macro-chip').forEach(c => c.classList.remove('drag-over'));
    });
    chip.addEventListener('dragover', e => {
      e.preventDefault();
      document.querySelectorAll('.macro-chip').forEach(c => c.classList.remove('drag-over'));
      if (!chip.classList.contains('dragging')) chip.classList.add('drag-over');
    });
    chip.addEventListener('drop', e => {
      e.preventDefault();
      chip.classList.remove('drag-over');
      const fromSym = e.dataTransfer.getData('text/plain');
      if (fromSym === symbol) return;
      const fromIdx = macroIndicators.findIndex(m => m.symbol === fromSym);
      const toIdx   = macroIndicators.findIndex(m => m.symbol === symbol);
      if (fromIdx === -1 || toIdx === -1) return;
      const [item] = macroIndicators.splice(fromIdx, 1);
      macroIndicators.splice(toIdx, 0, item);
      saveMacroIndicators();
      renderMacroChips();
    });

    row.appendChild(chip);
  });
  fetchMacroBar();
}

async function fetchMacroBar() {
  await Promise.allSettled(macroIndicators.map(async ({ symbol }) => {
    try {
      const data = await fetchPrice(symbol);
      const id = symbol.replace(/[^a-zA-Z0-9]/g, '_');
      const el = document.getElementById(`mc-${id}`);
      if (!el) return;
      const sign  = data.change >= 0 ? '+' : '';
      const state = data.change > 0 ? 'up' : data.change < 0 ? 'down' : 'flat';
      el.querySelector('.mc-val').textContent = formatMacroValue(symbol, data.price);
      const changeEl = el.querySelector('.mc-change');
      changeEl.textContent = `${sign}${data.change_pct.toFixed(2)}%`;
      changeEl.className = `mc-change ${state}`;
    } catch {}
  }));
}

function initMacroSearch() {
  const input    = document.getElementById('macroSearchInput');
  const dropdown = document.getElementById('macroDropdown');
  if (!input) return;
  let debounce;

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = input.value.trim();
    if (!q) { dropdown.classList.add('hidden'); return; }
    debounce = setTimeout(() => doMacroSearch(q), 200);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { dropdown.classList.add('hidden'); input.value = ''; }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.macro-search-wrap')) dropdown.classList.add('hidden');
  });
}

async function doMacroSearch(q) {
  const dropdown = document.getElementById('macroDropdown');
  dropdown.innerHTML = '<div class="dd-msg">검색 중...</div>';
  dropdown.classList.remove('hidden');
  try {
    const res   = await fetch(`/api/macro/search?q=${encodeURIComponent(q)}`);
    const items = await res.json();
    if (!items.length) { dropdown.innerHTML = '<div class="dd-msg">결과 없음</div>'; return; }
    dropdown.innerHTML = items.map(item => `
      <div class="dd-item" data-symbol="${item.symbol}" data-name="${item.name}">
        <span class="dd-symbol">${item.symbol}</span>
        <span class="dd-name">${item.name}</span>
        <span class="dd-exch">${item.category}</span>
      </div>
    `).join('');
    dropdown.querySelectorAll('.dd-item').forEach(el => {
      el.addEventListener('click', () => {
        const symbol = el.dataset.symbol;
        const name   = el.dataset.name;
        if (!macroIndicators.some(m => m.symbol === symbol)) {
          macroIndicators.push({ symbol, name });
          saveMacroIndicators();
          renderMacroChips();
        }
        document.getElementById('macroSearchInput').value = '';
        dropdown.classList.add('hidden');
      });
    });
  } catch {
    dropdown.innerHTML = '<div class="dd-msg" style="color:#ff4655">검색 실패</div>';
  }
}

const INDICES = [
  { sym: '^GSPC', label: 'S&P 500' },
  { sym: '^IXIC', label: '나스닥' },
  { sym: '^DJI',  label: '다우존스' },
  { sym: '^SOX',  label: '필라델피아 반도체' },
];

const SECTOR_ETFS = [
  { sym: 'XLRE', label: '부동산' },
  { sym: 'XLU',  label: '유틸리티' },
  { sym: 'XLC',  label: '커뮤' },
  { sym: 'XLK',  label: '기술' },
  { sym: 'XLF',  label: '금융' },
  { sym: 'XLV',  label: '헬스케어' },
  { sym: 'XLI',  label: '산업재' },
  { sym: 'XLP',  label: '필수소비재' },
  { sym: 'XLY',  label: '자유소비재' },
  { sym: 'XLB',  label: '소재' },
  { sym: 'XLE',  label: '에너지' },
];

// stocks: [{symbol, name, currency}]
let stocks = JSON.parse(localStorage.getItem('stocks') || '[]');
let chartInstance = null;
let currentChartSymbol = null;
let refreshTimer = null;
let countdown = 60;
let usdKrwRate = null;

// ─── Init ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initGraphView();
  initStockChartsView();
  initSectorChartToggle();
  loadSectorChart();
  initIndexBar();
  initSectorBar();
  initMacroSection();
  renderGrid();
  fetchUsdKrw().then(() => {
    fetchIndexBar();
    fetchSectorBar();
    fetchMacroBar();
    if (stocks.length > 0) {
      fetchSectorGroupPerf();
      fetchAllPrices();
    }
  });
  startCountdown();
  initSearch();
  initModal();
});

// ─── Countdown / Auto-refresh ────────────────────────────
function startCountdown() {
  countdown = 60;
  clearInterval(refreshTimer);
  updateTimerLabel();
  refreshTimer = setInterval(() => {
    countdown--;
    updateTimerLabel();
    if (countdown <= 0) {
      countdown = 60;
      fetchAllPrices();
    }
  }, 1000);
}

function updateTimerLabel() {
  document.getElementById('timerLabel').textContent = `${countdown}초 후 갱신`;
}

document.getElementById('refreshBtn').addEventListener('click', () => {
  fetchAllPrices();
  startCountdown();
});

// ─── Fetch prices ────────────────────────────────────────
async function fetchUsdKrw() {
  try {
    const res = await fetch('/api/fx/usdkrw');
    if (res.ok) { const d = await res.json(); usdKrwRate = d.rate; }
  } catch {}
}

function formatIndex(val) {
  return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function initIndexBar() {
  const row = document.getElementById('indexRow');
  row.innerHTML = INDICES.map(({ sym, label }) => `
    <div class="index-chip" id="ic-${sym.replace('^', '')}">
      <span class="idx-name">${label}</span>
      <div class="idx-vals">
        <span class="idx-price">—</span>
        <span class="idx-change">—</span>
      </div>
    </div>
  `).join('');
}

async function fetchIndexBar() {
  await Promise.allSettled(INDICES.map(async ({ sym }) => {
    try {
      const data = await fetchPrice(sym);
      const id = sym.replace('^', '');
      const el = document.getElementById(`ic-${id}`);
      if (!el) return;
      const sign = data.change >= 0 ? '+' : '';
      const state = data.change > 0 ? 'up' : data.change < 0 ? 'down' : 'flat';
      el.querySelector('.idx-price').textContent = formatIndex(data.price);
      const changeEl = el.querySelector('.idx-change');
      changeEl.textContent = `${sign}${data.change_pct.toFixed(2)}%`;
      changeEl.className = `idx-change ${state}`;
    } catch {}
  }));
}

function initSectorBar() {
  const row = document.getElementById('sectorRow');
  row.innerHTML = SECTOR_ETFS.map(({ sym, label }) => `
    <div class="sector-chip" id="sc-${sym}">
      <div class="sc-name">
        <span class="sc-symbol">${sym}</span>
        <span class="sc-label">${label}</span>
      </div>
      <div class="sc-vals">
        <span class="sc-price">—</span>
        <span class="sc-change">—</span>
      </div>
    </div>
  `).join('');
  SECTOR_ETFS.forEach(({ sym }) => {
    document.getElementById(`sc-${sym}`).addEventListener('click', () => openChart(sym));
  });
}

async function fetchSectorBar() {
  const results = await Promise.allSettled(
    SECTOR_ETFS.map(async ({ sym, label }) => {
      const data = await fetchPrice(sym);
      return { sym, label, data };
    })
  );

  const sorted = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value)
    .sort((a, b) => b.data.change_pct - a.data.change_pct);

  const row = document.getElementById('sectorRow');
  row.innerHTML = '';

  sorted.forEach(({ sym, label, data }) => {
    const sign  = data.change >= 0 ? '+' : '';
    const state = data.change > 0 ? 'up' : data.change < 0 ? 'down' : 'flat';
    const chip  = document.createElement('div');
    chip.className = 'sector-chip';
    chip.id = `sc-${sym}`;
    chip.innerHTML = `
      <div class="sc-name">
        <span class="sc-symbol">${sym}</span>
        <span class="sc-label">${label}</span>
      </div>
      <div class="sc-vals">
        <span class="sc-price">${formatPrice(data.price, data.currency)}</span>
        <span class="sc-change ${state}">${sign}${data.change_pct.toFixed(2)}%</span>
      </div>
    `;
    chip.addEventListener('click', () => openChart(sym));
    row.appendChild(chip);
  });
}

async function fetchSectorGroupPerf() {
  const groups = document.querySelectorAll('.sector-group[data-etf]');
  await Promise.allSettled(Array.from(groups).map(async group => {
    const etf = group.dataset.etf;
    try {
      const perf = await fetchPerformance(etf);
      const el = group.querySelector('.sg-perf');
      if (!el) return;
      el.innerHTML = PERF_LABELS.map(({ key, label }) => {
        const val = perf[key];
        if (val == null) return '';
        const sign  = val >= 0 ? '+' : '';
        const state = val > 0 ? 'up' : val < 0 ? 'down' : 'flat';
        return `<span class="sg-perf-item ${state}"><span class="sg-pi-label">${label}</span><span class="sg-pi-val">${sign}${val.toFixed(1)}%</span></span>`;
      }).join('');
    } catch {}
  }));
}

async function fetchAllPrices() {
  fetchIndexBar();
  fetchSectorBar();
  fetchMacroBar();
  fetchSectorGroupPerf();
  await Promise.allSettled(stocks.map(s => fetchAndUpdateCard(s.symbol)));
}

async function fetchAndUpdateCard(symbol) {
  const card = document.getElementById(`card-${symbol}`);
  if (!card) return;
  const idx = stocks.findIndex(s => s.symbol === symbol);
  const sectorSym = idx !== -1 ? stocks[idx].sector_etf : null;

  const [priceRes, valRes, perfRes] = await Promise.allSettled([
    fetchPrice(symbol),
    fetchValuation(symbol),
    fetchPerformance(symbol),
  ]);

  if (priceRes.status === 'fulfilled') {
    const data = priceRes.value;
    if (idx !== -1 && stocks[idx].currency !== data.currency) {
      stocks[idx].currency = data.currency;
      saveStocks();
    }
    renderCardData(card, data);
  } else {
    card.querySelector('.card-price').textContent = '오류';
    card.querySelector('.card-change').textContent = priceRes.reason?.message || '데이터 없음';
    card.querySelector('.card-change').className = 'card-change';
  }

  if (valRes.status === 'fulfilled') {
    const price = priceRes.status === 'fulfilled' ? priceRes.value.price : null;
    const currency = priceRes.status === 'fulfilled' ? priceRes.value.currency : 'USD';
    renderCardPE(card, valRes.value, price, currency);
  }

  if (perfRes.status === 'fulfilled') {
    const sectorPerf = await fetchSectorPerf(sectorSym);
    renderCardPerf(card, perfRes.value, sectorPerf, sectorSym);
  }
}

async function fetchPrice(symbol) {
  const res = await fetch(`/api/price/${encodeURIComponent(symbol)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `${symbol} 오류`);
  }
  return res.json();
}

async function fetchValuation(symbol) {
  const res = await fetch(`/api/valuation/${encodeURIComponent(symbol)}`);
  if (!res.ok) throw new Error('valuation 없음');
  return res.json();
}

async function fetchPerformance(symbol) {
  const res = await fetch(`/api/performance/${encodeURIComponent(symbol)}`);
  if (!res.ok) throw new Error('performance 없음');
  return res.json();
}

const _sectorPerfCache = new Map();
async function fetchSectorPerf(sym) {
  if (!sym) return null;
  if (_sectorPerfCache.has(sym)) return _sectorPerfCache.get(sym);
  try {
    const data = await fetchPerformance(sym);
    _sectorPerfCache.set(sym, data);
    return data;
  } catch { return null; }
}

function calcFairValues(val, price, currency) {
  const out = [];
  if (val.trailing_pe && val.forward_pe && price > 0) {
    const fair = price * (val.trailing_pe / val.forward_pe);
    out.push({ label: 'forward PER 기준 적정가격', value: fair, diff: (fair - price) / price * 100, currency });
  }
  if (val.trailing_pe && val.book_value && price > 0) {
    const eps = price / val.trailing_pe;
    if (eps > 0 && val.book_value > 0) {
      const graham = Math.sqrt(22.5 * eps * val.book_value);
      out.push({ label: 'Graham', value: graham, diff: (graham - price) / price * 100, currency });
    }
  }
  return out;
}

function fairHTML(fairValues, currency, cls = '') {
  return fairValues.map(fv => {
    const sign = fv.diff >= 0 ? '+' : '';
    const state = fv.diff >= 0 ? 'fair-up' : 'fair-down';
    return `<span class="fair-item ${state} ${cls}">${fv.label} ${formatPrice(fv.value, currency)} (${sign}${fv.diff.toFixed(1)}%)</span>`;
  }).join('<span class="fair-sep"> · </span>');
}

function renderCardPE(card, val, price, currency) {
  const el = card.querySelector('.card-pe');
  if (!el) return;
  const t = val.trailing_pe != null ? val.trailing_pe.toFixed(1) : '—';
  const f = val.forward_pe  != null ? val.forward_pe.toFixed(1)  : '—';
  const fairs = price ? calcFairValues(val, price, currency) : [];

  const sectorEl = card.querySelector('.card-sector');
  if (sectorEl && val.sector_etf) {
    const entry = SECTOR_ETFS.find(e => e.sym === val.sector_etf);
    if (entry) sectorEl.innerHTML = `<span class="card-sector-badge">${entry.sym} · ${entry.label}</span>`;
  }

  // 섹터가 처음 확인됐으면 저장 후 그리드 재구성
  const idx = stocks.findIndex(s => s.symbol === val.symbol);
  if (idx !== -1 && stocks[idx].sector_etf !== val.sector_etf) {
    stocks[idx].sector_etf = val.sector_etf;
    saveStocks();
    scheduleSectorRerender();
  }

  el.innerHTML = `PER ${t} · fPER ${f}` +
    (fairs.length ? `<br>${fairHTML(fairs, currency)}` : '');
}

const PERF_LABELS = [
  { key: '5d',  label: '5일' },
  { key: '1mo', label: '1달' },
  { key: '3mo', label: '3달' },
  { key: '6mo', label: '6달' },
  { key: '1y',  label: '1년' },
];

function renderCardPerf(card, stockPerf, sectorPerf, sectorSym) {
  const el = card.querySelector('.card-perf');
  if (!el) return;

  const fmt   = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  const state = v => v == null ? 'flat' : v > 0 ? 'up' : v < 0 ? 'down' : 'flat';

  // 헤더 행
  let html = `<span class="cp-row-label"></span>` +
    PERF_LABELS.map(({ label }) => `<span class="cp-period">${label}</span>`).join('');

  // 종목 수익률 행
  html += `<span class="cp-row-label cp-row-stock">종목</span>` +
    PERF_LABELS.map(({ key }) => {
      const v = stockPerf?.[key];
      return `<span class="cp-val ${state(v)}">${fmt(v)}</span>`;
    }).join('');

  // 섹터 대비 초과수익 행
  if (sectorSym) {
    html += `<span class="cp-row-label cp-row-sector">vs ${sectorSym}</span>` +
      PERF_LABELS.map(({ key }) => {
        const sv   = stockPerf?.[key];
        const ev   = sectorPerf?.[key];
        const diff = (sv != null && ev != null) ? sv - ev : null;
        return `<span class="cp-val ${state(diff)}">${fmt(diff)}</span>`;
      }).join('');
  }

  el.innerHTML = html;
}

function renderCardData(card, data) {
  const isUp = data.change > 0;
  const isFlat = data.change === 0;
  card.className = `card ${isUp ? 'up' : isFlat ? '' : 'down'}`;

  const priceEl = card.querySelector('.card-price');
  const changeEl = card.querySelector('.card-change');

  let priceHTML;
  if (data.currency === 'USD' && usdKrwRate) {
    const krw = '₩' + Math.round(data.price * usdKrwRate).toLocaleString('ko-KR');
    const usd = formatPrice(data.price, data.currency);
    priceHTML = krw + `<span class="card-krw">${usd}</span>`;
  } else {
    priceHTML = formatPrice(data.price, data.currency) + `<span class="card-krw"></span>`;
  }
  priceEl.innerHTML = priceHTML;
  priceEl.className = 'card-price';

  const sign = isUp ? '+' : '';
  changeEl.textContent = `${sign}${formatPrice(data.change, data.currency)}  (${sign}${data.change_pct.toFixed(2)}%)`;
  changeEl.className = `card-change ${isUp ? 'up' : isFlat ? 'flat' : 'down'}`;
}

function formatPrice(val, currency) {
  if (currency === 'KRW') {
    return '₩' + Math.round(val).toLocaleString('ko-KR');
  }
  return '$' + val.toFixed(2);
}

// ─── Grid rendering ──────────────────────────────────────
function renderGrid() {
  const grid  = document.getElementById('grid');
  const empty = document.getElementById('empty');

  grid.innerHTML = '';

  if (stocks.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  // 섹터별 그룹화
  const grouped = new Map(); // sector_etf → stocks[]
  const unclassified = [];
  stocks.forEach(s => {
    if (s.sector_etf) {
      if (!grouped.has(s.sector_etf)) grouped.set(s.sector_etf, []);
      grouped.get(s.sector_etf).push(s);
    } else {
      unclassified.push(s);
    }
  });

  function makeGroup(etfSym, etfLabel, members) {
    const group = document.createElement('div');
    group.className = 'sector-group';
    if (etfSym) group.dataset.etf = etfSym;
    group.innerHTML = `
      <div class="sector-group-header">
        <div class="sg-left">
          <span class="sg-toggle">▾</span>
          ${etfSym ? `<span class="sg-etf">${etfSym}</span>` : ''}
          <span class="sg-label">${etfLabel}</span>
          <span class="sg-count">${members.length}종목</span>
        </div>
        <div class="sg-perf"></div>
      </div>
      <div class="sg-cards"></div>
    `;
    members.forEach(s => group.querySelector('.sg-cards').appendChild(createCard(s)));

    group.querySelector('.sector-group-header').addEventListener('click', () => {
      const collapsed = group.classList.toggle('collapsed');
      group.querySelector('.sg-toggle').textContent = collapsed ? '▸' : '▾';
    });

    return group;
  }

  SECTOR_ETFS.forEach(({ sym, label }) => {
    const members = grouped.get(sym);
    if (members?.length) grid.appendChild(makeGroup(sym, label, members));
  });

  if (unclassified.length) {
    grid.appendChild(makeGroup('', '미분류', unclassified));
  }
}

function createCard({ symbol, name }) {
  const card = document.createElement('div');
  card.className = 'card';
  card.id = `card-${symbol}`;
  card.innerHTML = `
    <div class="card-top">
      <div>
        <div class="card-name">${name || ''}</div>
        <div class="card-symbol">${symbol}</div>
        <div class="card-sector"></div>
      </div>
      <button class="card-remove" title="제거">✕</button>
    </div>
    <div class="card-price card-loading">로딩 중...</div>
    <div class="card-change">—</div>
    <div class="card-perf"></div>
    <div class="card-pe"></div>
  `;
  card.querySelector('.card-remove').addEventListener('click', e => {
    e.stopPropagation();
    removeStock(symbol);
  });
  card.addEventListener('click', () => openChart(symbol));

  // 드래그 앤 드롭
  card.draggable = true;

  card.addEventListener('dragstart', e => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', symbol);
    setTimeout(() => card.classList.add('card-dragging'), 0);
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('card-dragging');
    document.querySelectorAll('.card.card-drag-over').forEach(c => c.classList.remove('card-drag-over'));
  });

  card.addEventListener('dragover', e => {
    e.preventDefault();
    const dragging = document.querySelector('.card.card-dragging');
    if (!dragging || dragging === card) return;
    if (dragging.parentElement !== card.parentElement) return;
    document.querySelectorAll('.card.card-drag-over').forEach(c => c.classList.remove('card-drag-over'));
    card.classList.add('card-drag-over');
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('card-drag-over');
  });

  card.addEventListener('drop', e => {
    e.preventDefault();
    card.classList.remove('card-drag-over');
    const fromSym = e.dataTransfer.getData('text/plain');
    if (fromSym === symbol) return;
    const fromCard = document.getElementById(`card-${fromSym}`);
    if (!fromCard || fromCard.parentElement !== card.parentElement) return;

    card.parentElement.insertBefore(fromCard, card);

    const fromIdx = stocks.findIndex(s => s.symbol === fromSym);
    const [item] = stocks.splice(fromIdx, 1);
    const newToIdx = stocks.findIndex(s => s.symbol === symbol);
    stocks.splice(newToIdx, 0, item);
    saveStocks();
  });

  return card;
}

function saveStocks() {
  localStorage.setItem('stocks', JSON.stringify(stocks));
}

let _sectorRerenderTimer = null;
function scheduleSectorRerender() {
  clearTimeout(_sectorRerenderTimer);
  _sectorRerenderTimer = setTimeout(() => {
    renderGrid();
    fetchSectorGroupPerf();
    fetchAllPrices();
  }, 150);
}

function addStock(symbol, name) {
  if (stocks.some(s => s.symbol === symbol)) return;
  stocks.push({ symbol, name, currency: 'USD', sector_etf: null });
  saveStocks();
  renderGrid();
  fetchAndUpdateCard(symbol);
}

function removeStock(symbol) {
  stocks = stocks.filter(s => s.symbol !== symbol);
  saveStocks();
  renderGrid();
}

// ─── Search ──────────────────────────────────────────────
function initSearch() {
  const input = document.getElementById('searchInput');
  const dropdown = document.getElementById('searchDropdown');
  let debounce;

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = input.value.trim();
    if (!q) { dropdown.classList.add('hidden'); return; }
    debounce = setTimeout(() => doSearch(q), 300);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { dropdown.classList.add('hidden'); input.value = ''; }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) dropdown.classList.add('hidden');
  });
}

async function doSearch(q) {
  const dropdown = document.getElementById('searchDropdown');
  dropdown.innerHTML = '<div class="dd-msg">검색 중...</div>';
  dropdown.classList.remove('hidden');

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const items = await res.json();

    if (!items.length) {
      dropdown.innerHTML = '<div class="dd-msg">결과 없음</div>';
      return;
    }

    dropdown.innerHTML = items.slice(0, 8).map(item => `
      <div class="dd-item" data-symbol="${item.symbol}" data-name="${item.name || ''}">
        <span class="dd-symbol">${item.symbol}</span>
        <span class="dd-name">${item.name || ''}</span>
        <span class="dd-exch">${item.exchange || ''}</span>
      </div>
    `).join('');

    dropdown.querySelectorAll('.dd-item').forEach(el => {
      el.addEventListener('click', () => {
        addStock(el.dataset.symbol, el.dataset.name);
        document.getElementById('searchInput').value = '';
        dropdown.classList.add('hidden');
      });
    });
  } catch {
    dropdown.innerHTML = '<div class="dd-msg" style="color:#ff4655">검색 실패</div>';
  }
}

// ─── Chart Modal ─────────────────────────────────────────
function initModal() {
  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.getElementById('overlay').addEventListener('click', closeModal);

  document.querySelectorAll('.pbtn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pbtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (currentChartSymbol) loadChart(currentChartSymbol, btn.dataset.p);
    });
  });
}

async function openChart(symbol) {
  currentChartSymbol = symbol;
  const stock = stocks.find(s => s.symbol === symbol) || { symbol, name: '', currency: 'USD' };

  document.getElementById('modalSymbol').textContent = symbol;
  document.getElementById('modalName').textContent = stock.name || '';
  document.getElementById('modalPE').textContent = '';

  document.querySelectorAll('.pbtn').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-p="1mo"]').classList.add('active');

  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('overlay').classList.remove('hidden');

  await Promise.all([
    loadChart(symbol, '1mo'),
    Promise.all([fetchValuation(symbol), fetchPrice(symbol)]).then(([val, priceData]) => {
      const t = val.trailing_pe != null ? val.trailing_pe.toFixed(2) : '—';
      const f = val.forward_pe  != null ? val.forward_pe.toFixed(2)  : '—';
      const fairs = calcFairValues(val, priceData.price, priceData.currency);
      document.getElementById('modalPE').innerHTML =
        `<span class="mpe-item">PER <strong>${t}</strong></span>` +
        `<span class="mpe-sep"> · </span>` +
        `<span class="mpe-item">Forward PER <strong>${f}</strong></span>` +
        (fairs.length ? `<span class="mpe-sep"> &nbsp;|&nbsp; </span>${fairHTML(fairs, priceData.currency, 'mpe-fair')}` : '');
    }).catch(() => {
      document.getElementById('modalPE').textContent = 'PER 데이터 없음';
    }),
  ]);
}

const PERIOD_LABEL = { '5d': '5일', '1mo': '1개월', '3mo': '3개월', '1y': '1년' };

async function loadChart(symbol, period) {
  const stock = stocks.find(s => s.symbol === symbol) || { currency: 'USD' };
  const statsEl = document.getElementById('modalStats');
  statsEl.innerHTML = '<span class="stats-from" style="color:var(--muted)">로딩 중...</span>';

  try {
    const res = await fetch(`/api/chart/${encodeURIComponent(symbol)}?period=${period}`);
    if (!res.ok) throw new Error('데이터 없음');
    const data = await res.json();

    // 기간 수익 계산
    const firstPrice = data.open[0];
    const lastPrice = data.close.at(-1);
    const change = lastPrice - firstPrice;
    const changePct = (change / firstPrice) * 100;
    const isUp = change > 0;
    const isFlat = change === 0;
    const sign = isUp ? '+' : '';
    const cur = stock.currency;
    const stateClass = isUp ? 'up' : isFlat ? 'flat' : 'down';

    statsEl.innerHTML = `
      <span class="stats-period">${PERIOD_LABEL[period] || period}</span>
      <span class="stats-from">${formatPrice(firstPrice, cur)}</span>
      <span class="stats-arrow">→</span>
      <span class="stats-to">${formatPrice(lastPrice, cur)}</span>
      <span class="stats-change ${stateClass}">${sign}${formatPrice(change, cur)}&nbsp;(${sign}${changePct.toFixed(2)}%)</span>
    `;

    const ctx = document.getElementById('chartCanvas');
    if (chartInstance) chartInstance.destroy();

    const chartData = data.dates.map((date, i) => ({
      x: new Date(date).getTime(),
      o: data.open[i],
      h: data.high[i],
      l: data.low[i],
      c: data.close[i],
    }));

    chartInstance = new Chart(ctx, {
      type: 'candlestick',
      data: {
        datasets: [{
          label: symbol,
          data: chartData,
          color: {
            up: '#ef5350',       // 빨간 양봉 (상승)
            down: '#1e88e5',     // 파란 음봉 (하락)
            unchanged: '#888888',
          },
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const r = ctx.raw;
                const cur = stock.currency;
                return [
                  `시가: ${formatPrice(r.o, cur)}`,
                  `고가: ${formatPrice(r.h, cur)}`,
                  `저가: ${formatPrice(r.l, cur)}`,
                  `종가: ${formatPrice(r.c, cur)}`,
                ];
              },
            },
          },
        },
        scales: {
          x: {
            type: 'timeseries',
            grid: { color: '#252836' },
            ticks: { color: '#7b7f97', maxTicksLimit: 8, font: { size: 11 } },
          },
          y: {
            position: 'right',
            grid: { color: '#252836' },
            ticks: {
              color: '#7b7f97',
              font: { size: 11 },
              callback: val => formatPrice(val, stock.currency),
            },
          },
        },
      },
    });
  } catch (e) {
    console.error('차트 로드 실패:', e);
  }
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('overlay').classList.add('hidden');
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  currentChartSymbol = null;
}

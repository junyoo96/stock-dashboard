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
  document.getElementById('macroAnalysisView').classList.add('hidden');
  document.getElementById('mindmapView').classList.add('hidden');
  document.getElementById('graphViewBtn').classList.remove('active');
  document.getElementById('stockChartsViewBtn').classList.remove('active');
  document.getElementById('macroAnalysisBtn').classList.remove('active');
  document.getElementById('mindmapBtn').classList.remove('active');
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

let macroIndicators = [];

function saveMacroIndicators() {
  const json = JSON.stringify(macroIndicators);
  localStorage.setItem('macroIndicators', json);
  fetch('/api/db/settings/macroIndicators', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: json }),
  }).catch(() => {});
}

async function loadMacroIndicatorsFromDB() {
  try {
    const res = await fetch('/api/db/settings/macroIndicators');
    if (res.ok) {
      const data = await res.json();
      const parsed = JSON.parse(data.value);
      if (Array.isArray(parsed) && parsed.length > 0) {
        macroIndicators = parsed;
        return;
      }
    }
  } catch {}
  try {
    const local = localStorage.getItem('macroIndicators');
    if (local) macroIndicators = JSON.parse(local);
  } catch {}
}

function formatMacroValue(symbol, price) {
  if (['^TNX','^FVX','^IRX','^TYX'].includes(symbol)) return price.toFixed(2) + '%';
  if (symbol === 'KRW=X') return '₩' + Math.round(price).toLocaleString('ko-KR');
  if (symbol === 'JPY=X') return price.toFixed(2) + '¥';
  if (price >= 10000) return price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (price >= 100)   return price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return price.toFixed(2);
}

// ─── 터치 드래그 헬퍼 ─────────────────────────────────────────
function addTouchDrag(container, itemSel, handleSel, onDrop) {
  let dragEl = null, clone = null, offX = 0, offY = 0;
  let pendingEl = null, pendingX = 0, pendingY = 0, pendingOffX = 0, pendingOffY = 0;
  const THRESHOLD = 10;

  container.addEventListener('touchstart', e => {
    const touch = e.touches[0];
    const startEl = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!startEl) return;
    if (handleSel && !startEl.closest(handleSel)) return;
    const item = startEl.closest(itemSel);
    if (!item || !container.contains(item)) return;
    const rect = item.getBoundingClientRect();
    pendingEl = item;
    pendingX = touch.clientX; pendingY = touch.clientY;
    pendingOffX = touch.clientX - rect.left;
    pendingOffY = touch.clientY - rect.top;
  }, { passive: true });

  container.addEventListener('touchmove', e => {
    const touch = e.touches[0];
    if (pendingEl && !dragEl) {
      if (Math.abs(touch.clientX - pendingX) < THRESHOLD &&
          Math.abs(touch.clientY - pendingY) < THRESHOLD) return;
      dragEl = pendingEl; pendingEl = null;
      offX = pendingOffX; offY = pendingOffY;
      const rect = dragEl.getBoundingClientRect();
      clone = dragEl.cloneNode(true);
      clone.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;` +
        `width:${rect.width}px;height:${rect.height}px;opacity:0.85;pointer-events:none;` +
        `z-index:9999;transform:scale(1.03);box-shadow:0 8px 24px rgba(0,0,0,0.45);`;
      document.body.appendChild(clone);
      dragEl.style.opacity = '0.3';
    }
    if (!dragEl || !clone) return;
    clone.style.left = `${touch.clientX - offX}px`;
    clone.style.top  = `${touch.clientY - offY}px`;
    clone.style.visibility = 'hidden';
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    clone.style.visibility = '';
    const target = el ? el.closest(itemSel) : null;
    container.querySelectorAll(itemSel).forEach(c => c.classList.remove('td-over'));
    if (target && target !== dragEl && container.contains(target)) target.classList.add('td-over');
    e.preventDefault();
  }, { passive: false });

  const cleanup = e => {
    pendingEl = null;
    if (!dragEl) return;
    const touch = (e.changedTouches || e.touches)[0];
    if (clone) clone.style.visibility = 'hidden';
    const el = touch ? document.elementFromPoint(touch.clientX, touch.clientY) : null;
    if (clone) { clone.remove(); clone = null; }
    dragEl.style.opacity = '';
    container.querySelectorAll(itemSel).forEach(c => c.classList.remove('td-over'));
    const target = el ? el.closest(itemSel) : null;
    const dropped = dragEl;
    dragEl = null;
    if (touch && target && target !== dropped && container.contains(target)) {
      onDrop(dropped, target, touch.clientY);
    }
  };
  container.addEventListener('touchend',    cleanup, { passive: true });
  container.addEventListener('touchcancel', cleanup, { passive: true });
}

function initMacroSection() {
  renderMacroChips();
  initMacroSearch();

  // 접기/펼치기
  const toggle = document.getElementById('macroSectionToggle');
  const row    = document.getElementById('macroRow');
  const arrow  = toggle?.querySelector('.macro-arrow');
  let collapsed = localStorage.getItem('macroSectionCollapsed') === '1';
  const applyCollapse = () => {
    row.classList.toggle('hidden', collapsed);
    if (arrow) arrow.textContent = collapsed ? '▸' : '▾';
  };
  applyCollapse();
  toggle?.addEventListener('click', e => {
    if (e.target.closest('#macroCatManagerBtn') || e.target.closest('.macro-search-wrap')) return;
    collapsed = !collapsed;
    localStorage.setItem('macroSectionCollapsed', collapsed ? '1' : '0');
    applyCollapse();
  });

  document.getElementById('macroCatManagerBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    showCategoryManager();
  });
  if (row) addTouchDrag(row, '.macro-chip', null, (dragged, target) => {
    const fromSym = dragged.dataset.sym;
    const toSym   = target.dataset.sym;
    if (!fromSym || !toSym || fromSym === toSym) return;
    const fi = macroIndicators.findIndex(m => m.symbol === fromSym);
    const ti = macroIndicators.findIndex(m => m.symbol === toSym);
    if (fi === -1 || ti === -1) return;
    macroIndicators[fi].category = macroIndicators[ti].category;
    macroIndicators.splice(ti, 0, macroIndicators.splice(fi, 1)[0]);
    saveMacroIndicators();
    renderMacroChips();
  });
}

function getMacroCategories() {
  return [...new Set(macroIndicators.map(m => m.category || '').filter(Boolean))];
}

function renderMacroChips() {
  const row = document.getElementById('macroRow');
  if (!row) return;
  row.innerHTML = '';
  if (macroIndicators.length === 0) {
    row.innerHTML = '<span class="macro-empty">아직 추가된 지표가 없습니다. 위 검색창에서 추가하세요.</span>';
    return;
  }

  // 카테고리별 그룹화 (순서 유지)
  const groups = new Map();
  macroIndicators.forEach(m => {
    const cat = m.category || '미분류';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(m);
  });

  groups.forEach((items, category) => {
    const group = document.createElement('div');
    group.className = 'mc-cat-group';
    group.dataset.cat = category;
    group.innerHTML = `<div class="mc-cat-group-hd">${category}</div>`;
    row.appendChild(group);

    items.forEach(({ symbol, name }) => {
      const chip = document.createElement('div');
      chip.className = 'macro-chip';
      chip.id = `mc-${symbol.replace(/[^a-zA-Z0-9]/g, '_')}`;
      chip.dataset.sym = symbol;
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
        macroIndicators[fromIdx].category = macroIndicators[toIdx].category;
        const [item] = macroIndicators.splice(fromIdx, 1);
        macroIndicators.splice(toIdx, 0, item);
        saveMacroIndicators();
        renderMacroChips();
      });

      group.appendChild(chip);
    });
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
      el.addEventListener('click', e => {
        e.stopPropagation();
        const symbol = el.dataset.symbol;
        const name   = el.dataset.name;
        if (macroIndicators.some(m => m.symbol === symbol)) {
          document.getElementById('macroSearchInput').value = '';
          dropdown.classList.add('hidden');
          return;
        }
        showMacroCategoryPicker(dropdown, symbol, name);
      });
    });
  } catch {
    dropdown.innerHTML = '<div class="dd-msg" style="color:#ff4655">검색 실패</div>';
  }
}

function showMacroCategoryPicker(dropdown, symbol, name) {
  const input = document.getElementById('macroSearchInput');
  const cats  = getMacroCategories();
  dropdown.innerHTML = `
    <div class="mc-cat-picker">
      <div class="mc-cat-picker-title"><strong>${name}</strong> 추가할 항목 선택</div>
      <div class="mc-cat-existing">
        ${cats.map(c => `<button class="mc-cat-btn" data-cat="${c}">${c}</button>`).join('')}
        <button class="mc-cat-btn mc-cat-none" data-cat="">미분류</button>
      </div>
      <div class="mc-cat-new-row">
        <input id="mcNewCatInput" type="text" placeholder="새 항목 이름 입력..." autocomplete="off" />
        <button id="mcNewCatConfirm">추가</button>
      </div>
    </div>
  `;
  dropdown.classList.remove('hidden');
  dropdown.querySelector('.mc-cat-picker').addEventListener('click', e => e.stopPropagation());

  const addWith = cat => {
    macroIndicators.push({ symbol, name, category: cat });
    saveMacroIndicators();
    renderMacroChips();
    input.value = '';
    dropdown.classList.add('hidden');
  };

  dropdown.querySelectorAll('.mc-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => addWith(btn.dataset.cat));
  });

  const newInput = document.getElementById('mcNewCatInput');
  const confirm  = document.getElementById('mcNewCatConfirm');
  confirm.addEventListener('click', () => {
    const v = newInput.value.trim();
    if (v) addWith(v);
  });
  newInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const v = newInput.value.trim(); if (v) addWith(v); }
    if (e.key === 'Escape') { input.value = ''; dropdown.classList.add('hidden'); }
  });
  setTimeout(() => newInput.focus(), 50);
}

function showCategoryManager() {
  const existing = document.getElementById('mcMgrPanel');
  if (existing) { existing.remove(); return; }

  const panel = document.createElement('div');
  panel.id = 'mcMgrPanel';
  panel.className = 'mc-mgr-panel';

  const rebuild = () => {
    const cats = getMacroCategories();
    // 분류별 그룹 (미분류 포함)
    const groups = new Map();
    groups.set('', macroIndicators.filter(m => !m.category));
    cats.forEach(c => groups.set(c, macroIndicators.filter(m => m.category === c)));

    const lanesHtml = [...groups.entries()].map(([cat, items]) => `
      <div class="mc-lane">
        <span class="mc-lane-label">${cat || '미분류'}</span>
        <div class="mc-lane-chips">
          ${items.map(m => `
            <button class="mc-lane-chip" data-sym="${m.symbol}">${m.name}</button>
          `).join('')}
          ${items.length === 0 ? '<span class="mc-lane-empty">비어 있음</span>' : ''}
        </div>
      </div>
    `).join('');

    panel.innerHTML = `
      <div class="mc-mgr-head">
        <span class="mc-mgr-title">분류 관리</span>
        <button class="mc-mgr-close" id="mcMgrClose">✕</button>
      </div>
      <div class="mc-mgr-new">
        <input id="mcMgrNewInput" type="text" placeholder="새 분류 이름..." autocomplete="off" />
        <button id="mcMgrNewAdd">추가</button>
      </div>
      <div class="mc-mgr-lanes">
        ${macroIndicators.length === 0
          ? '<div class="mc-mgr-empty">추가된 지표가 없습니다.</div>'
          : lanesHtml}
      </div>
    `;

    panel.querySelector('#mcMgrClose').addEventListener('click', () => panel.remove());

    // 칩 클릭 → 분류 변경 팝오버
    panel.querySelectorAll('.mc-lane-chip').forEach(chip => {
      chip.addEventListener('click', e => {
        e.stopPropagation();
        panel.querySelectorAll('.mc-chip-picker').forEach(p => p.remove());
        const sym  = chip.dataset.sym;
        const cur  = macroIndicators.find(m => m.symbol === sym)?.category || '';
        const allCats = getMacroCategories();
        const picker = document.createElement('div');
        picker.className = 'mc-chip-picker';
        picker.innerHTML = [
          ...allCats.map(c => `<button class="mc-cat-btn${cur === c ? ' mc-cat-active' : ''}" data-cat="${c}">${c}</button>`),
          `<button class="mc-cat-btn mc-cat-none${!cur ? ' mc-cat-active' : ''}" data-cat="">미분류</button>`,
        ].join('');
        chip.appendChild(picker);
        picker.querySelectorAll('.mc-cat-btn').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation();
            const idx = macroIndicators.findIndex(m => m.symbol === sym);
            if (idx !== -1) macroIndicators[idx].category = btn.dataset.cat;
            saveMacroIndicators();
            renderMacroChips();
            rebuild();
          });
        });
      });
    });

    // 새 분류 추가
    const doAdd = () => {
      const v = panel.querySelector('#mcMgrNewInput').value.trim();
      if (!v || getMacroCategories().includes(v)) return;
      // 빈 분류 레인 삽입 후 rebuild
      // (분류는 실제 지표가 있어야 저장되므로 임시 표시만)
      const lanes = panel.querySelector('.mc-mgr-lanes');
      const lane = document.createElement('div');
      lane.className = 'mc-lane';
      lane.innerHTML = `
        <span class="mc-lane-label">${v}</span>
        <div class="mc-lane-chips"><span class="mc-lane-empty">비어 있음</span></div>
      `;
      lanes.appendChild(lane);
      panel.querySelector('#mcMgrNewInput').value = '';
    };
    panel.querySelector('#mcMgrNewAdd').addEventListener('click', doAdd);
    panel.querySelector('#mcMgrNewInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') doAdd();
      e.stopPropagation();
    });
  };

  rebuild();
  document.body.appendChild(panel);

  const btn  = document.getElementById('macroCatManagerBtn');
  const rect = btn.getBoundingClientRect();
  const W    = 380;
  const left = Math.min(rect.left, window.innerWidth - W - 8);
  panel.style.cssText = `position:fixed;top:${rect.bottom + 4}px;left:${Math.max(8, left)}px;z-index:9999;width:${W}px;`;

  setTimeout(() => {
    document.addEventListener('click', function closeMgr(e) {
      if (!panel.contains(e.target) && e.target.id !== 'macroCatManagerBtn') {
        panel.remove();
        document.removeEventListener('click', closeMgr);
      }
    });
  }, 0);
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
document.addEventListener('DOMContentLoaded', async () => {
  // DB에서 저장된 데이터 먼저 로드
  await loadStocksFromDB();
  await loadIndexOrderFromDB();
  await loadMacroIndicatorsFromDB();

  initGraphView();
  initStockChartsView();
  initMacroAnalysisView();
  await initMindmap();
  initSectorChartToggle();
  loadSectorChart();
  initIndexBar();
  initSectorBar();
  initMacroSection();
  renderGrid();
  addTouchDrag(document.getElementById('grid'), '.card', null, (dragged, target) => {
    if (dragged.parentElement !== target.parentElement) return;
    const fromSym = dragged.id.slice(5);
    const toSym   = target.id.slice(5);
    target.parentElement.insertBefore(dragged, target);
    const fi = stocks.findIndex(s => s.symbol === fromSym);
    if (fi === -1) return;
    const [item] = stocks.splice(fi, 1);
    const ti = stocks.findIndex(s => s.symbol === toSym);
    stocks.splice(ti, 0, item);
    saveStocks();
  });
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
  toggleMacroAnalysisView();
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

function loadIndexOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem('indexBarOrder') || '[]');
    if (saved.length) {
      const ordered = saved.map(sym => INDICES.find(i => i.sym === sym)).filter(Boolean);
      const rest    = INDICES.filter(i => !saved.includes(i.sym));
      return [...ordered, ...rest];
    }
  } catch {}
  return [...INDICES];
}

async function loadIndexOrderFromDB() {
  try {
    const res = await fetch('/api/db/settings/indexBarOrder');
    if (!res.ok) return;
    const { value } = await res.json();
    const saved = JSON.parse(value);
    if (saved.length) {
      const ordered = saved.map(sym => INDICES.find(i => i.sym === sym)).filter(Boolean);
      const rest    = INDICES.filter(i => !saved.includes(i.sym));
      _indexOrder = [...ordered, ...rest];
      renderIndexChips();
    }
  } catch {}
}

let _indexOrder = loadIndexOrder();

function renderIndexChips() {
  const row = document.getElementById('indexRow');
  row.innerHTML = _indexOrder.map(({ sym, label }) => `
    <div class="index-chip" id="ic-${sym.replace('^', '')}" data-sym="${sym}" draggable="true">
      <span class="idx-name">${label}</span>
      <div class="idx-vals">
        <span class="idx-price">—</span>
        <span class="idx-change">—</span>
      </div>
    </div>
  `).join('');
}

function initIndexBar() {
  renderIndexChips();

  const row = document.getElementById('indexRow');
  let dragSrc = null;

  row.addEventListener('dragstart', e => {
    dragSrc = e.target.closest('.index-chip');
    if (!dragSrc) return;
    dragSrc.classList.add('ic-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  row.addEventListener('dragover', e => {
    e.preventDefault();
    const target = e.target.closest('.index-chip');
    if (!target || target === dragSrc) return;
    row.querySelectorAll('.index-chip').forEach(c => c.classList.remove('ic-drag-over'));
    target.classList.add('ic-drag-over');
  });

  row.addEventListener('dragleave', e => {
    const target = e.target.closest('.index-chip');
    if (target) target.classList.remove('ic-drag-over');
  });

  row.addEventListener('drop', e => {
    e.preventDefault();
    const target = e.target.closest('.index-chip');
    if (!target || target === dragSrc) return;
    const srcSym = dragSrc.dataset.sym;
    const tgtSym = target.dataset.sym;
    const si = _indexOrder.findIndex(i => i.sym === srcSym);
    const ti = _indexOrder.findIndex(i => i.sym === tgtSym);
    _indexOrder.splice(ti, 0, _indexOrder.splice(si, 1)[0]);
    const orderJson = JSON.stringify(_indexOrder.map(i => i.sym));
    localStorage.setItem('indexBarOrder', orderJson);
    fetch('/api/db/settings/indexBarOrder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: orderJson }),
    }).catch(() => {});
    renderIndexChips();
    fetchIndexBar();
  });

  row.addEventListener('dragend', () => {
    row.querySelectorAll('.index-chip').forEach(c => c.classList.remove('ic-dragging', 'ic-drag-over'));
  });

  addTouchDrag(row, '.index-chip', null, (dragged, target) => {
    const srcSym = dragged.dataset.sym;
    const tgtSym = target.dataset.sym;
    const si = _indexOrder.findIndex(i => i.sym === srcSym);
    const ti = _indexOrder.findIndex(i => i.sym === tgtSym);
    if (si === -1 || ti === -1) return;
    _indexOrder.splice(ti, 0, _indexOrder.splice(si, 1)[0]);
    const orderJson = JSON.stringify(_indexOrder.map(i => i.sym));
    localStorage.setItem('indexBarOrder', orderJson);
    fetch('/api/db/settings/indexBarOrder', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: orderJson }),
    }).catch(() => {});
    renderIndexChips();
    fetchIndexBar();
  });
}

async function fetchIndexBar() {
  await Promise.allSettled(_indexOrder.map(async ({ sym }) => {
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
  fetch('/api/db/stocks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stocks }),
  }).catch(() => {});
}

async function loadStocksFromDB() {
  try {
    const res = await fetch('/api/db/stocks');
    if (!res.ok) return;
    const data = await res.json();
    if (data.length > 0) stocks = data;
  } catch {}
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

// ─── 거시경제 분석 ────────────────────────────────────────────
const HEATMAP_PERIODS = ['1W', '1M', '3M', '6M', '1Y'];
const HEATMAP_PERIOD_LABELS = { '1W': '1주', '1M': '1개월', '3M': '3개월', '6M': '6개월', '1Y': '1년' };
const SECTOR_LABELS = {
  'XLK': '기술', 'XLV': '헬스케어', 'XLF': '금융', 'XLC': '통신',
  'XLY': '경기소비재', 'XLP': '필수소비재', 'XLI': '산업재', 'XLB': '소재',
  'XLE': '에너지', 'XLU': '유틸리티', 'XLRE': '부동산',
};

let heatmapSortKey = null;
let heatmapSortAsc = false;
let _heatmapData = null;

function heatColor(ret) {
  if (ret === null || ret === undefined) return 'rgba(255,255,255,0.04)';
  const abs = Math.min(Math.abs(ret), 20);
  const alpha = 0.15 + (abs / 20) * 0.7;
  return ret > 0
    ? `rgba(0, 209, 122, ${alpha})`
    : `rgba(255, 70, 85, ${alpha})`;
}

function initMacroAnalysisView() {
  document.getElementById('macroAnalysisBtn').addEventListener('click', toggleMacroAnalysisView);
  document.getElementById('macroAnalysisBackBtn').addEventListener('click', hideAllViews);

  // 저장된 섹션 순서 복원 (DB 우선, fallback: localStorage)
  const view = document.getElementById('macroAnalysisView');
  async function restoreMavOrder() {
    let saved = [];
    try {
      const res = await fetch('/api/db/settings/mavSectionOrder');
      if (res.ok) saved = JSON.parse((await res.json()).value);
    } catch {}
    if (!saved.length) {
      try { saved = JSON.parse(localStorage.getItem('mavSectionOrder') || '[]'); } catch {}
    }
    saved.forEach(key => {
      const sec = view.querySelector(`.mav-section[data-section="${key}"]`);
      if (sec) view.appendChild(sec);
    });
  }
  restoreMavOrder();

  // 섹션 드래그 앤 드롭
  let dragSrc = null;

  view.addEventListener('mousedown', e => {
    const header = e.target.closest('.mav-sec-header');
    if (!header) return;
    const section = header.closest('.mav-section[data-section]');
    if (section) section.setAttribute('draggable', 'true');
  });

  view.addEventListener('mouseup', () => {
    view.querySelectorAll('.mav-section[draggable]').forEach(s => s.removeAttribute('draggable'));
  });

  view.addEventListener('dragstart', e => {
    dragSrc = e.target.closest('.mav-section[data-section]');
    if (!dragSrc) return;
    dragSrc.classList.add('mav-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  view.addEventListener('dragover', e => {
    e.preventDefault();
    const target = e.target.closest('.mav-section[data-section]');
    view.querySelectorAll('.mav-section').forEach(s => s.classList.remove('mav-drag-over'));
    if (target && target !== dragSrc) target.classList.add('mav-drag-over');
  });

  view.addEventListener('drop', e => {
    e.preventDefault();
    const target = e.target.closest('.mav-section[data-section]');
    if (!target || target === dragSrc) return;
    const rect = target.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) target.before(dragSrc);
    else target.after(dragSrc);
    const order = [...view.querySelectorAll('.mav-section[data-section]')].map(s => s.dataset.section);
    const orderJson = JSON.stringify(order);
    localStorage.setItem('mavSectionOrder', orderJson);
    fetch('/api/db/settings/mavSectionOrder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: orderJson }),
    }).catch(() => {});
    view.querySelectorAll('.mav-section').forEach(s => s.classList.remove('mav-drag-over'));
  });

  view.addEventListener('dragend', () => {
    if (dragSrc) dragSrc.classList.remove('mav-dragging');
    view.querySelectorAll('.mav-section').forEach(s => {
      s.classList.remove('mav-drag-over');
      s.removeAttribute('draggable');
    });
    dragSrc = null;
  });

  addTouchDrag(view, '.mav-section[data-section]', '.mav-sec-header', (dragged, target, touchY) => {
    const rect = target.getBoundingClientRect();
    if (touchY < rect.top + rect.height / 2) target.before(dragged);
    else target.after(dragged);
    const order = [...view.querySelectorAll('.mav-section[data-section]')].map(s => s.dataset.section);
    const orderJson = JSON.stringify(order);
    localStorage.setItem('mavSectionOrder', orderJson);
    fetch('/api/db/settings/mavSectionOrder', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: orderJson }),
    }).catch(() => {});
  });
}

function toggleMacroAnalysisView() {
  const showing = !document.getElementById('macroAnalysisView').classList.contains('hidden');
  hideAllViews();
  if (!showing) {
    document.querySelector('main').classList.add('hidden');
    document.getElementById('macroAnalysisView').classList.remove('hidden');
    document.getElementById('macroAnalysisBtn').classList.add('active');
    loadYieldCurve();
    loadSectorHeatmap();
    loadVixChart();
    loadIsmPmiChart();
    loadLeiChart();
    loadTgaChart();
  }
}

const YC_YIELD_SERIES = [
  { key: '2Y',  label: '2년',  color: '#69db7c' },
  { key: '3Y',  label: '3년',  color: '#4f7eff' },
  { key: '5Y',  label: '5년',  color: '#ffd93d' },
  { key: '10Y', label: '10년', color: '#ff6b6b' },
];
const YC_PERIOD_LABELS = { '1m': '1개월', '3m': '3개월', '6m': '6개월', '1y': '1년', '3y': '3년', '5y': '5년' };

let yieldCurveYieldChart  = null;
let yieldCurveSpreadChart = null;
let yieldCurvePeriod      = '5y';
let yieldCurveHidden      = new Set(['3Y', '5Y']);
let _yieldData            = {};
let _ycSyncTime           = null;

const ycSyncPlugin = {
  id: 'ycSync',
  afterDraw(chart) {
    if (_ycSyncTime === null) return;
    const { ctx: c, chartArea, scales } = chart;
    if (!chartArea) return;
    const px = scales.x.getPixelForValue(_ycSyncTime);
    if (px < chartArea.left || px > chartArea.right) return;
    c.save();
    c.strokeStyle = 'rgba(200,200,220,0.4)';
    c.lineWidth = 1;
    c.setLineDash([4, 3]);
    c.beginPath();
    c.moveTo(px, chartArea.top);
    c.lineTo(px, chartArea.bottom);
    c.stroke();
    c.restore();
  },
  afterEvent(chart, args) {
    const { event } = args;
    if (event.type !== 'mousemove' && event.type !== 'mouseout') return;
    const other = chart === yieldCurveYieldChart ? yieldCurveSpreadChart : yieldCurveYieldChart;
    if (!other) return;

    if (event.type === 'mouseout') {
      _ycSyncTime = null;
      other.tooltip.setActiveElements([], { x: 0, y: 0 });
      other.update('none');
      args.changed = true;
      return;
    }

    const timeVal = chart.scales.x.getValueForPixel(event.x);
    _ycSyncTime = timeVal;

    const activeEls = [];
    other.data.datasets.forEach((ds, di) => {
      if (!other.isDatasetVisible(di) || !ds.data.length) return;
      let minDist = Infinity, nearestIdx = 0;
      ds.data.forEach((pt, idx) => {
        const dist = Math.abs(new Date(pt.x).getTime() - timeVal);
        if (dist < minDist) { minDist = dist; nearestIdx = idx; }
      });
      activeEls.push({ datasetIndex: di, index: nearestIdx });
    });

    const otherX = other.scales.x.getPixelForValue(timeVal);
    other.tooltip.setActiveElements(activeEls, { x: otherX, y: 0 });
    other.update('none');
    args.changed = true;
  },
};

const SPREAD_ZONES = [
  { from: -Infinity, to: -0.5, color: 'rgba(255,70,85,0.22)'   },  // 심한 역전
  { from: -0.5,      to:  0,   color: 'rgba(255,146,43,0.18)'  },  // 역전
  { from:  0,        to:  0.5, color: 'rgba(255,217,61,0.15)'  },  // 평탄
  { from:  0.5,      to: Infinity, color: 'rgba(0,209,122,0.15)' }, // 정상
];

const inversionBgPlugin = {
  id: 'inversionBg',
  beforeDraw(chart) {
    const { ctx: c, chartArea, scales } = chart;
    if (!chartArea) return;
    const { top, bottom, left, right } = chartArea;
    const yScale = scales.y;
    c.save();
    c.beginPath();
    c.rect(left, top, right - left, bottom - top);
    c.clip();
    SPREAD_ZONES.forEach(zone => {
      const capFrom = zone.from === -Infinity ? yScale.min : zone.from;
      const capTo   = zone.to   ===  Infinity ? yScale.max : zone.to;
      const yTop    = yScale.getPixelForValue(Math.min(capTo,   yScale.max));
      const yBottom = yScale.getPixelForValue(Math.max(capFrom, yScale.min));
      if (yBottom <= yTop) return;
      c.fillStyle = zone.color;
      c.fillRect(left, yTop, right - left, yBottom - yTop);
    });
    // 0 기준선 강조
    const zeroY = yScale.getPixelForValue(0);
    if (zeroY >= top && zeroY <= bottom) {
      c.strokeStyle = 'rgba(200,200,220,0.5)';
      c.lineWidth = 1.5;
      c.setLineDash([]);
      c.beginPath();
      c.moveTo(left, zeroY);
      c.lineTo(right, zeroY);
      c.stroke();
    }
    c.restore();
  },
};

async function loadYieldCurve() {
  const container = document.getElementById('yieldCurveRow');

  if (!container.querySelector('.yc-toolbar')) {
    container.innerHTML = `
      <div class="yc-toolbar">
        <div class="yc-periods">
          ${Object.entries(YC_PERIOD_LABELS).map(([p, label]) =>
            `<button class="yc-pbtn${p === yieldCurvePeriod ? ' active' : ''}" data-p="${p}">${label}</button>`
          ).join('')}
        </div>
        <div class="yc-legend-wrap">
          ${YC_YIELD_SERIES.map(s =>
            `<button class="yc-toggle-btn${yieldCurveHidden.has(s.key) ? ' hidden-series' : ''}" data-key="${s.key}">
               <span class="yc-dot" style="background:${s.color}"></span>${s.label}
             </button>`
          ).join('')}
        </div>
      </div>
      <div id="ycPerfRow" class="yc-perf-row"></div>
      <div class="yc-zone-legend">
        <span class="yc-zl-item yc-zl-severe"><span class="yc-zl-dot"></span>심한 역전 <em>(-0.5%↓) 경기침체 임박</em></span>
        <span class="yc-zl-item yc-zl-invert"><span class="yc-zl-dot"></span>역전 <em>(-0.5~0%) 침체 경고</em></span>
        <span class="yc-zl-item yc-zl-flat"><span class="yc-zl-dot"></span>평탄 <em>(0~+0.5%) 둔화 주의</em></span>
        <span class="yc-zl-item yc-zl-normal"><span class="yc-zl-dot"></span>정상 <em>(+0.5%↑) 경기 확장</em></span>
      </div>
      <div class="yc-chart-wrap">
        <span class="yc-loading" id="ycLoadingMsg">로딩 중...</span>
        <canvas id="ycYieldCanvas" style="display:none"></canvas>
      </div>
      <div class="yc-chart-wrap yc-spread-wrap">
        <canvas id="ycSpreadCanvas" style="display:none"></canvas>
      </div>`;

    container.querySelectorAll('.yc-pbtn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.yc-pbtn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        yieldCurvePeriod = btn.dataset.p;
        fetchYieldHistory();
      });
    });

    container.querySelectorAll('.yc-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const idx = YC_YIELD_SERIES.findIndex(s => s.key === key);
        if (yieldCurveHidden.has(key)) {
          yieldCurveHidden.delete(key);
          btn.classList.remove('hidden-series');
          yieldCurveYieldChart?.setDatasetVisibility(idx, true);
        } else {
          yieldCurveHidden.add(key);
          btn.classList.add('hidden-series');
          yieldCurveYieldChart?.setDatasetVisibility(idx, false);
        }
        yieldCurveYieldChart?.update();
        renderYcPerfRow();
      });
    });
  }

  await fetchYieldHistory();
}

function renderYcPerfRow() {
  const row = document.getElementById('ycPerfRow');
  if (!row) return;
  const periodLabel = YC_PERIOD_LABELS[yieldCurvePeriod] || yieldCurvePeriod;
  const chips = YC_YIELD_SERIES
    .filter(s => !yieldCurveHidden.has(s.key))
    .map(s => {
      const arr = _yieldData[s.key] || [];
      if (arr.length < 2) return '';
      const first = arr[0].v;
      const last  = arr[arr.length - 1].v;
      const diff  = last - first;
      const sign  = diff >= 0 ? '+' : '';
      const cls   = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
      return `<span class="yc-perf-chip">
        <span class="yc-dot" style="background:${s.color}"></span>
        <span class="yc-perf-name">${s.label}</span>
        <span class="yc-perf-val">${last.toFixed(2)}%</span>
        <span class="yc-perf-chg ${cls}">${sign}${diff.toFixed(2)}%p</span>
      </span>`;
    }).join('');
  row.innerHTML = chips
    ? `<span class="yc-perf-label">${periodLabel} 변화</span>${chips}`
    : '';
}

async function fetchYieldHistory() {
  const loadMsg  = document.getElementById('ycLoadingMsg');
  const statusEl = document.getElementById('yieldCurveStatus');
  if (loadMsg) loadMsg.style.display = 'inline';
  ['ycYieldCanvas', 'ycSpreadCanvas'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  try {
    const res = await fetch(`/api/yield-history?period=${yieldCurvePeriod}`);
    if (!res.ok) throw new Error('fetch failed');
    _yieldData = await res.json();

    const spread = _yieldData.spread || [];
    if (spread.length > 0) {
      const last = spread[spread.length - 1].v;
      statusEl.textContent = last < 0 ? '역전 (경기침체 경고)' : '정상';
      statusEl.className   = `yc-status-badge ${last < 0 ? 'inverted' : 'normal'}`;
    }

    renderYieldCurveChart();
    renderYcPerfRow();
    if (loadMsg) loadMsg.style.display = 'none';
    ['ycYieldCanvas', 'ycSpreadCanvas'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'block';
    });
  } catch {
    if (loadMsg) { loadMsg.style.display = 'inline'; loadMsg.textContent = '데이터 로드 실패'; }
  }
}

function renderYieldCurveChart() {
  const yieldCanvas  = document.getElementById('ycYieldCanvas');
  const spreadCanvas = document.getElementById('ycSpreadCanvas');
  if (!yieldCanvas || !spreadCanvas) return;

  if (yieldCurveYieldChart)  { yieldCurveYieldChart.destroy();  yieldCurveYieldChart  = null; }
  if (yieldCurveSpreadChart) { yieldCurveSpreadChart.destroy(); yieldCurveSpreadChart = null; }

  const xCfg = {
    type: 'time',
    time: { tooltipFormat: 'yyyy-MM-dd', displayFormats: { month: 'yy-MM', year: 'yyyy' } },
    grid: { color: '#252836' },
    ticks: { color: '#7b7f97', font: { size: 11 }, maxTicksLimit: 8 },
  };

  yieldCurveYieldChart = new Chart(yieldCanvas.getContext('2d'), {
    type: 'line',
    data: {
      datasets: YC_YIELD_SERIES.map(s => ({
        label: s.label,
        data: (_yieldData[s.key] || []).map(d => ({ x: d.t, y: d.v })),
        borderColor: s.color,
        backgroundColor: 'transparent',
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2,
        tension: 0.3,
        hidden: yieldCurveHidden.has(s.key),
      })),
    },
    plugins: [ycSyncPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: 0 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y?.toFixed(2)}%` } },
      },
      scales: {
        x: { ...xCfg, ticks: { ...xCfg.ticks, display: false } },
        y: {
          position: 'left',
          grid: { color: '#252836' },
          ticks: { color: '#7b7f97', font: { size: 11 }, callback: v => v.toFixed(1) + '%' },
          title: { display: true, text: '금리 (%)', color: '#7b7f97', font: { size: 11 } },
        },
      },
    },
  });

  yieldCurveSpreadChart = new Chart(spreadCanvas.getContext('2d'), {
    type: 'line',
    data: {
      datasets: [{
        label: '스프레드 (10Y-2Y)',
        data: (_yieldData.spread || []).map(d => ({ x: d.t, y: d.v })),
        borderColor: '#cc5de8',
        backgroundColor: 'transparent',
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 1.5,
        borderDash: [5, 3],
        tension: 0.3,
      }],
    },
    plugins: [ycSyncPlugin, inversionBgPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: 0 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y?.toFixed(2)}%` } },
      },
      scales: {
        x: xCfg,
        y: {
          position: 'left',
          grid: {
            color: ctx => ctx.tick.value === 0 ? 'rgba(220,220,240,0.7)' : '#252836',
            lineWidth: ctx => ctx.tick.value === 0 ? 2 : 1,
          },
          ticks: { color: '#cc5de8', font: { size: 11 }, callback: v => v.toFixed(2) + '%' },
          title: { display: true, text: '스프레드 (%)', color: '#cc5de8', font: { size: 11 } },
        },
      },
    },
  });

  // 두 차트의 chartArea.left를 맞춰서 수직축 정렬
  requestAnimationFrame(() => {
    if (!yieldCurveYieldChart || !yieldCurveSpreadChart) return;
    const leftY = yieldCurveYieldChart.chartArea?.left ?? 0;
    const leftS = yieldCurveSpreadChart.chartArea?.left ?? 0;
    const diff  = Math.round(leftY - leftS);
    if (Math.abs(diff) < 1) return;
    if (diff > 0) {
      yieldCurveSpreadChart.options.layout.padding.left = diff;
      yieldCurveSpreadChart.update('none');
    } else {
      yieldCurveYieldChart.options.layout.padding.left = -diff;
      yieldCurveYieldChart.update('none');
    }
  });
}

// ─── VIX 공포 지수 ───────────────────────────────────────────
const VIX_ZONES = [
  { from: 0,  to: 15,       label: '안정',        color: 'rgba(0,209,122,0.10)'   },
  { from: 15, to: 25,       label: '보통',        color: 'rgba(255,217,61,0.10)'  },
  { from: 25, to: 35,       label: '공포',        color: 'rgba(255,146,43,0.12)'  },
  { from: 35, to: Infinity, label: '극단적 공포',  color: 'rgba(255,70,85,0.15)'   },
];

const VIX_BADGE = {
  '안정':        'vix-stable',
  '보통':        'vix-normal',
  '공포':        'vix-fear',
  '극단적 공포': 'vix-extreme',
};

function getVixLevel(v) {
  return VIX_ZONES.find(z => v < z.to) || VIX_ZONES[VIX_ZONES.length - 1];
}

let vixChart = null;
let vixPeriod = '5y';
let _vixData  = [];

async function loadVixChart() {
  const container = document.getElementById('vixChartRow');

  if (!container.querySelector('.yc-toolbar')) {
    container.innerHTML = `
      <div class="yc-toolbar">
        <div class="yc-periods">
          ${Object.entries(YC_PERIOD_LABELS).map(([p, label]) =>
            `<button class="yc-pbtn${p === vixPeriod ? ' active' : ''}" data-p="${p}">${label}</button>`
          ).join('')}
        </div>
      </div>
      <div class="yc-chart-wrap vix-chart-wrap">
        <span class="yc-loading" id="vixLoadingMsg">로딩 중...</span>
        <canvas id="vixCanvas" style="display:none"></canvas>
      </div>`;

    container.querySelectorAll('.yc-pbtn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.yc-pbtn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        vixPeriod = btn.dataset.p;
        fetchVixHistory();
      });
    });
  }

  await fetchVixHistory();
}

async function fetchVixHistory() {
  const loadMsg  = document.getElementById('vixLoadingMsg');
  const canvas   = document.getElementById('vixCanvas');
  const badge    = document.getElementById('vixStatusBadge');
  if (loadMsg) loadMsg.style.display = 'inline';
  if (canvas)  canvas.style.display  = 'none';

  try {
    const res = await fetch(`/api/vix-history?period=${vixPeriod}`);
    if (!res.ok) throw new Error('fetch failed');
    _vixData = await res.json();

    if (_vixData.length > 0) {
      const last  = _vixData[_vixData.length - 1].c;
      const level = getVixLevel(last);
      badge.textContent = `${last.toFixed(2)}  ${level.label}`;
      badge.className   = `vix-badge ${VIX_BADGE[level.label]}`;
    }

    renderVixChart();
    if (loadMsg) loadMsg.style.display = 'none';
    if (canvas)  canvas.style.display  = 'block';
  } catch {
    if (loadMsg) { loadMsg.style.display = 'inline'; loadMsg.textContent = '데이터 로드 실패'; }
  }
}

function renderVixChart() {
  const canvas = document.getElementById('vixCanvas');
  if (!canvas) return;
  if (vixChart) { vixChart.destroy(); vixChart = null; }

  const ctx = canvas.getContext('2d');

  const vixZoneBgPlugin = {
    id: 'vixZoneBg',
    beforeDraw(chart) {
      const { ctx: c, chartArea, scales } = chart;
      if (!chartArea) return;
      const { top, left, right, bottom } = chartArea;
      const yScale = scales.y;
      c.save();
      c.beginPath();
      c.rect(left, top, right - left, bottom - top);
      c.clip();
      VIX_ZONES.forEach(zone => {
        const capTo   = zone.to === Infinity ? yScale.max : zone.to;
        const yTop    = yScale.getPixelForValue(Math.min(capTo,      yScale.max));
        const yBottom = yScale.getPixelForValue(Math.max(zone.from,  yScale.min));
        if (yBottom <= yTop) return;
        c.fillStyle = zone.color;
        c.fillRect(left, yTop, right - left, yBottom - yTop);
      });
      [15, 25, 35].forEach(val => {
        if (val <= yScale.min || val >= yScale.max) return;
        const py = yScale.getPixelForValue(val);
        c.strokeStyle = 'rgba(200,200,220,0.25)';
        c.lineWidth = 1;
        c.setLineDash([4, 4]);
        c.beginPath();
        c.moveTo(left, py);
        c.lineTo(right, py);
        c.stroke();
      });
      c.restore();
    },
  };

  vixChart = new Chart(ctx, {
    type: 'candlestick',
    data: {
      datasets: [{
        label: 'VIX',
        data: _vixData.map(d => ({
          x: new Date(d.t).getTime(),
          o: d.o, h: d.h, l: d.l, c: d.c,
        })),
        color: {
          up:        '#ef5350',
          down:      '#1e88e5',
          unchanged: '#888888',
        },
      }],
    },
    plugins: [vixZoneBgPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const r = ctx.raw;
              const level = getVixLevel(r.c);
              return [
                `시가: ${r.o?.toFixed(2)}`,
                `고가: ${r.h?.toFixed(2)}`,
                `저가: ${r.l?.toFixed(2)}`,
                `종가: ${r.c?.toFixed(2)}  (${level.label})`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          type: 'timeseries',
          time: { tooltipFormat: 'yyyy-MM-dd', displayFormats: { month: 'yy-MM', year: 'yyyy' } },
          grid: { color: '#252836' },
          ticks: { color: '#7b7f97', font: { size: 11 }, maxTicksLimit: 8 },
        },
        y: {
          position: 'left',
          grid: { color: '#252836' },
          ticks: { color: '#7b7f97', font: { size: 11 } },
          title: { display: true, text: 'VIX', color: '#7b7f97', font: { size: 11 } },
        },
      },
    },
  });
}

// ─── ISM 제조업 PMI ────────────────────────────────────────────
const ISM_ZONES = [
  { from: -Infinity, to: -20, label: '침체',    color: 'rgba(255,70,85,0.22)',   badge: 'ism-recession' },
  { from: -20,       to:   0, label: '수축',    color: 'rgba(255,146,43,0.18)',  badge: 'ism-contract'  },
  { from:   0,       to:  20, label: '확장',    color: 'rgba(0,209,122,0.15)',   badge: 'ism-expand'    },
  { from:  20,  to: Infinity, label: '강한 확장', color: 'rgba(0,209,122,0.28)', badge: 'ism-strong'    },
];

function getIsmLevel(v) {
  return ISM_ZONES.find(z => v < z.to) || ISM_ZONES[ISM_ZONES.length - 1];
}

let ismPmiChart  = null;
let ismPmiPeriod = '5y';
let _ismPmiData  = [];

const ISM_PERIOD_LABELS = { '1y': '1년', '2y': '2년', '3y': '3년', '5y': '5년', '10y': '10년' };

async function loadIsmPmiChart() {
  const container = document.getElementById('ismPmiChartRow');
  if (!container.querySelector('.yc-toolbar')) {
    container.innerHTML = `
      <div class="yc-toolbar">
        <div class="yc-periods">
          ${Object.entries(ISM_PERIOD_LABELS).map(([p, label]) =>
            `<button class="yc-pbtn${p === ismPmiPeriod ? ' active' : ''}" data-p="${p}">${label}</button>`
          ).join('')}
        </div>
        <div class="tga-zone-legend">
          <span class="tga-zl-item" style="color:rgba(255,70,85,0.9)"><span class="tga-zl-dot" style="background:rgba(255,70,85,0.9)"></span>침체 <em>-20↓</em></span>
          <span class="tga-zl-item" style="color:rgba(255,146,43,0.9)"><span class="tga-zl-dot" style="background:rgba(255,146,43,0.9)"></span>수축 <em>-20~0</em></span>
          <span class="tga-zl-item" style="color:rgba(0,209,122,0.9)"><span class="tga-zl-dot" style="background:rgba(0,209,122,0.9)"></span>확장 <em>0~20</em></span>
          <span class="tga-zl-item" style="color:rgba(0,209,122,1)"><span class="tga-zl-dot" style="background:rgba(0,209,122,1)"></span>강한 확장 <em>20↑</em></span>
        </div>
      </div>
      <div class="yc-chart-wrap vix-chart-wrap">
        <span class="yc-loading" id="ismPmiLoadingMsg">로딩 중...</span>
        <canvas id="ismPmiCanvas" style="display:none"></canvas>
      </div>`;

    container.querySelectorAll('.yc-pbtn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.yc-pbtn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        ismPmiPeriod = btn.dataset.p;
        fetchIsmPmiHistory();
      });
    });
  }
  await fetchIsmPmiHistory();
}

async function fetchIsmPmiHistory() {
  const loadMsg = document.getElementById('ismPmiLoadingMsg');
  const canvas  = document.getElementById('ismPmiCanvas');
  const badge   = document.getElementById('ismPmiStatusBadge');
  if (loadMsg) loadMsg.style.display = 'inline';
  if (canvas)  canvas.style.display  = 'none';

  try {
    const res = await fetch(`/api/ism-pmi-history?period=${ismPmiPeriod}`);
    if (!res.ok) throw new Error('fetch failed');
    _ismPmiData = await res.json();

    if (_ismPmiData.length >= 2 && badge) {
      const last  = _ismPmiData[_ismPmiData.length - 1].v;
      const prev  = _ismPmiData[_ismPmiData.length - 2].v;
      const level = getIsmLevel(last);
      const arrow = last > prev ? '▲' : '▼';
      badge.textContent = `${last.toFixed(1)}  ${level.label} ${arrow}`;
      badge.className   = `ism-badge ${level.badge}`;
    }

    renderIsmPmiChart();
    if (loadMsg) loadMsg.style.display = 'none';
    if (canvas)  canvas.style.display  = 'block';
  } catch {
    if (loadMsg) { loadMsg.style.display = 'inline'; loadMsg.textContent = '데이터 로드 실패'; }
  }
}

function renderIsmPmiChart() {
  const canvas = document.getElementById('ismPmiCanvas');
  if (!canvas) return;
  if (ismPmiChart) { ismPmiChart.destroy(); ismPmiChart = null; }

  const ctx = canvas.getContext('2d');

  const ismZoneBgPlugin = {
    id: 'ismZoneBg',
    beforeDraw(chart) {
      const { ctx: c, chartArea, scales } = chart;
      if (!chartArea) return;
      const { top, left, right, bottom } = chartArea;
      const yScale = scales.y;
      c.save();
      c.beginPath();
      c.rect(left, top, right - left, bottom - top);
      c.clip();
      ISM_ZONES.forEach(zone => {
        const capTo   = zone.to === Infinity ? yScale.max : zone.to;
        const yTop    = yScale.getPixelForValue(Math.min(capTo,     yScale.max));
        const yBottom = yScale.getPixelForValue(Math.max(zone.from, yScale.min));
        if (yBottom <= yTop) return;
        c.fillStyle = zone.color;
        c.fillRect(left, yTop, right - left, yBottom - yTop);
      });
      [-20, 0, 20].forEach(val => {
        if (val <= yScale.min || val >= yScale.max) return;
        const py = yScale.getPixelForValue(val);
        c.strokeStyle = val === 0 ? 'rgba(200,200,220,0.5)' : 'rgba(200,200,220,0.25)';
        c.lineWidth   = val === 0 ? 1.5 : 1;
        c.setLineDash(val === 0 ? [] : [4, 4]);
        c.beginPath();
        c.moveTo(left, py);
        c.lineTo(right, py);
        c.stroke();
      });
      c.restore();
    },
  };

  ismPmiChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'ISM PMI',
        data: _ismPmiData.map(d => ({ x: new Date(d.t).getTime(), y: d.v })),
        borderColor: '#4f7eff',
        backgroundColor: 'rgba(79,126,255,0.08)',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: false,
        tension: 0.3,
      }],
    },
    plugins: [ismZoneBgPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.parsed.y.toFixed(1)}  (${getIsmLevel(ctx.parsed.y).label})`,
          },
        },
      },
      scales: {
        x: {
          type: 'timeseries',
          time: { tooltipFormat: 'yyyy-MM-dd', displayFormats: { month: 'yy-MM', year: 'yyyy' } },
          grid: { color: '#252836' },
          ticks: { color: '#7b7f97', font: { size: 11 }, maxTicksLimit: 8 },
        },
        y: {
          position: 'left',
          grid: {
            color: ctx => ctx.tick.value === 0 ? 'rgba(200,200,220,0.3)' : '#252836',
            lineWidth: ctx => ctx.tick.value === 0 ? 2 : 1,
          },
          ticks: {
            color: '#7b7f97',
            font: { size: 11 },
            callback: val => val.toFixed(0),
          },
          title: { display: true, text: '제조업 현황 (기준=0)', color: '#7b7f97', font: { size: 11 } },
        },
      },
    },
  });
}

// ─── LEI (경기선행지수) ────────────────────────────────────────────
const LEI_PERIOD_LABELS = { '1y': '1년', '2y': '2년', '3y': '3년', '5y': '5년', '10y': '10년' };

let leiChart  = null;
let leiPeriod = '5y';
let _leiData  = [];

async function loadLeiChart() {
  const container = document.getElementById('leiChartRow');
  if (!container.querySelector('.yc-toolbar')) {
    container.innerHTML = `
      <div class="yc-toolbar">
        <div class="yc-periods">
          ${Object.entries(LEI_PERIOD_LABELS).map(([p, label]) =>
            `<button class="yc-pbtn${p === leiPeriod ? ' active' : ''}" data-p="${p}">${label}</button>`
          ).join('')}
        </div>
      </div>
      <div class="yc-chart-wrap vix-chart-wrap">
        <span class="yc-loading" id="leiLoadingMsg">로딩 중...</span>
        <canvas id="leiCanvas" style="display:none"></canvas>
      </div>`;

    container.querySelectorAll('.yc-pbtn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.yc-pbtn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        leiPeriod = btn.dataset.p;
        fetchLeiHistory();
      });
    });
  }
  await fetchLeiHistory();
}

async function fetchLeiHistory() {
  const loadMsg = document.getElementById('leiLoadingMsg');
  const canvas  = document.getElementById('leiCanvas');
  const badge   = document.getElementById('leiStatusBadge');
  if (loadMsg) loadMsg.style.display = 'inline';
  if (canvas)  canvas.style.display  = 'none';

  try {
    const res = await fetch(`/api/lei-history?period=${leiPeriod}`);
    if (!res.ok) throw new Error('fetch failed');
    _leiData = await res.json();

    if (_leiData.length >= 2 && badge) {
      const last = _leiData[_leiData.length - 1].v;
      const prev = _leiData[_leiData.length - 2].v;
      const isExpanding = last > 100;
      const isRising    = last > prev;
      badge.textContent = `${last.toFixed(2)}  ${isExpanding ? '확장' : '수축'} ${isRising ? '▲' : '▼'}`;
      badge.className   = `lei-badge ${isExpanding ? 'lei-expand' : 'lei-contract'}`;
    }

    renderLeiChart();
    if (loadMsg) loadMsg.style.display = 'none';
    if (canvas)  canvas.style.display  = 'block';
  } catch {
    if (loadMsg) { loadMsg.style.display = 'inline'; loadMsg.textContent = '데이터 로드 실패'; }
  }
}

function renderLeiChart() {
  const canvas = document.getElementById('leiCanvas');
  if (!canvas) return;
  if (leiChart) { leiChart.destroy(); leiChart = null; }

  const ctx = canvas.getContext('2d');

  const leiBgPlugin = {
    id: 'leiBg',
    beforeDraw(chart) {
      const { ctx: c, chartArea, scales } = chart;
      if (!chartArea) return;
      const { top, left, right, bottom } = chartArea;
      const yScale = scales.y;
      const refY = yScale.getPixelForValue(100);
      const clampedRef = Math.max(top, Math.min(bottom, refY));
      c.save();
      c.beginPath();
      c.rect(left, top, right - left, bottom - top);
      c.clip();
      // 100 위 = 확장 (초록)
      if (clampedRef > top) {
        c.fillStyle = 'rgba(0,209,122,0.10)';
        c.fillRect(left, top, right - left, clampedRef - top);
      }
      // 100 아래 = 수축 (빨강)
      if (clampedRef < bottom) {
        c.fillStyle = 'rgba(255,70,85,0.15)';
        c.fillRect(left, clampedRef, right - left, bottom - clampedRef);
      }
      // 100 기준선
      if (refY >= top && refY <= bottom) {
        c.strokeStyle = 'rgba(200,200,220,0.5)';
        c.lineWidth = 1.5;
        c.setLineDash([]);
        c.beginPath();
        c.moveTo(left, refY);
        c.lineTo(right, refY);
        c.stroke();
      }
      c.restore();
    },
  };

  leiChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'LEI',
        data: _leiData.map(d => ({ x: new Date(d.t).getTime(), y: d.v })),
        borderColor: '#ffd93d',
        backgroundColor: 'rgba(255,217,61,0.08)',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: false,
        tension: 0.3,
      }],
    },
    plugins: [leiBgPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.parsed.y.toFixed(2)}`,
          },
        },
      },
      scales: {
        x: {
          type: 'timeseries',
          time: { tooltipFormat: 'yyyy-MM-dd', displayFormats: { month: 'yy-MM', year: 'yyyy' } },
          grid: { color: '#252836' },
          ticks: { color: '#7b7f97', font: { size: 11 }, maxTicksLimit: 8 },
        },
        y: {
          position: 'left',
          grid: {
            color: (ctx) => ctx.tick.value === 100 ? 'rgba(200,200,220,0.3)' : '#252836',
            lineWidth: (ctx) => ctx.tick.value === 100 ? 2 : 1,
          },
          ticks: {
            color: '#7b7f97',
            font: { size: 11 },
            callback: val => val.toFixed(1),
          },
          title: { display: true, text: 'OECD CLI (기준=100)', color: '#7b7f97', font: { size: 11 } },
        },
      },
    },
  });
}

// ─── TGA (재무부 일반계좌) ────────────────────────────────────────────
const TGA_ZONES = [
  { from: 0,   to: 200,      label: '위험', color: 'rgba(255,70,85,0.30)',   badge: 'tga-danger'  },
  { from: 200, to: 400,      label: '주의', color: 'rgba(255,217,61,0.25)',  badge: 'tga-caution' },
  { from: 400, to: Infinity, label: '정상', color: 'rgba(0,209,122,0.20)',   badge: 'tga-normal'  },
];

function getTgaLevel(v) {
  return TGA_ZONES.find(z => v < z.to) || TGA_ZONES[TGA_ZONES.length - 1];
}

let tgaChart  = null;
let tgaPeriod = '5y';
let _tgaData  = [];

async function loadTgaChart() {
  const container = document.getElementById('tgaChartRow');
  if (!container.querySelector('.yc-toolbar')) {
    const periods = [['1y','1년'],['2y','2년'],['3y','3년'],['5y','5년']];
    container.innerHTML = `
      <div class="yc-toolbar">
        <div class="yc-periods">
          ${periods.map(([p, label]) =>
            `<button class="yc-pbtn${p === tgaPeriod ? ' active' : ''}" data-p="${p}">${label}</button>`
          ).join('')}
        </div>
        <div class="tga-zone-legend">
          <span class="tga-zl-item tga-zl-danger"><span class="tga-zl-dot"></span>위험 <em>&lt; $200B</em></span>
          <span class="tga-zl-item tga-zl-caution"><span class="tga-zl-dot"></span>주의 <em>$200~400B</em></span>
          <span class="tga-zl-item tga-zl-normal"><span class="tga-zl-dot"></span>정상 <em>&gt; $400B</em></span>
        </div>
      </div>
      <div class="yc-chart-wrap vix-chart-wrap">
        <span class="yc-loading" id="tgaLoadingMsg">로딩 중...</span>
        <canvas id="tgaCanvas" style="display:none"></canvas>
      </div>`;

    container.querySelectorAll('.yc-pbtn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.yc-pbtn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        tgaPeriod = btn.dataset.p;
        fetchTgaHistory();
      });
    });
  }
  await fetchTgaHistory();
}

async function fetchTgaHistory() {
  const loadMsg = document.getElementById('tgaLoadingMsg');
  const canvas  = document.getElementById('tgaCanvas');
  const badge   = document.getElementById('tgaStatusBadge');
  if (loadMsg) loadMsg.style.display = 'inline';
  if (canvas)  canvas.style.display  = 'none';

  try {
    const res = await fetch(`/api/tga-history?period=${tgaPeriod}`);
    if (!res.ok) throw new Error('fetch failed');
    _tgaData = await res.json();

    if (_tgaData.length > 0 && badge) {
      const last  = _tgaData[_tgaData.length - 1].v;
      const level = getTgaLevel(last);
      badge.textContent = `$${last.toFixed(0)}B  ${level.label}`;
      badge.className   = `tga-badge ${level.badge}`;
    }

    renderTgaChart();
    if (loadMsg) loadMsg.style.display = 'none';
    if (canvas)  canvas.style.display  = 'block';
  } catch {
    if (loadMsg) { loadMsg.style.display = 'inline'; loadMsg.textContent = '데이터 로드 실패'; }
  }
}

function renderTgaChart() {
  const canvas = document.getElementById('tgaCanvas');
  if (!canvas) return;
  if (tgaChart) { tgaChart.destroy(); tgaChart = null; }

  const ctx = canvas.getContext('2d');

  const tgaZoneBgPlugin = {
    id: 'tgaZoneBg',
    beforeDraw(chart) {
      const { ctx: c, chartArea, scales } = chart;
      if (!chartArea) return;
      const { top, left, right } = chartArea;
      const yScale = scales.y;
      c.save();
      c.beginPath();
      c.rect(left, top, right - left, chartArea.bottom - top);
      c.clip();
      TGA_ZONES.forEach(zone => {
        const capTo   = zone.to === Infinity ? yScale.max : zone.to;
        const yTop    = yScale.getPixelForValue(Math.min(capTo,     yScale.max));
        const yBottom = yScale.getPixelForValue(Math.max(zone.from, yScale.min));
        if (yBottom <= yTop) return;
        c.fillStyle = zone.color;
        c.fillRect(left, yTop, right - left, yBottom - yTop);
      });
      [200, 400].forEach(val => {
        if (val <= yScale.min || val >= yScale.max) return;
        const py = yScale.getPixelForValue(val);
        c.strokeStyle = 'rgba(200,200,220,0.2)';
        c.lineWidth = 1;
        c.setLineDash([4, 4]);
        c.beginPath();
        c.moveTo(left, py);
        c.lineTo(right, py);
        c.stroke();
      });
      c.restore();
    },
  };

  tgaChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'TGA',
        data: _tgaData.map(d => ({ x: new Date(d.t).getTime(), y: d.v })),
        borderColor: '#4f7eff',
        backgroundColor: 'rgba(79,126,255,0.12)',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: true,
        tension: 0.3,
      }],
    },
    plugins: [tgaZoneBgPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `$${ctx.parsed.y.toFixed(1)}B`,
          },
        },
      },
      scales: {
        x: {
          type: 'timeseries',
          time: { tooltipFormat: 'yyyy-MM-dd', displayFormats: { month: 'yy-MM', year: 'yyyy' } },
          grid: { color: '#252836' },
          ticks: { color: '#7b7f97', font: { size: 11 }, maxTicksLimit: 8 },
        },
        y: {
          position: 'left',
          min: 0,
          grid: { color: '#252836' },
          ticks: {
            color: '#7b7f97',
            font: { size: 11 },
            callback: val => `$${val}B`,
          },
          title: { display: true, text: '잔액 (십억$)', color: '#7b7f97', font: { size: 11 } },
        },
      },
    },
  });
}

async function loadSectorHeatmap() {
  const wrap = document.getElementById('heatmapTable');
  wrap.innerHTML = '<div class="yc-loading">로딩 중...</div>';
  try {
    const res = await fetch('/api/sector-heatmap');
    if (!res.ok) throw new Error('fetch failed');
    _heatmapData = await res.json();
    renderHeatmap();
  } catch {
    wrap.innerHTML = '<div class="yc-loading">데이터 로드 실패</div>';
  }
}

function renderHeatmap() {
  const wrap = document.getElementById('heatmapTable');
  if (!_heatmapData) return;

  let sectors = Object.keys(_heatmapData);
  if (heatmapSortKey) {
    sectors.sort((a, b) => {
      const va = _heatmapData[a]?.[heatmapSortKey] ?? -Infinity;
      const vb = _heatmapData[b]?.[heatmapSortKey] ?? -Infinity;
      return heatmapSortAsc ? va - vb : vb - va;
    });
  }

  wrap.innerHTML = `
    <table class="hm-table">
      <thead>
        <tr>
          <th class="hm-th-sector">섹터</th>
          ${HEATMAP_PERIODS.map(p => `
            <th class="hm-th-period${heatmapSortKey === p ? ' sorted' : ''}" data-period="${p}">
              ${HEATMAP_PERIOD_LABELS[p]}${heatmapSortKey === p ? (heatmapSortAsc ? ' ↑' : ' ↓') : ''}
            </th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${sectors.map(sym => {
          const row = _heatmapData[sym] || {};
          return `<tr>
            <td class="hm-td-sector">
              <span class="hm-sector-sym">${sym}</span>
              <span class="hm-sector-name">${SECTOR_LABELS[sym] || ''}</span>
            </td>
            ${HEATMAP_PERIODS.map(p => {
              const val = row[p];
              const bg  = heatColor(val);
              const cls = val > 0 ? 'up' : val < 0 ? 'down' : 'flat';
              return `<td class="hm-td ${cls}" style="background:${bg}">${val != null ? (val >= 0 ? '+' : '') + val.toFixed(2) + '%' : 'N/A'}</td>`;
            }).join('')}
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  wrap.querySelectorAll('.hm-th-period').forEach(th => {
    th.addEventListener('click', () => {
      const p = th.dataset.period;
      if (heatmapSortKey === p) {
        if (heatmapSortAsc) { heatmapSortKey = null; }
        else { heatmapSortAsc = true; }
      } else {
        heatmapSortKey = p;
        heatmapSortAsc = false;
      }
      renderHeatmap();
    });
  });
}

// ============================================================
//  M I N D M A P
// ============================================================

let mmData = { categories: [], stocks: [], edges: [] };
let mmTx = { z: 1, x: 0, y: 0 };
let mmMode = 'normal'; // 'normal' | 'connect' | 'delete'
let mmConnSrc = null;
let mmDrag = null;
let mmTouchSt = null;
let mmSearchTimer = null;
let mmLongPressTimer = null;
let mmEdgeLPTimer = null;   // edge long-press timer
let mmEdgeLPFired = false;  // whether long press already triggered

const MM_CANVAS_SIZE = 6000;

function mmGenId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── Storage ──────────────────────────────────────────────────

function mmSave() {
  const json = JSON.stringify(mmData);
  try { localStorage.setItem('mmData_v1', json); } catch {}
  fetch('/api/db/settings/mindmapData', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: json }),
  }).catch(() => {});
}

async function mmLoad() {
  let fromDB = false;
  try {
    const res = await fetch('/api/db/settings/mindmapData');
    if (res.ok) {
      const d = await res.json();
      if (d.value) { mmData = JSON.parse(d.value); fromDB = true; }
    }
  } catch {}

  // DB에 없으면 localStorage 폴백 (구버전 데이터 마이그레이션)
  if (!fromDB) {
    try {
      const s = localStorage.getItem('mmData_v1');
      if (s) {
        mmData = JSON.parse(s);
        // localStorage 데이터를 DB에 올려서 다음부터 동기화
        mmSave();
      }
    } catch {}
  }

  if (!mmData.categories) mmData.categories = [];
  if (!mmData.stocks)     mmData.stocks     = [];
  if (!mmData.edges)      mmData.edges      = [];
}

// ── Transform ────────────────────────────────────────────────

function mmApplyTransform() {
  const canvas = document.getElementById('mmCanvas');
  if (!canvas) return;
  canvas.style.transform = `translate(${mmTx.x}px,${mmTx.y}px) scale(${mmTx.z})`;
  const lbl = document.getElementById('mmZoomPct');
  if (lbl) lbl.textContent = Math.round(mmTx.z * 100) + '%';
}

function mmResetView() {
  const vp = document.getElementById('mmViewport');
  if (!vp) return;
  mmTx.x = vp.clientWidth  / 2 - MM_CANVAS_SIZE / 2;
  mmTx.y = vp.clientHeight / 2 - MM_CANVAS_SIZE / 2;
  mmTx.z = 1;
  mmApplyTransform();
}

function mmZoomAt(factor, mx, my) {
  const nz = Math.min(4, Math.max(0.15, mmTx.z * factor));
  const dz = nz / mmTx.z;
  mmTx.x = mx - dz * (mx - mmTx.x);
  mmTx.y = my - dz * (my - mmTx.y);
  mmTx.z = nz;
  mmApplyTransform();
}

// ── Mouse events ─────────────────────────────────────────────

function mmOnMouseMove(e) {
  if (!mmDrag) return;
  const dx = e.clientX - mmDrag.sx;
  const dy = e.clientY - mmDrag.sy;

  if (mmDrag.type === 'pan') {
    mmTx.x = mmDrag.ox + dx;
    mmTx.y = mmDrag.oy + dy;
    mmApplyTransform();
    return;
  }

  // Threshold: wait 5px before treating as a real drag
  if (!mmDrag.moved) {
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    mmDrag.moved = true;
    document.body.style.cursor = 'grabbing';
  }

  if (mmDrag.type === 'stock') {
    const s = mmData.stocks.find(s => s.id === mmDrag.id);
    if (!s || s.categoryId) return;
    s.position.x = mmDrag.ox + dx / mmTx.z;
    s.position.y = mmDrag.oy + dy / mmTx.z;
    const el = document.querySelector(`[data-mm-id="${s.id}"]`);
    if (el) { el.style.left = s.position.x + 'px'; el.style.top = s.position.y + 'px'; }
    // Highlight category if overlapping
    const tgt = mmFindDropTarget(el);
    document.querySelectorAll('.mm-drop-target').forEach(e => e.classList.remove('mm-drop-target'));
    if (tgt) document.querySelector(`[data-mm-id="${tgt.id}"]`)?.classList.add('mm-drop-target');
    mmRenderEdges();
    return;
  }
  if (mmDrag.type === 'cat') {
    const c = mmData.categories.find(c => c.id === mmDrag.id);
    if (!c) return;
    c.position.x = mmDrag.ox + dx / mmTx.z;
    c.position.y = mmDrag.oy + dy / mmTx.z;
    const el = document.querySelector(`[data-mm-id="${c.id}"]`);
    if (el) { el.style.left = c.position.x + 'px'; el.style.top = c.position.y + 'px'; }
    mmRenderEdges();
  }
}

function mmOnMouseUp() {
  document.body.style.cursor = '';
  if (!mmDrag) return;
  const { type, id, moved } = mmDrag;
  mmDrag = null;

  document.querySelectorAll('.mm-drop-target').forEach(e => e.classList.remove('mm-drop-target'));

  if (type === 'stock' && moved) {
    const s = mmData.stocks.find(s => s.id === id);
    if (s && !s.categoryId) {
      const stockEl = document.querySelector(`[data-mm-id="${id}"]`);
      const tgt = mmFindDropTarget(stockEl);
      if (tgt) {
        // Drop into category
        s.categoryId = tgt.id;
        mmSave(); mmRender();
        return;
      }
    }
    mmSave();
    const block = e => { e.stopPropagation(); document.removeEventListener('click', block, true); };
    document.addEventListener('click', block, true);
    return;
  }
  if (type !== 'pan' && moved) {
    mmSave();
    const block = e => { e.stopPropagation(); document.removeEventListener('click', block, true); };
    document.addEventListener('click', block, true);
  }
}

// Return a category that the given element's center is hovering over
function mmFindDropTarget(el) {
  if (!el) return null;
  const er = el.getBoundingClientRect();
  const cx = er.left + er.width / 2;
  const cy = er.top  + er.height / 2;
  for (const cat of mmData.categories) {
    const catEl = document.querySelector(`[data-mm-id="${cat.id}"]`);
    if (!catEl) continue;
    const cr = catEl.getBoundingClientRect();
    if (cx > cr.left && cx < cr.right && cy > cr.top && cy < cr.bottom) return cat;
  }
  return null;
}

// ── Node center (canvas-space coords) ────────────────────────

function mmGetCenter(id) {
  const canvas = document.getElementById('mmCanvas');
  if (!canvas) return null;
  const el = canvas.querySelector(`[data-mm-id="${id}"]`);
  if (!el) return null;
  const cr = canvas.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  return {
    x: (er.left + er.width  / 2 - cr.left) / mmTx.z,
    y: (er.top  + er.height / 2 - cr.top)  / mmTx.z,
  };
}

// ── Render ───────────────────────────────────────────────────

function mmRender() {
  const canvas = document.getElementById('mmCanvas');
  if (!canvas) return;
  canvas.querySelectorAll('.mm-node, .mm-cat-node').forEach(el => el.remove());
  mmData.categories.forEach(cat  => canvas.appendChild(mmMakeCatEl(cat)));
  mmData.stocks.filter(s => !s.categoryId).forEach(s => canvas.appendChild(mmMakeStockEl(s)));
  mmRenderEdges();
}

function mmRenderEdges() {
  clearTimeout(mmEdgeLPTimer); mmEdgeLPTimer = null;
  const svg = document.getElementById('mmEdgeSvg');
  if (!svg) return;
  svg.innerHTML = `<defs>
    <marker id="mm-arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="#4f7eff" opacity="0.8"/>
    </marker>
  </defs>`;

  mmData.edges.forEach(edge => {
    const src = mmGetCenter(edge.sourceId);
    const tgt = mmGetCenter(edge.targetId);
    if (!src || !tgt) return;

    const dx = tgt.x - src.x;
    const d  = `M${src.x},${src.y} C${src.x + dx * 0.5},${src.y} ${tgt.x - dx * 0.5},${tgt.y} ${tgt.x},${tgt.y}`;

    // Wide invisible hit area — click=edit label, long press=delete
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hit.setAttribute('d', d);
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '18');
    hit.setAttribute('fill', 'none');
    hit.style.cursor = 'pointer';
    hit.style.pointerEvents = 'stroke';

    // Mouse long-press
    hit.addEventListener('mousedown', e => {
      e.stopPropagation();
      mmEdgeLPFired = false;
      mmEdgeLPTimer = setTimeout(() => {
        mmEdgeLPFired = true; mmEdgeLPTimer = null;
        mmDeleteEdgeConfirm(edge.id);
      }, 600);
    });
    hit.addEventListener('mouseup',   () => { clearTimeout(mmEdgeLPTimer); mmEdgeLPTimer = null; });
    hit.addEventListener('mousemove', () => { clearTimeout(mmEdgeLPTimer); mmEdgeLPTimer = null; });
    hit.addEventListener('click', e => {
      e.stopPropagation();
      if (mmEdgeLPFired) { mmEdgeLPFired = false; return; }
      if (mmMode === 'delete') { mmDeleteEdgeConfirm(edge.id); return; }
      mmEditEdgeLabel(edge.id);
    });

    // Touch long-press
    hit.addEventListener('touchstart', e => {
      e.stopPropagation();
      mmEdgeLPFired = false;
      mmEdgeLPTimer = setTimeout(() => {
        mmEdgeLPFired = true; mmEdgeLPTimer = null;
        mmDeleteEdgeConfirm(edge.id);
      }, 600);
    }, { passive: true });
    hit.addEventListener('touchmove', () => {
      clearTimeout(mmEdgeLPTimer); mmEdgeLPTimer = null;
    }, { passive: true });
    hit.addEventListener('touchend', () => {
      if (mmEdgeLPTimer) {
        clearTimeout(mmEdgeLPTimer); mmEdgeLPTimer = null;
        if (!mmEdgeLPFired) mmEditEdgeLabel(edge.id); // short tap → edit
      }
    }, { passive: true });

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', '#4f7eff');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('fill', 'none');
    path.setAttribute('opacity', '0.7');
    path.setAttribute('marker-end', 'url(#mm-arr)');

    svg.appendChild(hit);
    svg.appendChild(path);

    // Label with background pill
    if (edge.label) {
      const mx = (src.x + tgt.x) / 2;
      const my = (src.y + tgt.y) / 2 - 10;
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', mx);
      text.setAttribute('y', my);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('font-size', '11');
      text.setAttribute('fill', '#c0c4d8');
      text.textContent = edge.label;
      // measure text width after inserting temporarily
      svg.appendChild(g);
      g.appendChild(text);
      const tw = text.getBBox?.()?.width || edge.label.length * 7;
      g.removeChild(text);
      svg.removeChild(g);

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', mx - tw / 2 - 6);
      rect.setAttribute('y', my - 9);
      rect.setAttribute('width', tw + 12);
      rect.setAttribute('height', 18);
      rect.setAttribute('rx', '9');
      rect.setAttribute('fill', '#161923');
      rect.setAttribute('stroke', '#4f7eff');
      rect.setAttribute('stroke-width', '1');
      rect.setAttribute('opacity', '0.9');

      const labelG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      labelG.appendChild(rect);
      labelG.appendChild(text);
      svg.appendChild(labelG);
    }
  });
}

// ── Edge label edit & delete ──────────────────────────────────

function mmEditEdgeLabel(edgeId) {
  const edge = mmData.edges.find(e => e.id === edgeId);
  if (!edge) return;
  const val = prompt('연결선 이름 수정 (빈칸=이름 없음):', edge.label || '');
  if (val === null) return;
  edge.label = val.trim();
  mmSave(); mmRenderEdges();
}

function mmDeleteEdgeConfirm(edgeId) {
  const edge = mmData.edges.find(e => e.id === edgeId);
  if (!edge) return;
  const msg = edge.label ? `"${edge.label}" 연결선을 삭제하시겠습니까?` : '이 연결선을 삭제하시겠습니까?';
  if (!confirm(msg)) return;
  mmData.edges = mmData.edges.filter(e => e.id !== edgeId);
  mmSave(); mmRenderEdges();
}

// ── Returns formatter ─────────────────────────────────────────

function mmFmtRet(v) {
  if (v == null) return `<span class="mm-ret-val">—</span>`;
  const cls = v > 0 ? 'up' : v < 0 ? 'down' : '';
  return `<span class="mm-ret-val ${cls}">${v >= 0 ? '+' : ''}${v.toFixed(1)}%</span>`;
}

// ── Element builders ─────────────────────────────────────────

function mmMakeStockEl(stock) {
  const r = stock.returns || {};
  const div = document.createElement('div');
  div.className = 'mm-node';
  div.dataset.mmId = stock.id;
  div.style.left = stock.position.x + 'px';
  div.style.top  = stock.position.y + 'px';

  div.innerHTML = `
    <span class="mm-drag-handle">⠿</span>
    <div class="mm-node-btns">
      <button class="mm-move-cat-btn" title="분류로 이동">📂</button>
      <button class="mm-del-btn" data-del-id="${stock.id}" data-del-type="stock" title="삭제">×</button>
    </div>
    <div class="mm-node-main" data-click-id="${stock.id}" data-click-ticker="${stock.ticker}" data-click-name="${stock.name.replace(/"/g,'&quot;')}">
      <div class="mm-node-head">
        <span class="mm-ticker">${stock.name}</span>
        <span class="mm-sname">${stock.ticker}</span>
      </div>
      <div class="mm-tags mm-tags-editable" title="클릭하여 태그 수정">
        ${stock.tags?.length ? stock.tags.map(t=>`<span class="mm-tag">${t}</span>`).join('') : '<span class="mm-tags-hint">+ 태그 추가</span>'}
      </div>
      <div class="mm-returns">
        <div class="mm-ret-row"><span class="mm-ret-lbl">1D</span>${mmFmtRet(r['1d'])}</div>
        <div class="mm-ret-row"><span class="mm-ret-lbl">7D</span>${mmFmtRet(r['7d'])}</div>
        <div class="mm-ret-row"><span class="mm-ret-lbl">1M</span>${mmFmtRet(r['1m'])}</div>
        <div class="mm-ret-row"><span class="mm-ret-lbl">6M</span>${mmFmtRet(r['6m'])}</div>
        <div class="mm-ret-row"><span class="mm-ret-lbl">1Y</span>${mmFmtRet(r['1y'])}</div>
      </div>
    </div>`;

  // Tag editing
  div.querySelector('.mm-tags-editable').addEventListener('click', e => {
    e.stopPropagation();
    const cur = stock.tags?.join(', ') || '';
    const val = prompt('태그 수정 (쉼표로 구분):', cur);
    if (val === null) return;
    stock.tags = val.split(',').map(t => t.trim()).filter(Boolean);
    mmSave();
    const canvas = document.getElementById('mmCanvas');
    canvas?.querySelector(`[data-mm-id="${stock.id}"]`)?.replaceWith(mmMakeStockEl(stock));
    mmRenderEdges();
  });

  // Move to category button
  div.querySelector('.mm-move-cat-btn').addEventListener('click', async e => {
    e.stopPropagation();
    if (!mmData.categories.length) { alert('먼저 분류를 추가해주세요.'); return; }
    const opts = mmData.categories.map(c => c.name);
    const choice = await mmSelectDialog(`${stock.ticker}을(를) 이동할 분류 선택`, opts);
    if (choice === null) return;
    stock.categoryId = mmData.categories[choice].id;
    mmSave(); mmRender();
  });

  mmBindHandlers(div);
  return div;
}

function mmMakeCatEl(cat) {
  const catStocks = mmData.stocks.filter(s => s.categoryId === cat.id);
  const div = document.createElement('div');
  div.className = 'mm-cat-node';
  div.dataset.mmId = cat.id;
  div.style.left = cat.position.x + 'px';
  div.style.top  = cat.position.y + 'px';

  div.innerHTML = `
    <div class="mm-cat-header">
      <span class="mm-drag-handle mm-cat-handle">⠿</span>
      <span class="mm-cat-name" data-click-id="${cat.id}" data-click-type="cat">${cat.name}</span>
      <button class="mm-cat-del-btn mm-del-btn" data-del-id="${cat.id}" data-del-type="cat" title="분류 삭제">×</button>
    </div>
    <div class="mm-cat-body" id="mm-cb-${cat.id}">
      ${catStocks.length === 0 ? '<div class="mm-cat-empty">종목 없음 — 검색 후 이 분류 선택</div>' : ''}
    </div>`;

  // Inline category name editing
  const nameEl = div.querySelector('.mm-cat-name');
  nameEl.addEventListener('click', e => {
    e.stopPropagation();
    if (mmMode === 'connect') { mmOnNodeClick(cat.id, 'cat', '', ''); return; }
    const input = document.createElement('input');
    input.className = 'mm-cat-name-input';
    input.value = cat.name;
    nameEl.replaceWith(input);
    input.focus(); input.select();
    const commit = () => {
      const v = input.value.trim();
      if (v) cat.name = v;
      mmSave();
      const canvas = document.getElementById('mmCanvas');
      canvas?.querySelector(`[data-mm-id="${cat.id}"]`)?.replaceWith(mmMakeCatEl(cat));
      mmRenderEdges();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', ke => {
      if (ke.key === 'Enter')  { ke.preventDefault(); input.blur(); }
      if (ke.key === 'Escape') {
        input.replaceWith(nameEl);
        nameEl.textContent = cat.name;
      }
    });
  });

  const body = div.querySelector('.mm-cat-body');
  catStocks.forEach(s => {
    const r = s.returns || {};
    const sEl = document.createElement('div');
    sEl.className = 'mm-cat-stock';
    sEl.dataset.mmId = s.id;
    sEl.innerHTML = `
      <div class="mm-cs-info" data-click-id="${s.id}" data-click-ticker="${s.ticker}" data-click-name="${s.name.replace(/"/g,'&quot;')}">
        <span class="mm-cs-ticker">${s.ticker}</span>
        <span class="mm-cs-name">${s.name}</span>
      </div>
      <div class="mm-cs-tags mm-tags-editable" title="클릭하여 태그 수정">
        ${s.tags?.length ? s.tags.map(t=>`<span class="mm-tag mm-tag-sm">${t}</span>`).join('') : '<span class="mm-tags-hint">+태그</span>'}
      </div>
      <div class="mm-cs-rets">
        <span class="mm-cs-ret"><span class="mm-cs-ret-lbl">1D</span>${mmFmtRet(r['1d'])}</span>
        <span class="mm-cs-ret"><span class="mm-cs-ret-lbl">7D</span>${mmFmtRet(r['7d'])}</span>
        <span class="mm-cs-ret"><span class="mm-cs-ret-lbl">1M</span>${mmFmtRet(r['1m'])}</span>
        <span class="mm-cs-ret"><span class="mm-cs-ret-lbl">6M</span>${mmFmtRet(r['6m'])}</span>
        <span class="mm-cs-ret"><span class="mm-cs-ret-lbl">1Y</span>${mmFmtRet(r['1y'])}</span>
      </div>
      <div class="mm-cs-actions">
        <button class="mm-cs-move-btn" title="분류 변경">↔</button>
        <button class="mm-cs-del-btn mm-del-btn" data-del-id="${s.id}" data-del-type="stock" title="제거">×</button>
      </div>`;

    // Move to different category / standalone
    sEl.querySelector('.mm-cs-move-btn').addEventListener('click', async e => {
      e.stopPropagation();
      const opts = ['(단독 배치)', ...mmData.categories.filter(c => c.id !== cat.id).map(c => c.name)];
      const choice = await mmSelectDialog(`${s.ticker} 이동`, opts);
      if (choice === null) return;
      if (choice === 0) {
        s.categoryId = null;
        const vp = document.getElementById('mmViewport');
        s.position = {
          x: cat.position.x + 250 + (Math.random() - 0.5) * 80,
          y: cat.position.y + (Math.random() - 0.5) * 80,
        };
      } else {
        s.categoryId = mmData.categories.filter(c => c.id !== cat.id)[choice - 1].id;
      }
      mmSave(); mmRender();
    });

    // Tag editing for stock inside category
    sEl.querySelector('.mm-cs-tags').addEventListener('click', e => {
      e.stopPropagation();
      const cur = s.tags?.join(', ') || '';
      const val = prompt('태그 수정 (쉼표로 구분):', cur);
      if (val === null) return;
      s.tags = val.split(',').map(t => t.trim()).filter(Boolean);
      mmSave();
      const canvas = document.getElementById('mmCanvas');
      canvas?.querySelector(`[data-mm-id="${cat.id}"]`)?.replaceWith(mmMakeCatEl(cat));
      mmRenderEdges();
    });

    body.appendChild(sEl);
  });

  mmBindHandlers(div);
  return div;
}

function mmBindHandlers(el) {
  el.querySelectorAll('[data-click-id]').forEach(t => {
    t.addEventListener('click', e => {
      e.stopPropagation();
      mmOnNodeClick(t.dataset.clickId, t.dataset.clickType || 'stock', t.dataset.clickTicker, t.dataset.clickName);
    });
  });

  el.querySelectorAll('[data-del-id]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id   = btn.dataset.delId;
      const type = btn.dataset.delType;
      if (type === 'cat') {
        const cat = mmData.categories.find(c => c.id === id);
        if (!cat) return;
        if (!confirm(`"${cat.name}" 분류를 삭제할까요?\n(포함 종목은 단독 배치로 이동됩니다)`)) return;
        mmData.stocks.filter(s => s.categoryId === id).forEach(s => {
          s.categoryId = null;
          s.position = { x: cat.position.x + (Math.random() - 0.5) * 160, y: cat.position.y + 200 };
        });
        mmData.categories = mmData.categories.filter(c => c.id !== id);
        mmData.edges = mmData.edges.filter(e => e.sourceId !== id && e.targetId !== id);
      } else {
        const s = mmData.stocks.find(s => s.id === id);
        if (!s) return;
        if (!confirm(`${s.ticker} 종목을 삭제할까요?`)) return;
        mmData.stocks = mmData.stocks.filter(s => s.id !== id);
        mmData.edges  = mmData.edges.filter(e => e.sourceId !== id && e.targetId !== id);
      }
      mmSave(); mmRender();
    });
  });
}

// ── Long-press → start connect from a node ───────────────────

function mmStartConnectFrom(id) {
  mmMode = 'connect';
  mmConnSrc = id;
  document.getElementById('mmConnectBtn').classList.add('active');
  document.getElementById('mmDeleteBtn').classList.remove('active');
  document.querySelectorAll('[data-mm-id]').forEach(el => el.classList.remove('mm-conn-src'));
  document.querySelector(`[data-mm-id="${id}"]`)?.classList.add('mm-conn-src');
  // Short visual feedback
  const el = document.querySelector(`[data-mm-id="${id}"]`);
  if (el) {
    el.style.transition = 'box-shadow 0.2s';
    el.style.boxShadow = '0 0 0 4px rgba(79,126,255,0.5)';
    setTimeout(() => { el.style.boxShadow = ''; }, 600);
  }
}

// ── Node click: connect mode or open chart ────────────────────

function mmOnNodeClick(id, type, ticker, name) {
  if (mmMode === 'connect') {
    if (!mmConnSrc) {
      mmConnSrc = id;
      document.querySelectorAll('[data-mm-id]').forEach(el => el.classList.remove('mm-conn-src'));
      document.querySelector(`[data-mm-id="${id}"]`)?.classList.add('mm-conn-src');
    } else if (mmConnSrc !== id) {
      const already = mmData.edges.some(e =>
        (e.sourceId === mmConnSrc && e.targetId === id) ||
        (e.sourceId === id && e.targetId === mmConnSrc)
      );
      if (!already) {
        const label = (prompt('연결 레이블 입력 (선택 사항 — 빈칸 OK):') ?? '').trim();
        mmData.edges.push({ id: mmGenId('edge'), sourceId: mmConnSrc, targetId: id, label });
        mmSave();
      }
      document.querySelectorAll('[data-mm-id]').forEach(el => el.classList.remove('mm-conn-src'));
      mmConnSrc = null;
      mmRenderEdges();
    }
    return;
  }
  if (type === 'stock' && ticker) openChart(ticker);
}

// ── Add stock dialog ──────────────────────────────────────────

async function mmAddStock(symbol, name) {
  if (mmData.stocks.some(s => s.ticker === symbol)) {
    alert(`${symbol}은(는) 이미 마인드맵에 있습니다.`);
    return;
  }

  const cats = mmData.categories;
  let catId = null;
  if (cats.length > 0) {
    const opts = ['(단독 배치)', ...cats.map(c => c.name)];
    const choice = await mmSelectDialog('종목을 어디에 추가할까요?', opts);
    if (choice === null) return;
    if (choice > 0) catId = cats[choice - 1].id;
  }

  const tagsRaw = (prompt(`${symbol} 태그 입력 (쉼표 구분, 예: AI반도체,GPU)\n비워두면 태그 없음:`) ?? '').trim();
  const tags    = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

  const vp = document.getElementById('mmViewport');
  const cx = (vp.clientWidth  / 2 - mmTx.x) / mmTx.z;
  const cy = (vp.clientHeight / 2 - mmTx.y) / mmTx.z;

  const stock = {
    id: mmGenId('stock'),
    name,
    ticker: symbol,
    tags,
    categoryId: catId,
    position: catId ? { x: 0, y: 0 } : { x: cx - 87 + (Math.random() - 0.5) * 120, y: cy - 80 + (Math.random() - 0.5) * 120 },
    returns: null
  };

  mmData.stocks.push(stock);
  mmSave();
  mmRender();
  mmFetchReturns(stock.id, symbol);
}

async function mmFetchReturns(stockId, symbol) {
  try {
    const [perfResult, priceResult] = await Promise.allSettled([
      fetchPerformance(symbol),
      fetchPrice(symbol),
    ]);
    const s = mmData.stocks.find(s => s.id === stockId);
    if (!s) return;
    const perf  = perfResult.status  === 'fulfilled' ? perfResult.value  : {};
    const price = priceResult.status === 'fulfilled' ? priceResult.value : {};
    s.returns = {
      '1d': price.change_pct ?? null,   // /api/price 의 change_pct 사용
      '7d': perf['5d']   ?? null,
      '1m': perf['1mo']  ?? null,
      '6m': perf['6mo']  ?? null,
      '1y': perf['1y']   ?? null,
    };
    mmSave();
    // Re-render the affected element
    const canvas = document.getElementById('mmCanvas');
    if (!canvas) return;
    const old = canvas.querySelector(`[data-mm-id="${stockId}"]`);
    if (!old) return;
    if (s.categoryId) {
      const catEl = canvas.querySelector(`[data-mm-id="${s.categoryId}"]`);
      const cat   = mmData.categories.find(c => c.id === s.categoryId);
      if (catEl && cat) catEl.replaceWith(mmMakeCatEl(cat));
    } else {
      old.replaceWith(mmMakeStockEl(s));
    }
    mmRenderEdges();
  } catch { /* silently fail */ }
}

// ── Simple native-style select dialog ────────────────────────

function mmSelectDialog(title, options) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'mm-dialog-overlay';
    const box = document.createElement('div');
    box.className = 'mm-dialog';
    box.innerHTML = `<div class="mm-dialog-title">${title}</div>
      <div class="mm-dialog-opts">${options.map((o, i) =>
        `<button class="mm-dialog-opt" data-idx="${i}">${o}</button>`).join('')}
      </div>
      <button class="mm-dialog-cancel">취소</button>`;
    box.querySelectorAll('.mm-dialog-opt').forEach(btn => {
      btn.addEventListener('click', () => { overlay.remove(); resolve(+btn.dataset.idx); });
    });
    box.querySelector('.mm-dialog-cancel').addEventListener('click', () => { overlay.remove(); resolve(null); });
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

// ── Refresh 1D returns for all stocks (fixes null 1d on reload) ─

function mmRefreshAllReturns() {
  mmData.stocks.forEach(s => {
    if (s.returns?.['1d'] == null) mmFetchReturns(s.id, s.ticker);
  });
}

// ── Name migration: fix stocks where name was stored as ticker ─

async function mmFixStockNames() {
  const toFix = mmData.stocks.filter(s => !s.name || s.name === s.ticker);
  if (!toFix.length) return;
  let fixed = 0;
  await Promise.allSettled(toFix.map(async s => {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(s.ticker)}`).then(r => r.json());
      const match = res.find(r => r.symbol === s.ticker);
      if (match?.name && match.name !== s.ticker) {
        s.name = match.name;
        fixed++;
      }
    } catch {}
  }));
  if (fixed > 0) { mmSave(); mmRender(); }
}

// ── Search ───────────────────────────────────────────────────

async function mmDoSearch(q) {
  const sd = document.getElementById('mmSearchDropdown');
  sd.innerHTML = '<div class="dd-msg">검색 중...</div>';
  sd.classList.remove('hidden');

  try {
    const res   = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const items = await res.json();

    if (!items.length) {
      sd.innerHTML = '<div class="dd-msg">결과 없음</div>';
      return;
    }

    sd.innerHTML = items.slice(0, 8).map(item => `
      <div class="dd-item" data-symbol="${item.symbol}" data-name="${(item.name || '').replace(/"/g, '&quot;')}">
        <span class="dd-symbol">${item.symbol}</span>
        <span class="dd-name">${item.name || ''}</span>
        <span class="dd-exch">${item.exchange || ''}</span>
      </div>`).join('');

    sd.querySelectorAll('.dd-item').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        document.getElementById('mmSearchInput').value = '';
        sd.classList.add('hidden');
        mmAddStock(el.dataset.symbol, el.dataset.name);
      });
    });
  } catch {
    sd.innerHTML = '<div class="dd-msg" style="color:#ff4655">검색 실패</div>';
  }
}

// ── Touch support ────────────────────────────────────────────

function mmInitTouch() {
  const vp = document.getElementById('mmViewport');

  vp.addEventListener('touchstart', e => {
    // Two-finger pinch zoom
    if (e.touches.length === 2) {
      const t0 = e.touches[0], t1 = e.touches[1];
      const vpR = vp.getBoundingClientRect();
      mmTouchSt = {
        type: 'pinch',
        dist0: Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY),
        zoom0: mmTx.z,
        panX0: mmTx.x,
        panY0: mmTx.y,
        cx: (t0.clientX + t1.clientX) / 2 - vpR.left,
        cy: (t0.clientY + t1.clientY) / 2 - vpR.top,
      };
      e.preventDefault();
      return;
    }

    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!el) return;

    // Button inside a node → let native click fire, do NOT preventDefault
    if (el.closest('button')) return;

    // Whole node/category → drag, long-press connect, or tap
    const nodeEl = el.closest('.mm-node, .mm-cat-node');
    if (nodeEl) {
      const mmId  = nodeEl.dataset.mmId;
      const isCat = nodeEl.classList.contains('mm-cat-node');
      if (isCat && el.closest('.mm-cs-info')) return;
      const type = isCat ? 'cat' : 'stock';

      // Already in connect mode → this touch selects target
      if (mmMode === 'connect' && mmConnSrc && mmConnSrc !== mmId) {
        e.preventDefault();
        mmOnNodeClick(mmId, type, el.closest('[data-click-ticker]')?.dataset?.clickTicker || '', '');
        return;
      }

      const node = isCat
        ? mmData.categories.find(c => c.id === mmId)
        : mmData.stocks.find(s => s.id === mmId);
      if (!node || (type === 'stock' && node.categoryId)) return;
      e.preventDefault();

      // Long-press: 600ms → enter connect mode
      mmLongPressTimer = setTimeout(() => {
        mmLongPressTimer = null;
        if (mmTouchSt?.moved) return;
        mmTouchSt = null;
        mmStartConnectFrom(mmId);
      }, 600);

      mmTouchSt = { type: 'node', dragType: type, id: mmId,
        sx: touch.clientX, sy: touch.clientY,
        ox: node.position.x, oy: node.position.y,
        moved: false, tapEl: el };
      return;
    }

    // Canvas background → pan (anything not on a node/cat)
    e.preventDefault();
    mmTouchSt = { type: 'pan', sx: touch.clientX, sy: touch.clientY,
      ox: mmTx.x, oy: mmTx.y };
  }, { passive: false });

  vp.addEventListener('touchmove', e => {
    if (!mmTouchSt) return;

    // Pinch zoom + pan
    if (mmTouchSt.type === 'pinch' && e.touches.length === 2) {
      e.preventDefault();
      const t0 = e.touches[0], t1 = e.touches[1];
      const vpR = vp.getBoundingClientRect();
      const dist   = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const nz     = Math.min(4, Math.max(0.15, mmTouchSt.zoom0 * dist / mmTouchSt.dist0));
      const curCx  = (t0.clientX + t1.clientX) / 2 - vpR.left;
      const curCy  = (t0.clientY + t1.clientY) / 2 - vpR.top;
      mmTx.x = mmTouchSt.cx - (nz / mmTouchSt.zoom0) * (mmTouchSt.cx - mmTouchSt.panX0) + (curCx - mmTouchSt.cx);
      mmTx.y = mmTouchSt.cy - (nz / mmTouchSt.zoom0) * (mmTouchSt.cy - mmTouchSt.panY0) + (curCy - mmTouchSt.cy);
      mmTx.z = nz;
      mmApplyTransform();
      return;
    }

    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - mmTouchSt.sx;
    const dy = touch.clientY - mmTouchSt.sy;

    if (mmTouchSt.type === 'pan') {
      e.preventDefault();
      mmTx.x = mmTouchSt.ox + dx;
      mmTx.y = mmTouchSt.oy + dy;
      mmApplyTransform();
    } else if (mmTouchSt.type === 'node') {
      if (!mmTouchSt.moved) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        mmTouchSt.moved = true;
        clearTimeout(mmLongPressTimer); mmLongPressTimer = null;
      }
      e.preventDefault();
      const id   = mmTouchSt.id;
      const node = mmTouchSt.dragType === 'cat'
        ? mmData.categories.find(c => c.id === id)
        : mmData.stocks.find(s => s.id === id);
      if (!node || (mmTouchSt.dragType === 'stock' && node.categoryId)) return;
      node.position.x = mmTouchSt.ox + dx / mmTx.z;
      node.position.y = mmTouchSt.oy + dy / mmTx.z;
      const el = document.querySelector(`[data-mm-id="${id}"]`);
      if (el) { el.style.left = node.position.x + 'px'; el.style.top = node.position.y + 'px'; }
      // Highlight drop target
      const tgt = mmFindDropTarget(el);
      document.querySelectorAll('.mm-drop-target').forEach(e => e.classList.remove('mm-drop-target'));
      if (tgt) document.querySelector(`[data-mm-id="${tgt.id}"]`)?.classList.add('mm-drop-target');
      mmRenderEdges();
    }
  }, { passive: false });

  vp.addEventListener('touchend', e => {
    clearTimeout(mmLongPressTimer); mmLongPressTimer = null;
    document.querySelectorAll('.mm-drop-target').forEach(e => e.classList.remove('mm-drop-target'));
    if (!mmTouchSt) return;
    const st = mmTouchSt;
    mmTouchSt = null;
    if (st.type === 'node' && st.moved) {
      // Check if dropped onto a category
      if (st.dragType === 'stock') {
        const s = mmData.stocks.find(s => s.id === st.id);
        if (s && !s.categoryId) {
          const stockEl = document.querySelector(`[data-mm-id="${st.id}"]`);
          const tgt = mmFindDropTarget(stockEl);
          if (tgt) { s.categoryId = tgt.id; mmSave(); mmRender(); return; }
        }
      }
      mmSave();
    } else if (st.type === 'node' && !st.moved && st.tapEl) {
      // Short tap — dispatch to whichever interactive element was touched
      const tagsEl  = st.tapEl.closest('.mm-tags-editable');
      const nameEl  = st.tapEl.closest('.mm-cat-name');
      const clickEl = st.tapEl.closest('[data-click-id]');
      if (tagsEl)       tagsEl.click();          // tag edit prompt
      else if (nameEl)  nameEl.click();           // category name inline edit
      else if (clickEl) mmOnNodeClick(clickEl.dataset.clickId, clickEl.dataset.clickType || 'stock', clickEl.dataset.clickTicker, clickEl.dataset.clickName);
    }
  }, { passive: true });

  vp.addEventListener('touchcancel', () => {
    clearTimeout(mmLongPressTimer); mmLongPressTimer = null;
    mmTouchSt = null;
  }, { passive: true });
}

// ── Init ──────────────────────────────────────────────────────

async function initMindmap() {
  await mmLoad();

  document.getElementById('mindmapBtn').addEventListener('click', () => {
    const showing = !document.getElementById('mindmapView').classList.contains('hidden');
    hideAllViews();
    if (!showing) {
      document.querySelector('main').classList.add('hidden');
      document.getElementById('mindmapView').classList.remove('hidden');
      document.getElementById('mindmapBtn').classList.add('active');
      requestAnimationFrame(() => { mmResetView(); mmRender(); mmFixStockNames(); mmRefreshAllReturns(); });
    }
  });

  document.getElementById('mmBackBtn').addEventListener('click', hideAllViews);

  document.getElementById('mmAddCatBtn').addEventListener('click', async () => {
    const name = (prompt('분류 이름을 입력하세요:') ?? '').trim();
    if (!name) return;
    const vp = document.getElementById('mmViewport');
    const cx = (vp.clientWidth  / 2 - mmTx.x) / mmTx.z;
    const cy = (vp.clientHeight / 2 - mmTx.y) / mmTx.z;
    mmData.categories.push({
      id: mmGenId('cat'),
      name,
      position: { x: cx - 115 + (Math.random() - 0.5) * 120, y: cy - 40 + (Math.random() - 0.5) * 80 }
    });
    mmSave(); mmRender();
  });

  const connBtn = document.getElementById('mmConnectBtn');
  connBtn.addEventListener('click', () => {
    if (mmMode === 'connect') {
      mmMode = 'normal'; mmConnSrc = null;
      connBtn.classList.remove('active');
      document.querySelectorAll('[data-mm-id]').forEach(el => el.classList.remove('mm-conn-src'));
    } else {
      mmMode = 'connect';
      connBtn.classList.add('active');
      document.getElementById('mmDeleteBtn').classList.remove('active');
    }
  });

  const delBtn = document.getElementById('mmDeleteBtn');
  delBtn.addEventListener('click', () => {
    if (mmMode === 'delete') {
      mmMode = 'normal'; delBtn.classList.remove('active');
    } else {
      mmMode = 'delete'; delBtn.classList.add('active');
      connBtn.classList.remove('active'); mmConnSrc = null;
    }
  });

  document.getElementById('mmZoomIn').addEventListener('click', () => {
    const vp = document.getElementById('mmViewport');
    mmZoomAt(1.2, vp.clientWidth / 2, vp.clientHeight / 2);
  });
  document.getElementById('mmZoomOut').addEventListener('click', () => {
    const vp = document.getElementById('mmViewport');
    mmZoomAt(0.8, vp.clientWidth / 2, vp.clientHeight / 2);
  });
  document.getElementById('mmZoomFit').addEventListener('click', mmResetView);

  const vp = document.getElementById('mmViewport');
  vp.addEventListener('wheel', e => {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    mmZoomAt(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // Canvas-level mousedown — handles node drag, long-press connect, canvas pan
  vp.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('button')) return;

    const nodeEl = e.target.closest('.mm-node');
    const catEl  = e.target.closest('.mm-cat-node');
    const anyNode = nodeEl || catEl;

    if (anyNode) {
      const id   = anyNode.dataset.mmId;
      const isCat = !!catEl && !nodeEl;

      if (isCat && e.target.closest('.mm-cs-info')) return;

      // If already in connect mode → this click selects the target
      if (mmMode === 'connect' && mmConnSrc && mmConnSrc !== id) {
        e.preventDefault();
        mmOnNodeClick(id, isCat ? 'cat' : 'stock', e.target.closest('[data-click-ticker]')?.dataset?.clickTicker || '', '');
        return;
      }

      const node = isCat
        ? mmData.categories.find(c => c.id === id)
        : mmData.stocks.find(s => s.id === id);
      if (!node) return;
      if (!isCat && node.categoryId) return;

      e.preventDefault();

      // Long-press: 600ms → enter connect mode from this node
      mmLongPressTimer = setTimeout(() => {
        mmLongPressTimer = null;
        if (mmDrag?.moved) return; // was a drag, not a long press
        mmDrag = null;
        mmStartConnectFrom(id);
      }, 600);

      mmDrag = { type: isCat ? 'cat' : 'stock', id, sx: e.clientX, sy: e.clientY, ox: node.position.x, oy: node.position.y, moved: false };
      return;
    }

    // Canvas background → pan
    e.preventDefault();
    mmDrag = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: mmTx.x, oy: mmTx.y };
  });

  // Cancel long press on mouseup/move
  document.addEventListener('mouseup', () => { clearTimeout(mmLongPressTimer); mmLongPressTimer = null; });

  document.addEventListener('mousemove', mmOnMouseMove);
  document.addEventListener('mouseup',   mmOnMouseUp);
  mmInitTouch();

  // Search — same UX as main stock search
  const si = document.getElementById('mmSearchInput');
  const sd = document.getElementById('mmSearchDropdown');

  si.addEventListener('input', () => {
    clearTimeout(mmSearchTimer);
    const q = si.value.trim();
    if (!q) { sd.classList.add('hidden'); return; }
    mmSearchTimer = setTimeout(() => mmDoSearch(q), 300);
  });

  si.addEventListener('keydown', e => {
    if (e.key === 'Escape') { sd.classList.add('hidden'); si.value = ''; }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.mm-search-wrap')) sd.classList.add('hidden');
  });
}

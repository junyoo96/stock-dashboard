const EYE_OPEN = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_CLOSED = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

// 동시 요청 수를 제한해서 브라우저 연결 자원 고갈(ERR_INSUFFICIENT_RESOURCES)을 방지
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx], idx); }
      catch (e) { results[idx] = { status: 'rejected', reason: e }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

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
let graphViewCurrentPeriod = '5y';
let stockChartsInstances = {};
let stockChartsCurrentPeriod = '5d';

// ─── 공통: 모든 뷰 숨기고 대시보드 복원 ─────────────────────────
function hideAllViews() {
  document.querySelector('main').classList.remove('hidden');
  document.getElementById('graphView').classList.add('hidden');
  document.getElementById('stockChartsView').classList.add('hidden');
  document.getElementById('stockAnalysisView').classList.add('hidden');
  document.getElementById('macroAnalysisView').classList.add('hidden');
  document.getElementById('mindmapView').classList.add('hidden');
  document.getElementById('feedbackView').classList.add('hidden');
  document.getElementById('portfolioView').classList.add('hidden');
  document.getElementById('dashboardBtn').classList.remove('active');
  document.getElementById('graphViewBtn').classList.remove('active');
  document.getElementById('stockChartsViewBtn').classList.remove('active');
  document.getElementById('stockAnalysisBtn').classList.remove('active');
  document.getElementById('macroAnalysisBtn').classList.remove('active');
  document.getElementById('mindmapBtn').classList.remove('active');
  document.getElementById('feedbackBtn').classList.remove('active');
  document.getElementById('portfolioBtn').classList.remove('active');
  Object.values(stockChartsInstances).forEach(c => c?.destroy());
  stockChartsInstances = {};
  hiddenGraphStocks.clear();
  closeSaDetail();
  closeSaHelpTooltip();
  pfChart?.destroy();
  pfChart = null;
}

async function initChartHeightBtns() {
  const wrap = document.querySelector('.gv-chart-wrap');
  if (!wrap) return;

  // DB에서 저장된 높이 값 불러오기
  try {
    const res = await fetch('/api/db/settings/gvChartHeight');
    if (res.ok) {
      const d = await res.json();
      if (d.value) {
        const h = parseInt(d.value, 10);
        wrap.style.height = h + 'px';
        // 가장 가까운 버튼에 active 표시
        let closest = null, minDiff = Infinity;
        document.querySelectorAll('.gv-hbtn').forEach(btn => {
          const diff = Math.abs(parseInt(btn.dataset.h, 10) - h);
          if (diff < minDiff) { minDiff = diff; closest = btn; }
        });
        document.querySelectorAll('.gv-hbtn').forEach(b => b.classList.remove('active'));
        if (closest) closest.classList.add('active');
      }
    }
  } catch {}

  document.querySelectorAll('.gv-hbtn').forEach(btn => {
    btn.addEventListener('click', () => {
      const h = parseInt(btn.dataset.h, 10);
      wrap.style.height = h + 'px';
      document.querySelectorAll('.gv-hbtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // transition 끝난 후 차트 리사이즈
      setTimeout(() => { if (graphViewChartInstance) graphViewChartInstance.resize(); }, 260);
      // DB 저장
      fetch('/api/db/settings/gvChartHeight', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: String(h) }),
      }).catch(() => {});
    });
  });
}

function initGraphView() {
  document.getElementById('graphViewBtn').addEventListener('click', toggleGraphView);
  initChartHeightBtns();
  document.querySelectorAll('.gv-pbtn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.gv-pbtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      graphViewCurrentPeriod = btn.dataset.p;
      // 날짜 직접 입력 초기화
      document.getElementById('gvDateStart').value = '';
      document.getElementById('gvDateEnd').value   = '';
      loadGraphView(graphViewCurrentPeriod);
    });
  });

  // 날짜 직접 설정
  const applyBtn = document.getElementById('gvDateApply');
  function onDateApply() {
    const s = document.getElementById('gvDateStart').value;
    const e = document.getElementById('gvDateEnd').value;
    if (!s || !e) return;
    if (s > e) { alert('시작일이 종료일보다 늦을 수 없습니다.'); return; }
    document.querySelectorAll('.gv-pbtn').forEach(b => b.classList.remove('active'));
    graphViewCurrentPeriod = 'custom';
    loadGraphView('custom', s, e);
  }
  applyBtn.addEventListener('click', onDateApply);
  // 종료일 입력 후 Enter 키로도 조회
  document.getElementById('gvDateEnd').addEventListener('keydown', e => { if (e.key === 'Enter') onDateApply(); });

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
      <div class="scv-card" id="scv-card-${id}" data-symbol="${s.symbol}">
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

  grid.querySelectorAll('.scv-card').forEach(card => {
    card.addEventListener('click', () => openChart(card.dataset.symbol));
  });

  await mapWithConcurrency(stocks, 6, async s => {
    const id = s.symbol.replace(/[^a-zA-Z0-9]/g, '_');
    try {
      const res = await fetch(`/api/chart/${encodeURIComponent(s.symbol)}?period=${period}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (!data.close?.length) throw new Error();

      // 1일 그래프는 전일 종가 기준(프리마켓 갭 포함, 대시보드 카드와 동일 기준)으로 계산
      const first = data.previous_close ?? data.close[0];
      const last  = data.close[data.close.length - 1];
      const ret   = (last - first) / first * 100;
      const sign  = ret >= 0 ? '+' : '';
      const cur   = s.currency || 'USD';
      const lineColor = ret > 0 ? '#00d17a' : ret < 0 ? '#ff4655' : '#7b7f97';

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
        type: 'line',
        data: {
          datasets: [{
            data: data.dates.map((d, i) => ({ x: new Date(d).getTime(), y: data.close[i] })),
            borderColor: lineColor,
            backgroundColor: lineColor + '1a',
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0.25,
            fill: true,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: c => formatPrice(c.parsed.y, cur),
                title: () => '',
              },
            },
          },
          scales: {
            x: { type: 'timeseries', display: false },
            y: { display: false },
          },
        },
      });
    } catch {
      const wrap = document.getElementById(`scv-canvas-${id}`)?.parentElement;
      if (wrap) wrap.innerHTML = '<p style="color:var(--muted);text-align:center;padding:14px;font-size:0.75rem">데이터 없음</p>';
    }
  });
}

async function loadGraphView(period, start = null, end = null) {
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
      let url = `/api/chart/${encodeURIComponent(s.symbol)}?period=${period}`;
      if (start) url += `&start=${start}`;
      if (end)   url += `&end=${end}`;
      const res = await fetch(url);
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
    // 1일 그래프는 전일 종가 기준(프리마켓 갭 포함, 대시보드 카드와 동일 기준)으로 계산
    const base = data.previous_close ?? data.close[0];
    return {
      label: symbol,
      data: data.dates.map((d, j) => ({
        x: new Date(d).getTime(),
        y: base > 0 ? +((data.close[j] / base - 1) * 100).toFixed(2) : null,
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
            label: c => `${c.dataset.label}: ${c.parsed.y >= 0 ? '+' : ''}${c.parsed.y?.toFixed(2)}%`,
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
          grid: {
            color: ctx => ctx.tick?.value === 0 ? '#7b7f97' : '#252836',
          },
          ticks: {
            color: '#7b7f97',
            font: { size: 10 },
            callback: v => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`,
          },
        },
      },
    },
  });

  _graphValidData = valid;
  _graphReturns.clear();

  const legendItems = valid.map(({ symbol, name, data }, i) => {
    const first = data.previous_close ?? data.close[0];
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
        ret: values[values.length - 1],
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
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y >= 0 ? '+' : ''}${ctx.parsed.y?.toFixed(2)}%`,
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
              minute: 'MM/dd HH:mm',
              hour:   'MM/dd HH:mm',
              day:   'yy.MM.dd',
              week:  'yy.MM.dd',
              month: 'yyyy.MM',
              year:  'yyyy',
            },
          },
        },
        y: {
          position: 'right',
          grid: {
            color: ctx => ctx.tick?.value === 0 ? '#7b7f97' : '#252836',
          },
          ticks: {
            color: '#7b7f97',
            font: { size: 10 },
            callback: v => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`,
          },
        },
      },
    },
  });
}

function initSectorChartToggle() {
  document.querySelectorAll('.scs-pbtn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll('.scs-pbtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadSectorChart(btn.dataset.p);
    });
  });
}

// ─── 국채금리·원유·주요지수 상관관계 ──────────────────────────
const MACRO_CORR_SERIES = [
  { key: 'DGS2',   label: '미국 2년 국채', color: '#69db7c', isYield: true, fmtCur: v => `${v.toFixed(2)}%` },
  { key: 'DGS10',  label: '미국 10년 국채', color: '#ff6b6b', isYield: true, fmtCur: v => `${v.toFixed(2)}%` },
  { key: 'WTI',    label: 'WTI 원유',       color: '#f59e0b', fmtCur: v => `$${v.toFixed(2)}` },
  { key: 'SPX',    label: 'S&P 500',        color: '#4f7eff' },
  { key: 'NASDAQ', label: '나스닥',         color: '#cc5de8' },
];

let macroCorrChartInstances = {};
let macroCorrHeight = 110;

let macroCorrReqSeq = 0;

async function loadMacroCorrelationChart(period = '1y') {
  // 기간 버튼 연타 시 늦게 도착한 이전 응답이 차트를 덮어쓰지 않도록 마지막 요청만 반영
  const seq = ++macroCorrReqSeq;
  const res = await fetch(`/api/macro-correlation?period=${period}`);
  if (!res.ok || seq !== macroCorrReqSeq) return;
  const { dates, series } = await res.json();
  if (seq !== macroCorrReqSeq || !dates.length) return;

  const grid = document.getElementById('macroCorrGrid');
  if (!grid) return;

  Object.values(macroCorrChartInstances).forEach(c => c?.destroy());
  macroCorrChartInstances = {};

  const active = MACRO_CORR_SERIES.filter(s => series[s.key]);

  grid.innerHTML = active.map(s => `
    <div class="mc-panel">
      <div class="mc-panel-head">
        <span class="mc-panel-dot" style="background:${s.color}"></span>
        <span class="mc-panel-title">${s.label}</span>
        ${s.fmtCur ? `<span class="mc-panel-cur" id="mcCur-${s.key}"></span>` : ''}
        <span class="mc-panel-val" id="mcVal-${s.key}"></span>
      </div>
      <div class="mc-panel-chart" style="height:${macroCorrHeight}px">
        <canvas id="mcCanvas-${s.key}"></canvas>
      </div>
    </div>
  `).join('');

  const macroCorrCrosshair = {
    id: 'macroCorrCrosshair',
    afterDraw(chart) {
      const idx = chart.$mcHoverIndex;
      if (idx == null) return;
      const point = chart.getDatasetMeta(0).data[idx];
      if (!point) return;
      const { ctx: c, chartArea } = chart;
      c.save();
      c.beginPath();
      c.moveTo(point.x, chartArea.top);
      c.lineTo(point.x, chartArea.bottom);
      c.lineWidth = 1;
      c.strokeStyle = 'rgba(255,255,255,0.35)';
      c.setLineDash([4, 4]);
      c.stroke();
      c.restore();
    },
  };

  function syncMacroCorrHover(index) {
    Object.values(macroCorrChartInstances).forEach(chart => {
      if (!chart) return;
      chart.$mcHoverIndex = index;
      if (index == null) {
        chart.setActiveElements([]);
        chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
      } else {
        const point = chart.getDatasetMeta(0).data[index];
        if (point) {
          chart.setActiveElements([{ datasetIndex: 0, index }]);
          chart.tooltip.setActiveElements([{ datasetIndex: 0, index }], { x: point.x, y: point.y });
        }
      }
      chart.update('none');
    });
  }

  active.forEach((s, i) => {
    const vals   = series[s.key];
    const isLast = i === active.length - 1;
    const first  = vals[0];
    const last   = vals[vals.length - 1];
    // 금리는 변화율이 아닌 금리 자체의 차이(%p)로 표시
    const chg    = s.isYield ? last - first
                 : first !== 0 ? (last - first) / Math.abs(first) * 100 : 0;
    const sign   = chg >= 0 ? '+' : '';
    const state  = chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat';
    const valEl  = document.getElementById(`mcVal-${s.key}`);
    if (valEl) {
      valEl.textContent = s.isYield ? `${sign}${chg.toFixed(2)}%p` : `${sign}${chg.toFixed(1)}%`;
      valEl.classList.add(state);
    }
    const curEl = document.getElementById(`mcCur-${s.key}`);
    if (curEl) curEl.textContent = s.fmtCur(last);

    const ctx = document.getElementById(`mcCanvas-${s.key}`);
    if (!ctx) return;

    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [{
          data: dates.map((d, j) => ({ x: new Date(d).getTime(), y: vals[j] })),
          borderColor: s.color,
          backgroundColor: 'transparent',
          borderWidth: 1.6,
          pointRadius: 0,
          tension: 0.25,
          fill: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            padding: 4,
            titleFont: { size: 9 },
            bodyFont: { size: 9 },
            titleMarginBottom: 2,
            callbacks: {
              title: items => {
                const d = new Date(items[0].parsed.x);
                return d.toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }).replace(/\s/g, '');
              },
              label: c => `${s.label}: ${c.parsed.y.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}`,
            },
          },
        },
        scales: {
          x: {
            type: 'timeseries',
            grid: { color: '#252836' },
            ticks: {
              display: isLast,
              // 첫/끝 라벨이 차트 밖으로 삐져나가 플롯 영역이 밀리지 않도록 안쪽 정렬
              align: 'inner',
              color: '#7b7f97', maxTicksLimit: 8, font: { size: 9 },
            },
            // 눈금 표시 시 Chart.js가 좌우에 붙이는 기본 여백(3px) 제거 → 위 패널들과 시작점 일치
            afterFit: scale => { scale.paddingLeft = 0; scale.paddingRight = 0; },
            time: {
              // 1년 이상은 월 단위 눈금(yy.MM), 그 미만은 같은 월이 반복되지 않도록 일 단위(MM.dd)
              unit: ['1mo', '3mo', '6mo'].includes(period) ? 'day' : 'month',
              displayFormats: {
                day:     'MM.dd',
                week:    'MM.dd',
                month:   'yy.MM',
                quarter: 'yy.MM',
                year:    'yy.MM',
              },
            },
          },
          y: {
            position: 'right',
            grid: { color: '#252836' },
            ticks: { color: '#7b7f97', font: { size: 9 }, maxTicksLimit: 4 },
            // 패널마다 눈금 자릿수가 달라도 플롯 폭이 같도록 축 폭 고정
            afterFit: scale => { scale.width = 44; },
          },
        },
      },
      plugins: [macroCorrCrosshair],
    });

    const handleMcHover = e => {
      const points = chart.getElementsAtEventForMode(e, 'index', { intersect: false }, false);
      if (points.length) syncMacroCorrHover(points[0].index);
    };
    ctx.addEventListener('mousemove', handleMcHover);
    ctx.addEventListener('mouseleave', () => syncMacroCorrHover(null));
    // 터치 드래그로도 크로스헤어 동기화 (모바일)
    ctx.addEventListener('touchstart', handleMcHover, { passive: true });
    ctx.addEventListener('touchmove', e => { e.preventDefault(); handleMcHover(e); }, { passive: false });
    ctx.addEventListener('touchend', () => syncMacroCorrHover(null));
    ctx.addEventListener('touchcancel', () => syncMacroCorrHover(null));

    macroCorrChartInstances[s.key] = chart;
  });
}

function initMacroCorrChartToggle() {
  document.querySelectorAll('.mc-pbtn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll('.mc-pbtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadMacroCorrelationChart(btn.dataset.p);
    });
  });
}

async function initMacroCorrHeightBtns() {
  try {
    const res = await fetch('/api/db/settings/macroCorrChartHeight');
    if (res.ok) {
      const d = await res.json();
      if (d.value) {
        macroCorrHeight = parseInt(d.value, 10);
        document.querySelectorAll('.mc-hbtn').forEach(b => b.classList.remove('active'));
        document.querySelector(`.mc-hbtn[data-h="${macroCorrHeight}"]`)?.classList.add('active');
      }
    }
  } catch {}

  document.querySelectorAll('.mc-hbtn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      macroCorrHeight = parseInt(btn.dataset.h, 10);
      document.querySelectorAll('.mc-hbtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.mc-panel-chart').forEach(el => { el.style.height = `${macroCorrHeight}px`; });
      requestAnimationFrame(() => {
        Object.values(macroCorrChartInstances).forEach(c => c?.resize());
      });
      fetch('/api/db/settings/macroCorrChartHeight', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: String(macroCorrHeight) }),
      }).catch(() => {});
    });
  });
}

// ─── 섹터 상대강도 (vs S&P500) ────────────────────────────────
const RS_PERIOD_LABELS = { '1d': '1일', '5d': '7일', '1mo': '1개월', '3mo': '3개월', '6mo': '6개월', '1y': '1년', '3y': '3년', '5y': '5년' };
let relStrengthChart  = null;
let relStrengthPeriod = '6mo';

async function loadRelativeStrength() {
  const container = document.getElementById('relStrengthRow');
  if (!container) return;

  if (!container.querySelector('.yc-toolbar')) {
    container.innerHTML = `
      <div class="yc-toolbar">
        <div class="yc-periods">
          ${Object.entries(RS_PERIOD_LABELS).map(([p, label]) =>
            `<button class="yc-pbtn${p === relStrengthPeriod ? ' active' : ''}" data-p="${p}">${label}</button>`
          ).join('')}
        </div>
      </div>
      <div class="scs-body rs-body">
        <div class="scs-chart-wrap">
          <canvas id="relStrengthCanvas"></canvas>
        </div>
        <div id="relStrengthLegend" class="scs-legend"></div>
      </div>`;

    container.querySelectorAll('.yc-pbtn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.yc-pbtn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        relStrengthPeriod = btn.dataset.p;
        fetchRelativeStrength();
      });
    });
  }

  await fetchRelativeStrength();
}

async function fetchRelativeStrength() {
  try {
    const res = await fetch(`/api/sector-relative-strength?period=${relStrengthPeriod}`);
    if (!res.ok) return;
    const { dates, series } = await res.json();
    renderRelativeStrength(dates, series);
  } catch {}
}

function renderRelativeStrength(dates, series) {
  const ctx = document.getElementById('relStrengthCanvas');
  if (!ctx || !dates || !dates.length) return;
  if (relStrengthChart) relStrengthChart.destroy();

  const datasets = Object.entries(series).map(([sym, values]) => ({
    label: sym,
    data: dates.map((d, i) => ({ x: new Date(d).getTime(), y: values[i] })),
    borderColor: SECTOR_COLORS[sym] || '#888',
    backgroundColor: 'transparent',
    borderWidth: 1.8,
    pointRadius: 0,
    tension: 0.3,
    spanGaps: true,
  }));

  const legend = document.getElementById('relStrengthLegend');
  if (legend) {
    const ranked = Object.entries(series)
      .map(([sym, values]) => {
        const last = [...values].reverse().find(v => v !== null && v !== undefined);
        return { sym, label: SECTOR_ETFS.find(e => e.sym === sym)?.label || '', ret: last };
      })
      .filter(r => r.ret !== undefined)
      .sort((a, b) => b.ret - a.ret);

    legend.innerHTML = ranked.map(({ sym, label, ret }) => {
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

  relStrengthChart = new Chart(ctx, {
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
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y >= 0 ? '+' : ''}${ctx.parsed.y?.toFixed(2)}%`,
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
              minute: 'MM/dd HH:mm',
              hour:   'MM/dd HH:mm',
              day:    'yy.MM.dd',
              week:   'yy.MM.dd',
              month:  'yyyy.MM',
              year:   'yyyy',
            },
          },
        },
        y: {
          position: 'right',
          grid: { color: ctx => ctx.tick?.value === 0 ? '#7b7f97' : '#252836' },
          ticks: {
            color: '#7b7f97',
            font: { size: 10 },
            callback: v => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`,
          },
        },
      },
    },
  });
}

let macroIndicators = [];

function saveMacroIndicators() {
  fetch('/api/db/settings/macroIndicators', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: JSON.stringify(macroIndicators) }),
  }).catch(() => {});
}

async function loadMacroIndicatorsFromDB() {
  try {
    const res = await fetch('/api/db/settings/macroIndicators');
    if (res.ok) {
      const data = await res.json();
      const parsed = JSON.parse(data.value);
      if (Array.isArray(parsed) && parsed.length > 0) macroIndicators = parsed;
    }
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
function addTouchDrag(container, itemSel, handleSel, onDrop, { hScroll = false } = {}) {
  let dragEl = null, clone = null, offX = 0, offY = 0;
  let pendingEl = null, pendingX = 0, pendingY = 0, pendingOffX = 0, pendingOffY = 0;
  let lpTimer = null, lpReady = false;
  const THRESHOLD = 10;
  const LP_MS = 450;

  function cancelLP() {
    clearTimeout(lpTimer); lpTimer = null;
    if (lpReady && pendingEl) {
      pendingEl.classList.remove('td-lp-ready');
      pendingEl.style.transform = '';
    }
    lpReady = false;
  }

  function startDragFrom(item, touch) {
    dragEl = item; pendingEl = null;
    item.classList.remove('td-lp-ready');
    item.style.transform = '';
    offX = touch.clientX - item.getBoundingClientRect().left;
    offY = touch.clientY - item.getBoundingClientRect().top;
    const rect = item.getBoundingClientRect();
    clone = item.cloneNode(true);
    clone.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;` +
      `width:${rect.width}px;height:${rect.height}px;opacity:0.85;pointer-events:none;` +
      `z-index:9999;transform:scale(1.05);box-shadow:0 8px 24px rgba(0,0,0,0.45);`;
    document.body.appendChild(clone);
    item.style.opacity = '0.3';
    if (navigator.vibrate) navigator.vibrate(30);
  }

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

    if (hScroll) {
      lpTimer = setTimeout(() => {
        if (!pendingEl) return;
        lpReady = true;
        pendingEl.classList.add('td-lp-ready');
      }, LP_MS);
    }
  }, { passive: true });

  container.addEventListener('touchmove', e => {
    const touch = e.touches[0];
    if (pendingEl && !dragEl) {
      const dx = Math.abs(touch.clientX - pendingX);
      const dy = Math.abs(touch.clientY - pendingY);
      if (dx < THRESHOLD && dy < THRESHOLD) return;

      if (hScroll) {
        if (!lpReady) {
          // 롱프레스 전 움직임 → 스크롤 허용
          cancelLP(); pendingEl = null; return;
        }
        // 롱프레스 완료 → 드래그 시작
        cancelLP();
        startDragFrom(pendingEl, touch);
      } else {
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
    cancelLP();
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

function initSectorCollapseAllBtn() {
  const btn = document.getElementById('sectorCollapseAllBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const groups = document.querySelectorAll('.sector-group');
    if (!groups.length) return;
    const allCollapsed = [...groups].every(g => g.classList.contains('collapsed'));
    groups.forEach(g => {
      g.classList.toggle('collapsed', !allCollapsed);
      const arrow = g.querySelector('.sg-toggle');
      if (arrow) arrow.textContent = !allCollapsed ? '▸' : '▾';
    });
  });
}

function initTopBarsToggle() {
  const toggle  = document.getElementById('topBarsToggle');
  const arrow   = document.getElementById('topBarsArrow');
  const targets = ['.index-bar', '.macro-section', '.sector-bar']
    .map(sel => document.querySelector(sel))
    .filter(Boolean);
  if (!toggle) return;

  let collapsed = false;
  const apply = () => {
    targets.forEach(el => el.classList.toggle('hidden', collapsed));
    if (arrow) arrow.textContent = collapsed ? '▸' : '▾';
  };

  (async () => {
    try {
      const res = await fetch('/api/db/settings/topBarsCollapsed');
      if (res.ok) collapsed = (await res.json()).value === '1';
    } catch {}
    apply();
  })();

  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    apply();
    fetch('/api/db/settings/topBarsCollapsed', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: collapsed ? '1' : '0' }),
    }).catch(() => {});
  });
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
  }, { hScroll: true });
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
  { sym: '^RUT',  label: '러셀 2000' },
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
let stocks = [];
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

  document.getElementById('dashboardBtn').addEventListener('click', () => {
    hideAllViews();
    document.getElementById('dashboardBtn').classList.add('active');
  });
  await initHeaderMenuOrder();
  initGraphView();
  initStockChartsView();
  await initStockAnalysisView();
  initMacroAnalysisView();
  await initMindmap();
  initFeedback();
  await initPortfolio();
  initIndexBar();
  initSectorBar();
  initMacroSection();
  initTopBarsToggle();
  initSectorCollapseAllBtn();
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
  }, { hScroll: true });
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
  const btn = document.getElementById('refreshBtn');
  btn.classList.remove('spinning');
  void btn.offsetWidth; // 애니메이션 재시작을 위한 리플로우 강제
  btn.classList.add('spinning');
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

async function initHeaderMenuOrder() {
  const menu = document.getElementById('headerMenu');
  if (!menu) return;

  try {
    const res = await fetch('/api/db/settings/headerMenuOrder');
    if (res.ok) {
      const saved = JSON.parse((await res.json()).value);
      // 저장된 순서에 없는 버튼(추후 새로 추가된 메뉴 등)은 원래 DOM 순서 그대로
      // 맨 뒤로 보내, 저장된 버튼들이 앞으로 당겨지며 새 버튼이 맨 앞으로 밀려나지 않게 함
      const known = new Set(saved);
      const rest = [...menu.querySelectorAll('.graph-btn')].filter(b => !known.has(b.id));
      [...saved.map(id => document.getElementById(id)).filter(Boolean), ...rest]
        .forEach(btn => menu.appendChild(btn));
    }
  } catch {}

  function saveHeaderMenuOrder() {
    const order = [...menu.querySelectorAll('.graph-btn')].map(b => b.id);
    fetch('/api/db/settings/headerMenuOrder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: JSON.stringify(order) }),
    }).catch(() => {});
  }

  let dragSrc = null;

  menu.addEventListener('dragstart', e => {
    dragSrc = e.target.closest('.graph-btn');
    if (!dragSrc) return;
    dragSrc.classList.add('gm-dragging');
    e.dataTransfer.effectAllowed = 'move';
    // 메뉴가 가로 스크롤 컨테이너라 드래그 중 가장자리 근처로 가면 브라우저가
    // 자동으로 스크롤시켜 순서를 바꾸는 도중 화면이 밀리므로, 드래그하는 동안만 잠금
    menu.classList.add('gm-drag-lock');
  });

  menu.addEventListener('dragover', e => {
    e.preventDefault();
    const target = e.target.closest('.graph-btn');
    menu.querySelectorAll('.graph-btn').forEach(b => b.classList.remove('gm-drag-over'));
    if (target && target !== dragSrc) target.classList.add('gm-drag-over');
  });

  menu.addEventListener('dragleave', e => {
    const target = e.target.closest('.graph-btn');
    if (target) target.classList.remove('gm-drag-over');
  });

  menu.addEventListener('drop', e => {
    e.preventDefault();
    const target = e.target.closest('.graph-btn');
    if (!target || !dragSrc || target === dragSrc) return;
    target.before(dragSrc);
    saveHeaderMenuOrder();
    menu.querySelectorAll('.graph-btn').forEach(b => b.classList.remove('gm-drag-over'));
  });

  menu.addEventListener('dragend', () => {
    menu.querySelectorAll('.graph-btn').forEach(b => b.classList.remove('gm-dragging', 'gm-drag-over'));
    menu.classList.remove('gm-drag-lock');
    dragSrc = null;
  });

  addTouchDrag(menu, '.graph-btn', null, (dragged, target) => {
    target.before(dragged);
    saveHeaderMenuOrder();
  }, { hScroll: true });
}

function loadIndexOrder() {
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
    fetch('/api/db/settings/indexBarOrder', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: orderJson }),
    }).catch(() => {});
    renderIndexChips();
    fetchIndexBar();
  }, { hScroll: true });
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
  await mapWithConcurrency(stocks, 6, s => fetchAndUpdateCard(s.symbol));
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
  const fairs = price ? calcFairValues(val, price, currency).filter(fv => fv.label !== 'Graham') : [];

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
  { key: '7d',  label: '7일' },
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
  const grid    = document.getElementById('grid');
  const empty   = document.getElementById('empty');
  const toolbar = document.querySelector('.grid-toolbar');

  grid.innerHTML = '';

  if (stocks.length === 0) {
    empty.style.display = '';
    if (toolbar) toolbar.classList.add('hidden');
    return;
  }
  empty.style.display = 'none';
  if (toolbar) toolbar.classList.remove('hidden');

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
    group.className = 'sector-group collapsed';
    if (etfSym) group.dataset.etf = etfSym;
    group.innerHTML = `
      <div class="sector-group-header">
        <div class="sg-left">
          <span class="sg-toggle">▸</span>
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
const HEATMAP_PERIODS = ['1D', '1W', '1M', '3M', '6M', '1Y'];
const HEATMAP_PERIOD_LABELS = { '1D': '1일', '1W': '1주', '1M': '1개월', '3M': '3개월', '6M': '6개월', '1Y': '1년' };
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
  initSectorChartToggle();
  initMacroCorrChartToggle();
  initMacroCorrHeightBtns();

  // 저장된 섹션 순서 복원 (DB 우선, fallback: localStorage)
  const view = document.getElementById('macroAnalysisView');
  async function restoreMavOrder() {
    let saved = [];
    try {
      const res = await fetch('/api/db/settings/mavSectionOrder');
      if (res.ok) saved = JSON.parse((await res.json()).value);
    } catch {}
    // (localStorage 폴백 제거 — DB만 사용)
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
    loadSectorChart();
    loadRelativeStrength();
    loadMacroCorrelationChart();
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
      // 차트 배경 구간·범례와 동일한 4단계 기준
      const [label, cls] =
        last < -0.5 ? ['심한 역전 (경기침체 임박)', 'severe']   :
        last < 0    ? ['역전 (침체 경고)',          'inverted'] :
        last < 0.5  ? ['평탄 (둔화 주의)',          'flat']     :
                      ['정상 (경기 확장)',          'normal'];
      statusEl.textContent = label;
      statusEl.className   = `yc-status-badge ${cls}`;
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
      badge.textContent = `$${last.toLocaleString('en-US', { maximumFractionDigits: 0 })}B  ${level.label}`;
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
            label: ctx => `$${ctx.parsed.y.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}B`,
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
            callback: val => `$${Number(val).toLocaleString('en-US')}B`,
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
  fetch('/api/db/settings/mindmapData', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: JSON.stringify(mmData) }),
  }).catch(() => {});
}

async function mmLoad() {
  try {
    const res = await fetch('/api/db/settings/mindmapData');
    if (res.ok) {
      const d = await res.json();
      if (d.value) mmData = JSON.parse(d.value);
    }
  } catch {}

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

const MM_INITIAL_ZOOM = 0.15;

function mmResetView() {
  const vp = document.getElementById('mmViewport');
  if (!vp) return;
  mmTx.z = MM_INITIAL_ZOOM;
  mmTx.x = vp.clientWidth  / 2 - (MM_CANVAS_SIZE / 2) * mmTx.z;
  mmTx.y = vp.clientHeight / 2 - (MM_CANVAS_SIZE / 2) * mmTx.z;
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

  if (mmDrag.type === 'reorder') {
    document.querySelector(`.mm-cat-stock[data-mm-id="${mmDrag.id}"]`)?.classList.add('mm-cs-reordering');
    mmReorderDrag(mmDrag, e.clientX, e.clientY);
    return;
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
  if (type === 'reorder' && moved) {
    mmCommitReorder(id);
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

// 분류 카드 내 종목 순서 변경 — 드래그 중엔 DOM 행 자체를 옮기기만 함(재렌더링 X).
// 카드를 통째로 다시 그리면 터치가 시작된 핸들 엘리먼트가 없어져서 이후 touchmove/touchend를
// 못 받는 문제가 있어, 드래그 중에는 원본 노드를 유지한 채 순서만 바꾸고
// 실제 mmData.stocks 반영은 드롭 시점에 mmCommitReorder에서 한 번에 처리.
function mmReorderDrag(st, clientX, clientY) {
  const dragRow = document.querySelector(`.mm-cat-stock[data-mm-id="${st.id}"]`);
  if (!dragRow) return;
  const overRow = document.elementFromPoint(clientX, clientY)?.closest('.mm-cat-stock');
  if (!overRow || overRow === dragRow) return;

  const draggedStock = mmData.stocks.find(s => s.id === st.id);
  const overStock    = mmData.stocks.find(s => s.id === overRow.dataset.mmId);
  if (!draggedStock || !overStock || draggedStock.categoryId !== overStock.categoryId) return;

  const overRect    = overRow.getBoundingClientRect();
  const insertAfter = clientY > overRect.top + overRect.height / 2;
  if (insertAfter) overRow.after(dragRow);
  else overRow.before(dragRow);
}

// 드래그가 끝난 카테고리의 실제 DOM 행 순서를 읽어 mmData.stocks에 반영하고 저장
function mmCommitReorder(stockId) {
  document.querySelector(`.mm-cat-stock[data-mm-id="${stockId}"]`)?.classList.remove('mm-cs-reordering');
  const s = mmData.stocks.find(s => s.id === stockId);
  if (!s || !s.categoryId) return;
  const body = document.querySelector(`.mm-cat-node[data-mm-id="${s.categoryId}"] .mm-cat-body`);
  if (!body) return;
  const orderedIds = [...body.querySelectorAll('.mm-cat-stock')].map(r => r.dataset.mmId);
  const byId = new Map(mmData.stocks.map(x => [x.id, x]));
  const reordered = orderedIds.map(id => byId.get(id)).filter(x => x && x.categoryId === s.categoryId);
  const rest = mmData.stocks.filter(x => x.categoryId !== s.categoryId);
  mmData.stocks = [...rest, ...reordered];
  mmSave();
}

// 백그라운드 데이터 갱신이 현재 드래그/롱프레스 중인 노드를 재렌더링해서
// (터치 대상 DOM이 사라지거나 mm-move-ready 같은 임시 클래스가 날아가는 것을 방지)
// 카드를 통째로 갈아치우기 전에, 그 카드가 지금 조작 중인지 확인
function mmIsNodeBusy(id) {
  const active = mmDrag || mmTouchSt;
  if (!active) return false;
  if (active.id === id) return true;
  const s = mmData.stocks.find(s => s.id === active.id);
  return !!(s && s.categoryId === id);
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

// 분류(카테고리) 소속 종목들의 7일 평균 수익률 — 헤더 트렌드 배지/배경에 사용
function mmCatAvgReturn(cat) {
  const vals = mmData.stocks
    .filter(s => s.categoryId === cat.id)
    .map(s => s.returns?.['7d'])
    .filter(v => v != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function mmFmtDrawdown(v) {
  if (v == null) return `<span class="mm-dd-val">—</span>`;
  if (v >= -0.05) return `<span class="mm-dd-val">고점</span>`;
  const cls = v <= -20 ? 'deep' : '';
  return `<span class="mm-dd-val ${cls}">${v.toFixed(1)}%</span>`;
}

function mmFmtRsi(v) {
  if (v == null) return `<span class="mm-rsi-val">—</span>`;
  const cls = v >= 60 ? 'overbought' : v < 50 ? 'oversold' : '';
  return `<span class="mm-rsi-val ${cls}">${v.toFixed(1)}</span>`;
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
      <div class="mm-dd-row"><span class="mm-dd-lbl">고점대비</span>${mmFmtDrawdown(stock.drawdownPct)}</div>
      <div class="mm-dd-row"><span class="mm-dd-lbl">RSI</span>${mmFmtRsi(stock.rsi)}</div>
      <div class="mm-metrics">
        <div class="mm-returns">
          <div class="mm-ret-row"><span class="mm-ret-lbl">1D</span>${mmFmtRet(r['1d'])}</div>
          <div class="mm-ret-row"><span class="mm-ret-lbl">7D</span>${mmFmtRet(r['7d'])}</div>
          <div class="mm-ret-row"><span class="mm-ret-lbl">1M</span>${mmFmtRet(r['1m'])}</div>
          <div class="mm-ret-row"><span class="mm-ret-lbl">6M</span>${mmFmtRet(r['6m'])}</div>
          <div class="mm-ret-row"><span class="mm-ret-lbl">1Y</span>${mmFmtRet(r['1y'])}</div>
        </div>
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
    const catsDesc = [...mmData.categories].reverse();
    const opts = catsDesc.map(c => c.name);
    const choice = await mmSelectDialog(`${stock.ticker}을(를) 이동할 분류 선택`, opts);
    if (choice === null) return;
    stock.categoryId = catsDesc[choice].id;
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

  const catAvgRet = mmCatAvgReturn(cat);

  div.innerHTML = `
    <div class="mm-cat-header" style="background:${heatColor(catAvgRet)}">
      <span class="mm-drag-handle mm-cat-handle">⠿</span>
      <span class="mm-cat-name" data-click-id="${cat.id}" data-click-type="cat">${cat.name}</span>
      <span class="mm-cat-trend" title="분류 평균 7일 수익률">${mmFmtRet(catAvgRet)}<span class="mm-cat-trend-lbl">7d</span></span>
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
        <span class="mm-cs-ret"><span class="mm-cs-ret-lbl">고점대비</span>${mmFmtDrawdown(s.drawdownPct)}</span>
        <span class="mm-cs-ret"><span class="mm-cs-ret-lbl">RSI</span>${mmFmtRsi(s.rsi)}</span>
        <span class="mm-cs-ret"><span class="mm-cs-ret-lbl">1D</span>${mmFmtRet(r['1d'])}</span>
        <span class="mm-cs-ret"><span class="mm-cs-ret-lbl">7D</span>${mmFmtRet(r['7d'])}</span>
        <span class="mm-cs-ret"><span class="mm-cs-ret-lbl">1M</span>${mmFmtRet(r['1m'])}</span>
        <span class="mm-cs-ret"><span class="mm-cs-ret-lbl">6M</span>${mmFmtRet(r['6m'])}</span>
        <span class="mm-cs-ret"><span class="mm-cs-ret-lbl">1Y</span>${mmFmtRet(r['1y'])}</span>
      </div>
      <div class="mm-cs-actions">
        <span class="mm-cs-drag-handle" title="순서 변경">⠿</span>
        <button class="mm-cs-move-btn" title="분류 변경">↔</button>
        <button class="mm-cs-del-btn mm-del-btn" data-del-id="${s.id}" data-del-type="stock" title="제거">×</button>
      </div>`;

    // Move to different category / standalone
    sEl.querySelector('.mm-cs-move-btn').addEventListener('click', async e => {
      e.stopPropagation();
      const otherCatsDesc = [...mmData.categories].reverse().filter(c => c.id !== cat.id);
      const opts = ['(단독 배치)', ...otherCatsDesc.map(c => c.name)];
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
        s.categoryId = otherCatsDesc[choice - 1].id;
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

  const cats = [...mmData.categories].reverse();
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
    const [perfResult, priceResult, athResult] = await Promise.allSettled([
      fetchPerformance(symbol),
      fetchPrice(symbol),
      fetch(`/api/ath/${encodeURIComponent(symbol)}`).then(r => r.ok ? r.json() : {}),
    ]);
    const s = mmData.stocks.find(s => s.id === stockId);
    if (!s) return;
    const perf  = perfResult.status  === 'fulfilled' ? perfResult.value  : {};
    const price = priceResult.status === 'fulfilled' ? priceResult.value : {};
    const ath   = athResult.status    === 'fulfilled' ? athResult.value   : {};
    s.returns = {
      '1d': price.change_pct ?? null,   // /api/price 의 change_pct 사용
      '7d': perf['5d']   ?? null,
      '1m': perf['1mo']  ?? null,
      '6m': perf['6mo']  ?? null,
      '1y': perf['1y']   ?? null,
    };
    // ath 요청이 실패(네트워크 오류·일시적 5xx)하면 응답이 {}로 대체되는데,
    // 그때 기존에 정상 조회됐던 값을 null로 덮어쓰지 않도록 필드 존재 여부로 판단.
    if ('drawdown_pct' in ath) s.drawdownPct = ath.drawdown_pct;
    else if (s.drawdownPct === undefined) s.drawdownPct = null;
    if ('rsi' in ath) s.rsi = ath.rsi;
    else if (s.rsi === undefined) s.rsi = null;
    mmSave();
    // Re-render the affected element — 단, 지금 드래그/롱프레스 중인 카드라면
    // 건드리지 않음 (재렌더링하면 터치 대상 DOM이 사라져 제스처가 끊김)
    const canvas = document.getElementById('mmCanvas');
    if (!canvas) return;
    const old = canvas.querySelector(`[data-mm-id="${stockId}"]`);
    if (!old) return;
    if (s.categoryId) {
      if (mmIsNodeBusy(s.categoryId)) return;
      const catEl = canvas.querySelector(`[data-mm-id="${s.categoryId}"]`);
      const cat   = mmData.categories.find(c => c.id === s.categoryId);
      if (catEl && cat) catEl.replaceWith(mmMakeCatEl(cat));
    } else {
      if (mmIsNodeBusy(stockId)) return;
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

// ── 마인드맵 열릴 때마다 모든 종목 수익률 새로 갱신 ─────────────

async function mmRefreshAllReturns() {
  const stocks = mmData.stocks;
  const limit = 3; // 동시 요청 수 제한
  for (let i = 0; i < stocks.length; i += limit) {
    await Promise.allSettled(stocks.slice(i, i + limit).map(s => mmFetchReturns(s.id, s.ticker)));
  }
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

  // 안드로이드 등에서 길게 누르면 뜨는 기본 컨텍스트 메뉴가 2초 홀드 제스처를
  // 가로채는 것을 방지 (카드/노드 위에서만 차단)
  vp.addEventListener('contextmenu', e => {
    if (e.target.closest('.mm-node, .mm-cat-node')) e.preventDefault();
  });

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

    // 분류 카드 내 종목 순서 변경 핸들
    const reorderHandle = el.closest('.mm-cs-drag-handle');
    if (reorderHandle) {
      const row = reorderHandle.closest('.mm-cat-stock');
      const s = mmData.stocks.find(s => s.id === row?.dataset.mmId);
      if (!s) return;
      e.preventDefault();
      mmTouchSt = { type: 'reorder', id: s.id, sx: touch.clientX, sy: touch.clientY, moved: false };
      return;
    }

    // Whole node/category → drag, long-press connect, or tap
    const nodeEl = el.closest('.mm-node, .mm-cat-node');
    if (nodeEl) {
      const mmId  = nodeEl.dataset.mmId;
      const isCat = nodeEl.classList.contains('mm-cat-node');
      if (isCat && el.closest('.mm-cs-info')) return;
      const type = isCat ? 'cat' : 'stock';
      // 카드를 옮길 땐 반드시 드래그 핸들(⠿)을 잡아야 함 — 그 외 카드 영역은
      // 화면 이동(pan) 제스처로 처리해서, 모바일에서 화면을 스와이프하다가
      // 카드가 화면 대부분을 차지해 실수로 카드째로 끌려가는 것을 방지
      const onHandle = !!el.closest('.mm-drag-handle');

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

      if (onHandle) {
        // 핸들을 잡은 경우: 기존과 동일 — 즉시 이동 가능, 600ms 유지 시 연결모드
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
      } else {
        // 카드 몸통을 잡은 경우: 처음엔 화면 이동(pan) 후보로 시작하고,
        // 0.3초간 움직이지 않고 누르고 있으면 카드를 옮길 수 있는 상태로 전환
        // (작은 핸들 아이콘을 정확히 터치하기 어려운 문제 보완)
        mmTouchSt = { type: 'pan', sx: touch.clientX, sy: touch.clientY,
          ox: mmTx.x, oy: mmTx.y, moved: false, tapEl: el };

        mmLongPressTimer = setTimeout(() => {
          mmLongPressTimer = null;
          if (!mmTouchSt || mmTouchSt.moved) return; // 이미 스와이프(화면 이동) 중이면 무시
          mmTouchSt = { type: 'node', dragType: type, id: mmId,
            sx: touch.clientX, sy: touch.clientY,
            ox: node.position.x, oy: node.position.y,
            moved: false, tapEl: el };
          if (navigator.vibrate) navigator.vibrate(25);
          nodeEl.classList.add('mm-move-ready');
        }, 300);
      }
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
      // tapEl이 있는(카드 위에서 시작한) pan은 살짝 움직임 유예를 둬서
      // 단순 탭과 스와이프(화면 이동)를 구분.
      // 임계값을 넉넉히 잡아서 2초 홀드 도중 손가락이 미세하게 떨리는 정도로는
      // 화면 이동으로 오인해 홀드(이동 가능 상태 전환) 타이머가 취소되지 않게 함
      if (mmTouchSt.tapEl && !mmTouchSt.moved) {
        if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;
        mmTouchSt.moved = true;
        clearTimeout(mmLongPressTimer); mmLongPressTimer = null;
      }
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
    } else if (mmTouchSt.type === 'reorder') {
      if (!mmTouchSt.moved) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        mmTouchSt.moved = true;
      }
      e.preventDefault();
      document.querySelector(`.mm-cat-stock[data-mm-id="${mmTouchSt.id}"]`)?.classList.add('mm-cs-reordering');
      mmReorderDrag(mmTouchSt, touch.clientX, touch.clientY);
    }
  }, { passive: false });

  vp.addEventListener('touchend', e => {
    clearTimeout(mmLongPressTimer); mmLongPressTimer = null;
    document.querySelectorAll('.mm-drop-target').forEach(e => e.classList.remove('mm-drop-target'));
    document.querySelectorAll('.mm-move-ready').forEach(e => e.classList.remove('mm-move-ready'));
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
    } else if (st.type === 'reorder' && st.moved) {
      mmCommitReorder(st.id);
    } else if ((st.type === 'node' || st.type === 'pan') && !st.moved && st.tapEl) {
      // Short tap (핸들이 아닌 카드 위 pan-대기 상태 포함) — 눌린 요소에 따라 동작 분기
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
    document.querySelectorAll('.mm-move-ready').forEach(e => e.classList.remove('mm-move-ready'));
    mmTouchSt = null;
  }, { passive: true });
}

// ── Init ──────────────────────────────────────────────────────

async function initMindmap() {
  await mmLoad();

  document.getElementById('mmBackBtn').addEventListener('click', hideAllViews);
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

    const reorderHandle = e.target.closest('.mm-cs-drag-handle');
    if (reorderHandle) {
      const row = reorderHandle.closest('.mm-cat-stock');
      const s = mmData.stocks.find(s => s.id === row?.dataset.mmId);
      if (!s) return;
      e.preventDefault();
      mmDrag = { type: 'reorder', id: s.id, sx: e.clientX, sy: e.clientY, moved: false };
      return;
    }

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

// ─── 피드백 게시판 ──────────────────────────────────────────
let feedbackList = [];
let feedbackFilter = 'all';

function fbEscape(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

async function fbLoad() {
  try {
    const res = await fetch('/api/feedback');
    if (res.ok) feedbackList = await res.json();
  } catch {}
  fbRender();
}

function fbRender() {
  const list = document.getElementById('fbList');
  if (!list) return;
  const filtered = feedbackList.filter(f => feedbackFilter === 'all' || f.status === feedbackFilter);
  if (filtered.length === 0) {
    list.innerHTML = '<div class="fb-empty">등록된 피드백이 없습니다.</div>';
    return;
  }
  list.innerHTML = filtered.map(f => `
    <div class="fb-item ${f.status}" data-id="${f.id}">
      <div class="fb-item-main">
        <span class="fb-status-badge ${f.status}">${f.status === 'done' ? '완료' : '미완료'}</span>
        <p class="fb-content">${fbEscape(f.content)}</p>
      </div>
      <div class="fb-item-side">
        <span class="fb-date">${f.created_at.slice(0, 16).replace('T', ' ')}</span>
        <button class="fb-toggle-btn" data-id="${f.id}" data-status="${f.status}">
          ${f.status === 'done' ? '미완료로 되돌리기' : '완료 처리'}
        </button>
        <button class="fb-del-btn" data-id="${f.id}" title="삭제">✕</button>
      </div>
    </div>
  `).join('');
}

function initFeedback() {
  document.getElementById('feedbackBackBtn').addEventListener('click', hideAllViews);
  document.getElementById('feedbackBtn').addEventListener('click', () => {
    const showing = !document.getElementById('feedbackView').classList.contains('hidden');
    hideAllViews();
    if (!showing) {
      document.querySelector('main').classList.add('hidden');
      document.getElementById('feedbackView').classList.remove('hidden');
      document.getElementById('feedbackBtn').classList.add('active');
      fbLoad();
    }
  });


  document.getElementById('fbSubmitBtn').addEventListener('click', async () => {
    const input = document.getElementById('fbInput');
    const content = input.value.trim();
    if (!content) return;
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        const created = await res.json();
        feedbackList.unshift(created);
        input.value = '';
        fbRender();
      }
    } catch {}
  });

  document.querySelectorAll('.fb-fbtn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.fb-fbtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      feedbackFilter = btn.dataset.f;
      fbRender();
    });
  });

  document.getElementById('fbList').addEventListener('click', async e => {
    const toggleBtn = e.target.closest('.fb-toggle-btn');
    const delBtn = e.target.closest('.fb-del-btn');

    if (toggleBtn) {
      const id = Number(toggleBtn.dataset.id);
      const newStatus = toggleBtn.dataset.status === 'done' ? 'pending' : 'done';
      try {
        const res = await fetch(`/api/feedback/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
        if (res.ok) {
          const item = feedbackList.find(f => f.id === id);
          if (item) item.status = newStatus;
          fbRender();
        }
      } catch {}
    } else if (delBtn) {
      const id = Number(delBtn.dataset.id);
      if (!confirm('이 피드백을 삭제할까요?')) return;
      try {
        const res = await fetch(`/api/feedback/${id}`, { method: 'DELETE' });
        if (res.ok) {
          feedbackList = feedbackList.filter(f => f.id !== id);
          fbRender();
        }
      } catch {}
    }
  });
}

// ============================================================
//  자 산 포 트 폴 리 오
// ============================================================
// 토스증권 등 증권사 공식 오픈API가 없어(개인 대상 미제공) 보유 종목을
// 사용자가 직접 입력하는 방식으로 구현. 종목당 1행(수량·평균매입가)으로
// 관리하며, 현재가는 기존 /api/price를 재사용해 매번 새로 조회한다.
// 원화·달러 종목이 섞여도 비중을 비교할 수 있도록 usdKrwRate로 전부
// 원화 환산해 합산한다.
let pfHoldings = [];        // [{symbol, name, currency, quantity, avg_price, updated_at}]
let pfEnriched = [];        // pfHoldings + 현재가·평가금액 등 파생값
let pfEditingSymbol = null; // 수정 중인 종목(null이면 추가 모드)
let pfSelected = null;      // 검색에서 고른 종목 {symbol, name, currency, currentPrice}
let pfChart = null;
let pfCashItems = [];       // [{id, label, currency, amount, updated_at}] — 항목별로 분류 입력
let pfCashEditingId = null; // 수정 중인 현금 항목 id(null이면 추가 모드)

function pfEscape(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

async function initPortfolio() {
  document.getElementById('portfolioBackBtn').addEventListener('click', hideAllViews);
  document.getElementById('portfolioBtn').addEventListener('click', () => {
    const showing = !document.getElementById('portfolioView').classList.contains('hidden');
    hideAllViews();
    if (!showing) {
      document.querySelector('main').classList.add('hidden');
      document.getElementById('portfolioView').classList.remove('hidden');
      document.getElementById('portfolioBtn').classList.add('active');
      loadPortfolioData();
    }
  });

  // ── 종목 검색 ──
  const searchInput = document.getElementById('pfSearchInput');
  const dropdown = document.getElementById('pfSearchDropdown');
  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = searchInput.value.trim();
    if (!q) { dropdown.classList.add('hidden'); return; }
    debounce = setTimeout(() => pfDoSearch(q), 300);
  });
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { dropdown.classList.add('hidden'); searchInput.value = ''; }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.pf-search-wrap')) dropdown.classList.add('hidden');
  });

  // ── 현금성 자산 (항목별 분류 입력) ──
  document.getElementById('pfCashLabelInput').addEventListener('input', pfUpdateCashSubmitEnabled);
  document.getElementById('pfCashAmountInput').addEventListener('input', pfUpdateCashSubmitEnabled);
  document.getElementById('pfCashSubmitBtn').addEventListener('click', pfCashSubmit);
  document.getElementById('pfCashCancelEditBtn').addEventListener('click', pfCashResetForm);

  // ── 수량/매입단가 입력 → 등록 버튼 활성화 ──
  document.getElementById('pfQtyInput').addEventListener('input', pfUpdateSubmitEnabled);
  document.getElementById('pfPriceInput').addEventListener('input', pfUpdateSubmitEnabled);

  // ── 등록/수정 저장 ──
  document.getElementById('pfSubmitBtn').addEventListener('click', pfSubmit);
  document.getElementById('pfCancelEditBtn').addEventListener('click', pfResetForm);

  // ── 표: 종목·현금 공통 수정/삭제 버튼 (한 표에 같이 표시되므로 위임 하나로 처리) ──
  document.getElementById('pfTableWrap').addEventListener('click', e => {
    const editBtn = e.target.closest('.pf-edit-btn');
    const delBtn = e.target.closest('.pf-del-btn');
    const cashEditBtn = e.target.closest('.pf-cash-edit-btn');
    const cashDelBtn = e.target.closest('.pf-cash-del-btn');
    if (editBtn) pfStartEdit(editBtn.dataset.symbol);
    else if (delBtn) pfDelete(delBtn.dataset.symbol);
    else if (cashEditBtn) pfCashStartEdit(Number(cashEditBtn.dataset.id));
    else if (cashDelBtn) pfCashDelete(Number(cashDelBtn.dataset.id));
  });

  // ── 보유종목에서 가져오기 ──
  document.getElementById('pfImportToggleBtn').addEventListener('click', pfToggleImportPanel);
  document.getElementById('pfImportList').addEventListener('input', e => {
    if (e.target.classList.contains('pf-import-qty')) pfUpdateImportSubmitEnabled();
  });
  document.getElementById('pfImportSubmitBtn').addEventListener('click', pfImportSubmit);
}

// ── 보유종목(대시보드 stocks 테이블)에서 자산 포트폴리오로 일괄 추가 ──
// 보유종목 메뉴는 종목·통화 정보만 갖고 있어 수량·매입단가가 없으므로,
// 이미 포트폴리오에 있는 종목은 목록에서 빼고 나머지만 보여준 뒤
// 사용자가 종목별로 수량(필수)·매입단가(현재가로 기본값 제공, 수정 가능)를
// 채운 행만 골라 기존 POST /api/portfolio(추가 API)를 반복 호출해 한 번에 등록한다.
let pfImportPriceMap = {}; // symbol -> 현재가(매입단가 기본값 + 통화 확인용)

function pfToggleImportPanel() {
  const panel = document.getElementById('pfImportPanel');
  const btn = document.getElementById('pfImportToggleBtn');
  const opening = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !opening);
  btn.textContent = opening ? '접기 ▴' : '펼치기 ▾';
  if (opening) pfBuildImportList();
}

async function pfBuildImportList() {
  const list = document.getElementById('pfImportList');
  pfImportPriceMap = {};
  const importable = stocks.filter(s => !pfHoldings.some(h => h.symbol === s.symbol));

  if (!stocks.length) {
    list.innerHTML = '<div class="pf-import-empty">보유종목 메뉴에 추가된 종목이 없습니다.</div>';
    document.getElementById('pfImportSubmitBtn').disabled = true;
    return;
  }
  if (!importable.length) {
    list.innerHTML = '<div class="pf-import-empty">보유종목이 모두 이미 포트폴리오에 있습니다.</div>';
    document.getElementById('pfImportSubmitBtn').disabled = true;
    return;
  }

  list.innerHTML = importable.map(s => `
    <div class="pf-import-row" data-symbol="${s.symbol}" data-name="${pfEscape(s.name)}" data-currency="${s.currency}">
      <div class="sa-name-main pf-import-name">
        <span class="sa-name-company" title="${pfEscape(s.name)}">${pfEscape(saShortName(s.name) || s.symbol)}</span>
        <span class="sa-name-ticker">${s.symbol}</span>
      </div>
      <input type="number" class="pf-import-qty" min="0" step="any" placeholder="수량" inputmode="decimal" />
      <input type="number" class="pf-import-price" min="0" step="any" placeholder="매입단가 (현재가 조회 중...)" inputmode="decimal" />
    </div>
  `).join('');
  pfUpdateImportSubmitEnabled();

  const priceResults = await Promise.allSettled(
    importable.map(s => fetch(`/api/price/${encodeURIComponent(s.symbol)}`).then(r => r.ok ? r.json() : null))
  );
  importable.forEach((s, i) => {
    const pr = priceResults[i].status === 'fulfilled' ? priceResults[i].value : null;
    const row = list.querySelector(`.pf-import-row[data-symbol="${CSS.escape(s.symbol)}"]`);
    if (!row) return;
    const priceInput = row.querySelector('.pf-import-price');
    if (pr && pr.price != null) {
      pfImportPriceMap[s.symbol] = { price: pr.price, currency: pr.currency };
      row.dataset.currency = pr.currency;
      priceInput.value = pr.price;
      priceInput.placeholder = '매입단가';
    } else {
      priceInput.placeholder = '매입단가 (현재가 조회 실패)';
    }
  });
}

function pfUpdateImportSubmitEnabled() {
  const rows = document.querySelectorAll('#pfImportList .pf-import-row');
  const any = [...rows].some(r => parseFloat(r.querySelector('.pf-import-qty').value) > 0);
  document.getElementById('pfImportSubmitBtn').disabled = !any;
}

async function pfImportSubmit() {
  const rows = [...document.querySelectorAll('#pfImportList .pf-import-row')];
  const targets = rows.map(r => {
    const qty = parseFloat(r.querySelector('.pf-import-qty').value);
    let price = parseFloat(r.querySelector('.pf-import-price').value);
    if (!(price > 0)) price = pfImportPriceMap[r.dataset.symbol]?.price;
    return { symbol: r.dataset.symbol, name: r.dataset.name, currency: r.dataset.currency, qty, price };
  }).filter(t => t.qty > 0);

  if (!targets.length) return;
  const skipped = targets.filter(t => !(t.price > 0));
  const ready = targets.filter(t => t.price > 0);
  if (!ready.length) {
    alert('매입단가를 확인할 수 없습니다. 직접 입력해주세요.');
    return;
  }

  const btn = document.getElementById('pfImportSubmitBtn');
  btn.disabled = true;
  const results = await Promise.allSettled(ready.map(t => fetch('/api/portfolio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: t.symbol, name: t.name, currency: t.currency, quantity: t.qty, avg_price: t.price }),
  })));
  const failCount = results.filter(r => r.status === 'rejected' || !r.value.ok).length;
  const okCount = ready.length - failCount;

  await loadPortfolioData();
  document.getElementById('pfImportPanel').classList.add('hidden');
  document.getElementById('pfImportToggleBtn').textContent = '펼치기 ▾';

  let msg = `${okCount}개 종목을 포트폴리오에 추가했습니다.`;
  if (skipped.length) msg += `\n매입단가 미입력으로 ${skipped.length}개는 제외됐습니다.`;
  if (failCount) msg += `\n${failCount}개는 저장에 실패했습니다.`;
  alert(msg);
}

async function pfDoSearch(q) {
  const dropdown = document.getElementById('pfSearchDropdown');
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
        pfSelectStock(el.dataset.symbol, el.dataset.name);
        document.getElementById('pfSearchInput').value = '';
        dropdown.classList.add('hidden');
      });
    });
  } catch {
    dropdown.innerHTML = '<div class="dd-msg" style="color:#ff4655">검색 실패</div>';
  }
}

async function pfSelectStock(symbol, name) {
  pfSelected = { symbol, name, currency: 'USD', currentPrice: null };
  pfRenderSelectedChip();
  pfUpdateSubmitEnabled();
  try {
    const res = await fetch(`/api/price/${encodeURIComponent(symbol)}`);
    if (res.ok) {
      const d = await res.json();
      if (pfSelected && pfSelected.symbol === symbol) {
        pfSelected.currency = d.currency;
        pfSelected.currentPrice = d.price;
        pfRenderSelectedChip();
      }
    }
  } catch {}
}

function pfRenderSelectedChip() {
  const chip = document.getElementById('pfSelectedChip');
  if (!pfSelected) { chip.classList.add('hidden'); chip.innerHTML = ''; return; }
  const priceHint = pfSelected.currentPrice != null
    ? `현재가 ${formatPrice(pfSelected.currentPrice, pfSelected.currency)}`
    : '현재가 조회 중...';
  chip.classList.remove('hidden');
  chip.innerHTML = `
    <span class="pf-chip-symbol">${pfEscape(pfSelected.symbol)}</span>
    <span class="pf-chip-name">${pfEscape(pfSelected.name)}</span>
    <span class="pf-chip-hint">${priceHint}</span>
    ${pfEditingSymbol ? '' : '<button type="button" class="pf-chip-x" id="pfChipClearBtn">✕</button>'}
  `;
  const clearBtn = document.getElementById('pfChipClearBtn');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    pfSelected = null;
    pfRenderSelectedChip();
    pfUpdateSubmitEnabled();
  });
}

function pfUpdateSubmitEnabled() {
  const qty = parseFloat(document.getElementById('pfQtyInput').value);
  const price = parseFloat(document.getElementById('pfPriceInput').value);
  const ok = !!pfSelected && qty > 0 && price > 0;
  document.getElementById('pfSubmitBtn').disabled = !ok;
}

function pfStartEdit(symbol) {
  const h = pfHoldings.find(x => x.symbol === symbol);
  if (!h) return;
  pfEditingSymbol = symbol;
  pfSelected = { symbol: h.symbol, name: h.name, currency: h.currency, currentPrice: null };
  document.getElementById('pfQtyInput').value = h.quantity;
  document.getElementById('pfPriceInput').value = h.avg_price;
  document.getElementById('pfSearchInput').value = '';
  document.getElementById('pfSearchInput').disabled = true;
  document.getElementById('pfSubmitBtn').textContent = '수정 저장';
  document.getElementById('pfCancelEditBtn').classList.remove('hidden');
  pfRenderSelectedChip();
  pfUpdateSubmitEnabled();
  document.getElementById('pfQtyInput').focus();
  document.querySelector('.pf-form-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function pfResetForm() {
  pfEditingSymbol = null;
  pfSelected = null;
  document.getElementById('pfQtyInput').value = '';
  document.getElementById('pfPriceInput').value = '';
  document.getElementById('pfSearchInput').disabled = false;
  document.getElementById('pfSubmitBtn').textContent = '추가';
  document.getElementById('pfCancelEditBtn').classList.add('hidden');
  pfRenderSelectedChip();
  pfUpdateSubmitEnabled();
}

async function pfSubmit() {
  if (!pfSelected) return;
  const qty = parseFloat(document.getElementById('pfQtyInput').value);
  const price = parseFloat(document.getElementById('pfPriceInput').value);
  if (!(qty > 0) || !(price > 0)) return;
  const btn = document.getElementById('pfSubmitBtn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/portfolio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: pfSelected.symbol,
        name: pfSelected.name,
        currency: pfSelected.currency,
        quantity: qty,
        avg_price: price,
      }),
    });
    if (res.ok) {
      pfResetForm();
      await loadPortfolioData();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || '저장에 실패했습니다.');
      btn.disabled = false;
    }
  } catch {
    alert('저장에 실패했습니다.');
    btn.disabled = false;
  }
}

async function pfDelete(symbol) {
  if (!confirm(`${symbol} 보유내역을 삭제할까요?`)) return;
  try {
    const res = await fetch(`/api/portfolio/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
    if (res.ok) {
      if (pfEditingSymbol === symbol) pfResetForm();
      await loadPortfolioData();
    }
  } catch {}
}

async function loadPortfolioData() {
  const wrap = document.getElementById('pfTableWrap');
  try {
    const res = await fetch('/api/portfolio');
    if (!res.ok) throw new Error('load failed');
    pfHoldings = await res.json();
  } catch {
    wrap.innerHTML = '<div class="sa-error-state">데이터를 불러오지 못했습니다.<br>잠시 후 다시 시도해 주세요.</div>';
    return;
  }

  try {
    const cashRes = await fetch('/api/portfolio/cash');
    if (cashRes.ok) pfCashItems = await cashRes.json();
  } catch {}

  if (usdKrwRate == null) await fetchUsdKrw();

  if (!pfHoldings.length) {
    pfEnriched = [];
    pfRenderAll();
    return;
  }

  wrap.innerHTML = '<div class="yc-loading">로딩 중...</div>';

  const priceResults = await Promise.allSettled(
    pfHoldings.map(h => fetch(`/api/price/${encodeURIComponent(h.symbol)}`).then(r => r.ok ? r.json() : null))
  );

  pfEnriched = pfHoldings.map((h, i) => {
    const pr = priceResults[i].status === 'fulfilled' ? priceResults[i].value : null;
    const priceOk = pr && pr.price != null;
    const currentPrice = priceOk ? pr.price : h.avg_price; // 조회 실패 시 매입가로 근사(배지로 표시)
    const changePct = priceOk ? pr.change_pct : null;
    const marketValue = h.quantity * currentPrice;
    const costBasis = h.quantity * h.avg_price;
    const pnl = marketValue - costBasis;
    const pnlPct = costBasis ? (pnl / costBasis) * 100 : null;
    const fx = h.currency === 'KRW' ? 1 : (usdKrwRate || 0);
    return {
      ...h, currentPrice, changePct, priceStale: !priceOk,
      marketValue, costBasis, pnl, pnlPct,
      marketValueKrw: marketValue * fx, costBasisKrw: costBasis * fx,
    };
  });

  pfRenderAll();
}

function pfPctHTML(v, digits = 1) {
  if (v == null) return '<span class="sa-td-empty">—</span>';
  const cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
  return `<span class="sa-td ${cls}">${v >= 0 ? '+' : ''}${v.toFixed(digits)}%</span>`;
}

function pfRenderAll() {
  // 현금은 항목(라벨)별로 따로 입력받지만, 총자산 계산과 비중 차트에서는
  // 통화 환산 후 합계 하나로만 취급한다 — 항목 구분은 카드의 목록에서만 보여줌.
  const cashKrw = pfCashItems.reduce((s, c) => s + c.amount * (c.currency === 'KRW' ? 1 : (usdKrwRate || 0)), 0);

  const stockValueKrw = pfEnriched.reduce((s, r) => s + r.marketValueKrw, 0);
  const stockCostKrw = pfEnriched.reduce((s, r) => s + r.costBasisKrw, 0);
  const totalAssetKrw = stockValueKrw + cashKrw;
  const totalPnlKrw = stockValueKrw - stockCostKrw;
  const totalPnlPct = stockCostKrw ? (totalPnlKrw / stockCostKrw) * 100 : null;

  pfRenderKpi(totalAssetKrw, stockValueKrw, cashKrw, totalPnlKrw, totalPnlPct);
  pfRenderTable(totalAssetKrw);
  pfRenderChart(totalAssetKrw, cashKrw);

  document.getElementById('pfAsOf').textContent =
    pfHoldings.length ? `기준 ${new Date().toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}` : '';
}

function pfUpdateCashSubmitEnabled() {
  const label = document.getElementById('pfCashLabelInput').value.trim();
  const amount = parseFloat(document.getElementById('pfCashAmountInput').value);
  document.getElementById('pfCashSubmitBtn').disabled = !(label && amount > 0);
}

function pfCashStartEdit(id) {
  const c = pfCashItems.find(x => x.id === id);
  if (!c) return;
  pfCashEditingId = id;
  document.getElementById('pfCashLabelInput').value = c.label;
  document.getElementById('pfCashCurrencySelect').value = c.currency;
  document.getElementById('pfCashAmountInput').value = c.amount;
  document.getElementById('pfCashSubmitBtn').textContent = '수정 저장';
  document.getElementById('pfCashCancelEditBtn').classList.remove('hidden');
  pfUpdateCashSubmitEnabled();
  document.getElementById('pfCashLabelInput').focus();
}

function pfCashResetForm() {
  pfCashEditingId = null;
  document.getElementById('pfCashLabelInput').value = '';
  document.getElementById('pfCashCurrencySelect').value = 'KRW';
  document.getElementById('pfCashAmountInput').value = '';
  document.getElementById('pfCashSubmitBtn').textContent = '추가';
  document.getElementById('pfCashCancelEditBtn').classList.add('hidden');
  pfUpdateCashSubmitEnabled();
}

async function pfCashSubmit() {
  const label = document.getElementById('pfCashLabelInput').value.trim();
  const currency = document.getElementById('pfCashCurrencySelect').value;
  const amount = parseFloat(document.getElementById('pfCashAmountInput').value);
  if (!label || !(amount > 0)) return;
  const btn = document.getElementById('pfCashSubmitBtn');
  btn.disabled = true;
  try {
    const url = pfCashEditingId ? `/api/portfolio/cash/${pfCashEditingId}` : '/api/portfolio/cash';
    const res = await fetch(url, {
      method: pfCashEditingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, currency, amount }),
    });
    if (res.ok) {
      pfCashResetForm();
      await loadPortfolioData();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || '저장에 실패했습니다.');
      btn.disabled = false;
    }
  } catch {
    alert('저장에 실패했습니다.');
    btn.disabled = false;
  }
}

async function pfCashDelete(id) {
  if (!confirm('이 현금성 자산 항목을 삭제할까요?')) return;
  try {
    const res = await fetch(`/api/portfolio/cash/${id}`, { method: 'DELETE' });
    if (res.ok) {
      if (pfCashEditingId === id) pfCashResetForm();
      await loadPortfolioData();
    }
  } catch {}
}

function pfRenderKpi(totalAssetKrw, stockValueKrw, cashKrw, totalPnlKrw, totalPnlPct) {
  const el = document.getElementById('pfKpiRow');
  const fmtKrw = v => '₩' + Math.round(v).toLocaleString('ko-KR');
  const pnlCls = totalPnlKrw > 0 ? 'up' : totalPnlKrw < 0 ? 'down' : 'flat';
  const cards = [
    ['총 자산(원화 환산)', fmtKrw(totalAssetKrw), ''],
    ['주식 평가금액', fmtKrw(stockValueKrw), ''],
    ['현금성 자산', fmtKrw(cashKrw), ''],
    ['평가손익', pfHoldings.length ? `${totalPnlKrw >= 0 ? '+' : ''}${fmtKrw(totalPnlKrw)}` : '—', pfHoldings.length ? pnlCls : ''],
    ['수익률', totalPnlPct != null ? `${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(1)}%` : '—', totalPnlPct != null ? pnlCls : ''],
    ['보유 종목', `${pfHoldings.length}개`, ''],
  ];
  el.innerHTML = cards.map(([label, value, cls]) => `
    <div class="sa-kpi-card">
      <div class="sa-kpi-label">${label}</div>
      <div class="sa-kpi-value ${cls}">${value}</div>
    </div>`).join('');
}

// 보유 종목과 현금성 자산을 한 표에 같이 보여준다. 자산군이 달라 컬럼 의미가
// 안 맞는 칸(현금의 수량·매입단가·현재가·평가손익)은 "—"로 비워두고,
// 평가금액(원화 환산 기준 비중)만 공통 기준으로 나란히 비교할 수 있게 한다.
function pfRenderTable(totalAssetKrw) {
  const wrap = document.getElementById('pfTableWrap');
  if (!pfHoldings.length && !pfCashItems.length) {
    wrap.innerHTML = '<div class="sa-empty-state">보유 종목이나 현금성 자산이 없습니다.<br>위에서 종목을 검색해 추가하거나 현금성 자산을 등록해보세요.</div>';
    return;
  }

  const stockRows = pfEnriched.map(r => ({ valueKrw: r.marketValueKrw, html: pfStockRowHTML(r, totalAssetKrw) }));
  const cashRows = pfCashItems.map(c => {
    const valueKrw = c.amount * (c.currency === 'KRW' ? 1 : (usdKrwRate || 0));
    return { valueKrw, html: pfCashRowHTML(c, valueKrw, totalAssetKrw) };
  });
  const rows = [...stockRows, ...cashRows].sort((a, b) => b.valueKrw - a.valueKrw);

  wrap.innerHTML = `
    <table class="sa-table pf-table">
      <thead>
        <tr>
          <th class="sa-th-name">종목 / 자산</th>
          <th>수량</th>
          <th>매입단가</th>
          <th>현재가</th>
          <th>평가금액</th>
          <th>비중</th>
          <th>평가손익</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => r.html).join('')}
      </tbody>
    </table>`;
}

function pfStockRowHTML(r, totalAssetKrw) {
  return `
    <tr data-symbol="${r.symbol}">
      <td class="sa-td-name">
        <div class="sa-name-main">
          <span class="sa-name-company" title="${pfEscape(r.name)}">${pfEscape(saShortName(r.name) || r.symbol)}</span>
          <span class="sa-name-ticker">${r.symbol}</span>
        </div>
      </td>
      <td>${r.quantity.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}</td>
      <td>${formatPrice(r.avg_price, r.currency)}</td>
      <td>${formatPrice(r.currentPrice, r.currency)}${r.priceStale ? '<span class="sa-upside-flag" title="현재가 조회에 실패해 매입단가로 대체 표시했습니다.">조회실패</span>' : ''}</td>
      <td>${formatPrice(r.marketValue, r.currency)}</td>
      <td>${totalAssetKrw ? (r.marketValueKrw / totalAssetKrw * 100).toFixed(1) + '%' : '—'}</td>
      <td>${pfPctHTML(r.pnlPct)}</td>
      <td class="pf-td-actions">
        <button type="button" class="pf-edit-btn" data-symbol="${r.symbol}" title="수정">✎</button>
        <button type="button" class="pf-del-btn" data-symbol="${r.symbol}" title="삭제">✕</button>
      </td>
    </tr>`;
}

function pfCashRowHTML(c, valueKrw, totalAssetKrw) {
  return `
    <tr data-cash-id="${c.id}">
      <td class="sa-td-name">
        <div class="sa-name-main">
          <span class="sa-name-company">${pfEscape(c.label)}</span>
          <span class="pf-cash-tag">현금</span>
        </div>
      </td>
      <td class="sa-td-empty">—</td>
      <td class="sa-td-empty">—</td>
      <td class="sa-td-empty">—</td>
      <td>${formatPrice(c.amount, c.currency)}</td>
      <td>${totalAssetKrw ? (valueKrw / totalAssetKrw * 100).toFixed(1) + '%' : '—'}</td>
      <td class="sa-td-empty">—</td>
      <td class="pf-td-actions">
        <button type="button" class="pf-cash-edit-btn" data-id="${c.id}" title="수정">✎</button>
        <button type="button" class="pf-cash-del-btn" data-id="${c.id}" title="삭제">✕</button>
      </td>
    </tr>`;
}

// 슬라이스가 너무 많으면 legend·라벨이 뭉개지므로 상위 7개 + 나머지는 "기타"로 묶고,
// 현금도 하나의 슬라이스로 포함해 실제 자산배분을 그대로 보여준다.
function pfRenderChart(totalAssetKrw, cashKrw) {
  const canvas = document.getElementById('pfChartCanvas');
  const emptyEl = document.getElementById('pfChartEmpty');
  if (!totalAssetKrw) {
    pfChart?.destroy();
    pfChart = null;
    canvas.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    return;
  }
  canvas.classList.remove('hidden');
  emptyEl.classList.add('hidden');

  const sorted = [...pfEnriched].sort((a, b) => b.marketValueKrw - a.marketValueKrw);
  const top = sorted.slice(0, 7);
  const restSum = sorted.slice(7).reduce((s, r) => s + r.marketValueKrw, 0);

  const labels = top.map(r => r.symbol);
  const values = top.map(r => r.marketValueKrw);
  if (restSum > 0) { labels.push('기타'); values.push(restSum); }
  if (cashKrw > 0) { labels.push('현금'); values.push(cashKrw); }

  const colors = labels.map((_, i) => STOCK_CHART_COLORS[i % STOCK_CHART_COLORS.length]);

  pfChart?.destroy();
  pfChart = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: 'var(--card-bg)', borderWidth: 2 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: getComputedStyle(document.body).getPropertyValue('--text'), boxWidth: 12, padding: 10 } },
        tooltip: {
          callbacks: {
            label: ctx => {
              const pct = totalAssetKrw ? (ctx.parsed / totalAssetKrw * 100).toFixed(1) : '0.0';
              return ` ${ctx.label}: ₩${Math.round(ctx.parsed).toLocaleString('ko-KR')} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

// ============================================================
//  종 목 별 분 석
// ============================================================
// 백엔드(/api/stock-analysis)가 종목별 가치·성장·수익성·안정성·주주환원
// 원자료와 카테고리별 점수(0~100)를 계산해서 내려준다.
// 여기서는 그 카테고리 점수에 사용자가 고른 전략 가중치를 곱해 총점을 내고,
// 총점·상승여력을 기준으로 투자판단 배지를 정하는 부분만 담당한다.
// (점수 계산 로직 자체는 stock_scoring.py 참고 — 렌더링 코드와 분리되어 있음)

const SA_STRATEGY_PRESETS = {
  classic:  { label: '전통 가치투자',   value: 40, growth: 10, quality: 20, stability: 20, shareholderReturn: 10 },
  growth:   { label: '성장주 투자',     value: 25, growth: 30, quality: 25, stability: 10, shareholderReturn: 10 },
  pension:  { label: '연금형 장기투자', value: 20, growth: 20, quality: 35, stability: 15, shareholderReturn: 10 },
  dividend: { label: '배당투자',       value: 20, growth: 10, quality: 20, stability: 20, shareholderReturn: 30 },
  custom:   { label: '사용자 설정',    value: 30, growth: 20, quality: 25, stability: 15, shareholderReturn: 10 },
};

const SA_WEIGHT_KEYS = [
  { key: 'value',             label: '가치' },
  { key: 'growth',            label: '성장' },
  { key: 'quality',           label: '퀄리티' },
  { key: 'stability',         label: '안정성' },
  { key: 'shareholderReturn', label: '주주환원' },
];

const SA_JUDGMENTS = [
  { key: 'undervalued', label: '저평가 검토' },
  { key: 'buywatch',    label: '매수 관심' },
  { key: 'fair',        label: '적정가 부근' },
  { key: 'overvalued',  label: '고평가 주의' },
  { key: 'warning',     label: '펀더멘털 경고' },
  { key: 'review',      label: '추가 확인 필요' },
  { key: 'watch',       label: '관망' },
];

function saPresetWeights(key) {
  const { label, ...w } = SA_STRATEGY_PRESETS[key];
  return w;
}

let saData = [];
let saLoaded = false;
let saMatrixChart = null;
let saSelectedSymbol = null;
let saSortKey = 'totalScore';
let saSortAsc = false;
let saStrategy = 'classic';
let saWeights = saPresetWeights('classic');
let saFilters = { q: '', country: 'all', judgment: 'all', minScore: null, minUpside: null };
let saSelectedSymbols = new Set(); // 사용자가 표에서 체크박스로 고른 종목 (세션 동안만 유지)
let saOnlySelected = false;        // "선택한 종목만 보기" 토글 상태

// ─── 총점·투자판단 계산 (가중치가 바뀔 때마다 클라이언트에서 즉시 재계산) ───
function saWeightedTotal(scores, weights) {
  const parts = SA_WEIGHT_KEYS
    .map(({ key }) => [scores?.[key], weights[key]])
    .filter(([s, w]) => s != null && w > 0);
  if (!parts.length) return null;
  const totalW = parts.reduce((sum, [, w]) => sum + w, 0);
  const sum = parts.reduce((sum, [s, w]) => sum + s * w, 0);
  return totalW > 0 ? Math.round((sum / totalW) * 10) / 10 : null;
}

function saDeriveJudgment(row, totalScore) {
  if (!row.isCompany) return { key: 'watch', label: '관망 (ETF·펀드)' };

  const upside = row.fairValue?.upsidePercent;
  const quality = row.scores?.quality;
  const stability = row.scores?.stability;
  const scoredCategories = SA_WEIGHT_KEYS.filter(({ key }) => row.scores?.[key] != null).length;

  if (totalScore == null || scoredCategories < 2 || row.fairValue?.base == null) {
    return { key: 'review', label: '추가 확인 필요' };
  }
  if ((quality != null && quality < 35) || (stability != null && stability < 30)) {
    return { key: 'warning', label: '펀더멘털 경고' };
  }
  if (upside != null && upside >= 20 && totalScore >= 75 && (quality == null || quality >= 60)) {
    return { key: 'undervalued', label: '저평가 검토' };
  }
  if (upside != null && upside >= 10 && totalScore >= 65) {
    return { key: 'buywatch', label: '매수 관심' };
  }
  if (upside != null && upside <= -20) {
    return { key: 'overvalued', label: '고평가 주의' };
  }
  if (upside != null && upside >= -10 && upside <= 10) {
    return { key: 'fair', label: '적정가 부근' };
  }
  return { key: 'watch', label: '관망' };
}

function saEnrichedRows() {
  return saData.filter(d => !d.error).map(row => {
    const totalScore = saWeightedTotal(row.scores, saWeights);
    return { ...row, totalScore, judgment: saDeriveJudgment(row, totalScore) };
  });
}

function saFilteredRows() {
  let rows = saEnrichedRows();
  const q = saFilters.q.trim().toLowerCase();
  if (q) {
    rows = rows.filter(r => r.symbol.toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q));
  }
  if (saFilters.country !== 'all') {
    rows = rows.filter(r => (r.currency === 'KRW' ? 'KR' : 'US') === saFilters.country);
  }
  if (saFilters.judgment !== 'all') {
    rows = rows.filter(r => r.judgment.key === saFilters.judgment);
  }
  if (saFilters.minScore != null && !Number.isNaN(saFilters.minScore)) {
    rows = rows.filter(r => r.totalScore != null && r.totalScore >= saFilters.minScore);
  }
  if (saFilters.minUpside != null && !Number.isNaN(saFilters.minUpside)) {
    rows = rows.filter(r => r.fairValue?.upsidePercent != null && r.fairValue.upsidePercent >= saFilters.minUpside);
  }
  if (saOnlySelected) {
    rows = rows.filter(r => saSelectedSymbols.has(r.symbol));
  }
  return rows;
}

function updateSaSelectedCount() {
  const el = document.getElementById('saSelectedCountBadge');
  if (el) el.textContent = String(saSelectedSymbols.size);
}

const SA_SORT_ACCESSORS = {
  name:              r => r.name || r.symbol,
  price:             r => r.price,
  change:            r => r.changePercent,
  pe:                r => r.valuation?.pe,
  forwardPe:         r => r.valuation?.forwardPe,
  peg:               r => r.valuation?.peg,
  epsGrowth:         r => r.growth?.forwardEpsGrowth,
  roe:               r => r.profitability?.roe,
  dividendYield:     r => r.shareholderReturn?.dividendYield,
  value:             r => r.scores?.value,
  growth:            r => r.scores?.growth,
  quality:           r => r.scores?.quality,
  stability:         r => r.scores?.stability,
  shareholderReturn: r => r.scores?.shareholderReturn,
  totalScore:        r => r.totalScore,
  upside:            r => r.fairValue?.upsidePercent,
};

// 상승여력 산출 방식이 1개(대부분 적자 기업이라 PER·Graham이 제외되고
// 애널리스트 목표가 하나에만 의존)뿐이면 신뢰도가 낮으므로, 방식이 2개 이상
// 확보된 종목과 같은 줄에서 경쟁시키지 않는다. → saUpsideReliable() 참고
function saUpsideReliable(r) {
  return (r.fairValue?.methods?.length || 0) >= 2;
}

function saSortRows(rows) {
  const acc = SA_SORT_ACCESSORS[saSortKey] || SA_SORT_ACCESSORS.totalScore;
  if (saSortKey === 'upside') {
    // 방식 2개 이상(신뢰도 높음) 종목을 항상 앞쪽 그룹에 두고, 그 안에서만 값으로 정렬.
    // 방식 1개(목표가 단독) 종목은 값이 아무리 높아도 뒤쪽 그룹으로 밀어 별도 취급한다.
    return [...rows].sort((a, b) => {
      const ra = saUpsideReliable(a), rb = saUpsideReliable(b);
      if (ra !== rb) return ra ? -1 : 1;
      const va = acc(a), vb = acc(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return saSortAsc ? va - vb : vb - va;
    });
  }
  return [...rows].sort((a, b) => {
    const va = acc(a), vb = acc(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'string') return saSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    return saSortAsc ? va - vb : vb - va;
  });
}

// ─── 뷰 전환 ────────────────────────────────────────────
function toggleStockAnalysisView() {
  const showing = !document.getElementById('stockAnalysisView').classList.contains('hidden');
  hideAllViews();
  if (!showing) {
    document.querySelector('main').classList.add('hidden');
    document.getElementById('stockAnalysisView').classList.remove('hidden');
    document.getElementById('stockAnalysisBtn').classList.add('active');
    if (!saLoaded) loadStockAnalysisData();
    else renderSaTable();
  }
}

async function loadStockAnalysisData() {
  const wrap = document.getElementById('saTableWrap');
  wrap.innerHTML = '<div class="yc-loading">로딩 중...</div>';
  try {
    const res = await fetch('/api/stock-analysis');
    if (!res.ok) throw new Error('load failed');
    saData = await res.json();
    saLoaded = true;
    document.getElementById('saAsOf').innerHTML =
      `기준일 ${new Date().toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}<br>` +
      `재무데이터는 최근 공시 분기 기준`;
    renderSaTable();
  } catch {
    wrap.innerHTML = '<div class="sa-error-state">데이터를 불러오지 못했습니다.<br>잠시 후 다시 시도해 주세요.' +
      '<br><button class="sa-retry-btn" id="saRetryBtn">다시 시도</button></div>';
    document.getElementById('saRetryBtn')?.addEventListener('click', loadStockAnalysisData);
  }
}

// ─── KPI ────────────────────────────────────────────────
function renderSaKpi(rows) {
  const el = document.getElementById('saKpiRow');
  if (!el) return;
  const companyRows = rows.filter(r => r.isCompany);
  const scored = companyRows.filter(r => r.totalScore != null);
  const avgScore = scored.length ? scored.reduce((s, r) => s + r.totalScore, 0) / scored.length : null;
  const upsideRows = companyRows.filter(r => r.fairValue?.upsidePercent != null);
  const avgUpside = upsideRows.length ? upsideRows.reduce((s, r) => s + r.fairValue.upsidePercent, 0) / upsideRows.length : null;
  const buyCount = companyRows.filter(r => r.judgment.key === 'undervalued' || r.judgment.key === 'buywatch').length;
  const riskCount = companyRows.filter(r => r.judgment.key === 'overvalued' || r.judgment.key === 'warning').length;
  const lackCount = companyRows.filter(r => r.judgment.key === 'review').length;

  const upsideCls = avgUpside == null ? 'flat' : avgUpside > 0 ? 'up' : avgUpside < 0 ? 'down' : 'flat';
  const cards = [
    ['분석 종목', `${rows.length}개`, ''],
    ['평균 종합점수', avgScore != null ? `${avgScore.toFixed(1)}점` : '—', ''],
    ['평균 상승여력', avgUpside != null ? `${avgUpside >= 0 ? '+' : ''}${avgUpside.toFixed(1)}%` : '—', upsideCls],
    ['저평가·매수 관심', `${buyCount}개`, buyCount ? 'up' : ''],
    ['고평가·경고', `${riskCount}개`, riskCount ? 'down' : ''],
    ['데이터 부족', `${lackCount}개`, ''],
  ];
  el.innerHTML = cards.map(([label, value, cls]) => `
    <div class="sa-kpi-card">
      <div class="sa-kpi-label">${label}</div>
      <div class="sa-kpi-value ${cls}">${value}</div>
    </div>`).join('');
}

// ─── 표시 헬퍼 ──────────────────────────────────────────
function saScoreGrade(score) {
  if (score == null) return '';
  if (score >= 70) return 'grade-high';
  if (score >= 45) return 'grade-mid';
  return 'grade-low';
}

function saScoreCellHTML(score) {
  if (score == null) return '<span class="sa-td-empty">—</span>';
  return `<span class="sa-score-cell">
    <span class="sa-score-bar"><span class="sa-score-bar-fill ${saScoreGrade(score)}" style="width:${Math.max(0, Math.min(100, score))}%"></span></span>
    ${score.toFixed(0)}
  </span>`;
}

function saPctHTML(v, digits = 1) {
  if (v == null) return '<span class="sa-td-empty">—</span>';
  const cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
  return `<span class="sa-td ${cls}">${v >= 0 ? '+' : ''}${v.toFixed(digits)}%</span>`;
}

// 상승여력 셀 전용: 값 자체는 saPctHTML과 동일하게 표시하되, 산출 근거가
// 애널리스트 목표가 하나뿐인(방식 1개) 종목에는 "단독" 배지를 붙여
// 다른 지표(PER 재평가·Graham)로 검증된 값과 시각적으로 구분한다.
function saUpsideCellHTML(row) {
  const v = row.fairValue?.upsidePercent;
  const base = saPctHTML(v);
  if (v == null || saUpsideReliable(row)) return base;
  return `${base}<span class="sa-upside-flag" title="적자 등으로 PER 재평가·Graham 공식이 제외되어, 애널리스트 목표가 평균 하나에만 근거한 참고용 수치입니다. 순위에서도 방식 2개 이상 확보된 종목보다 뒤로 별도 정렬됩니다.">단독</span>`;
}

function saPctPlain(v, digits = 1) {
  return v != null ? `${v.toFixed(digits)}%` : '—';
}

function saNumHTML(v, digits = 1, suffix = '') {
  if (v == null) return '<span class="sa-td-empty">—</span>';
  return `${v.toFixed(digits)}${suffix}`;
}

// 표에서 회사명이 너무 길어 보이지 않도록 흔한 법인 형태 표기(Inc./Corporation/Co., Ltd. 등)를
// 끝에서 한 번만 제거함. ETF/펀드 이름의 "ETF"·"Trust" 등은 상품 성격을 나타내므로 남겨두고,
// 그래도 긴 이름은 CSS로 말줄임 처리하며 title 속성으로 전체 이름을 볼 수 있게 함
const SA_NAME_SUFFIX_RE = new RegExp(
  '\\s*,?\\s*(' +
    'Co\\.,?\\s*Ltd\\.?|' +
    'Incorporated|Inc\\.?|' +
    'Corporation|Corp\\.?|' +
    'Limited|Ltd\\.?|' +
    'Holdings?|' +
    'Company|Co\\.?|' +
    'Group|' +
    'Trust|' +
    'PLC|plc' +
  ')\\s*$'
);

function saShortName(name) {
  if (!name) return name;
  return name.trim().replace(SA_NAME_SUFFIX_RE, '').trim() || name;
}

// ─── 비교표 ─────────────────────────────────────────────
const SA_COLUMNS = [
  ['name',              '종목',       'sa-th-name'],
  ['totalScore',        '종합점수',   ''],
  ['upside',            '상승여력',   ''],
  ['price',             '현재가',     ''],
  ['change',            '등락률',     ''],
  ['pe',                'PER',        ''],
  ['forwardPe',         'Fwd PER',    ''],
  ['peg',               'PEG',        ''],
  ['epsGrowth',         'EPS성장',    ''],
  ['roe',               'ROE',        ''],
  ['dividendYield',     '배당수익률', ''],
  ['value',             '가치',       ''],
  ['growth',            '성장',       ''],
  ['quality',           '퀄리티',     ''],
  ['stability',         '안정성',     ''],
  ['shareholderReturn', '주주환원',   ''],
];

// 표 헤더의 ⓘ 아이콘을 누르면 뜨는 간단한 지표 설명 (컬럼 key 기준)
const SA_METRIC_HELP = {
  pe:                'PER (주가수익비율): 현재가를 최근 12개월 실적 기준 EPS로 나눈 값입니다. 낮을수록 저평가 가능성이 있지만, 업종 특성·성장률과 함께 봐야 합니다.',
  forwardPe:         'Forward PER: 향후 12개월 예상 EPS 기준 PER입니다. 애널리스트 추정치를 사용하므로 실제 실적과 차이가 날 수 있습니다.',
  peg:               'PEG: Forward PER을 EPS 성장률(%)로 나눈 값입니다. 1배 이하면 성장률 대비 저평가로 해석하는 경우가 많습니다.',
  epsGrowth:         '향후 EPS 성장률(추정): 최근 EPS 대비 향후 예상 EPS의 증가율입니다. (추정 EPS − 최근 EPS) ÷ 최근 EPS로 계산합니다.',
  roe:               'ROE (자기자본이익률): 자기자본으로 얼마나 효율적으로 이익을 냈는지 나타내는 수익성 지표입니다.',
  dividendYield:     '배당수익률: 현재 주가 대비 연간 배당금 비율입니다.',
  value:             '가치 점수: PEG · FCF Yield · EV/EBITDA · PBR · PSR을 종합해 저평가 정도를 0~100점으로 환산한 점수입니다.',
  growth:            '성장 점수: 매출·이익 성장률과 향후 EPS 성장률 전망을 종합한 0~100점 점수입니다.',
  quality:           '퀄리티 점수: 매출총이익률·영업이익률·순이익률·ROE·ROA·FCF Margin 등 수익성을 종합한 0~100점 점수입니다.',
  stability:         '안정성 점수: 부채비율·유동비율·당좌비율·Net Debt/EBITDA 등 재무 안정성을 종합한 0~100점 점수입니다.',
  shareholderReturn: '주주환원 점수: 배당수익률과 배당성향을 종합한 0~100점 점수입니다.',
  totalScore:        '종합점수: 가치·성장·퀄리티·안정성·주주환원 5개 점수를 현재 선택된 전략 가중치로 가중평균한 값입니다. 전략이나 가중치를 바꾸면 즉시 재계산됩니다.',
  upside:            '상승여력: Forward PER 재평가·Graham 공식·애널리스트 목표가 평균을 종합한 기준 적정가가 현재가 대비 얼마나 높은지를 나타냅니다. 적자 기업 등 방식이 애널리스트 목표가 1개뿐인 종목은 "단독" 배지가 붙고, 순위에서도 방식 2개 이상인 종목보다 뒤로 별도 정렬됩니다.',
  judgment:          '투자판단: 종합점수와 상승여력을 기준으로 자동 분류한 참고용 배지입니다. 매수·매도를 권유하는 것이 아니며, 공개된 재무·시장 데이터를 기반으로 한 참고 정보입니다.',
};

function saHelpIconHTML(key, label) {
  const text = SA_METRIC_HELP[key];
  if (!text) return '';
  return `<button type="button" class="sa-help-icon" data-help="${key}" aria-label="${label} 설명 보기">ⓘ</button>`;
}

// ─── 지표 설명 툴팁 (표 헤더 · 상세 패널 공용) ─────────────
let saHelpTooltipEl = null;
let saHelpOpenFor = null;

function ensureSaHelpTooltip() {
  if (saHelpTooltipEl) return saHelpTooltipEl;
  const el = document.createElement('div');
  el.className = 'sa-help-tooltip hidden';
  el.setAttribute('role', 'tooltip');
  document.body.appendChild(el);
  document.addEventListener('click', e => {
    if (saHelpOpenFor && !e.target.closest('.sa-help-icon') && !e.target.closest('.sa-help-tooltip')) {
      closeSaHelpTooltip();
    }
  });
  window.addEventListener('scroll', () => closeSaHelpTooltip(), true);
  window.addEventListener('resize', () => closeSaHelpTooltip());
  saHelpTooltipEl = el;
  return el;
}

function closeSaHelpTooltip() {
  if (!saHelpTooltipEl) return;
  saHelpTooltipEl.classList.add('hidden');
  saHelpOpenFor = null;
}

function toggleSaHelpTooltip(iconEl, text) {
  if (saHelpOpenFor === iconEl) { closeSaHelpTooltip(); return; }
  const el = ensureSaHelpTooltip();
  el.textContent = text;
  el.classList.remove('hidden');
  el.style.left = '-9999px';
  el.style.top = '-9999px';
  saHelpOpenFor = iconEl;
  requestAnimationFrame(() => {
    if (saHelpOpenFor !== iconEl) return;
    const iconRect = iconEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    let left = iconRect.left + iconRect.width / 2 - elRect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - elRect.width - 8));
    let top = iconRect.bottom + 8;
    if (top + elRect.height > window.innerHeight - 8) top = iconRect.top - elRect.height - 8;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  });
}

function wireSaHelpIcons(root) {
  root.querySelectorAll('.sa-help-icon').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleSaHelpTooltip(btn, SA_METRIC_HELP[btn.dataset.help] || '');
    });
  });
}

function renderSaTable() {
  const wrap = document.getElementById('saTableWrap');
  if (!wrap) return;
  closeSaHelpTooltip(); // 재렌더링으로 이전 헤더 아이콘이 사라지므로 열려있던 툴팁도 함께 닫음

  if (!saData.length) {
    renderSaKpi([]);
    wrap.innerHTML = `<div class="sa-empty-state">분석할 종목이 없습니다.<br>먼저 종목을 추가해 주세요.
      <br><button class="sa-empty-btn" id="saAddStockBtn">종목 추가하러 가기</button></div>`;
    document.getElementById('saAddStockBtn')?.addEventListener('click', () => {
      hideAllViews();
      document.getElementById('dashboardBtn').classList.add('active');
      document.getElementById('searchInput')?.focus();
    });
    saMatrixChart?.destroy();
    saMatrixChart = null;
    return;
  }

  renderSaKpi(saEnrichedRows());

  const rows = saSortRows(saFilteredRows());
  if (!rows.length) {
    wrap.innerHTML = '<div class="sa-empty-state">조건에 맞는 종목이 없습니다.<br>필터를 조정해보세요.</div>';
    saMatrixChart?.destroy();
    saMatrixChart = null;
    return;
  }

  const sortArrow = key => saSortKey === key ? (saSortAsc ? ' ↑' : ' ↓') : '';
  const th = (key, label, extraCls) =>
    `<th data-key="${key}" class="${extraCls} ${saSortKey === key ? 'sorted' : ''}"><span class="sa-th-label">${label}${sortArrow(key)}</span>${saHelpIconHTML(key, label)}</th>`;

  const allChecked  = rows.every(r => saSelectedSymbols.has(r.symbol));
  const someChecked = rows.some(r => saSelectedSymbols.has(r.symbol));

  wrap.innerHTML = `
    <table class="sa-table">
      <thead>
        <tr>
          <th class="sa-th-check"><input type="checkbox" id="saSelectAllCheckbox" title="현재 목록 전체 선택/해제" ${allChecked ? 'checked' : ''} /></th>
          <th class="sa-th-rank">#</th>
          ${SA_COLUMNS.map(([key, label, cls]) => th(key, label, cls)).join('')}
          <th><span class="sa-th-label">투자판단</span>${saHelpIconHTML('judgment', '투자판단')}</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => `
          <tr data-symbol="${r.symbol}">
            <td class="sa-td-check"><input type="checkbox" class="sa-row-check" data-symbol="${r.symbol}" ${saSelectedSymbols.has(r.symbol) ? 'checked' : ''} /></td>
            <td class="sa-td-rank">${i + 1}</td>
            <td class="sa-td-name">
              <div class="sa-name-main">
                <span class="sa-name-company" title="${r.name || r.symbol}">${saShortName(r.name) || r.symbol}</span>
                <span class="sa-name-ticker">${r.symbol}</span>
              </div>
            </td>
            <td><strong>${r.totalScore != null ? r.totalScore.toFixed(1) : '—'}</strong></td>
            <td>${saUpsideCellHTML(r)}</td>
            <td>${r.price != null ? formatPrice(r.price, r.currency) : '<span class="sa-td-empty">—</span>'}</td>
            <td>${saPctHTML(r.changePercent, 2)}</td>
            <td>${saNumHTML(r.valuation?.pe)}</td>
            <td>${saNumHTML(r.valuation?.forwardPe)}</td>
            <td>${saNumHTML(r.valuation?.peg, 2)}</td>
            <td>${saPctHTML(r.growth?.forwardEpsGrowth)}</td>
            <td>${saNumHTML(r.profitability?.roe, 1, '%')}</td>
            <td>${r.shareholderReturn?.dividendYield != null ? r.shareholderReturn.dividendYield.toFixed(2) + '%' : '<span class="sa-td-empty">—</span>'}</td>
            <td>${saScoreCellHTML(r.scores?.value)}</td>
            <td>${saScoreCellHTML(r.scores?.growth)}</td>
            <td>${saScoreCellHTML(r.scores?.quality)}</td>
            <td>${saScoreCellHTML(r.scores?.stability)}</td>
            <td>${saScoreCellHTML(r.scores?.shareholderReturn)}</td>
            <td><span class="sa-judgment-badge jd-${r.judgment.key}">${r.judgment.label}</span></td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;

  wrap.querySelectorAll('thead th[data-key]').forEach(thEl => {
    thEl.addEventListener('click', () => {
      const key = thEl.dataset.key;
      if (saSortKey === key) saSortAsc = !saSortAsc;
      else { saSortKey = key; saSortAsc = false; }
      renderSaTable();
    });
  });
  wrap.querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', () => openSaDetail(tr.dataset.symbol));
  });
  wireSaHelpIcons(wrap);

  wrap.querySelectorAll('.sa-row-check').forEach(cb => {
    cb.addEventListener('click', e => e.stopPropagation()); // 체크박스 클릭이 행 클릭(상세 열기)으로 안 번지게
    cb.addEventListener('change', () => {
      const sym = cb.dataset.symbol;
      if (cb.checked) saSelectedSymbols.add(sym);
      else saSelectedSymbols.delete(sym);
      updateSaSelectedCount();
      if (saOnlySelected) renderSaTable();
      else {
        const selectAllCb = document.getElementById('saSelectAllCheckbox');
        if (selectAllCb) {
          const allChecked  = rows.every(r => saSelectedSymbols.has(r.symbol));
          const someChecked = rows.some(r => saSelectedSymbols.has(r.symbol));
          selectAllCb.checked = allChecked;
          selectAllCb.indeterminate = !allChecked && someChecked;
        }
      }
    });
  });

  const selectAllCb = document.getElementById('saSelectAllCheckbox');
  if (selectAllCb) {
    selectAllCb.indeterminate = !allChecked && someChecked;
    selectAllCb.addEventListener('click', e => e.stopPropagation());
    selectAllCb.addEventListener('change', () => {
      rows.forEach(r => {
        if (selectAllCb.checked) saSelectedSymbols.add(r.symbol);
        else saSelectedSymbols.delete(r.symbol);
      });
      updateSaSelectedCount();
      renderSaTable();
    });
  }
  updateSaSelectedCount();

  renderSaMatrix(rows);
}

// ─── 가치·성장 매트릭스 ─────────────────────────────────
function saQualityColor(q) {
  if (q == null) return 'rgba(123,127,151,0.55)';
  if (q >= 70) return 'rgba(0,209,122,0.65)';
  if (q >= 45) return 'rgba(79,126,255,0.65)';
  return 'rgba(255,70,85,0.65)';
}

function renderSaMatrix(rows) {
  const canvas = document.getElementById('saMatrixCanvas');
  if (!canvas) return;
  saMatrixChart?.destroy();
  saMatrixChart = null;

  const points = rows.filter(r => r.scores?.value != null && r.scores?.growth != null);
  if (!points.length) return;

  const caps = points.map(r => r.marketCap).filter(v => v != null);
  const maxCap = caps.length ? Math.max(...caps) : 1;

  const data = points.map(r => ({
    x: r.scores.value,
    y: r.scores.growth,
    r: r.marketCap ? 6 + Math.sqrt(r.marketCap / (maxCap || 1)) * 18 : 8,
    row: r,
  }));

  saMatrixChart = new Chart(canvas.getContext('2d'), {
    type: 'bubble',
    data: {
      datasets: [{
        data,
        backgroundColor: data.map(d => saQualityColor(d.row.scores?.quality)),
        borderColor: 'rgba(255,255,255,0.25)',
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { min: 0, max: 100, title: { display: true, text: '가치점수', color: '#7b7f97' }, grid: { color: '#252836' }, ticks: { color: '#7b7f97' } },
        y: { min: 0, max: 100, title: { display: true, text: '성장점수', color: '#7b7f97' }, grid: { color: '#252836' }, ticks: { color: '#7b7f97' } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const r = ctx.raw.row;
              return `${r.name || r.symbol} (${r.symbol}) · 가치 ${r.scores.value.toFixed(0)} · 성장 ${r.scores.growth.toFixed(0)}`;
            },
          },
        },
      },
      onClick: (evt, elements) => {
        if (elements.length) openSaDetail(data[elements[0].index].row.symbol);
      },
    },
  });
}

// ─── 전략 프리셋 · 가중치 슬라이더 ──────────────────────
function renderSaStrategyPresets() {
  const el = document.getElementById('saStrategyPresets');
  if (!el) return;
  el.innerHTML = Object.entries(SA_STRATEGY_PRESETS).map(([key, p]) =>
    `<button class="sa-preset-btn ${saStrategy === key ? 'active' : ''}" data-key="${key}">${p.label}</button>`
  ).join('');
  el.querySelectorAll('.sa-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      saStrategy = btn.dataset.key;
      saWeights = saPresetWeights(saStrategy);
      renderSaStrategyPresets();
      renderSaWeightSliders();
      saveSaSettings();
      renderSaTable();
    });
  });
}

// 슬라이더 하나를 옮기면 나머지 항목들에서 비례해서 덜어내/보태서 합계가 항상 100이 되게 함
function saAdjustWeight(changedKey, newValue) {
  newValue = Math.max(0, Math.min(100, Math.round(newValue)));
  const otherKeys = SA_WEIGHT_KEYS.map(w => w.key).filter(k => k !== changedKey);
  const othersSum = otherKeys.reduce((s, k) => s + saWeights[k], 0);
  const remaining = 100 - newValue;
  const next = { ...saWeights, [changedKey]: newValue };

  let assigned = 0;
  otherKeys.forEach((k, idx) => {
    if (idx === otherKeys.length - 1) {
      next[k] = Math.max(0, remaining - assigned);
    } else {
      const share = othersSum > 0 ? Math.round((saWeights[k] / othersSum) * remaining) : Math.round(remaining / otherKeys.length);
      next[k] = share;
      assigned += share;
    }
  });
  saWeights = next;
}

function renderSaWeightSliders() {
  const el = document.getElementById('saWeightSliders');
  if (!el) return;
  el.innerHTML = SA_WEIGHT_KEYS.map(({ key, label }) => `
    <div class="sa-weight-item">
      <div class="sa-weight-label-row"><span>${label}</span><strong>${saWeights[key]}%</strong></div>
      <input type="range" class="sa-weight-slider" min="0" max="100" step="1" value="${saWeights[key]}" data-key="${key}" />
    </div>
  `).join('');
  el.querySelectorAll('.sa-weight-slider').forEach(slider => {
    slider.addEventListener('input', () => {
      saAdjustWeight(slider.dataset.key, +slider.value);
      saStrategy = 'custom';
      renderSaStrategyPresets();
      renderSaWeightSliders();
      renderSaTable();
    });
    slider.addEventListener('change', saveSaSettings);
  });
}

async function loadSaWeightsFromDB() {
  try {
    const res = await fetch('/api/db/settings/stockAnalysisSettings');
    if (res.ok) {
      const saved = JSON.parse((await res.json()).value);
      if (saved.strategy && SA_STRATEGY_PRESETS[saved.strategy]) saStrategy = saved.strategy;
      if (saved.weights) saWeights = { ...saPresetWeights('custom'), ...saved.weights };
    }
  } catch {}
}

function saveSaSettings() {
  fetch('/api/db/settings/stockAnalysisSettings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: JSON.stringify({ strategy: saStrategy, weights: saWeights }) }),
  }).catch(() => {});
}

// ─── 검색·필터 ──────────────────────────────────────────
function initSaControls() {
  const judgmentSelect = document.getElementById('saJudgmentFilter');
  SA_JUDGMENTS.forEach(j => {
    const opt = document.createElement('option');
    opt.value = j.key;
    opt.textContent = j.label;
    judgmentSelect.appendChild(opt);
  });

  document.getElementById('saSearchInput').addEventListener('input', e => {
    saFilters.q = e.target.value;
    renderSaTable();
  });
  document.getElementById('saCountryFilter').addEventListener('change', e => {
    saFilters.country = e.target.value;
    renderSaTable();
  });
  judgmentSelect.addEventListener('change', e => {
    saFilters.judgment = e.target.value;
    renderSaTable();
  });
  document.getElementById('saMinScore').addEventListener('input', e => {
    saFilters.minScore = e.target.value === '' ? null : +e.target.value;
    renderSaTable();
  });
  document.getElementById('saMinUpside').addEventListener('input', e => {
    saFilters.minUpside = e.target.value === '' ? null : +e.target.value;
    renderSaTable();
  });
  document.getElementById('saResetFiltersBtn').addEventListener('click', () => {
    saFilters = { q: '', country: 'all', judgment: 'all', minScore: null, minUpside: null };
    document.getElementById('saSearchInput').value = '';
    document.getElementById('saCountryFilter').value = 'all';
    judgmentSelect.value = 'all';
    document.getElementById('saMinScore').value = '';
    document.getElementById('saMinUpside').value = '';
    renderSaTable();
  });
  document.getElementById('saRefreshBtn').addEventListener('click', () => {
    loadStockAnalysisData();
    const btn = document.getElementById('saRefreshBtn');
    btn.classList.remove('spinning');
    void btn.offsetWidth; // 애니메이션 재시작을 위한 리플로우 강제
    btn.classList.add('spinning');
  });
  document.getElementById('saOnlySelectedToggle').addEventListener('change', e => {
    saOnlySelected = e.target.checked;
    renderSaTable();
  });
  document.getElementById('saClearSelectionBtn').addEventListener('click', () => {
    saSelectedSymbols.clear();
    if (saOnlySelected) {
      saOnlySelected = false;
      document.getElementById('saOnlySelectedToggle').checked = false;
    }
    renderSaTable();
  });
}

// ─── 종목 상세 패널 ─────────────────────────────────────
function saMetricTabHTML(title, score, metricPairs, reasons) {
  return `
    <div class="sa-section-title">${title} 점수: ${score != null ? score.toFixed(1) : '—'}</div>
    <table class="sa-metric-table">
      ${metricPairs.map(([label, val]) => `<tr><td>${label}</td><td>${val}</td></tr>`).join('')}
    </table>
    ${reasons && reasons.length
      ? `<ul class="sa-reason-list">${reasons.map(r => `<li>${r}</li>`).join('')}</ul>`
      : '<p class="sa-no-data">근거로 삼을 데이터가 부족합니다.</p>'}
  `;
}

function saOverviewTabHTML(row) {
  const scores = row.scores || {};
  const bars = SA_WEIGHT_KEYS.map(({ key, label }) => `
    <div class="sa-weight-item">
      <div class="sa-weight-label-row"><span>${label}</span><strong>${scores[key] != null ? scores[key].toFixed(1) : '—'}</strong></div>
      <div class="sa-score-bar" style="width:100%"><div class="sa-score-bar-fill ${saScoreGrade(scores[key])}" style="width:${scores[key] ?? 0}%"></div></div>
    </div>
  `).join('');

  const posList = row.reasons?.positive?.length
    ? `<ul class="sa-reason-list">${row.reasons.positive.map(t => `<li class="pos">${t}</li>`).join('')}</ul>`
    : '<p class="sa-no-data">뚜렷한 긍정 요인이 확인되지 않았습니다.</p>';
  const riskList = row.reasons?.risk?.length
    ? `<ul class="sa-reason-list">${row.reasons.risk.map(t => `<li class="risk">${t}</li>`).join('')}</ul>`
    : '<p class="sa-no-data">뚜렷한 위험 요인이 확인되지 않았습니다.</p>';

  return `
    <div class="sa-section-title">카테고리별 점수</div>
    <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:16px;">${bars}</div>
    <div class="sa-section-title">긍정 요인</div>
    ${posList}
    <div class="sa-section-title">위험 요인</div>
    ${riskList}
  `;
}

function saFairValueTabHTML(row) {
  const fv = row.fairValue || {};
  if (!fv.methods || !fv.methods.length) {
    return `<p class="sa-no-data">적정가를 산출할 데이터가 부족합니다.</p>` +
      (row.analyst?.targetMean != null
        ? `<p class="sa-no-data">애널리스트 평균 목표가: ${formatPrice(row.analyst.targetMean, row.currency)}</p>`
        : '');
  }

  const rowsHTML = fv.methods.map(m => {
    const diff = row.price ? (m.value - row.price) / row.price * 100 : null;
    return `<tr><td>${m.label}</td><td>${formatPrice(m.value, row.currency)}</td><td>${diff != null ? (diff >= 0 ? '+' : '') + diff.toFixed(1) + '%' : '—'}</td></tr>`;
  }).join('');

  let rangeHTML = '';
  if (fv.bear != null && fv.bull != null && row.price != null && fv.bull > fv.bear) {
    const lo = Math.min(fv.bear, row.price) * 0.95;
    const hi = Math.max(fv.bull, row.price) * 1.05;
    const pct = v => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
    rangeHTML = `
      <div class="sa-fv-range-wrap">
        <div class="sa-fv-range-track">
          <div class="sa-fv-range-fill" style="left:${pct(fv.bear)}%; right:${100 - pct(fv.bull)}%"></div>
          <div class="sa-fv-range-dot" style="left:${pct(row.price)}%"></div>
          <div class="sa-fv-range-marker current" style="left:${pct(row.price)}%">현재가</div>
        </div>
        <div class="sa-fv-range-labels">
          <span>Bear ${formatPrice(fv.bear, row.currency)}</span>
          <span>Base ${fv.base != null ? formatPrice(fv.base, row.currency) : '—'}</span>
          <span>Bull ${formatPrice(fv.bull, row.currency)}</span>
        </div>
      </div>`;
  }

  return `
    <div class="sa-section-title">적정가 산출 방식</div>
    <table class="sa-fv-table">
      <thead><tr><th>방식</th><th>적정가</th><th>현재가 대비</th></tr></thead>
      <tbody>${rowsHTML}</tbody>
    </table>
    ${rangeHTML}
    ${row.analyst?.numberOfAnalysts ? `<p class="sa-no-data">애널리스트 ${row.analyst.numberOfAnalysts}명 평균 · 등급 ${row.analyst.recommendation || '—'}</p>` : ''}
  `;
}

function renderSaDetailTab(row, tab) {
  const body = document.getElementById('saDetailBody');
  if (tab === 'overview') {
    body.innerHTML = saOverviewTabHTML(row);
  } else if (tab === 'valuation') {
    body.innerHTML = saMetricTabHTML('가치평가', row.scores?.value, [
      ['PER', saNumHTML(row.valuation?.pe)],
      ['Forward PER', saNumHTML(row.valuation?.forwardPe)],
      ['PEG', saNumHTML(row.valuation?.peg, 2)],
      ['PBR', saNumHTML(row.valuation?.pb, 2)],
      ['PSR', saNumHTML(row.valuation?.ps, 2)],
      ['EV/EBITDA', saNumHTML(row.valuation?.evEbitda, 1)],
      ['FCF Yield', saPctPlain(row.valuation?.fcfYield)],
    ], row.scoreReasons?.value);
  } else if (tab === 'growth') {
    body.innerHTML = saMetricTabHTML('성장성', row.scores?.growth, [
      ['매출 성장률', row.growth?.revenueGrowth != null ? (row.growth.revenueGrowth >= 0 ? '+' : '') + row.growth.revenueGrowth.toFixed(1) + '%' : '—'],
      ['이익 성장률', row.growth?.earningsGrowth != null ? (row.growth.earningsGrowth >= 0 ? '+' : '') + row.growth.earningsGrowth.toFixed(1) + '%' : '—'],
      ['향후 EPS 성장률(추정)', row.growth?.forwardEpsGrowth != null ? (row.growth.forwardEpsGrowth >= 0 ? '+' : '') + row.growth.forwardEpsGrowth.toFixed(1) + '%' : '—'],
    ], row.scoreReasons?.growth);
  } else if (tab === 'quality') {
    body.innerHTML = saMetricTabHTML('수익성', row.scores?.quality, [
      ['매출총이익률', saPctPlain(row.profitability?.grossMargin)],
      ['영업이익률', saPctPlain(row.profitability?.operatingMargin)],
      ['순이익률', saPctPlain(row.profitability?.netMargin)],
      ['FCF Margin', saPctPlain(row.profitability?.fcfMargin)],
      ['ROE', saPctPlain(row.profitability?.roe)],
      ['ROA', saPctPlain(row.profitability?.roa)],
    ], row.scoreReasons?.quality);
  } else if (tab === 'stability') {
    body.innerHTML = saMetricTabHTML('재무안정성', row.scores?.stability, [
      ['부채비율(D/E)', row.stability?.debtToEquity != null ? row.stability.debtToEquity.toFixed(0) + '%' : '—'],
      ['유동비율', saNumHTML(row.stability?.currentRatio, 2)],
      ['당좌비율', saNumHTML(row.stability?.quickRatio, 2)],
      ['Net Debt/EBITDA', saNumHTML(row.stability?.netDebtToEbitda, 2)],
    ], row.scoreReasons?.stability);
  } else if (tab === 'shareholder') {
    body.innerHTML = saMetricTabHTML('주주환원', row.scores?.shareholderReturn, [
      ['배당수익률', row.shareholderReturn?.dividendYield != null ? row.shareholderReturn.dividendYield.toFixed(2) + '%' : '—'],
      ['배당성향', row.shareholderReturn?.payoutRatio != null ? row.shareholderReturn.payoutRatio.toFixed(0) + '%' : '—'],
    ], row.scoreReasons?.shareholderReturn);
  } else if (tab === 'fairvalue') {
    body.innerHTML = saFairValueTabHTML(row);
  }
}

function openSaDetail(symbol) {
  const row = saEnrichedRows().find(r => r.symbol === symbol);
  if (!row) return;
  saSelectedSymbol = symbol;

  document.getElementById('saDetailSymbol').textContent = row.symbol;
  document.getElementById('saDetailName').textContent = row.name || '';
  const badge = document.getElementById('saDetailJudgment');
  badge.className = `sa-judgment-badge jd-${row.judgment.key}`;
  badge.textContent = row.judgment.label;

  const summaryItem = (label, value) =>
    `<div class="sa-summary-item"><span class="sa-summary-label">${label}</span><span class="sa-summary-value">${value}</span></div>`;
  document.getElementById('saDetailSummary').innerHTML = [
    summaryItem('현재가', row.price != null ? formatPrice(row.price, row.currency) : '—'),
    summaryItem('등락률', row.changePercent != null ? (row.changePercent >= 0 ? '+' : '') + row.changePercent.toFixed(2) + '%' : '—'),
    summaryItem('종합점수', row.totalScore != null ? row.totalScore.toFixed(1) : '—'),
    summaryItem('기준 적정가', row.fairValue?.base != null ? formatPrice(row.fairValue.base, row.currency) : '—'),
    summaryItem('상승여력', row.fairValue?.upsidePercent != null ? (row.fairValue.upsidePercent >= 0 ? '+' : '') + row.fairValue.upsidePercent.toFixed(1) + '%' : '—'),
    summaryItem('섹터', row.sectorEtf || row.sector || '—'),
  ].join('');

  document.querySelectorAll('.sa-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'overview'));
  renderSaDetailTab(row, 'overview');

  document.getElementById('saDetailPanel').classList.remove('hidden');
  document.getElementById('saOverlay').classList.remove('hidden');
}

function closeSaDetail() {
  document.getElementById('saDetailPanel').classList.add('hidden');
  document.getElementById('saOverlay').classList.add('hidden');
  saSelectedSymbol = null;
}

function initSaDetailPanel() {
  document.getElementById('saDetailClose').addEventListener('click', closeSaDetail);
  document.getElementById('saOverlay').addEventListener('click', closeSaDetail);
  document.getElementById('saDetailTabs').addEventListener('click', e => {
    const btn = e.target.closest('.sa-tab-btn');
    if (!btn) return;
    document.querySelectorAll('.sa-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const row = saEnrichedRows().find(r => r.symbol === saSelectedSymbol);
    if (row) renderSaDetailTab(row, btn.dataset.tab);
  });
}

// ─── 초기화 ─────────────────────────────────────────────
async function initStockAnalysisView() {
  document.getElementById('stockAnalysisBtn').addEventListener('click', toggleStockAnalysisView);
  initSaControls();
  initSaDetailPanel();
  await initSaCollapseToggle();
  await loadSaWeightsFromDB();
  renderSaStrategyPresets();
  renderSaWeightSliders();
}

// 분석 요약(KPI) · 검색·필터 · 투자성향 가중치 영역을 한 번에 접고 펼치는 토글
async function initSaCollapseToggle() {
  const toggle  = document.getElementById('saCollapseToggle');
  const arrow   = document.getElementById('saCollapseArrow');
  const section = document.getElementById('saCollapsibleSection');
  if (!toggle || !section) return;

  let collapsed = false;
  const apply = () => {
    section.classList.toggle('hidden', collapsed);
    if (arrow) arrow.textContent = collapsed ? '▸' : '▾';
  };

  try {
    const res = await fetch('/api/db/settings/saControlsCollapsed');
    if (res.ok) collapsed = (await res.json()).value === '1';
  } catch {}
  apply();

  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    apply();
    fetch('/api/db/settings/saControlsCollapsed', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: collapsed ? '1' : '0' }),
    }).catch(() => {});
  });
}

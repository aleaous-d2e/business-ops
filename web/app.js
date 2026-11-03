/* ============================================================
 * 通用经营分析看板（模拟数据）
 * app.js — 数据加载 / 筛选联动 / 高级图表渲染
 * ============================================================ */
'use strict';

const STATE = {
  dashboard: null,
  facts: [],
  targetFacts: [],
  charts: {},
  currentAbnormalType: 'all',
};

const $ = (id) => document.getElementById(id);

/* ---------- 字体 & 颜色 token（全局统一） ---------- */
const FONT = '"Inter", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
const C_MAIN  = '#0f172a';
const C_SUB   = '#334155';
const C_AUX   = '#475569';
const C_FAINT = '#64748b';
const C_LINE  = '#cbd5e1';
const C_SPLIT = '#eef2f7';

const AXIS_LABEL = { color: C_AUX, fontSize: 12, fontWeight: 500, fontFamily: FONT };
const AXIS_LINE  = { lineStyle: { color: C_LINE } };
const SPLIT_LINE = { lineStyle: { type: 'dashed', color: C_SPLIT } };

const TOOLTIP_STYLE = {
  backgroundColor: 'rgba(255, 255, 255, 0.98)',
  borderColor: '#e2e8f2', borderWidth: 1, padding: [11, 14],
  extraCssText: 'box-shadow: 0 12px 32px -10px rgba(15,23,42,.22); border-radius: 10px;',
  textStyle: { color: C_MAIN, fontFamily: FONT, fontWeight: 500 }
};

/* ---------- 格式化 ---------- */
const fmtMoney = (v, digits = 1) => {
  if (v == null || isNaN(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e8) return (v / 1e8).toFixed(2) + ' 亿';
  if (abs >= 1e4) return (v / 1e4).toFixed(digits) + ' 万';
  return v.toFixed(0);
};
const fmtPct = (v, digits = 2) => (v == null || isNaN(v)) ? '—' : (v * 100).toFixed(digits) + '%';
const fmtInt = (v) => (v == null || isNaN(v)) ? '—' : Math.round(v).toLocaleString('zh-CN');
const fmtNum = (v, digits = 2) => (v == null || isNaN(v)) ? '—'
  : Number(v).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const monthLabel = (ym) => ym ? ym.replace(/^\d{4}-/, '') + '月' : '';

/* ---------- KPI 图标 ---------- */
const ICON = {
  sales:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  profit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
  margin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.2"/><circle cx="17.5" cy="17.5" r="2.2"/></svg>',
  orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
  aov:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".6"/></svg>',
};

const PALETTE = ['#2563eb', '#6d28d9', '#be185d', '#d97706', '#0e7490', '#15803d', '#c2410c'];

/* ---------- 数据加载 ---------- */
async function loadData() {
  try {
    const [dRes, fRes] = await Promise.all([
      fetch('data/dashboard.json'),
      fetch('data/order_facts.json'),
    ]);
    if (!dRes.ok || !fRes.ok) throw new Error(`HTTP ${dRes.status} / ${fRes.status}`);
    STATE.dashboard = await dRes.json();
    STATE.facts = await fRes.json();
    STATE.targetFacts = STATE.dashboard.targetFacts || [];
    return true;
  } catch (e) {
    console.error('[loadData]', e);
    $('dataMeta').textContent = '数据加载失败：' + e.message;
    return false;
  }
}

/* ---------- 筛选初始化 ---------- */
function initFilters() {
  const meta = STATE.dashboard._meta;
  const startEl = $('fStart'), endEl = $('fEnd');
  [startEl, endEl].forEach(el => { el.min = meta.date_range[0]; el.max = meta.date_range[1]; });
  startEl.value = meta.date_range[0];
  endEl.value = meta.date_range[1];

  $('fRegion').innerHTML = '<option value="all">全部区域</option>' + meta.regions.map(r => `<option value="${r}">${r}</option>`).join('');
  $('fChannel').innerHTML = '<option value="all">全部渠道</option>' + meta.channels.map(c => `<option value="${c}">${c}</option>`).join('');
  $('fCategory').innerHTML = '<option value="all">全部品类</option>' + meta.categories.map(c => `<option value="${c}">${c}</option>`).join('');

  [startEl, endEl, $('fRegion'), $('fChannel'), $('fCategory')].forEach(el => el.addEventListener('change', refresh));

  const tabs = document.querySelectorAll('#abnormalTabs .tab-btn');
  tabs.forEach(btn => {
    btn.addEventListener('click', (e) => {
      tabs.forEach(t => t.classList.remove('active'));
      e.currentTarget.classList.add('active');
      STATE.currentAbnormalType = e.currentTarget.getAttribute('data-type');
      refresh();
    });
  });

  $('btnReset').addEventListener('click', () => {
    startEl.value = meta.date_range[0]; endEl.value = meta.date_range[1];
    $('fRegion').value = 'all'; $('fChannel').value = 'all'; $('fCategory').value = 'all';
    tabs.forEach(t => t.classList.remove('active'));
    tabs[0].classList.add('active');
    STATE.currentAbnormalType = 'all';
    refresh();
  });

  $('dataMeta').textContent =
    `数据范围：${meta.date_range[0]} ~ ${meta.date_range[1]} ｜ 订单明细 ${meta.order_rows.toLocaleString()} 行 ｜ 脱敏模拟数据`;
}

function readFilters() {
  const meta = STATE.dashboard._meta;
  return {
    start: $('fStart').value || meta.date_range[0],
    end: $('fEnd').value || meta.date_range[1],
    region: $('fRegion').value,
    channel: $('fChannel').value,
    category: $('fCategory').value,
    abnormalType: STATE.currentAbnormalType,
  };
}

function filterFacts(filters) {
  return STATE.facts.filter(r => {
    if (r.ym < filters.start || r.ym > filters.end) return false;
    if (filters.region !== 'all' && r.region !== filters.region) return false;
    if (filters.channel !== 'all' && r.channel !== filters.channel) return false;
    if (filters.category !== 'all' && r.category !== filters.category) return false;
    return true;
  });
}

function targetSumByRegion(filters) {
  const map = {};
  STATE.targetFacts.forEach(t => {
    if (t.ym < filters.start || t.ym > filters.end) return;
    if (filters.region !== 'all' && t.region !== filters.region) return;
    map[t.region] = (map[t.region] || 0) + t.target_sales;
  });
  return map;
}

function targetSumByMonth(filters) {
  const map = {};
  STATE.targetFacts.forEach(t => {
    if (t.ym < filters.start || t.ym > filters.end) return;
    if (filters.region !== 'all' && t.region !== filters.region) return;
    map[t.ym] = (map[t.ym] || 0) + t.target_sales;
  });
  return map;
}

/* ============================================================
 * 核心计算
 * ============================================================ */
function computeView(filters) {
  const facts = filterFacts(filters);
  const completionDisabled = filters.channel !== 'all' || filters.category !== 'all';

  let sales = 0, cost = 0, refund = 0;
  const orderSet = new Set();
  facts.forEach(r => {
    sales += (r.sales || 0); cost += (r.cost_amount || 0); refund += (r.refund_amount || 0); orderSet.add(r.order_id);
  });
  const gp = sales - cost;
  const orderCount = orderSet.size;
  const aov = orderCount > 0 ? sales / orderCount : 0;
  const gm = sales > 0 ? gp / sales : 0;
  const rr = sales > 0 ? refund / sales : 0;
  const regionTargets = targetSumByRegion(filters);
  const targetSum = Object.values(regionTargets).reduce((a, b) => a + b, 0);
  const completion = (completionDisabled || targetSum <= 0) ? null : sales / targetSum;

  /* 月度趋势 */
  const monthMap = {};
  facts.forEach(r => {
    if (!monthMap[r.ym]) monthMap[r.ym] = { sales: 0, gp: 0 };
    monthMap[r.ym].sales += (r.sales || 0);
    monthMap[r.ym].gp += (r.sales || 0) - (r.cost_amount || 0);
  });
  const monthTargets = targetSumByMonth(filters);
  const trend = Object.keys(monthMap).sort().map(m => ({
    ym: m, sales: monthMap[m].sales, gross_profit: monthMap[m].gp,
    gross_margin: monthMap[m].sales > 0 ? monthMap[m].gp / monthMap[m].sales : 0,
    target_sales: monthTargets[m] || 0,
  }));

  /* 区域 */
  const regionMap = {};
  facts.forEach(r => {
    if (!regionMap[r.region]) regionMap[r.region] = { sales: 0, cost: 0 };
    regionMap[r.region].sales += (r.sales || 0);
    regionMap[r.region].cost += (r.cost_amount || 0);
  });
  const regions = Object.entries(regionMap).map(([region, v]) => {
    const g = v.sales - v.cost;
    const target = regionTargets[region] || 0;
    return {
      region, sales: v.sales, gross_profit: g, gross_margin: v.sales > 0 ? g / v.sales : 0,
      sales_share: sales > 0 ? v.sales / sales : 0, target_sales: target,
      completion_rate: (completionDisabled || target <= 0) ? null : v.sales / target,
    };
  }).sort((a, b) => b.sales - a.sales);

  /* 品类 */
  const catMap = {};
  facts.forEach(r => {
    if (!catMap[r.category]) catMap[r.category] = { sales: 0, cost: 0 };
    catMap[r.category].sales += (r.sales || 0); catMap[r.category].cost += (r.cost_amount || 0);
  });
  const categories = Object.entries(catMap).map(([category, v]) => {
    const g = v.sales - v.cost;
    return {
      category, sales: v.sales, gross_profit: g, gross_margin: v.sales > 0 ? g / v.sales : 0,
      sales_share: sales > 0 ? v.sales / sales : 0,
    };
  }).sort((a, b) => b.sales - a.sales);

  /* 渠道 */
  const channelMap = {};
  facts.forEach(r => {
    if (!channelMap[r.channel]) channelMap[r.channel] = { sales: 0, cost: 0, orders: new Set() };
    channelMap[r.channel].sales += (r.sales || 0);
    channelMap[r.channel].cost += (r.cost_amount || 0);
    channelMap[r.channel].orders.add(r.order_id);
  });
  const channels = Object.entries(channelMap).map(([channel, v]) => {
    const g = v.sales - v.cost;
    return {
      channel, sales: v.sales, gross_profit: g,
      gross_margin: v.sales > 0 ? g / v.sales : 0,
      sales_share: sales > 0 ? v.sales / sales : 0,
      order_count: v.orders.size,
    };
  }).sort((a, b) => b.sales - a.sales);

  /* 客户 */
  const custMap = {};
  facts.forEach(r => {
    const c = custMap[r.customer_id] || (custMap[r.customer_id] = {
      customer_id: r.customer_id, customer_name: r.customer_name,
      customer_level: r.customer_level, region: r.region, sales: 0, cost: 0, refund: 0,
    });
    c.sales += (r.sales || 0);
    c.cost += (r.cost_amount || 0);
    c.refund += (r.refund_amount || 0);
  });
  const customers = Object.values(custMap).map(c => ({
    ...c, gross_profit: c.sales - c.cost,
    gross_margin: c.sales > 0 ? (c.sales - c.cost) / c.sales : 0,
    refund_rate: c.sales > 0 ? c.refund / c.sales : 0,
  })).sort((a, b) => b.sales - a.sales).slice(0, 10);

  /* 客户等级结构 */
  const levelMap = {};
  Object.values(custMap).forEach(c => {
    const lv = c.customer_level || '未分级';
    if (!levelMap[lv]) levelMap[lv] = { level: lv, sales: 0, cost: 0, customers: 0 };
    levelMap[lv].sales += (c.sales || 0);
    levelMap[lv].cost += (c.cost || 0);
    levelMap[lv].customers += 1;
  });
  const LEVEL_ORDER = { '战略': 0, '重点': 1, '普通': 2, '未分级': 3 };
  const customerLevels = Object.values(levelMap).map(v => {
    const g = (v.sales || 0) - (v.cost || 0);
    return {
      level: v.level, sales: v.sales, gross_profit: g,
      gross_margin: v.sales > 0 ? g / v.sales : 0,
      customer_count: v.customers,
      sales_share: sales > 0 ? v.sales / sales : 0,
      aov: v.customers > 0 ? v.sales / v.customers : 0,
    };
  }).sort((a, b) => (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9));

  /* 折扣分桶 */
  const DISCOUNT_BINS = [
    { key: '0-10%',  min: 0,    max: 0.10 },
    { key: '10-20%', min: 0.10, max: 0.20 },
    { key: '20-30%', min: 0.20, max: 0.30 },
    { key: '30-40%', min: 0.30, max: 0.40 },
    { key: '≥40%',   min: 0.40, max: Infinity },
  ];
  const discountBuckets = DISCOUNT_BINS.map(b => ({ label: b.key, count: 0, sales: 0 }));
  facts.forEach(r => {
    const d = r.discount || 0;
    for (let i = 0; i < DISCOUNT_BINS.length; i++) {
      const b = DISCOUNT_BINS[i];
      if (d >= b.min && d < b.max) {
        discountBuckets[i].count += 1;
        discountBuckets[i].sales += (r.sales || 0);
        break;
      }
    }
  });

  /* 退款分桶 */
  const REFUND_BINS = [
    { key: '无退款',    test: v => v === 0 },
    { key: '0-5%',     test: v => v > 0 && v <= 0.05 },
    { key: '5-10%',    test: v => v > 0.05 && v <= 0.10 },
    { key: '10-50%',   test: v => v > 0.10 && v <= 0.50 },
    { key: '≥50%',     test: v => v > 0.50 },
  ];
  const refundBuckets = REFUND_BINS.map(b => ({ label: b.key, count: 0, sales: 0 }));
  facts.forEach(r => {
    const v = r.sales > 0 ? (r.refund_amount || 0) / r.sales : 0;
    for (let i = 0; i < REFUND_BINS.length; i++) {
      if (REFUND_BINS[i].test(v)) {
        refundBuckets[i].count += 1;
        refundBuckets[i].sales += (r.sales || 0);
        break;
      }
    }
  });

  /* 渠道 × 品类 毛利矩阵 */
  const ccMap = {};
  facts.forEach(r => {
    const key = `${r.channel}||${r.category}`;
    if (!ccMap[key]) ccMap[key] = { sales: 0, cost: 0 };
    ccMap[key].sales += (r.sales || 0);
    ccMap[key].cost += (r.cost_amount || 0);
  });
  const channelNames = [...new Set(facts.map(r => r.channel))];
  const categoryNames = [...new Set(facts.map(r => r.category))];
  const ccData = [];
  let ccMax = 0, ccMin = 0;
  channelNames.forEach((ch, ci) => {
    categoryNames.forEach((cat, ki) => {
      const v = ccMap[`${ch}||${cat}`];
      if (!v || v.sales <= 0) return;
      const gm = (v.sales - v.cost) / v.sales;
      ccMax = Math.max(ccMax, gm);
      ccMin = Math.min(ccMin, gm);
      ccData.push({ value: [ki, ci, +gm.toFixed(4)], sales: v.sales, ch, cat });
    });
  });

  /* 异常订单 */
  let abnormal = facts.filter(r =>
    r.gross_margin < 0 || r.discount > 0.30 || (r.sales > 0 && r.refund_amount > r.sales * 0.5)
  ).map(r => {
    const reasons = [];
    if (r.gross_margin < 0) reasons.push('负毛利');
    if (r.discount > 0.30) reasons.push('高折扣');
    if (r.sales > 0 && r.refund_amount > r.sales * 0.5) reasons.push('高退款');
    return { ...r, abnormal_reason: reasons.join('；') };
  });
  if (filters.abnormalType !== 'all') {
    abnormal = abnormal.filter(r => r.abnormal_reason.includes(filters.abnormalType));
  }
  abnormal.sort((a, b) => b.sales - a.sales);

  return {
    completionDisabled,
    kpi: {
      sales, gross_profit: gp, gross_margin: gm, order_count: orderCount,
      avg_order_value: aov, refund_amount: refund, refund_rate: rr,
      target_sales: targetSum, completion_rate: completion,
    },
    trend, regions, categories, channels, customers,
    customerLevels, discountBuckets, refundBuckets,
    channelCategoryMatrix: { channels: channelNames, categories: categoryNames, data: ccData, min: ccMin, max: ccMax },
    abnormal, filters,
  };
}

/* ============================================================
 * 图表基础设施
 * ============================================================ */
function chart(id) {
  if (!STATE.charts[id]) {
    const el = $(id);
    if (!el) return null;
    STATE.charts[id] = echarts.init(el);
  }
  return STATE.charts[id];
}

function emptyChart(id, text = '当前筛选下无数据') {
  const c = chart(id);
  if (!c) return;
  c.clear();
  c.setOption({
    graphic: [{
      type: 'text', left: 'center', top: 'middle',
      style: { text, fill: C_FAINT, fontSize: 13, fontWeight: 500, textAlign: 'center', lineHeight: 20, fontFamily: FONT },
    }],
  });
}

/* ============================================================
 * KPI 卡片
 * ============================================================ */
function renderKpi(k) {
  const cards = [
    { label: '销售额', icon: ICON.sales, value: '¥' + fmtMoney(k.sales), sub: `目标 ¥${fmtMoney(k.target_sales)}`, accent: 'blue' },
    { label: '毛利', icon: ICON.profit, value: '¥' + fmtMoney(k.gross_profit), sub: `毛利率 ${fmtPct(k.gross_margin)}`, accent: k.gross_profit < 0 ? 'red' : 'green', warn: k.gross_profit < 0 },
    { label: '毛利率', icon: ICON.margin, value: fmtPct(k.gross_margin), sub: '毛利 ÷ 销售额', accent: k.gross_margin < 0.15 ? 'red' : 'cyan', warn: k.gross_margin < 0.15 },
    { label: '订单数', icon: ICON.orders, value: fmtInt(k.order_count), sub: '去重订单数', accent: 'purple' },
    { label: '客单价', icon: ICON.aov, value: '¥' + fmtNum(k.avg_order_value, 0), sub: '销售额 ÷ 订单数', accent: 'amber' },
    {
      label: '销售完成率', icon: ICON.target,
      value: k.completion_rate == null ? '—' : fmtPct(k.completion_rate),
      sub: k.completion_rate == null ? '含渠道/品类筛选，目标未拆分' : `实际 ¥${fmtMoney(k.sales)} / 目标 ¥${fmtMoney(k.target_sales)}`,
      accent: (k.completion_rate != null && k.completion_rate < 0.9) ? 'red' : 'pink',
      warn: k.completion_rate != null && k.completion_rate < 0.9,
    },
  ];

  $('kpiGrid').innerHTML = cards.map(c => `
    <div class="kpi-card accent-${c.accent} ${c.warn ? 'is-warn' : ''}">
      <div class="kpi-head">
        <span class="kpi-icon">${c.icon}</span>
        <span class="kpi-label">${c.label}</span>
      </div>
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-sub">${c.sub || '&nbsp;'}</div>
    </div>
  `).join('');
}

/* ============================================================
 * 趋势图
 * ============================================================ */
function renderTrend(trend) {
  if (!trend.length) return emptyChart('chartTrend');
  const c = chart('chartTrend');
  const months = trend.map(t => monthLabel(t.ym));
  const salesArr = trend.map(t => +t.sales.toFixed(2));
  const gmArr = trend.map(t => t.sales > 0 ? +t.gross_margin.toFixed(4) : null);
  const targetArr = trend.map(t => t.target_sales > 0 ? +t.target_sales.toFixed(2) : null);
  const showTarget = targetArr.some(v => v != null);

  const barGradient = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: '#3b82f6' }, { offset: 1, color: 'rgba(59,130,246,.10)' }
  ]);
  const areaGradient = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: 'rgba(217,119,6,.20)' }, { offset: 1, color: 'rgba(217,119,6,.01)' }
  ]);

  c.clear();
  c.setOption({
    textStyle: { fontFamily: FONT },
    tooltip: {
      ...TOOLTIP_STYLE, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(37,99,235,.06)' } },
      formatter: (params) => {
        let s = `<div style="font-weight:600;font-size:13px;margin-bottom:8px;color:${C_MAIN};">${params[0].axisValue}</div>`;
        params.forEach(p => {
          const val = p.seriesName === '毛利率' ? (p.value == null ? '—' : fmtPct(p.value)) : `¥${fmtNum(p.value, 2)}`;
          s += `<div style="display:flex;justify-content:space-between;gap:24px;font-size:12px;margin-bottom:5px;color:${C_AUX};">
                  <span>${p.marker}${p.seriesName}</span><span style="font-weight:600;color:${C_MAIN};white-space:nowrap;">${val}</span></div>`;
        });
        return s;
      },
    },
    legend: {
      top: 0, left: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 16,
      textStyle: { color: C_SUB, fontSize: 12, fontWeight: 500, fontFamily: FONT },
      data: ['销售额', ...(showTarget ? ['目标销售额'] : []), '毛利率'],
    },
    grid: { left: 10, right: 15, top: 46, bottom: 10, containLabel: true },
    xAxis: { type: 'category', data: months, axisLabel: { ...AXIS_LABEL, margin: 12 }, axisLine: AXIS_LINE, axisTick: { show: false } },
    yAxis: [
      { type: 'value', axisLabel: { formatter: v => fmtMoney(v, 0), ...AXIS_LABEL }, splitLine: SPLIT_LINE, axisLine: { show: false }, axisTick: { show: false } },
      { type: 'value', min: 0, axisLabel: { formatter: v => (v * 100).toFixed(0) + '%', ...AXIS_LABEL }, splitLine: { show: false }, axisLine: { show: false }, axisTick: { show: false } },
    ],
    series: [
      { name: '销售额', type: 'bar', data: salesArr, barWidth: '26%', showBackground: true, backgroundStyle: { color: 'rgba(37,99,235,.05)', borderRadius: [5, 5, 0, 0] }, itemStyle: { color: barGradient, borderRadius: [5, 5, 0, 0] } },
      ...(showTarget ? [{ name: '目标销售额', type: 'line', data: targetArr, symbol: 'none', lineStyle: { color: '#f87171', type: 'dashed', width: 1.5 } }] : []),
      { name: '毛利率', type: 'line', yAxisIndex: 1, data: gmArr, symbol: 'circle', symbolSize: 7, smooth: true, itemStyle: { color: '#d97706', borderColor: '#fff', borderWidth: 2 }, lineStyle: { color: '#d97706', width: 2.5 }, areaStyle: { color: areaGradient }, connectNulls: true },
    ],
    animationDuration: 800, animationEasing: 'cubicOut',
  });
}

/* ============================================================
 * 区域分布环形图
 * ============================================================ */
function renderRegionPie(regions) {
  if (!regions.length) return emptyChart('chartRegionPie');
  const c = chart('chartRegionPie');
  const totalSales = regions.reduce((sum, r) => sum + r.sales, 0);

  c.clear();
  c.setOption({
    textStyle: { fontFamily: FONT },
    color: PALETTE,
    tooltip: {
      ...TOOLTIP_STYLE, trigger: 'item',
      formatter: (p) => `<div style="font-weight:600;color:${C_MAIN};margin-bottom:5px;">${p.name}</div>
                         <div style="color:${C_AUX};font-size:12px;">销售额：<span style="font-weight:600;color:${C_MAIN};white-space:nowrap;">¥${fmtNum(p.value, 2)}</span></div>
                         <div style="color:${C_AUX};font-size:12px;">占比：<span style="font-weight:600;color:${C_MAIN};white-space:nowrap;">${fmtPct(p.data.share)}</span></div>`
    },
    legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 14, textStyle: { color: C_SUB, fontSize: 12, fontWeight: 500, fontFamily: FONT } },
    graphic: {
      type: 'group', left: 'center', top: 'center',
      children: [
        { type: 'text', style: { text: '总销售额', fontSize: 12, fontWeight: 500, fill: C_FAINT, textAlign: 'center', fontFamily: FONT }, top: -18 },
        { type: 'text', style: { text: '¥' + fmtMoney(totalSales), fontSize: 19, fontWeight: 700, fill: C_MAIN, textAlign: 'center', fontFamily: FONT }, top: 4 },
      ],
    },
    series: [{
      type: 'pie', radius: ['52%', '74%'], center: ['50%', '48%'],
      itemStyle: { borderColor: '#fff', borderWidth: 2.5 },
      label: {
        show: true, position: 'outside', formatter: '{name|{b}}\n{percent|{d}%}',
        rich: {
          name: { fontSize: 12, fontWeight: 500, color: C_AUX, padding: [0, 0, 3, 0], fontFamily: FONT },
          percent: { fontSize: 13, fontWeight: 700, color: C_MAIN, fontFamily: FONT },
        },
      },
      labelLine: { length: 10, length2: 10, lineStyle: { color: C_LINE, width: 1 } },
      data: regions.map(r => ({ name: r.region, value: +r.sales.toFixed(2), share: r.sales_share })),
      emphasis: { scale: true, scaleSize: 6 },
    }],
    animationDuration: 900, animationEasing: 'cubicOut',
  });
}

/* ============================================================
 * 品类结构环形图
 * ============================================================ */
function renderCategoryPie(categories) {
  if (!categories.length) return emptyChart('chartCategoryPie');
  const c = chart('chartCategoryPie');
  const totalSales = categories.reduce((sum, c) => sum + c.sales, 0);

  c.clear();
  c.setOption({
    textStyle: { fontFamily: FONT },
    color: PALETTE,
    tooltip: {
      ...TOOLTIP_STYLE, trigger: 'item',
      formatter: (p) => `<div style="font-weight:600;color:${C_MAIN};margin-bottom:5px;">${p.name}</div>
                         <div style="color:${C_AUX};font-size:12px;">销售额：<span style="font-weight:600;color:${C_MAIN};white-space:nowrap;">¥${fmtNum(p.value, 2)}</span></div>
                         <div style="color:${C_AUX};font-size:12px;">毛利率：<span style="font-weight:600;color:${C_MAIN};white-space:nowrap;">${fmtPct(p.data.gm)}</span></div>`
    },
    legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 14, textStyle: { color: C_SUB, fontSize: 12, fontWeight: 500, fontFamily: FONT } },
    graphic: {
      type: 'group', left: 'center', top: 'center',
      children: [
        { type: 'text', style: { text: '总销售额', fontSize: 12, fontWeight: 500, fill: C_FAINT, textAlign: 'center', fontFamily: FONT }, top: -18 },
        { type: 'text', style: { text: '¥' + fmtMoney(totalSales), fontSize: 19, fontWeight: 700, fill: C_MAIN, textAlign: 'center', fontFamily: FONT }, top: 4 },
      ],
    },
    series: [{
      type: 'pie', radius: ['52%', '74%'], center: ['50%', '48%'],
      itemStyle: { borderColor: '#fff', borderWidth: 2.5 },
      label: {
        show: true, position: 'outside', formatter: '{name|{b}}\n{percent|{d}%}',
        rich: {
          name: { fontSize: 12, fontWeight: 500, color: C_AUX, padding: [0, 0, 3, 0], fontFamily: FONT },
          percent: { fontSize: 13, fontWeight: 700, color: C_MAIN, fontFamily: FONT },
        },
      },
      labelLine: { length: 10, length2: 10, lineStyle: { color: C_LINE, width: 1 } },
      data: categories.map(cat => ({ name: cat.category, value: +cat.sales.toFixed(2), gm: cat.gross_margin })),
      emphasis: { scale: true, scaleSize: 6 },
    }],
    animationDuration: 900, animationEasing: 'cubicOut',
  });
}

/* ============================================================
 * 区域完成率横条
 * ============================================================ */
function renderRegionRate(regions, disabled) {
  if (disabled) return emptyChart('chartRegionRate', '含渠道/品类筛选\n目标未拆解，完成率不可比');
  const valid = regions.filter(r => r.completion_rate != null);
  if (!valid.length) return emptyChart('chartRegionRate', '目标数据缺失');

  const c = chart('chartRegionRate');
  const sorted = [...valid].sort((a, b) => a.completion_rate - b.completion_rate);

  const getColor = (rate) => {
    let start = '#dc2626', end = '#fca5a5';
    if (rate >= 1) { start = '#2563eb'; end = '#93c5fd'; }
    else if (rate >= 0.9) { start = '#d97706'; end = '#fcd34d'; }
    return new echarts.graphic.LinearGradient(1, 0, 0, 0, [{ offset: 0, color: start }, { offset: 1, color: end }]);
  };

  c.clear();
  c.setOption({
    textStyle: { fontFamily: FONT },
    tooltip: {
      ...TOOLTIP_STYLE, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(37,99,235,.06)' } },
      formatter: (p) => `<div style="font-weight:600;color:${C_MAIN};margin-bottom:5px;">${p[0].name}</div>
                         <div style="color:${C_AUX};font-size:12px;">完成率：<span style="font-weight:600;color:${C_MAIN};">${fmtPct(p[0].data.value)}</span></div>
                         <div style="color:${C_AUX};font-size:12px;">实际：¥${fmtMoney(p[0].data.actual)} / 目标：¥${fmtMoney(p[0].data.target)}</div>`
    },
    grid: { left: 10, right: 78, top: 10, bottom: 10, containLabel: true },
    xAxis: { type: 'value', max: 1.2, axisLabel: { formatter: v => (v * 100).toFixed(0) + '%', ...AXIS_LABEL }, splitLine: SPLIT_LINE, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: 'category', data: sorted.map(r => r.region), axisLabel: { color: C_SUB, fontWeight: 600, fontSize: 12.5, fontFamily: FONT }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{
      type: 'bar', barWidth: '42%',
      showBackground: true,
      backgroundStyle: { color: '#f4f7fc', borderRadius: 5 },
      data: sorted.map(r => ({
        value: r.completion_rate, actual: r.sales, target: r.target_sales,
        itemStyle: { color: getColor(r.completion_rate), borderRadius: 5 },
      })),
      label: { show: true, position: 'right', formatter: p => fmtPct(p.value), color: C_AUX, fontSize: 12, fontWeight: 600, fontFamily: FONT },
      markLine: { symbol: 'none', silent: true, data: [{ xAxis: 1, lineStyle: { color: C_FAINT, type: 'dashed', width: 1.5 } }], label: { show: false } },
    }],
    animationDuration: 900, animationEasing: 'cubicOut',
  });
}

/* ============================================================
 * 品类毛利横条
 * ============================================================ */
function renderCategoryMargin(categories) {
  if (!categories.length) return emptyChart('chartCategoryMargin');
  const c = chart('chartCategoryMargin');
  const sorted = [...categories].sort((a, b) => a.gross_margin - b.gross_margin);

  const getColor = (gm) => {
    let start = '#dc2626', end = '#fca5a5';
    if (gm >= 0.22) { start = '#15803d'; end = '#6ee7b7'; }
    else if (gm >= 0.15) { start = '#d97706'; end = '#fcd34d'; }
    return new echarts.graphic.LinearGradient(1, 0, 0, 0, [{ offset: 0, color: start }, { offset: 1, color: end }]);
  };

  c.clear();
  c.setOption({
    textStyle: { fontFamily: FONT },
    tooltip: {
      ...TOOLTIP_STYLE, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(37,99,235,.06)' } },
      formatter: (p) => `<div style="font-weight:600;color:${C_MAIN};margin-bottom:5px;">${p[0].name}</div>
                         <div style="color:${C_AUX};font-size:12px;">毛利率：<span style="font-weight:600;color:${C_MAIN};">${fmtPct(p[0].data.value)}</span></div>
                         <div style="color:${C_AUX};font-size:12px;">毛利：¥${fmtMoney(p[0].data.gp)} / 销售额：¥${fmtMoney(p[0].data.sales)}</div>`
    },
    grid: { left: 10, right: 78, top: 10, bottom: 10, containLabel: true },
    xAxis: { type: 'value', max: 0.4, axisLabel: { formatter: v => (v * 100).toFixed(0) + '%', ...AXIS_LABEL }, splitLine: SPLIT_LINE, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: 'category', data: sorted.map(c => c.category), axisLabel: { color: C_SUB, fontWeight: 600, fontSize: 12.5, fontFamily: FONT }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{
      type: 'bar', barWidth: '42%',
      showBackground: true,
      backgroundStyle: { color: '#f4f7fc', borderRadius: 5 },
      data: sorted.map(c => ({
        value: c.gross_margin, gp: c.gross_profit, sales: c.sales,
        itemStyle: { color: getColor(c.gross_margin), borderRadius: 5 },
      })),
      label: { show: true, position: 'right', formatter: p => fmtPct(p.value), color: C_AUX, fontSize: 12, fontWeight: 600, fontFamily: FONT },
      markLine: { symbol: 'none', silent: true, data: [{ xAxis: 0.20, lineStyle: { color: C_FAINT, type: 'dashed', width: 1.5 } }], label: { show: false } },
    }],
    animationDuration: 900, animationEasing: 'cubicOut',
  });
}

/* ============================================================
 * 渠道业绩分析
 * ============================================================ */
function renderChannel(channels) {
  if (!channels.length) return emptyChart('chartChannel');
  const c = chart('chartChannel');

  const names = channels.map(x => x.channel);
  const salesArr = channels.map(x => +x.sales.toFixed(2));
  const gmArr = channels.map(x => x.sales > 0 ? +x.gross_margin.toFixed(4) : null);

  const barGradient = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: '#6d28d9' }, { offset: 1, color: 'rgba(109,40,217,.10)' }
  ]);

  c.clear();
  c.setOption({
    textStyle: { fontFamily: FONT },
    tooltip: {
      ...TOOLTIP_STYLE, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(109,40,217,.06)' } },
      formatter: (params) => {
        const item = channels.find(x => x.channel === params[0].axisValue);
        if (!item) return '';
        return `<div style="font-weight:600;font-size:13px;margin-bottom:8px;color:${C_MAIN};">${item.channel}</div>
          <div style="display:flex;justify-content:space-between;gap:24px;font-size:12px;margin-bottom:5px;color:${C_AUX};"><span>销售额</span><span style="font-weight:600;color:${C_MAIN};white-space:nowrap;">¥${fmtNum(item.sales, 2)}</span></div>
          <div style="display:flex;justify-content:space-between;gap:24px;font-size:12px;margin-bottom:5px;color:${C_AUX};"><span>毛利率</span><span style="font-weight:600;color:${C_MAIN};white-space:nowrap;">${fmtPct(item.gross_margin)}</span></div>
          <div style="display:flex;justify-content:space-between;gap:24px;font-size:12px;margin-bottom:5px;color:${C_AUX};"><span>订单数</span><span style="font-weight:600;color:${C_MAIN};white-space:nowrap;">${fmtInt(item.order_count)}</span></div>
          <div style="display:flex;justify-content:space-between;gap:24px;font-size:12px;color:${C_AUX};"><span>销售占比</span><span style="font-weight:600;color:${C_MAIN};white-space:nowrap;">${fmtPct(item.sales_share)}</span></div>`;
      },
    },
    legend: { top: 0, left: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 16, textStyle: { color: C_SUB, fontSize: 12, fontWeight: 500, fontFamily: FONT }, data: ['销售额', '毛利率'] },
    grid: { left: 10, right: 15, top: 46, bottom: 10, containLabel: true },
    xAxis: { type: 'category', data: names, axisLabel: { ...AXIS_LABEL, margin: 12 }, axisLine: AXIS_LINE, axisTick: { show: false } },
    yAxis: [
      { type: 'value', axisLabel: { formatter: v => fmtMoney(v, 0), ...AXIS_LABEL }, splitLine: SPLIT_LINE, axisLine: { show: false }, axisTick: { show: false } },
      { type: 'value', min: 0, axisLabel: { formatter: v => (v * 100).toFixed(0) + '%', ...AXIS_LABEL }, splitLine: { show: false }, axisLine: { show: false }, axisTick: { show: false } },
    ],
    series: [
      { name: '销售额', type: 'bar', data: salesArr, barWidth: '34%', showBackground: true, backgroundStyle: { color: 'rgba(109,40,217,.05)', borderRadius: [5, 5, 0, 0] }, itemStyle: { color: barGradient, borderRadius: [5, 5, 0, 0] } },
      { name: '毛利率', type: 'line', yAxisIndex: 1, data: gmArr, symbol: 'circle', symbolSize: 7, smooth: true, itemStyle: { color: '#d97706', borderColor: '#fff', borderWidth: 2 }, lineStyle: { color: '#d97706', width: 2.5 }, connectNulls: true },
    ],
    animationDuration: 900, animationEasing: 'cubicOut',
  });
}

/* ============================================================
 * 目标达成仪表盘
 * ============================================================ */
function renderGauge(rate, actual, target, disabled) {
  if (disabled) return emptyChart('chartGauge', '含渠道/品类筛选\n目标未拆解，完成率不可计算');
  if (rate == null || !target || target <= 0) return emptyChart('chartGauge', '目标数据缺失');

  const c = chart('chartGauge');
  const colorStart = rate >= 1 ? '#15803d' : rate >= 0.9 ? '#d97706' : '#dc2626';
  const colorEnd   = rate >= 1 ? '#6ee7b7' : rate >= 0.9 ? '#fcd34d' : '#fca5a5';
  const axisMax = Math.max(1.2, Math.ceil(rate * 10) / 10 + 0.2);

  c.clear();
  c.setOption({
    textStyle: { fontFamily: FONT },
    series: [{
      type: 'gauge',
      startAngle: 215, endAngle: -35,
      min: 0, max: axisMax, radius: '86%', center: ['50%', '56%'],
      progress: { show: true, roundCap: true, width: 16, itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: colorStart }, { offset: 1, color: colorEnd }]) } },
      axisLine: { roundCap: true, lineStyle: { width: 16, color: [[1, '#eef2f7']] } },
      pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, anchor: { show: false }, title: { show: false },
      detail: { valueAnimation: true, offsetCenter: [0, '-14%'], formatter: v => fmtPct(v), fontSize: 32, fontWeight: 700, color: C_MAIN, fontFamily: FONT },
      data: [{ value: rate }],
    }],
    graphic: [
      { type: 'text', left: 'center', top: '60%', style: { text: '销售目标完成率', fill: C_FAINT, fontSize: 12, fontWeight: 500, textAlign: 'center', fontFamily: FONT } },
      { type: 'text', left: 'center', top: '70%', style: { text: `实际 ¥${fmtMoney(actual)}  ·  目标 ¥${fmtMoney(target)}`, fill: C_AUX, fontSize: 12, fontWeight: 500, textAlign: 'center', fontFamily: FONT } },
    ],
    animationDuration: 1100, animationEasing: 'cubicOut',
  });
}

/* ============================================================
 * 客户等级业绩结构
 * ============================================================ */
function renderCustomerLevel(levels) {
  if (!levels || !levels.length) return emptyChart('chartCustomerLevel');
  const c = chart('chartCustomerLevel');

  const levelColor = { '战略': '#6d28d9', '重点': '#2563eb', '普通': '#0e7490', '未分级': '#64748b' };

  c.clear();
  c.setOption({
    textStyle: { fontFamily: FONT },
    tooltip: {
      ...TOOLTIP_STYLE, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(37,99,235,.06)' } },
      formatter: (params) => {
        const item = levels.find(x => x.level === params[0].axisValue);
        if (!item) return '';
        return `<div style="font-weight:600;font-size:13px;margin-bottom:8px;color:${C_MAIN};">${item.level}客户</div>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:32px;font-size:12px;margin-bottom:5px;color:${C_AUX};">
            <span style="white-space:nowrap;">销售额</span>
            <span style="font-weight:600;color:${C_MAIN};font-variant-numeric:tabular-nums;white-space:nowrap;">¥${fmtNum(item.sales, 2)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:32px;font-size:12px;margin-bottom:5px;color:${C_AUX};">
            <span style="white-space:nowrap;">销售占比</span>
            <span style="font-weight:600;color:${C_MAIN};font-variant-numeric:tabular-nums;white-space:nowrap;">${fmtPct(item.sales_share)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:32px;font-size:12px;margin-bottom:5px;color:${C_AUX};">
            <span style="white-space:nowrap;">毛利率</span>
            <span style="font-weight:600;color:${C_MAIN};font-variant-numeric:tabular-nums;white-space:nowrap;">${fmtPct(item.gross_margin)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:32px;font-size:12px;margin-bottom:5px;color:${C_AUX};">
            <span style="white-space:nowrap;">客户数</span>
            <span style="font-weight:600;color:${C_MAIN};font-variant-numeric:tabular-nums;white-space:nowrap;">${fmtInt(item.customer_count)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:32px;font-size:12px;color:${C_AUX};">
            <span style="white-space:nowrap;">户均贡献</span>
            <span style="font-weight:600;color:${C_MAIN};font-variant-numeric:tabular-nums;white-space:nowrap;">¥${fmtMoney(item.aov)}</span>
          </div>`;
      },
    },
    legend: { top: 0, left: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 16, textStyle: { color: C_SUB, fontSize: 12, fontWeight: 500, fontFamily: FONT }, data: ['销售额', '毛利率'] },
    grid: { left: 10, right: 15, top: 46, bottom: 10, containLabel: true },
    xAxis: { type: 'category', data: levels.map(l => l.level), axisLabel: { ...AXIS_LABEL, margin: 12 }, axisLine: AXIS_LINE, axisTick: { show: false } },
    yAxis: [
      { type: 'value', axisLabel: { formatter: v => fmtMoney(v, 0), ...AXIS_LABEL }, splitLine: SPLIT_LINE, axisLine: { show: false }, axisTick: { show: false } },
      { type: 'value', min: 0, axisLabel: { formatter: v => (v * 100).toFixed(0) + '%', ...AXIS_LABEL }, splitLine: { show: false }, axisLine: { show: false }, axisTick: { show: false } },
    ],
    series: [
      {
        name: '销售额', type: 'bar', barWidth: '34%',
        data: levels.map(l => ({ value: +l.sales.toFixed(2), itemStyle: { color: levelColor[l.level] || '#2563eb', borderRadius: [6, 6, 0, 0] } })),
      },
      {
        name: '毛利率', type: 'line', yAxisIndex: 1,
        data: levels.map(l => +(l.gross_margin || 0).toFixed(4)),
        symbol: 'circle', symbolSize: 8, smooth: true,
        itemStyle: { color: '#d97706', borderColor: '#fff', borderWidth: 2 },
        lineStyle: { color: '#d97706', width: 2.5 },
        label: { show: true, position: 'top', formatter: p => fmtPct(p.value), color: C_AUX, fontSize: 11.5, fontWeight: 600, fontFamily: FONT },
      },
    ],
    animationDuration: 900, animationEasing: 'cubicOut',
  });
}

/* ============================================================
 * 折扣与退款健康度分布
 * ============================================================ */
function renderDiscountHealth(discountBuckets, refundBuckets) {
  if ((!discountBuckets || !discountBuckets.length) && (!refundBuckets || !refundBuckets.length)) {
    return emptyChart('chartDiscountHealth');
  }
  const c = chart('chartDiscountHealth');

  const labels = [...new Set([...discountBuckets.map(b => b.label), ...refundBuckets.map(b => b.label)])];
  const discountLookup = Object.fromEntries(discountBuckets.map(b => [b.label, b.count]));
  const refundLookup   = Object.fromEntries(refundBuckets.map(b => [b.label, b.count]));

  c.clear();
  c.setOption({
    textStyle: { fontFamily: FONT },
    tooltip: {
      ...TOOLTIP_STYLE, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(37,99,235,.06)' } },
    },
    legend: { top: 0, left: 'center', icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 16, textStyle: { color: C_SUB, fontSize: 12, fontWeight: 500, fontFamily: FONT }, data: ['折扣分桶', '退款分桶'] },
    grid: { left: 10, right: 15, top: 46, bottom: 10, containLabel: true },
    xAxis: { type: 'category', data: labels, axisLabel: { ...AXIS_LABEL, margin: 12, interval: 0 }, axisLine: AXIS_LINE, axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: { ...AXIS_LABEL }, splitLine: SPLIT_LINE, axisLine: { show: false }, axisTick: { show: false } },
    series: [
      {
        name: '折扣分桶', type: 'bar', barWidth: '32%',
        data: labels.map(l => ({
          value: discountLookup[l] || 0,
          itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#2563eb' }, { offset: 1, color: 'rgba(37,99,235,.15)' }]), borderRadius: [5, 5, 0, 0] },
        })),
      },
      {
        name: '退款分桶', type: 'bar', barWidth: '32%',
        data: labels.map(l => ({
          value: refundLookup[l] || 0,
          itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#dc2626' }, { offset: 1, color: 'rgba(220,38,38,.15)' }]), borderRadius: [5, 5, 0, 0] },
        })),
      },
    ],
    animationDuration: 900, animationEasing: 'cubicOut',
  });
}

/* ============================================================
 * 渠道 × 品类 毛利热力图
 * ============================================================ */
function renderChannelCategoryHeat(matrix) {
  if (!matrix || !matrix.data.length) return emptyChart('chartChannelCategoryHeat');
  const c = chart('chartChannelCategoryHeat');

  const { channels, categories, data, min, max } = matrix;

  c.clear();
  c.setOption({
    textStyle: { fontFamily: FONT },
    tooltip: {
      ...TOOLTIP_STYLE, trigger: 'item',
      formatter: (p) => {
        const v = p.data;
        return `<div style="font-weight:600;font-size:13px;margin-bottom:6px;color:${C_MAIN};">${v.ch} · ${v.cat}</div>
                <div style="color:${C_AUX};font-size:12px;margin-bottom:4px;">毛利率：<span style="font-weight:600;color:${C_MAIN};white-space:nowrap;">${fmtPct(v.value[2])}</span></div>
                <div style="color:${C_AUX};font-size:12px;">销售额：<span style="font-weight:600;color:${C_MAIN};white-space:nowrap;">¥${fmtNum(v.sales, 2)}</span></div>`;
      },
    },
    grid: { left: 10, right: 24, top: 16, bottom: 60, containLabel: true },
    xAxis: {
      type: 'category', data: categories,
      axisLabel: { color: C_SUB, fontSize: 12.5, fontWeight: 600, fontFamily: FONT },
      axisLine: { show: false }, axisTick: { show: false }, splitArea: { show: false },
    },
    yAxis: {
      type: 'category', data: channels,
      axisLabel: { color: C_SUB, fontSize: 12.5, fontWeight: 600, fontFamily: FONT },
      axisLine: { show: false }, axisTick: { show: false },
    },
    visualMap: {
      min: Math.min(min, 0), max: Math.max(max, 0.3),
      calculable: false, orient: 'horizontal', left: 'center', bottom: 8,
      itemWidth: 12, itemHeight: 120,
      text: ['高毛利', '低毛利'],
      textStyle: { color: C_AUX, fontWeight: 500, fontSize: 11.5, fontFamily: FONT },
      inRange: { color: ['#dc2626', '#f59e0b', '#fbbf24', '#86efac', '#16a34a'] },
    },
    series: [{
      type: 'heatmap',
      data: data,
      label: {
        show: true,
        formatter: p => fmtPct(p.data.value[2], 1),
        fontSize: 12, fontWeight: 600, color: '#fff', fontFamily: FONT,
        textBorderColor: 'rgba(0,0,0,.25)', textBorderWidth: 1,
      },
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 3 },
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(15,23,42,.25)' } },
    }],
    animationDuration: 900, animationEasing: 'cubicOut',
  });
}

/* ============================================================
 * 客户表
 * ============================================================ */
function renderCustomerTable(customers) {
  if (!customers.length) {
    $('tblCustomer').innerHTML =
      '<thead><tr><th>#</th><th>客户</th><th class="num">销售额</th></tr></thead>' +
      '<tbody><tr><td colspan="8" class="empty">当前筛选下无客户数据</td></tr></tbody>';
    return;
  }
  $('tblCustomer').innerHTML = `
    <thead><tr><th>#</th><th>客户名称</th><th>等级</th><th>区域</th><th class="num">销售额</th><th class="num">毛利</th><th class="num">毛利率</th><th class="num">退款率</th></tr></thead>
    <tbody>
      ${customers.map((c, i) => {
        const risk = c.gross_margin < 0 || c.refund_rate > 0.10;
        return `<tr class="${risk ? 'row-warn' : ''}">
          <td style="color:${C_FAINT};font-weight:600;">${i + 1}</td>
          <td>${c.customer_name}</td>
          <td>${c.customer_level || '—'}</td>
          <td>${c.region || '—'}</td>
          <td class="num">¥${fmtMoney(c.sales)}</td>
          <td class="num">¥${fmtMoney(c.gross_profit)}</td>
          <td class="num ${c.gross_margin < 0 ? 'text-danger' : ''}">${fmtPct(c.gross_margin)}</td>
          <td class="num ${c.refund_rate > 0.10 ? 'text-danger' : ''}">${fmtPct(c.refund_rate)}</td>
        </tr>`;
      }).join('')}
    </tbody>`;
}

/* ============================================================
 * 库存表
 * ============================================================ */
function renderInventory(filters) {
  const dash = STATE.dashboard.inventoryWarning;
  let slow = dash.slowMoving || [];
  let turnover = dash.turnoverTop || [];
  if (filters.category !== 'all') {
    slow = slow.filter(x => x.category === filters.category);
    turnover = turnover.filter(x => x.category === filters.category);
  }

  if (!slow.length) {
    $('tblSlow').innerHTML =
      '<thead><tr><th>SKU</th><th>商品</th><th class="num">库存</th></tr></thead>' +
      '<tbody><tr><td colspan="5" class="empty">当前筛选下无滞销 SKU</td></tr></tbody>';
  } else {
    $('tblSlow').innerHTML = `
      <thead><tr><th>SKU 编码</th><th>商品名称</th><th>品类</th><th class="num">当前库存</th><th class="num">近30天销量</th></tr></thead>
      <tbody>${slow.map(s => `<tr class="row-warn">
        <td>${s.sku_id}</td><td>${s.product_name || '—'}</td><td>${s.category}</td>
        <td class="num">${fmtInt(s.current_stock)}</td>
        <td class="num text-danger">${fmtInt(s.sales_30d)}</td>
      </tr>`).join('')}</tbody>`;
  }

  if (!turnover.length) {
    $('tblTurnover').innerHTML =
      '<thead><tr><th>SKU</th><th>商品</th><th class="num">周转天数</th></tr></thead>' +
      '<tbody><tr><td colspan="6" class="empty">当前筛选下无数据</td></tr></tbody>';
  } else {
    $('tblTurnover').innerHTML = `
      <thead><tr><th>SKU 编码</th><th>商品名称</th><th>品类</th><th class="num">库存</th><th class="num">近30天销量</th><th class="num">周转天数</th></tr></thead>
      <tbody>${turnover.map(s => `<tr>
        <td>${s.sku_id}</td><td>${s.product_name || '—'}</td><td>${s.category}</td>
        <td class="num">${fmtInt(s.current_stock)}</td>
        <td class="num">${fmtInt(s.sales_30d)}</td>
        <td class="num ${s.turnover_days > 90 ? 'text-danger' : ''}">${s.turnover_days != null ? s.turnover_days.toFixed(1) + ' 天' : '—'}</td>
      </tr>`).join('')}</tbody>`;
  }
}

/* ============================================================
 * 异常订单表
 * ============================================================ */
function renderAbnormal(rows) {
  if (!rows.length) {
    $('tblAbnormal').innerHTML =
      '<thead><tr><th>订单号</th><th>客户</th><th class="num">销售额</th><th class="num">毛利率</th><th>异常原因</th></tr></thead>' +
      '<tbody><tr><td colspan="10" class="empty">当前筛选下无此类异常订单</td></tr></tbody>';
    return;
  }
  const shown = rows.slice(0, 100);
  $('tblAbnormal').innerHTML = `
    <thead><tr><th>订单号</th><th>月份</th><th>客户名称</th><th>区域</th><th>渠道</th><th>品类</th><th class="num">销售额</th><th class="num">毛利率</th><th class="num">折扣</th><th>异常原因</th></tr></thead>
    <tbody>
      ${shown.map(r => `<tr class="row-warn">
        <td>${r.order_id}</td><td>${r.ym}</td><td>${r.customer_name}</td><td>${r.region}</td><td>${r.channel}</td><td>${r.category}</td>
        <td class="num">¥${fmtNum(r.sales, 2)}</td>
        <td class="num ${r.gross_margin < 0 ? 'text-danger' : ''}">${fmtPct(r.gross_margin)}</td>
        <td class="num ${r.discount > 0.30 ? 'text-danger' : ''}">${fmtPct(r.discount, 0)}</td>
        <td><span class="tag">${r.abnormal_reason}</span></td>
      </tr>`).join('')}
    </tbody>
    <tfoot><tr><td colspan="10" class="table-foot">共 ${rows.length} 条记录，当前展示前 ${shown.length} 条</td></tr></tfoot>`;
}

/* ============================================================
 * 刷新
 * ============================================================ */
function refresh() {
  const filters = readFilters();
  const view = computeView(filters);

  renderKpi(view.kpi);
  renderTrend(view.trend);
  renderRegionPie(view.regions);
  renderRegionRate(view.regions, view.completionDisabled);
  renderCategoryPie(view.categories);
  renderCategoryMargin(view.categories);
  renderChannel(view.channels);
  renderGauge(view.kpi.completion_rate, view.kpi.sales, view.kpi.target_sales, view.completionDisabled);
  renderCustomerLevel(view.customerLevels);
  renderDiscountHealth(view.discountBuckets, view.refundBuckets);
  renderChannelCategoryHeat(view.channelCategoryMatrix);
  renderCustomerTable(view.customers);
  renderInventory(filters);
  renderAbnormal(view.abnormal);
}

/* ============================================================
 * 初始化
 * ============================================================ */
window.addEventListener('resize', () => {
  Object.values(STATE.charts).forEach(c => c && c.resize());
});

(async function init() {
  const ok = await loadData();
  if (!ok) return;
  initFilters();
  refresh();
})();
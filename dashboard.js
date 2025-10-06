(function(){
  const host = window.location.hostname;
  const queryParams = new URLSearchParams(window.location.search || '');
  const customApi = queryParams.get('api');
  const isLocalHost = !host || host === 'localhost' || host === '127.0.0.1';
  const BASE_URL = customApi
    ? customApi.replace(/\/?$/, '')
    : (isLocalHost ? 'http://localhost:5000/api' : 'https://backendcalculadora-adrr.onrender.com/api');

  const ADR_CARD_MAP = {
    'VALE': 'vale',
    'ITUB': 'itub',
    'PBR': 'pbr',
    'PBR-A': 'pbr-a',
    'BBD': 'bbd',
    'BBDO': 'bbdo',
    'ABEV': 'abev',
    'ERJ': 'erj',
    'BSBR': 'bsbr',
    'BDORY': 'bdory'
  };

  const sparklineStore = {};
  let tvLogsMuted = false;
  function muteTradingViewLogs(){
    if (tvLogsMuted) return;
    tvLogsMuted = true;
    try {
      const originalError = console.error.bind(console);
      const originalWarn = console.warn.bind(console);
      const stringify = (v) => {
        try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return String(v); }
      };
      const shouldBlock = (args) => {
        const msg = (args || []).map(stringify).join(' ');
        return (
          msg.includes('TradingView') ||
          msg.includes('Chart.DataProblemModel') ||
          msg.includes('support-portal-problems') ||
          msg.includes('telemetry.tradingview.com') ||
          msg.includes('Property:The state with a data type') ||
          msg.includes('does not match a schema')
        );
      };
      console.error = (...args) => { if (!shouldBlock(args)) originalError(...args); };
      console.warn = (...args) => { if (!shouldBlock(args)) originalWarn(...args); };
    } catch (_) {}
  }
  let latestAdrSnapshots = {};

  function isAdrSparkline(canvasId){
    if (!canvasId) return false;
    const suffix = canvasId.replace(/^(sparkline-|market-spark-)/, '');
    return Object.values(ADR_CARD_MAP).includes(suffix);
  }

  function getTooltipElement(canvasId){
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const wrapper = canvas.parentElement;
    if (!wrapper) return null;
    return wrapper.querySelector('.sparkline-tooltip');
  }

  async function fetchJSON(url, timeoutMs = 20000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  function setStatus(status, text){
    const el = document.getElementById('quotesStatus');
    if (!el) return;
    el.className = 'quotes-status';
    el.classList.add(status);
    const t = el.querySelector('.status-text');
    if (t) t.textContent = text;
  }

  function setLastUpdate(ts){
    const el = document.getElementById('lastQuoteUpdate');
    if (!el) return;
    try {
      const d = new Date(ts);
      el.textContent = d.toLocaleTimeString('pt-BR');
    } catch {
      el.textContent = 'Agora';
    }
  }

  function fmt(n, dp=2){
    if (n == null || isNaN(n)) return '--';
    return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }

  function parseTimestamp(value){
    if (!value) return null;
    const dt = value instanceof Date ? value : new Date(value);
    return isNaN(dt.getTime()) ? null : dt;
  }

  function formatTimestamp(value, opts = {}){
    const dt = parseTimestamp(value);
    if (!dt) return '--';
    const { showSeconds = false } = opts;
    return dt.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: showSeconds ? '2-digit' : undefined
    });
  }

  function resolveDataTimestamp(data, prefer = 'close'){
    if (!data) return null;
    if (prefer === 'after'){
      if (data.after_hours && data.after_hours.time) return data.after_hours.time;
      if (data.at_close && data.at_close.time) return data.at_close.time;
    } else {
      if (data.at_close && data.at_close.time) return data.at_close.time;
      if (data.after_hours && data.after_hours.time) return data.after_hours.time;
    }
    return data.timestamp || null;
  }

  function getDatasetLabel(data){
    if (!data) return '--';
    if (data.data_type === 'closing' || data.source === 'closing-price') return 'Fechamento oficial';
    if (data.after_hours && data.after_hours.available) return 'After Market';
    if (data.data_type === 'regular' || data.source === 'regular-market') return 'Mercado regular';
    return 'Dados do mercado';
  }

  function updateCard(id, data){
    const priceEl = document.getElementById(`${id}-price`);
    const changeEl = document.getElementById(`${id}-change`);
    const cardEl = document.getElementById(`quote-${id}`);
    if (!priceEl || !changeEl || !cardEl) return;

    if (!data) {
      priceEl.textContent = '--';
      changeEl.textContent = 'Sem dados';
      changeEl.className = 'quote-change no-data';
      cardEl.classList.remove('positive','negative','neutral');
      cardEl.classList.add('no-data');
      updateExtraFields(id, null);
      drawSparkline(`sparkline-${id}`, []);
      return;
    }

    priceEl.textContent = fmt(data.current);

    const ch = data.variation;
    if (ch == null || isNaN(ch)){
      changeEl.textContent = 'Sem dados';
      changeEl.className = 'quote-change no-data';
      cardEl.classList.remove('positive','negative','neutral');
      cardEl.classList.add('no-data');
    } else {
      const txt = (ch >= 0 ? '+' : '') + Number(ch).toFixed(2) + '%';
      changeEl.textContent = txt;
      changeEl.className = 'quote-change ' + (ch>0?'positive':(ch<0?'negative':'neutral'));
      cardEl.classList.remove('positive','negative','neutral','no-data');
      cardEl.classList.add(ch>0?'positive':(ch<0?'negative':'neutral'));
    }

    // At close / After hours
    updateExtraFields(id, data);

    const timestampEl = document.getElementById(`${id}-timestamp`);
    const labelEl = document.getElementById(`${id}-label`);
    if (timestampEl) {
      const tsValue = resolveDataTimestamp(data, 'after');
      timestampEl.textContent = formatTimestamp(tsValue);
    }
    if (labelEl) {
      labelEl.textContent = getDatasetLabel(data);
    }

    const closes = data.series && data.series.closes || [];
    const timestamps = data.series && data.series.timestamps || [];
    const defaultHighlight = isAdrSparkline(`sparkline-${id}`) ? { startHour: 17, endHour: 21 } : null;
    drawSparkline(`sparkline-${id}`, closes, undefined, timestamps, defaultHighlight);
  }

  function updateExtraFields(id, data){
    const atCloseEl = document.getElementById(`${id}-atclose`);
    const afterEl = document.getElementById(`${id}-afterhours`);
    if (!atCloseEl && !afterEl) return;

    if (!data){
      if (atCloseEl) atCloseEl.textContent = '--';
      if (afterEl) afterEl.textContent = '—';
      return;
    }

    const atClose = data.at_close || {};
    const after = data.after_hours || {};
    if (atCloseEl) {
      const change = atClose.change_percent != null ? fmt(atClose.change_percent) + '%' : '--';
      atCloseEl.textContent = atClose.price != null ? `${fmt(atClose.price)} (${change})` : '--';
    }
    if (afterEl) {
      if (after.available && after.price != null) {
        const change = after.change_percent != null ? after.change_percent.toFixed(2) + '%' : '--';
        afterEl.textContent = `${fmt(after.price)} (${change})`;
      } else {
        afterEl.textContent = 'Indisponível';
      }
    }
  }

  function drawSparkline(canvasId, values, strokeStyle, timestamps, highlightWindow){
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const tooltip = getTooltipElement(canvasId);
    const timeSeries = Array.isArray(timestamps) ? timestamps : [];
    const series = [];

    (values || []).forEach((val, idx) => {
      if (typeof val === 'number' && !isNaN(val)) {
        const tsRaw = timeSeries[idx];
        const tsParsed = tsRaw ? parseTimestamp(tsRaw) : null;
        series.push({ value: Number(val), tsRaw, tsParsed });
      }
    });

    if (series.length < 2) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width || 0, canvas.height || 0);
      delete sparklineStore[canvasId];
      if (tooltip) tooltip.classList.remove('visible');
      return;
    }

    const defaultHighlight = highlightWindow || (isAdrSparkline(canvasId) ? { startHour: 17, endHour: 21 } : null);
    const store = {
      values: series.map(s => s.value),
      timestamps: series.map(s => s.tsRaw),
      parsedTimestamps: series.map(s => s.tsParsed),
      strokeStyle,
      highlightWindow: defaultHighlight
    };

    renderSparkline(canvas, store);
    sparklineStore[canvasId] = store;
    bindSparklineEvents(canvasId);
  }

  function renderSparkline(canvas, store){
    if (!canvas || !store || !store.values || store.values.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const values = store.values;
    const timestamps = store.parsedTimestamps || [];
    const strokeColor = store.strokeStyle || (values[values.length - 1] >= values[0] ? '#22c55e' : '#ef4444');

    const w = canvas.width = canvas.clientWidth || 160;
    const h = canvas.height;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const rng = max - min || 1;

    ctx.clearRect(0, 0, w, h);

    const smoothed = smoothData(values);

    ctx.fillStyle = strokeColor;
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    smoothed.forEach((v, i) => {
      const x = (i / (smoothed.length - 1)) * w;
      const y = h - ((v - min) / rng) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.strokeStyle = strokeColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    smoothed.forEach((v, i) => {
      const x = (i / (smoothed.length - 1)) * w;
      const y = h - ((v - min) / rng) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const windowCfg = store.highlightWindow;
    if (windowCfg && timestamps.some(ts => ts instanceof Date)) {
      const mapped = timestamps
        .map((ts, idx) => ts ? { idx, ts } : null)
        .filter(Boolean);

      if (mapped.length) {
        const startDay = new Date(mapped[0].ts);
        startDay.setHours(0, 0, 0, 0);
        const endDay = new Date(mapped[mapped.length - 1].ts);
        endDay.setHours(0, 0, 0, 0);

        for (let day = new Date(startDay); day <= endDay; day.setDate(day.getDate() + 1)) {
          const startWindow = new Date(day);
          startWindow.setHours(windowCfg.startHour, 0, 0, 0);
          const endWindow = new Date(day);
          endWindow.setHours(windowCfg.endHour, 0, 0, 0);

          const startEntry = mapped.find(item => item.ts >= startWindow);
          const endEntry = [...mapped].reverse().find(item => item.ts <= endWindow);

          if (startEntry && endEntry && endEntry.idx >= startEntry.idx) {
            const totalPoints = values.length - 1;
            if (totalPoints <= 0) continue;
            const startRatio = startEntry.idx / totalPoints;
            const endRatio = endEntry.idx / totalPoints;
            const startX = Math.max(0, Math.min(1, startRatio)) * w;
            const endX = Math.max(0, Math.min(1, endRatio)) * w;

            ctx.save();
            ctx.globalAlpha = 0.22;
            ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
            ctx.fillRect(startX, 0, Math.max(4, endX - startX || 4), h);
            ctx.restore();
          }
        }
      }
    }

    store._dims = { min, max, rng, w, h };
    store._stroke = strokeColor;
  }

  function smoothData(values, factor = 0.3) {
    if (values.length < 3) return values;

    const smoothed = [...values];

    for (let i = 1; i < smoothed.length - 1; i++) {
      const prev = smoothed[i - 1];
      const curr = smoothed[i];
      const next = smoothed[i + 1];

      smoothed[i] = prev * factor + curr * (1 - 2 * factor) + next * factor;
    }

    return smoothed;
  }

  function bindSparklineEvents(canvasId){
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const tooltip = getTooltipElement(canvasId);
    if (!tooltip) return;

    if (!canvas.dataset.sparklineBound){
      canvas.addEventListener('mousemove', evt => handleSparklinePointer(canvasId, evt));
      canvas.addEventListener('mouseleave', () => hideSparklineTooltip(canvasId));
      canvas.dataset.sparklineBound = 'true';
    }
  }

  function handleSparklinePointer(canvasId, evt){
    const data = sparklineStore[canvasId];
    const canvas = document.getElementById(canvasId);
    const tooltip = getTooltipElement(canvasId);
    if (!data || !canvas || !tooltip || !data.values || data.values.length < 2) return;

    const rect = canvas.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const w = canvas.clientWidth || rect.width;
    const idx = Math.round((x / w) * (data.values.length - 1));
    const clampedIdx = Math.min(Math.max(idx, 0), data.values.length - 1);
    const value = data.values[clampedIdx];
    const ts = data.timestamps && data.timestamps[clampedIdx];

    const dtText = ts ? formatTimestamp(ts, { showSeconds: false }) : '--';
    tooltip.innerHTML = `<strong>${fmt(value, 2)}</strong><br><span>${dtText}</span>`;

    const ratio = clampedIdx/(data.values.length-1);
    tooltip.style.left = `${Math.max(4, Math.min(96, ratio*100))}%`;
    tooltip.style.top = '-28px';
    tooltip.classList.add('visible');
    drawGuideDot(canvasId, ratio);
  }

  function hideSparklineTooltip(canvasId){
    const tooltip = getTooltipElement(canvasId);
    if (tooltip) tooltip.classList.remove('visible');
    removeGuideDot(canvasId);
  }

  function drawGuideDot(canvasId, ratio){
    const canvas = document.getElementById(canvasId);
    const store = sparklineStore[canvasId];
    if (!canvas || !store) return;

    renderSparkline(canvas, store);

    const ctx = canvas.getContext('2d');
    if (!ctx || !store._dims) return;

    const { min, rng, w, h } = store._dims;
    const idx = Math.round(ratio * (store.values.length - 1));
    const value = store.values[idx];
    const x = ratio * w;
    const y = h - ((value - min) / rng) * h;

    ctx.save();
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#0ea5e9';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function removeGuideDot(canvasId){
    const canvas = document.getElementById(canvasId);
    const store = sparklineStore[canvasId];
    if (!canvas || !store) return;
    renderSparkline(canvas, store);
  }

  let latestMarketSnapshot = null;

  function applyMarketData(data){
    if (!data) return;

    latestMarketSnapshot = data;
    latestAdrSnapshots = data.adrs_snapshots || {};

    const mainMap = {
      vix: data.vix,
      gold: data.gold,
      iron: data.iron,
      sp500: data.macro && data.macro.sp500,
      ewz: data.macro && data.macro.ewz,
      ibov: data.winfut,
      dxy: data.macro && data.macro.dxy,
      cl: data.macro && data.macro.oil,
      bz: data.macro && data.macro.brent,
      'vale-main': data.adrs && data.adrs.VALE,
      'pbr-main': data.adrs && data.adrs.PBR
    };

    Object.keys(mainMap).forEach(id => {
    updateCard(id, mainMap[id] || null);
    });

    const adrs = data.adrs || {};
    Object.keys(ADR_CARD_MAP).forEach(ticker => {
      const cardId = ADR_CARD_MAP[ticker];
      updateCard(cardId, adrs[ticker] || null);
    });

    updateSummaryWidgets(adrs, latestAdrSnapshots, data);
    updateMarketHighlights({
      ibov: data.winfut,
      vale: data.adrs && data.adrs.VALE,
      itub: data.adrs && data.adrs.ITUB,
      pbr: data.adrs && data.adrs.PBR,
      dxy: data.macro && data.macro.dxy,
      ewz: data.macro && data.macro.ewz,
      cl: data.macro && data.macro.oil,
      bz: data.macro && data.macro.brent,
      vix: data.vix
    });
    updateVixSection(data.vix);
    updateAdrTable(adrs);
    updateCommoditiesTable({
      wti: data.macro && data.macro.oil,
      brent: data.macro && data.macro.brent,
      iron: data.iron
    });
  }

  function updateSummaryWidgets(adrs, adrsSnapshots, marketData){
    const snapshots = adrsSnapshots || {};
    const targetTickers = ['PBR','PBR-A','ITUB','BBD','BBDO','BSBR','VALE','BDORY'];
    const tickers = targetTickers.filter(t => adrs && adrs[t]);

    const updateWidget = (key, totals, timestampResolver) => {
      const valueEl = document.getElementById(`widget-${key}-value`);
      const detailEl = document.getElementById(`widget-${key}-detail`);
      const tsEl = document.getElementById(`widget-${key}-timestamp`);
      if (!valueEl || !detailEl) return;

      if (!totals) {
        valueEl.textContent = '--';
        detailEl.textContent = 'Pos: -- | Neg: --';
        if (tsEl) tsEl.textContent = '--';
        valueEl.classList.remove('positive','negative');
        return;
      }

      const total = totals.total || 0;
      valueEl.textContent = `${total >= 0 ? '+' : ''}${fmt(total, 2)}%`;
      valueEl.classList.remove('positive','negative');
      if (total > 0) valueEl.classList.add('positive');
      else if (total < 0) valueEl.classList.add('negative');

      detailEl.textContent = `Pos: +${fmt(totals.pos || 0, 2)}% | Neg: ${fmt(totals.neg || 0, 2)}%`;

      if (tsEl) {
        const ts = timestampResolver && timestampResolver();
        const formatted = formatTimestamp(ts);
        tsEl.textContent = formatted !== '--' ? formatted : '--';
      }
    };

    const getTotals = (selector) => {
      let pos = 0;
      let neg = 0;
      let hasValue = false;
      tickers.forEach(ticker => {
        const data = adrs[ticker];
        if (!data) return;
        const value = selector(data);
        if (value == null || isNaN(value)) return;
        hasValue = true;
        if (value > 0) pos += value;
        else if (value < 0) neg += value;
      });
      if (!hasValue) return null;
      return {
        pos,
        neg,
        total: pos + neg
      };
    };

    const atual = tickers.length ? getTotals(data => data.variation) : null;
    const fechamento = tickers.length ? getSnapshotTotals(snapshots, tickers, 'closing') : null;
    const after = tickers.length ? getSnapshotTotals(snapshots, tickers, 'after_hours') : null;
    const commoditiesTotals = getCommodityTotals(marketData);

    updateWidget('atual', atual, () => getLatestDatasetTimestamp(adrs, tickers, 'at_close', 'after_hours'));
    updateWidget('fechamento', fechamento, () => getLatestSnapshotTimestamp(snapshots, tickers, 'closing'));
    updateWidget('afterhours', after, () => getLatestSnapshotTimestamp(snapshots, tickers, 'after_hours'));
    updateWidget('commodities', commoditiesTotals, () => getLatestCommodityTimestamp(marketData));
  }

  function getLatestDatasetTimestamp(adrs, tickers, primaryField, secondaryField){
    let latest = null;
    tickers.forEach(ticker => {
      const data = adrs[ticker];
      if (!data) return;
      const candidates = [];
      if (primaryField && data[primaryField] && data[primaryField].time) candidates.push(data[primaryField].time);
      if (secondaryField && data[secondaryField] && data[secondaryField].time) candidates.push(data[secondaryField].time);
      if (data.timestamp) candidates.push(data.timestamp);
      candidates.forEach(value => {
        const dt = parseTimestamp(value);
        if (!dt) return;
        if (!latest || dt > latest) latest = dt;
      });
    });
    return latest;
  }

  function getSnapshotTotals(snapshots, tickers, key){
    if (!snapshots) return null;
    let pos = 0;
    let neg = 0;
    let hasValue = false;
    tickers.forEach(ticker => {
      const data = snapshots[ticker];
      if (!data || !data[key]) return;
      const variation = data[key].variation;
      if (variation == null || isNaN(variation)) return;
      hasValue = true;
      if (variation > 0) pos += variation;
      else if (variation < 0) neg += variation;
    });
    if (!hasValue) return null;
    return { pos, neg, total: pos + neg };
  }

  function getLatestSnapshotTimestamp(snapshots, tickers, key){
    if (!snapshots) return null;
    let latest = null;
    tickers.forEach(ticker => {
      const data = snapshots[ticker];
      if (!data || !data[key] || !data[key].time) return;
      const dt = parseTimestamp(data[key].time);
      if (!dt) return;
      if (!latest || dt > latest) latest = dt;
    });
    return latest;
  }

  function getCommodityTotals(snapshot){
    const source = snapshot || latestMarketSnapshot;
    if (!source) return null;
    const entries = [];
    const sources = [
      source.macro && source.macro.brent,
      source.macro && source.macro.oil,
      source.iron
    ];

    sources.forEach(item => {
      if (!item) return;
      const variation = typeof item.variation === 'number' ? item.variation : null;
      if (variation == null) return;
      const tsValue = resolveDataTimestamp(item, 'close');
      entries.push({
        variation,
        timestamp: parseTimestamp(tsValue)
      });
    });

    if (!entries.length) return null;

    return entries.reduce((acc, entry) => {
      const value = entry.variation;
      if (value > 0) acc.pos += value;
      else if (value < 0) acc.neg += value;
      acc.total = acc.pos + acc.neg;
      acc.timestamps.push(entry.timestamp);
      return acc;
    }, { pos: 0, neg: 0, total: 0, timestamps: entries.map(e => e.timestamp).filter(Boolean) });
  }

  function getLatestCommodityTimestamp(snapshot){
    const totals = getCommodityTotals(snapshot);
    if (!totals || !totals.timestamps || !totals.timestamps.length) return null;
    const latest = totals.timestamps.reduce((max, ts) => ts && ts > max ? ts : max, totals.timestamps[0]);
    return latest instanceof Date ? latest : null;
  }

  function getDxyInsight(change){
    if (change == null || isNaN(change)) {
      return { text: '--', tone: '' };
    }
    const abs = Math.abs(change);
    if (change < 0) {
      if (abs >= 0.5) {
        return { text: 'Dólar em forte queda — cenário favorável para emergentes.', tone: 'positive' };
      }
      return { text: 'Dólar em leve queda — favorece emergentes.', tone: 'positive' };
    }
    if (change > 0) {
      if (abs >= 0.5) {
        return { text: 'Dólar em forte alta — pressão negativa para emergentes.', tone: 'negative' };
      }
      return { text: 'Dólar em alta — pressão inflacionária sobre emergentes.', tone: 'negative' };
    }
    return { text: 'Dólar estável — impacto neutro para emergentes.', tone: '' };
  }

  function updateMarketHighlights(data){
    const config = {
      ibov: { priceEl: 'market-ibov-price', changeEl: 'market-ibov-change', subtitleEl: 'market-ibov-subtitle', timestampEl: 'market-ibov-timestamp', spark: 'market-spark-ibov' },
      vale: { priceEl: 'market-vale-price', changeEl: 'market-vale-change', subtitleEl: 'market-vale-subtitle', timestampEl: 'market-vale-timestamp', spark: 'market-spark-vale' },
      itub: { priceEl: 'market-itub-price', changeEl: 'market-itub-change', subtitleEl: 'market-itub-subtitle', timestampEl: 'market-itub-timestamp', spark: 'market-spark-itub' },
      pbr: { priceEl: 'market-pbr-price', changeEl: 'market-pbr-change', subtitleEl: 'market-pbr-subtitle', timestampEl: 'market-pbr-timestamp', spark: 'market-spark-pbr' },
      dxy: { priceEl: 'market-dxy-price', changeEl: 'market-dxy-change', subtitleEl: 'market-dxy-subtitle', timestampEl: 'market-dxy-timestamp', spark: 'market-spark-dxy' },
      ewz: { priceEl: 'market-ewz-price', changeEl: 'market-ewz-change', subtitleEl: 'market-ewz-subtitle', timestampEl: 'market-ewz-timestamp', spark: 'market-spark-ewz' },
      cl: { priceEl: 'market-cl-price', changeEl: 'market-cl-change', subtitleEl: 'market-cl-subtitle', timestampEl: 'market-cl-timestamp', spark: 'market-spark-cl' },
      bz: { priceEl: 'market-bz-price', changeEl: 'market-bz-change', subtitleEl: 'market-bz-subtitle', timestampEl: 'market-bz-timestamp', spark: 'market-spark-bz' },
      vix: { priceEl: 'market-vix-price', changeEl: 'market-vix-change', subtitleEl: 'market-vix-subtitle', timestampEl: 'market-vix-timestamp', spark: 'market-spark-vix' }
    };

    Object.keys(config).forEach(key => {
      const info = config[key];
      const dataset = data[key];
      const priceEl = document.getElementById(info.priceEl);
      const changeEl = document.getElementById(info.changeEl);
      const subtitleEl = document.getElementById(info.subtitleEl);
      const timeEl = info.timestampEl ? document.getElementById(info.timestampEl) : null;
      const sparkId = info.spark;

      if (!priceEl || !changeEl || !subtitleEl) return;

      if (!dataset) {
        priceEl.textContent = '--';
        changeEl.textContent = 'Sem dados';
        changeEl.className = 'market-card__change';
        subtitleEl.textContent = '--';
        if (timeEl) timeEl.textContent = '--';
      drawSparkline(sparkId, []);
        return;
      }

      const price = dataset.current;
      const change = dataset.variation;
      priceEl.textContent = price != null ? fmt(price, 2) : '--';
      changeEl.textContent = change != null ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : 'Sem dados';
      changeEl.className = 'market-card__change';
      if (change > 0) changeEl.classList.add('positive');
      else if (change < 0) changeEl.classList.add('negative');

      if (key === 'dxy') {
        const insightEl = document.getElementById('market-dxy-insight');
        if (insightEl) {
          const { text, tone } = getDxyInsight(change);
          insightEl.textContent = text;
          insightEl.className = 'market-card__insight';
          if (tone) insightEl.classList.add(tone);
        }
      }

      subtitleEl.textContent = getDatasetLabel(dataset);
      if (timeEl) {
        const tsValue = resolveDataTimestamp(dataset, 'after');
        timeEl.textContent = formatTimestamp(tsValue);
      }

      const series = dataset.series && dataset.series.closes || [];
      const tsSeries = dataset.series && dataset.series.timestamps || [];
      drawSparkline(sparkId, series, undefined, tsSeries, null);
    });
  }

  function updateVixSection(vixData){
    const timeEl = document.getElementById('vix-section-time');
    const atualValueEl = document.getElementById('vix-card-atual-value');
    const atualChangeEl = document.getElementById('vix-card-atual-change');
    const atualRegionEl = document.getElementById('vix-card-atual-region');
    const atualVolEl = document.getElementById('vix-card-atual-volatility');
    const cardTimestampEl = document.getElementById('vix-timestamp');
    const fechamentoValueEl = document.getElementById('vix-card-fechamento-value');
    const fechamentoDateEl = document.getElementById('vix-card-fechamento-date');
    const fechamentoChangeEl = document.getElementById('vix-card-fechamento-change');
    const aberturaValueEl = document.getElementById('vix-card-abertura-value');
    const aberturaDateEl = document.getElementById('vix-card-abertura-date');
    const aberturaChangeEl = document.getElementById('vix-card-abertura-change');
    const aberturaTrendEl = document.getElementById('vix-card-abertura-trend');
    const chartEl = document.getElementById('vix-chart');
    const trendEl = document.getElementById('vix-trend');

    if (!vixData) {
      [timeEl, atualValueEl, atualChangeEl, atualRegionEl, atualVolEl, fechamentoValueEl, fechamentoDateEl, fechamentoChangeEl, aberturaValueEl, aberturaDateEl, aberturaChangeEl, aberturaTrendEl, trendEl].forEach(el => {
        if (el) el.textContent = '--';
      });
      if (chartEl) drawSparkline('vix-chart', []);
      return;
    }

    const resolvedTimestamp = resolveDataTimestamp(vixData, 'after');
    const formattedTimestamp = formatTimestamp(resolvedTimestamp);
    if (timeEl) {
      timeEl.textContent = formattedTimestamp;
    }
    if (cardTimestampEl) {
      cardTimestampEl.textContent = formattedTimestamp;
    }

    const current = vixData.current;
    const change = vixData.variation;
    if (atualValueEl) atualValueEl.textContent = current != null ? fmt(current, 2) : '--';
    if (atualChangeEl) {
      if (change != null) {
        atualChangeEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
        atualChangeEl.className = 'vix-card__change';
        if (change > 0) atualChangeEl.classList.add('positive');
        else if (change < 0) atualChangeEl.classList.add('negative');
      } else {
        atualChangeEl.textContent = 'Sem dados';
      }
    }

    if (atualRegionEl) atualRegionEl.textContent = getVixRegionLabel(current);
    if (atualVolEl) atualVolEl.textContent = getVixVolatilityLabel(change);

    if (fechamentoValueEl) fechamentoValueEl.textContent = vixData.at_close && vixData.at_close.price != null ? fmt(vixData.at_close.price, 2) : '--';
    if (fechamentoDateEl) {
      fechamentoDateEl.textContent = formatTimestamp(vixData.at_close && vixData.at_close.time);
    }
    if (fechamentoChangeEl) {
      const ch = vixData.at_close && vixData.at_close.change_percent;
      fechamentoChangeEl.textContent = ch != null ? `${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%` : 'Sem dados';
    }

    if (aberturaValueEl) aberturaValueEl.textContent = vixData.open_price != null ? fmt(vixData.open_price, 2) : '--';
    if (aberturaDateEl) {
      aberturaDateEl.textContent = formatTimestamp(vixData.open_time);
    }
    if (aberturaChangeEl || aberturaTrendEl) {
      const delta = getVixDeltaFromOpen(vixData);
      if (aberturaChangeEl) aberturaChangeEl.textContent = delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%` : 'Sem dados';
      if (aberturaTrendEl) aberturaTrendEl.textContent = getVixOpenTrendLabel(delta);
    }

      if (chartEl) {
        const seriesCloses = vixData.series && vixData.series.closes || [];
        const seriesTs = vixData.series && vixData.series.timestamps || [];
        drawSparkline('vix-chart', seriesCloses, '#cbd5e1', seriesTs, null);
      }
    if (trendEl) trendEl.textContent = getVixTrendLabel(current, change);
  }

  function getVixRegionLabel(value){
    if (value == null) return '--';
    if (value < 15) return 'Região baixa: oportunidade com realização';
    if (value < 16) return 'Região neutra: possível indefinição';
    if (value < 21) return 'Região de estresse moderado';
    if (value < 26) return 'Medo moderado: oportunidade com cautela';
    if (value < 31) return 'Medo elevado: oportunidade arriscada';
    if (value < 36) return 'Medo forte: proteção recomendada';
    if (value < 41) return 'Medo extremo';
    return 'Medo extremo elevado';
  }

  function getVixVolatilityLabel(change){
    if (change == null) return 'Volatilidade indefinida';
    const abs = Math.abs(change);
    const intensity = abs >= 5 ? 'forte' : 'leve';
    const direction = change >= 0 ? 'Volatilidade positiva' : 'Volatilidade negativa';
    return `${direction} ${intensity}`;
  }

  function getVixDeltaFromOpen(vixData){
    if (!vixData) return null;
    if (vixData.open_price == null || vixData.current == null) return null;
    return ((vixData.current - vixData.open_price) / vixData.open_price) * 100;
  }

  function getVixOpenTrendLabel(delta){
    if (delta == null) return '--';
    return delta < 0 ? 'Abertura do VIX em baixa' : 'Abertura do VIX em alta';
  }

  function getVixTrendLabel(current, change){
    if (current == null || change == null) return '--';
    if (change < -5) return 'Tendência: volatilidade caindo com força';
    if (change < 0) return 'Tendência: volatilidade em queda leve';
    if (change > 5) return 'Tendência: volatilidade subindo com força';
    if (change > 0) return 'Tendência: volatilidade em alta leve';
    return 'Tendência neutra para o VIX';
  }

  function updateAdrTable(adrs){
    const tbody = document.getElementById('table-adrs-body');
    const timeEl = document.getElementById('table-adrs-time');
    if (!tbody) return;
    tbody.innerHTML = '';
    const tickers = ['PBR','PBR-A','ITUB','BBD','BBDO','BSBR','VALE','BDORY'];
    let latestTime = null;
    tickers.forEach(ticker => {
      const data = adrs[ticker];
      const tr = document.createElement('tr');
      const cells = [];
      const tsValue = resolveDataTimestamp(data, 'close');
      const timeValue = formatTimestamp(tsValue);
      const tsDate = parseTimestamp(tsValue);
      if (tsDate) latestTime = latestTime ? Math.max(latestTime, tsDate.getTime()) : tsDate.getTime();
      const values = [
        ticker || '--',
        timeValue,
        data && data.current != null ? `$${fmt(data.current, 2)}` : '--',
        formatChange(data && data.variation),
        formatChange(data && data.at_close && data.at_close.change_percent),
        formatChange(data && data.after_hours && data.after_hours.change_percent)
      ];
      values.forEach((value, idx) => {
        const td = document.createElement('td');
        if (idx >= 3) {
          applyChangeClass(td, value);
        } else {
          td.textContent = value;
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    if (timeEl) {
      timeEl.textContent = latestTime ? new Date(latestTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--';
    }
  }

  function updateCommoditiesTable(data){
    const tbody = document.getElementById('table-commodities-body');
    const timeEl = document.getElementById('table-commodities-time');
    if (!tbody) return;
    tbody.innerHTML = '';

    const items = [
      { label: 'Petróleo Brent', data: data.brent },
      { label: 'Petróleo WTI', data: data.wti },
      { label: 'Minério Ferro (Copper)', data: data.iron }
    ];

    let latestTime = null;
    items.forEach(item => {
      const tr = document.createElement('tr');
      const info = item.data;
      const tsValue = resolveDataTimestamp(info, 'close');
      const timeValue = formatTimestamp(tsValue);
      const tsDate = parseTimestamp(tsValue);
      if (tsDate) latestTime = latestTime ? Math.max(latestTime, tsDate.getTime()) : tsDate.getTime();
      const values = [
        item.label,
        timeValue,
        info && info.current != null ? `$${fmt(info.current, 2)}` : '--',
        formatChange(info && info.variation)
      ];
      values.forEach((value, idx) => {
        const td = document.createElement('td');
        if (idx === 3) {
          applyChangeClass(td, value);
        } else {
          td.textContent = value;
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    if (timeEl) {
      timeEl.textContent = latestTime ? new Date(latestTime).toLocaleString('pt-BR') : '--';
    }
  }

  function formatChange(value){
    if (value == null || isNaN(value)) return '<span class="change-neutral">--</span>';
    const num = Number(value);
    const cls = num > 0 ? 'positive' : num < 0 ? 'negative' : 'neutral';
    const text = `${num > 0 ? '+' : num < 0 ? '-' : ''}${Math.abs(num).toFixed(2)}%`;
    return `<span class="change-${cls}">${text}</span>`;
  }

  function applyChangeClass(td, html){
    td.classList.remove('positive','negative','neutral');
    td.innerHTML = html || '<span class="change-neutral">--</span>';
    if (!html) return;
    if (html.includes('change-positive')) td.classList.add('positive');
    else if (html.includes('change-negative')) td.classList.add('negative');
    else td.classList.add('neutral');
  }

  async function updateAll(){
    setStatus('updating','Atualizando...');
    try {
      await fetchJSON(`${BASE_URL}/update`, 20000).catch(()=>{});
      const data = await fetchJSON(`${BASE_URL}/market-data`, 20000);
      if (data && data.status === 'success') {
        applyMarketData(data.data);
        setStatus('success','Atualizado com sucesso');
        setLastUpdate(data.timestamp || new Date().toISOString());
      } else {
        console.error('Resposta inválida', data);
        setStatus('error','Erro nos dados');
      }
    } catch (e){
      console.error('Falha ao atualizar dashboard', e);
      setStatus('error','Erro de conexão');
    }
  }

  function bind(){
    const btn = document.getElementById('updateQuotes');
    if (btn) btn.addEventListener('click', updateAll);

    // Auto-refresh leve a cada 5 minutos: atualiza apenas dados de mercado / saldo atual
    try {
      const refreshLight = async () => {
        setStatus('updating','Atualizando...');
        try {
          const data = await fetchJSON(`${BASE_URL}/market-data`, 20000);
          if (data && data.status === 'success') {
            applyMarketData(data.data);
            setStatus('success','Atualizado com sucesso');
            setLastUpdate(data.timestamp || new Date().toISOString());
          } else {
            setStatus('error','Erro nos dados');
          }
        } catch (_) {
          setStatus('error','Erro de conexão');
        }
      };

      // Só roda em aba visível
      const visHandler = () => {
        if (document.visibilityState === 'visible') refreshLight();
      };
      document.addEventListener('visibilitychange', visHandler);

      setInterval(() => {
        if (document.visibilityState === 'visible') {
          refreshLight();
        }
      }, 5 * 60 * 1000);
    } catch (_) {}

    const triggers = document.querySelectorAll('.tab-trigger');
    const panels = document.querySelectorAll('[data-tab-panel]');
    triggers.forEach(trigger => {
      trigger.addEventListener('click', () => {
        const tab = trigger.dataset.tab;
        triggers.forEach(t => t.classList.toggle('tab-trigger--active', t.dataset.tab === tab));
        panels.forEach(panel => panel.classList.toggle('tab-panel--active', panel.dataset.tabPanel === tab));
        if (tab === 'tv') {
          ensureTradingViewWidget();
        }
      });
    });
  }

  let tvWidgetLoaded = false;
  function ensureTradingViewWidget(){
    if (tvWidgetLoaded) return;
    const cards = document.querySelectorAll('.tv-widget-card');
    if (!cards.length) return;

    muteTradingViewLogs();

    cards.forEach(card => {
      const symbol = card.dataset.tvSymbol;
      const container = card.querySelector('.tradingview-widget-container');
      if (!container) return;

      if (!symbol) return;
      const script = document.createElement('script');
      script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-symbol-info.js';
      script.async = true;
      script.innerHTML = JSON.stringify({
        "symbol": symbol,
        "width": "100%",
        "height": 360,
        "locale": "en",
        "colorTheme": "dark",
        "isTransparent": false,
        "showSymbolLogo": true
      });

      container.appendChild(script);
    });

    tvWidgetLoaded = true;
  }

  // bootstrap
  bind();
  updateAll();
})();



(function(){
  const host = window.location.hostname;
  const queryParams = new URLSearchParams(window.location.search || '');
  const customApi = queryParams.get('api');
  const isLocalHost = !host || host === 'localhost' || host === '127.0.0.1';
  const BASE_URL = customApi
    ? customApi.replace(/\/?$/, '')
    : (isLocalHost ? 'http://localhost:5000/api' : 'https://backenddashboardadr.onrender.com/api');

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

  async function fetchJSON(url, timeoutMs = 15000, retries = 3) { // Aumentado timeout e adicionado retry
    for (let attempt = 1; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      
      try {
        const res = await fetch(url, { 
          signal: controller.signal,
          cache: 'no-cache',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        });
        
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        
        const data = await res.json();
        clearTimeout(timeout);
        return data;
        
      } catch (error) {
        clearTimeout(timeout);
        
        if (attempt === retries) {
          console.error(`❌ Falha final após ${retries} tentativas para ${url}:`, error);
          throw error;
        }
        
        console.warn(`⚠️ Tentativa ${attempt}/${retries} falhou para ${url}, tentando novamente em ${attempt * 1000}ms...`);
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
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

    // Para VIX, tooltip simples com valor e horário
    if (canvasId === 'vix-chart') {
      const rect = canvas.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const w = canvas.clientWidth || rect.width;
      const idx = Math.round((x / w) * (data.values.length - 1));
      const clampedIdx = Math.min(Math.max(idx, 0), data.values.length - 1);
      const value = data.values[clampedIdx];
      const ts = data.timestamps && data.timestamps[clampedIdx];
      const dtText = ts ? formatTimestamp(ts, { showSeconds: false }) : '--';
      
      // Usar o tooltip existente do sistema
      const tooltip = getTooltipElement(canvasId);
      if (tooltip) {
        tooltip.innerHTML = `
          <div style="text-align: center; padding: 6px;">
            <div style="font-size: 16px; font-weight: bold; color: #f1f5f9;">${fmt(value, 2)}</div>
            <div style="font-size: 12px; color: #94a3b8;">${dtText}</div>
          </div>
        `;
        
        // Posicionamento fixo no centro do gráfico
        tooltip.style.left = '50%';
        tooltip.style.top = '-45px';
        tooltip.style.transform = 'translateX(-50%)';
        tooltip.style.position = 'absolute';
        tooltip.classList.add('visible');
      }
      
      // Guide dot
      const ratio = clampedIdx/(data.values.length-1);
      drawGuideDot(canvasId, ratio);
      return;
    }

    // Para outros gráficos, usar lógica original
    try {
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
      
    } catch (error) {
      console.error('Erro no tooltip:', error);
      tooltip.classList.remove('visible');
    }
  }

  function hideSparklineTooltip(canvasId){
    // Para VIX, usar lógica padrão
    if (canvasId === 'vix-chart') {
      const tooltip = getTooltipElement(canvasId);
      if (tooltip) tooltip.classList.remove('visible');
      removeGuideDot(canvasId);
      return;
    }
    
    // Para outros gráficos, usar lógica original
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
  let supabaseSnapshotsLoaded = false;

  // Sistema de rate limiting para evitar sobrecarga
  let requestQueue = [];
  let isProcessingQueue = false;
  
  async function processRequestQueue() {
    if (isProcessingQueue || requestQueue.length === 0) return;
    
    isProcessingQueue = true;
    console.log(`🔄 Processando ${requestQueue.length} requisições em lotes...`);
    
    // Processar em lotes de 4 requisições por vez
    const batchSize = 4;
    const batches = [];
    
    for (let i = 0; i < requestQueue.length; i += batchSize) {
      batches.push(requestQueue.slice(i, i + batchSize));
    }
    
    for (const batch of batches) {
      try {
        const batchPromises = batch.map(({ url, timeout, ticker, type }) => 
          fetchJSON(url, timeout)
            .catch(error => {
              console.warn(`⚠️ Falha ao carregar ${ticker}/${type}:`, error);
              return null;
            })
            .then(data => ({ ticker, type, data }))
        );
        
        await Promise.all(batchPromises);
        
        // Pequena pausa entre lotes para evitar sobrecarga
        if (batches.indexOf(batch) < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
      } catch (error) {
        console.error('❌ Erro no lote:', error);
      }
    }
    
    requestQueue = [];
    isProcessingQueue = false;
  }
  
  async function loadSupabaseSnapshotsIfNeeded(){
    if (supabaseSnapshotsLoaded) return;
    
    console.log('🔄 Carregando snapshots históricos do Supabase com rate limiting...');
    
    const targetTickers = ['PBR','PBR-A','ITUB','BBD','BBDO','BSBR','VALE','BDORY'];
    
    // Adicionar requisições à fila em vez de executar imediatamente
    for (const ticker of targetTickers) {
      // Requisição para closing
      requestQueue.push({
        url: `${BASE_URL}/adr-history?ticker=${ticker}&type=closing&limit=1`,
        timeout: 10000,
        ticker,
        type: 'closing'
      });
      
      // Requisição para after-hours
      requestQueue.push({
        url: `${BASE_URL}/adr-history?ticker=${ticker}&type=after_hours&limit=1`,
        timeout: 10000,
        ticker,
        type: 'after_hours'
      });
    }
    
    try {
      // Processar fila de requisições com rate limiting
      await processRequestQueue();
      
      // Processar resultados da fila
      const results = [];
      for (const request of requestQueue) {
        try {
          const data = await fetchJSON(request.url, request.timeout);
          results.push({ ticker: request.ticker, type: request.type, data });
        } catch (error) {
          console.warn(`⚠️ Falha ao carregar ${request.ticker}/${request.type}:`, error);
          results.push({ ticker: request.ticker, type: request.type, data: null });
        }
      }
      
      // Processar resultados
      results.forEach(({ ticker, type, data }) => {
        if (!data || data.status !== 'success' || !data.data || data.data.length === 0) return;
        
        const snapshot = data.data[0];
        if (!latestAdrSnapshots[ticker]) latestAdrSnapshots[ticker] = {};
        
        if (type === 'closing') {
          latestAdrSnapshots[ticker].closing = {
            price: snapshot.price,
            variation: snapshot.variation,
            time: snapshot.source_time
          };
          latestAdrSnapshots[ticker].closing_source_time = snapshot.source_time;
          console.log(`✅ ${ticker} closing snapshot carregado: ${snapshot.variation}% (time: ${snapshot.source_time})`);
        } else if (type === 'after_hours') {
          latestAdrSnapshots[ticker].after_hours = {
            price: snapshot.price,
            variation: snapshot.variation,
            time: snapshot.source_time
          };
          latestAdrSnapshots[ticker].after_hours_source_time = snapshot.source_time;
          console.log(`✅ ${ticker} after-hours snapshot carregado: ${snapshot.variation}%`);
        }
      });
      
      supabaseSnapshotsLoaded = true;
      console.log('✅ Snapshots do Supabase carregados com sucesso com rate limiting');
      console.log('📊 latestAdrSnapshots após carregamento:', Object.keys(latestAdrSnapshots).map(ticker => ({
        ticker,
        hasClosing: !!(latestAdrSnapshots[ticker] && latestAdrSnapshots[ticker].closing),
        hasAfterHours: !!(latestAdrSnapshots[ticker] && latestAdrSnapshots[ticker].after_hours)
      })));
    } catch (error) {
      console.warn('⚠️ Erro ao carregar snapshots do Supabase:', error);
      supabaseSnapshotsLoaded = true; // Marcar como carregado para evitar tentativas repetidas
    }
  }

  function applyMarketData(data){
    if (!data) return;

    latestMarketSnapshot = data;
    
    // Mesclar snapshots do Supabase com dados em tempo real
    const realtimeSnapshots = data.adrs_snapshots || {};
    
    // Para cada ticker, usar dados em tempo real se mais recentes, senão manter Supabase
    Object.keys(realtimeSnapshots).forEach(ticker => {
      const realtime = realtimeSnapshots[ticker];
      const existing = latestAdrSnapshots[ticker] || {};
      
      if (!latestAdrSnapshots[ticker]) {
        latestAdrSnapshots[ticker] = realtime;
        return;
      }
      
      // Closing: usar o mais recente
      if (realtime.closing && realtime.closing.time) {
        const realtimeTime = parseTimestamp(realtime.closing.time);
        const existingTime = parseTimestamp(existing.closing_source_time);
        if (!existingTime || (realtimeTime && realtimeTime > existingTime)) {
          latestAdrSnapshots[ticker].closing = realtime.closing;
          latestAdrSnapshots[ticker].closing_source_time = realtime.closing_source_time;
        }
      }
      
      // After hours: usar o mais recente
      if (realtime.after_hours && realtime.after_hours.time) {
        const realtimeTime = parseTimestamp(realtime.after_hours.time);
        const existingTime = parseTimestamp(existing.after_hours_source_time);
        if (!existingTime || (realtimeTime && realtimeTime > existingTime)) {
          latestAdrSnapshots[ticker].after_hours = realtime.after_hours;
          latestAdrSnapshots[ticker].after_hours_source_time = realtime.after_hours_source_time;
        }
      }
    });

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

    // Atualizar cards personalizáveis da aba "Análise de Mercado"
    updateCustomMarketCards(data);

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

    // Cache diário: Fechamento (17:00 BR), After Hours (17:00–21:00 ET)
    const fechamentoRealtime = tickers.length ? computeFechamentoAt1700Totals(adrs, snapshots, tickers) : null;
    const afterRealtime = tickers.length ? getSnapshotTotals(snapshots, tickers, 'after_hours') : null;
    
    // Debug after-hours
    if (tickers.length && isAfterHoursClient() && !afterRealtime) {
      console.warn('⚠️ Sem dados after-hours disponíveis no backend/Supabase para os tickers monitorados.');
    }
    if (afterRealtime) {
      console.log(`✅ After-hours totais calculados: ${afterRealtime.total.toFixed(2)}% (Pos: ${afterRealtime.pos.toFixed(2)}%, Neg: ${afterRealtime.neg.toFixed(2)}%)`);
    }

    const fechamentoCached = wrapWithDailyCache('fechamento', fechamentoRealtime, () => getLatestSnapshotTimestamp(snapshots, tickers, 'closing'));
    const afterCached = wrapWithDailyCache('afterhours', afterRealtime, () => getLatestSnapshotTimestamp(snapshots, tickers, 'after_hours'));

    // console.log('🔍 fechamentoRealtime:', fechamentoRealtime);
    // console.log('🔍 fechamentoCached:', fechamentoCached);

    const commoditiesTotals = getCommodityTotals(marketData);

    updateWidget('atual', atual, () => getLatestDatasetTimestamp(adrs, tickers, 'at_close', 'after_hours'));
    updateWidget('fechamento', fechamentoCached.totals, () => fechamentoCached.timestamp);
    updateWidget('afterhours', afterCached.totals, () => afterCached.timestamp);
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

  function isAfterHoursClient(){
    try {
      const now = new Date();
      const options = { timeZone: 'America/New_York', hour12: false, hour: '2-digit' };
      const parts = new Intl.DateTimeFormat('pt-BR', options).formatToParts(now);
      const hourPart = parts.find(p => p.type === 'hour');
      if (!hourPart) return false;
      const hour = Number(hourPart.value);
      return hour >= 17 && hour < 21;
    } catch {
      const utcHour = new Date().getUTCHours();
      const approxEtHour = (utcHour - 4 + 24) % 24; // aproximação padrão ET (sem DST awareness)
      return approxEtHour >= 17 && approxEtHour < 21;
    }
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

  // Calcula totais de Fechamento usando snapshots salvos (oficial às 17:00 BR)
  function computeFechamentoAt1700Totals(adrs, snapshots, tickers){
    if (!snapshots) {
      // console.log('⚠️ computeFechamentoAt1700Totals: snapshots é null');
      return null;
    }
    
    // console.log('🔍 computeFechamentoAt1700Totals: snapshots disponíveis:', Object.keys(snapshots));
    
    let pos = 0;
    let neg = 0;
    let hasValue = false;

    // Determinar data "hoje" em BR para logging
    const br = getNowInBR();
    const todayKey = br.dayKey;

    tickers.forEach(ticker => {
      const snap = snapshots[ticker];
      // console.log(`🔍 ${ticker}: snap=${!!snap}, closing=${!!(snap && snap.closing)}`);
      
      if (!snap || !snap.closing) return;
      const closing = snap.closing;
      // Usar variação do fechamento (oficial) já fornecida pelo backend
      const variation = closing.variation;
      if (variation == null || isNaN(variation)) return;
      hasValue = true;

      // console.log(`✅ ${ticker} fechamento: ${variation}%`);

      // Opcional: validar que o timestamp de closing é do dia (ET). Se não houver timezone claro, usamos o valor como está.
      // Se houver divergência de data, ainda consideramos o snapshot mais recente enviado pelo backend.

      if (variation > 0) pos += variation;
      else if (variation < 0) neg += variation;
    });

    // console.log(`📊 computeFechamentoAt1700Totals resultado: pos=${pos}, neg=${neg}, hasValue=${hasValue}`);
    
    if (!hasValue) return null;
    return { pos, neg, total: pos + neg, dayKey: todayKey };
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

  // ===== Daily cache helpers for Fechamento (17:00 BR sharp) and After Hours (17:00–21:00 ET) =====
  function getNowInBR(){
    // Usar horário de São Paulo (Brasil)
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' });
      const parts = formatter.formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
      const y = Number(parts.year);
      const m = Number(parts.month);
      const d = Number(parts.day);
      const hh = Number(parts.hour);
      const mm = Number(parts.minute);
      const ss = Number(parts.second);
      return { year: y, month: m, day: d, hour: hh, minute: mm, second: ss, dayKey: `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` };
    } catch {
      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth()+1, day: now.getDate(), hour: now.getHours(), minute: now.getMinutes(), second: now.getSeconds(), dayKey: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}` };
    }
  }

  function getNowInET(){
    // Horário ET para after-hours
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' });
      const parts = formatter.formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
      const y = Number(parts.year);
      const m = Number(parts.month);
      const d = Number(parts.day);
      const hh = Number(parts.hour);
      const mm = Number(parts.minute);
      const ss = Number(parts.second);
      return { year: y, month: m, day: d, hour: hh, minute: mm, second: ss, dayKey: `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` };
    } catch {
      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth()+1, day: now.getDate(), hour: now.getHours(), minute: now.getMinutes(), second: now.getSeconds(), dayKey: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}` };
    }
  }

  function withinWindowBR(kind, br, et){
    // kind: 'fechamento' (usa horário BR 17:00+), 'afterhours' (usa ET 17:00–21:00)
    if (kind === 'fechamento') {
      // Fechamento: só atualiza DEPOIS das 17:00 BR (horário de fechamento B3)
      // Antes das 17:00 BR, mantém cache do dia anterior
      const h = br.hour;
      return h >= 17; // A partir das 17:00 BR, permite atualização
    } else if (kind === 'afterhours') {
      // After hours: janela ET 17:00–21:00 (após fechamento NYSE)
      const h = et.hour;
      return (h >= 17 && h < 21);
    }
    return false;
  }

  function cacheKey(kind, dayKey){
    return `adrs:${kind}:${dayKey}`;
  }

  function wrapWithDailyCache(kind, realtimeTotals, timestampResolver){
    const br = getNowInBR();
    const et = getNowInET();
    
    // Fechamento usa dia BR, After Hours usa dia ET
    const dayKey = kind === 'fechamento' ? br.dayKey : et.dayKey;
    const key = cacheKey(kind, dayKey);
    
    const cachedRaw = localStorage.getItem(key);
    const cached = cachedRaw ? JSON.parse(cachedRaw) : null;

    // console.log(`🔍 wrapWithDailyCache(${kind}): br.hour=${br.hour}, dayKey=${dayKey}, key=${key}`);
    // console.log(`🔍 cached:`, cached);
    // console.log(`🔍 realtimeTotals:`, realtimeTotals);

    // Determinar se estamos na janela de atualização
    const inWindow = withinWindowBR(kind, br, et);

    if (kind === 'fechamento') {
      // FECHAMENTO: Só atualiza APÓS 17:00 BR
      // Antes das 17:00 BR: sempre retorna cache do dia anterior ou atual (se houver)
      if (br.hour < 17) {
        // console.log(`🔍 Antes das 17:00 BR - buscando cache de ontem`);
        // Antes das 17:00 BR: tentar cache de ontem primeiro
        const yesterday = new Date(br.year, br.month - 1, br.day);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayKey = cacheKey('fechamento', `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`);
        const yesterdayCache = localStorage.getItem(yesterdayKey);
        
        // console.log(`🔍 yesterdayKey: ${yesterdayKey}, yesterdayCache:`, yesterdayCache);
        
        if (yesterdayCache) {
          const parsed = JSON.parse(yesterdayCache);
          // console.log(`✅ Usando cache de ontem:`, parsed);
          return { totals: parsed.totals, timestamp: parsed.timestamp ? new Date(parsed.timestamp) : null, cached: true, source: 'yesterday' };
        }
        
        // Fallback: cache de hoje (se existir de alguma forma)
        if (cached) {
          // console.log(`✅ Usando cache de hoje:`, cached);
          return { totals: cached.totals, timestamp: cached.timestamp ? new Date(cached.timestamp) : null, cached: true, source: 'today-cached' };
        }
        
        // NOVO: Se não há cache, mas temos dados em tempo real, usar os dados de hoje
        // (isso acontece quando carregamos snapshots do Supabase pela primeira vez)
        if (realtimeTotals) {
          // console.log(`✅ Usando dados em tempo real (primeira vez):`, realtimeTotals);
          return { totals: realtimeTotals, timestamp: timestampResolver ? timestampResolver() : null, cached: false, source: 'realtime' };
        }
        
        // Sem cache: retornar null
        // console.log(`❌ Sem cache disponível - retornando null`);
        return { totals: null, timestamp: null, cached: false, source: 'no-cache' };
      }
      
      // Após 17:00 BR: atualizar com dados em tempo real
      if (realtimeTotals) {
        const ts = timestampResolver && timestampResolver();
        const toStore = { totals: realtimeTotals, timestamp: ts ? (ts instanceof Date ? ts.toISOString() : ts) : null };
        try { localStorage.setItem(key, JSON.stringify(toStore)); } catch {}
        return { totals: realtimeTotals, timestamp: ts || null, cached: false, source: 'realtime' };
      }
      
      // Sem dados em tempo real: usar cache
      if (cached) {
        return { totals: cached.totals, timestamp: cached.timestamp ? new Date(cached.timestamp) : null, cached: true, source: 'today-cached' };
      }
      
      return { totals: null, timestamp: null, cached: false, source: 'no-data' };
    }

    // AFTER HOURS: Lógica original (janela ET 17:00-21:00)
    if (inWindow) {
      if (realtimeTotals) {
        const ts = timestampResolver && timestampResolver();
        const toStore = { totals: realtimeTotals, timestamp: ts ? (ts instanceof Date ? ts.toISOString() : ts) : null };
        try { localStorage.setItem(key, JSON.stringify(toStore)); } catch {}
        return { totals: realtimeTotals, timestamp: ts || null, cached: false };
      }
      if (cached) {
        return { totals: cached.totals, timestamp: cached.timestamp ? new Date(cached.timestamp) : null, cached: true };
      }
      return { totals: null, timestamp: null, cached: false };
    }

    // Fora da janela: servir cache do dia, senão realtime (sem armazenar)
    if (cached) {
      return { totals: cached.totals, timestamp: cached.timestamp ? new Date(cached.timestamp) : null, cached: true };
    }
    if (realtimeTotals) {
      const ts = timestampResolver && timestampResolver();
      return { totals: realtimeTotals, timestamp: ts || null, cached: false };
    }
    return { totals: null, timestamp: null, cached: false };
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
        const tsValue = key === 'vix' && dataset.timestamp ? dataset.timestamp : resolveDataTimestamp(dataset, 'after');
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
      const displayTimestamp = formatTimestamp(vixData.timestamp || resolvedTimestamp);
      timeEl.textContent = displayTimestamp;
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

    if (atualRegionEl) atualRegionEl.textContent = getVixRegionLabel(current, vixData);
    if (atualVolEl) atualVolEl.textContent = getVixVolatilityLabel(change, vixData);

    const fechamentoTime = vixData.at_close && (vixData.at_close_display_time || vixData.at_close.time);
    if (fechamentoValueEl) fechamentoValueEl.textContent = vixData.at_close && vixData.at_close.price != null ? fmt(vixData.at_close.price, 2) : '--';
    if (fechamentoDateEl) {
      // Para o fechamento, usar data do dia anterior ou do dia atual se já passou das 17h BR
      const nowBR = new Date();
      const isAfter5PM = nowBR.getHours() >= 17;
      
      let fechamentoDate;
      if (isAfter5PM) {
        // Se já passou das 17h BR, usar data atual
        fechamentoDate = new Date(nowBR);
        fechamentoDate.setHours(17, 0, 0, 0); // Definir como 17:00
      } else {
        // Se ainda não passou das 17h BR, usar data anterior
        const yesterday = new Date(nowBR);
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(17, 0, 0, 0); // Definir como 17:00
        fechamentoDate = yesterday;
      }
      
      fechamentoDateEl.textContent = formatTimestamp(fechamentoDate);
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
      if (aberturaTrendEl) aberturaTrendEl.textContent = getVixOpenTrendLabel(vixData);
    }

      if (chartEl) {
        const seriesCloses = vixData.series && vixData.series.closes || [];
        const seriesTs = vixData.series && vixData.series.timestamps || [];
        drawSparkline('vix-chart', seriesCloses, '#cbd5e1', seriesTs, null);
      }
    if (trendEl) {
      const trendText = getVixTrendLabel(current, change, vixData);
      trendEl.textContent = trendText;
      
      // Aplicar cor baseada na análise de topos e fundos
      if (vixData.vix_peaks_trend_analysis) {
        const analysis = vixData.vix_peaks_trend_analysis;
        if (analysis.color === 'red') {
          trendEl.style.color = '#ef4444'; // Vermelho para impacto negativo no IBOV
        } else if (analysis.color === 'green') {
          trendEl.style.color = '#22c55e'; // Verde para impacto positivo no IBOV
        } else {
          trendEl.style.color = '#94a3b8'; // Cinza para neutro
        }
      } else {
        trendEl.style.color = '#94a3b8'; // Cor padrão
      }
    }
  }

  function getVixRegionLabel(value, vixData){
    if (value == null) return '--';
    
    // Manter apenas interpretação de região de estresse, sem análises adicionais
    if (value < 15) return 'Região baixa: oportunidade com realização';
    if (value < 16) return 'Região neutra: possível indefinição';
    if (value < 21) return 'Região de estresse moderado';
    if (value < 26) return 'Medo moderado: oportunidade com cautela';
    if (value < 31) return 'Medo elevado: oportunidade arriscada';
    if (value < 36) return 'Medo forte: proteção recomendada';
    if (value < 41) return 'Medo extremo';
    return 'Medo extremo elevado';
  }

  function getVixVolatilityLabel(change, vixData){
    // Manter apenas análise tradicional simples
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

  function getVixOpenTrendLabel(vixData){
    if (!vixData) return '--';
    
    // Usar preço de fechamento anterior e preço de abertura atual
    const previousClose = vixData.previous_close || vixData.at_close?.price;
    const openPrice = vixData.open_price;
    
    if (previousClose == null || openPrice == null) return '--';
    
    // Calcular variação do fechamento anterior para abertura atual
    const openChange = ((openPrice - previousClose) / previousClose) * 100;
    
    if (openChange > 0) {
      return `ABERTURA DO VIX POSITIVA (+${openChange.toFixed(2)}%)`;
    } else if (openChange < 0) {
      return `ABERTURA DO VIX NEGATIVA (${openChange.toFixed(2)}%)`;
    } else {
      return 'ABERTURA DO VIX NEUTRA (0.00%)';
    }
  }

  function getVixTrendLabel(current, change, vixData){
    // Usar nova análise de topos e fundos se disponível
    if (vixData && vixData.vix_peaks_trend_analysis && vixData.vix_peaks_trend_analysis.interpretation) {
      return vixData.vix_peaks_trend_analysis.interpretation;
    }
    
    // Fallback para análise de 15 minutos
    if (vixData && vixData.vix_15min_analysis && vixData.vix_15min_analysis.interpretation) {
      return vixData.vix_15min_analysis.interpretation;
    }
    
    // Fallback para análise tradicional
    if (current == null || change == null) return '--';
    if (change < -5) return 'Tendência: volatilidade caindo com força';
    if (change < 0) return 'Tendência: volatilidade em queda leve';
    if (change > 5) return 'Tendência: volatilidade subindo com força';
    if (change > 0) return 'Tendência: volatilidade em alta leve';
    return 'Tendência neutra para o VIX';
  }

  function getAfterMarketValueForTable(ticker){
    // Aplica lógica de cache: antes 17h BR mostra ontem, após 17h permite atualizar hoje
    const br = getNowInBR();
    const et = getNowInET();
    const snapshot = latestAdrSnapshots[ticker];
    
    if (!snapshot) return null;
    
    // Antes das 17:00 BR: sempre retornar snapshot salvo (ontem ou hoje)
    if (br.hour < 17) {
      // Tentar usar snapshot de after_hours (pode ser de ontem)
      if (snapshot.after_hours && snapshot.after_hours.variation != null) {
        const value = snapshot.after_hours.variation;
        const time = snapshot.after_hours.time ? formatTimestamp(snapshot.after_hours.time) : 'sem data';
        console.log(`📊 ${ticker} after-market (tabela): ${value.toFixed(2)}% [CACHE - antes 17h BR] (${time})`);
        return value;
      }
      return null;
    }
    
    // Após 17:00 BR: verificar se estamos na janela after-hours (17-21h ET)
    const inAfterHoursWindow = (et.hour >= 17 && et.hour < 21);
    
    if (inAfterHoursWindow) {
      // Durante janela: preferir dados em tempo real se disponíveis
      const realtimeData = latestMarketSnapshot?.adrs?.[ticker];
      if (realtimeData?.after_hours?.available && realtimeData.after_hours.change_percent != null) {
        const value = realtimeData.after_hours.change_percent;
        console.log(`📊 ${ticker} after-market (tabela): ${value.toFixed(2)}% [TEMPO REAL - janela ET 17-21h]`);
        return value;
      }
    }
    
    // Fora da janela ou sem dados em tempo real: usar snapshot salvo
    if (snapshot.after_hours && snapshot.after_hours.variation != null) {
      const value = snapshot.after_hours.variation;
      const time = snapshot.after_hours.time ? formatTimestamp(snapshot.after_hours.time) : 'sem data';
      console.log(`📊 ${ticker} after-market (tabela): ${value.toFixed(2)}% [CACHE - fora janela] (${time})`);
      return value;
    }
    
    return null;
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
      
      // Usar função especial para after-market (com cache)
      const afterMarketValue = getAfterMarketValueForTable(ticker);
      
      const values = [
        ticker || '--',
        timeValue,
        data && data.current != null ? `$${fmt(data.current, 2)}` : '--',
        formatChange(data && data.variation),
        formatChange(data && data.at_close && data.at_close.change_percent),
        formatChange(afterMarketValue) // ← MUDANÇA: usa cache inteligente
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
    // Prevenir múltiplas execuções simultâneas
    if (window.isUpdating) {
      console.log('⚠️ Atualização já em andamento, ignorando...');
      return;
    }
    
    window.isUpdating = true;
    setStatus('updating','Atualizando...');
    const startTime = performance.now();
    
    try {
      console.log('🚀 Iniciando atualização com rate limiting...');
      
      // 1. Primeiro: Carregar snapshots do Supabase (se necessário)
      if (!supabaseSnapshotsLoaded) {
        console.log('📥 Carregando snapshots do Supabase...');
        await loadSupabaseSnapshotsIfNeeded();
      }
      
      // 2. Segundo: Forçar atualização do backend
      console.log('🔄 Forçando atualização do backend...');
      try {
        await fetchJSON(`${BASE_URL}/update`, 12000);
        console.log('✅ Backend atualizado com sucesso');
      } catch (error) {
        console.warn('⚠️ Falha ao atualizar backend, continuando com dados em cache:', error);
      }
      
      // 3. Terceiro: Buscar dados atualizados
      console.log('📊 Buscando dados de mercado...');
      const data = await fetchJSON(`${BASE_URL}/market-data`, 12000);
      
      if (data && data.status === 'success') {
        applyMarketData(data.data);
        const endTime = performance.now();
        const duration = Math.round(endTime - startTime);
        setStatus('success',`Atualizado em ${duration}ms`);
        setLastUpdate(data.timestamp || new Date().toISOString());
        console.log(`⚡ Atualização concluída em ${duration}ms`);
      } else {
        console.error('❌ Resposta inválida do backend:', data);
        setStatus('error','Erro nos dados');
      }
      
    } catch (error) {
      console.error('❌ Falha ao atualizar dashboard:', error);
      setStatus('error','Erro de conexão');
    } finally {
      window.isUpdating = false;
    }
  }

  // Sistema de debounce para evitar cliques múltiplos
  let lastClickTime = 0;
  const DEBOUNCE_DELAY = 2000; // 2 segundos entre cliques
  
  function debouncedUpdateAll() {
    const now = Date.now();
    if (now - lastClickTime < DEBOUNCE_DELAY) {
      console.log(`⚠️ Aguarde ${Math.ceil((DEBOUNCE_DELAY - (now - lastClickTime)) / 1000)}s antes de clicar novamente`);
      return;
    }
    
    lastClickTime = now;
    updateAll();
  }
  
  function bind(){
    const btn = document.getElementById('updateQuotes');
    if (btn) {
      btn.addEventListener('click', debouncedUpdateAll);
      console.log('✅ Botão de atualização configurado com debounce');
    }

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
        "showVolume": true,
        "showMarketStatus": true,
        "showSymbolLogo": true,
        "displayMode": "regular",
        "fontFamily": "Inter, sans-serif"
      });

      container.appendChild(script);
    });

    tvWidgetLoaded = true;
  }

  // ==================== FEEDBACK HÁPTICO (VIBRAÇÃO) ====================
  
  /**
   * Trigger haptic feedback (vibração) para iPhone e Android
   * @param {string} intensity - 'light', 'medium', 'heavy'
   */
  function triggerHapticFeedback(intensity = 'medium') {
    try {
      // Verificar se o navegador suporta vibração
      if (!navigator.vibrate && !window.navigator.vibrate) {
        console.log('⚠️ Vibração não suportada neste dispositivo');
        return;
      }

      // Padrões de vibração por intensidade
      const patterns = {
        light: [10],           // Vibração leve (10ms)
        medium: [30],          // Vibração média (30ms)
        heavy: [50],           // Vibração forte (50ms)
        success: [10, 50, 10], // Padrão de sucesso
        start: [20, 30, 20]    // Padrão de início
      };

      const pattern = patterns[intensity] || patterns.medium;
      
      // Ativar vibração
      if (navigator.vibrate) {
        navigator.vibrate(pattern);
      } else if (window.navigator.vibrate) {
        window.navigator.vibrate(pattern);
      }
      
      console.log(`📳 Vibração ${intensity} ativada:`, pattern);
    } catch (error) {
      console.warn('❌ Erro ao ativar vibração:', error);
    }
  }

  // ==================== SISTEMA DE CARDS PERSONALIZÁVEIS ====================
  
  // Definição de todos os ativos disponíveis
  const AVAILABLE_ASSETS = [
    // Índices
    { id: 'ibov', name: 'Ibovespa', ticker: '^BVSP', icon: '📊', category: 'index', dataKey: 'winfut' },
    { id: 'vix', name: 'VIX', ticker: '^VIX', icon: '📉', category: 'index', dataKey: 'vix' },
    { id: 'sp500', name: 'S&P 500', ticker: '^GSPC', icon: '🇺🇸', category: 'index', dataKey: 'macro.sp500' },
    { id: 'nasdaq', name: 'Nasdaq 100', ticker: 'NQ=F', icon: '📈', category: 'index', dataKey: 'nasdaq' },
    
    // ETFs e Macro
    { id: 'ewz', name: 'EWZ', ticker: 'EWZ', icon: '🇧🇷', category: 'macro', dataKey: 'macro.ewz' },
    { id: 'dxy', name: 'Dólar (DXY)', ticker: 'DX-Y.NYB', icon: '💵', category: 'macro', dataKey: 'macro.dxy' },
    
    // Commodities
    { id: 'gold', name: 'Gold Futures', ticker: 'GC=F', icon: '🥇', category: 'commodity', dataKey: 'gold' },
    { id: 'iron', name: 'Copper (Iron Ore)', ticker: 'HG=F', icon: '🔶', category: 'commodity', dataKey: 'iron' },
    { id: 'cl', name: 'WTI', ticker: 'CL=F', icon: '🛢️', category: 'commodity', dataKey: 'macro.oil' },
    { id: 'bz', name: 'Brent', ticker: 'BZ=F', icon: '⚫', category: 'commodity', dataKey: 'macro.brent' },
    
    // ADRs Brasileiras
    { id: 'vale', name: 'Vale', ticker: 'VALE', icon: '⛏️', category: 'adr', dataKey: 'adrs.VALE' },
    { id: 'itub', name: 'Itaú Unibanco', ticker: 'ITUB', icon: '🏦', category: 'adr', dataKey: 'adrs.ITUB' },
    { id: 'pbr', name: 'Petrobras', ticker: 'PBR', icon: '🛢️', category: 'adr', dataKey: 'adrs.PBR' },
    { id: 'pbr-a', name: 'Petrobras Classe A', ticker: 'PBR-A', icon: '🛢️', category: 'adr', dataKey: 'adrs.PBR-A' },
    { id: 'bbd', name: 'Banco Bradesco', ticker: 'BBD', icon: '🏦', category: 'adr', dataKey: 'adrs.BBD' },
    { id: 'bbdo', name: 'Bradesco BBDO', ticker: 'BBDO', icon: '🏦', category: 'adr', dataKey: 'adrs.BBDO' },
    { id: 'bsbr', name: 'Santander Brasil', ticker: 'BSBR', icon: '🏦', category: 'adr', dataKey: 'adrs.BSBR' },
    { id: 'bdory', name: 'Banco do Brasil', ticker: 'BDORY', icon: '🏦', category: 'adr', dataKey: 'adrs.BDORY' },
    { id: 'abev', name: 'Ambev', ticker: 'ABEV', icon: '🍺', category: 'adr', dataKey: 'adrs.ABEV' },
    { id: 'erj', name: 'Embraer', ticker: 'ERJ', icon: '✈️', category: 'adr', dataKey: 'adrs.ERJ' }
  ];

  // Configuração padrão de cards
  const DEFAULT_CARDS = ['ibov', 'vale', 'itub', 'pbr', 'dxy', 'ewz', 'cl', 'bz', 'vix'];
  
  let cardsConfig = {
    activeCards: [...DEFAULT_CARDS],
    order: [...DEFAULT_CARDS]
  };

  let sortableInstance = null;

  // Função para obter dados de um ativo pelo dataKey
  function getAssetData(dataKey, marketData) {
    if (!dataKey || !marketData) return null;
    
    const keys = dataKey.split('.');
    let value = marketData;
    
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return null;
      }
    }
    
    return value;
  }

  // Atualizar cards personalizados
  function updateCustomMarketCards(marketData) {
    if (!marketData) return;
    
    AVAILABLE_ASSETS.forEach(asset => {
      const cardElement = document.getElementById(`market-${asset.id}`);
      if (!cardElement) return;
      
      const assetData = getAssetData(asset.dataKey, marketData);
      if (!assetData) return;
      
      const priceEl = document.getElementById(`market-${asset.id}-price`);
      const changeEl = document.getElementById(`market-${asset.id}-change`);
      const subtitleEl = document.getElementById(`market-${asset.id}-subtitle`);
      const timestampEl = document.getElementById(`market-${asset.id}-timestamp`);
      
      if (priceEl) {
        priceEl.textContent = assetData.current != null ? fmt(assetData.current, 2) : '--';
      }
      
      if (changeEl) {
        const change = assetData.variation;
        if (change != null && !isNaN(change)) {
          changeEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
          changeEl.className = 'market-card__change';
          if (change > 0) changeEl.classList.add('positive');
          else if (change < 0) changeEl.classList.add('negative');
        } else {
          changeEl.textContent = '--';
          changeEl.className = 'market-card__change';
        }
      }
      
      if (subtitleEl) {
        subtitleEl.textContent = getDatasetLabel(assetData);
      }
      
      if (timestampEl) {
        const tsValue = resolveDataTimestamp(assetData, 'after');
        timestampEl.textContent = formatTimestamp(tsValue);
      }
      
      const sparkId = `market-spark-${asset.id}`;
      const series = assetData.series && assetData.series.closes || [];
      const tsSeries = assetData.series && assetData.series.timestamps || [];
      drawSparkline(sparkId, series, undefined, tsSeries, null);
      
      if (cardElement) {
        cardElement.classList.remove('positive', 'negative', 'neutral', 'no-data');
        if (assetData.variation != null) {
          if (assetData.variation > 0) cardElement.classList.add('positive');
          else if (assetData.variation < 0) cardElement.classList.add('negative');
          else cardElement.classList.add('neutral');
        } else {
          cardElement.classList.add('no-data');
        }
      }
    });
  }

  // Carregar configuração
  function loadCardsConfig() {
    try {
      const saved = localStorage.getItem('dashboard_cards_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        cardsConfig.activeCards = parsed.activeCards || [...DEFAULT_CARDS];
        cardsConfig.order = parsed.order || [...DEFAULT_CARDS];
      }
    } catch (e) {
      console.error('Erro ao carregar config:', e);
      cardsConfig = { activeCards: [...DEFAULT_CARDS], order: [...DEFAULT_CARDS] };
    }
  }

  // Salvar configuração
  function saveCardsConfig() {
    try {
      localStorage.setItem('dashboard_cards_config', JSON.stringify(cardsConfig));
    } catch (e) {
      console.error('Erro ao salvar config:', e);
    }
  }

  // Criar card HTML
  function createCardHTML(assetId) {
    const asset = AVAILABLE_ASSETS.find(a => a.id === assetId);
    if (!asset) return '';

    const template = document.getElementById(`market-${assetId}`);
    if (template) {
      const clone = template.cloneNode(true);
      clone.setAttribute('data-asset-id', assetId);
      return clone;
    }

    const card = document.createElement('div');
    card.className = 'market-card';
    card.id = `market-${assetId}`;
    card.setAttribute('data-asset-id', assetId);
    card.innerHTML = `
      <div class="market-card__header">
        <span class="market-card__name">${asset.name}</span>
        <span class="market-card__subtitle" id="market-${assetId}-subtitle">--</span>
        <span class="market-card__timestamp" id="market-${assetId}-timestamp">--</span>
      </div>
      <div class="market-card__value" id="market-${assetId}-price">--</div>
      <div class="market-card__change" id="market-${assetId}-change">--</div>
      <div class="sparkline-wrapper">
        <canvas id="market-spark-${assetId}" class="sparkline" height="40"></canvas>
        <div class="sparkline-tooltip" id="market-spark-${assetId}-tooltip"></div>
      </div>
    `;
    return card;
  }

  // Renderizar cards
  function renderMarketCards() {
    const grid = document.getElementById('market-grid');
    if (!grid) return;

    grid.innerHTML = '';

    cardsConfig.order.forEach(assetId => {
      if (cardsConfig.activeCards.includes(assetId)) {
        const cardElement = createCardHTML(assetId);
        if (cardElement) {
          grid.appendChild(cardElement);
        }
      }
    });

    initSortable();

    if (latestMarketSnapshot) {
      updateCustomMarketCards(latestMarketSnapshot);
    }
  }

  // Inicializar Sortable com vibração
  function initSortable() {
    const grid = document.getElementById('market-grid');
    if (!grid) return;

    if (sortableInstance) {
      sortableInstance.destroy();
    }

    sortableInstance = Sortable.create(grid, {
      animation: 200,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      forceFallback: true,
      fallbackTolerance: 10,
      touchStartThreshold: 30,
      delay: 300,
      delayOnTouchOnly: true,
      preventOnFilter: true,
      swapThreshold: 0.65,
      onStart: function(evt) {
        // Vibração ao começar arrastar
        triggerHapticFeedback('start');
        console.log('🎯 Drag iniciado - Vibração!');
      },
      onMove: function(evt) {
        // Vibração leve ao mover
        triggerHapticFeedback('light');
      },
      onEnd: function(evt) {
        // Vibração ao soltar
        triggerHapticFeedback('heavy');
        
        const newOrder = [];
        const cards = grid.querySelectorAll('.market-card[data-asset-id]');
        cards.forEach(card => {
          const assetId = card.getAttribute('data-asset-id');
          if (assetId) newOrder.push(assetId);
        });
        cardsConfig.order = newOrder;
        saveCardsConfig();
      }
    });
  }

  // Modal functions
  function openConfigModal() {
    const modal = document.getElementById('cardsConfigModal');
    if (!modal) return;
    modal.classList.add('active');
    renderConfigLists();
  }

  function closeConfigModal() {
    const modal = document.getElementById('cardsConfigModal');
    if (modal) modal.classList.remove('active');
  }

  function renderConfigLists() {
    const availableList = document.getElementById('availableAssetsList');
    const activeList = document.getElementById('activeAssetsList');
    
    if (!availableList || !activeList) return;

    availableList.innerHTML = '';
    AVAILABLE_ASSETS.forEach(asset => {
      if (!cardsConfig.activeCards.includes(asset.id)) {
        const item = createAssetItemHTML(asset, false);
        availableList.appendChild(item);
      }
    });

    activeList.innerHTML = '';
    cardsConfig.order.forEach(assetId => {
      if (cardsConfig.activeCards.includes(assetId)) {
        const asset = AVAILABLE_ASSETS.find(a => a.id === assetId);
        if (asset) {
          const item = createAssetItemHTML(asset, true);
          activeList.appendChild(item);
        }
      }
    });

    if (activeList) {
      Sortable.create(activeList, {
        animation: 200,
        ghostClass: 'sortable-ghost',
        handle: '.asset-item-drag-handle',
        onEnd: function() {
          const newOrder = [];
          const items = activeList.querySelectorAll('.asset-item[data-asset-id]');
          items.forEach(item => {
            newOrder.push(item.getAttribute('data-asset-id'));
          });
          cardsConfig.order = newOrder;
        }
      });
    }
  }

  function createAssetItemHTML(asset, isActive) {
    const item = document.createElement('div');
    item.className = `asset-item ${isActive ? 'active' : ''}`;
    item.setAttribute('data-asset-id', asset.id);

    item.innerHTML = `
      <div class="asset-item-info">
        ${isActive ? '<span class="asset-item-drag-handle">☰</span>' : ''}
        <span class="asset-item-icon">${asset.icon}</span>
        <div class="asset-item-details">
          <span class="asset-item-name">${asset.name}</span>
          <span class="asset-item-ticker">${asset.ticker}</span>
        </div>
      </div>
      <button class="asset-item-action" data-action="${isActive ? 'remove' : 'add'}">
        ${isActive ? '✕ Remover' : '+ Adicionar'}
      </button>
    `;

    const btn = item.querySelector('.asset-item-action');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isActive) {
        removeAsset(asset.id);
      } else {
        addAsset(asset.id);
      }
    });

    return item;
  }

  function addAsset(assetId) {
    if (!cardsConfig.activeCards.includes(assetId)) {
      cardsConfig.activeCards.push(assetId);
      if (!cardsConfig.order.includes(assetId)) {
        cardsConfig.order.push(assetId);
      }
      renderConfigLists();
    }
  }

  function removeAsset(assetId) {
    cardsConfig.activeCards = cardsConfig.activeCards.filter(id => id !== assetId);
    renderConfigLists();
  }

  function saveAndClose() {
    saveCardsConfig();
    renderMarketCards();
    closeConfigModal();
    
    const statusEl = document.getElementById('quotesStatus');
    if (statusEl) {
      const originalHTML = statusEl.innerHTML;
      statusEl.innerHTML = '<span class="status-text">✓ Configuração salva</span>';
      statusEl.className = 'quotes-status success';
      setTimeout(() => {
        statusEl.innerHTML = originalHTML;
        statusEl.className = 'quotes-status';
      }, 2000);
    }
  }

  function resetToDefault() {
    if (confirm('Deseja restaurar a configuração padrão de cards?')) {
      cardsConfig = {
        activeCards: [...DEFAULT_CARDS],
        order: [...DEFAULT_CARDS]
      };
      saveCardsConfig();
      renderConfigLists();
    }
  }

  function bindConfigModalEvents() {
    const configBtn = document.getElementById('configureCards');
    const closeBtn = document.getElementById('closeConfigModal');
    const saveBtn = document.getElementById('saveCardsConfig');
    const resetBtn = document.getElementById('resetCardsConfig');
    const modal = document.getElementById('cardsConfigModal');

    if (configBtn) configBtn.addEventListener('click', openConfigModal);
    if (closeBtn) closeBtn.addEventListener('click', closeConfigModal);
    if (saveBtn) saveBtn.addEventListener('click', saveAndClose);
    if (resetBtn) resetBtn.addEventListener('click', resetToDefault);

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeConfigModal();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && modal.classList.contains('active')) {
        closeConfigModal();
      }
    });
  }

  function initCardsSystem() {
    loadCardsConfig();
    renderMarketCards();
    bindConfigModalEvents();
    console.log('✅ Sistema de cards com vibração inicializado');
  }

  // bootstrap
  bind();
  initCardsSystem();
  updateAll();
})();



const svg = document.getElementById('chartSvg');
const liveClock = document.getElementById('liveClock');
const connectionStatus = document.getElementById('connectionStatus');
const updatedAt = document.getElementById('updatedAt');
const chartLastPrice = document.getElementById('chartLastPrice');
const themeToggle = document.getElementById('themeToggle');
const chartSymbolSelect = document.getElementById('chartSymbolSelect');
const assistantMessages = document.getElementById('assistantMessages');
const assistantForm = document.getElementById('assistantForm');
const assistantInput = document.getElementById('assistantInput');
const assistantStorageStatus = document.getElementById('assistantStorageStatus');
const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
let refreshTimer;
const AGENT_HISTORY_KEY = 'indian-market-agent-history-v1';
const MAX_AGENT_HISTORY_BARS = 1200;
const THEME_KEY = 'indian-market-dashboard-theme-v1';
const CHAT_HISTORY_KEY = 'indian-market-dashboard-chat-v1';
const CHART_SYMBOL_KEY = 'indian-market-dashboard-chart-symbol-v1';
const MAX_CHAT_MESSAGES = 100;
let watchlistSortKey = null;
let watchlistSortDirection = 1;
let savedChatMessages = [];
let selectedChartSymbol = '';
let marketDataRequestId = 0;

function getSavedTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function applyTheme(theme, persist = false) {
  const nextTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nextTheme;
  if (themeToggle) {
    themeToggle.textContent = nextTheme === 'dark' ? 'Light theme' : 'Dark theme';
    themeToggle.setAttribute('aria-label', `Switch to ${nextTheme === 'dark' ? 'light' : 'dark'} theme`);
    themeToggle.title = '';
  }
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, nextTheme);
    } catch {
      if (themeToggle) themeToggle.title = 'Theme preference cannot be saved in this browser.';
    }
  }
  if (svg) renderChart(window.latestMarketChart || []);
}

applyTheme(getSavedTheme());
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });
}

function updateClock() {
  if (!liveClock) return;

  liveClock.textContent = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    hour12: false
  }).format(new Date());
}

function setConnectionStatus(label, state) {
  if (!connectionStatus) return;

  connectionStatus.replaceChildren();
  const pulse = document.createElement('span');
  pulse.className = 'pulse';
  connectionStatus.append(pulse, document.createTextNode(` ${label}`));
  connectionStatus.classList.toggle('is-live', state === 'connected');
  connectionStatus.classList.toggle('is-delayed', state === 'delayed');
  connectionStatus.classList.toggle('is-offline', state === 'offline');
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function formatCurrency(value) {
  return Number.isFinite(value) ? currencyFormatter.format(value) : '—';
}

function renderTopGainers(quotes = []) {
  const list = document.getElementById('topGainersList');
  if (!list) return;

  const gainers = quotes
    .filter((quote) => Number.isFinite(quote.percentChange) && quote.percentChange > 0)
    .sort((left, right) => right.percentChange - left.percentChange)
    .slice(0, 3);
  list.replaceChildren();
  if (gainers.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'top-gainers-empty';
    empty.textContent = quotes.length > 0 ? 'No positive movers in the current watchlist.' : 'Waiting for verified quote data.';
    list.appendChild(empty);
    return;
  }

  gainers.forEach((quote, index) => {
    const item = document.createElement('li');
    const rank = document.createElement('span');
    rank.className = 'gainer-rank';
    rank.textContent = String(index + 1).padStart(2, '0');
    const symbol = document.createElement('strong');
    symbol.textContent = quote.symbol;
    const price = document.createElement('span');
    price.className = 'gainer-price';
    price.textContent = formatCurrency(quote.price);
    const change = document.createElement('strong');
    change.className = 'gainer-change';
    change.textContent = `+${quote.percentChange.toFixed(2)}%`;
    item.append(rank, symbol, price, change);
    list.appendChild(item);
  });
}

function setAssistantStorageStatus(message) {
  if (assistantStorageStatus) assistantStorageStatus.textContent = message;
}

function appendAssistantMessage(role, text) {
  if (!assistantMessages) return;
  const item = document.createElement('li');
  item.className = `assistant-message assistant-message-${role}`;
  const label = document.createElement('span');
  label.className = 'assistant-message-label';
  label.textContent = role === 'user' ? 'You' : 'Assistant';
  const content = document.createElement('p');
  content.textContent = text;
  item.append(label, content);
  assistantMessages.appendChild(item);
}

function renderAssistantHistory() {
  if (!assistantMessages) return;
  assistantMessages.replaceChildren();
  if (savedChatMessages.length === 0) {
    appendAssistantMessage(
      'assistant',
      'Hi! I can summarize loaded NSE watchlist quotes, list top gainers, and describe the intraday chart. I only use data currently shown on this dashboard.'
    );
    return;
  }
  savedChatMessages.forEach(({ role, text }) => appendAssistantMessage(role, text));
}

function loadAssistantHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || '[]');
    if (!Array.isArray(saved)) throw new Error('Saved chat must be a list of messages.');
    savedChatMessages = saved
      .filter((message) => message
        && (message.role === 'user' || message.role === 'assistant')
        && typeof message.text === 'string'
        && message.text.length <= 2000)
      .slice(-MAX_CHAT_MESSAGES);
  } catch {
    savedChatMessages = [];
    setAssistantStorageStatus('Saved conversation could not be read. New messages will remain visible until this page is refreshed.');
  }
  renderAssistantHistory();
}

function saveAssistantHistory() {
  try {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(savedChatMessages));
    setAssistantStorageStatus('Conversation saved in this browser on this device only.');
  } catch {
    setAssistantStorageStatus('Browser storage is unavailable. The conversation will not persist after this page closes.');
  }
}

function getWatchlistGainers() {
  return (window.latestMarketQuotes || [])
    .filter((quote) => Number.isFinite(quote.percentChange) && quote.percentChange > 0)
    .sort((left, right) => right.percentChange - left.percentChange);
}

function getAssistantReply(question) {
  const normalized = question.toLowerCase();
  const quotes = window.latestMarketQuotes || [];
  const tokens = new Set(question.toUpperCase().match(/[A-Z0-9&.-]+/g) || []);
  const requestedQuotes = quotes.filter((quote) => tokens.has(quote.symbol.toUpperCase()));
  const dataLabel = window.latestMarketSourceLabel || 'configured market-data feed';

  if (/\b(buy|sell|invest|recommend|should i|target price)\b/.test(normalized)) {
    return 'I can report observed quotes and indicators, but I can’t recommend trades or predict a target price. Market data can be delayed; use an exchange-authorized source and your own judgment.';
  }
  if (/\b(gainer|gainers|top movers|best performers)\b/.test(normalized)) {
    const gainers = getWatchlistGainers().slice(0, 3);
    return gainers.length
      ? `Top positive movers in the configured watchlist: ${gainers.map((quote) => `${quote.symbol} ${formatPercent(quote.percentChange)}`).join(', ')}. These are watchlist-only daily changes, not all NSE listings.`
      : 'There are no positive movers with verified change data in the current watchlist.';
  }
  if (requestedQuotes.length > 0) {
    return requestedQuotes
      .map((quote) => `${quote.symbol}: ${formatCurrency(quote.price)}${Number.isFinite(quote.percentChange) ? ` (${formatPercent(quote.percentChange)} today)` : ''}. Updated ${quote.timestamp || 'time not provided by the feed'}.`)
      .join(' ');
  }
  if (/\b(chart|intraday|bars|history)\b/.test(normalized)) {
    const count = (window.latestMarketChart || []).length;
    return count > 0
      ? `${selectedChartSymbol || 'Selected symbol'} has ${count} intraday price points on the chart. The dashboard renders the loaded feed locally; bar availability and delay depend on the provider.`
      : 'Intraday chart data is currently unavailable. No sample prices are substituted.';
  }
  if (/\b(summary|summarize|watchlist|market|status)\b/.test(normalized)) {
    const summary = quotes
      .slice(0, 6)
      .map((quote) => `${quote.symbol} ${formatCurrency(quote.price)}${Number.isFinite(quote.percentChange) ? ` (${formatPercent(quote.percentChange)})` : ''}`)
      .join('; ');
    return summary
      ? `Current watchlist snapshot from ${dataLabel}: ${summary}. NSE session state is ${document.getElementById('marketState')?.textContent || 'unknown'}.`
      : 'No market quotes are loaded right now. Check the data connection panel; I won’t invent prices.';
  }
  return 'Try asking for a symbol quote, “top gainers,” a watchlist summary, or chart status. I answer only from the loaded dashboard data and don’t provide personalized investment advice.';
}

function submitAssistantMessage(text) {
  const question = text.trim();
  if (!question || question.length > 500) return;
  const reply = getAssistantReply(question);
  savedChatMessages.push(
    { role: 'user', text: question },
    { role: 'assistant', text: reply }
  );
  savedChatMessages = savedChatMessages.slice(-MAX_CHAT_MESSAGES);
  renderAssistantHistory();
  saveAssistantHistory();
  assistantMessages?.lastElementChild?.scrollIntoView({ block: 'nearest' });
}

loadAssistantHistory();
assistantForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!assistantInput) return;
  submitAssistantMessage(assistantInput.value);
  assistantInput.value = '';
  assistantInput.focus();
});
document.querySelectorAll('.assistant-prompt').forEach((button) => {
  button.addEventListener('click', () => submitAssistantMessage(button.dataset.prompt || ''));
});
document.getElementById('assistantClear')?.addEventListener('click', () => {
  savedChatMessages = [];
  renderAssistantHistory();
  try {
    localStorage.removeItem(CHAT_HISTORY_KEY);
    setAssistantStorageStatus('Conversation cleared from this browser.');
  } catch {
    setAssistantStorageStatus('Could not clear the saved conversation because browser storage is unavailable.');
  }
});

function populateChartSymbolSelect(chartSymbols = []) {
  if (!chartSymbolSelect) return;
  const symbols = [...new Set(chartSymbols.filter((symbol) => typeof symbol === 'string'))];
  if (symbols.length === 0) return;
  chartSymbolSelect.replaceChildren();
  symbols.forEach((symbol) => {
    const option = document.createElement('option');
    option.value = symbol;
    option.textContent = symbol;
    chartSymbolSelect.appendChild(option);
  });
  if (!symbols.includes(selectedChartSymbol)) selectedChartSymbol = symbols[0];
  chartSymbolSelect.value = selectedChartSymbol;
}

chartSymbolSelect?.addEventListener('change', () => {
  selectedChartSymbol = chartSymbolSelect.value;
  try {
    localStorage.setItem(CHART_SYMBOL_KEY, selectedChartSymbol);
  } catch {
    setAssistantStorageStatus('Chart symbol preference cannot be saved in this browser.');
  }
  loadMarketData();
});

try {
  selectedChartSymbol = localStorage.getItem(CHART_SYMBOL_KEY) || '';
} catch {
  selectedChartSymbol = '';
}

function populateWatchlist(quotes = []) {
  const tableBody = document.getElementById('watchlist-body');
  if (!tableBody) return;

  tableBody.replaceChildren();
  if (quotes.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'empty-watchlist';
    cell.textContent = 'Waiting for configured NSE quote data.';
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  const sortedQuotes = [...quotes];
  if (watchlistSortKey) {
    sortedQuotes.sort((left, right) => {
      const leftValue = left[watchlistSortKey];
      const rightValue = right[watchlistSortKey];
      if (leftValue == null) return rightValue == null ? 0 : 1;
      if (rightValue == null) return -1;
      const comparison = watchlistSortKey === 'symbol'
        ? String(leftValue).localeCompare(String(rightValue))
        : typeof leftValue === 'number' && typeof rightValue === 'number'
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue));
      return comparison * watchlistSortDirection;
    });
  }

  sortedQuotes.forEach((quote) => {
    const row = document.createElement('tr');
    const symbolCell = document.createElement('td');
    const symbol = document.createElement('span');
    symbol.className = 'symbol';
    symbol.textContent = quote.symbol;
    symbolCell.appendChild(symbol);

    const priceCell = document.createElement('td');
    priceCell.textContent = formatCurrency(quote.price);

    const changeCell = document.createElement('td');
    const change = Number.isFinite(quote.percentChange) ? quote.percentChange : null;
    changeCell.textContent = change === null ? '—' : `${change > 0 ? '+' : ''}${change.toFixed(2)}%`;
    if (change !== null) changeCell.className = change >= 0 ? 'buy' : 'sell';

    const timeCell = document.createElement('td');
    timeCell.textContent = quote.timestamp || '—';

    row.append(symbolCell, priceCell, changeCell, timeCell);
    tableBody.appendChild(row);
  });
}

function sortWatchlist(key) {
  if (!['symbol', 'price', 'percentChange', 'timestamp'].includes(key)) return;
  if (watchlistSortKey === key) {
    watchlistSortDirection *= -1;
  } else {
    watchlistSortKey = key;
    watchlistSortDirection = key === 'symbol' || key === 'timestamp' ? 1 : -1;
  }

  document.querySelectorAll('.table-sort-button').forEach((button) => {
    const active = button.dataset.sortKey === watchlistSortKey;
    const heading = button.closest('th');
    if (!heading) return;
    heading.setAttribute('aria-sort', active
      ? watchlistSortDirection > 0 ? 'ascending' : 'descending'
      : 'none');
    button.setAttribute('aria-label', active
      ? `Sort by ${button.textContent.trim()}, ${watchlistSortDirection > 0 ? 'ascending' : 'descending'}`
      : `Sort by ${button.textContent.trim()}`);
    const indicator = button.querySelector('span');
    if (indicator) indicator.textContent = active
      ? watchlistSortDirection > 0 ? ' ▲' : ' ▼'
      : '';
  });
}

document.querySelectorAll('.table-sort-button').forEach((button) => {
  button.addEventListener('click', () => sortWatchlist(button.dataset.sortKey));
});

function createSvgElement(tag, attrs) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function renderChart(points) {
  if (!svg) return;
  svg.replaceChildren();

  const validPoints = points.filter((point) => Number.isFinite(point.close));
  if (validPoints.length < 2) {
    const message = createSvgElement('text', {
      x: 510,
      y: 210,
      fill: document.documentElement.dataset.theme === 'light'
        ? 'rgba(20,36,43,0.68)'
        : 'rgba(255,255,255,0.65)',
      'font-size': 16,
      'font-family': 'Inter, sans-serif',
      'text-anchor': 'middle'
    });
    message.textContent = 'Chart data will appear when the NSE feed is configured.';
    svg.appendChild(message);
    return;
  }

  const width = 1020;
  const height = 420;
  const margin = { top: 38, right: 24, bottom: 28, left: 76 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const values = validPoints.map((point) => point.close);
  const minPrice = Math.min(...values);
  const maxPrice = Math.max(...values);
  const padding = Math.max((maxPrice - minPrice) * 0.1, maxPrice * 0.002);
  const minY = minPrice - padding;
  const maxY = maxPrice + padding;
  const priceY = (value) => margin.top + ((maxY - value) / (maxY - minY)) * innerHeight;

  for (let index = 0; index <= 5; index += 1) {
    const value = maxY - ((maxY - minY) * index) / 5;
    const y = margin.top + (innerHeight / 5) * index;
    svg.appendChild(createSvgElement('line', {
      x1: margin.left,
      x2: width - margin.right,
      y1: y,
      y2: y,
      stroke: document.documentElement.dataset.theme === 'light'
        ? 'rgba(20,36,43,0.12)'
        : 'rgba(255,255,255,0.1)',
      'stroke-width': 1
    }));

    const label = createSvgElement('text', {
      x: margin.left - 10,
      y: y + 4,
      fill: document.documentElement.dataset.theme === 'light'
        ? 'rgba(20,36,43,0.68)'
        : 'rgba(255,255,255,0.56)',
      'font-size': 11,
      'font-family': 'Inter, sans-serif',
      'text-anchor': 'end'
    });
    label.textContent = `₹${value.toFixed(2)}`;
    svg.appendChild(label);
  }

  const pointsText = validPoints.map((point, index) => {
    const x = margin.left + (index / (validPoints.length - 1)) * innerWidth;
    return `${x},${priceY(point.close)}`;
  }).join(' ');

  const line = createSvgElement('polyline', {
    points: pointsText,
    fill: 'none',
    stroke: document.documentElement.dataset.theme === 'light' ? '#a85b00' : '#ffb14a',
    'stroke-width': 2.5,
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round'
  });
  svg.appendChild(line);

  const ema = [];
  let average = values[0];
  values.forEach((value) => {
    average = 0.12 * value + 0.88 * average;
    ema.push(average);
  });

  const emaPoints = ema.map((value, index) => {
    const x = margin.left + (index / (ema.length - 1)) * innerWidth;
    return `${x},${priceY(value)}`;
  }).join(' ');
  svg.appendChild(createSvgElement('polyline', {
    points: emaPoints,
    fill: 'none',
    stroke: document.documentElement.dataset.theme === 'light' ? '#087446' : '#2dff8e',
    'stroke-width': 1.7,
    'stroke-dasharray': '5 5',
    opacity: 0.8
  }));

  const last = validPoints[validPoints.length - 1];
  const lastY = priceY(last.close);
  svg.appendChild(createSvgElement('circle', {
    cx: width - margin.right,
    cy: lastY,
    r: 4,
    fill: document.documentElement.dataset.theme === 'light' ? '#a85b00' : '#ffb14a'
  }));
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%` : '—';
}

function updateBacktest(prefix, result, points) {
  const state = document.getElementById(`${prefix}BacktestState`);
  const footnote = document.getElementById(`${prefix}BacktestPeriod`);
  const hasHistory = result.bars >= 22;
  const hasTrades = result.tradeCount > 0;
  const message = !hasHistory
    ? 'Insufficient history'
    : !hasTrades
      ? 'No completed trades'
      : result.tradeCount < 3
        ? `Small sample · ${result.tradeCount} trade${result.tradeCount === 1 ? '' : 's'}`
        : `${result.tradeCount} simulated trades`;

  if (state) state.textContent = message;
  setText(`${prefix}NetReturn`, hasTrades ? formatPercent(result.netReturnPct) : '—');
  setText(`${prefix}DetailNetReturn`, hasTrades ? formatPercent(result.netReturnPct) : '—');
  setText(`${prefix}WinRate`, hasTrades ? formatPercent(result.winRatePct) : '—');
  setText(`${prefix}Drawdown`, hasTrades ? `-${result.maxDrawdownPct.toFixed(2)}%` : '—');
  setText(`${prefix}TradeCount`, String(result.tradeCount));
  setText(`${prefix}DetailTradeCount`, String(result.tradeCount));

  const firstPoint = points.find((point) => Number.isFinite(point.close));
  const lastPoint = [...points].reverse().find((point) => Number.isFinite(point.close));
  const formatDate = (value) => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime())
      ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(date)
      : null;
  };
  const period = firstPoint && lastPoint
    ? `${result.bars} bars · ${formatDate(firstPoint.time) || 'start'} to ${formatDate(lastPoint.time) || 'latest'}`
    : `${result.bars} valid bars`;
  if (footnote) {
    footnote.textContent = `${period}. Metrics apply 0.10% estimated cost per fill; fewer than 3 trades is a very small sample.`;
  }
}

function renderStrategies(points, symbol) {
  const validPoints = points.filter((point) => Number.isFinite(point.close) && point.close > 0);
  setText('strategySymbol', symbol || 'the selected symbol');

  if (!window.StrategyEngine) {
    setText('emaBacktestState', 'Calculation unavailable');
    setText('rsiBacktestState', 'Calculation unavailable');
    setText('scenarioState', 'Calculation unavailable');
    return;
  }

  const emaResult = window.StrategyEngine.backtestEma(validPoints);
  const rsiResult = window.StrategyEngine.backtestRsi(validPoints);
  updateBacktest('ema', emaResult, validPoints);
  updateBacktest('rsi', rsiResult, validPoints);

  const scenario = window.StrategyEngine.evaluateScenario(validPoints);
  const state = document.getElementById('scenarioState');
  const bias = document.getElementById('scenarioBias');
  const hasScenario = scenario !== null;

  if (state) state.textContent = hasScenario ? 'Indicator conditions · not a forecast' : 'Insufficient history';
  if (bias) {
    bias.textContent = scenario?.bias || 'Insufficient data';
    bias.classList.toggle('is-bullish', Boolean(scenario && scenario.bias.startsWith('Bullish')));
    bias.classList.toggle('is-bearish', Boolean(scenario && scenario.bias.startsWith('Bearish')));
  }
  setText('scenarioEma', scenario ? `${scenario.emaFast.toFixed(2)} / ${scenario.emaSlow.toFixed(2)}` : '—');
  setText('scenarioRsi', scenario ? scenario.rsi.toFixed(1) : '—');
  setText('scenarioLastClose', scenario ? formatCurrency(scenario.lastClose) : '—');
  setText('scenarioQuickRsi', scenario ? scenario.rsi.toFixed(1) : '—');
  setText('scenarioQuickClose', scenario ? formatCurrency(scenario.lastClose) : '—');
  setText('scenarioCondition', scenario?.condition || 'Waiting for at least 21 valid closes to calculate indicators.');
  setText('scenarioInvalidation', scenario?.invalidation || 'No scenario is active.');
  renderAdaptiveAgent(points, symbol);
}

function mergeAgentHistory(symbol, freshPoints) {
  const fresh = freshPoints
    .filter((point) => point
      && Number.isFinite(point.close)
      && point.close > 0
      && point.time
      && Number.isFinite(Date.parse(point.time)))
    .map((point) => ({ timestamp: Date.parse(point.time), close: point.close }))
    .sort((left, right) => left.timestamp - right.timestamp);
  const completedBars = fresh.slice(0, -1);
  const currentByTime = new Map(completedBars.map((point) => [point.timestamp, {
    time: new Date(point.timestamp).toISOString(),
    close: point.close
  }]));
  let history;

  try {
    history = JSON.parse(localStorage.getItem(AGENT_HISTORY_KEY) || '{}');
  } catch {
    return {
      points: [...currentByTime.values()],
      error: 'Saved agent history is unreadable. The agent is using only the current feed until browser storage is cleared.'
    };
  }
  if (!history || typeof history !== 'object' || Array.isArray(history)) {
    return {
      points: [...currentByTime.values()],
      error: 'Saved agent history has an invalid format. The agent is using only the current feed.'
    };
  }

  const priorPoints = Array.isArray(history[symbol]) ? history[symbol] : [];
  priorPoints.forEach((point) => {
    const timestamp = point && point.time ? Date.parse(point.time) : NaN;
    if (Number.isFinite(timestamp) && Number.isFinite(point.close) && point.close > 0) {
      currentByTime.set(timestamp, {
        time: new Date(timestamp).toISOString(),
        close: point.close
      });
    }
  });

  const merged = [...currentByTime.entries()]
    .sort(([left], [right]) => left - right)
    .slice(-MAX_AGENT_HISTORY_BARS)
    .map(([, point]) => point);

  try {
    history[symbol] = merged;
    localStorage.setItem(AGENT_HISTORY_KEY, JSON.stringify(history));
    return { points: merged, error: null };
  } catch {
    return {
      points: merged,
      error: 'Browser storage is unavailable or full. Agent history will not persist between page visits.'
    };
  }
}

function renderAdaptiveAgent(points, symbol) {
  if (!window.StrategyEngine?.trainAdaptiveAgent) return;

  const history = mergeAgentHistory(symbol || 'NSE', points);
  const result = window.StrategyEngine.trainAdaptiveAgent(history.points);
  const trained = result.status === 'trained';
  const validation = result.validation;

  setText('agentHistoryCount', `${result.bars} / ${result.requiredBars} bars`);
  setText('agentSelectedRule', result.selected
    ? `EMA ${result.selected.fastPeriod}/${result.selected.slowPeriod}`
    : result.status === 'collecting'
      ? 'Learning pending'
      : 'No rule selected');
  setText('agentValidationReturn', result.validation
    ? formatPercent(result.validation.netReturnPct)
    : '—');
  setText('agentValidationBaseline', result.validation
    ? formatPercent(result.validation.buyAndHoldReturnPct)
    : '—');
  setText('agentValidationDrawdown', result.validation
    ? `-${result.validation.maxDrawdownPct.toFixed(2)}%`
    : '—');
  setText('agentState', !trained
    ? result.status === 'insufficient-trades' ? 'Training inconclusive' : 'Collecting data'
    : validation.tradeCount < result.validationTradesRequired
      ? 'Holdout sample too small'
      : validation.netReturnPct > 0 && validation.beatBuyAndHold && validation.maxDrawdownPct <= 15
        ? 'Holdout gates passed'
        : 'Risk gate failed');
  setText('agentAction', result.action);
  setText('agentMessage', result.message);
  setText('agentDetailSummary', trained
    ? `${result.message} Candidate selection covered ${result.trainingBars} bars across ${result.walkForwardFolds} chronological windows; the final ${result.validationBars}-bar holdout was not used for tuning. The selected candidate made ${validation.tradeCount} holdout trades; at least ${result.validationTradesRequired} are required.`
    : result.message);
  setText('agentLearningRead', trained
    ? `Scored the fixed EMA candidates on ${result.walkForwardFolds} non-overlapping chronological windows across ${result.trainingBars} bars; the selected rule traded in ${result.selected.activeFolds} windows (${result.training.tradeCount} trades total). Selection penalizes drawdown.`
    : `Requires ${result.requiredBars} completed bars. Searches a fixed EMA candidate set across three chronological windows; candidates must trade in at least two windows.`);
  setText('agentValidationRead', validation
    ? `Untouched holdout: ${validation.tradeCount} strategy trades (minimum ${result.validationTradesRequired}); strategy ${formatPercent(validation.netReturnPct)} vs buy-and-hold ${formatPercent(validation.buyAndHoldReturnPct)}; max drawdown ${validation.maxDrawdownPct.toFixed(2)}%. A paper setup additionally needs positive return, baseline outperformance, drawdown at or below 15%, and aligned current indicators.`
    : 'The final 20% is held out from parameter selection. At least three holdout trades, positive net return, lower drawdown than 15%, and outperformance of a cost-adjusted buy-and-hold benchmark are required before considering a paper setup.');
  setText('agentCurrentRead', result.current
    ? `Last close ${formatCurrency(result.current.lastClose)}; EMA ${result.selected.fastPeriod} ${result.current.fastEma.toFixed(2)}, EMA ${result.selected.slowPeriod} ${result.current.slowEma.toFixed(2)}, RSI 14 ${result.current.rsi.toFixed(1)}.`
    : 'No rule has been trained yet.');
  setText('agentPersistenceStatus', history.error
    || `History stays in this browser only and is capped at ${MAX_AGENT_HISTORY_BARS} bars per symbol. No credentials or account data are stored.`);
}

function setMarketData(data) {
  const quotes = data.quotes || [];
  window.latestMarketChart = data.chart || [];
  window.latestMarketQuotes = quotes;
  selectedChartSymbol = data.chartSymbol || selectedChartSymbol;
  window.latestMarketSourceLabel = data.provider || data.source || 'configured market-data feed';
  populateChartSymbolSelect(data.chartSymbols || quotes.map((quote) => quote.symbol));
  const primary = quotes.find((quote) => quote.symbol === data.chartSymbol);
  const isConnected = data.configured && quotes.length > 0;
  const isYahoo = data.source === 'yahoo-finance-unofficial';
  const isAlphaVantage = data.source === 'alpha-vantage';
  const providerName = isYahoo
    ? 'Yahoo Finance · unofficial'
    : isAlphaVantage
      ? 'Alpha Vantage · delayed snapshot'
      : 'Twelve Data';
  const badgeLabel = isConnected
    ? isYahoo ? 'Yahoo · unofficial' : isAlphaVantage ? 'Alpha Vantage · snapshot' : 'NSE · provider feed'
    : 'Feed unavailable';

  setConnectionStatus(
    isConnected ? providerName : data.configured ? 'Provider error' : 'Data not configured',
    isConnected ? isYahoo || isAlphaVantage ? 'delayed' : 'connected' : 'offline'
  );
  setText('feedLabel', isConnected
    ? isYahoo
      ? 'Unofficial feed · latency unknown'
      : isAlphaVantage
        ? 'Snapshot · market/plan dependent'
        : 'Quote feed connected'
    : 'Provider feed required');
  setText('watchlistStatus', badgeLabel);
  setText('primaryQuoteSymbol', primary ? `${primary.symbol} · NSE` : `${data.chartSymbol || 'NSE'} · NSE`);
  setText('primaryQuotePrice', primary ? formatCurrency(primary.price) : '—');

  const dayChange = primary && Number.isFinite(primary.percentChange)
    ? `${primary.percentChange > 0 ? '+' : ''}${primary.percentChange.toFixed(2)}%`
    : '—';
  const dayChangeElement = document.getElementById('primaryQuoteChange');
  if (dayChangeElement) {
    dayChangeElement.textContent = dayChange;
    dayChangeElement.classList.toggle('buy', Boolean(primary && primary.percentChange >= 0));
    dayChangeElement.classList.toggle('sell', Boolean(primary && primary.percentChange < 0));
  }

  setText('exchangeRate', Number.isFinite(data.exchangeRate) ? data.exchangeRate.toFixed(4) : '—');
  setText('chartSymbol', data.chartSymbol || 'NSE');
  setText('chartLastPrice', primary ? formatCurrency(primary.price) : '—');
  setText('marketState', primary?.marketOpen === true ? 'OPEN' : primary?.marketOpen === false ? 'CLOSED' : 'UNKNOWN');

  const marketState = document.getElementById('marketState');
  if (marketState) {
    marketState.classList.toggle('market-open', primary?.marketOpen === true);
    marketState.classList.toggle('market-closed', primary?.marketOpen !== true);
  }

  if (updatedAt) {
    updatedAt.textContent = data.updatedAt
      ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).format(new Date(data.updatedAt))
      : '—';
  }

  const feedMessage = document.getElementById('feedMessage');
  if (feedMessage) {
    const partialErrors = (data.errors || []).join(' · ');
    feedMessage.textContent = isConnected && (isYahoo || isAlphaVantage)
      ? `${data.disclaimer || 'Unofficial market data; real-time access is not guaranteed.'}${partialErrors ? ` Some requests failed: ${partialErrors}` : ''}`
      : isConnected
        ? partialErrors
          ? `Some market-data requests failed: ${partialErrors}`
          : 'NSE quote data is being served by Twelve Data. Confirm your subscription includes real-time NSE access before relying on quote latency.'
        : [data.error, partialErrors].filter(Boolean).join(' · ')
          || 'Market data providers are currently unavailable.';
  }

  populateWatchlist(quotes);
  renderTopGainers(quotes);
  renderChart(data.chart || []);
  renderStrategies(data.chart || [], data.chartSymbol || 'NSE');

  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(loadMarketData, Math.max(30, Number(data.refreshSeconds) || 60) * 1000);
}

async function loadMarketData(chartSymbol = selectedChartSymbol) {
  const requestId = ++marketDataRequestId;
  const configuredApiBase = String(window.MARKET_API_BASE_URL || '').trim().replace(/\/+$/, '');
  if (window.location.protocol === 'file:' && !configuredApiBase) {
    setConnectionStatus('Open dashboard through local server', 'offline');
    setText('feedLabel', 'Local server required');
    setText('watchlistStatus', 'Feed unavailable');
    setText('feedMessage', 'This page was opened directly from disk. Start the server with npm start, then open http://localhost:3000/ so the dashboard can securely reach the market-data API.');
    populateWatchlist();
    renderTopGainers();
    renderChart([]);
    renderStrategies([], 'NSE');
    return;
  }

  try {
    const apiBase = configuredApiBase
      ? `${configuredApiBase}/api/market-data`
      : '/api/market-data';
    const apiUrl = new URL(apiBase, window.location.origin);
    if (chartSymbol) apiUrl.searchParams.set('symbol', chartSymbol);
    const response = await fetch(apiUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Market data service returned HTTP ${response.status}`);
    }
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('Market data API did not return JSON. Open the dashboard through the Node server.');
    }
    const data = await response.json();
    if (requestId !== marketDataRequestId) return;
    setMarketData(data);
  } catch (error) {
    if (requestId !== marketDataRequestId) return;
    setConnectionStatus('Provider unavailable', 'offline');
    setText('feedLabel', 'Unable to reach data service');
    setText('watchlistStatus', 'Feed unavailable');
    setText('feedMessage', error.message);
    setText('primaryQuotePrice', '—');
    setText('primaryQuoteChange', '—');
    setText('exchangeRate', '—');
    setText('marketState', 'UNKNOWN');
    setText('chartLastPrice', '—');
    populateWatchlist();
    renderTopGainers();
    renderChart([]);
    renderStrategies([], 'NSE');
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(loadMarketData, 60000);
  }
}

updateClock();
setInterval(updateClock, 1000);
loadMarketData();

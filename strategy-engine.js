(function exposeStrategyEngine(root, factory) {
  const engine = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = engine;
  } else {
    root.StrategyEngine = engine;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createStrategyEngine() {
  const PER_FILL_COST_RATE = 0.001;

  function getCloses(points) {
    return points
      .filter((point) => point && Number.isFinite(point.close) && point.close > 0)
      .map((point) => point.close);
  }

  function calculateEma(values, period) {
    if (values.length < period) return [];
    const result = Array(values.length).fill(null);
    const initialAverage = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    const multiplier = 2 / (period + 1);
    result[period - 1] = initialAverage;
    for (let index = period; index < values.length; index += 1) {
      result[index] = (values[index] - result[index - 1]) * multiplier + result[index - 1];
    }
    return result;
  }

  function calculateRsi(values, period) {
    if (values.length <= period) return [];
    const result = Array(values.length).fill(null);
    let averageGain = 0;
    let averageLoss = 0;

    for (let index = 1; index <= period; index += 1) {
      const change = values[index] - values[index - 1];
      averageGain += Math.max(change, 0);
      averageLoss += Math.max(-change, 0);
    }
    averageGain /= period;
    averageLoss /= period;

    const toRsi = (gain, loss) => {
      if (loss === 0) return gain === 0 ? 50 : 100;
      return 100 - 100 / (1 + gain / loss);
    };
    result[period] = toRsi(averageGain, averageLoss);

    for (let index = period + 1; index < values.length; index += 1) {
      const change = values[index] - values[index - 1];
      averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
      averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
      result[index] = toRsi(averageGain, averageLoss);
    }
    return result;
  }

  function simulateLongOnly({ closes, entries, exits, firstIndex, lastIndex = closes.length - 1 }) {
    let equity = 1;
    let peak = 1;
    let maximumDrawdown = 0;
    let position = null;
    const trades = [];
    const entryCostFactor = 1 - PER_FILL_COST_RATE;

    for (let index = firstIndex; index <= lastIndex; index += 1) {
      if (position && exits[index]) {
        const netEquity = position.initialEquity
          * entryCostFactor
          * (closes[index] / position.entryPrice)
          * entryCostFactor;
        trades.push({
          entryIndex: position.entryIndex,
          exitIndex: index,
          entryPrice: position.entryPrice,
          exitPrice: closes[index],
          returnPct: (netEquity / position.initialEquity - 1) * 100
        });
        equity = netEquity;
        position = null;
      }

      if (!position && entries[index]) {
        position = {
          entryIndex: index,
          entryPrice: closes[index],
          initialEquity: equity
        };
      }

      const markedEquity = position
        ? position.initialEquity * entryCostFactor * (closes[index] / position.entryPrice)
        : equity;
      peak = Math.max(peak, markedEquity);
      maximumDrawdown = Math.max(maximumDrawdown, peak > 0 ? (peak - markedEquity) / peak : 0);
    }

    if (position) {
      const finalIndex = lastIndex;
      const finalEquity = position.initialEquity
        * entryCostFactor
        * (closes[finalIndex] / position.entryPrice)
        * entryCostFactor;
      trades.push({
        entryIndex: position.entryIndex,
        exitIndex: finalIndex,
        entryPrice: position.entryPrice,
        exitPrice: closes[finalIndex],
        returnPct: (finalEquity / position.initialEquity - 1) * 100
      });
      equity = finalEquity;
      peak = Math.max(peak, equity);
      maximumDrawdown = Math.max(maximumDrawdown, peak > 0 ? (peak - equity) / peak : 0);
    }

    const winners = trades.filter((trade) => trade.returnPct > 0).length;
    return {
      netReturnPct: (equity - 1) * 100,
      maxDrawdownPct: maximumDrawdown * 100,
      tradeCount: trades.length,
      winRatePct: trades.length ? (winners / trades.length) * 100 : null,
      trades
    };
  }

  function backtestEma(points) {
    return backtestEmaParameters(points, 9, 21);
  }

  function backtestEmaParameters(
    points,
    fastPeriod,
    slowPeriod,
    firstSignalIndex = slowPeriod,
    lastSignalIndex
  ) {
    const closes = getCloses(points);
    if (!Number.isInteger(fastPeriod) || !Number.isInteger(slowPeriod) || fastPeriod < 2 || fastPeriod >= slowPeriod) {
      throw new Error('EMA periods must be integers with fast < slow.');
    }

    const fast = calculateEma(closes, fastPeriod);
    const slow = calculateEma(closes, slowPeriod);
    const entries = Array(closes.length).fill(false);
    const exits = Array(closes.length).fill(false);

    const firstIndex = Math.max(slowPeriod, firstSignalIndex);
    const lastIndex = Math.min(closes.length - 1, Number.isInteger(lastSignalIndex) ? lastSignalIndex : closes.length - 1);
    for (let index = firstIndex; index < lastIndex; index += 1) {
      if (fast[index - 1] === null || slow[index - 1] === null) continue;
      if (index + 1 >= closes.length) continue;
      entries[index + 1] = fast[index - 1] <= slow[index - 1] && fast[index] > slow[index];
      exits[index + 1] = fast[index - 1] >= slow[index - 1] && fast[index] < slow[index];
    }

    return {
      ...simulateLongOnly({ closes, entries, exits, firstIndex, lastIndex }),
      bars: closes.length
    };
  }

  function benchmarkBuyAndHold(closes, startIndex, endIndex) {
    if (endIndex <= startIndex || closes[startIndex] <= 0) {
      return { netReturnPct: null, maxDrawdownPct: null };
    }

    let peak = 1;
    let maxDrawdown = 0;
    for (let index = startIndex; index <= endIndex; index += 1) {
      const markedValue = closes[index] / closes[startIndex];
      peak = Math.max(peak, markedValue);
      maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - markedValue) / peak : 0);
    }
    const netValue = (1 - PER_FILL_COST_RATE)
      * (closes[endIndex] / closes[startIndex])
      * (1 - PER_FILL_COST_RATE);
    return {
      netReturnPct: (netValue - 1) * 100,
      maxDrawdownPct: maxDrawdown * 100
    };
  }

  function trainAdaptiveAgent(points, options = {}) {
    const validPoints = points
      .filter((point) => point && Number.isFinite(point.close) && point.close > 0)
      .sort((left, right) => {
        const leftTime = Date.parse(left.time);
        const rightTime = Date.parse(right.time);
        return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
      });
    const closes = getCloses(validPoints);
    const minBars = options.minBars || 240;
    const minValidationTrades = options.minValidationTrades || 3;
    const minTrainingTrades = options.minTrainingTrades || 3;
    const testStart = Math.floor(closes.length * 0.8);
    const tuningBars = testStart;
    const validationBars = closes.length - testStart;
    const firstFoldStart = Math.max(80, Math.floor(tuningBars * 0.5));
    const foldSize = Math.floor((tuningBars - firstFoldStart) / 3);
    const folds = foldSize >= 10
      ? [
        { start: firstFoldStart, end: firstFoldStart + foldSize - 1 },
        { start: firstFoldStart + foldSize, end: firstFoldStart + 2 * foldSize - 1 },
        { start: firstFoldStart + 2 * foldSize, end: testStart - 1 }
      ].filter((fold) => fold.end > fold.start)
      : [];
    const base = {
      status: 'collecting',
      bars: closes.length,
      requiredBars: minBars,
      trainingBars: tuningBars,
      validationBars,
      validationTradesRequired: minValidationTrades,
      walkForwardFolds: folds.length,
      selected: null,
      training: null,
      validation: null,
      current: null,
      action: 'COLLECTING HISTORY'
    };

    if (closes.length < minBars || validationBars < minValidationTrades || folds.length < 3) {
      return {
        ...base,
        message: `Collecting history: ${Math.max(0, minBars - closes.length)} more valid 5-minute bars needed for three walk-forward windows and a final holdout.`
      };
    }

    const candidates = [];
    for (const fastPeriod of [5, 8, 10, 12]) {
      for (const slowPeriod of [20, 26, 34, 40]) {
        if (fastPeriod >= slowPeriod) continue;
        const foldResults = folds.map((fold) => backtestEmaParameters(
          validPoints,
          fastPeriod,
          slowPeriod,
          fold.start,
          fold.end
        ));
        const trainingTrades = foldResults.reduce((total, result) => total + result.tradeCount, 0);
        const activeFolds = foldResults.filter((result) => result.tradeCount > 0).length;
        if (trainingTrades < minTrainingTrades || activeFolds < 2) continue;
        const averageFoldReturn = foldResults.reduce((total, result) => total + result.netReturnPct, 0)
          / foldResults.length;
        const averageFoldDrawdown = foldResults.reduce((total, result) => total + result.maxDrawdownPct, 0)
          / foldResults.length;
        candidates.push({
          fastPeriod,
          slowPeriod,
          foldResults,
          trainingTrades,
          activeFolds,
          score: averageFoldReturn - averageFoldDrawdown * 0.5
        });
      }
    }

    if (candidates.length === 0) {
      return {
        ...base,
        status: 'insufficient-trades',
        action: 'WAIT · INSUFFICIENT TRAINING TRADES',
        message: 'No EMA candidate produced at least three walk-forward trades across two or more windows; parameters were not changed.'
      };
    }

    candidates.sort((left, right) => right.score - left.score
      || left.activeFolds - right.activeFolds
      || left.trainingTrades - right.trainingTrades
      || left.fastPeriod - right.fastPeriod);
    const selected = candidates[0];
    const validation = backtestEmaParameters(
      validPoints,
      selected.fastPeriod,
      selected.slowPeriod,
      testStart,
      closes.length - 1
    );
    const baseline = benchmarkBuyAndHold(closes, testStart, closes.length - 1);
    const fast = calculateEma(closes, selected.fastPeriod);
    const slow = calculateEma(closes, selected.slowPeriod);
    const rsi = calculateRsi(closes, 14);
    const lastIndex = closes.length - 1;
    const validationAcceptable = validation.tradeCount >= minValidationTrades
      && validation.netReturnPct > 0
      && validation.netReturnPct > baseline.netReturnPct
      && validation.maxDrawdownPct <= 15;
    const trendAligned = fast[lastIndex] > slow[lastIndex]
      && closes[lastIndex] > slow[lastIndex]
      && rsi[lastIndex] >= 50
      && rsi[lastIndex] < 70;

    let action = 'WAIT · NO ALIGNED SETUP';
    if (validation.tradeCount < minValidationTrades) {
      action = 'WAIT · TOO FEW HOLDOUT TRADES';
    } else if (!validationAcceptable) {
      action = 'PAUSE · HOLDOUT RISK / BASELINE FILTER';
    } else if (trendAligned) {
      action = 'PAPER BUY SETUP · NOT AN ORDER';
    }

    return {
      status: 'trained',
      bars: closes.length,
      requiredBars: minBars,
      trainingBars: tuningBars,
      validationBars,
      validationTradesRequired: minValidationTrades,
      walkForwardFolds: folds.length,
      selected: {
        fastPeriod: selected.fastPeriod,
        slowPeriod: selected.slowPeriod,
        trainingTrades: selected.trainingTrades,
        activeFolds: selected.activeFolds,
        trainingScore: selected.score
      },
      training: {
        foldResults: selected.foldResults.map((result) => ({
          netReturnPct: result.netReturnPct,
          maxDrawdownPct: result.maxDrawdownPct,
          tradeCount: result.tradeCount
        })),
        score: selected.score,
        tradeCount: selected.trainingTrades,
        activeFolds: selected.activeFolds
      },
      validation: {
        netReturnPct: validation.netReturnPct,
        maxDrawdownPct: validation.maxDrawdownPct,
        tradeCount: validation.tradeCount,
        buyAndHoldReturnPct: baseline.netReturnPct,
        beatBuyAndHold: validation.netReturnPct > baseline.netReturnPct
      },
      current: {
        fastEma: fast[lastIndex],
        slowEma: slow[lastIndex],
        rsi: rsi[lastIndex],
        lastClose: closes[lastIndex]
      },
      action,
      message: `Selected EMA ${selected.fastPeriod}/${selected.slowPeriod} across ${selected.activeFolds} of 3 walk-forward windows; checked against a buy-and-hold baseline on the final untouched holdout.`
    };
  }

  function backtestRsi(points) {
    const closes = getCloses(points);
    const rsi = calculateRsi(closes, 14);
    const entries = Array(closes.length).fill(false);
    const exits = Array(closes.length).fill(false);

    for (let index = 15; index < closes.length; index += 1) {
      if (rsi[index - 1] === null || rsi[index] === null) continue;
      if (index + 1 >= closes.length) continue;
      entries[index + 1] = rsi[index] < 30 && rsi[index - 1] >= 30;
      exits[index + 1] = rsi[index] > 55 && rsi[index - 1] <= 55;
    }

    return {
      ...simulateLongOnly({ closes, entries, exits, firstIndex: 15 }),
      bars: closes.length
    };
  }

  function evaluateScenario(points) {
    const closes = getCloses(points);
    if (closes.length < 21) return null;

    const fast = calculateEma(closes, 9);
    const slow = calculateEma(closes, 21);
    const rsi = calculateRsi(closes, 14);
    const index = closes.length - 1;
    const lastClose = closes[index];
    const emaFast = fast[index];
    const emaSlow = slow[index];
    const lastRsi = rsi[index];

    let bias = 'Mixed / wait';
    let condition = 'Momentum indicators are mixed. Wait for a completed close and clearer alignment instead of forcing a directional setup.';
    let invalidation = `A directional read would weaken if price closes across EMA 21 (${emaSlow.toFixed(2)}).`;

    if (lastClose > emaSlow && emaFast > emaSlow && lastRsi >= 50 && lastRsi < 70) {
      bias = 'Bullish momentum conditions';
      condition = 'Price is above EMA 21, EMA 9 is above EMA 21, and RSI is between 50 and 70. This alignment describes momentum only; it is not a forecast of gains.';
      invalidation = `The bullish condition weakens if a completed close falls below EMA 21 (${emaSlow.toFixed(2)}) or RSI drops below 50.`;
    } else if (lastClose < emaSlow && emaFast < emaSlow && lastRsi > 30 && lastRsi <= 50) {
      bias = 'Bearish momentum conditions';
      condition = 'Price is below EMA 21, EMA 9 is below EMA 21, and RSI is between 30 and 50. This describes downside momentum risk, not a short recommendation.';
      invalidation = `The bearish condition weakens if a completed close rises above EMA 21 (${emaSlow.toFixed(2)}) or RSI moves above 50.`;
    }

    return {
      bias,
      condition,
      invalidation,
      emaFast,
      emaSlow,
      rsi: lastRsi,
      lastClose,
      bars: closes.length
    };
  }

  return {
    backtestEma,
    backtestEmaParameters,
    backtestRsi,
    calculateEma,
    calculateRsi,
    evaluateScenario,
    trainAdaptiveAgent,
    PER_FILL_COST_RATE
  };
}));

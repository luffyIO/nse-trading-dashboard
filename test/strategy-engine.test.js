const test = require('node:test');
const assert = require('node:assert/strict');
const {
  backtestEma,
  backtestRsi,
  calculateEma,
  calculateRsi,
  evaluateScenario,
  PER_FILL_COST_RATE,
  trainAdaptiveAgent
} = require('../strategy-engine');

function pointsFromCloses(closes) {
  return closes.map((close, index) => ({
    time: new Date(Date.UTC(2026, 0, 1, 0, index * 5)).toISOString(),
    close
  }));
}

test('calculates EMA and RSI with stable warm-up behavior', () => {
  assert.deepEqual(calculateEma([1, 2, 3, 4], 3), [null, null, 2, 3]);
  assert.deepEqual(calculateRsi([10, 11, 12, 13], 3), [null, null, null, 100]);
  assert.deepEqual(calculateEma([1, 2], 3), []);
});

test('EMA backtest enters on the close after a confirmed crossover and applies costs', () => {
  const closes = [
    ...Array.from({ length: 32 }, (_, index) => 200 - index * 2),
    ...Array.from({ length: 40 }, (_, index) => 138 + index * 2),
    ...Array.from({ length: 34 }, (_, index) => 216 - index * 2.3),
    ...Array.from({ length: 38 }, (_, index) => 137 + index * 2.4)
  ];
  const emaFast = calculateEma(closes, 9);
  const emaSlow = calculateEma(closes, 21);
  let firstUpCross = -1;
  for (let index = 21; index < closes.length; index += 1) {
    if (emaFast[index - 1] <= emaSlow[index - 1] && emaFast[index] > emaSlow[index]) {
      firstUpCross = index;
      break;
    }
  }

  const result = backtestEma(pointsFromCloses(closes));
  assert.equal(firstUpCross >= 0, true);
  assert.equal(result.bars, closes.length);
  assert.equal(result.tradeCount > 0, true);
  assert.equal(result.trades[0].entryIndex, firstUpCross + 1);
  assert.equal(Number.isFinite(result.netReturnPct), true);
  assert.equal(Number.isFinite(result.maxDrawdownPct), true);
  assert.equal(PER_FILL_COST_RATE, 0.001);
});

test('RSI backtest and conditional scenario return valid, bounded indicators', () => {
  const closes = Array.from({ length: 90 }, (_, index) => {
    const trend = index < 38 ? -1.1 : 0.7;
    return 100 + (index * trend) + Math.sin(index / 2) * 2;
  });
  const points = pointsFromCloses(closes);
  const result = backtestRsi(points);
  const scenario = evaluateScenario(points);

  assert.equal(result.bars, closes.length);
  assert.equal(Number.isFinite(result.netReturnPct), true);
  assert.equal(Number.isFinite(result.maxDrawdownPct), true);
  assert.equal(scenario.lastClose, closes.at(-1));
  assert.equal(scenario.rsi >= 0 && scenario.rsi <= 100, true);
  assert.equal(evaluateScenario(pointsFromCloses(closes.slice(0, 20))), null);
});

test('adaptive agent refuses to train on a short history', () => {
  const result = trainAdaptiveAgent(pointsFromCloses(Array.from({ length: 239 }, (_, index) => 100 + index)));
  assert.equal(result.status, 'collecting');
  assert.equal(result.selected, null);
  assert.match(result.message, /1 more valid/);
  assert.equal(result.action, 'COLLECTING HISTORY');
});

test('adaptive agent selects across walk-forward windows and rejects an undersampled holdout', () => {
  const closes = Array.from({ length: 600 }, (_, index) => (
    100 + Math.sin(index / 8) * 3 + Math.sin(index / 2) * 0.5
  ));
  const points = pointsFromCloses(closes);
  points[8] = { ...points[8], close: null };
  const result = trainAdaptiveAgent(points);

  assert.equal(result.status, 'trained');
  assert.equal(result.selected.fastPeriod < result.selected.slowPeriod, true);
  assert.equal(result.walkForwardFolds, 3);
  assert.equal(result.selected.activeFolds, 3);
  assert.equal(result.training.foldResults.length, 3);
  assert.equal(result.trainingBars + result.validationBars, result.bars);
  assert.equal(result.validation.tradeCount < result.validationTradesRequired, true);
  assert.equal(result.validation.tradeCount > 0, true);
  assert.equal(Number.isFinite(result.validation.buyAndHoldReturnPct), true);
  assert.equal(Number.isFinite(result.validation.netReturnPct), true);
  assert.equal(result.action, 'WAIT · TOO FEW HOLDOUT TRADES');
});

test('adaptive agent pauses when final holdout underperforms the buy-and-hold baseline', () => {
  const closes = Array.from({ length: 600 }, (_, index) => (
    100 + Math.sin(index / 6) * 1.5 + Math.sin(index / 3) * 0.3
  ));
  const result = trainAdaptiveAgent(pointsFromCloses(closes));

  assert.equal(result.status, 'trained');
  assert.equal(result.validation.tradeCount >= result.validationTradesRequired, true);
  assert.equal(result.validation.beatBuyAndHold, false);
  assert.equal(result.action, 'PAUSE · HOLDOUT RISK / BASELINE FILTER');
});

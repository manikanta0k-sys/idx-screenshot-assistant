(function (root) {
  'use strict';

  function pixelColor(red, green, blue) {
    if (green > 85 && green > red * 1.25 && green > blue * 1.04 && green - Math.min(red, blue) > 45) return 1;
    if (red > 120 && red > green * 1.25 && red > blue * 1.05 && red - Math.min(green, blue) > 45) return 2;
    return 0;
  }

  function detectCandles(image, crop) {
    const { width, height, data } = image;
    const left = Math.max(0, Math.floor(crop.left * width));
    const right = Math.min(width, Math.ceil(crop.right * width));
    const top = Math.max(0, Math.floor(crop.top * height));
    const bottom = Math.min(height, Math.ceil(crop.bottom * height));
    const candidates = [];

    for (const color of [1, 2]) {
      const columns = new Uint32Array(width);
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          const index = (y * width + x) * 4;
          if (pixelColor(data[index], data[index + 1], data[index + 2]) === color) columns[x]++;
        }
      }
      let start = -1;
      function finish(end) {
        if (start < 0) return;
        const groupWidth = end - start + 1;
        const maxWidth = Math.max(15, (right - left) * 0.065);
        if (groupWidth < 2 || groupWidth > maxWidth) return;
        const rows = [];
        let maxRow = 0;
        let pixels = 0;
        for (let y = top; y < bottom; y++) {
          let count = 0;
          for (let x = start; x <= end; x++) {
            const index = (y * width + x) * 4;
            if (pixelColor(data[index], data[index + 1], data[index + 2]) === color) count++;
          }
          rows.push(count);
          maxRow = Math.max(maxRow, count);
          pixels += count;
        }
        if (maxRow < 2 || pixels < groupWidth * 3) return;
        const bodyThreshold = Math.max(2, Math.ceil(maxRow * 0.55));
        const wickRows = [];
        const bodyRows = [];
        rows.forEach((count, index) => {
          if (count > 0) wickRows.push(index + top);
          if (count >= bodyThreshold) bodyRows.push(index + top);
        });
        if (!bodyRows.length || wickRows[wickRows.length - 1] - wickRows[0] < 4) return;
        const bodyTop = bodyRows[0];
        const bodyBottom = bodyRows[bodyRows.length - 1];
        candidates.push({
          x: (start + end) / 2, left: start, right: end,
          high: wickRows[0], low: wickRows[wickRows.length - 1],
          bodyTop, bodyBottom, open: color === 1 ? bodyBottom : bodyTop,
          close: color === 1 ? bodyTop : bodyBottom,
          color: color === 1 ? 'green' : 'red', pixels
        });
      }
      for (let x = left; x <= right; x++) {
        if (x < right && columns[x] >= 3) {
          if (start < 0) start = x;
        } else if (start >= 0) {
          finish(x - 1);
          start = -1;
        }
      }
    }
    candidates.sort((a, b) => a.x - b.x);
    const candles = [];
    for (const candle of candidates) {
      const previous = candles[candles.length - 1];
      if (previous && candle.left <= previous.right) {
        if (candle.pixels > previous.pixels) candles[candles.length - 1] = candle;
      } else candles.push(candle);
    }
    return candles.slice(-100);
  }

  function analyzeCandles(candles, excludeLast) {
    const closed = excludeLast ? candles.slice(0, -1) : candles.slice();
    const result = { direction: 'WAIT', candles, closed, observations: [], sufficient: closed.length >= 6 };
    if (!result.sufficient) {
      result.reason = 'At least 6 clearly detected closed candles are required. Adjust the chart area and review again.';
      result.observations.push('Too few candles or an unsuitable chart crop prevents a direction review.');
      return result;
    }
    const recent = closed.slice(-5);
    const averageRange = recent.reduce((sum, candle) => sum + candle.low - candle.high, 0) / recent.length;
    const change = recent[0].close - recent[recent.length - 1].close;
    const greens = recent.filter(candle => candle.color === 'green').length;
    const reds = recent.length - greens;
    if (change > averageRange * 0.65 && greens >= 3) result.direction = 'UP';
    if (change < -averageRange * 0.65 && reds >= 3) result.direction = 'DOWN';
    const reasons = {
      UP: 'The last 5 closed candles show upward movement. This describes momentum visible in the screenshot.',
      DOWN: 'The last 5 closed candles show downward movement. This describes momentum visible in the screenshot.',
      WAIT: 'Recent closed candles show mixed movement or a small overall change.'
    };
    result.reason = reasons[result.direction];
    result.observations.push(`The last 5 closed candles contain ${greens} green and ${reds} red candles.`);
    const last = closed[closed.length - 1];
    const body = Math.max(3, last.bodyBottom - last.bodyTop);
    const lowerWick = last.low - last.bodyBottom;
    const upperWick = last.bodyTop - last.high;
    if (lowerWick > body * 2 && lowerWick > upperWick * 1.5) {
      result.observations.push('The last closed candle has a long lower wick, showing a partial recovery from its low.');
    } else if (upperWick > body * 2 && upperWick > lowerWick * 1.5) {
      result.observations.push('The last closed candle has a long upper wick, showing a pullback from its high.');
    } else {
      result.observations.push('The last closed candle has no prominent wick on either side.');
    }
    const previous = closed.slice(-9, -1);
    const oldLow = Math.max(...previous.map(candle => candle.low));
    const oldHigh = Math.min(...previous.map(candle => candle.high));
    if (last.close > oldLow) result.observations.push('The last close is below the preceding candle lows.');
    else if (last.close < oldHigh) result.observations.push('The last close is above the preceding candle highs.');
    else result.observations.push('The last close is within the preceding high–low range.');
    if (excludeLast) result.observations.push('The rightmost candle is treated as still forming and excluded from the analysis.');
    return result;
  }

  function secondsAt(time) {
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return null;
    const parts = time.split(':').map(Number);
    if (parts[0] > 23 || parts[1] > 59 || (parts[2] || 0) > 59) return null;
    return parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0);
  }

  function expiryGap(capture, expiry) {
    const start = secondsAt(capture);
    const end = secondsAt(expiry);
    if (start === null || end === null) return null;
    let difference = end - start;
    if (start >= 23 * 3600 && end < 3600) difference += 24 * 3600;
    return difference;
  }

  const api = { pixelColor, detectCandles, analyzeCandles, expiryGap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IdxAnalysis = api;
})(typeof window !== 'undefined' ? window : globalThis);

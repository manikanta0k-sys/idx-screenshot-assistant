/* Browser-only screenshot analysis. Images remain in memory until cleared. */
(function () {
  'use strict';
  const element = id => document.getElementById(id);
  const state = { image: null, file: null, candles: [], analysis: null, demo: false, crop: null, loadVersion: 0 };
  const preview = element('preview');
  const previewContext = preview.getContext('2d');
  const source = document.createElement('canvas');
  const sourceContext = source.getContext('2d', { willReadFrequently: true });

  function notice(message) {
    element('notice').textContent = message;
    element('notice').hidden = !message;
  }

  function setCropDefaults() {
    const portrait = source.height > source.width * 1.35;
    const values = portrait ? { top: 21, bottom: 61, left: 0, right: 66 } : { top: 8, bottom: 85, left: 3, right: 92 };
    for (const [key, value] of Object.entries(values)) element('crop-' + key).value = value;
    updateCrop();
  }

  function updateCrop(changed) {
    const values = {};
    for (const key of ['top', 'bottom', 'left', 'right']) values[key] = Number(element('crop-' + key).value);
    if (values.top >= values.bottom - 5) {
      if (changed === 'bottom') values.top = values.bottom - 5;
      else values.bottom = values.top + 5;
    }
    if (values.left >= values.right - 5) {
      if (changed === 'right') values.left = values.right - 5;
      else values.right = values.left + 5;
    }
    for (const [key, value] of Object.entries(values)) {
      element('crop-' + key).value = value;
      element(key + '-value').textContent = value + '%';
    }
    state.crop = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value / 100]));
    if (state.image) analyze();
  }

  async function loadFile(file) {
    if (!file) return;
    const version = ++state.loadVersion;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notice('Choose a PNG, JPG, or WEBP screenshot. Convert HEIC photos to PNG or JPG first.');
      element('file-input').value = '';
      return;
    }
    if (file.size > 16 * 1024 * 1024) {
      notice('This image exceeds 16 MB. Choose a smaller screenshot.');
      element('file-input').value = '';
      return;
    }
    notice('');
    element('analysis-state').textContent = 'Reading image…';
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = objectUrl;
      });
      if (version !== state.loadVersion) return;
      if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 50000000) throw new Error('Image dimensions');
      const scale = Math.min(1, 1400 / image.naturalWidth, 2400 / image.naturalHeight);
      source.width = Math.round(image.naturalWidth * scale);
      source.height = Math.round(image.naturalHeight * scale);
      sourceContext.drawImage(image, 0, 0, source.width, source.height);
      state.image = true;
      state.file = file;
      state.demo = false;
      resetImageFields();
      element('file-name').textContent = file.name;
      element('image-area').hidden = false;
      element('dropzone').hidden = true;
      setCropDefaults();
    } catch (error) {
      if (version !== state.loadVersion) return;
      notice('Unable to read this image. Choose another PNG or JPG screenshot.');
      element('analysis-state').textContent = state.analysis ? 'Previous image result' : 'Ready for upload';
    } finally {
      URL.revokeObjectURL(objectUrl);
      element('file-input').value = '';
    }
  }

  function resetImageFields() {
    element('capture-time').value = '';
    element('expiry-time').value = '';
    element('exclude-last').checked = true;
    element('share-status').textContent = '';
    element('open-chatgpt').hidden = true;
    element('guide-messages').replaceChildren();
    appendMessage('Ask about this image’s direction, candles, expiry, or payout.', 'guide');
    updateTiming();
  }

  function analyze() {
    if (!state.image) return;
    const pixels = sourceContext.getImageData(0, 0, source.width, source.height);
    state.candles = IdxAnalysis.detectCandles(pixels, state.crop);
    state.analysis = IdxAnalysis.analyzeCandles(state.candles, element('exclude-last').checked);
    renderPreview();
    renderAnalysis();
  }

  function renderPreview() {
    preview.width = source.width;
    preview.height = source.height;
    previewContext.drawImage(source, 0, 0);
    const { left, right, top, bottom } = state.crop;
    const x = left * source.width;
    const y = top * source.height;
    const width = (right - left) * source.width;
    const height = (bottom - top) * source.height;
    previewContext.fillStyle = 'rgba(3,8,15,.68)';
    previewContext.fillRect(0, 0, source.width, y);
    previewContext.fillRect(0, y + height, source.width, source.height - y - height);
    previewContext.fillRect(0, y, x, height);
    previewContext.fillRect(x + width, y, source.width - x - width, height);
    previewContext.strokeStyle = '#84adff';
    previewContext.lineWidth = Math.max(2, source.width / 350);
    previewContext.strokeRect(x, y, width, height);
    previewContext.lineWidth = Math.max(1, source.width / 650);
    state.candles.forEach(candle => {
      previewContext.strokeStyle = candle.color === 'green' ? '#7df6c4' : '#ffb1bb';
      previewContext.strokeRect(candle.left - 2, candle.high - 2, candle.right - candle.left + 4, candle.low - candle.high + 4);
    });
  }

  function renderAnalysis() {
    const result = state.analysis;
    element('result-empty').hidden = true;
    element('result-content').hidden = false;
    element('demo-label').hidden = !state.demo;
    element('analysis-state').textContent = 'Image analysis complete';
    const direction = element('direction');
    direction.className = 'trend ' + result.direction.toLowerCase();
    direction.replaceChildren(document.createTextNode(result.direction + ' '));
    const arrow = document.createElement('span');
    arrow.textContent = { UP: '↗', DOWN: '↘', WAIT: '→' }[result.direction];
    direction.append(arrow);
    element('result-reason').textContent = result.reason;
    element('candle-count').textContent = result.candles.length;
    element('closed-count').textContent = result.closed.length;
    element('detection-label').textContent = result.sufficient ? 'Review' : 'Low';
    element('observations').replaceChildren();
    for (const observation of result.observations) {
      const item = document.createElement('li');
      item.textContent = observation;
      element('observations').append(item);
    }
    element('candle-strip').replaceChildren();
    result.candles.slice(-30).forEach((candle, index, visible) => {
      const bar = document.createElement('span');
      const excluded = element('exclude-last').checked && index === visible.length - 1;
      bar.className = 'mini-candle ' + candle.color + (excluded ? ' excluded' : '');
      bar.style.height = Math.max(7, Math.min(31, (candle.bodyBottom - candle.bodyTop) / source.height * 230)) + 'px';
      bar.title = (candle.color === 'green' ? 'Green' : 'Red') + (excluded ? ' · excluded' : '');
      element('candle-strip').append(bar);
    });
    element('share-report').disabled = false;
    element('download-report').disabled = false;
    if (!result.sufficient) notice('Too few candles detected. Open “Adjust chart area” and select the candle region.');
    else notice('');
  }

  function updateTiming() {
    const gap = IdxAnalysis.expiryGap(element('capture-time').value, element('expiry-time').value);
    let text = 'Enter the screenshot’s chart time and selected expiry to calculate the time remaining at capture.';
    if (gap !== null) {
      if (gap <= 0) text = 'The expiry has passed at the entered screenshot time, or a time entry needs correction.';
      else if (gap > 3600) text = 'Expiry is more than one hour away. Check that both times use the same chart clock.';
      else text = `At screenshot capture, ${gap} seconds (${Math.floor(gap / 60)}m ${gap % 60}s) remained until expiry. This calculation refers to the capture time.`;
    }
    element('timing-result').textContent = text;
    const payout = Number(element('payout').value);
    const valid = Number.isFinite(payout) && payout > 0 && payout <= 100;
    element('win-profit').textContent = valid ? '+₹' + payout.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—';
    element('breakeven').textContent = valid
      ? `Break-even win rate is ${(100 / (1 + payout / 100)).toFixed(2)}% with equal stakes, excluding ties and fees.`
      : 'Enter a payout between 1 and 100.';
  }

  function appendMessage(message, role) {
    const container = document.createElement('div');
    container.className = role === 'user' ? 'user-message' : 'guide-message';
    const label = document.createElement('span');
    label.className = 'message-label';
    label.textContent = role === 'user' ? 'YOU' : 'GUIDE · LOCAL RULES';
    const paragraph = document.createElement('p');
    paragraph.textContent = message;
    container.append(label, paragraph);
    const messages = element('guide-messages');
    messages.append(container);
    while (messages.children.length > 16) messages.firstElementChild.remove();
    messages.scrollTop = messages.scrollHeight;
  }

  function guideReply(question) {
    const text = question.toLowerCase();
    if (/expiry|ఎక్స్‌పైరీ|ఎంత|time|సమయం/.test(text)) return element('timing-result').textContent;
    if (/payout|లెక్క|profit|earn|money|డబ్బు|లాభం/.test(text)) {
      const payout = Number(element('payout').value);
      if (!(payout > 0 && payout <= 100)) return 'Enter a valid payout first.';
      return `At ${payout}% payout, a winning ₹100 demo stake earns ₹${payout} profit, returning ₹${100 + payout} including the stake. A loss costs ₹100. ${element('breakeven').textContent}`;
    }
    if (!state.analysis) return 'Upload a screenshot or select “Try demo” first. The guide will explain the results for that image.';
    const result = state.analysis;
    if (/next|predict|forecast|correct|sure|100|శాతం|కచ్చిత|గెలు|accuracy|confidence|win/.test(text)) {
      return `The next candle’s direction is unknown. The ${result.direction} recent trend describes the last 5 analyzed candles in this screenshot. Next-candle forecast accuracy remains unverified. A reliable win percentage requires recorded signals, entry and expiry prices, and many demo outcomes.`;
    }
    if (/candle|కొవ్వొత్తి|చదివా|detect|crop/.test(text)) {
      return `Red and green pixel columns in the selected chart area identify possible candles. ${result.candles.length} candles were detected and ${result.closed.length} used. Check that the preview boxes match the actual candles. Adjusting the chart area recalculates the result. Price values, RSI, and MACD require separate data.`;
    }
    if (/why|result|ఫలితం|ఎందుకు|wait|up|down|direction|వివర|చెప్పు/.test(text)) {
      return `${result.direction} · ${result.reason}\n${result.observations.join('\n')}`;
    }
    return `This local guide handles candles, direction, timing, and payout questions. For a broader review, select “Share / Copy analysis” and attach your screenshot in ChatGPT.`;
  }

  function askGuide(question) {
    const clean = question.trim();
    if (!clean) return;
    appendMessage(clean, 'user');
    appendMessage(guideReply(clean), 'guide');
    element('guide-question').value = '';
  }

  function reportText() {
    const result = state.analysis;
    if (!result) return '';
    const question = element('guide-question').value.trim();
    return [
      'Crypto IDX screenshot review · IDX Lens v1.2',
      state.demo ? 'SOURCE: Synthetic demo image' : 'SOURCE: User screenshot · Binomo Crypto IDX label selected by user; platform and asset not verified automatically',
      'Created at: ' + new Date().toISOString() + ' (report generation time, not screenshot capture time)',
      'Image: ' + (state.file ? state.file.name : 'Synthetic demo'),
      'Timeframe (manual): ' + element('timeframe').value,
      'Chart time (manual): ' + (element('capture-time').value || 'Unknown'),
      'Expiry (manual): ' + (element('expiry-time').value || 'Unknown'),
      'Payout (manual): ' + element('payout').value + '%',
      'Detected candles: ' + result.candles.length + ' · used: ' + result.closed.length,
      'Next-candle forecast: UNKNOWN (unverified)',
      'Recent trend from the last 5 analyzed candles: ' + result.direction,
      'Rule-based result: ' + result.reason,
      ...result.observations,
      element('timing-result').textContent,
      'Capture age unknown. Detection not independently verified. Next-candle prediction and win rate unverified.',
      'Please review the attached screenshot in English. Explain supporting and conflicting evidence without inventing a win percentage.',
      question ? 'My question: ' + question : 'I need help reviewing this setup for demo practice.'
    ].join('\n');
  }

  async function shareReport() {
    if (!state.analysis) return;
    const text = reportText();
    const shareData = { title: 'Crypto IDX screenshot review', text };
    if (state.file && navigator.canShare && navigator.canShare({ files: [state.file] })) shareData.files = [state.file];
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        element('share-status').textContent = 'Sharing complete. Use “Share / Copy analysis” again to share with another destination.';
        element('open-chatgpt').hidden = false;
        return;
      } catch (error) {
        if (error.name === 'AbortError') return;
      }
    }
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.top = '0';
        area.style.left = '0';
        document.body.append(area);
        area.select();
        if (!document.execCommand('copy')) throw new Error('Copy failed');
        area.remove();
      }
      element('share-status').textContent = 'Analysis copied. Open ChatGPT, paste it, and attach your screenshot.';
    } catch (error) {
      element('share-status').textContent = 'Automatic copy is unavailable. Download the report and attach it in ChatGPT.';
    }
    element('open-chatgpt').hidden = false;
  }

  function downloadReport() {
    const url = URL.createObjectURL(new Blob([reportText()], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'Crypto_IDX_Screenshot_Review.txt';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function tryDemo() {
    ++state.loadVersion;
    source.width = 900;
    source.height = 560;
    sourceContext.fillStyle = '#101822';
    sourceContext.fillRect(0, 0, 900, 560);
    sourceContext.strokeStyle = '#253042';
    sourceContext.lineWidth = 1;
    for (let x = 40; x < 900; x += 100) {
      sourceContext.beginPath(); sourceContext.moveTo(x, 25); sourceContext.lineTo(x, 500); sourceContext.stroke();
    }
    for (let y = 60; y < 500; y += 80) {
      sourceContext.beginPath(); sourceContext.moveTo(30, y); sourceContext.lineTo(860, y); sourceContext.stroke();
    }
    const points = [340, 310, 325, 270, 235, 260, 230, 190, 215, 250, 240, 280, 300, 275, 315, 335, 360, 385, 410, 395];
    let previous = 365;
    points.forEach((close, index) => {
      const x = 60 + index * 38;
      sourceContext.fillStyle = close < previous ? '#13ce91' : '#ff596d';
      sourceContext.fillRect(x - 1, Math.min(previous, close) - 15, 2, Math.abs(previous - close) + 35);
      sourceContext.fillRect(x - 9, Math.min(previous, close), 18, Math.max(4, Math.abs(previous - close)));
      previous = close;
    });
    state.image = true;
    state.demo = true;
    state.file = null;
    resetImageFields();
    element('file-name').textContent = 'Synthetic demo · Fictional candles';
    element('image-area').hidden = false;
    element('dropzone').hidden = true;
    setCropDefaults();
  }

  function clearImage() {
    ++state.loadVersion;
    state.image = null;
    state.file = null;
    state.analysis = null;
    state.candles = [];
    state.demo = false;
    source.width = 1;
    source.height = 1;
    preview.width = 1;
    preview.height = 1;
    element('file-input').value = '';
    element('image-area').hidden = true;
    element('dropzone').hidden = false;
    element('result-content').hidden = true;
    element('result-empty').hidden = false;
    element('share-report').disabled = true;
    element('download-report').disabled = true;
    element('analysis-state').textContent = 'Ready for upload';
    element('guide-messages').replaceChildren();
    appendMessage('Choose a new screenshot to review.', 'guide');
    resetImageFields();
    notice('');
  }

  element('file-input').addEventListener('change', event => loadFile(event.target.files[0]));
  element('dropzone').addEventListener('dragover', event => { event.preventDefault(); element('dropzone').classList.add('dragging'); });
  element('dropzone').addEventListener('dragleave', () => element('dropzone').classList.remove('dragging'));
  element('dropzone').addEventListener('drop', event => {
    event.preventDefault();
    element('dropzone').classList.remove('dragging');
    loadFile(event.dataTransfer.files[0]);
  });
  for (const key of ['top', 'bottom', 'left', 'right']) element('crop-' + key).addEventListener('input', () => updateCrop(key));
  for (const id of ['capture-time', 'expiry-time', 'payout', 'timeframe']) element(id).addEventListener('input', updateTiming);
  element('exclude-last').addEventListener('change', analyze);
  element('reset-crop').addEventListener('click', setCropDefaults);
  element('try-demo').addEventListener('click', tryDemo);
  element('remove-image').addEventListener('click', clearImage);
  element('guide-form').addEventListener('submit', event => { event.preventDefault(); askGuide(element('guide-question').value); });
  document.querySelectorAll('[data-question]').forEach(button => button.addEventListener('click', () => askGuide(button.dataset.question)));
  element('share-report').addEventListener('click', shareReport);
  element('download-report').addEventListener('click', downloadReport);
  updateTiming();
})();

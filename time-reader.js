(function (root) {
  'use strict';

  let enginePromise;
  let workerPromise;
  let queue = Promise.resolve();

  function formattedTime(hours, minutes, seconds, period) {
    let hour = Number(hours);
    const minute = Number(minutes);
    const second = Number(seconds || 0);
    if (minute > 59 || second > 59 || hour > 23) return null;
    if (period) {
      if (hour < 1 || hour > 12) return null;
      hour = hour % 12 + (period.toUpperCase() === 'PM' ? 12 : 0);
    }
    return [hour, minute, second].map(value => String(value).padStart(2, '0')).join(':');
  }

  function parseClock(text) {
    const clean = text.replace(/[ \t]*:[ \t]*/g, ':');
    const values = new Set();
    for (const line of clean.split(/\r?\n/)) {
      const zone = line.search(/GMT|UTC/i);
      if (zone < 0) continue;
      const pattern = /(?:^|[^\d:])(\d{1,2}):(\d{2}):(\d{2})(?:\s*(AM|PM))?(?![\d:])/gi;
      for (const match of line.matchAll(pattern)) {
        const end = match.index + match[0].length;
        if (zone < end || zone - end > 16) continue;
        const value = formattedTime(match[1], match[2], match[3], match[4]);
        if (value) values.add(value);
      }
    }
    return values.size === 1 ? [...values][0] : null;
  }

  function parseExpiry(text, clockFound) {
    if (!clockFound && !/\bTime\b/i.test(text)) return null;
    const clean = text.replace(/[ \t]*:[ \t]*/g, ':');
    const values = new Set();
    const pattern = /(?:^|[^\d:])(\d{1,2}):(\d{2})(?:\s*(AM|PM))?(?![\d:]|\s*:\s*\d)/gi;
    for (const match of clean.matchAll(pattern)) {
      const value = formattedTime(match[1], match[2], 0, match[3]);
      if (value) values.add(value);
    }
    return values.size === 1 ? [...values][0] : null;
  }

  function loadEngine() {
    if (root.Tesseract && root.Tesseract.createWorker) return Promise.resolve(root.Tesseract);
    if (!enginePromise) {
      enginePromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
        script.async = true;
        let timer;
        const fail = () => {
          clearTimeout(timer);
          script.onload = script.onerror = null;
          script.remove();
          enginePromise = null;
          reject(new Error('The time reader could not load.'));
        };
        script.onload = () => {
          if (!root.Tesseract || !root.Tesseract.createWorker) return fail();
          clearTimeout(timer);
          resolve(root.Tesseract);
        };
        script.onerror = fail;
        timer = setTimeout(fail, 20000);
        document.head.append(script);
      });
    }
    return enginePromise;
  }

  function getWorker() {
    if (!workerPromise) {
      const pending = loadEngine().then(engine => engine.createWorker('eng', 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
        errorHandler: () => {}
      }));
      workerPromise = pending;
      pending.catch(() => {
        if (workerPromise === pending) workerPromise = null;
      });
    }
    return workerPromise;
  }

  function discardWorker() {
    const pending = workerPromise;
    workerPromise = null;
    if (pending) pending.then(worker => worker.terminate()).catch(() => {});
  }

  function cropForReading(source, bounds) {
    const left = Math.round(source.width * bounds.left);
    const top = Math.round(source.height * bounds.top);
    const width = Math.round(source.width * (bounds.right - bounds.left));
    const height = Math.round(source.height * (bounds.bottom - bounds.top));
    const canvas = document.createElement('canvas');
    canvas.width = width * 3;
    canvas.height = height * 3;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, left, top, width, height, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const brightness = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114;
      const ink = brightness > 110 ? 0 : 255;
      pixels.data[index] = ink;
      pixels.data[index + 1] = ink;
      pixels.data[index + 2] = ink;
      pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
  }

  function read(source, options) {
    const { isCurrent, onProgress } = options;
    if (source.height < source.width * 1.35) {
      return Promise.resolve({ capture: null, expiry: null });
    }
    const clockImage = cropForReading(source, { left: 0, right: 0.48, top: 0.68, bottom: 0.74 });
    const expiryImage = cropForReading(source, { left: 0.16, right: 0.32, top: 0.765, bottom: 0.79 });
    const task = queue.then(async () => {
      let expired = false;
      let timer;
      const current = () => !expired && isCurrent();
      const recognize = async () => {
        if (!current()) return null;
        onProgress('Loading time reader…');
        const worker = await getWorker();
        if (!current()) return null;
        await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', tessedit_char_whitelist: '' });
        if (!current()) return null;
        onProgress('Reading the chart clock…');
        const clock = await worker.recognize(clockImage);
        if (!current()) return null;
        onProgress('Reading the expiry box…');
        await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789:' });
        if (!current()) return null;
        const expiry = await worker.recognize(expiryImage);
        if (!current()) return null;
        const capture = parseClock(clock.data.text);
        return { capture, expiry: parseExpiry(expiry.data.text, Boolean(capture)) };
      };
      try {
        const timeout = new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Time reading timed out.')), 45000);
        });
        return await Promise.race([recognize(), timeout]);
      } catch (error) {
        expired = true;
        discardWorker();
        throw error;
      } finally {
        clearTimeout(timer);
        clockImage.width = 1;
        expiryImage.width = 1;
      }
    });
    queue = task.catch(() => {});
    return task;
  }

  const api = { parseClock, parseExpiry, read };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IdxTimeReader = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * scan.js — 摄像头条码扫描
 *
 * 技术选择：优先用浏览器原生 BarcodeDetector（Android Chrome 支持，零依赖、无需 key）。
 * 不支持时（例如部分桌面浏览器）不启摄像头，改为手动输入条码 —— 明确降级而不是假装能用。
 *
 * 隐私：视频流只在本机内存里处理，从不录制、从不上传。
 */

const PREFERRED_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];

let state = { stream: null, detector: null, timer: null, lastCode: null, lastAt: 0 };

export function isDetectorSupported() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

export async function supportedFormats() {
  if (!isDetectorSupported()) return [];
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    const usable = PREFERRED_FORMATS.filter((f) => formats.includes(f));
    return usable.length ? usable : formats;
  } catch {
    return [];
  }
}

export function isRunning() {
  return Boolean(state.stream);
}

/**
 * 启动扫描。
 * @param {HTMLVideoElement} video
 * @param {{onDetect:(code:string)=>void, onError:(message:string)=>void, intervalMs?:number}} handlers
 */
export async function startScanner(video, handlers = {}) {
  const { onDetect, onError, intervalMs = 220 } = handlers;
  if (!isDetectorSupported()) {
    onError?.('This browser cannot scan barcodes directly. Type the number instead.');
    return false;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    onError?.('Camera is not available in this browser.');
    return false;
  }

  stopScanner();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    state.stream = stream;
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play().catch(() => {});

    const formats = await supportedFormats();
    state.detector = new window.BarcodeDetector(formats.length ? { formats } : undefined);

    state.timer = setInterval(async () => {
      if (!state.detector || !state.stream) return;
      if (video.readyState < 2) return;
      try {
        const results = await state.detector.detect(video);
        if (!results || !results.length) return;
        const code = String(results[0].rawValue || '').trim();
        if (!code) return;
        // 同一码 2.5 秒内不重复触发，避免连拍抖动
        const now = Date.now();
        if (code === state.lastCode && now - state.lastAt < 2500) return;
        state.lastCode = code;
        state.lastAt = now;
        onDetect?.(code);
      } catch {
        /* 单帧检测失败无需上报，下一帧继续 */
      }
    }, intervalMs);

    return true;
  } catch (err) {
    stopScanner();
    const message =
      err?.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access, or type the barcode instead.'
        : err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError'
          ? 'No camera found on this device.'
          : `Camera error: ${err?.message || 'unknown'}`;
    onError?.(message);
    return false;
  }
}

/** 停止扫描并释放摄像头（页面离开时必须调用，否则指示灯一直亮） */
export function stopScanner() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  if (state.stream) {
    for (const track of state.stream.getTracks()) track.stop();
    state.stream = null;
  }
  state.detector = null;
  state.lastCode = null;
}

/** 轻触反馈：成功识别时震动一下（可在偏好里关掉） */
export function haptic(ms = 60) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* 不支持的设备忽略 */
  }
}

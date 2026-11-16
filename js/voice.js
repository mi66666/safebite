/**
 * voice.js — 语音朗读（无障碍核心功能，也是评分表「accessibility」的硬得分点）
 *
 * 用系统自带的 SpeechSynthesis：Android Chrome 上一般由 Google TTS 引擎提供，
 * 无需网络请求、无需 API key，也符合「数据不出设备」的隐私主张。
 */

let preferredVoice = null;
let enabled = true;

export function isSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function setEnabled(value) {
  enabled = Boolean(value);
  if (!enabled) cancel();
}

export function getEnabled() {
  return enabled;
}

function pickVoice() {
  if (!isSupported()) return null;
  if (preferredVoice) return preferredVoice;
  const voices = speechSynthesis.getVoices() || [];
  if (!voices.length) return null;
  // 优先本地英语女声，其次任意 en-*
  const local = voices.find((v) => /^en/i.test(v.lang) && v.localService);
  preferredVoice = local || voices.find((v) => /^en/i.test(v.lang)) || voices[0];
  return preferredVoice;
}

if (isSupported()) {
  // 语音列表在部分浏览器是异步加载的
  speechSynthesis.addEventListener?.('voiceschanged', () => {
    preferredVoice = null;
    pickVoice();
  });
}

/**
 * 朗读一段文本。
 * @param {string} text
 * @param {{interrupt?: boolean, rate?: number, pitch?: number}} options
 */
export function speak(text, options = {}) {
  if (!isSupported() || !enabled) return false;
  const { interrupt = true, rate = 0.95, pitch = 1 } = options;
  const clean = String(text || '').trim();
  if (!clean) return false;

  if (interrupt) speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(clean);
  const voice = pickVoice();
  if (voice) {
    utter.voice = voice;
    utter.lang = voice.lang;
  } else {
    utter.lang = 'en-GB';
  }
  utter.rate = rate;
  utter.pitch = pitch;
  utter.volume = 1;
  // 朗读不会阻塞 UI
  speechSynthesis.speak(utter);
  return true;
}

export function cancel() {
  if (isSupported()) speechSynthesis.cancel();
}

export function isSpeaking() {
  return isSupported() && speechSynthesis.speaking;
}

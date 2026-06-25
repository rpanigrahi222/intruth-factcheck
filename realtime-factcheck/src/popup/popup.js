// popup.js

const toggleBtn   = document.getElementById('toggleBtn');
const statusEl    = document.getElementById('status');
const anthropicEl = document.getElementById('anthropicKey');
const keyHint     = document.getElementById('keyHint');
const keysSection = document.getElementById('keysSection');
const languageEl  = document.getElementById('languageSelect');
const langFlagEl  = document.getElementById('langFlag');

const LANG_FLAGS = {
  en: '🇺🇸', es: '🇪🇸', fr: '🇫🇷', de: '🇩🇪', it: '🇮🇹',
  pt: '🇧🇷', nl: '🇳🇱', hi: '🇮🇳', ja: '🇯🇵', zh: '🇨🇳',
  ar: '🇸🇦', ko: '🇰🇷', ru: '🇷🇺', pl: '🇵🇱', sv: '🇸🇪', tr: '🇹🇷',
};

function updateFlag() {
  langFlagEl.textContent = LANG_FLAGS[languageEl.value] || '🌐';
}

let isActive = false;

// ── Load saved key and language ───────────────────────────────────────────────

chrome.storage.local.get(['anthropicKey', 'transcriptLanguage'], (data) => {
  if (data.anthropicKey) { anthropicEl.value = data.anthropicKey; anthropicEl.classList.add('saved'); }
  if (data.transcriptLanguage) languageEl.value = data.transcriptLanguage;
  updateFlag();
  updateHint();
});

// ── Save key on change ────────────────────────────────────────────────────────

anthropicEl.addEventListener('input', () => {
  anthropicEl.classList.remove('saved');
  updateHint();
});
anthropicEl.addEventListener('change', () => {
  chrome.storage.local.set({ anthropicKey: anthropicEl.value.trim() });
  anthropicEl.classList.add('saved');
  updateHint();
});

// ── Save language on change ───────────────────────────────────────────────────

languageEl.addEventListener('change', () => {
  chrome.storage.local.set({ transcriptLanguage: languageEl.value });
  updateFlag();
});

function updateHint() {
  if (!anthropicEl.value.trim()) {
    keyHint.textContent = 'Enter your Anthropic API key to start.';
    keyHint.className = 'key-hint';
    toggleBtn.disabled = isActive ? false : true;
  } else {
    keyHint.textContent = 'Key saved.';
    keyHint.className = 'key-hint ok';
    toggleBtn.disabled = false;
  }
}

// ── Status ────────────────────────────────────────────────────────────────────

chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
  if (res?.isCapturing) setActive(true);
});

function setActive(active) {
  isActive = active;
  toggleBtn.textContent  = active ? 'Stop Fact-Checking' : 'Start Fact-Checking';
  toggleBtn.className    = 'toggle-btn' + (active ? ' active' : '');
  statusEl.textContent   = active ? 'Live • Fact-checking active' : 'Inactive';
  statusEl.className     = 'status' + (active ? ' active' : '');
  // hide key fields while active
  keysSection.style.display = active ? 'none' : 'flex';
  if (!active) updateHint();
}

// ── Toggle ────────────────────────────────────────────────────────────────────

toggleBtn.addEventListener('click', async () => {
  if (isActive) {
    chrome.runtime.sendMessage({ type: 'STOP_FACTCHECK' });
    setActive(false);
    return;
  }

  const anthropicKey = anthropicEl.value.trim();

  if (!anthropicKey) {
    keyHint.textContent = 'Please enter your Anthropic API key.';
    keyHint.className   = 'key-hint error';
    return;
  }

  // save key and language then start
  await new Promise(r => chrome.storage.local.set({ anthropicKey, transcriptLanguage: languageEl.value }, r));

  chrome.runtime.sendMessage({ type: 'START_FACTCHECK' }, (res) => {
    if (res?.ok) {
      setActive(true);
    } else {
      keyHint.textContent = 'Failed to start: ' + (res?.error || 'unknown error');
      keyHint.className   = 'key-hint error';
    }
  });
});
// service-worker.js
let ANTHROPIC_KEY = '';
let TRANSCRIPT_LANGUAGE = 'en';
const BACKEND_URL = 'https://intruth-backend.vercel.app';


async function loadKeys() {
  return new Promise(resolve => {
    chrome.storage.local.get(['anthropicKey', 'transcriptLanguage'], (data) => {
      ANTHROPIC_KEY = data.anthropicKey || '';
      TRANSCRIPT_LANGUAGE = data.transcriptLanguage || 'en';
      resolve();
    });
  });
}

const EVALUATE_PROMPT = ``


const GROUNDED_PROMPT = ``

const SPEAKER_PARSE_NOISE = new Set(['debate','presidential','vp','vice','2024','2023','2022','2021','2020','2019','2016','surrounded','tonight','live','full','official']);

function parseSpeakersFromTitle(title) {
  if (!title) return [];
  const clean = title.split('|')[0].trim();

  // 'N role vs N role' — e.g. '1 Liberal vs 20 Conservatives'
  const roleMatch = clean.match(/(\d+)\s+([a-z]+(?:\s+[a-z]+)?)\s+(?:vs?\.?|versus)\s+(\d+)\s+([a-z]+(?:\s+[a-z]+)?)/i);
  if (roleMatch) {
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    return [cap(roleMatch[2]), cap(roleMatch[4])];
  }

  // 'Name vs N Description' — second side starts with digit, e.g. 'Dean Withers vs 20 MAGA Women'
  const nameVsGroupMatch = clean.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:vs?\.?|versus)\s+(\d+)\s+(.+)/i);
  if (nameVsGroupMatch) {
    const name = nameVsGroupMatch[1].trim().split(' ').pop();
    const groupWords = nameVsGroupMatch[3].trim().split(/\s+/);
    const group = groupWords.filter(w => !SPEAKER_PARSE_NOISE.has(w.toLowerCase())).pop() || groupWords.pop();
    return [name, group];
  }

  // split on vs/and — take last non-noise capitalized word from each side
  const vsSplit = clean.split(/\s+(?:vs?\.?|versus|and|&)\s+/i);
  if (vsSplit.length >= 2) {
    const lastName = part => {
      const words = part.trim().split(/\s+/);
      for (let i = words.length - 1; i >= 0; i--) {
        if (/^[A-Z]/.test(words[i]) && !SPEAKER_PARSE_NOISE.has(words[i].toLowerCase())) return words[i];
      }
      return null;
    };
    const a = lastName(vsSplit[0]);
    const b = lastName(vsSplit[1]);
    if (a && b) return [a, b];
  }

  return [];
}

// ── Serper ────────────────────────────────────────────────────────────────────

const BLOCKED_DOMAINS = [
  // social media
  'reddit.com', 'facebook.com', 'twitter.com', 'x.com',
  'tiktok.com', 'instagram.com', 'pinterest.com', 'quora.com',
  'yelp.com', 'tripadvisor.com', 'youtube.com',

  // partisan left
  'democrats.org', 'dnc.org', 'afscme.org', 'americanprogress.org',
  'dailykos.com', 'mediamatters.org', 'motherjones.com',
  'moveon.org', 'huffpost.com', 'thenation.com', 'jacobinmag.com',
  'truthout.org', 'commondreams.org', 'alternet.org',
  'rawstory.com', 'palmerreport.com', 'occupydemocrats.com',
  'crooksandliars.com', 'bipartisanreport.com', 'wonkette.com',

  // partisan right
  'republicans.org', 'gop.com', 'ntu.org', 'heritage.org',
  'breitbart.com', 'newsmax.com', 'thefederalist.com', 'nationalreview.com',
  'dailywire.com', 'townhall.com', 'westernjournal.com',
  'lifesitenews.com', 'oann.com', 'theblaze.com', 'americanthinker.com',
  'dailycaller.com', 'thepostmillennial.com', 'redstate.com', 'pjmedia.com',
  'bizpacreview.com', 'americangreatness.com', 'gellerreport.com',
  'thepoliticalinsider.com', 'twitchy.com', 'wnd.com',

  // government / state media
  'gov.il', 'rt.com', 'sputniknews.com', 'xinhua.net',
  'globaltimes.cn', 'presstv.ir', 'almayadeen.net', 'idf.il',
  'cgtn.com', 'tass.com', 'mintpressnews.com', 'thegrayzone.com',
  'strategic-culture.org', 'southfront.org', 'veteranstoday.com',

  // conspiracy / low credibility
  'infowars.com', 'naturalnews.com', 'zerohedge.com',
  'thegatewaypundit.com', 'beforeitsnews.com', 'activistpost.com',
  'newspunch.com', 'neonnettle.com', 'worldtruth.tv',
  'mercola.com', 'greenmedinfo.com', 'childrenshealthdefense.org',

  // advocacy organizations
  'ajc.org', 'cair.com', 'adl.org', 'aclu.org',
  'democrats-appropriations.house.gov', 'waysandmeans.house.gov',

  // misc low quality
  'bostonkravmaga.com', 'israelpolicyforum.org',

  // PDF hosting / document repositories
  'dokumen.pub', 'dokumen.tips', 'slideshare.net',
  'pdfdrive.com', 'pdfcoffee.com', 'issuu.com',
];

const LANGUAGE_LOCALE = {
  en: { gl: 'us', hl: 'en' },
  es: { gl: 'es', hl: 'es' },
  fr: { gl: 'fr', hl: 'fr' },
  de: { gl: 'de', hl: 'de' },
  it: { gl: 'it', hl: 'it' },
  pt: { gl: 'br', hl: 'pt' },
  nl: { gl: 'nl', hl: 'nl' },
  hi: { gl: 'in', hl: 'hi' },
  ja: { gl: 'jp', hl: 'ja' },
  zh: { gl: 'cn', hl: 'zh-cn' },
  ar: { gl: 'sa', hl: 'ar' },
  ko: { gl: 'kr', hl: 'ko' },
  ru: { gl: 'ru', hl: 'ru' },
  pl: { gl: 'pl', hl: 'pl' },
  sv: { gl: 'se', hl: 'sv' },
  tr: { gl: 'tr', hl: 'tr' },
};

async function searchWeb(query, retries = 2) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/serper`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 10, ...(LANGUAGE_LOCALE[TRANSCRIPT_LANGUAGE] || LANGUAGE_LOCALE.en) }),

    });
    const data = await res.json();

    const debateDate = pageDate ? new Date(pageDate) : null;
    const organic = (data.organic ?? [])
      .filter(r => {
        if (!r.link || BLOCKED_DOMAINS.some(d => r.link.includes(d))) return false;
        // drop sources dated more than 1 year after the debate date
        if (debateDate && r.date) {
          try {
            const sourceDate = new Date(r.date);
            const oneYearAfter = new Date(debateDate.getTime() + 365 * 24 * 60 * 60 * 1000);
            if (!isNaN(sourceDate.getTime()) && sourceDate > oneYearAfter) return false;
          } catch {}
        }
        return true;
      })
      .slice(0, 4)
      .map(r => ({ url: r.link, title: r.title || '', snippet: r.snippet || '', date: r.date || '' }));

    // answerBox — Google's direct factual answer, highest quality signal
    const answerBox = data.answerBox
      ? {
          answer: data.answerBox.answer || data.answerBox.snippet || '',
          title:  data.answerBox.title  || '',
          url:    data.answerBox.link   || '',
        }
      : null;

    // knowledgeGraph — structured entity data
    const knowledgeGraph = data.knowledgeGraph
      ? {
          description: data.knowledgeGraph.description || '',
          title:       data.knowledgeGraph.title       || '',
        }
      : null;

    return { organic, answerBox, knowledgeGraph };
  } catch (err) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 500));
      return searchWeb(query, retries - 1);
    }
    console.error('[serper] error:', err);
    return { organic: [], answerBox: null, knowledgeGraph: null };
  }
}

// ── Claude ────────────────────────────────────────────────────────────────────

const MODEL_HAIKU  = 'claude-haiku-4-5-20251001';
const MODEL_SONNET = 'claude-sonnet-5';

// Cap concurrent grounded (Sonnet) calls so a pile-up of them can't saturate the
// api.anthropic.com connection pool and starve the fast (Haiku) pass — which is
// what makes fast cards surface late. The fast pass is never gated; grounded
// verdicts are async refinements and can safely queue behind this gate.
const GROUNDED_MAX_CONCURRENCY = 2;
let groundedActive = 0;
const groundedWaiters = [];
function acquireGrounded() {
  if (groundedActive < GROUNDED_MAX_CONCURRENCY) { groundedActive++; return Promise.resolve(); }
  return new Promise(resolve => groundedWaiters.push(resolve));
}
function releaseGrounded() {
  const next = groundedWaiters.shift();
  if (next) next();          // transfer the slot directly to the next waiter
  else groundedActive--;     // no waiter — free the slot
}

// opts: { model, maxTokens, temperature }. Defaults reproduce the fast pass
// (Haiku, 1024 tokens, temperature 0). The grounded pass overrides these to run
// on Sonnet — which needs a larger token budget (thinking eats into it) and
// requires temperature to be OMITTED (newer models reject the parameter). Pass
// temperature: null to omit it.
async function callClaude(userMessage, systemPrompt, opts = {}) {
  const model       = opts.model     || MODEL_HAIKU;
  const maxTokens   = opts.maxTokens || 1024;
  const temperature = ('temperature' in opts) ? opts.temperature : 0;

  const body = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  };
  if (temperature !== null && temperature !== undefined) body.temperature = temperature;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':            'application/json',
      'x-api-key':               ANTHROPIC_KEY,
      'anthropic-version':       '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) {
    const msg = data.error.message || 'Unknown API error';
    console.error('[claude] API error:', msg);
    if (activeTabId) chrome.tabs.sendMessage(activeTabId, { type: 'PIPELINE_ERROR', message: msg }).catch(() => {});
    return '';
  }
  // Use the first TEXT block — newer models (sonnet-5) emit a leading `thinking`
  // block, so content[0] is not necessarily the answer.
  const textBlock = (data.content || []).find(b => b && b.type === 'text' && b.text);
  const raw = (textBlock?.text || '').trim();
  return raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
}

function parseArray(str) {
  const start = str.indexOf('[');
  const end   = str.lastIndexOf(']');
  if (start === -1 || end === -1) return [];
  try { return JSON.parse(str.slice(start, end + 1)); }
  catch { return []; }
}

// ── Lexical features ──────────────────────────────────────────────────────────

const HEDGING_WORDS   = ['think','believe','maybe','perhaps','probably','might','could','seem','appears','guess','suppose','somewhat'];
const CERTAINTY_WORDS = ['definitely','certainly','absolutely','always','never','clearly','obviously','undoubtedly','exactly','proven'];
const FILLER_WORDS    = ['um','uh','like','basically','actually','literally','right','okay'];
const EMOTIONAL_WORDS = ['disaster','terrible','horrible','amazing','incredible','great','awful','fantastic','disgusting','wonderful','worst','best'];
const EXCLUSIVE_WORDS = ['but','except','however','although','unless','without','exclude'];
const FP_SINGULAR     = ['i','me','my','mine','myself'];

function extractLexical(text) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const total = words.length || 1;
  const rate  = (list) => Math.round(words.filter(w => list.some(h => w.includes(h))).length / total * 100);
  return {
    rates: {
      hedging:       rate(HEDGING_WORDS),
      certainty:     rate(CERTAINTY_WORDS),
      filler:        rate(FILLER_WORDS),
      emotional:     rate(EMOTIONAL_WORDS),
      exclusive:     rate(EXCLUSIVE_WORDS),
      firstPersonSg: Math.round(words.filter(w => FP_SINGULAR.includes(w)).length / total * 100),
    },
    wordsPerSecond: null,
    wordCount: total,
  };
}

function buildLexicalSummary(f) {
  const r = f.rates || f;
  const notes = [];
  if (r.hedging > 5)       notes.push(`hedging language (${r.hedging}%)`);
  if (r.certainty > 5)     notes.push(`certainty markers (${r.certainty}%)`);
  if (r.filler > 5)        notes.push(`filler words (${r.filler}%)`);
  if (r.emotional > 5)     notes.push(`emotional language (${r.emotional}%)`);
  if (r.exclusive > 5)     notes.push(`qualifying words (${r.exclusive}%)`);
  if (r.firstPersonSg > 5) notes.push(`first-person singular (${r.firstPersonSg}%)`);
  if (f.wordsPerSecond) {
    const pace = f.wordsPerSecond > 3.5 ? 'fast' : f.wordsPerSecond < 2 ? 'slow' : 'moderate';
    notes.push(`speech rate ${f.wordsPerSecond} w/s (${pace})`);
  }
  return notes.length ? `Features detected: ${notes.join(', ')}.` : 'Neutral delivery.';
}

// ── Claim deduplication ───────────────────────────────────────────────────────

const recentClaims   = new Map(); // key → [timestamp, originalClaim]
const CLAIM_DEDUP_MS = 200000;

function normalizeClaimKey(claim) {
  return claim.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 4)
    .sort()
    .join(' ');
}

function isDuplicate(claim) {
  const key = normalizeClaimKey(claim);
  const now = Date.now();

  for (const [k, v] of recentClaims) {
    const t = Array.isArray(v) ? v[0] : v;
    if (now - t > CLAIM_DEDUP_MS) recentClaims.delete(k);
  }

  if (recentClaims.has(key)) return true;

  const keyWords = new Set(key.split(' ').filter(Boolean));
  const figures  = (claim.match(/\$[\d,.]+(?:\s*(?:trillion|billion|million|thousand))?/gi) || [])
    .map(d => d.replace(/[,\s]/g, '').toLowerCase());

  for (const [k, v] of recentClaims) {
    const kWords = k.split(' ').filter(Boolean);
    if (kWords.filter(w => keyWords.has(w)).length / Math.max(keyWords.size, kWords.length) >= 0.35) return true;
    if (figures.length) {
      const origClaim = Array.isArray(v) ? v[1] : '';
      if (origClaim) {
        const origFigures = (origClaim.match(/\$[\d,.]+(?:\s*(?:trillion|billion|million|thousand))?/gi) || [])
          .map(d => d.replace(/[,\s]/g, '').toLowerCase());
        if (figures.some(f => origFigures.includes(f))) return true;
      }
    }
  }

  recentClaims.set(key, [now, claim]);
  return false;
}

// ── Rolling window ────────────────────────────────────────────────────────────

const WINDOW_SIZE = 4;
const WINDOW_KEEP = 15;
// Flush the window after this long even if fewer than WINDOW_SIZE sentences have
// arrived — otherwise a claim spoken early in a window waits for 4 slow Deepgram
// fragments (~3-4s apart = 8-12s) before the fast pass even runs. A time cap only
// adds flushes during SLOW speech (spaced > the ~2.5s fast call), so it does not
// reintroduce the concurrency racing that a smaller WINDOW_SIZE caused.
const MAX_WINDOW_MS = 4000;

// Each entry: { text, speakerId, speakerName }
let sentenceWindow  = [];
let sentenceCount   = 0;
let windowLexical   = { rates: { hedging: 0, certainty: 0, filler: 0, emotional: 0, exclusive: 0, firstPersonSg: 0 }, wordsPerSecond: null, wordCount: 0, _sentenceCount: 0 };
let windowStartTime = null;
let fastPassInFlight = false;  // single-flight guard: never run two fast passes at once (they contend and balloon to 5-6s)
let pageTitle       = '';
let pageDate        = '';
let currentSpeakerId  = null;
let speakerIdToName   = {};  // confirmed: { 0: 'Harris', 1: 'Trump' }
let confirmedSpeakers = new Set(); // IDs that have been confirmed by user

function resetWindow() {
  sentenceWindow   = [];
  sentenceCount    = 0;
  windowLexical    = { rates: { hedging: 0, certainty: 0, filler: 0, emotional: 0, exclusive: 0, firstPersonSg: 0 }, wordsPerSecond: null, wordCount: 0, _sentenceCount: 0 };
  windowStartTime  = null;
  currentSpeakerId  = null;
  lastSpeakerId     = null;
  speakerIdToName   = {};
  confirmedSpeakers = new Set();
}

async function onNewSentence(text, speakerId) {
  console.log('[timing] sentence @', Date.now() % 100000, 'ms | spk', speakerId, '|', (text || '').slice(0, 45));  // [TIMING]
  // flush window early on speaker change (mid-window turn transition)
  if (lastSpeakerId !== null &&
      speakerId !== null &&
      speakerId !== undefined &&
      speakerId !== lastSpeakerId &&
      sentenceCount % WINDOW_SIZE !== 0 &&
      sentenceWindow.length >= 2) {
    // fire evaluation for the previous speaker's sentences before processing this one
    const flushText = sentenceWindow.map(s => s.text).join(' ');
    const flushCounts = {};
    sentenceWindow.slice(-WINDOW_SIZE).forEach(s => {
      if (s.speakerId !== null && s.speakerId !== undefined)
        flushCounts[s.speakerId] = (flushCounts[s.speakerId] || 0) + 1;
    });
    const flushDominantId = Object.keys(flushCounts).length
      ? Object.entries(flushCounts).sort((a,b) => b[1]-a[1])[0][0]
      : null;
    const flushDominantSpeaker = flushDominantId !== null ? (speakerIdToName[flushDominantId] || null) : null;
    const flushLexSnapshot = JSON.parse(JSON.stringify(windowLexical));
    const fsc = flushLexSnapshot._sentenceCount || 1;
    const flr = flushLexSnapshot.rates;
    flr.hedging       = Math.round(flr.hedging       / fsc);
    flr.certainty     = Math.round(flr.certainty     / fsc);
    flr.filler        = Math.round(flr.filler        / fsc);
    flr.emotional     = Math.round(flr.emotional     / fsc);
    flr.exclusive     = Math.round(flr.exclusive     / fsc);
    flr.firstPersonSg = Math.round(flr.firstPersonSg / fsc);
    const flushLexSummary  = buildLexicalSummary(flushLexSnapshot);
    windowLexical   = { rates: { hedging: 0, certainty: 0, filler: 0, emotional: 0, exclusive: 0, firstPersonSg: 0 }, wordsPerSecond: null, wordCount: 0, _sentenceCount: 0 };
    windowStartTime = null;
    await evaluateClaims(flushText, pageTitle, flushLexSummary, flushLexSnapshot, flushDominantSpeaker, flushDominantId, getOpponentName(flushDominantSpeaker));
  }
  lastSpeakerId = speakerId;

  // label with confirmed name if available, else Speaker N for Claude to infer
  const confirmedName = (speakerId !== null && speakerId !== undefined) ? speakerIdToName[speakerId] : null;
  const label         = confirmedName ? `[${confirmedName}]` : (speakerId !== null && speakerId !== undefined ? `[Speaker ${speakerId}]` : null);
  const labeledText   = label ? `${label} ${text}` : text;

  sentenceWindow.push({ text: labeledText, speakerId, speakerName: confirmedName });
  if (sentenceWindow.length > WINDOW_KEEP) sentenceWindow.shift();
  sentenceCount++;

  if (!windowStartTime) windowStartTime = Date.now();

  // accumulate lexical — running sum, divide by sentence count at snapshot time
  const f = extractLexical(text);
  const r = f.rates, wr = windowLexical.rates;
  wr.hedging       += r.hedging;
  wr.certainty     += r.certainty;
  wr.filler        += r.filler;
  wr.emotional     += r.emotional;
  wr.exclusive     += r.exclusive;
  wr.firstPersonSg += r.firstPersonSg;
  windowLexical.wordCount += f.wordCount;
  windowLexical._sentenceCount = (windowLexical._sentenceCount || 0) + 1;

  // Flush when the window is full OR it has gone stale (claim waiting too long).
  const windowStale = windowStartTime && (Date.now() - windowStartTime) > MAX_WINDOW_MS && sentenceWindow.length >= 2;
  if (sentenceCount % WINDOW_SIZE === 0 || windowStale) {
    const contextText = sentenceWindow.map(s => s.text).join(' ');

    // dominant speaker ID = whoever appears most in this window
    // count only the CURRENT window's sentences (last WINDOW_SIZE), not full rolling buffer
    const currentWindowSentences = sentenceWindow.slice(-WINDOW_SIZE);
    const counts = {};
    currentWindowSentences.forEach(s => {
      if (s.speakerId !== null && s.speakerId !== undefined) {
        counts[s.speakerId] = (counts[s.speakerId] || 0) + 1;
      }
    });
    const dominantSpeakerId = Object.keys(counts).length
      ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
      : null;
    // use confirmed name from speakerIdToName — ground truth from Deepgram + user confirmation
    const dominantSpeaker = dominantSpeakerId !== null
      ? (speakerIdToName[dominantSpeakerId] || null)
      : null;

    // speech rate
    const elapsed = windowStartTime ? (Date.now() - windowStartTime) / 1000 : null;
    if (elapsed && elapsed > 0) windowLexical.wordsPerSecond = Math.round(windowLexical.wordCount / elapsed * 10) / 10;
    windowStartTime = null;

    const lexicalSnapshot = JSON.parse(JSON.stringify(windowLexical));
    // average the accumulated sums now that we have the full window
    const sc = lexicalSnapshot._sentenceCount || 1;
    const lr = lexicalSnapshot.rates;
    lr.hedging       = Math.round(lr.hedging       / sc);
    lr.certainty     = Math.round(lr.certainty     / sc);
    lr.filler        = Math.round(lr.filler        / sc);
    lr.emotional     = Math.round(lr.emotional     / sc);
    lr.exclusive     = Math.round(lr.exclusive     / sc);
    lr.firstPersonSg = Math.round(lr.firstPersonSg / sc);
    const lexicalSummary  = buildLexicalSummary(lexicalSnapshot);

    // reset for next window
    windowLexical   = { rates: { hedging: 0, certainty: 0, filler: 0, emotional: 0, exclusive: 0, firstPersonSg: 0 }, wordsPerSecond: null, wordCount: 0, _sentenceCount: 0 };
    windowStartTime = null;

    try {
      await evaluateClaims(contextText, pageTitle, lexicalSummary, lexicalSnapshot, dominantSpeaker, dominantSpeakerId, getOpponentName(dominantSpeaker));
    } catch (e) {
    }
  }
}

// ── Evaluation pipeline ───────────────────────────────────────────────────────

// ── Pronoun resolution ────────────────────────────────────────────────────────

const LEGAL_TERMS = 'prosecuted|convicted|indicted|found liable|sentenced|charged|arrested|impeached';

function resolveDismissivePronouns(text, speakerName, opponentName) {
  if (!opponentName) return text;

  let t = text;

  // dismissive third-person framing
  t = t.replace(/coming from someone who/gi,  `coming from ${opponentName} who`);
  t = t.replace(/said by someone who/gi,      `said by ${opponentName} who`);
  t = t.replace(/from (?:a )?(?:man|woman|guy|person) who/gi, `from ${opponentName} who`);
  t = t.replace(/\bfrom him\b/gi,   `from ${opponentName}`);
  t = t.replace(/\bfrom her\b/gi,   `from ${opponentName}`);
  t = t.replace(/\bfrom them\b/gi,  `from ${opponentName}`);
  t = t.replace(/that's rich coming from/gi, `that's rich coming from ${opponentName},`);

  // second-person attacks with legal language
  t = t.replace(/\byou(?:'ve| have)? been found liable/gi, `${opponentName} has been found liable`);
  t = t.replace(/\byou were found liable/gi, `${opponentName} was found liable`);
  const legalRe = new RegExp(`\\byou(?:'ve| have| were| are| got)\\s+(?:been\\s+)?(prosecuted|convicted|indicted|sentenced|charged|arrested|impeached)`, 'gi');
  t = t.replace(legalRe, (match, term) => {
    const past = match.toLowerCase().includes('were') ? 'was' : 'has been';
    return `${opponentName} ${past} ${term}`;
  });

  // third-person he/she with legal language only
  const thirdRe = new RegExp(`\\b(he|she)\\s+(has been|was|have been|were)\\s+(prosecuted|convicted|indicted|found liable|sentenced|charged|arrested)`, 'gi');
  t = t.replace(thirdRe, (match, pronoun, tense, term) => `${opponentName} ${tense} ${term}`);

  return t;
}


function getOpponentName(speakerName) {
  // try confirmed speaker map first
  const confirmed = Object.values(speakerIdToName).filter(Boolean);
  if (confirmed.length >= 2 && speakerName) {
    const opponent = confirmed.find(n => n.toLowerCase() !== speakerName.toLowerCase());
    if (opponent) return opponent;
  }
  // fall back to title-parsed names
  const titleNames = parseSpeakersFromTitle(pageTitle);
  if (titleNames.length >= 2 && speakerName) {
    return titleNames.find(n =>
      !n.toLowerCase().includes(speakerName.toLowerCase()) &&
      !speakerName.toLowerCase().includes(n.toLowerCase())
    ) || (titleNames[0].toLowerCase() === speakerName.toLowerCase() ? titleNames[1] : titleNames[0]);
  }
  return null;
}

async function evaluateClaims(contextText, title, lexicalSummary, lexicalSnapshot, dominantSpeaker, dominantSpeakerId, opponentName = null) {
  // Single-flight: if a fast pass is already running, skip this flush — the
  // rolling 15-sentence buffer means the next flush re-covers this content.
  // Prevents overlapping fast calls from contending and ballooning to 5-6s.
  if (fastPassInFlight) { console.log('[timing] fast pass busy — flush skipped'); return; }
  fastPassInFlight = true;
  try {
    const _tEval = Date.now();  // [TIMING]
    // resolve dismissive pronouns before Claude ever sees the text
    const resolvedText = resolveDismissivePronouns(contextText, dominantSpeaker, opponentName);
    const dateContext    = pageDate ? `\nDate: ${pageDate}` : '';

    // build speaker legend from title names for Claude
    const titleNames    = parseSpeakersFromTitle(title || '');
    const nameList = titleNames.join(' and ');
    const speakerLegend = titleNames.length
      ? `\nDebate participants: ${nameList}.` +
        `\nSpeaker attribution rules:` +
        `\n- [Speaker N] labels indicate turn order only — do NOT map Speaker 0 to the first name listed.` +
        `\n- Identify speakers using: (1) first-person language — when someone says "I", "my plan", "I intend to", they ARE the speaker — attribute the claim to the known participant whose policies match; (2) policy content — match stated positions to each participant's known platform; (3) cross-references — participants typically refer to each other by name.` +
        `\n- Use your knowledge of each named participant's background, policies, and public record to attribute correctly.` +
        `\n- If a moderator or third party is speaking, attribute to them if identifiable, otherwise use "Unknown".` +
        `\n- NEVER output "Speaker N" or any [Speaker N] format in any field.`
      : `\nIdentify speakers using first-person language, policy content, and speech patterns. Never output "Speaker N".`;

    const languageInstruction = TRANSCRIPT_LANGUAGE && TRANSCRIPT_LANGUAGE !== 'en'
      ? `\nLANGUAGE — MANDATORY: The transcript is in ${TRANSCRIPT_LANGUAGE}. You MUST write BOTH the "claim" AND "explanation" fields in ${TRANSCRIPT_LANGUAGE}. Before writing the explanation, check the claim language and match it exactly. Never write the explanation in English if the claim is in another language. Only the verdict values (TRUE, FALSE, SUBSTANTIALLY TRUE, MISLEADING, UNVERIFIABLE) stay in English.`
      : '';

    const speakerContext = dominantSpeaker && opponentName
      ? `\nCurrent speaker: ${dominantSpeaker}. Opponent: ${opponentName}. First-person claims are about ${dominantSpeaker}. Dismissive framing ("coming from someone who...") refers to ${opponentName}.`
      : dominantSpeaker
      ? `\nCurrent speaker: ${dominantSpeaker}.`
      : '';

    const titleContext = title
      ? `Video: "${title}"${dateContext}${speakerLegend}${speakerContext}\n\nEvaluate claims as they were made at the time of this recording. Do not apply knowledge of events after this date.${languageInstruction}\n\n`
      : (speakerContext || languageInstruction) ? `${speakerContext}${languageInstruction}\n\n` : '';
    const lexicalContext = lexicalSummary ? `\n\nLexical analysis: ${lexicalSummary}` : '';

    // already-checked claims list for Claude
    const checkedList = [...recentClaims.values()]
      .filter(v => Array.isArray(v) && v[1])
      .map(v => v[1])
      .slice(-15)
      .join('\n- ');
    const alreadyChecked = checkedList
      ? `\n\nClaims already fact-checked this session — do NOT re-evaluate these or close variants:\n- ${checkedList}\n`
      : '';

    // fast Claude call — Serper searches fire immediately after on the returned claims
    const _tFast = Date.now();  // [TIMING]
    const raw     = await callClaude(
      `${titleContext}Transcript: "${resolvedText}"${alreadyChecked}${lexicalContext}`,
      EVALUATE_PROMPT
    );
    console.log('[timing] fast Claude call:', Date.now() - _tFast, 'ms');  // [TIMING]
    const results = parseArray(raw);
    const valid   = results.filter(r => r.claim && r.verdict && r.verdict !== 'UNVERIFIABLE' && !isDuplicate(r.claim));

    if (!valid.length) return;

    // kick off per-claim Serper searches in parallel with sending fast cards to overlay
    const claimSearchPromises = valid.map(r => searchWeb(r.claim));

    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, {
        type: 'NEW_VERDICT',
        results: valid.map(r => ({
          ...r,
          sources:          [],
          pending:          true,
          lexical:          lexicalSnapshot,
          dominantSpeakerId,
          speaker:          dominantSpeaker || (r.speaker && !r.speaker.match(/^Speaker\s*\d+$/i) ? r.speaker : null),
        })),
      }).catch(() => {});
      console.log('[timing] flush→card total:', Date.now() - _tEval, 'ms | fast verdicts:', valid.length, '| speaker:', dominantSpeaker);
    }

    groundAndUpdate(contextText, valid, title, lexicalSummary, lexicalSnapshot, dominantSpeaker, dominantSpeakerId, claimSearchPromises, opponentName);

  } catch (err) {
    console.error('[pipeline] error:', err);
  } finally {
    fastPassInFlight = false;
  }
}

async function groundAndUpdate(contextText, fastResults, title, lexicalSummary, lexicalSnapshot, dominantSpeaker, dominantSpeakerId, claimSearchPromises = null, opponentName = null) {
  try {
    const dateCtx      = pageDate ? `\nDate: ${pageDate}` : '';
    const languageInstruction = TRANSCRIPT_LANGUAGE && TRANSCRIPT_LANGUAGE !== 'en'
      ? `\nLANGUAGE — MANDATORY: The transcript is in ${TRANSCRIPT_LANGUAGE}. You MUST write the "explanation" field in ${TRANSCRIPT_LANGUAGE}. Look at the "claim" field language — your explanation MUST match it. Never mix languages. Never use the transcript itself as evidence — only use web search results. Only the verdict values (TRUE, FALSE, SUBSTANTIALLY TRUE, MISLEADING, UNVERIFIABLE) stay in English.`
      : '';

    const speakerContext = dominantSpeaker && opponentName
      ? `\nCurrent speaker: ${dominantSpeaker}. Opponent: ${opponentName}.`
      : '';

    const titleContext = title
      ? `Video: "${title}"${dateCtx}${speakerContext}\nEvaluate claims as they were made at the time of this recording. Web search results may include articles published after the debate date — ignore any information that was not publicly known at the time of the debate.${languageInstruction}\n\n`
      : (speakerContext || languageInstruction) ? `${speakerContext}${languageInstruction}\n\n` : '';
    const lexicalContext = lexicalSummary ? `\n\nLexical analysis: ${lexicalSummary}` : '';

    const groundedAll = await Promise.all(fastResults.map(async (fastResult, i) => {
      try {
        const searchData = claimSearchPromises
          ? await claimSearchPromises[i]
          : await searchWeb(fastResult.claim);
        if (!searchData.organic?.length && !searchData.answerBox && !searchData.knowledgeGraph) {
          // no search results — finalize with fast verdict so card doesn't hang as pending
          const resolvedSpeaker = dominantSpeaker || (fastResult.speaker && !fastResult.speaker.match(/^Speaker\s*\d+$/i) ? fastResult.speaker : null);
          return { ...fastResult, sources: [], pending: false, lexical: lexicalSnapshot, speaker: resolvedSpeaker, dominantSpeakerId, _fastClaim: fastResult.claim };
        }

        const urls = searchData.organic.map(r => r.url);

        // build evidence block — answerBox first (highest quality), then knowledgeGraph, then organic
        const parts = [];
        if (searchData.answerBox?.answer) {
          parts.push(`[Direct Answer] ${searchData.answerBox.title ? searchData.answerBox.title + ': ' : ''}${searchData.answerBox.answer}${searchData.answerBox.url ? '\n' + searchData.answerBox.url : ''}`);
        }
        if (searchData.knowledgeGraph?.description) {
          parts.push(`[Knowledge Panel] ${searchData.knowledgeGraph.title ? searchData.knowledgeGraph.title + ': ' : ''}${searchData.knowledgeGraph.description}`);
        }
        searchData.organic.forEach((r, idx) => {
          const datePart = r.date ? ` (${r.date})` : '';
          parts.push(`[${idx+1}] ${r.title}${datePart}\n${r.url}\n${r.snippet}`);
        });
        const evidenceBlock = parts.join('\n\n');
        // Gate only the Sonnet call (Serper already resolved above) so grounded
        // calls can't starve the fast pass for connections.
        await acquireGrounded();
        let raw;
        try {
          raw = await callClaude(
            `${titleContext}Transcript: "${resolveDismissivePronouns(contextText, dominantSpeaker, opponentName)}"\n\nClaim: "${fastResult.claim}"\nFast verdict: ${fastResult.verdict}\n\nWeb search evidence:\n${evidenceBlock}${lexicalContext}`,
            GROUNDED_PROMPT,
            // Grounded pass runs on Sonnet with the re-judge prompt: independently
            // re-evaluates instead of deferring to the fast verdict. Benchmarking
            // showed this captures ~80% of a full-Sonnet accuracy gain while the
            // fast pass stays on Haiku (low live latency). Sonnet needs the larger
            // token budget and temperature omitted.
            { model: MODEL_SONNET, maxTokens: 4096, temperature: null }
          );
        } finally {
          releaseGrounded();
        }
        const parsed = parseArray(raw);
        const match  = parsed.find(r => r.claim && r.verdict);
        // drop UNVERIFIABLE from grounded pass — either it's checkable or it isn't shown
        if (!match) return null;
        if (match.verdict === 'UNVERIFIABLE') return null;

        // if grounded pass detected an inversion, drop the card entirely
        const explanationLower = (match.explanation || '').toLowerCase();
        const isInversion = explanationLower.includes('transcript shows') ||
                            explanationLower.includes('inverted') ||
                            explanationLower.includes('not herself') ||
                            explanationLower.includes('not himself') ||
                            explanationLower.includes('not harris') ||
                            explanationLower.includes('not trump');
        if (isInversion) {
          // tell overlay to remove the pending card
          if (activeTabId) {
            chrome.tabs.sendMessage(activeTabId, {
              type: 'DROP_VERDICT',
              claim: fastResult.claim,
              fastClaim: fastResult.claim,
            }).catch(() => {});
          }
          return null;
        }
        const resolvedSpeaker = dominantSpeaker
          || (fastResult.speaker && !fastResult.speaker.match(/^Speaker\s*\d+$/i) ? fastResult.speaker : null)
          || (match.speaker && !match.speaker.match(/^Speaker\s*\d+$/i) ? match.speaker : null);

        // Removed the never-downgrade guard: benchmarking against professional
        // fact-checkers (PolitiFact / AP / FactCheck.org / AFP) showed it drove a
        // strong softening bias — InTruth kept a TRUE/SUBSTANTIALLY TRUE fast
        // verdict even when web evidence contradicted it. Trusting the grounded
        // verdict raised verdict agreement (+8pt) and the share of problematic
        // claims flagged (+11pt) with NO increase in false-positive (harsh)
        // errors, and FALSE precision actually rose to ~93%.
        const finalVerdict = match.verdict;

        return { ...match, verdict: finalVerdict, sources: urls, pending: false, lexical: lexicalSnapshot, speaker: resolvedSpeaker, dominantSpeakerId, _fastClaim: fastResult.claim };
      } catch (err) {
        console.error('[grounded] error:', fastResult.claim.slice(0, 40), err);
        return null;
      }
    }));

    const valid = groundedAll.filter(Boolean);
    if (valid.length && activeTabId) {
      chrome.tabs.sendMessage(activeTabId, { type: 'UPDATE_VERDICTS', results: valid }).catch(() => {});
      console.log('[pipeline] grounded verdicts sent:', valid.length);
    }
  } catch (err) {
    console.error('[grounded] error:', err);
  }
}

// ── State ─────────────────────────────────────────────────────────────────────

let activeTabId = null;
let isCapturing = false;
let keepAliveInterval = null;

function startKeepAlive() {
  keepAliveInterval = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
}

function stopKeepAlive() {
  clearInterval(keepAliveInterval);
  keepAliveInterval = null;
}

// ── Messages ──────────────────────────────────────────────────────────────────

chrome.runtime.onConnect.addListener(() => console.log('[service-worker] woken by port connect'));

// notify overlay if service worker was killed and restarted mid-session
chrome.runtime.onStartup.addListener(() => {
  isCapturing = false;
  activeTabId = null;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    case 'START_FACTCHECK':
      startFactCheck()
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;

    case 'STOP_FACTCHECK':
      stopFactCheck();
      sendResponse({ ok: true });
      break;

    case 'TRANSCRIPT_RESULT':
      // always process transcript for pipeline — activeTabId only needed for forwarding to overlay
      if (msg.isFinal) {
        if (msg.speaker !== null && msg.speaker !== undefined) {
          currentSpeakerId = msg.speaker;
          if (activeTabId && !confirmedSpeakers.has(currentSpeakerId)) {
            chrome.tabs.sendMessage(activeTabId, {
              type:      'NEW_SPEAKER',
              speakerId: currentSpeakerId,
              sample:    msg.text.slice(0, 80),
            }).catch(() => {});
          }
        }
        onNewSentence(msg.text, currentSpeakerId);
      }
      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, {
          type: 'TRANSCRIPT_RESULT', text: msg.text, isFinal: msg.isFinal, interim: msg.interim,
        }).catch(() => {});
      }
      break;

    case 'SPEAKER_NAMES':
      if (msg.speakerIdToName) {
        Object.entries(msg.speakerIdToName).forEach(([id, name]) => {
          const numId = parseInt(id);
          // always update the name — chip edits must be able to override banner-confirmed names
          speakerIdToName[numId] = name;
          confirmedSpeakers.add(numId);
        });
        console.log('[service-worker] speaker map updated:', speakerIdToName);
      }
      break;

    case 'PAGE_TITLE':
      pageTitle = msg.title || '';
      pageDate  = msg.date  || '';
      console.log('[service-worker] page title:', pageTitle.slice(0, 60));
      console.log('[service-worker] page date:', pageDate);
      // speaker names passed to Claude as context — Claude resolves attribution
      break;

    case 'PIPELINE_ERROR':
      // forward from offscreen doc to overlay
      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, { type: 'PIPELINE_ERROR', message: msg.message }).catch(() => {});
      }
      // notify phone if it's a Deepgram failure
      if (msg.message && (msg.message.includes('disconnected') || msg.message.includes('failed') || msg.message.includes('code'))) {
        sendAlert('Deepgram error: ' + msg.message);
      }
      break;

    case 'REQUEST_NEW_STREAM':
      // offscreen doc lost its stream — get a fresh tabCapture stream ID
      if (activeTabId && isCapturing) {
        chrome.tabCapture.getMediaStreamId({ targetTabId: activeTabId }, (streamId) => {
          if (chrome.runtime.lastError) {
            console.error('[service-worker] failed to get new stream:', chrome.runtime.lastError.message);
            return;
          }
          chrome.runtime.sendMessage({ type: 'START_CAPTURE', streamId }).catch(() => {});
        });
      }
      break;

    case 'RESET_SPEAKERS':
      // chip was edited — clear confirmed state so banners re-fire with updated names
      confirmedSpeakers.clear();
      speakerIdToName = {};
      console.log('[service-worker] speaker confirmation reset');
      break;

    case 'GET_BIAS':
      fetch(`${BACKEND_URL}/api/bias?domain=${encodeURIComponent(msg.domain)}`)
        .then(r => r.json())
        .then(data => sendResponse(data))
        .catch(() => sendResponse(null));
      return true;

    case 'GET_STATUS':
      sendResponse({ isCapturing });
      break;
  }
});

// ── Start / stop ──────────────────────────────────────────────────────────────

async function startFactCheck() {
  if (isCapturing) return;

  await loadKeys();
  if (!ANTHROPIC_KEY) {
    throw new Error('Anthropic API key not set. Please enter it in the extension popup.');
  }
  // warm up Vercel serverless functions — prevents cold start on first transcript window
  fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
  }).catch(() => {}); // fire and forget — don't wait, don't care about response
  fetch(`${BACKEND_URL}/api/serper`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: 'warmup', num: 1 }),
  }).catch(() => {});

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab found.');
  activeTabId = tab.id;

  try {
    await ensureOffscreenDocument();
    console.log('[service-worker] offscreen document created');
  } catch (err) {
    console.error('[service-worker] offscreen creation failed:', err);
  }

  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: activeTabId }, id => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(id);
    });
  });

  const response = await chrome.runtime.sendMessage({ type: 'START_CAPTURE', streamId, language: TRANSCRIPT_LANGUAGE });
  if (!response?.ok) throw new Error('Failed to start capture: ' + response?.error);

  // reset BEFORE sending START_FACTCHECK — transcripts arrive immediately after
  isCapturing = true;
  resetWindow();
  recentClaims.clear();
  startKeepAlive();

  await chrome.tabs.sendMessage(activeTabId, { type: 'START_FACTCHECK' });
  console.log('[service-worker] started on tab', activeTabId);
}

function stopFactCheck() {
  resetWindow();
  recentClaims.clear();
  pageTitle = '';
  pageDate  = '';

  if (!isCapturing) return;

  chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' }).catch(() => {});
  chrome.offscreen.closeDocument().catch(() => {});
  if (activeTabId) chrome.tabs.sendMessage(activeTabId, { type: 'STOP_FACTCHECK' }).catch(() => {});

  activeTabId = null;
  isCapturing = false;
  stopKeepAlive();
  console.log('[service-worker] stopped');
}

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL('src/offscreen/offscreen.html'),
    reasons: ['USER_MEDIA'],
    justification: 'Capture tab audio for Deepgram transcription',
  });
}
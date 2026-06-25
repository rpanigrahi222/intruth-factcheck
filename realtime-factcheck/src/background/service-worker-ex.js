// service-worker.js
let ANTHROPIC_KEY = '';
const SERPER_KEY = '';
let TRANSCRIPT_LANGUAGE = 'en';

async function loadKeys() {
  return new Promise(resolve => {
    chrome.storage.local.get(['anthropicKey', 'transcriptLanguage'], (data) => {
      ANTHROPIC_KEY = data.anthropicKey || '';
      TRANSCRIPT_LANGUAGE = data.transcriptLanguage || 'en';
      resolve();
    });
  });
}

const EVALUATE_PROMPT = ``;


const GROUNDED_PROMPT = ``;


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
 
 
const BLOCKED_DOMAINS = [
  'reddit.com', 'facebook.com', 'twitter.com', 'x.com',
  'tiktok.com', 'instagram.com', 'pinterest.com', 'quora.com',
  'yelp.com', 'tripadvisor.com', 'youtube.com',
  'democrats.org', 'republicans.org', 'gop.com', 'dnc.org',
  'afscme.org', 'ntu.org', 'americanprogress.org', 'heritage.org',
  'breitbart.com', 'dailykos.com', 'mediamatters.org', 'newsmax.com',
  'thefederalist.com', 'motherjones.com', 'nationalreview.com',
  'democrats-appropriations.house.gov', 'waysandmeans.house.gov',
  'bostonkravmaga.com',
  'israelpolicyforum.org',
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
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_KEY },
      body: JSON.stringify({ q: query, num: 6, ...(LANGUAGE_LOCALE[TRANSCRIPT_LANGUAGE] || LANGUAGE_LOCALE.en) }),
    });
    const data = await res.json();
 
    const organic = (data.organic ?? [])
      .filter(r => r.link && !BLOCKED_DOMAINS.some(d => r.link.includes(d)))
      .slice(0, 3)
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
 
async function callClaude(userMessage, systemPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 768,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  const data = await res.json();
  if (data.error) {
    const msg = data.error.message || 'Unknown API error';
    console.error('[claude] API error:', msg);
    if (activeTabId) chrome.tabs.sendMessage(activeTabId, { type: 'PIPELINE_ERROR', message: msg }).catch(() => {});
    return '';
  }
  const raw = data.content?.[0]?.text?.trim() || '';
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
 
// Each entry: { text, speakerId, speakerName }
let sentenceWindow  = [];
let sentenceCount   = 0;
let windowLexical   = { rates: { hedging: 0, certainty: 0, filler: 0, emotional: 0, exclusive: 0, firstPersonSg: 0 }, wordsPerSecond: null, wordCount: 0, _sentenceCount: 0 };
let windowStartTime = null;
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
    await evaluateClaims(flushText, pageTitle, flushLexSummary, flushLexSnapshot, flushDominantSpeaker, flushDominantId);
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
 
  if (sentenceCount % WINDOW_SIZE === 0) {
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
      await evaluateClaims(contextText, pageTitle, lexicalSummary, lexicalSnapshot, dominantSpeaker, dominantSpeakerId);
    } catch (e) {
    }
  }
}
 
// ── Evaluation pipeline ───────────────────────────────────────────────────────
 
async function evaluateClaims(contextText, title, lexicalSummary, lexicalSnapshot, dominantSpeaker, dominantSpeakerId) {
  try {
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
      ? `\nLANGUAGE REQUIREMENT: You MUST write the "claim" and "explanation" fields in ${TRANSCRIPT_LANGUAGE}. This is mandatory regardless of what language your sources are in. Only the verdict values (TRUE, FALSE, etc) stay in English.`
      : '';
 
    const titleContext = title
      ? `Video: "${title}"${dateContext}${speakerLegend}\n\nEvaluate claims as they were made at the time of this recording. Do not apply knowledge of events after this date.${languageInstruction}\n\n`
      : languageInstruction ? `${languageInstruction}\n\n` : '';
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
    const raw     = await callClaude(
      `${titleContext}Transcript: "${contextText}"${alreadyChecked}${lexicalContext}`,
      EVALUATE_PROMPT
    );
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
      console.log('[pipeline] fast verdicts sent:', valid.length, '| speaker:', dominantSpeaker);
    }
 
    groundAndUpdate(contextText, valid, title, lexicalSummary, lexicalSnapshot, dominantSpeaker, dominantSpeakerId, claimSearchPromises);
 
  } catch (err) {
    console.error('[pipeline] error:', err);
  }
}
 
async function groundAndUpdate(contextText, fastResults, title, lexicalSummary, lexicalSnapshot, dominantSpeaker, dominantSpeakerId, claimSearchPromises = null) {
  try {
    const dateCtx      = pageDate ? `\nDate: ${pageDate}` : '';
    const languageInstruction = TRANSCRIPT_LANGUAGE && TRANSCRIPT_LANGUAGE !== 'en'
      ? `\nLANGUAGE REQUIREMENT: You MUST write the "claim" and "explanation" fields in ${TRANSCRIPT_LANGUAGE}. This is mandatory regardless of what language your sources are in. Only the verdict values (TRUE, FALSE, etc) stay in English.`
      : '';
 
    const titleContext = title
      ? `Video: "${title}"${dateCtx}\nEvaluate claims as they were made at the time of this recording. Web search results may include articles published after the debate date — ignore any information that was not publicly known at the time of the debate.${languageInstruction}\n\n`
      : languageInstruction ? `${languageInstruction}\n\n` : '';
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
        const raw = await callClaude(
          `${titleContext}Transcript: "${contextText}"\n\nClaim: "${fastResult.claim}"\nFast verdict: ${fastResult.verdict}\n\nWeb search evidence:\n${evidenceBlock}${lexicalContext}`,
          GROUNDED_PROMPT
        );
        const parsed = parseArray(raw);
        const match  = parsed.find(r => r.claim && r.verdict);
        // drop UNVERIFIABLE from grounded pass — either it's checkable or it isn't shown
        if (!match || match.verdict === 'UNVERIFIABLE') return null;
        const resolvedSpeaker = dominantSpeaker
          || (fastResult.speaker && !fastResult.speaker.match(/^Speaker\s*\d+$/i) ? fastResult.speaker : null)
          || (match.speaker && !match.speaker.match(/^Speaker\s*\d+$/i) ? match.speaker : null);
 
        // code-level protection: never downgrade TRUE/SUBSTANTIALLY TRUE to MISLEADING or FALSE
        // the grounded prompt repeatedly violates this rule by reasoning from snippets
        // fast pass has full training knowledge; grounded pass has 1-2 sentence snippets
        // only the grounded pass can upgrade verdicts or add SUBSTANTIALLY TRUE context
        const fastWasTrue = fastResult.verdict === 'TRUE' || fastResult.verdict === 'SUBSTANTIALLY TRUE';
        const groundedDowngrades = match.verdict === 'MISLEADING' || match.verdict === 'FALSE';
        const finalVerdict = (fastWasTrue && groundedDowngrades) ? fastResult.verdict : match.verdict;
 
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
          if (activeTabId && !confirmedSpeakers.has(currentSpeakerId) && !speakerIdToName[currentSpeakerId]) {
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
      // merge incoming confirmed entries — never overwrite already-confirmed IDs
      if (msg.speakerIdToName) {
        Object.entries(msg.speakerIdToName).forEach(([id, name]) => {
          const numId = parseInt(id);
          if (!confirmedSpeakers.has(numId)) {
            speakerIdToName[numId] = name;
            confirmedSpeakers.add(numId);
          }
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
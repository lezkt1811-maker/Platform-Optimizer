/* ==========================================================================
   Trend Oracle — app.js
   Fully client-side. Data lives in localStorage. OCR via Tesseract.js.
   AI enhancement is optional and only activates if a key is set in Settings.
   ========================================================================== */

/* ---------------------------------------------------------------------- */
/* Small helpers                                                          */
/* ---------------------------------------------------------------------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $all = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (str) => (str || '').toString()
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------------------------------------------------------------------- */
/* Storage layer                                                          */
/* ---------------------------------------------------------------------- */
const LS = {
  screenshots: 'trendOracle_screenshots',
  trends:      'trendOracle_trends',
  library:     'trendOracle_library',
  performance: 'trendOracle_performance',
  settings:    'trendOracle_settings',
  todayPick:   'trendOracle_todayPick'
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error('Storage read failed for', key, e);
    return fallback;
  }
}
function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('Storage write failed for', key, e);
    toast('Storage is full — try removing some screenshots.');
  }
}

/* Platform → available source types. TikTok is the first module; add more
   platforms by adding a key here plus, if needed, a branch in
   generateLocalPost() for platform-specific script/caption shape. */
const PLATFORM_SOURCE_TYPES = {
  'TikTok': ['Analytics', 'Search Insights', 'Trending Hashtags', 'Trending Sounds', 'Comments', 'Performance', 'Other'],
  'YouTube': ['Studio Analytics', 'Search Insights', 'Trending Topics', 'Comments', 'Performance', 'Other'],
  'Instagram': ['Insights/Analytics', 'Explore/Search', 'Trending Reel Audio', 'Hashtags', 'Comments', 'Performance', 'Other'],
  'Facebook': ['Page Insights', 'Trending Topics', 'Comments', 'Performance', 'Other'],
  'Pinterest': ['Pinterest Trends', 'Analytics', 'Search Insights', 'Comments', 'Other'],
  'Google Trends': ['Trending Searches', 'Related Queries', 'Other'],
  'Reddit': ['Trending Posts', 'Comments', 'Search', 'Other'],
  'Website Analytics': ['Google Analytics', 'Search Console', 'Other']
};
function sourceTypesFor(platform) { return PLATFORM_SOURCE_TYPES[platform] || ['Other']; }

const DEFAULT_NICHE = [
  '13-sign astrology', 'Ophiuchus', 'true sky astrology', 'StarChart13.com',
  'hidden zodiac truth', 'Lilith and Eve', 'spiritual rebellion',
  'ancient feminine wisdom', 'astrology myth-busting', 'TikTok education content'
];

function getSettings() {
  return loadJSON(LS.settings, {
    niche: DEFAULT_NICHE.slice(),
    website: 'StarChart13.com',
    apiKey: ''
  });
}
function saveSettings(s) { saveJSON(LS.settings, s); }

function getScreenshots() { return loadJSON(LS.screenshots, []); }
function saveScreenshots(v) { saveJSON(LS.screenshots, v); }

function getTrends() { return loadJSON(LS.trends, []); }
function saveTrends(v) { saveJSON(LS.trends, v); }

function getLibrary() { return loadJSON(LS.library, []); }
function saveLibrary(v) { saveJSON(LS.library, v); }

function getPerformance() { return loadJSON(LS.performance, []); }
function savePerformance(v) { saveJSON(LS.performance, v); }

/* ---------------------------------------------------------------------- */
/* Text analysis                                                          */
/* ---------------------------------------------------------------------- */
/* Words that show up constantly in TikTok/social UI chrome (nav labels,
   button text, app furniture) but are never the actual trend. These get
   filtered out before anything is treated as a "topic." */
const UI_CHROME_WORDS = new Set(('tiktok com www http https home for you following live inbox profile ' +
  'search discover notifications message messages share shares comment comments like likes save saves ' +
  'follow followers follow all sound sounds original video videos view views more see less edit ' +
  'settings menu back next play pause mute unmute duet stitch remix upload post posts caption ' +
  'analytics insights overview content search insights trending creator tools').split(' '));

function isJunkToken(word) {
  if (/^\d+$/.test(word)) return true;               // pure numbers ("1000", "126")
  if (/^\d+[km]$/.test(word)) return true;            // "1000k" style noise
  if (UI_CHROME_WORDS.has(word)) return true;
  if (word.length <= 2) return true;
  return false;
}

const STOPWORDS = new Set(('the a an and or but if of to in on for with is are was were be been ' +
  'this that these those it its as at by from your you i we they he she them his her our ' +
  'have has had do does did not no yes so than then there here up down out about into over ' +
  'under again more most other some such only own same can will just don should now').split(' '));

const EMOTIONAL_WORDS = ['secret', 'hidden', 'truth', 'exposed', 'banned', 'lied', 'lies',
  'forbidden', 'real', 'shocking', 'ancient', 'awakening', 'rebellion', 'myth', 'wrong',
  'actually', 'proof', 'warning', 'ritual', 'curse', 'power', 'forgotten', 'erased',
  'nobody', 'why', 'never', 'always', 'stop', 'wake up'];

const CONTROVERSY_WORDS = ['controversial', 'debate', 'myth', 'wrong', 'lied', 'fake',
  'cover-up', 'suppressed', 'patriarchy', 'erased', 'gatekept', 'censored'];

/* A small taxonomy so the app can connect a trend to *why* it's trending
   and *what emotion* drives it, instead of just repeating the search term.
   Local/offline mode uses this; AI mode is asked to reason about the same
   things directly. */
const THEME_TAXONOMY = [
  { theme: 'Myth-busting / hidden truth', words: ['secret', 'hidden', 'truth', 'lied', 'lies', 'myth', 'wrong', 'fake', 'exposed', 'nobody tells you'],
    driver: 'people feel like they were taught something incomplete or false, and want the real version' },
  { theme: 'Search intent / direct question', words: ['how', 'why', 'what', 'when', 'does', 'is', 'meaning', 'explained'],
    driver: 'people are actively searching for a direct answer, not just browsing' },
  { theme: 'Relationship / connection', words: ['relationship', 'dating', 'love', 'breakup', 'partner', 'marriage', 'ex', 'crush', 'compatibility'],
    driver: 'people are trying to make sense of a relationship dynamic in their own life' },
  { theme: 'Identity / self-discovery', words: ['who am i', 'identity', 'personality', 'sign', 'placement', 'chart', 'self', 'authentic'],
    driver: 'people are looking for language that explains who they are' },
  { theme: 'Controversy / debate', words: ['debate', 'controversial', 'wrong', 'banned', 'cancel', 'backlash', 'argument'],
    driver: 'people are drawn to picking a side or seeing a belief challenged' },
  { theme: 'Spiritual awakening', words: ['awakening', 'spiritual', 'energy', 'ritual', 'manifest', 'universe', 'sign from', 'intuition'],
    driver: 'people are processing a shift in how they see their own life or path' },
  { theme: 'Life advice / how-to', words: ['tips', 'advice', 'guide', 'how to', 'steps', 'should i'],
    driver: 'people want a practical, actionable answer they can use today' },
];

function inferTheme(text) {
  const lower = text.toLowerCase();
  let best = null, bestScore = 0;
  for (const entry of THEME_TAXONOMY) {
    const score = entry.words.reduce((s, w) => s + (lower.includes(w) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = entry; }
  }
  return bestScore > 0 ? best : null;
}

function extractHashtags(text) {
  const matches = text.match(/#[a-z0-9_]{2,}/gi) || [];
  return [...new Set(matches.map(h => h.toLowerCase()))];
}

function extractMetrics(text) {
  const metrics = {};
  const metricRe = /([\d][\d,.]*)\s*(k|m|b)?\+?\s*(views|view|likes|like|comments|comment|shares|share|saves|save|followers|follower)/gi;
  let m;
  while ((m = metricRe.exec(text)) !== null) {
    const num = m[1];
    const suffix = (m[2] || '').toUpperCase();
    const label = m[3].toLowerCase().replace(/s$/, '') + 's';
    metrics[label] = num + suffix;
  }
  const percentRe = /(\d+(\.\d+)?)\s?%/g;
  const percents = [];
  while ((m = percentRe.exec(text)) !== null) percents.push(m[1] + '%');
  if (percents.length) metrics.percentages = percents.join(', ');
  return metrics;
}

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9']{3,}/g) || [])
    .filter(w => !STOPWORDS.has(w) && !isJunkToken(w));
}

function topKeywords(text, count = 8) {
  const freq = {};
  tokenize(text).forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([w]) => w);
}

function countMatches(text, words) {
  const lower = text.toLowerCase();
  return words.reduce((sum, w) => sum + (lower.split(w.toLowerCase()).length - 1), 0);
}

function nicheMatchCount(text) {
  const niche = getSettings().niche;
  return countMatches(text, niche);
}

/* A hashtag, or a clean multi-word hashtag, or at least 2 real keywords
   after junk-filtering counts as "enough signal." Anything less means we'd
   be naming the trend after noise, so we flag it instead of guessing. */
function assessSignal(text, hashtags, keywords) {
  if (hashtags.length) return 'clear';
  if (keywords.length >= 2) return 'clear';
  if (keywords.length === 1) return 'weak';
  return 'unclear';
}

function deriveTrendName(text, hashtags, keywords, signal) {
  if (signal === 'unclear') return 'Unclear trend — needs more context';
  if (hashtags.length) return hashtags[0].replace('#', '').replace(/_/g, ' ');
  if (keywords.length) return keywords.join(' ').replace(/\b\w/g, c => c.toUpperCase());
  const firstLine = text.split('\n').map(l => l.trim()).find(l => l.length > 3 && !isJunkToken(l.toLowerCase()));
  return firstLine ? firstLine.slice(0, 40) : 'Unclear trend — needs more context';
}

function classifyCategory(text, sourceType) {
  const lower = text.toLowerCase();
  if (/#\w+/.test(text) && /hashtag/i.test(sourceType || '')) return 'Hashtag';
  if (/sound|audio|remix|original sound/.test(lower) || /sound|audio/i.test(sourceType || '')) return 'Sound';
  if (/search|people also search|autocomplete|related queries|trending search/.test(lower) || /search/i.test(sourceType || '')) return 'Search Term';
  if (/comment|reply|replies/.test(lower) || /comment/i.test(sourceType || '')) return 'Audience Question';
  if (/view|like|share|save|analytics|engagement/.test(lower) || /analytics|insight/i.test(sourceType || '')) return 'Performance Pattern';
  return 'General Topic';
}

/* ---------------------------------------------------------------------- */
/* Scoring                                                                */
/* ---------------------------------------------------------------------- */
function clamp(n, min = 0, max = 100) { return Math.max(min, Math.min(max, n)); }

function computeScores(entry, allTrends) {
  const text = (entry.rawText || '') + ' ' + (entry.trendName || '');
  const niche = nicheMatchCount(text);
  const emotional = countMatches(text, EMOTIONAL_WORDS);
  const controversy = countMatches(text, CONTROVERSY_WORDS);
  const hasQuestion = /\?/.test(text) ? 1 : 0;
  const website = getSettings().website || 'StarChart13.com';
  const websiteMentions = countMatches(text, [website.replace(/https?:\/\//, ''), 'astrology', 'zodiac', 'birth chart', 'starchart']);

  const sameNameCount = allTrends.filter(t => t.trendName === entry.trendName).length;
  const uniqueness = clamp(100 - (sameNameCount - 1) * 20, 10, 100);

  const metricCount = Object.keys(entry.metrics || {}).length;
  const recencyBoost = 10; // freshly extracted trends get a small lift

  const isSearchSource = /search/i.test(entry.sourceType || '');
  const isTrendingSource = /trending|hashtag|sound|reel audio/i.test(entry.sourceType || '');
  const audienceMatch = clamp(niche * 18 + (isSearchSource ? 10 : 0) + 20);
  const trendStrength = clamp(metricCount * 14 + recencyBoost + (isTrendingSource ? 15 : 0) + Math.min(sameNameCount, 3) * 8);
  const hookStrength = clamp(emotional * 12 + controversy * 8 + hasQuestion * 12 + 15);
  const websiteConversion = clamp(websiteMentions * 20 + niche * 8 + 10);
  const clarity = clamp(100 - Math.abs(40 - Math.min(text.length, 80)) , 30, 100);

  const viralPotential = clamp(Math.round(
    audienceMatch * 0.22 +
    hookStrength * 0.26 +
    trendStrength * 0.24 +
    websiteConversion * 0.12 +
    uniqueness * 0.08 +
    clarity * 0.08
  ));

  return {
    viralPotential,
    audienceMatch: Math.round(audienceMatch),
    trendStrength: Math.round(trendStrength),
    hookStrength: Math.round(hookStrength),
    websiteConversion: Math.round(websiteConversion),
    uniqueness: Math.round(uniqueness)
  };
}

/* ---------------------------------------------------------------------- */
/* Screenshot upload + OCR                                                */
/* ---------------------------------------------------------------------- */
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleFiles(fileList) {
  const files = Array.from(fileList).filter(f => /image\/(png|jpeg|jpg|webp)/.test(f.type));
  if (!files.length) { toast('Please choose PNG, JPG, JPEG, or WEBP images.'); return; }

  const platform = $('#uploadPlatform').value;
  const sourceType = $('#uploadSourceType').value;
  const topic = $('#uploadTopic').value.trim();
  const batchId = uid();
  const screenshots = getScreenshots();
  const newOnes = [];

  for (const file of files) {
    const dataUrl = await fileToDataURL(file);
    const shot = {
      id: uid(),
      name: file.name,
      dataUrl,
      platform,
      sourceType,
      topic,
      batchId,
      dateAdded: new Date().toISOString(),
      ocrText: '',
      ocrStatus: 'pending'
    };
    newOnes.push(shot);
  }
  saveScreenshots([...newOnes, ...screenshots]);
  renderGallery();
  renderDashboardStats();

  const progressWrap = $('#ocrProgress');
  progressWrap.classList.remove('hidden');
  for (let i = 0; i < newOnes.length; i++) {
    $('#ocrProgressText').textContent = `Reading screenshot ${i + 1} of ${newOnes.length}…`;
    await runOCR(newOnes[i].id, (pct) => {
      $('#ocrBarFill').style.width = Math.round(((i + pct) / newOnes.length) * 100) + '%';
    });
  }
  progressWrap.classList.add('hidden');
  $('#ocrBarFill').style.width = '0%';
  toast('Screenshots read and trends charted ✦');
  renderGallery();
  renderTrends();
  renderDashboard();
  populateGenerateSelect();
}

async function runOCR(screenshotId, onProgress) {
  const screenshots = getScreenshots();
  const shot = screenshots.find(s => s.id === screenshotId);
  if (!shot) return;
  try {
    const result = await Tesseract.recognize(shot.dataUrl, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text' && onProgress) onProgress(m.progress);
      }
    });
    shot.ocrText = result.data.text || '';
    shot.ocrStatus = 'done';
  } catch (err) {
    console.error('OCR failed', err);
    shot.ocrText = '';
    shot.ocrStatus = 'error';
  }
  const list = getScreenshots().map(s => s.id === shot.id ? shot : s);
  saveScreenshots(list);
  analyzeScreenshot(shot);
}

function analyzeScreenshot(shot) {
  if (!shot.ocrText || !shot.ocrText.trim()) return;
  const text = shot.ocrText;
  const hashtags = extractHashtags(text);
  const metrics = extractMetrics(text);
  const keywords = topKeywords(text, 8);
  const nameKeywords = topKeywords(text, 3);
  const signal = assessSignal(text, hashtags, nameKeywords);
  const category = classifyCategory(text, shot.sourceType);
  const trendName = deriveTrendName(text, hashtags, nameKeywords, signal);
  const theme = signal === 'unclear' ? null : inferTheme(text);

  const trends = getTrends();
  const entry = {
    id: uid(),
    trendName,
    sourceScreenshot: shot.name,
    sourceScreenshotId: shot.id,
    platform: shot.platform || 'TikTok',
    sourceType: shot.sourceType || 'Other',
    topic: shot.topic || '',
    dateAdded: new Date().toISOString(),
    extractedKeywords: keywords,
    hashtags,
    metrics,
    topicCategory: category,
    theme: theme ? theme.theme : null,
    themeDriver: theme ? theme.driver : null,
    needsContext: signal !== 'clear',
    signal,
    notes: '',
    rawText: text.slice(0, 800)
  };
  const scores = computeScores(entry, trends);
  entry.scores = scores;
  entry.creatorRelevanceScore = scores.audienceMatch;
  entry.viralPotentialScore = scores.viralPotential;

  trends.unshift(entry);
  saveTrends(trends);
}

/* ---------------------------------------------------------------------- */
/* Rendering: Gallery                                                     */
/* ---------------------------------------------------------------------- */
function renderGallery() {
  const shots = getScreenshots();
  $('#galleryCount').textContent = shots.length;
  const gallery = $('#gallery');
  if (!shots.length) {
    gallery.innerHTML = '<p class="empty-state">No screenshots yet. Upload your first batch above.</p>';
    return;
  }
  gallery.innerHTML = shots.map(s => `
    <div class="gallery-item" data-id="${s.id}">
      <span class="gallery-status ${s.ocrStatus === 'done' ? 'done' : 'pending'}"></span>
      <img src="${s.dataUrl}" alt="${esc(s.name)}">
      <span class="gallery-tag">${esc(s.platform)} · ${esc(s.sourceType)}</span>
      <button class="gallery-delete" data-id="${s.id}" aria-label="Delete screenshot">✕</button>
    </div>
  `).join('');
}

function deleteScreenshot(id) {
  saveScreenshots(getScreenshots().filter(s => s.id !== id));
  renderGallery();
  renderDashboardStats();
}

/* ---------------------------------------------------------------------- */
/* Rendering: score orbs                                                  */
/* ---------------------------------------------------------------------- */
function orbColor(value) {
  if (value >= 70) return '#4be3a0';
  if (value >= 45) return '#e8c35c';
  return '#ff5f7e';
}
function orbSVG(value, size = 56) {
  const r = (size / 2) - 5;
  const c = 2 * Math.PI * r;
  const offset = c - (clamp(value) / 100) * c;
  const color = orbColor(value);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="color:${color}">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="5"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="currentColor" stroke-width="5"
      stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
  </svg>`;
}
function orbHTML(value, label) {
  return `<div class="orb">
    ${orbSVG(value)}
    <span class="orb-value" style="color:${orbColor(value)}">${value}</span>
    <span class="orb-label">${esc(label)}</span>
  </div>`;
}
function scoreOrbRow(scores) {
  return `<div class="orb-row">
    ${orbHTML(scores.viralPotential, 'Viral Potential')}
    ${orbHTML(scores.audienceMatch, 'Audience Match')}
    ${orbHTML(scores.trendStrength, 'Trend Strength')}
    ${orbHTML(scores.hookStrength, 'Hook Strength')}
    ${orbHTML(scores.websiteConversion, 'Website Conversion')}
  </div>`;
}
function scorePill(value) {
  const cls = value >= 70 ? 'high' : value >= 45 ? 'mid' : 'low';
  return `<span class="score-pill ${cls}">${value}</span>`;
}

/* ---------------------------------------------------------------------- */
/* Rendering: Trend list / cards                                         */
/* ---------------------------------------------------------------------- */
function trendCardHTML(t) {
  const tags = [...t.hashtags.slice(0, 3).map(h => `<span class="tag">${esc(h)}</span>`),
    `<span class="tag gold">${esc(t.topicCategory)}</span>`,
    `<span class="tag purple">${esc(t.platform)} · ${esc(t.sourceType)}</span>`,
    t.theme ? `<span class="tag">${esc(t.theme)}</span>` : ''].join('');
  return `<div class="trend-card" data-id="${t.id}">
    <div class="trend-card-top">
      <div>
        <div class="trend-name">${esc(t.trendName)}${t.needsContext ? ' <span class="score-pill low" style="margin-left:6px">needs context</span>' : ''}</div>
        <div class="trend-meta">${new Date(t.dateAdded).toLocaleDateString()} · from ${esc(t.sourceScreenshot)}</div>
      </div>
      ${scorePill(t.viralPotentialScore)}
    </div>
    <div class="trend-tags">${tags}</div>
  </div>`;
}

function populateTrendSourceTypeFilter() {
  const sel = $('#trendSourceTypeFilter');
  const platformFilter = $('#trendPlatformFilter')?.value || 'all';
  const trends = getTrends();
  const pool = platformFilter === 'all' ? trends : trends.filter(t => t.platform === platformFilter);
  const types = [...new Set(pool.map(t => t.sourceType).filter(Boolean))].sort();
  const current = sel.value;
  sel.innerHTML = '<option value="all">All source types</option>' +
    types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  if (types.includes(current)) sel.value = current;
}

function renderTrends() {
  const trends = getTrends();
  const search = ($('#trendSearch')?.value || '').toLowerCase();
  const platformFilter = $('#trendPlatformFilter')?.value || 'all';
  populateTrendSourceTypeFilter();
  const sourceTypeFilter = $('#trendSourceTypeFilter')?.value || 'all';
  const filtered = trends.filter(t => {
    const matchesPlatform = platformFilter === 'all' || t.platform === platformFilter;
    const matchesSourceType = sourceTypeFilter === 'all' || t.sourceType === sourceTypeFilter;
    const haystack = (t.trendName + ' ' + t.extractedKeywords.join(' ') + ' ' + t.hashtags.join(' ')).toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    return matchesPlatform && matchesSourceType && matchesSearch;
  }).sort((a, b) => b.viralPotentialScore - a.viralPotentialScore);

  $('#trendsFull').innerHTML = filtered.map(trendCardHTML).join('');
  $('#trendsEmpty').classList.toggle('hidden', trends.length > 0);

  $all('.trend-card', $('#trendsFull')).forEach(card => {
    card.addEventListener('click', () => openTrendDetail(card.dataset.id));
  });
}

/* Re-run the meaning-layer analysis after the user adds context (notes).
   This is what lets a screenshot that started as "needs context" become
   usable without re-uploading — the notes count as real signal. */
function refreshTrendFromText(trendId) {
  const trends = getTrends();
  const t = trends.find(x => x.id === trendId);
  if (!t) return;
  const combinedText = (t.rawText || '') + ' ' + (t.notes || '');
  const hashtags = t.hashtags.length ? t.hashtags : extractHashtags(combinedText);
  const keywords = topKeywords(combinedText, 8);
  const nameKeywords = topKeywords(combinedText, 3);
  const signal = assessSignal(combinedText, hashtags, nameKeywords);
  const theme = signal === 'unclear' ? null : inferTheme(combinedText);
  const wasUnclear = t.needsContext;
  const updated = {
    ...t,
    extractedKeywords: keywords,
    signal,
    needsContext: signal !== 'clear',
    theme: theme ? theme.theme : t.theme,
    themeDriver: theme ? theme.driver : t.themeDriver,
    trendName: wasUnclear ? deriveTrendName(combinedText, hashtags, nameKeywords, signal) : t.trendName
  };
  updated.scores = computeScores(updated, trends.filter(x => x.id !== trendId));
  updated.creatorRelevanceScore = updated.scores.audienceMatch;
  updated.viralPotentialScore = updated.scores.viralPotential;
  saveTrends(trends.map(x => x.id === trendId ? updated : x));
  return updated;
}

function openTrendDetail(id) {
  const t = getTrends().find(x => x.id === id);
  if (!t) return;
  const html = `
    <button class="modal-close" id="closeTrendModal">✕</button>
    <p class="eyebrow">${esc(t.topicCategory)} · ${esc(t.platform)} · ${esc(t.sourceType)}</p>
    <h2>${esc(t.trendName)}</h2>
    <p class="muted small">Charted ${new Date(t.dateAdded).toLocaleString()} from ${esc(t.sourceScreenshot)}</p>
    ${t.needsContext
      ? `<div class="warning-banner">⚠ Not enough signal to know what this trend actually means — the extracted text was mostly numbers or app UI text (view counts, "TikTok," etc.), not a real topic. Add a note below describing what this screenshot was actually about, and the Oracle will re-read it instead of guessing.</div>`
      : t.theme
        ? `<div class="post-block"><div class="post-block-label">What this is really about</div>
           <div class="post-block-body">${esc(t.theme)} — ${esc(t.themeDriver)}.</div></div>`
        : ''}
    ${scoreOrbRow(t.scores)}
    <div class="post-block">
      <div class="post-block-label">Keywords</div>
      <div class="trend-tags">${t.extractedKeywords.map(k => `<span class="tag">${esc(k)}</span>`).join('')}</div>
    </div>
    ${t.hashtags.length ? `<div class="post-block"><div class="post-block-label">Hashtags seen</div>
      <div class="trend-tags">${t.hashtags.map(h => `<span class="tag purple">${esc(h)}</span>`).join('')}</div></div>` : ''}
    ${Object.keys(t.metrics).length ? `<div class="post-block"><div class="post-block-label">Metrics read</div>
      <div class="post-block-body">${Object.entries(t.metrics).map(([k,v]) => `${k}: ${v}`).join('\n')}</div></div>` : ''}
    <div class="post-block">
      <div class="post-block-label">${t.needsContext ? 'Add context so the Oracle understands this' : 'Notes'}</div>
      <textarea class="textarea" id="trendNotesInput" rows="3" placeholder="${t.needsContext ? 'e.g. \'This was a Search Insights screen — people were searching about compatibility with an ex\'' : 'Add your own notes…'}">${esc(t.notes)}</textarea>
    </div>
    <button class="btn btn-primary" id="saveTrendNotes">${t.needsContext ? 'Save & re-read this trend' : 'Save notes'}</button>
    <button class="btn btn-secondary" id="generateFromTrend" ${t.needsContext ? 'disabled title="Add context first"' : ''}>Generate post from this ✎</button>
  `;
  $('#trendModalContent').innerHTML = html;
  $('#trendModal').classList.remove('hidden');
  $('#closeTrendModal').addEventListener('click', () => $('#trendModal').classList.add('hidden'));
  $('#saveTrendNotes').addEventListener('click', () => {
    const trends = getTrends().map(x => x.id === id ? { ...x, notes: $('#trendNotesInput').value } : x);
    saveTrends(trends);
    const updated = refreshTrendFromText(id);
    toast(updated && !updated.needsContext ? 'Notes saved — trend re-read ✦' : 'Notes saved');
    renderTrends();
    renderDashboard();
    openTrendDetail(id);
  });
  $('#generateFromTrend').addEventListener('click', () => {
    if (t.needsContext) return;
    $('#trendModal').classList.add('hidden');
    showView('generate');
    populateGenerateSelect();
    $('#generateTrendSelect').value = id;
  });
}

/* ---------------------------------------------------------------------- */
/* Post generation — local templates                                     */
/* ---------------------------------------------------------------------- */
const HOOK_OPENERS = [
  "Nobody taught you this in astrology school:",
  "Your zodiac app has been lying to you about",
  "The 13th sign they don't want you to know about:",
  "This is the hidden truth behind",
  "Ophiuchus energy is showing up everywhere right now —",
  "The ancient feminine wisdom your horoscope skipped:",
];

function pick(arr, seed) {
  const idx = Math.abs(seed) % arr.length;
  return arr[idx];
}
function seedFromString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}

const HASHTAG_POOL = ['#astrology', '#ophiuchus', '#13thsign', '#truesky', '#astrologytok',
  '#zodiactruth', '#lilith', '#spiritualawakening', '#hiddenknowledge', '#astrologyeducation'];

function buildHashtags(trend, count = 6) {
  const extraTags = trend.hashtags.slice(0, 3).map(h => h.replace('#', ''));
  return [...new Set([...HASHTAG_POOL.slice(0, count), ...extraTags.map(t => '#' + t)])].slice(0, 8).join(' ');
}

/* Short-form video platforms (TikTok, YouTube Shorts, Instagram Reels,
   Facebook Reels) all use the same hook → myth → reveal → CTA script shape.
   TikTok is the original/reference module; other video platforms reuse it
   with platform-appropriate labels and CTA phrasing. */
function buildVideoPost(trend, hook, website, platformLabel) {
  const title = `${trend.trendName} — the true sky version nobody explains`;
  const setup = trend.theme
    ? `Set up why this resonates: ${trend.themeDriver}.`
    : `Set up the myth: what most people believe about ${trend.trendName.toLowerCase()}.`;
  const caption = `${title}\n\nMost horoscopes are working off a chart that's centuries out of date. Here's what the true sky actually shows about ${trend.trendName.toLowerCase()}, and why 13-sign astrology changes the read. Full birth chart breakdowns at ${website}.`;
  const hashtags = buildHashtags(trend);

  const script30 =
`[0-2s] HOOK (on screen + spoken): "${hook}"
[2-10s] ${setup}
[10-20s] Reveal: the true-sky / 13-sign explanation, tie it to Ophiuchus or Lilith where relevant.
[20-27s] One concrete "check your own chart" tip viewers can act on immediately.
[27-30s] CTA: "Get your real chart at ${website}." + on-screen text: ${website}`;

  const script60 =
`[0-3s] HOOK: "${hook}"
[3-12s] ${setup}
[12-25s] Introduce the 13-sign / true sky counter-argument. Bring in Ophiuchus and the idea of "hidden zodiac truth."
[25-38s] Go deeper: connect it to spiritual rebellion / ancient feminine wisdom (Lilith and Eve framing) — why this knowledge was left out.
[38-50s] Practical takeaway: how to figure out where this shows up in their own chart.
[50-57s] Recap the core reveal in one sentence for anyone who skipped ahead.
[57-60s] CTA: "Full breakdown and your true chart at ${website}." (mention ${platformLabel} where relevant, e.g. link in bio/description).`;

  const pinnedComment = `If your placement felt "off" your whole life — that's usually why 👀 full chart at ${website}`;
  const thumbnailText = `THE ${trend.trendName.toUpperCase()} NOBODY EXPLAINS`;
  const cta = `Get your true 13-sign chart free at ${website}`;

  return { title, hook, caption, hashtags, script30, script60, pinnedComment, thumbnailText, cta };
}

/* Text/board-first platforms (Pinterest, Reddit, Google Trends research,
   Website Analytics) don't use a 30/60s video script — they use a written
   structure instead, but keep the same field names so Library & Performance
   stay platform-agnostic. */
function buildTextPost(trend, hook, website, opts) {
  const title = opts.title(trend);
  const caption = opts.body(trend, website);
  const hashtags = opts.hashtags ? buildHashtags(trend, 4) : '';
  const structure = opts.structure(trend, website);
  const pinnedComment = opts.pinnedComment(trend, website);
  const thumbnailText = opts.thumbnailText(trend);
  const cta = `Learn more at ${website}`;
  return { title, hook, caption, hashtags, script30: structure, script60: structure, pinnedComment, thumbnailText, cta };
}

/* This is the fix for the core bug: instead of splicing the raw trend name
   into a fixed sentence ("...lying to you about 1000 Com TikTok"), build the
   hook from *why the trend is happening* (theme + driver) when we know it,
   and only fall back to naming the topic directly when it's a clean,
   real phrase (a hashtag or genuine keyword phrase) with no theme match. */
function buildMeaningfulHook(trend) {
  const seed = seedFromString(trend.id);
  if (trend.theme && trend.themeDriver) {
    return `This trend is really about ${trend.themeDriver}. Here's how that same pattern shows up in astrology — starting with ${trend.trendName.toLowerCase()}.`;
  }
  return `${pick(HOOK_OPENERS, seed)} ${trend.trendName}.`;
}

function buildInsufficientContextPost(trend) {
  return {
    insufficientContext: true,
    title: trend.trendName,
    message: `The text pulled from this screenshot didn't have enough real signal to know what "${trend.trendName}" is actually about — it looked like counters, usernames, or app UI rather than a topic. Rather than guess and hand you a hollow script, add a sentence of context (what screen was this, what was it actually showing?) on the trend's detail page, or upload a clearer screenshot of the same trend.`
  };
}

function generateLocalPost(trend) {
  if (trend.needsContext) return buildInsufficientContextPost(trend);

  const website = getSettings().website || 'StarChart13.com';
  const hook = buildMeaningfulHook(trend);
  const platform = trend.platform || 'TikTok';

  switch (platform) {
    case 'TikTok':
      return buildVideoPost(trend, hook, website, 'TikTok caption');
    case 'YouTube':
      return buildVideoPost(trend, hook, website, 'YouTube description');
    case 'Instagram':
      return buildVideoPost(trend, hook, website, 'Instagram Reel caption');
    case 'Facebook':
      return buildVideoPost(trend, hook, website, 'Facebook post text');

    case 'Pinterest':
      return buildTextPost(trend, hook, website, {
        title: (t) => `${t.trendName}: The True Sky Explanation`,
        body: (t, w) => `${hook}\n\nSave this if you've ever felt your "sign" didn't quite fit — 13-sign astrology explains why. Full breakdown at ${w}.`,
        structure: (t, w) => `Pin graphic text: bold hook line at top ("${hook}")\nPin description: 2-3 sentences on ${t.trendName.toLowerCase()}, keyword-rich for Pinterest search.\nBoard suggestion: "True Sky Astrology" or "Hidden Zodiac Truths"\nLink: ${w}`,
        pinnedComment: (t, w) => `Comment reply idea: "Yes! This is exactly why 13-sign astrology explains it better — more at ${w}"`,
        thumbnailText: (t) => `${t.trendName.toUpperCase()}: THE TRUE SKY VERSION`,
        hashtags: true
      });

    case 'Reddit':
      return buildTextPost(trend, hook, website, {
        title: (t) => `${hook.replace(/\.$/, '')} (${t.trendName})`,
        body: (t, w) => `${hook}\n\nMost astrology apps use a 12-sign chart drawn up centuries ago. Here's what changes once you factor in Ophiuchus and read the true sky for "${t.trendName.toLowerCase()}." Happy to go deeper in the comments — I also write these up at ${w}.`,
        structure: (t, w) => `Post title: direct and curiosity-driven, no clickbait caps.\nBody: 3 short paragraphs — the common belief, the true-sky correction, one practical takeaway.\nEngage in comments rather than hard-selling ${w}; link only if asked or in profile.`,
        pinnedComment: (t, w) => `Top comment reply draft: cite the specific placement/degree logic, keep it factual, mention ${w} only if someone asks for a chart.`,
        thumbnailText: (t) => '',
        hashtags: false
      });

    case 'Google Trends':
      return buildTextPost(trend, hook, website, {
        title: (t) => `${t.trendName}: What People Are Actually Searching For`,
        body: (t, w) => `Search interest is rising around "${t.trendName.toLowerCase()}." This is a strong candidate for a blog post or video that directly answers the query, with a link to ${w} for the full chart tool.`,
        structure: (t, w) => `Content brief:\nH1: answer the exact search phrase\nSection 1: what most sources say (12-sign view)\nSection 2: the true-sky / 13-sign correction\nSection 3: how readers can check their own chart at ${w}\nInclude the phrase "${t.trendName}" naturally 3-5 times for SEO.`,
        pinnedComment: (t, w) => `Not applicable for this source type.`,
        thumbnailText: (t) => `${t.trendName.toUpperCase()}`,
        hashtags: false
      });

    case 'Website Analytics':
      return buildTextPost(trend, hook, website, {
        title: (t) => `Double Down On: ${t.trendName}`,
        body: (t, w) => `Your site data shows activity around "${t.trendName.toLowerCase()}." Consider a dedicated landing section or blog post on ${w} that captures this traffic, plus a matching social clip pointing back to it.`,
        structure: (t, w) => `Content brief:\nExpand the existing page/post about "${t.trendName}" on ${w} with a clearer CTA.\nCreate one short video summarizing it to drive traffic back to that exact page.\nAdd an email capture near this content — it's already proven to attract visits.`,
        pinnedComment: (t, w) => `Not applicable for this source type.`,
        thumbnailText: (t) => `${t.trendName.toUpperCase()}`,
        hashtags: false
      });

    default:
      return buildVideoPost(trend, hook, website, 'caption');
  }
}

async function generateAIPost(trend) {
  const settings = getSettings();
  if (!settings.apiKey) throw new Error('No API key set');

  const website = settings.website || 'StarChart13.com';
  const niche = settings.niche.join(', ');
  const platform = trend.platform || 'TikTok';
  const prompt = `You are a ${platform} content strategist for a creator in this niche: ${niche}. Their website is ${website}.

Trend data extracted via OCR from a ${platform} ${trend.sourceType || 'analytics'} screenshot — OCR text can be noisy (view counts, usernames, app UI chrome mixed in with the real topic):
- Trend name (best guess after cleanup): ${trend.trendName}
- Category: ${trend.topicCategory}
- Detected theme (if any): ${trend.theme || 'none detected'}${trend.themeDriver ? ' — likely driver: ' + trend.themeDriver : ''}
- Platform: ${platform}
- Source type: ${trend.sourceType}
- Keywords: ${trend.extractedKeywords.join(', ') || '(none extracted)'}
- Hashtags seen: ${trend.hashtags.join(', ') || 'none'}
- Creator's own notes on this trend: ${trend.notes || '(none provided)'}

Before writing anything, reason silently about: (1) what this trend is actually about, (2) why it's likely trending right now, (3) what emotion or curiosity is driving people to engage with it, (4) what problem or question sits underneath it, and (5) how that connects naturally to the creator's niche above. Do not just repeat the trend name or keywords back inside a template sentence — that produces meaningless output like "your app has been lying to you about [raw keyword]." Connect the underlying human motivation to the niche instead.

If the keywords/trend name genuinely don't give you enough to do that (e.g. they look like OCR noise: raw numbers, usernames, isolated app UI text) and the creator's notes don't fill the gap either, do not invent a topic. Instead return JSON with "insufficientContext": true and a "clarifyingQuestion" string asking the creator for the specific missing detail (e.g. "What was this screenshot actually showing — a comment, a search result, a sound?").

Otherwise return JSON with "insufficientContext": false and a full post package suited to the platform's real format (short video script for TikTok/YouTube/Instagram/Facebook; pin title+description for Pinterest; post title+body for Reddit with no hashtags; content brief for Google Trends or Website Analytics).

Respond with strict JSON only (no markdown, no preamble), using exactly these keys:
{"insufficientContext": false, "clarifyingQuestion": "", "title": "", "hook": "", "caption": "", "hashtags": "", "script30": "", "script60": "", "pinnedComment": "", "thumbnailText": "", "cta": ""}
If the platform doesn't use hashtags (e.g. Reddit), return an empty string for "hashtags". Caption format: title first, then description, then hashtags directly underneath if applicable, no extra labels. CTA must reference ${website}.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) throw new Error('AI request failed: ' + response.status);
  const data = await response.json();
  const text = (data.content || []).map(b => b.text || '').join('\n');
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

function populateGenerateSelect() {
  const select = $('#generateTrendSelect');
  const trends = getTrends().sort((a, b) => b.viralPotentialScore - a.viralPotentialScore);
  if (!trends.length) {
    select.innerHTML = '<option value="">No trends yet — upload screenshots first</option>';
    return;
  }
  select.innerHTML = trends.map(t => `<option value="${t.id}">${esc(t.trendName)} (${t.viralPotentialScore})</option>`).join('');
}

async function handleGeneratePost() {
  const trendId = $('#generateTrendSelect').value;
  const trend = getTrends().find(t => t.id === trendId);
  if (!trend) { toast('Pick a trend first'); return; }
  const useAI = $('#useAiToggle').checked;
  const btn = $('#generatePostBtn');
  btn.disabled = true;
  btn.textContent = 'Reading the sky…';

  let post;
  try {
    if (useAI) {
      post = await generateAIPost(trend);
    } else {
      post = generateLocalPost(trend);
    }
  } catch (err) {
    console.error(err);
    toast('AI unavailable — used local generation instead');
    post = generateLocalPost(trend);
  }
  btn.disabled = false;
  btn.textContent = 'Generate post ✦';
  renderGeneratedOutput(post, trend);
}

const VIDEO_PLATFORMS = new Set(['TikTok', 'YouTube', 'Instagram', 'Facebook']);

function renderGeneratedOutput(post, trend) {
  const wrap = $('#generatedOutput');

  if (post.insufficientContext) {
    wrap.innerHTML = `
      <div class="glass-card">
        <p class="eyebrow">${esc(trend.platform)} · ${esc(trend.sourceType)}</p>
        <div class="warning-banner">⚠ Not enough context to write a real post here yet.</div>
        <p class="muted">${esc(post.clarifyingQuestion || post.message)}</p>
        <div class="post-block">
          <div class="post-block-label">Add context</div>
          <textarea class="textarea" id="generateContextInput" rows="3" placeholder="What was this trend actually about?"></textarea>
        </div>
        <button class="btn btn-primary" id="addContextAndRetry">Save context & try again</button>
      </div>
    `;
    $('#addContextAndRetry').addEventListener('click', () => {
      const note = $('#generateContextInput').value.trim();
      if (!note) { toast('Add a sentence of context first'); return; }
      const trends = getTrends().map(x => x.id === trend.id ? { ...x, notes: (x.notes ? x.notes + ' ' : '') + note } : x);
      saveTrends(trends);
      refreshTrendFromText(trend.id);
      renderTrends();
      populateGenerateSelect();
      $('#generateTrendSelect').value = trend.id;
      handleGeneratePost();
    });
    return;
  }

  const isVideo = VIDEO_PLATFORMS.has(trend.platform);
  const shortLabel = isVideo ? '30-second script' : 'Structure';
  const longLabel = isVideo ? '60-second script' : null;
  wrap.innerHTML = `
    <div class="glass-card">
      <p class="eyebrow">${esc(trend.platform)} · ${esc(trend.sourceType)}</p>
      ${postBlock('Title', post.title)}
      ${postBlock('Hook', post.hook)}
      ${postBlock('Caption / body (paste as-is)', `${post.title}\n${post.caption}${post.hashtags ? '\n\n' + post.hashtags : ''}`)}
      ${postBlock(shortLabel, post.script30)}
      ${longLabel ? postBlock(longLabel, post.script60) : ''}
      ${post.pinnedComment ? postBlock('Pinned comment idea', post.pinnedComment) : ''}
      ${post.thumbnailText ? postBlock('Thumbnail text', post.thumbnailText) : ''}
      ${postBlock('Call to action', post.cta)}
      <button class="btn btn-primary full" id="saveToLibraryBtn">Save to Content Library</button>
    </div>
  `;
  $('#saveToLibraryBtn').addEventListener('click', () => {
    const idea = {
      id: uid(),
      title: post.title,
      hook: post.hook,
      script30: post.script30,
      script60: post.script60,
      caption: post.caption,
      hashtags: post.hashtags,
      pinnedComment: post.pinnedComment,
      thumbnailText: post.thumbnailText,
      cta: post.cta,
      platform: trend.platform,
      sourceType: trend.sourceType,
      dateCreated: new Date().toISOString(),
      trendSource: trend.trendName,
      trendId: trend.id,
      status: 'idea',
      notes: ''
    };
    const lib = getLibrary();
    lib.unshift(idea);
    saveLibrary(lib);
    toast('Saved to Content Library ✦');
    renderDashboardStats();
  });
}

function postBlock(label, body) {
  const blockId = 'blk_' + uid();
  return `<div class="post-block">
    <div class="post-block-label"><span>${esc(label)}</span><button class="copy-btn" data-copy="${blockId}">copy</button></div>
    <div class="post-block-body" id="${blockId}">${esc(body)}</div>
  </div>`;
}

document.addEventListener('click', (e) => {
  if (e.target.matches('.copy-btn')) {
    const id = e.target.dataset.copy;
    const text = $('#' + id)?.textContent || '';
    navigator.clipboard?.writeText(text).then(() => toast('Copied')).catch(() => toast('Could not copy'));
  }
});

/* ---------------------------------------------------------------------- */
/* Post This Today                                                        */
/* ---------------------------------------------------------------------- */
function pickTodayTrend(forceNew = false) {
  const trends = getTrends();
  if (!trends.length) return null;
  // Rank clear-signal trends first — a high-scoring but meaningless trend
  // (mostly OCR noise) shouldn't win the daily pick over a real one.
  const sorted = [...trends].sort((a, b) => {
    if (a.needsContext !== b.needsContext) return a.needsContext ? 1 : -1;
    return b.viralPotentialScore - a.viralPotentialScore;
  });
  const state = loadJSON(LS.todayPick, { id: null, date: null, excluded: [] });
  const todayStr = new Date().toDateString();

  if (!forceNew && state.id && state.date === todayStr) {
    const existing = trends.find(t => t.id === state.id);
    if (existing) return existing;
  }
  const excluded = forceNew ? [...state.excluded, state.id].filter(Boolean) : [];
  const candidate = sorted.find(t => !excluded.includes(t.id)) || sorted[0];
  saveJSON(LS.todayPick, { id: candidate.id, date: todayStr, excluded });
  return candidate;
}

function renderToday() {
  const trend = pickTodayTrend();
  const wrap = $('#todayContent');
  if (!trend) {
    wrap.innerHTML = '<p class="empty-state">Upload a few screenshots first, then the Oracle can choose today\'s post.</p>';
    return;
  }
  if (trend.needsContext) {
    wrap.innerHTML = `
      <div class="glass-card highlight-card">
        <div class="card-glow"></div>
        <p class="eyebrow">${esc(trend.topicCategory)} · ${esc(trend.platform)} · ${esc(trend.sourceType)}</p>
        <h2>${esc(trend.trendName)}</h2>
        <div class="warning-banner">⚠ Every charted trend right now — including this one — didn't have enough real signal to safely turn into a post. This usually means the OCR mostly picked up numbers or app UI text rather than an actual topic.</div>
        <p class="muted">Add context on the trend's detail page (what the screenshot actually showed), or upload a screenshot with clearer, more legible topic text — a search query, a comment, a hashtag — and check back here.</p>
      </div>
    `;
    return;
  }
  const post = generateLocalPost(trend);
  const weak = trend.viralPotentialScore < 45;
  wrap.innerHTML = `
    <div class="glass-card highlight-card">
      <div class="card-glow"></div>
      <p class="eyebrow">${esc(trend.topicCategory)} · ${esc(trend.platform)} · ${esc(trend.sourceType)}</p>
      <h2>${esc(trend.trendName)}</h2>
      ${scoreOrbRow(trend.scores)}
      ${weak ? `<div class="warning-banner">⚠ This trend is scoring low — it may feel saturated or off-niche. Consider it a backup rather than today's main post.</div>` : ''}
      <div class="post-block">
        <div class="post-block-label">Why the Oracle chose this</div>
        <div class="post-block-body">${esc(whyThisTrend(trend))}</div>
      </div>
    </div>
    ${postBlock('Exact hook', post.hook)}
    ${postBlock('Exact caption', `${post.title}\n${post.caption}\n\n${post.hashtags}`)}
    ${postBlock('Suggested video structure', post.script30)}
    <div class="post-block">
      <div class="post-block-label">Recommended posting angle</div>
      <div class="post-block-body">${esc(postingAngle(trend))}</div>
    </div>
    <button class="btn btn-primary full" id="todayGenerateFull">Generate full post ✎</button>
  `;
  $('#todayGenerateFull').addEventListener('click', () => {
    showView('generate');
    populateGenerateSelect();
    $('#generateTrendSelect').value = trend.id;
  });
}

function whyThisTrend(t) {
  const reasons = [];
  if (t.theme) reasons.push(`it taps into "${t.theme.toLowerCase()}" — ${t.themeDriver}`);
  if (t.scores.audienceMatch > 55) reasons.push('it lines up closely with your 13-sign / true sky niche');
  if (t.scores.hookStrength > 55) reasons.push('the language carries a strong curiosity or emotional hook');
  if (t.scores.trendStrength > 55) reasons.push('the metrics on the source screenshot show real momentum');
  if (t.scores.websiteConversion > 55) reasons.push('it naturally points back to StarChart13.com');
  if (!reasons.length) reasons.push('it is currently your highest-scoring charted trend, even though no single signal is dominant');
  return 'This trend scored highest today because ' + reasons.join(', and ') + '.';
}

function postingAngle(t) {
  if (t.topicCategory === 'Sound') return 'Use the trending sound as background audio under a talking-head myth-bust — sound-first content rides the algorithm push harder than original audio right now.';
  if (t.topicCategory === 'Hashtag') return 'Lead with the hashtag topic directly in your caption and first 3 words on screen so the FYP context matches instantly.';
  if (t.topicCategory === 'Search Term') return 'Answer this like a direct search result — say the exact phrase in your hook so it surfaces in TikTok search.';
  if (t.topicCategory === 'Audience Question') return 'Frame this as a direct answer to a comment/question — open with "You asked..." to boost watch-through.';
  return 'Open with the reveal, not the setup — front-load the hidden-truth angle in the first 2 seconds.';
}

/* ---------------------------------------------------------------------- */
/* Content Library                                                        */
/* ---------------------------------------------------------------------- */
const STATUS_LIST = ['idea', 'drafted', 'filmed', 'posted', 'performed well', 'flopped'];

function statusClass(status) { return 'status-' + status.replace(/\s+/g, '-'); }

function libraryCardHTML(item) {
  return `<div class="library-card" data-id="${item.id}">
    <div class="library-card-top">
      <div>
        <div class="trend-name">${esc(item.title)}</div>
        <div class="trend-meta">${esc(item.platform || 'TikTok')} · ${new Date(item.dateCreated).toLocaleDateString()} · from ${esc(item.trendSource)}</div>
      </div>
      <span class="status-badge ${statusClass(item.status)}">${esc(item.status)}</span>
    </div>
  </div>`;
}

function renderLibrary() {
  const items = getLibrary();
  const search = ($('#librarySearch')?.value || '').toLowerCase();
  const filter = $('#libraryFilter')?.value || 'all';
  const filtered = items.filter(i => {
    const matchesFilter = filter === 'all' || i.status === filter;
    const matchesSearch = !search || (i.title + ' ' + i.trendSource).toLowerCase().includes(search);
    return matchesFilter && matchesSearch;
  });
  $('#libraryList').innerHTML = filtered.map(libraryCardHTML).join('');
  $('#libraryEmpty').classList.toggle('hidden', items.length > 0);
  $all('.library-card', $('#libraryList')).forEach(card => {
    card.addEventListener('click', () => openLibraryDetail(card.dataset.id));
  });
}

function openLibraryDetail(id) {
  const item = getLibrary().find(i => i.id === id);
  if (!item) return;
  const statusOptions = STATUS_LIST.map(s => `<option value="${s}" ${s === item.status ? 'selected' : ''}>${s}</option>`).join('');
  $('#libraryModalContent').innerHTML = `
    <button class="modal-close" id="closeLibraryModal">✕</button>
    <p class="eyebrow">from ${esc(item.trendSource)}</p>
    <h2>${esc(item.title)}</h2>
    <div class="field-row">
      <label class="field-label">Status</label>
      <select class="select" id="libStatusSelect">${statusOptions}</select>
    </div>
    ${postBlock('Hook', item.hook)}
    ${postBlock('Caption', `${item.title}\n${item.caption}\n\n${item.hashtags}`)}
    ${postBlock('30-second script', item.script30)}
    ${postBlock('60-second script', item.script60)}
    ${postBlock('Pinned comment', item.pinnedComment)}
    ${postBlock('Thumbnail text', item.thumbnailText)}
    ${postBlock('CTA', item.cta)}
    <div class="post-block">
      <div class="post-block-label">Notes</div>
      <textarea class="textarea" id="libNotesInput" rows="3">${esc(item.notes)}</textarea>
    </div>
    <button class="btn btn-primary" id="saveLibItem">Save changes</button>
    <button class="btn btn-ghost danger" id="deleteLibItem">Delete idea</button>
  `;
  $('#libraryModal').classList.remove('hidden');
  $('#closeLibraryModal').addEventListener('click', () => $('#libraryModal').classList.add('hidden'));
  $('#saveLibItem').addEventListener('click', () => {
    const lib = getLibrary().map(i => i.id === id ? { ...i, status: $('#libStatusSelect').value, notes: $('#libNotesInput').value } : i);
    saveLibrary(lib);
    renderLibrary();
    renderDashboardStats();
    toast('Saved ✦');
    $('#libraryModal').classList.add('hidden');
  });
  $('#deleteLibItem').addEventListener('click', () => {
    saveLibrary(getLibrary().filter(i => i.id !== id));
    renderLibrary();
    renderDashboardStats();
    $('#libraryModal').classList.add('hidden');
    toast('Deleted');
  });
}

/* ---------------------------------------------------------------------- */
/* Performance Tracker                                                    */
/* ---------------------------------------------------------------------- */
function populatePerfSelect() {
  const select = $('#perfPostSelect');
  const items = getLibrary();
  if (!items.length) {
    select.innerHTML = '<option value="">No saved ideas yet</option>';
    return;
  }
  select.innerHTML = items.map(i => `<option value="${i.id}">${esc(i.title)}</option>`).join('');
}

function handleSavePerformance() {
  const postId = $('#perfPostSelect').value;
  if (!postId) { toast('Save an idea to the Library first'); return; }
  const item = getLibrary().find(i => i.id === postId);
  const record = {
    id: uid(),
    postId,
    title: item ? item.title : 'Untitled',
    trendSource: item ? item.trendSource : '',
    date: new Date().toISOString(),
    views: Number($('#perfViews').value) || 0,
    likes: Number($('#perfLikes').value) || 0,
    comments: Number($('#perfComments').value) || 0,
    shares: Number($('#perfShares').value) || 0,
    saves: Number($('#perfSaves').value) || 0,
    follows: Number($('#perfFollows').value) || 0,
    websiteClicks: Number($('#perfClicks').value) || 0
  };
  const perf = getPerformance();
  perf.unshift(record);
  savePerformance(perf);

  if (item) {
    const engagementRate = record.views ? (record.likes + record.comments + record.shares + record.saves) / record.views : 0;
    const newStatus = engagementRate > 0.12 ? 'performed well' : (record.views > 0 ? 'flopped' : item.status);
    const lib = getLibrary().map(i => i.id === postId ? { ...i, status: record.views > 0 ? newStatus : i.status } : i);
    saveLibrary(lib);
  }

  $all('#perfForm input').forEach(inp => inp.value = '');
  renderPerfHistory();
  renderLibrary();
  renderDashboard();
  toast('Performance logged ✦');
}

function renderPerfHistory() {
  const perf = getPerformance();
  $('#perfHistory').innerHTML = perf.map(p => `
    <div class="library-card">
      <div class="library-card-top">
        <div>
          <div class="trend-name">${esc(p.title)}</div>
          <div class="trend-meta">${new Date(p.date).toLocaleDateString()} · from ${esc(p.trendSource)}</div>
        </div>
      </div>
      <div class="trend-tags" style="margin-top:10px">
        <span class="tag">${p.views} views</span>
        <span class="tag">${p.likes} likes</span>
        <span class="tag">${p.comments} comments</span>
        <span class="tag">${p.shares} shares</span>
        <span class="tag">${p.saves} saves</span>
        <span class="tag gold">${p.follows} follows</span>
        <span class="tag purple">${p.websiteClicks} site clicks</span>
      </div>
    </div>
  `).join('');
  $('#perfEmpty').classList.toggle('hidden', perf.length > 0);
}

function computeInsight() {
  const lib = getLibrary();
  const wellPerformed = lib.filter(i => i.status === 'performed well');
  if (wellPerformed.length < 1) return null;
  const trends = getTrends();
  const categories = {};
  wellPerformed.forEach(i => {
    const t = trends.find(x => x.id === i.trendId);
    const cat = t ? t.topicCategory : 'General Topic';
    categories[cat] = (categories[cat] || 0) + 1;
  });
  const topCat = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];
  if (!topCat) return null;
  return `Posts built from "${topCat[0]}" trends are performing best for you so far (${topCat[1]} of your top performers). Lean into more of these.`;
}

/* ---------------------------------------------------------------------- */
/* Dashboard                                                              */
/* ---------------------------------------------------------------------- */
function renderDashboardStats() {
  $('#statScreenshots').textContent = getScreenshots().length;
  $('#statTrends').textContent = getTrends().length;
  $('#statIdeas').textContent = getLibrary().length;
  $('#statPosted').textContent = getLibrary().filter(i => ['posted', 'performed well', 'flopped'].includes(i.status)).length;
}

function renderDashboard() {
  renderDashboardStats();
  const trend = pickTodayTrend();
  if (trend) {
    $('#dashTopTrendName').textContent = trend.trendName;
    $('#dashTopTrendWhy').textContent = whyThisTrend(trend);
  } else {
    $('#dashTopTrendName').textContent = 'No trends charted yet';
    $('#dashTopTrendWhy').textContent = 'Upload a few screenshots to let the Oracle read the sky.';
  }
  const top = [...getTrends()].sort((a, b) => b.viralPotentialScore - a.viralPotentialScore).slice(0, 4);
  $('#dashTrendList').innerHTML = top.length
    ? top.map(trendCardHTML).join('')
    : '<p class="empty-state">Nothing charted yet.</p>';
  $all('.trend-card', $('#dashTrendList')).forEach(card => {
    card.addEventListener('click', () => openTrendDetail(card.dataset.id));
  });

  const insight = computeInsight();
  $('#dashInsightText').textContent = insight || "Log performance on a few posted videos and the Oracle will start finding your pattern.";
}

/* ---------------------------------------------------------------------- */
/* Settings                                                                */
/* ---------------------------------------------------------------------- */
function loadSettingsIntoForm() {
  const s = getSettings();
  $('#nicheKeywords').value = s.niche.join('\n');
  $('#brandWebsite').value = s.website;
  $('#apiKeyInput').value = s.apiKey || '';
}

function saveNiche() {
  const s = getSettings();
  s.niche = $('#nicheKeywords').value.split('\n').map(l => l.trim()).filter(Boolean);
  s.website = $('#brandWebsite').value.trim() || 'StarChart13.com';
  saveSettings(s);
  $('#nicheSaved').classList.remove('hidden');
  setTimeout(() => $('#nicheSaved').classList.add('hidden'), 2000);
}

function saveApiKey() {
  const s = getSettings();
  s.apiKey = $('#apiKeyInput').value.trim();
  saveSettings(s);
  $('#apiKeySaved').classList.remove('hidden');
  setTimeout(() => $('#apiKeySaved').classList.add('hidden'), 2000);
}
function clearApiKey() {
  const s = getSettings();
  s.apiKey = '';
  saveSettings(s);
  $('#apiKeyInput').value = '';
  toast('API key removed');
}

function exportData() {
  const payload = {
    screenshots: getScreenshots(),
    trends: getTrends(),
    library: getLibrary(),
    performance: getPerformance(),
    settings: getSettings()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'trend-oracle-export.json';
  a.click();
  URL.revokeObjectURL(url);
}

function resetData() {
  if (!confirm('This erases all screenshots, trends, saved ideas, and performance data from this browser. Continue?')) return;
  Object.values(LS).forEach(k => localStorage.removeItem(k));
  toast('All data erased');
  renderEverything();
}

/* ---------------------------------------------------------------------- */
/* Navigation                                                             */
/* ---------------------------------------------------------------------- */
function showView(name) {
  $all('.view').forEach(v => v.classList.toggle('active', v.dataset.view === name));
  $all('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  if (name === 'today') renderToday();
  if (name === 'trends') renderTrends();
  if (name === 'library') renderLibrary();
  if (name === 'performance') { populatePerfSelect(); renderPerfHistory(); }
  if (name === 'generate') populateGenerateSelect();
  if (name === 'settings') loadSettingsIntoForm();
  if (name === 'dashboard') renderDashboard();
}

function renderEverything() {
  renderDashboard();
  renderGallery();
  renderTrends();
  renderLibrary();
  populateGenerateSelect();
  populatePerfSelect();
  renderPerfHistory();
  loadSettingsIntoForm();
}

/* ---------------------------------------------------------------------- */
/* Wiring                                                                 */
/* ---------------------------------------------------------------------- */
function init() {
  // Nav
  $all('.nav-item').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));
  $('#settingsShortcut').addEventListener('click', () => showView('settings'));
  $('#dashGoToPostToday').addEventListener('click', () => showView('today'));

  // Upload
  $('#fileInput').addEventListener('change', (e) => handleFiles(e.target.files));
  const dz = $('#dropzone');
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });

  document.addEventListener('click', (e) => {
    if (e.target.matches('.gallery-delete')) deleteScreenshot(e.target.dataset.id);
    const item = e.target.closest('.gallery-item');
    if (item && !e.target.matches('.gallery-delete')) {
      // future: open screenshot preview / OCR text
    }
  });

  // Trends
  $('#trendSearch').addEventListener('input', renderTrends);
  $('#trendFilter').addEventListener('change', renderTrends);

  // Today
  $('#rerollToday').addEventListener('click', () => { pickTodayTrend(true); renderToday(); });

  // Generate
  $('#generatePostBtn').addEventListener('click', handleGeneratePost);

  // Library
  $('#librarySearch').addEventListener('input', renderLibrary);
  $('#libraryFilter').addEventListener('change', renderLibrary);

  // Performance
  $('#savePerfBtn').addEventListener('click', handleSavePerformance);

  // Settings
  $('#saveNicheBtn').addEventListener('click', saveNiche);
  $('#saveApiKeyBtn').addEventListener('click', saveApiKey);
  $('#clearApiKeyBtn').addEventListener('click', clearApiKey);
  $('#exportDataBtn').addEventListener('click', exportData);
  $('#resetDataBtn').addEventListener('click', resetData);

  // Modals
  [['#trendModal'], ['#libraryModal']].forEach(([sel]) => {
    $(sel).addEventListener('click', (e) => { if (e.target === $(sel)) $(sel).classList.add('hidden'); });
  });

  renderEverything();
}

document.addEventListener('DOMContentLoaded', init);

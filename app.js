/* =========================================================
   StarChart13 Creator Intelligence Dashboard
   Plain HTML/CSS/JS build for GitHub Pages.
   Data is saved in this browser's localStorage only.
========================================================= */

const STORAGE_KEY = "starchart13-data";

const PLATFORMS = [
  { key: "tiktok", label: "TikTok", color: "#ff2d95" },
  { key: "youtube", label: "YouTube", color: "#ff3b3b" },
  { key: "facebook", label: "Facebook", color: "#3b82f6" },
  { key: "snapchat", label: "Snapchat", color: "#fde047" },
  { key: "website", label: "Website", color: "#00d4ff" },
];

const NAV = [
  { key: "dashboard", label: "Dashboard", ic: "🏠" },
  { key: "add", label: "Add Data", ic: "⬆️" },
  { key: "generate", label: "Generate Content", ic: "✨" },
  { key: "history", label: "History", ic: "🕘" },
  { key: "lessons", label: "Lessons Learned", ic: "📈" },
  { key: "settings", label: "Settings", ic: "⚙️" },
];

const DEFAULT_SETTINGS = {
  brandName: "StarChart13",
  website: "https://starchart13.com",
  niche: "13-sign astrology, Ophiuchus, true sky astrology, constellation-based birth charts",
  cta: "Check your real sky chart at StarChart13.com",
  tone: "Direct, provocative, mystical, educational, anti-generic astrology",
  apiKey: "",
};

const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------------------- STATE ---------------------- */
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.error("load failed", e); }
  return { settings: DEFAULT_SETTINGS, research: [], topics: [], history: [] };
}

let data = loadData();
let view = "dashboard";
let ui = {
  addPlatform: "tiktok",
  newTopicOpen: false,
  genSelectedId: null,
  genTab: "tiktok",
  genLoading: false,
  genError: null,
  lessonsInsight: null,
  lessonsLoading: false,
  historyQuery: "",
  shots: {}, // temp screenshot dataURLs keyed by form name
};

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function setData(mutator) {
  mutator(data);
  persist();
  render();
}

function setUi(patch) {
  ui = { ...ui, ...patch };
  render();
}

/* ---------------------- SCORE MATH ---------------------- */
function computeScore(t) {
  const demand = Math.min((Number(t.searchVolume) || 0) / 3000, 1) * 25;
  const trend = Math.min(Math.max(Number(t.trendPercent) || 0, 0) / 250, 1) * 20;
  const gap = t.category === "Content Gap" ? 15 : t.category === "Trending" ? 8 : 0;
  const fit = ((Number(t.fit) || 3) / 5) * 15;
  const cross = ((Number(t.crossPlatform) || 3) / 5) * 10;
  const webConv = ((Number(t.webConversion) || 3) / 5) * 10;
  const past = ((Number(t.pastPerformance) || 3) / 5) * 10;
  const oversatPenalty = ((Number(t.oversaturation) || 2) / 5) * 15;
  const total = demand + trend + gap + fit + cross + webConv + past - oversatPenalty;
  return Math.max(1, Math.min(100, Math.round(total)));
}

function scoreReasons(t, settings) {
  const reasons = [];
  const cons = [];
  const sv = Number(t.searchVolume) || 0;
  const tp = Number(t.trendPercent) || 0;
  if (sv > 1000) reasons.push(`Search volume is high (${sv.toLocaleString()}+ searches)`);
  if (tp > 30) reasons.push(`Trending up ${tp}% right now`);
  if (t.category === "Content Gap") reasons.push("Content gap — not enough videos cover this yet");
  if (Number(t.fit) >= 4) reasons.push(`Fits your niche tightly (${settings.niche.split(",")[0]})`);
  if (Number(t.crossPlatform) >= 4) reasons.push("Strong potential to repost across every platform");
  if (Number(t.webConversion) >= 4) reasons.push(`Leads naturally to ${settings.website.replace("https://", "")}`);
  if (Number(t.pastPerformance) >= 4) reasons.push("Similar past content performed well for you");
  if (Number(t.oversaturation) >= 4) cons.push("Topic is fairly saturated — needs a sharp, unique angle");
  if (sv < 300) cons.push("Search demand is on the low side");
  return { reasons, cons };
}

function scoreColor(score) {
  return score >= 80 ? "var(--green)" : score >= 50 ? "var(--yellow)" : "var(--red)";
}

/* ---------------------- CLAUDE API CALL ---------------------- */
async function callClaude(prompt, { json = false } = {}) {
  const key = data.settings.apiKey;
  if (!key) throw new Error("NO_KEY");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error("API_ERROR_" + res.status);
  const resData = await res.json();
  const text = (resData.content || []).map((b) => b.text || "").join("\n");
  if (json) {
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  }
  return text;
}

function buildCaptionPrompt(topic, settings) {
  return `You are a creative director for a personal astrology brand. Write platform-native content for the topic below. Respond with ONLY raw JSON (no markdown fences, no preamble), matching exactly this shape:

{
  "tiktok": {"onScreenTitle":"","hook":"","script":"","caption":"","hashtags":"","cta":""},
  "youtube": {"title":"","description":"","tags":"","pinnedComment":""},
  "facebook": {"caption":"","discussionQuestion":"","cta":""},
  "snapchat": {"caption":"","hook":""},
  "website": {"title":"","seoDescription":"","outline":""}
}

Topic: ${topic.title}
Angle: ${topic.angle || "Challenge conventional astrology with the real, constellation-based sky."}
Brand: ${settings.brandName}
Website: ${settings.website}
Niche keywords: ${settings.niche}
Default CTA: ${settings.cta}
Tone: ${settings.tone}

Rules:
- TikTok script should be readable in under 45 seconds, say the keyword in the first 3 seconds, and end with the CTA.
- YouTube title must be clear and searchable, not poetic. Description must include the website.
- Facebook caption ends with a question to spark comments.
- Snapchat content is fast, punchy, one surprising fact.
- Every output should tie back to 13-sign astrology / Ophiuchus / true sky astrology where natural.
- hashtags is a single space-separated string starting each tag with #.`;
}

/* ---------------------- SMALL HELPERS ---------------------- */
function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function scoreRingSvg(score, size = 80) {
  const r = 34, stroke = 7;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = scoreColor(score);
  return `
    <div class="score-ring-wrap" style="width:${size}px;height:${size}px;">
      <svg width="${size}" height="${size}" style="transform:rotate(-90deg)">
        <circle cx="${size/2}" cy="${size/2}" r="${r}" stroke="var(--border)" stroke-width="${stroke}" fill="none"/>
        <circle cx="${size/2}" cy="${size/2}" r="${r}" stroke="${color}" stroke-width="${stroke}" fill="none"
          stroke-dasharray="${circ}" stroke-dashoffset="${offset}" stroke-linecap="round"/>
      </svg>
      <div class="score-ring-num" style="color:${color}">${score}</div>
    </div>`;
}

/* ---------------------- RENDER: SHELL ---------------------- */
function render() {
  document.getElementById("nav").innerHTML = NAV.map((n) => `
    <button class="nav-item ${view === n.key ? "active" : ""}" data-nav="${n.key}">
      <span class="ic">${n.ic}</span> ${n.label}
    </button>`).join("");

  const wins = data.history.filter((h) => h.result === "Win").length;
  document.getElementById("quickStats").innerHTML = `
    <div class="panel" style="padding:16px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px;">Quick Stats</div>
      <div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;"><span style="color:var(--text-dim)">Topics tracked</span><b>${data.topics.length}</b></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;"><span style="color:var(--text-dim)">Posts logged</span><b>${data.history.length}</b></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;"><span style="color:var(--text-dim)">Wins</span><b style="color:var(--green)">${wins}</b></div>
    </div>`;

  const app = document.getElementById("app");
  if (view === "dashboard") app.innerHTML = renderDashboard();
  else if (view === "add") app.innerHTML = renderAddData();
  else if (view === "generate") app.innerHTML = renderGenerate();
  else if (view === "history") app.innerHTML = renderHistory();
  else if (view === "lessons") app.innerHTML = renderLessons();
  else if (view === "settings") app.innerHTML = renderSettings();

  attachGlobalListeners();
  attachViewListeners();
}

/* ---------------------- DASHBOARD ---------------------- */
function renderDashboard() {
  const settings = data.settings;
  const sorted = [...data.topics].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const recentResearch = [...data.research].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);

  let html = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:24px;">
      <div>
        <h1 class="page-title">Today's Mission</h1>
        <p class="page-sub">Your highest opportunity to create content that grows ${esc(settings.brandName)}.</p>
      </div>
      <button class="btn btn-primary" data-nav="add">+ Add Data</button>
    </div>`;

  if (!top) {
    html += `
      <div class="panel empty-state">
        <p><b>No topics scored yet</b><br/>Add research data, then create a topic idea to get your first Opportunity Score.</p>
        <button class="btn btn-primary" data-nav="add">Add Your First Data</button>
      </div>`;
    return html;
  }

  const { reasons, cons } = scoreReasons(top, settings);
  html += `
    <div class="panel">
      <span class="pill" style="background:rgba(176,38,255,0.15);color:var(--purple);border:1px solid rgba(176,38,255,0.4)">Highest Opportunity Today</span>
      <div style="display:flex;align-items:center;gap:16px;margin-top:12px;">
        ${scoreRingSvg(top.score)}
        <div>
          <div style="font-size:20px;font-weight:800;">${esc(top.title)}</div>
          <div style="font-size:14px;color:var(--text-dim);margin-top:4px;">${esc(top.angle || "")}</div>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;">
        ${top.trendPercent > 0 ? `<span class="pill" style="background:rgba(62,230,138,0.15);color:var(--green);border:1px solid rgba(62,230,138,0.4)">↑ Trending Up</span>` : ""}
        ${top.category === "Content Gap" ? `<span class="pill" style="background:rgba(0,212,255,0.15);color:var(--blue);border:1px solid rgba(0,212,255,0.4)">Content Gap</span>` : ""}
        ${top.searchVolume > 1000 ? `<span class="pill" style="background:rgba(255,45,149,0.15);color:var(--pink);border:1px solid rgba(255,45,149,0.4)">High Demand</span>` : ""}
      </div>
      <div style="margin-top:20px;padding-top:20px;border-top:1px solid var(--border);">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-dim);margin-bottom:8px;">Why This Topic?</div>
        ${reasons.map((r) => `<div class="reason-row"><span class="reason-check">✓</span>${esc(r)}</div>`).join("")}
        ${cons.map((r) => `<div class="reason-row reason-dim"><span>○</span>${esc(r)}</div>`).join("")}
      </div>
      <div style="margin-top:20px;">
        <button class="btn btn-primary" data-nav="generate">✨ Generate Captions For This</button>
      </div>
    </div>

    <div class="panel">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-dim);margin-bottom:12px;">Platform Priority</div>
      <div class="priority-flex">
        ${["TikTok", "YouTube Shorts", "Facebook", "Snapchat"].map((p, i, arr) => `
          <div class="priority-chip"><span class="priority-num">${i + 1}.</span>${p}</div>
          ${i < arr.length - 1 ? `<span class="priority-arrow">→</span>` : ""}
        `).join("")}
      </div>
    </div>`;

  if (recentResearch.length) {
    html += `
      <div class="panel">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-dim);margin-bottom:12px;">Recent Research Entries</div>
        ${recentResearch.map((r) => {
          const plat = PLATFORMS.find((p) => p.key === r.platform);
          return `
          <div style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;background:var(--panel2);margin-bottom:8px;">
            <span style="color:${plat.color}">●</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(r.topic || r.title)}</div>
              <div style="font-size:12px;color:var(--text-dim);">${plat.label}</div>
            </div>
          </div>`;
        }).join("")}
      </div>`;
  }

  return html;
}

/* ---------------------- ADD DATA ---------------------- */
function fieldsForPlatform(p) {
  switch (p) {
    case "tiktok": return [
      ["topic", "Search topic", "text", ""],
      ["category", "Category", "select", "Trending", ["Trending", "All", "Content Gap"]],
      ["searchVolume", "Search volume", "number", ""],
      ["trendPercent", "Trend %", "number", ""],
      ["notes", "Notes from Creator Search Insights", "textarea", ""],
    ];
    case "youtube": return [
      ["title", "Video title/topic", "text", ""],
      ["views", "Views", "number", ""],
      ["ctr", "CTR (%)", "text", ""],
      ["avgViewDuration", "Avg view duration", "text", ""],
      ["likes", "Likes", "number", ""],
      ["comments", "Comments", "number", ""],
      ["subsGained", "Subscribers gained", "number", ""],
    ];
    case "facebook": return [
      ["topic", "Post topic", "text", ""],
      ["reach", "Reach", "number", ""],
      ["engagement", "Engagement (%)", "text", ""],
      ["shares", "Shares", "number", ""],
      ["comments", "Comments", "number", ""],
      ["linkClicks", "Link clicks", "number", ""],
    ];
    case "snapchat": return [
      ["topic", "Story/video topic", "text", ""],
      ["views", "Views", "number", ""],
      ["screenshots", "Screenshots", "number", ""],
      ["replies", "Replies", "number", ""],
      ["completionRate", "Completion rate (%)", "text", ""],
    ];
    case "website": return [
      ["visits", "Page visits", "number", ""],
      ["topSource", "Top traffic source", "text", ""],
      ["clicksToOrder", "Clicks to reading/order page", "number", ""],
      ["sales", "Book/reading sales", "number", ""],
    ];
  }
}

function renderFieldInput(name, label, type, def, options) {
  const id = `f_${name}`;
  if (type === "select") {
    return `<label class="field"><span class="field-label">${label}</span>
      <select id="${id}">${options.map((o) => `<option value="${o}" ${o === def ? "selected" : ""}>${o}</option>`).join("")}</select>
    </label>`;
  }
  if (type === "textarea") {
    return `<label class="field"><span class="field-label">${label}</span><textarea id="${id}" rows="3"></textarea></label>`;
  }
  return `<label class="field"><span class="field-label">${label}</span><input type="${type}" id="${id}" /></label>`;
}

function renderAddData() {
  const platform = ui.addPlatform;
  const fields = fieldsForPlatform(platform);
  const shot = ui.shots[platform];

  return `
    <h1 class="page-title">Add Data</h1>
    <p class="page-sub">Log research and screenshots from each platform.</p>

    <div class="tab-row">
      ${PLATFORMS.map((p) => `
        <button class="tab-chip ${platform === p.key ? "active" : ""}" data-add-platform="${p.key}">${p.label}</button>
      `).join("")}
    </div>

    <div class="panel">
      <form id="platformForm">
        ${fields.map(([name, label, type, def, options]) => renderFieldInput(name, label, type, def, options)).join("")}
        <label class="field">
          <span class="field-label">Screenshot (optional)</span>
          <label class="upload-box">
            📷 <span>${shot ? "Screenshot attached ✓" : "Tap to upload a screenshot"}</span>
            <input type="file" accept="image/*" id="shotInput" />
          </label>
          ${shot ? `<img src="${shot}" class="preview-img" />` : ""}
        </label>
        <button type="submit" class="btn btn-primary">+ Save ${PLATFORMS.find(p=>p.key===platform).label} Entry</button>
      </form>
    </div>

    <div style="margin-top:20px;">
      ${renderNewTopicSection()}
    </div>`;
}

function renderNewTopicSection() {
  if (!ui.newTopicOpen) {
    return `<button class="btn btn-subtle btn-block" data-action="openTopic">🎯 Score a New Topic Idea</button>`;
  }
  const preview = ui.topicDraft || { fit: 3, crossPlatform: 3, webConversion: 3, pastPerformance: 3, oversaturation: 2 };
  const score = computeScore(preview);
  return `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div style="font-size:14px;font-weight:700;">🎯 Score a New Topic Idea</div>
        <button class="icon-btn" data-action="closeTopic">✕</button>
      </div>
      <form id="topicForm">
        <label class="field"><span class="field-label">Topic</span><input type="text" id="t_title" placeholder="Sagittarius traits" value="${esc(preview.title||"")}"/></label>
        <label class="field"><span class="field-label">Angle</span><textarea id="t_angle" rows="2" placeholder="People think they are Sagittarius, but the real sky may show something different.">${esc(preview.angle||"")}</textarea></label>
        <div class="grid-2">
          <label class="field"><span class="field-label">Category</span>
            <select id="t_category">
              ${["Trending","All","Content Gap"].map(o=>`<option ${o===preview.category?"selected":""}>${o}</option>`).join("")}
            </select>
          </label>
          <label class="field"><span class="field-label">Search volume</span><input type="number" id="t_searchVolume" value="${preview.searchVolume||""}"/></label>
        </div>
        <label class="field"><span class="field-label">Trend %</span><input type="number" id="t_trendPercent" value="${preview.trendPercent||""}"/></label>
        ${["fit","crossPlatform","webConversion","pastPerformance","oversaturation"].map(k => sliderRow(k, preview[k])).join("")}
        <div style="display:flex;align-items:center;gap:12px;margin:16px 0;">
          ${scoreRingSvg(score, 64)}
          <span style="font-size:13px;color:var(--text-dim);">Live opportunity score preview</span>
        </div>
        <button type="submit" class="btn btn-primary btn-block">Save Topic</button>
      </form>
    </div>`;
}

const SLIDER_LABELS = {
  fit: "Fit with brand",
  crossPlatform: "Cross-platform potential",
  webConversion: "Website conversion potential",
  pastPerformance: "Similarity to past winners",
  oversaturation: "Oversaturation",
};

function sliderRow(key, val) {
  val = val || (key === "oversaturation" ? 2 : 3);
  return `
    <div class="slider-row">
      <div class="slider-head"><span>${SLIDER_LABELS[key]}</span><span id="lbl_${key}" style="color:var(--purple)">${val}/5</span></div>
      <input type="range" min="1" max="5" value="${val}" id="s_${key}" data-slider="${key}"/>
    </div>`;
}

/* ---------------------- GENERATE ---------------------- */
function renderGenerate() {
  const sorted = [...data.topics].sort((a, b) => b.score - a.score);
  if (!ui.genSelectedId && sorted[0]) ui.genSelectedId = sorted[0].id;
  const topic = data.topics.find((t) => t.id === ui.genSelectedId);

  let html = `
    <h1 class="page-title">Generate Content</h1>
    <p class="page-sub">Pick a scored topic and generate platform-ready captions.</p>`;

  if (!sorted.length) {
    return html + `<div class="panel empty-state"><p>Score a topic on the Add Data page first.</p></div>`;
  }

  html += `
    <div class="panel">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-dim);margin-bottom:10px;">Choose a topic</div>
      <div style="max-height:220px;overflow-y:auto;">
        ${sorted.map((t) => `
          <div class="topic-row ${t.id === ui.genSelectedId ? "active" : ""}" data-select-topic="${t.id}">
            <span class="topic-row-title">${esc(t.title)}</span>
            <span style="font-weight:800;font-size:13px;color:${scoreColor(t.score)}">${t.score}</span>
          </div>`).join("")}
      </div>
    </div>`;

  if (topic) {
    html += `
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:20px;">
          <div>
            <div style="font-size:18px;font-weight:800;">${esc(topic.title)}</div>
            ${topic.angle ? `<div style="font-size:14px;color:var(--text-dim);">${esc(topic.angle)}</div>` : ""}
          </div>
          <button class="btn btn-primary" data-action="generateContent" ${ui.genLoading ? "disabled" : ""}>
            ${ui.genLoading ? "Generating…" : (topic.content ? "✨ Regenerate" : "✨ Generate Captions")}
          </button>
        </div>`;

    if (ui.genError) html += `<p style="color:var(--red);font-size:14px;margin-bottom:16px;">${esc(ui.genError)}</p>`;

    if (topic.content) {
      html += `
        <div class="tab-row">
          ${PLATFORMS.map((p) => `<button class="tab-chip ${ui.genTab === p.key ? "active" : ""}" data-gen-tab="${p.key}">${p.label}</button>`).join("")}
        </div>
        ${Object.entries(topic.content[ui.genTab] || {}).map(([k, v]) => `
          <div class="content-block">
            <div class="content-block-label">${k.replace(/([A-Z])/g, " $1")}</div>
            <div class="content-block-body">${esc(v)}</div>
          </div>`).join("")}
        <button class="btn btn-subtle" data-action="logHistory">+ Log This Post to History</button>`;
    }
    html += `</div>`;
  }

  return html;
}

/* ---------------------- HISTORY ---------------------- */
function renderHistory() {
  const q = ui.historyQuery.toLowerCase();
  const rows = data.history.filter((h) => (h.topic + h.notes).toLowerCase().includes(q));

  let html = `
    <h1 class="page-title">Content History</h1>
    <p class="page-sub">Every post idea and result, searchable.</p>
    <input type="text" id="historySearch" placeholder="Search history..." value="${esc(ui.historyQuery)}" style="max-width:320px;margin-bottom:20px;"/>`;

  if (!rows.length) {
    html += `<div class="panel empty-state"><p>No posts logged yet.</p></div>`;
    return html;
  }

  rows.slice().reverse().forEach((h) => {
    html += `
      <div class="panel" data-history-id="${h.id}">
        <div class="history-card-head">
          <div>
            <div style="font-weight:700;">${esc(h.topic)}</div>
            <div style="font-size:12px;color:var(--text-dim);">${h.date} · ${h.platform} · predicted ${h.scorePredicted}/100</div>
          </div>
          <div class="history-controls">
            <select data-hist-field="result">
              ${["Win","Neutral","Flop"].map(o=>`<option ${o===h.result?"selected":""}>${o}</option>`).join("")}
            </select>
            <button class="icon-btn" style="color:var(--red);font-size:16px;" data-action="deleteHistory">🗑</button>
          </div>
        </div>
        <div class="grid-3">
          <div><div class="mini-stat-label">Actual views</div><input type="number" data-hist-field="actualViews" value="${esc(h.actualViews)}"/></div>
          <div><div class="mini-stat-label">Engagement</div><input type="number" data-hist-field="engagement" value="${esc(h.engagement)}"/></div>
          <div><div class="mini-stat-label">Website clicks</div><input type="number" data-hist-field="websiteClicks" value="${esc(h.websiteClicks)}"/></div>
        </div>
        <div style="margin-top:10px;">
          <textarea data-hist-field="notes" placeholder="Notes...">${esc(h.notes)}</textarea>
        </div>
      </div>`;
  });

  return html;
}

/* ---------------------- LESSONS ---------------------- */
function renderLessons() {
  const history = data.history;
  let html = `
    <h1 class="page-title">Lessons Learned</h1>
    <p class="page-sub">AI-style insights pulled from your own posting history.</p>`;

  if (!history.length) {
    return html + `<div class="panel empty-state"><p>Log a few posts in History to unlock insights.</p></div>`;
  }

  const wins = history.filter((h) => h.result === "Win");
  const flops = history.filter((h) => h.result === "Flop");
  const byPlatform = {};
  history.forEach((h) => {
    byPlatform[h.platform] = byPlatform[h.platform] || { wins: 0, total: 0 };
    byPlatform[h.platform].total++;
    if (h.result === "Win") byPlatform[h.platform].wins++;
  });

  html += `
    <div class="grid-3" style="margin-bottom:20px;">
      <div class="stat-card"><div class="stat-value" style="color:var(--green)">${wins.length}</div><div class="stat-label">Wins</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--red)">${flops.length}</div><div class="stat-label">Flops</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--purple)">${Math.round((wins.length / history.length) * 100)}%</div><div class="stat-label">Win rate</div></div>
    </div>
    <div class="panel">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-dim);margin-bottom:12px;">Win rate by platform</div>
      ${Object.entries(byPlatform).map(([k,v]) => `
        <div style="display:flex;justify-content:space-between;font-size:14px;padding:6px 0;">
          <span style="text-transform:capitalize;">${k}</span><span style="color:var(--text-dim)">${v.wins}/${v.total} wins</span>
        </div>`).join("")}
    </div>
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-dim);">AI insights</div>
        <button class="btn btn-subtle" data-action="genInsight" ${ui.lessonsLoading ? "disabled" : ""}>${ui.lessonsLoading ? "Thinking…" : "✨ Generate"}</button>
      </div>
      ${ui.lessonsInsight
        ? `<p style="font-size:14px;white-space:pre-wrap;">${esc(ui.lessonsInsight)}</p>`
        : `<p style="font-size:14px;color:var(--text-dim);">Tap Generate to have Claude analyze your history for patterns.</p>`}
    </div>`;

  return html;
}

/* ---------------------- SETTINGS ---------------------- */
function renderSettings() {
  const s = data.settings;
  return `
    <h1 class="page-title">Settings</h1>
    <p class="page-sub">Your brand defaults, used across scoring and captions.</p>
    <div class="panel" style="max-width:520px;">
      <form id="settingsForm">
        <label class="field"><span class="field-label">Brand name</span><input type="text" id="set_brandName" value="${esc(s.brandName)}"/></label>
        <label class="field"><span class="field-label">Website URL</span><input type="text" id="set_website" value="${esc(s.website)}"/></label>
        <label class="field"><span class="field-label">Main niche keywords</span><textarea id="set_niche" rows="2">${esc(s.niche)}</textarea></label>
        <label class="field"><span class="field-label">Default CTA</span><input type="text" id="set_cta" value="${esc(s.cta)}"/></label>
        <label class="field"><span class="field-label">Tone</span><textarea id="set_tone" rows="2">${esc(s.tone)}</textarea></label>
        <label class="field">
          <span class="field-label">Anthropic API key (for Generate Content &amp; AI Insights)</span>
          <input type="password" id="set_apiKey" value="${esc(s.apiKey || "")}" placeholder="sk-ant-..."/>
        </label>
        <p style="font-size:12px;color:var(--text-dim);margin:-8px 0 16px 0;">
          Get a key at <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>.
          It's stored only in this browser's local storage and sent directly from your device to Anthropic's API — never through any third-party server.
        </p>
        <button type="submit" class="btn btn-primary btn-block">Save Settings</button>
      </form>
    </div>`;
}

/* ---------------------- LISTENERS ---------------------- */
function attachGlobalListeners() {
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.onclick = () => {
      view = el.dataset.nav;
      ui.newTopicOpen = false;
      closeDrawer();
      render();
    };
  });
}

function openDrawer() { document.getElementById("sidebar").classList.add("open"); document.getElementById("drawerOverlay").classList.remove("hidden"); }
function closeDrawer() { document.getElementById("sidebar").classList.remove("open"); document.getElementById("drawerOverlay").classList.add("hidden"); }

document.getElementById("hamburgerBtn").onclick = openDrawer;
document.getElementById("closeDrawerBtn").onclick = closeDrawer;
document.getElementById("drawerOverlay").onclick = closeDrawer;

function attachViewListeners() {
  if (view === "add") attachAddDataListeners();
  if (view === "generate") attachGenerateListeners();
  if (view === "history") attachHistoryListeners();
  if (view === "lessons") attachLessonsListeners();
  if (view === "settings") attachSettingsListeners();
}

function attachAddDataListeners() {
  document.querySelectorAll("[data-add-platform]").forEach((el) => {
    el.onclick = () => setUi({ addPlatform: el.dataset.addPlatform });
  });

  const shotInput = document.getElementById("shotInput");
  if (shotInput) {
    shotInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        ui.shots[ui.addPlatform] = reader.result;
        render();
      };
      reader.readAsDataURL(file);
    };
  }

  const form = document.getElementById("platformForm");
  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault();
      const platform = ui.addPlatform;
      const fields = fieldsForPlatform(platform);
      const entry = { id: uid(), platform, createdAt: Date.now(), screenshot: ui.shots[platform] || null };
      fields.forEach(([name]) => {
        const el = document.getElementById(`f_${name}`);
        entry[name] = el.value;
      });
      setData((d) => { d.research.push(entry); });
      delete ui.shots[platform];
    };
  }

  const openBtn = document.querySelector('[data-action="openTopic"]');
  if (openBtn) openBtn.onclick = () => setUi({ newTopicOpen: true, topicDraft: null });
  const closeBtn = document.querySelector('[data-action="closeTopic"]');
  if (closeBtn) closeBtn.onclick = () => setUi({ newTopicOpen: false });

  document.querySelectorAll("[data-slider]").forEach((el) => {
    el.oninput = () => {
      const key = el.dataset.slider;
      document.getElementById(`lbl_${key}`).textContent = `${el.value}/5`;
      const ring = document.querySelector(".score-ring-wrap");
      // recompute using current form values without a full re-render
      const draft = readTopicDraft();
      const score = computeScore(draft);
      const wrap = document.querySelector(".score-ring-wrap");
      if (wrap) wrap.outerHTML = scoreRingSvg(score, 64);
    };
  });

  const topicForm = document.getElementById("topicForm");
  if (topicForm) {
    topicForm.onsubmit = (e) => {
      e.preventDefault();
      const t = readTopicDraft();
      if (!t.title) return;
      setData((d) => {
        d.topics.push({ id: uid(), createdAt: Date.now(), ...t, score: computeScore(t) });
      });
      ui.newTopicOpen = false;
    };
  }
}

function readTopicDraft() {
  const g = (id) => document.getElementById(id)?.value;
  return {
    title: g("t_title") || "",
    angle: g("t_angle") || "",
    category: g("t_category") || "Trending",
    searchVolume: Number(g("t_searchVolume")) || 0,
    trendPercent: Number(g("t_trendPercent")) || 0,
    fit: Number(g("s_fit")) || 3,
    crossPlatform: Number(g("s_crossPlatform")) || 3,
    webConversion: Number(g("s_webConversion")) || 3,
    pastPerformance: Number(g("s_pastPerformance")) || 3,
    oversaturation: Number(g("s_oversaturation")) || 2,
  };
}

function attachGenerateListeners() {
  document.querySelectorAll("[data-select-topic]").forEach((el) => {
    el.onclick = () => setUi({ genSelectedId: el.dataset.selectTopic, genError: null });
  });
  document.querySelectorAll("[data-gen-tab]").forEach((el) => {
    el.onclick = () => setUi({ genTab: el.dataset.genTab });
  });
  const genBtn = document.querySelector('[data-action="generateContent"]');
  if (genBtn) {
    genBtn.onclick = async () => {
      const topic = data.topics.find((t) => t.id === ui.genSelectedId);
      if (!topic) return;
      if (!data.settings.apiKey) {
        setUi({ genError: "Add your Anthropic API key in Settings first." });
        return;
      }
      ui.genLoading = true; ui.genError = null; render();
      try {
        const result = await callClaude(buildCaptionPrompt(topic, data.settings), { json: true });
        setData((d) => {
          const idx = d.topics.findIndex((t) => t.id === topic.id);
          if (idx >= 0) d.topics[idx].content = result;
        });
        ui.genLoading = false; render();
      } catch (err) {
        ui.genLoading = false;
        ui.genError = "Couldn't generate content. Check your API key and try again.";
        render();
      }
    };
  }
  const logBtn = document.querySelector('[data-action="logHistory"]');
  if (logBtn) {
    logBtn.onclick = () => {
      const topic = data.topics.find((t) => t.id === ui.genSelectedId);
      if (!topic) return;
      setData((d) => {
        d.history.push({
          id: uid(), date: new Date().toISOString().slice(0, 10), platform: "tiktok",
          topic: topic.title, hook: topic.content?.tiktok?.hook || "", caption: topic.content?.tiktok?.caption || "",
          scorePredicted: topic.score, actualViews: "", engagement: "", websiteClicks: "", notes: "", result: "Neutral",
        });
      });
    };
  }
}

function attachHistoryListeners() {
  const search = document.getElementById("historySearch");
  if (search) {
    search.oninput = (e) => { ui.historyQuery = e.target.value; render(); document.getElementById("historySearch").focus(); };
  }
  document.querySelectorAll("[data-history-id]").forEach((card) => {
    const id = card.dataset.historyId;
    card.querySelectorAll("[data-hist-field]").forEach((el) => {
      el.onchange = () => {
        setData((d) => {
          const row = d.history.find((h) => h.id === id);
          if (row) row[el.dataset.histField] = el.value;
        });
      };
    });
    const delBtn = card.querySelector('[data-action="deleteHistory"]');
    if (delBtn) delBtn.onclick = () => setData((d) => { d.history = d.history.filter((h) => h.id !== id); });
  });
}

function attachLessonsListeners() {
  const btn = document.querySelector('[data-action="genInsight"]');
  if (btn) {
    btn.onclick = async () => {
      if (!data.settings.apiKey) { setUi({ lessonsInsight: "Add your Anthropic API key in Settings first." }); return; }
      ui.lessonsLoading = true; render();
      try {
        const prompt = `Given this creator's post history as JSON, write 3-4 short, concrete insights (plain English, no fluff) about what's working and a clear recommendation for what to do next. Data: ${JSON.stringify(data.history)}`;
        const text = await callClaude(prompt);
        ui.lessonsInsight = text;
      } catch {
        ui.lessonsInsight = "Couldn't generate insights right now. Check your API key.";
      }
      ui.lessonsLoading = false;
      render();
    };
  }
}

function attachSettingsListeners() {
  const form = document.getElementById("settingsForm");
  form.onsubmit = (e) => {
    e.preventDefault();
    setData((d) => {
      d.settings = {
        brandName: document.getElementById("set_brandName").value,
        website: document.getElementById("set_website").value,
        niche: document.getElementById("set_niche").value,
        cta: document.getElementById("set_cta").value,
        tone: document.getElementById("set_tone").value,
        apiKey: document.getElementById("set_apiKey").value,
      };
    });
  };
}

/* ---------------------- INIT ---------------------- */
render();

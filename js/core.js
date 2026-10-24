/* AI Systems Academy — app core: routing, views, progress, code blocks, quizzes. */
(function () {
  const A = window.AISA;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  A.esc = esc; A.$ = $; A.$$ = $$;

  /* ---------- storage (per-viewer convenience only) ---------- */
  const KEY = 'aisa.v1';
  let S = { done: {}, steps: {}, quiz: {}, open: { 0: true }, theme: null, drafts: {} };
  try { const raw = localStorage.getItem(KEY); if (raw) S = Object.assign(S, JSON.parse(raw)); } catch (e) { /* storage unavailable */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } };
  A.state = S; A.save = save;

  /* ---------- flat lesson index ---------- */
  const ALL = [];
  A.PHASES.forEach(p => p.lessons.forEach(([id, title]) => ALL.push({ id, title, phase: p.n })));
  const idx = id => ALL.findIndex(l => l.id === id);
  const built = id => !!A.LESSONS[id];
  A.ALL = ALL;

  /* ---------- theme ---------- */
  function applyTheme() {
    if (S.theme) document.documentElement.setAttribute('data-theme', S.theme);
    else document.documentElement.removeAttribute('data-theme');
    const dark = S.theme ? S.theme === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches;
    $$('[data-theme-label]').forEach(el => el.textContent = dark ? 'LIGHT' : 'DARK');
  }
  function toggleTheme() {
    const dark = S.theme ? S.theme === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches;
    S.theme = dark ? 'light' : 'dark'; save(); applyTheme();
  }

  /* ---------- toast ---------- */
  let tt;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 1800); }
  A.toast = toast;

  /* ---------- syntax highlight (small, dependency-free) ---------- */
  const KW = {
    python: 'import|from|def|class|return|if|else|elif|for|while|with|as|async|await|try|except|finally|raise|lambda|in|not|and|or|is|True|False|None|yield|pass|break|continue|global|nonlocal|assert|del|match|case|type',
    sql: 'SELECT|FROM|WHERE|GROUP|BY|ORDER|HAVING|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|WITH|OVER|PARTITION|ROWS|BETWEEN|UNBOUNDED|PRECEDING|CURRENT|ROW|AND|OR|NOT|NULL|IS|IN|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|PRIMARY|KEY|REFERENCES|UNIQUE|DEFAULT|LIMIT|DESC|ASC|CASE|WHEN|THEN|ELSE|END|EXPLAIN|ANALYZE|DISTINCT|COUNT|SUM|AVG|MIN|MAX|LAG|LEAD|ROW_NUMBER|RANK|DENSE_RANK|COALESCE|INTERVAL|RETURNING|CONFLICT|DO|NOTHING|USING|GIN|BTREE|TEXT|INT|BIGINT|BIGSERIAL|TIMESTAMPTZ|JSONB|BOOLEAN|NUMERIC|CHECK|NOW|EXISTS|UNION|ALL|INCLUDE|CONCURRENTLY|IF',
    bash: 'export|cd|ls|grep|cat|echo|sudo|git|uv|pip|python|docker|curl|chmod|mkdir|rm|mv|cp|find|xargs|sed|awk|tail|head|ssh|kill|ps|for|do|done|if|then|fi|in|while|jq|sort|uniq|wc|less|tee|ruff|pytest|compose|run|exec|source',
    yaml: 'true|false|null|services|image|build|ports|environment|depends_on|volumes|healthcheck|condition|command|restart',
    docker: 'FROM|RUN|COPY|WORKDIR|ENV|EXPOSE|CMD|ENTRYPOINT|ARG|USER|AS|HEALTHCHECK|ADD',
    proto: 'syntax|package|service|rpc|returns|message|string|int32|int64|float|double|bool|repeated|stream|option|import|enum'
  };
  function hl(code, lang = 'python') {
    const kw = KW[lang] || KW.python;
    const ci = lang === 'sql' || lang === 'docker' ? 'gi' : 'g';
    const cmt = lang === 'sql' ? '--[^\\n]*' : (lang === 'proto' ? '\\/\\/[^\\n]*' : '#[^\\n]*');
    const re = new RegExp('("""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\')|(' + cmt + ')|("(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\')|(@[A-Za-z_][\\w.]*)|\\b(' + kw + ')\\b|\\b(\\d+(?:\\.\\d+)?)\\b|\\b([A-Za-z_]\\w*)(?=\\()', ci);
    let out = '', last = 0, m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      const cls = m[1] ? 'tk-s' : m[2] ? 'tk-c' : m[3] ? 'tk-s' : m[4] ? 'tk-d' : m[5] ? 'tk-k' : m[6] ? 'tk-n' : 'tk-f';
      out += '<span class="' + cls + '">' + esc(m[0]) + '</span>';
      last = m.index + m[0].length;
    }
    return out + esc(code.slice(last));
  }
  A.hl = hl;

  /* ---------- code block ---------- */
  let codeSeq = 0;
  const CODES = {};
  function codeBlock(o) {
    // o: {file, src, lang, browser, outKey, sm}
    const id = 'cb' + (++codeSeq);
    CODES[id] = o;
    const out = o.outKey && A.OUTPUTS && A.OUTPUTS[o.outKey];
    const outHtml = out != null ? `<div class="out" id="${id}-out"><div class="out-h"><span class="src">Expected output · captured from a real run</span><span>${o.browser ? 'press run to execute it here' : 'run locally'}</span></div><pre class="sm">${esc(out)}</pre></div>`
      : (o.browser ? `<div class="out" id="${id}-out" hidden><div class="out-h"><span class="src">Output</span></div><pre class="sm"></pre></div>` : '');
    return `<div class="code" data-cb="${id}">
      <div class="code-bar"><span class="fn">${esc(o.file || o.lang || 'code')}</span><span class="cb-actions">
        ${o.browser ? `<button class="cbtn run" data-run="${id}">▶ Run here</button>` : ''}
        <button class="cbtn" data-copy="${id}">Copy</button></span></div>
      <pre class="${o.sm ? 'sm' : ''}" tabindex="0">${hl(o.src.replace(/\n+$/, ''), o.lang || 'python')}</pre>${outHtml}</div>`;
  }
  A.codeBlock = codeBlock;
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
    catch (e) { toast('Copy blocked here — select the code and copy it'); }
  }
  async function runCode(id) {
    const o = CODES[id]; const box = $('#' + id + '-out');
    box.hidden = false;
    const h = box.querySelector('.out-h .src'), pre = box.querySelector('pre');
    h.textContent = 'Starting in-browser Python…'; h.classList.remove('live'); pre.classList.remove('err');
    const res = await A.py.run(o.src, t => { h.textContent = t; });
    if (res.ok) { h.textContent = 'Live output · Python ' + (res.version || '') + ' in your browser'; h.classList.add('live'); pre.textContent = res.out || '(no output)'; }
    else if (res.unavailable) { h.textContent = 'In-browser Python is unavailable here · expected output shown'; }
    else { h.textContent = 'Error'; pre.classList.add('err'); pre.textContent = (res.out ? res.out + '\n' : '') + res.err; }
  }

  /* ---------- sidebar ---------- */
  function renderSidebar() {
    const nav = $('#side-nav');
    const groups = [['Foundations', [0, 1, 2]], ['Building with LLMs', [3, 4, 5, 6]], ['Trust', [7, 8]], ['Production', [9, 10]], ['Field and design', [11, 12, 13]], ['Proof', [14]]];
    nav.innerHTML = `<a class="side-link" data-route="home" href="#home" style="border-left:0"><span class="lid">⌂</span><span class="lt">Overview and roles</span></a>` +
      groups.map(([g, ns]) => `<div class="side-label">${g}</div>` + ns.map(n => {
        const p = A.PHASES[n]; const b = p.lessons.filter(l => built(l[0])).length; const d = p.lessons.filter(l => S.done[l[0]]).length;
        return `<div class="ph-group ${S.open[n] ? 'open' : ''}" data-ph="${n}">
          <button class="ph-btn" data-toggle="${n}" aria-expanded="${!!S.open[n]}"><span class="num">${String(n).padStart(2, '0')}</span><span class="ttl">${esc(p.name)}</span><span class="cnt ${b ? 'live' : ''}">${b ? d + '/' + p.lessons.length : 'soon'}</span><span class="car">›</span></button>
          <div class="ph-lessons"><a class="side-link" href="#p${n}" data-route="p${n}"><span class="lid">◇</span><span class="lt">Phase overview</span></a>${p.lessons.map(([id, t]) => `<a class="side-link ${built(id) ? '' : 'planned'} ${S.done[id] ? 'done' : ''}" href="#l${id}" data-route="l${id}" data-search="${esc((id + ' ' + t + ' ' + p.name + ' ' + (A.LESSONS[id] ? A.LESSONS[id].tags || '' : '')).toLowerCase())}"><span class="lid">${id}</span><span class="lt">${esc(t)}</span><span class="ck">${S.done[id] ? '✓' : ''}</span></a>`).join('')}</div></div>`;
      }).join('')).join('');
    updateProgress();
  }
  function updateProgress() {
    const d = ALL.filter(l => S.done[l.id]).length, b = ALL.filter(l => built(l.id)).length;
    $('#prog-txt').textContent = d + ' / ' + ALL.length;
    $('#prog-built').textContent = b + ' lessons live';
    $('#prog-bar').style.width = (100 * d / ALL.length).toFixed(1) + '%';
  }
  function markActive(route) {
    $$('#side-nav .side-link').forEach(a => a.classList.toggle('active', a.dataset.route === route.split('-')[0] || a.dataset.route === route));
    $$('#side-nav .side-link').forEach(a => { if (a.dataset.route === route) a.classList.add('active'); });
  }
  function search(q) {
    q = q.trim().toLowerCase();
    $$('#side-nav .ph-group').forEach(g => {
      if (!q) { g.classList.remove('hidden'); g.classList.toggle('open', !!S.open[g.dataset.ph]); $$('.side-link', g).forEach(a => a.classList.remove('hidden')); return; }
      let any = false;
      $$('.side-link[data-search]', g).forEach(a => { const hit = a.dataset.search.includes(q); a.classList.toggle('hidden', !hit); any = any || hit; });
      g.classList.toggle('hidden', !any); g.classList.toggle('open', any);
    });
  }

  /* ---------- HOME ---------- */
  function termLines() {
    const raw = (A.OUTPUTS && A.OUTPUTS['0.2:code']) || '';
    return raw.split('\n').map(l => {
      const e = esc(l).replace(/ +/g, ' ').replace(/^(limit=\S+)/, '<span class="p">$1</span>').replace(/(429s=)(\d+)/, (m, a, n) => a + (+n ? '<span class="w">' + n + '</span>' : n));
      return /^limit=4\b/.test(l) ? e + ' <span class="w">◀</span>' : e;
    }).join('\n') + '\n<span class="d"># 40 calls · provider allows 4 at once</span>\n<span class="d"># real output from lesson 0.2</span>';
  }
  function renderHome() {
    const totalBuilt = ALL.filter(l => built(l.id)).length;
    const roleRow = (key) => A.PHASES.filter(p => p.weight[key] >= 9).map(p => p.name);
    const bars = (key) => A.PHASES.map(p => `<div class="wbar"><span>${String(p.n).padStart(2, '0')} ${esc(p.name.split(' ')[0])}</span><b><i style="width:${p.weight[key] * 10}%"></i></b><span>${p.weight[key]}</span></div>`).join('');
    return `
    <section class="hero">
      <div>
        <span class="eyebrow">AI Systems Academy · Oct 2026 edition</span>
        <h1>Ship AI into <em>real</em> production.</h1>
        <p class="lede">A hands-on classroom for two of 2026’s hardest-to-fill roles: the <b>Forward Deployed Engineer</b> who makes AI work inside a customer’s enterprise, and the <b>Backend Engineer for AI Systems</b> who makes it fast, cheap and crash-proof. ${ALL.length} micro-lessons in 15 phases, each one building on the last.</p>
        <div class="link-row"><a class="btn volt" href="#l0.1">Start lesson 0.1 →</a><a class="btn" href="#p0">Phase 0 overview</a><a class="btn" href="${A.BLUEPRINT}" target="_blank" rel="noopener">Blueprint doc ↗</a></div>
      </div>
      <div class="term" aria-label="What a lesson ships">
        <div class="term-bar"><i></i><i></i><i></i><span style="margin-left:8px">lesson 0.2 · lab</span></div>
        <div class="term-body"><span class="d">$</span> <span class="k">uv run</span> fanout.py
${termLines()}</div>
      </div>
    </section>

    <section class="sec"><div class="sec-head"><div><span class="sec-tag">[01] The two roles</span><h2 class="sec-title">One core, two <em>specialisms</em></h2></div><span class="faint mono" style="font-size:11px">bars = weight of each phase for the role, 0–10</span></div>
      <div class="tracks">
        <div class="track fde"><span class="tk-tag">Forward Deployed Engineer</span><h3>Embed, discover, build, ship inside the customer</h3>
          <ul><li>Owns discovery, scoping, system design, build and rollout of production AI</li><li>Integrates SSO, legacy data pipelines and compliance rules</li><li>The decomposition round decides most offers</li></ul>${bars('fde')}</div>
        <div class="track be"><span class="tk-tag">Backend Engineer, AI Systems</span><h3>Own the inference and orchestration layer</h3>
          <ul><li>Designs pipelines and service boundaries around models</li><li>Tunes latency and throughput with caching, batching and streaming</li><li>Runs serving engines, gateways and durable agent workflows</li></ul>${bars('be')}</div>
      </div></section>

    <section class="sec"><div class="sec-head"><div><span class="sec-tag">[02] Course map</span><h2 class="sec-title">Fifteen phases, in order</h2></div><span class="faint mono" style="font-size:11px">${totalBuilt} of ${ALL.length} lessons live · more ship each round</span></div>
      <div class="board">${A.PHASES.map(p => { const b = p.lessons.filter(l => built(l[0])).length; const d = p.lessons.filter(l => S.done[l[0]]).length;
        return `<a class="strip" href="#p${p.n}" style="text-decoration:none;color:inherit"><span class="sn">${String(p.n).padStart(2, '0')}</span><span><span class="st">${esc(p.name)}${p.bridge ? ' <span class="pill" style="margin-left:6px">bridge</span>' : ''}</span><span class="ss">${esc(p.tag)}</span></span><span class="sr"><span class="pill ${b ? 'acc' : ''}">${b ? b + ' live' : 'planned'}</span><span class="mini-bar"><i style="width:${100 * d / p.lessons.length}%"></i></span></span></a>`; }).join('')}</div></section>

    <section class="sec"><div class="sec-head"><div><span class="sec-tag">[03] Every lesson</span><h2 class="sec-title">The same eleven parts, in six tabs</h2></div></div>
      <div class="loop">
        <div class="lp"><b>LEARN</b><span>Intro, key points, key concept, step-by-step walkthrough, everyday analogy</span></div>
        <div class="lp"><b>VISUALIZE</b><span>Clickable architecture diagram, worked example with real numbers, live simulator</span></div>
        <div class="lp"><b>CODE</b><span>Production Python with the libraries teams use, plus its real captured output</span></div>
        <div class="lp"><b>LAB</b><span>A 2026-relevant micro-project with starter code, steps, hints and a solution</span></div>
        <div class="lp"><b>DESIGN</b><span>How it scales, how it fails, which trade-off you are making</span></div>
        <div class="lp"><b>CHECK</b><span>Quiz with explanations, then interview questions with model answers</span></div>
      </div></section>

    <section class="sec"><div class="sec-head"><div><span class="sec-tag">[04] Companion sites</span><h2 class="sec-title">Where the other pieces live</h2></div></div>
      <div class="notes-row">
        <div class="note sky"><b>Model internals</b><span>Tokenizers, attention, KV cache, LoRA and RLHF are taught with animated labs in AI-LLM Lab. Phases 2 and 13 link straight into it.</span><a href="${A.LLM_LAB}" target="_blank" rel="noopener">Open AI-LLM Lab ↗</a></div>
        <div class="note mint"><b>The blueprint</b><span>Every phase and lesson here comes from the curriculum doc. Edit the doc, then ask Claude to update the site from it.</span><a href="${A.BLUEPRINT}" target="_blank" rel="noopener">Open the blueprint ↗</a></div>
        <div class="note lemon"><b>Running the code</b><span>Pure-Python examples run in your browser. Anything that needs a server, Docker or an API key ships with setup commands for your laptop or Colab, and its real output shown.</span></div>
      </div></section>`;
  }

  /* ---------- PHASE ---------- */
  function renderPhase(n) {
    const p = A.PHASES[n]; if (!p) return renderHome();
    const prev = A.PHASES[n - 1], next = A.PHASES[n + 1];
    return `<article>
      <div class="ph-head"><div class="badges"><span class="pill acc">Phase ${n} / 14</span>${p.bridge ? '<span class="pill">bridge to AI-LLM Lab</span>' : ''}<span class="pill fde">FDE weight ${p.weight.fde}</span><span class="pill be">Backend weight ${p.weight.be}</span></div>
      <h1>${esc(p.name)}</h1><p>${esc(p.desc)}</p></div>
      <div class="lesson-list">${p.lessons.map(([id, t]) => { const L = A.LESSONS[id];
        return `<a class="lrow ${L ? '' : 'planned'}" href="#l${id}"><span class="li">${id}</span><span><span style="font-weight:600;display:block">${esc(t)}</span><span class="lsub">${L ? esc(L.tags || '') + ' · ~' + L.minutes + ' min' : 'planned · ships in a later round'}</span></span><span>${S.done[id] ? '<span class="pill ok">✓ done</span>' : L ? '<span class="pill acc">open</span>' : '<span class="pill">soon</span>'}</span></a>`; }).join('')}</div>
      <div class="capstone"><span class="eyebrow">Phase capstone</span><p>${esc(p.capstone)}</p></div>
      <div class="pager">${prev ? `<a href="#p${prev.n}"><span class="pl">← PREVIOUS PHASE</span><span class="pt">${String(prev.n).padStart(2, '0')} · ${esc(prev.name)}</span></a>` : `<a href="#home"><span class="pl">← BACK</span><span class="pt">Overview</span></a>`}
      ${next ? `<a class="next" href="#p${next.n}"><span class="pl">NEXT PHASE →</span><span class="pt">${String(next.n).padStart(2, '0')} · ${esc(next.name)}</span></a>` : '<span></span>'}</div></article>`;
  }

  /* ---------- LESSON ---------- */
  const TABS = [['learn', 'Learn', '1–5'], ['visual', 'Visualize', '6–7'], ['code', 'Code', '8'], ['lab', 'Lab', '9'], ['design', 'Design', '10'], ['check', 'Check', '11']];
  let cur = { id: null, tab: 'learn' };
  function renderLesson(id, tab) {
    const i = idx(id); if (i < 0) return renderHome();
    const meta = ALL[i], L = A.LESSONS[id], p = A.PHASES[meta.phase];
    const prev = ALL[i - 1], next = ALL[i + 1];
    const pager = `<div class="pager">${prev ? `<a href="#l${prev.id}"><span class="pl">← PREVIOUS</span><span class="pt">${prev.id} · ${esc(prev.title)}</span></a>` : `<a href="#home"><span class="pl">← BACK</span><span class="pt">Overview</span></a>`}
      ${next ? `<a class="next" href="#l${next.id}"><span class="pl">NEXT →</span><span class="pt">${next.id} · ${esc(next.title)}</span></a>` : '<span></span>'}</div>`;
    if (!L) {
      return `<article><div class="les-head"><div class="badges"><span class="pill">Lesson ${id}</span><a class="pill acc" href="#p${p.n}" style="text-decoration:none">Phase ${p.n} · ${esc(p.name)}</a><span class="pill warn">planned</span></div>
        <h1 class="les-title">${esc(meta.title)}</h1></div>
        <div class="planned-box" style="margin-top:22px"><span class="eyebrow">Ships in a later round</span><p>This lesson is on the curriculum and will follow the same eleven-part template. It builds on everything before it in Phase ${p.n}: ${esc(p.desc)}</p>
        <p class="muted">Phase capstone: ${esc(p.capstone)}</p>${p.bridge ? `<p><a href="${A.LLM_LAB}" target="_blank" rel="noopener">Meanwhile, the model internals for this phase are in AI-LLM Lab ↗</a></p>` : ''}</div>${pager}</article>`;
    }
    tab = TABS.some(t => t[0] === tab) ? tab : 'learn';
    cur = { id, tab };
    const done = !!S.done[id];
    return `<article>
      <div class="les-head">
        <div class="badges"><span class="pill acc">Lesson ${id}</span><a class="pill" href="#p${p.n}" style="text-decoration:none">Phase ${p.n} · ${esc(p.name)}</a>${(L.roles || []).map(r => `<span class="pill ${r}">${r === 'fde' ? 'FDE' : 'AI backend'}</span>`).join('')}<span class="pill">~${L.minutes} min</span></div>
        <h1 class="les-title">${esc(L.title)}</h1>
        <p class="mental"><span class="ml">// MENTAL MODEL</span>${L.mental}</p>
        <div class="les-actions"><button class="btn sm ${done ? 'on' : ''}" id="done-btn">${done ? '✓ Completed' : '✓ Mark complete'}</button>${L.llmlab ? `<a class="btn sm" href="${A.LLM_LAB}" target="_blank" rel="noopener">Internals in AI-LLM Lab ↗</a>` : ''}</div>
      </div>
      <div class="tabs" role="tablist" aria-label="Lesson parts">${TABS.map(t => `<button role="tab" class="tab ${t[0] === tab ? 'active' : ''}" aria-selected="${t[0] === tab}" data-tab="${t[0]}">${t[1]}<span class="tn">${t[2]}</span></button>`).join('')}</div>
      <div class="panel" id="panel">${renderPanel(L, tab)}</div>${pager}</article>`;
  }

  function partHead(n, label, title) { return `<div class="card-h"><h2>${title}</h2><span class="part">Part ${n} · ${label}</span></div>`; }
  function renderPanel(L, tab) {
    if (tab === 'learn') return `
      <section class="card">${partHead(1, 'Intro', 'Why this matters')}<div class="rich prose">${L.intro}</div></section>
      <section class="card">${partHead(2, 'Key points', 'Remember these')}<ul class="bullets">${L.points.map(b => `<li>${b}</li>`).join('')}</ul></section>
      <section class="concept"><span class="part">Part 3 · Key concept</span><h3>${L.concept.title}</h3><div class="rich prose">${L.concept.body}</div></section>
      <section class="card">${partHead(4, 'Walkthrough', 'Step by step')}<div class="walk">${L.walk.map((w, k) => `<div class="walk-step"><span class="wn">${k + 1}</span><div class="wb"><h4>${w.h}</h4><div class="rich">${w.body}</div>${w.code ? codeBlock({ file: w.file || w.lang || 'python', src: w.code, lang: w.lang || 'python', sm: true, browser: !!w.browser, outKey: w.browser ? L.id + ':w' + k : null }) : ''}</div></div>`).join('')}</div></section>
      <section class="analogy"><b class="al">Part 5 · Intuitive example</b><div class="rich">${L.analogy}</div></section>
      <div class="link-row"><button class="btn volt" data-go-tab="visual">Next: visualize it →</button></div>`;
    if (tab === 'visual') return `
      <section>${partHead(6, 'Architecture', esc(L.diagram.title || 'Architecture'))}<div id="dg-host"></div></section>
      <section class="card">${partHead(7, 'Illustrated example', L.illustrated.title)}<div class="rich">${L.illustrated.body}</div></section>
      ${L.sim ? `<section><div class="card-h"><h2>Simulator</h2><span class="part">Play with it</span></div><div id="sim-host"></div></section>` : ''}
      <div class="link-row"><button class="btn volt" data-go-tab="code">Next: production code →</button></div>`;
    if (tab === 'code') return `
      <section>${partHead(8, 'Production code', esc(L.code.title || 'Production code'))}
        <div class="rich prose" style="margin-bottom:12px">${L.code.intro || ''}</div>
        ${L.code.deps ? `<p class="deps" style="margin-bottom:10px">Install: <code>${esc(L.code.deps)}</code></p>` : ''}
        ${codeBlock({ file: L.code.file, src: L.code.src, lang: L.code.lang || 'python', browser: !!L.code.browser, outKey: L.id + ':code' })}
        ${(L.code.more || []).map(c => `<div style="margin-top:14px">${c.note ? `<p class="muted" style="margin-bottom:8px">${c.note}</p>` : ''}${codeBlock({ file: c.file, src: c.src, lang: c.lang || 'python', browser: !!c.browser, outKey: c.key ? L.id + ':' + c.key : null })}</div>`).join('')}
        ${L.code.browser ? '<p class="rt-note" style="margin-top:8px">Run here uses Python compiled to WebAssembly, inside your browser. The first run downloads about 12 MB once.</p>' : ''}
      </section>
      <div class="link-row"><button class="btn volt" data-go-tab="lab">Next: the lab →</button></div>`;
    if (tab === 'lab') { const lab = L.lab; const st = S.steps[L.id] || {}; const draft = S.drafts[L.id];
      return `
      <section class="card hard">${partHead(9, 'Micro-lab', esc(lab.title))}
        <div class="lab-grid">
          <div class="scenario"><span class="sc-l">Scenario · ${lab.browser ? 'runs in your browser' : 'runs on your laptop or Colab'}</span><div class="rich">${lab.scenario}</div></div>
          <div><h4 style="margin:0 0 8px">Steps</h4><ol class="steps">${lab.steps.map((s, k) => `<li class="${st[k] ? 'done' : ''}"><input type="checkbox" id="st-${L.id.replace('.', '-')}-${k}" data-step="${k}" ${st[k] ? 'checked' : ''}><span><label for="st-${L.id.replace('.', '-')}-${k}">${s}</label></span></li>`).join('')}</ol></div>
          ${lab.setup ? `<div><h4 style="margin:0 0 8px">Setup</h4>${codeBlock({ file: 'terminal', src: lab.setup, lang: 'bash', sm: true })}</div>` : ''}
          <div class="code"><div class="code-bar"><span class="fn">${esc(lab.file || 'lab.py')} · starter (editable)</span><span class="cb-actions">${lab.browser ? '<button class="cbtn run" id="lab-run">▶ Run here</button>' : ''}<button class="cbtn" id="lab-reset">Reset</button><button class="cbtn" id="lab-copy">Copy</button></span></div>
            <textarea class="editor" id="lab-ed" spellcheck="false" aria-label="Lab code editor">${esc(draft != null ? draft : lab.starter)}</textarea>
            <div class="out" id="lab-out" hidden><div class="out-h"><span class="src">Output</span></div><pre class="sm"></pre></div></div>
          ${lab.checks ? `<div class="callout ok"><b>Done when</b><ul style="margin:6px 0 0;padding-left:18px">${lab.checks.map(c => `<li>${c}</li>`).join('')}</ul></div>` : ''}
          ${(lab.hints || []).length ? `<details class="reveal"><summary>Hints</summary><div class="rv"><ul class="bullets">${lab.hints.map(h => `<li>${h}</li>`).join('')}</ul></div></details>` : ''}
          <details class="reveal"><summary>Reference solution</summary><div class="rv">${codeBlock({ file: (lab.file || 'lab.py') + ' · solution', src: lab.solution, lang: lab.lang || 'python', browser: !!lab.browser, outKey: L.id + ':lab', sm: true })}</div></details>
        </div></section>
      <div class="link-row"><button class="btn volt" data-go-tab="design">Next: system design →</button></div>`; }
    if (tab === 'design') { const d = L.design;
      const col = (k, cls, label) => (d[k] || []).map(x => `<div class="to ${cls}"><span class="tl">${label}</span><h4>${x.h}</h4><p>${x.p}</p></div>`).join('');
      return `
      <section class="card">${partHead(10, 'System design', 'At scale')}<div class="rich prose">${d.lead}</div></section>
      <div class="tradeoffs">${col('scale', 'scale', 'How it scales')}${col('fail', 'fail', 'How it fails')}${col('trade', 'trade', 'Trade-off')}</div>
      ${d.prompt ? `<section class="card"><div class="card-h"><h3>Design prompt</h3><span class="part">Practice out loud</span></div><div class="rich">${d.prompt}</div>${d.answer ? `<details class="reveal" style="margin-top:12px"><summary>A strong answer covers</summary><div class="rv rich">${d.answer}</div></details>` : ''}</section>` : ''}
      <div class="link-row"><button class="btn volt" data-go-tab="check">Next: check yourself →</button></div>`; }
    if (tab === 'check') { const qs = S.quiz[L.id] || {};
      return `
      <section>${partHead(11, 'Check yourself', 'Quiz')}<div class="quiz">${L.quiz.map((q, k) => {
        const pick = qs[k];
        return `<div class="q" data-q="${k}"><span class="qn">Q${k + 1} / ${L.quiz.length}</span><div class="qt">${q.q}</div><div class="opts">${q.o.map((o, j) => `<button class="opt ${pick != null ? (j === q.a ? 'right' : (j === pick ? 'wrong' : '')) : ''}" data-opt="${j}"><span class="ok-k">${'ABCD'[j]}</span><span>${o}</span></button>`).join('')}</div>${pick != null ? `<p class="why ${pick === q.a ? '' : 'bad'}">${pick === q.a ? 'Correct. ' : 'Not quite. '}${q.why}</p>` : ''}</div>`; }).join('')}</div>
        <p class="score" id="score" style="margin-top:12px"></p></section>
      <section><div class="card-h"><h2>Interview questions</h2><span class="part">Say the answer out loud first</span></div><div class="iq">${L.interview.map((x, k) => `<details class="reveal"><summary>${x.q}</summary><div class="rv rich">${x.a}</div></details>`).join('')}</div></section>
      <div class="link-row"><button class="btn ${S.done[L.id] ? 'on' : 'volt'}" id="done-btn-2">${S.done[L.id] ? '✓ Completed' : '✓ Mark lesson complete'}</button></div>`; }
    return '';
  }

  function afterLesson(L, tab) {
    if (tab === 'visual') { A.diagram($('#dg-host'), L.diagram); if (L.sim && A.SIMS[L.sim]) A.SIMS[L.sim]($('#sim-host')); }
    if (tab === 'check') updateScore(L);
  }
  function updateScore(L) {
    const qs = S.quiz[L.id] || {}; const n = Object.keys(qs).length; const r = L.quiz.filter((q, k) => qs[k] === q.a).length;
    const el = $('#score'); if (el) el.textContent = n ? `Score ${r} / ${L.quiz.length}${n < L.quiz.length ? ' · ' + (L.quiz.length - n) + ' left' : ''}` : '';
  }
  function toggleDone(id) {
    S.done[id] = !S.done[id]; if (!S.done[id]) delete S.done[id]; save();
    toast(S.done[id] ? 'Lesson ' + id + ' marked complete' : 'Lesson ' + id + ' reopened');
    renderSidebar(); route(true);
  }

  /* ---------- router ---------- */
  function parse(h) {
    h = (h || '').replace(/^#/, '');
    let m;
    if ((m = h.match(/^l(\d+\.\d+)(?:-(\w+))?$/))) return { v: 'lesson', id: m[1], tab: m[2] };
    if ((m = h.match(/^p(\d+)$/))) return { v: 'phase', n: +m[1] };
    return { v: 'home' };
  }
  function route(keepScroll) {
    const r = parse(location.hash); const main = $('#main'); const y = window.scrollY;
    if (r.v === 'lesson') {
      const tab = r.tab || (cur.id === r.id ? cur.tab : 'learn');
      main.innerHTML = renderLesson(r.id, tab);
      const L = A.LESSONS[r.id]; if (L) afterLesson(L, cur.tab);
      const ph = ALL[idx(r.id)]; if (ph && !S.open[ph.phase]) { S.open[ph.phase] = true; save(); renderSidebar(); }
      markActive('l' + r.id); document.title = 'AI Systems Academy';
      $('#mtop-title').textContent = 'Lesson ' + r.id;
    } else if (r.v === 'phase') {
      main.innerHTML = renderPhase(r.n); markActive('p' + r.n);
      if (!S.open[r.n]) { S.open[r.n] = true; save(); renderSidebar(); markActive('p' + r.n); }
      $('#mtop-title').textContent = 'Phase ' + r.n;
    } else { main.innerHTML = renderHome(); markActive('home'); $('#mtop-title').textContent = 'Overview'; }
    document.body.classList.remove('nav-open');
    if (keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
  }
  function setTab(tab) {
    const L = A.LESSONS[cur.id]; if (!L) return;
    cur.tab = tab;
    $$('.tab').forEach(t => { const on = t.dataset.tab === tab; t.classList.toggle('active', on); t.setAttribute('aria-selected', on); });
    $('#panel').innerHTML = renderPanel(L, tab); afterLesson(L, tab);
    const tabs = $('.tabs'); if (tabs && tabs.getBoundingClientRect().top < 0) tabs.scrollIntoView({ block: 'start' });
  }

  /* ---------- events ---------- */
  document.addEventListener('click', e => {
    const t = e.target.closest('button, a'); if (!t) return;
    if (t.dataset.toggle != null) { const n = t.dataset.toggle; S.open[n] = !S.open[n]; save(); const g = t.closest('.ph-group'); g.classList.toggle('open', !!S.open[n]); t.setAttribute('aria-expanded', !!S.open[n]); return; }
    if (t.dataset.tab) { setTab(t.dataset.tab); return; }
    if (t.dataset.goTab) { setTab(t.dataset.goTab); window.scrollTo({ top: $('.tabs').offsetTop - 70, behavior: 'smooth' }); return; }
    if (t.dataset.copy) { copyText(CODES[t.dataset.copy].src); return; }
    if (t.dataset.run) { runCode(t.dataset.run); return; }
    if (t.id === 'done-btn' || t.id === 'done-btn-2') { toggleDone(cur.id); return; }
    if (t.id === 'theme-btn' || t.id === 'theme-btn-m') { toggleTheme(); return; }
    if (t.id === 'menu-btn') { document.body.classList.toggle('nav-open'); return; }
    if (t.dataset.opt != null) {
      const q = t.closest('.q'); const k = +q.dataset.q; const L = A.LESSONS[cur.id];
      S.quiz[cur.id] = S.quiz[cur.id] || {}; S.quiz[cur.id][k] = +t.dataset.opt; save();
      const qq = L.quiz[k]; const pick = +t.dataset.opt;
      $$('.opt', q).forEach((b, j) => { b.classList.toggle('right', j === qq.a); b.classList.toggle('wrong', j === pick && j !== qq.a); });
      let why = $('.why', q); if (!why) { why = document.createElement('p'); q.appendChild(why); }
      why.className = 'why' + (pick === qq.a ? '' : ' bad'); why.textContent = (pick === qq.a ? 'Correct. ' : 'Not quite. ') + qq.why.replace(/<[^>]+>/g, '');
      updateScore(L); return;
    }
    if (t.id === 'lab-run') { runLab(); return; }
    if (t.id === 'lab-reset') { const L = A.LESSONS[cur.id]; $('#lab-ed').value = L.lab.starter; delete S.drafts[cur.id]; save(); toast('Starter code restored'); return; }
    if (t.id === 'lab-copy') { copyText($('#lab-ed').value); return; }
  });
  document.addEventListener('change', e => {
    const c = e.target; if (c.dataset && c.dataset.step != null) {
      S.steps[cur.id] = S.steps[cur.id] || {}; S.steps[cur.id][c.dataset.step] = c.checked; save();
      c.closest('li').classList.toggle('done', c.checked);
    }
  });
  let dt;
  document.addEventListener('input', e => {
    if (e.target.id === 'lab-ed') { clearTimeout(dt); dt = setTimeout(() => { S.drafts[cur.id] = e.target.value; save(); }, 400); }
    if (e.target.id === 'side-q') search(e.target.value);
  });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); const q = $('#side-q'); document.body.classList.add('nav-open'); q.focus(); }
    if (e.target.id === 'side-q' && e.key === 'Enter') { const a = $$('#side-nav .side-link[data-search]').find(x => !x.classList.contains('hidden')); if (a) location.hash = a.getAttribute('href'); }
    if (e.target.id === 'lab-ed' && e.key === 'Tab') { e.preventDefault(); const t = e.target, s = t.selectionStart; t.value = t.value.slice(0, s) + '    ' + t.value.slice(t.selectionEnd); t.selectionStart = t.selectionEnd = s + 4; }
    if (e.key === 'Escape') document.body.classList.remove('nav-open');
  });
  async function runLab() {
    const box = $('#lab-out'); box.hidden = false; const h = $('.out-h .src', box), pre = $('pre', box);
    h.textContent = 'Starting in-browser Python…'; h.classList.remove('live'); pre.classList.remove('err'); pre.textContent = '';
    const res = await A.py.run($('#lab-ed').value, t => { h.textContent = t; });
    if (res.ok) { h.textContent = 'Live output · your code'; h.classList.add('live'); pre.textContent = res.out || '(no output)'; }
    else if (res.unavailable) { h.textContent = 'In-browser Python is unavailable here'; pre.textContent = 'Copy the code and run it with python3 on your machine or in Colab.'; }
    else { h.textContent = 'Error in your code'; pre.classList.add('err'); pre.textContent = (res.out ? res.out + '\n' : '') + res.err; }
  }

  window.addEventListener('hashchange', () => route(false));
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
  A.boot = function () { applyTheme(); renderSidebar(); route(false); };
})();

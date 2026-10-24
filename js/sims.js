/* Lesson simulators. Each SIMS[name](host) builds controls, an SVG stage and a metrics strip. */
(function () {
  const A = window.AISA;
  const esc = s => A.esc(s);
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function shell(host, cfg, update) {
    const st = {};
    const ctl = cfg.controls.map(c => {
      st[c.id] = c.value;
      if (c.type === 'seg') return `<div class="sim-cg wide"><label>${esc(c.label)}</label><div class="seg" data-seg="${c.id}">${c.options.map(o => `<button class="${o[0] === c.value ? 'on' : ''}" data-v="${o[0]}">${esc(o[1])}</button>`).join('')}</div></div>`;
      return `<div class="sim-cg"><label for="${cfg.id}-${c.id}">${esc(c.label)} <output id="${cfg.id}-${c.id}-o"></output></label><input type="range" id="${cfg.id}-${c.id}" data-k="${c.id}" min="${c.min}" max="${c.max}" step="${c.step || 1}" value="${c.value}"></div>`;
    }).join('');
    host.innerHTML = `<div class="sim"><div class="sim-top"><span class="sim-title">${esc(cfg.title)}</span>${cfg.action ? `<button class="btn sm volt" data-act>${esc(cfg.action)}</button>` : ''}</div>
      <div class="sim-controls">${ctl}</div><div class="sim-stage"></div>
      <div class="sim-metrics">${cfg.metrics.map(m => `<div class="sim-m"><div class="v" data-m="${m[0]}">–</div><div class="l">${esc(m[1])}</div></div>`).join('')}</div>
      <div class="sim-cap"></div></div>`;
    const stage = host.querySelector('.sim-stage'), cap = host.querySelector('.sim-cap');
    const fmt = {}; cfg.controls.forEach(c => fmt[c.id] = c.fmt || (v => v));
    const M = (k, v, cls) => { const el = host.querySelector(`[data-m="${k}"]`); if (el) { el.textContent = v; el.className = 'v' + (cls ? ' ' + cls : ''); } };
    const redraw = () => { cfg.controls.forEach(c => { if (c.type !== 'seg') host.querySelector(`#${cfg.id}-${c.id}-o`).textContent = fmt[c.id](st[c.id]); }); update(st, stage, M, cap); };
    host.querySelectorAll('input[type=range]').forEach(r => r.addEventListener('input', () => { st[r.dataset.k] = +r.value; redraw(); }));
    host.querySelectorAll('[data-seg]').forEach(g => g.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; st[g.dataset.seg] = b.dataset.v; g.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); redraw(); }));
    const act = host.querySelector('[data-act]'); if (act && cfg.onAction) act.addEventListener('click', () => cfg.onAction(st, stage, M, cap, act));
    redraw();
    return st;
  }
  const svg = (w, h, inner) => `<svg viewBox="0 0 ${w} ${h}" role="img">${inner}</svg>`;
  function axes(x0, y0, x1, y1, xt, yt) {
    let s = `<line class="ax" x1="${x0}" y1="${y1}" x2="${x1}" y2="${y1}"></line><line class="ax" x1="${x0}" y1="${y0}" x2="${x0}" y2="${y1}"></line>`;
    (xt || []).forEach(t => { s += `<line class="grid" x1="${t[0]}" y1="${y0}" x2="${t[0]}" y2="${y1}"></line><text class="tx" x="${t[0]}" y="${y1 + 14}" text-anchor="middle">${t[1]}</text>`; });
    (yt || []).forEach(t => { s += `<line class="grid" x1="${x0}" y1="${t[0]}" x2="${x1}" y2="${t[0]}"></line><text class="tx" x="${x0 - 6}" y="${t[0] + 3}" text-anchor="end">${t[1]}</text>`; });
    return s;
  }
  function niceStep(max, n) { const raw = max / n, p = Math.pow(10, Math.floor(Math.log10(raw))); const f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
  const SIMS = A.SIMS = {};

  /* 0.2 — fan-out: sequential vs gather vs semaphore against a provider concurrency cap */
  SIMS.fanout = host => shell(host, {
    id: 'fo', title: 'Fan-out lab · 50 LLM calls vs a provider limit',
    controls: [
      { id: 'mode', type: 'seg', label: 'Strategy', value: 'sem', options: [['seq', 'for-loop await'], ['gather', 'gather (no cap)'], ['sem', 'Semaphore']] },
      { id: 'n', label: 'Calls', min: 10, max: 100, value: 50 },
      { id: 'lat', label: 'Latency per call', min: 200, max: 2000, step: 50, value: 500, fmt: v => v + ' ms' },
      { id: 'lim', label: 'Semaphore limit', min: 1, max: 20, value: 8 },
      { id: 'cap', label: 'Provider concurrent cap', min: 4, max: 20, value: 10 } ],
    metrics: [['wall', 'Wall time'], ['peak', 'Peak in-flight'], ['err', '429 errors'], ['tput', 'Calls / second']]
  }, (s, stage, M, cap) => {
    const r = rng(7), N = s.n; const lat = Array.from({ length: N }, () => s.lat * (0.8 + 0.5 * r()));
    const ev = []; // {start, end, fail}
    if (s.mode === 'seq') { let t = 0; lat.forEach(l => { ev.push({ start: t, end: t + l, fail: false }); t += l; }); }
    else {
      const k = s.mode === 'gather' ? N : s.lim; const slots = Array(Math.min(k, N)).fill(0); const active = [];
      lat.forEach((l, i) => {
        let j = 0; for (let q = 1; q < slots.length; q++) if (slots[q] < slots[j]) j = q;
        const start = slots[j];
        const inflight = ev.filter(e => !e.fail && e.start <= start && e.end > start).length;
        const fail = inflight >= s.cap; const end = start + (fail ? 40 : l);
        ev.push({ start, end, fail }); slots[j] = end;
      });
    }
    const wall = Math.max(...ev.map(e => e.end)); let peak = 0;
    ev.forEach(e => { const c = ev.filter(x => !x.fail && x.start <= e.start && x.end > e.start).length; peak = Math.max(peak, c); });
    const err = ev.filter(e => e.fail).length;
    const W = 760, top = 10, rowH = Math.max(2.4, Math.min(6, 300 / N)), H = top + N * rowH + 30, x0 = 40, x1 = W - 10;
    const sx = t => x0 + (x1 - x0) * t / wall;
    const st = niceStep(wall / 1000, 6); const xt = []; for (let v = 0; v <= wall / 1000 + 1e-9; v += st) xt.push([sx(v * 1000), (+v.toFixed(2)) + 's']);
    let bars = ev.map((e, i) => `<rect class="${e.fail ? 'b-bad' : 'b-acc'}" x="${sx(e.start).toFixed(1)}" y="${(top + i * rowH).toFixed(1)}" width="${Math.max(1.5, sx(e.end) - sx(e.start)).toFixed(1)}" height="${Math.max(1.2, rowH - 1).toFixed(1)}"></rect>`).join('');
    stage.innerHTML = svg(W, H, axes(x0, top, x1, top + N * rowH + 4, xt, [[top + 4, '#1'], [top + N * rowH, '#' + N]]) + bars);
    M('wall', (wall / 1000).toFixed(2) + ' s', wall > 10000 ? 'warn' : ''); M('peak', peak, peak >= s.cap ? 'bad' : 'ok'); M('err', err, err ? 'bad' : 'ok'); M('tput', ((N - err) / (wall / 1000)).toFixed(1));
    cap.innerHTML = s.mode === 'seq' ? 'One call at a time: safe, but wall time is the sum of every latency.' :
      s.mode === 'gather' ? `Everything starts at once. The provider accepts ${s.cap} concurrent requests and rejects the rest with 429 (red), which you then have to retry.` :
      (s.lim >= s.cap ? `The limit is at or above the provider cap, so some requests still get 429. Keep the semaphore below the cap.` : `At most ${s.lim} calls in flight: near-gather speed with zero 429s. This is the production pattern.`);
  });

  /* 0.7 — SQL window functions on a tiny ticket table */
  const TK = [['acme', 1, 1200], ['acme', 2, 800], ['acme', 3, 2100], ['acme', 4, 800], ['globex', 1, 500], ['globex', 2, 1500], ['globex', 3, 900], ['initech', 1, 3000], ['initech', 2, 1000]];
  SIMS.window = host => shell(host, {
    id: 'wf', title: 'Window functions · token usage per customer per day',
    controls: [
      { id: 'fn', type: 'seg', label: 'Function', value: 'run', options: [['rn', 'ROW_NUMBER'], ['rank', 'RANK'], ['run', 'running SUM'], ['lag', 'LAG diff'], ['avg', 'moving AVG(3)']] },
      { id: 'part', type: 'seg', label: 'Partition', value: 'cust', options: [['cust', 'BY customer'], ['none', 'whole table']] } ],
    metrics: [['rows', 'Rows in'], ['rowsout', 'Rows out'], ['parts', 'Partitions']]
  }, (s, stage, M, cap) => {
    const rows = TK.map(r => ({ c: r[0], d: r[1], t: r[2] }));
    const key = r => s.part === 'cust' ? r.c : '*';
    const groups = {}; rows.forEach(r => (groups[key(r)] = groups[key(r)] || []).push(r));
    const order = s.fn === 'rank' ? (a, b) => b.t - a.t : (a, b) => a.d - b.d || a.c.localeCompare(b.c);
    Object.values(groups).forEach(g => {
      g.sort(order);
      g.forEach((r, i) => {
        if (s.fn === 'rn') r.v = i + 1;
        if (s.fn === 'rank') r.v = g.findIndex(x => x.t === r.t) + 1;
        if (s.fn === 'run') r.v = g.slice(0, i + 1).reduce((a, x) => a + x.t, 0);
        if (s.fn === 'lag') r.v = i ? r.t - g[i - 1].t : null;
        if (s.fn === 'avg') { const w = g.slice(Math.max(0, i - 2), i + 1); r.v = Math.round(w.reduce((a, x) => a + x.t, 0) / w.length); }
      });
    });
    const P = s.part === 'cust' ? 'PARTITION BY customer ' : '';
    const expr = { rn: `ROW_NUMBER() OVER (${P}ORDER BY day)`, rank: `RANK() OVER (${P}ORDER BY tokens DESC)`, run: `SUM(tokens) OVER (${P}ORDER BY day)`, lag: `tokens - LAG(tokens) OVER (${P}ORDER BY day)`, avg: `AVG(tokens) OVER (${P}ORDER BY day ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)` }[s.fn];
    const out = Object.values(groups).flat();
    const tones = { acme: 'var(--accent)', globex: 'var(--be)', initech: 'var(--fde)', '*': 'var(--text-3)' };
    stage.innerHTML = `<div class="code" style="margin-bottom:12px"><pre class="sm">${A.hl(`SELECT customer, day, tokens,\n       ${expr} AS value\nFROM usage;`, 'sql')}</pre></div>
      <div class="tbl"><table class="t"><thead><tr><th>customer</th><th>day</th><th>tokens</th><th>value</th></tr></thead><tbody>${out.map((r, i) => {
        const first = i === 0 || key(out[i - 1]) !== key(r);
        return `<tr style="${first && i ? 'border-top:2px solid var(--line-dash)' : ''}"><td><span style="display:inline-block;width:8px;height:8px;background:${tones[r.c]};margin-right:8px"></span>${r.c}</td><td class="n">${r.d}</td><td class="n">${r.t}</td><td class="n" style="color:var(--accent);font-weight:700">${r.v == null ? 'NULL' : r.v}</td></tr>`; }).join('')}</tbody></table></div>`;
    M('rows', rows.length); M('rowsout', out.length, 'ok'); M('parts', Object.keys(groups).length);
    cap.innerHTML = 'Unlike GROUP BY, a window keeps every row and adds a computed column. PARTITION BY restarts the calculation for each customer; ORDER BY decides what "previous" and "running" mean.';
  });

  /* 1.2 — blocking vs streaming response */
  const TEXT = 'Ticket #4812 looks like a billing duplicate. The customer was charged twice on 14 October for the Pro plan. Refund the second charge, reply with the refund reference, and tag the ticket billing/duplicate so the weekly report counts it. Escalate only if the card was charged a third time.';
  SIMS.sse = host => {
    let raf = null;
    const st = shell(host, {
      id: 'ss', title: 'Perceived latency · blocking JSON vs server-sent events', action: '▶ Play both',
      controls: [
        { id: 'ttft', label: 'Time to first token', min: 100, max: 3000, step: 50, value: 600, fmt: v => v + ' ms' },
        { id: 'tps', label: 'Decode speed', min: 10, max: 150, value: 45, fmt: v => v + ' tok/s' },
        { id: 'tok', label: 'Output tokens', min: 30, max: 800, step: 10, value: 70 } ],
      metrics: [['blk', 'Blocking: first pixel'], ['str', 'Streaming: first pixel'], ['tot', 'Total time (both)'], ['gain', 'Wait saved']],
      onAction: (s, stage) => play(s, stage)
    }, (s, stage, M, cap) => {
      if (raf) cancelAnimationFrame(raf);
      const total = s.ttft + 1000 * s.tok / s.tps;
      stage.innerHTML = panes() + timeline(s, total);
      M('blk', (total / 1000).toFixed(2) + ' s', total > 5000 ? 'bad' : 'warn'); M('str', (s.ttft / 1000).toFixed(2) + ' s', 'ok'); M('tot', (total / 1000).toFixed(2) + ' s'); M('gain', ((total - s.ttft) / 1000).toFixed(2) + ' s', 'ok');
      cap.innerHTML = 'Streaming does not make generation faster; it moves the first visible output from "end of generation" to "first token". Users judge speed by that first moment.';
    });
    function panes() { return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-bottom:12px">
      <div class="card" style="padding:12px"><div class="part" style="margin-bottom:6px">Blocking · POST /triage returns JSON</div><div class="mono" style="font-size:12.5px;min-height:96px" data-pane="b"><span class="faint">waiting…</span></div></div>
      <div class="card" style="padding:12px"><div class="part" style="margin-bottom:6px">Streaming · text/event-stream</div><div class="mono" style="font-size:12.5px;min-height:96px" data-pane="s"><span class="faint">waiting…</span></div></div></div>`; }
    function timeline(s, total) {
      const W = 760, x0 = 90, x1 = W - 10, sx = t => x0 + (x1 - x0) * t / total; const step = niceStep(total / 1000, 6); const xt = [];
      for (let v = 0; v <= total / 1000 + 1e-9; v += step) xt.push([sx(v * 1000), (+v.toFixed(2)) + 's']);
      return svg(W, 110, axes(x0, 8, x1, 84, xt, []) +
        `<text class="tx2" x="${x0 - 8}" y="32" text-anchor="end">blocking</text><rect class="b-dim" x="${x0}" y="22" width="${sx(total) - x0}" height="14"></rect><rect class="b-acc" x="${sx(total) - 4}" y="22" width="4" height="14"></rect>
         <text class="tx2" x="${x0 - 8}" y="64" text-anchor="end">streaming</text><rect class="b-dim" x="${x0}" y="54" width="${sx(s.ttft) - x0}" height="14"></rect><rect class="b-ok" x="${sx(s.ttft)}" y="54" width="${sx(total) - sx(s.ttft)}" height="14" opacity=".85"></rect>`);
    }
    function play(s, stage) {
      if (raf) cancelAnimationFrame(raf);
      const words = TEXT.split(' '); const total = s.ttft + 1000 * s.tok / s.tps; const speed = Math.max(1, total / 6000);
      const b = stage.querySelector('[data-pane=b]'), p = stage.querySelector('[data-pane=s]'); const t0 = performance.now();
      const tick = now => {
        const t = (now - t0) * speed; const frac = Math.max(0, Math.min(1, (t - s.ttft) / (total - s.ttft)));
        p.textContent = t < s.ttft ? '' : words.slice(0, Math.ceil(frac * words.length)).join(' ');
        if (t < s.ttft) p.innerHTML = '<span class="faint">waiting…</span>';
        b.innerHTML = t >= total ? esc(TEXT) : '<span class="faint">waiting… ' + (t / 1000).toFixed(1) + ' s</span>';
        if (t < total) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
  };

  /* 1.3 — JWT inspector with real HMAC verification (WebCrypto) */
  SIMS.jwt = host => {
    const TOKEN = A.SAMPLE_JWT || '';
    host.innerHTML = `<div class="sim"><div class="sim-top"><span class="sim-title">JWT inspector · decode and verify HS256</span></div>
      <div class="sim-controls" style="grid-template-columns:minmax(0,1fr)">
        <div class="sim-cg"><label for="jw-t">Token</label><textarea id="jw-t" class="editor" style="min-height:90px;white-space:pre-wrap;word-break:break-all">${esc(TOKEN)}</textarea></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px">
          <div class="sim-cg"><label for="jw-s">Signing secret</label><input id="jw-s" value="dev-only-secret-change-me-0123456789" style="background:var(--bg-2);border:1px solid var(--line-2);padding:7px 9px;font-family:var(--font-mono);font-size:12px"></div>
          <div class="sim-cg"><label>Tamper</label><div class="seg"><button data-tm="role">Make me admin</button><button data-tm="reset">Reset token</button></div></div>
          <div class="sim-cg"><label for="jw-now">Clock skew <output id="jw-now-o">+0 min</output></label><input type="range" id="jw-now" min="0" max="90" value="0"></div></div></div>
      <div class="sim-stage" id="jw-out"></div>
      <div class="sim-metrics"><div class="sim-m"><div class="v" data-m="sig">–</div><div class="l">Signature</div></div><div class="sim-m"><div class="v" data-m="exp">–</div><div class="l">Expiry</div></div><div class="sim-m"><div class="v" data-m="aud">–</div><div class="l">Audience</div></div></div>
      <div class="sim-cap">The payload is only base64url-encoded, not encrypted: anyone can read it. Trust comes from the signature, the expiry and the audience check, done on the server for every request.</div></div>`;
    const t = host.querySelector('#jw-t'), sec = host.querySelector('#jw-s'), now = host.querySelector('#jw-now'), out = host.querySelector('#jw-out');
    const b64d = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return atob(s); };
    const b64e = s => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const M = (k, v, c) => { const el = host.querySelector(`[data-m="${k}"]`); el.textContent = v; el.className = 'v ' + (c || ''); };
    async function verify(h, p, sig, key) {
      try {
        const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(h + '.' + p)));
        return b64e(String.fromCharCode(...mac)) === sig;
      } catch (e) { return null; }
    }
    async function run() {
      host.querySelector('#jw-now-o').textContent = '+' + now.value + ' min';
      const parts = t.value.trim().split('.');
      if (parts.length !== 3) { out.innerHTML = '<p class="callout">A JWT has three dot-separated parts: header.payload.signature.</p>'; return; }
      let hd, pl; try { hd = JSON.parse(b64d(parts[0])); pl = JSON.parse(b64d(parts[1])); } catch (e) { out.innerHTML = '<p class="callout">Could not decode this token.</p>'; return; }
      out.innerHTML = `<div class="mono" style="font-size:12px;word-break:break-all;margin-bottom:12px"><span style="color:var(--bad)">${esc(parts[0])}</span>.<span style="color:var(--be)">${esc(parts[1])}</span>.<span style="color:var(--accent)">${esc(parts[2])}</span></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px"><div class="code"><div class="code-bar"><span class="fn">header</span></div><pre class="sm">${esc(JSON.stringify(hd, null, 2))}</pre></div><div class="code"><div class="code-bar"><span class="fn">payload (claims)</span></div><pre class="sm">${esc(JSON.stringify(pl, null, 2))}</pre></div></div>`;
      const ok = await verify(parts[0], parts[1], parts[2], sec.value);
      M('sig', ok == null ? 'n/a' : ok ? 'valid' : 'INVALID', ok ? 'ok' : 'bad');
      const nowS = (pl.iat || 0) + 60 * (+now.value); const left = pl.exp ? pl.exp - nowS : null;
      M('exp', left == null ? 'none' : left > 0 ? Math.round(left / 60) + ' min left' : 'EXPIRED', left == null ? 'warn' : left > 0 ? 'ok' : 'bad');
      M('aud', pl.aud === 'triage-api' ? 'triage-api ✓' : (pl.aud || 'missing'), pl.aud === 'triage-api' ? 'ok' : 'bad');
    }
    host.querySelector('[data-tm=role]').onclick = () => { const p = t.value.split('.'); try { const pl = JSON.parse(b64d(p[1])); pl.role = 'admin'; p[1] = b64e(JSON.stringify(pl)); t.value = p.join('.'); run(); } catch (e) {} };
    host.querySelector('[data-tm=reset]').onclick = () => { t.value = TOKEN; run(); };
    [t, sec, now].forEach(el => el.addEventListener('input', run));
    run();
  };

  /* 1.4 — when does an index win? pages read for seq scan vs B-tree */
  SIMS.index = host => shell(host, {
    id: 'ix', title: 'Planner intuition · pages read: sequential scan vs B-tree index',
    controls: [
      { id: 'rows', label: 'Table rows (log scale)', min: 3, max: 9, step: 0.1, value: 7, fmt: v => Math.round(Math.pow(10, v)).toLocaleString() },
      { id: 'sel', label: 'Rows matched (selectivity)', min: -6, max: 0, step: 0.1, value: -4, fmt: v => (100 * Math.pow(10, v)).toPrecision(2) + '%' },
      { id: 'rpp', label: 'Rows per 8 KB page', min: 10, max: 200, value: 60 } ],
    metrics: [['seq', 'Seq scan pages'], ['idx', 'Index path pages'], ['pick', 'Planner picks'], ['depth', 'B-tree depth']]
  }, (s, stage, M, cap) => {
    const N = Math.pow(10, s.rows), m = Math.max(1, N * Math.pow(10, s.sel)), pages = N / s.rpp;
    const depth = Math.max(1, Math.ceil(Math.log(N) / Math.log(300)));
    const seq = pages, idx = depth + Math.min(pages, m) * 4; // random page reads weighted ~4x vs sequential
    const W = 760, H = 160, x0 = 140, x1 = W - 110, mx = Math.max(seq, idx), sx = v => x0 + (x1 - x0) * Math.log10(1 + v) / Math.log10(1 + mx);
    stage.innerHTML = svg(W, H, `<text class="tx2" x="${x0 - 10}" y="48" text-anchor="end">seq scan</text><rect class="${seq <= idx ? 'b-ok' : 'b-bad'}" opacity="${seq <= idx ? 1 : 0.45}" x="${x0}" y="34" width="${Math.max(2, sx(seq) - x0)}" height="20"></rect><text class="tx2" x="${x1 + 10}" y="48">${Math.round(seq).toLocaleString()}</text>
      <text class="tx2" x="${x0 - 10}" y="98" text-anchor="end">index scan</text><rect class="${idx < seq ? 'b-ok' : 'b-bad'}" opacity="${idx < seq ? 1 : 0.45}" x="${x0}" y="84" width="${Math.max(2, sx(idx) - x0)}" height="20"></rect><text class="tx2" x="${x1 + 10}" y="98">${Math.round(idx).toLocaleString()}</text>
      <text class="tx" x="${x0}" y="140">cost units, log scale · random page reads weighted 4× (Postgres random_page_cost default)</text>`);
    M('seq', Math.round(seq).toLocaleString()); M('idx', Math.round(idx).toLocaleString()); M('pick', idx < seq ? 'Index Scan' : 'Seq Scan', idx < seq ? 'ok' : 'warn'); M('depth', depth);
    cap.innerHTML = idx < seq ? `Matching ${Math.round(m).toLocaleString()} rows: walking ${depth} B-tree levels and fetching only matching pages beats reading the whole table.` : `Matching ${Math.round(m).toLocaleString()} rows is too large a share: random index lookups would cost more than one sequential pass, so Postgres ignores the index. Indexes help selective predicates.`;
  });

  /* 1.5 — token bucket rate limiter */
  SIMS.bucket = host => shell(host, {
    id: 'tb', title: 'Token bucket · per-tenant rate limit over 20 seconds',
    controls: [
      { id: 'cap', label: 'Bucket capacity (burst)', min: 1, max: 60, value: 20 },
      { id: 'rate', label: 'Refill rate', min: 1, max: 30, value: 5, fmt: v => v + ' tokens/s' },
      { id: 'rps', label: 'Incoming requests', min: 1, max: 40, value: 9, fmt: v => v + ' req/s avg' },
      { id: 'pat', type: 'seg', label: 'Traffic shape', value: 'burst', options: [['steady', 'steady'], ['burst', 'bursty']] } ],
    metrics: [['acc', 'Accepted'], ['rej', 'Rejected (429)'], ['pct', 'Accept rate'], ['lt', 'Long-run cap']]
  }, (s, stage, M, cap) => {
    const r = rng(11), dt = 0.1, T = 20; let tokens = s.cap, acc = 0, rej = 0; const lvl = [], perS = Array.from({ length: T }, () => [0, 0]);
    for (let i = 0; i < T / dt; i++) {
      const t = i * dt; tokens = Math.min(s.cap, tokens + s.rate * dt);
      const burstOn = s.pat === 'burst' ? ((Math.floor(t) % 5) < 1 ? 4.2 : 0.2) : 1;
      let lam = s.rps * dt * burstOn, n = 0; while (lam > 0) { if (r() < Math.min(1, lam)) n++; lam -= 1; }
      for (let k = 0; k < n; k++) { if (tokens >= 1) { tokens -= 1; acc++; perS[Math.floor(t)][0]++; } else { rej++; perS[Math.floor(t)][1]++; } }
      lvl.push([t, tokens]);
    }
    const W = 760, H = 250, x0 = 40, x1 = W - 10, y0 = 26, y1 = 210; const maxB = Math.max(10, ...perS.map(p => p[0] + p[1]));
    const sx = t => x0 + (x1 - x0) * t / T, sy = v => y1 - (y1 - y0) * v / maxB, sl = v => y1 - (y1 - y0) * v / s.cap;
    const bars = perS.map((p, i) => { const bw = (x1 - x0) / T * 0.6, x = sx(i) + (x1 - x0) / T * 0.2; return `<rect class="b-ok" x="${x}" y="${sy(p[0])}" width="${bw}" height="${y1 - sy(p[0])}" opacity=".75"></rect><rect class="b-bad" x="${x}" y="${sy(p[0] + p[1])}" width="${bw}" height="${sy(p[0]) - sy(p[0] + p[1])}" opacity=".85"></rect>`; }).join('');
    const line = 'M' + lvl.map(p => `${sx(p[0]).toFixed(1)},${sl(p[1]).toFixed(1)}`).join(' L');
    const xt = [0, 5, 10, 15, 20].map(v => [sx(v), v + 's']); const yst = niceStep(maxB, 4); const yt = []; for (let v = 0; v <= maxB; v += yst) yt.push([sy(v), v]);
    stage.innerHTML = svg(W, H, axes(x0, y0, x1, y1, xt, yt) + bars + `<path class="s-acc" d="${line}"></path>
      <text class="tx" x="${x0}" y="12">bars: requests per second (green accepted, red 429) · line: tokens left in the bucket</text>`);
    M('acc', acc, 'ok'); M('rej', rej, rej ? 'bad' : 'ok'); M('pct', Math.round(100 * acc / Math.max(1, acc + rej)) + '%'); M('lt', s.rate + ' req/s');
    cap.innerHTML = `Capacity sets how big a burst is absorbed; refill rate sets the long-run ceiling. Over 20 s a tenant can never exceed ${s.cap} + ${s.rate}×20 = ${s.cap + s.rate * 20} requests.`;
  });

  /* 1.6 — queue depth: arrivals vs workers (Little's law) */
  SIMS.queue = host => shell(host, {
    id: 'qq', title: 'Background queue · 60 minutes of document-ingest jobs',
    controls: [
      { id: 'lam', label: 'Arrivals', min: 10, max: 400, step: 5, value: 120, fmt: v => v + ' jobs/min' },
      { id: 'dur', label: 'Job duration', min: 1, max: 30, value: 6, fmt: v => v + ' s' },
      { id: 'w', label: 'Workers', min: 1, max: 40, value: 10 } ],
    metrics: [['rho', 'Utilization ρ'], ['max', 'Max queue depth'], ['wait', 'Avg wait'], ['need', 'Workers needed']]
  }, (s, stage, M, cap) => {
    const r = rng(3); const steps = 60 * 60; let q = 0, busy = []; const depth = []; let waitSum = 0, served = 0; const queue = [];
    for (let t = 0; t < steps; t++) {
      let lam = s.lam / 60; let n = 0; while (lam > 0) { if (r() < Math.min(1, lam)) n++; lam -= 1; }
      for (let k = 0; k < n; k++) queue.push(t);
      busy = busy.filter(e => e > t);
      while (busy.length < s.w && queue.length) { const at = queue.shift(); waitSum += t - at; served++; busy.push(t + s.dur * (0.6 + 0.8 * r())); }
      if (t % 30 === 0) depth.push([t / 60, queue.length]);
    }
    const rho = s.lam * s.dur / (60 * s.w); const mx = Math.max(5, ...depth.map(d => d[1]));
    const W = 760, H = 232, x0 = 46, x1 = W - 10, y0 = 26, y1 = 202, sx = v => x0 + (x1 - x0) * v / 60, sy = v => y1 - (y1 - y0) * v / mx;
    const path = 'M' + depth.map(d => `${sx(d[0]).toFixed(1)},${sy(d[1]).toFixed(1)}`).join(' L');
    const area = path + ` L${sx(60)},${y1} L${sx(0)},${y1} Z`;
    const yst = niceStep(mx, 4); const yt = []; for (let v = 0; v <= mx; v += yst) yt.push([sy(v), Math.round(v)]);
    stage.innerHTML = svg(W, H, axes(x0, y0, x1, y1, [0, 10, 20, 30, 40, 50, 60].map(v => [sx(v), v + 'm']), yt) + `<path d="${area}" class="${rho >= 1 ? 'b-bad' : 'b-acc'}" opacity=".18"></path><path d="${path}" class="${rho >= 1 ? 's-bad' : 's-acc'}"></path><text class="tx" x="${x0}" y="12">jobs waiting in the queue, sampled every 30 s</text>`);
    const need = Math.ceil(s.lam * s.dur / 60 / 0.7);
    M('rho', rho.toFixed(2), rho >= 1 ? 'bad' : rho > 0.8 ? 'warn' : 'ok'); M('max', mx, rho >= 1 ? 'bad' : ''); M('wait', (waitSum / Math.max(1, served)).toFixed(1) + ' s'); M('need', need + ' @70%');
    cap.innerHTML = rho >= 1 ? 'Arrivals exceed what the workers can process (ρ ≥ 1): the queue grows without limit. Add workers, shorten jobs, or shed load.' : rho > 0.8 ? 'Stable but running hot: small bursts cause long waits because waiting time climbs steeply as ρ approaches 1.' : 'Comfortable headroom. Size worker pools for about 70% utilization so bursts drain quickly.';
  });


  /* 2.1 — temperature and top-p on a next-token distribution */
  SIMS.sampling = host => shell(host, {
    id: 'sp', title: 'Next-token sampling · temperature and top-p',
    controls: [
      { id: 't', label: 'Temperature', min: 0.05, max: 2, step: 0.05, value: 1, fmt: v => (+v).toFixed(2) },
      { id: 'p', label: 'Top-p', min: 0.1, max: 1, step: 0.05, value: 1, fmt: v => (+v).toFixed(2) } ],
    metrics: [['top', 'P(top token)'], ['kept', 'Tokens kept'], ['flip', 'Not top token (500 draws)'], ['ent', 'Entropy (bits)']]
  }, (s, stage, M, cap) => {
    const toks = ['billing', 'bug', 'refund', 'other', 'account', 'spam'], logits = [3.1, 2.4, 2.1, 1.0, 0.6, -1.2];
    const mx = Math.max(...logits), ex = logits.map(l => Math.exp((l - mx) / s.t)), z = ex.reduce((a, b) => a + b, 0);
    let p = ex.map(e => e / z); const order = p.map((v, i) => i).sort((a, b) => p[b] - p[a]);
    const keep = new Set(); let cum = 0; for (const i of order) { keep.add(i); cum += p[i]; if (cum >= s.p - 1e-9) break; }
    const zz = [...keep].reduce((a, i) => a + p[i], 0); p = p.map((v, i) => keep.has(i) ? v / zz : 0);
    const r = rng(9), counts = Array(6).fill(0);
    for (let k = 0; k < 500; k++) { let u = r(), acc = 0; for (let i = 0; i < 6; i++) { acc += p[i]; if (u <= acc) { counts[i]++; break; } } }
    const W = 760, H = 230, x0 = 40, y0 = 14, y1 = 190, bw = 90, gap = (W - x0 - 20 - bw * 6) / 5;
    let bars = '';
    toks.forEach((t, i) => {
      const x = x0 + i * (bw + gap), h = (y1 - y0) * p[i], hc = (y1 - y0) * counts[i] / 500;
      bars += `<rect class="${keep.has(i) ? 'b-acc' : 'b-dim'}" x="${x}" y="${y1 - h}" width="${bw * 0.55}" height="${Math.max(1, h)}"></rect>`;
      bars += `<rect class="b-be" opacity=".8" x="${x + bw * 0.58}" y="${y1 - hc}" width="${bw * 0.35}" height="${Math.max(1, hc)}"></rect>`;
      bars += `<text class="tx2" x="${x + bw / 2}" y="${y1 + 16}" text-anchor="middle">${t}</text><text class="tx" x="${x + bw * 0.27}" y="${y1 - h - 5}" text-anchor="middle">${(p[i] * 100).toFixed(0)}%</text>`;
    });
    stage.innerHTML = svg(W, H, axes(x0 - 10, y0, W - 10, y1, [], [[y1, '0'], [y0 + (y1 - y0) / 2, '50%'], [y0, '100%']]) + bars + `<text class="tx" x="${W - 10}" y="${y0 + 4}" text-anchor="end">left bar: probability after T and top-p · right bar: share of 500 seeded draws</text>`);
    const ent = -p.reduce((a, v) => a + (v > 0 ? v * Math.log2(v) : 0), 0);
    M('top', (p[0] * 100).toFixed(1) + '%'); M('kept', keep.size + ' / 6'); M('flip', ((500 - counts[0]) / 5).toFixed(1) + '%', counts[0] > 450 ? 'ok' : 'warn'); M('ent', ent.toFixed(2));
    cap.innerHTML = s.t < 0.3 ? 'Low temperature concentrates probability on the top token: near-deterministic, right for classification and tool arguments.' : s.t > 1.3 ? 'High temperature flattens the distribution: varied, sometimes odd choices. Top-p trims the tail to keep it sane.' : 'Default-ish settings: the top token usually wins, but close alternatives are picked often enough to cause flips on borderline inputs.';
  });

  /* 2.3 — latency and cost of one call */
  SIMS.latency = host => shell(host, {
    id: 'lt', title: 'One LLM call · where the time and money go',
    controls: [
      { id: 'inp', label: 'Input tokens', min: 200, max: 100000, step: 100, value: 6000, fmt: v => (+v).toLocaleString() },
      { id: 'out', label: 'Output tokens', min: 1, max: 2000, step: 1, value: 400 },
      { id: 'cache', label: 'Cached prefix share', min: 0, max: 0.95, step: 0.05, value: 0, fmt: v => Math.round(v * 100) + '%' },
      { id: 'dec', label: 'Decode speed', min: 10, max: 300, step: 5, value: 60, fmt: v => v + ' tok/s' },
      { id: 'q', label: 'Queue wait', min: 0, max: 2000, step: 50, value: 100, fmt: v => v + ' ms' } ],
    metrics: [['ttft', 'TTFT'], ['tot', 'Total'], ['usd', 'Cost per call'], ['m', 'Per 1M calls']]
  }, (s, stage, M, cap) => {
    const RTT = 0.1, PRE = 8000, PIN = 3, POUT = 15; const cached = s.inp * s.cache, fresh = s.inp - cached;
    const pre = (fresh + cached * 0.1) / PRE, q = s.q / 1000, dec = s.out / s.dec, ttft = RTT + q + pre, tot = ttft + dec;
    const usd = (fresh * PIN + cached * PIN * 0.1 + s.out * POUT) / 1e6;
    const W = 760, H = 120, x0 = 20, x1 = W - 20, sx = v => x0 + (x1 - x0) * v / tot;
    const segs = [['network', RTT, 'b-dim'], ['queue', q, 'b-warn'], ['prefill', pre, 'b-acc'], ['decode', dec, 'b-be']];
    let x = 0, bars = '';
    segs.forEach(([n, v, c]) => { if (v <= 0) return; const w = sx(x + v) - sx(x); bars += `<rect class="${c}" x="${sx(x)}" y="30" width="${Math.max(1, w)}" height="34" opacity=".9"></rect>` + (w > 60 ? `<text class="tx2" x="${sx(x) + 6}" y="51" style="fill:var(--bg)">${n} ${v.toFixed(2)}s</text>` : ''); x += v; });
    stage.innerHTML = svg(W, H, bars + `<line x1="${sx(ttft)}" x2="${sx(ttft)}" y1="20" y2="74" stroke="var(--text)" stroke-dasharray="3 3"></line><text class="tx2" x="${sx(ttft)}" y="14" text-anchor="middle">first token</text><text class="tx" x="${x0}" y="96">network · queue (amber) · prefill (violet) · decode (teal). Example prices $3 in / $15 out per million tokens; cache reads at 0.1×.</text>`);
    M('ttft', ttft.toFixed(2) + ' s', ttft > 2 ? 'bad' : ttft > 1 ? 'warn' : 'ok'); M('tot', tot.toFixed(2) + ' s', tot > 10 ? 'bad' : tot > 4 ? 'warn' : 'ok'); M('usd', '$' + usd.toFixed(4)); M('m', '$' + Math.round(usd * 1e6).toLocaleString());
    const dom = segs.reduce((a, b) => b[1] > a[1] ? b : a);
    cap.innerHTML = `Dominant term: <b>${dom[0]}</b>. ` + ({ decode: 'Shorten answers, cap max_tokens, or use a faster model.', prefill: 'Retrieve less, compress context, or cache the stable prefix.', queue: 'Add capacity, spread load, or use a priority tier.', network: 'Call a closer region or batch small calls.' })[dom[0]];
  });

  /* 1.7 — retries after an outage: thundering herd vs jittered backoff */
  SIMS.retry = host => shell(host, {
    id: 'rt', title: 'Recovery after a provider outage · retry strategies',
    controls: [
      { id: 'str', type: 'seg', label: 'Retry strategy', value: 'jit', options: [['imm', 'immediate'], ['fix', 'fixed 1s'], ['exp', 'exponential'], ['jit', 'exp + full jitter']] },
      { id: 'n', label: 'Clients', min: 100, max: 3000, step: 50, value: 1500 },
      { id: 'out', label: 'Outage length', min: 1, max: 15, value: 5, fmt: v => v + ' s' },
      { id: 'cap', label: 'Server capacity', min: 100, max: 1000, step: 50, value: 400, fmt: v => v + ' req/s' } ],
    metrics: [['peak', 'Peak attempts/s'], ['drain', 'All clients served by'], ['waste', 'Wasted attempts'], ['ok', 'Served']]
  }, (s, stage, M, cap) => {
    const r = rng(5), T = 40, dt = 0.1, B = T / dt; const nextAt = Array(s.n).fill(0).map(() => r() * 0.2); const attempt = Array(s.n).fill(0); const done = Array(s.n).fill(false);
    const per = Array(B).fill(0), okPer = Array(B).fill(0); let waste = 0, last = 0, okN = 0;
    const delay = a => { const base = 0.5 * Math.pow(2, a), c = Math.min(16, base); return s.str === 'imm' ? 0.05 : s.str === 'fix' ? 1 : s.str === 'exp' ? c : r() * c; };
    for (let b = 0; b < B; b++) {
      const t = b * dt; const due = []; for (let i = 0; i < s.n; i++) if (!done[i] && nextAt[i] <= t) due.push(i);
      per[b] = due.length; let capLeft = s.cap * dt;
      due.forEach(i => { const up = t >= s.out; if (up && capLeft >= 1) { capLeft--; done[i] = true; okPer[b]++; okN++; last = t; } else { waste++; attempt[i]++; nextAt[i] = t + delay(attempt[i]); } });
    }
    const perS = []; for (let k = 0; k < T; k++) perS.push(per.slice(k * 10, k * 10 + 10).reduce((a, x) => a + x, 0));
    const mx = Math.max(s.cap * 1.2, ...perS); const W = 760, H = 250, x0 = 52, x1 = W - 10, y0 = 10, y1 = 200;
    const sx = v => x0 + (x1 - x0) * v / T, sy = v => y1 - (y1 - y0) * v / mx; const bw = (x1 - x0) / T * 0.7;
    const bars = perS.map((v, k) => `<rect class="${k < s.out ? 'b-bad' : 'b-acc'}" x="${sx(k) + 1}" y="${sy(v)}" width="${bw}" height="${y1 - sy(v)}" opacity=".8"></rect>`).join('');
    const yst = niceStep(mx, 4); const yt = []; for (let v = 0; v <= mx; v += yst) yt.push([sy(v), Math.round(v)]);
    stage.innerHTML = svg(W, H, axes(x0, y0, x1, y1, [0, 5, 10, 15, 20, 25, 30, 35, 40].map(v => [sx(v), v + 's']), yt) + bars +
      `<line x1="${x0}" x2="${x1}" y1="${sy(s.cap)}" y2="${sy(s.cap)}" stroke="var(--ok)" stroke-dasharray="5 4"></line><text class="tx" x="${x1}" y="${sy(s.cap) - 5}" text-anchor="end" style="fill:var(--ok)">capacity ${s.cap}/s</text>
       <rect class="b-bad" x="${x0}" y="${y1 + 24}" width="${Math.max(2, sx(s.out) - x0)}" height="6" opacity=".7"></rect><text class="tx" x="${sx(s.out) + 6}" y="${y1 + 30}" style="fill:var(--bad)">provider outage (${s.out} s) · red bars = attempts during it</text>`);
    const peak = Math.max(...perS);
    M('peak', peak.toLocaleString(), peak > s.cap * 2 ? 'bad' : peak > s.cap ? 'warn' : 'ok'); M('drain', okN === s.n ? last.toFixed(1) + ' s' : '> 40 s', okN === s.n ? '' : 'bad'); M('waste', waste.toLocaleString(), waste > s.n * 5 ? 'bad' : ''); M('ok', okN + ' / ' + s.n, okN === s.n ? 'ok' : 'bad');
    cap.innerHTML = { imm: 'Immediate retries hammer the server during the outage and slam it the moment it returns: a retry storm.', fix: 'Fixed delays keep clients in lockstep, so they all return at the same instant and overload the server again.', exp: 'Exponential backoff cuts the attempt rate, but clients that failed together still retry together in synchronized waves.', jit: 'Full jitter spreads retries randomly across the backoff window, so recovery traffic stays near capacity. This is what AWS and most SDKs recommend.' }[s.str];
  });

  /* 4.2 — chunking: where boundaries fall relative to the answers we need to retrieve */
  SIMS.chunk = host => {
    const r = rng(11), DOC = 1600;
    const heads = [0, 230, 520, 610, 940, 1180, 1420];
    const ans = [[40, 70], [250, 60], [470, 80], [640, 50], [880, 90], [1010, 60], [1200, 70], [1450, 80]];
    return shell(host, {
      id: 'ck', title: 'Chunking lab · do the answers survive the split?',
      controls: [
        { id: 'mode', type: 'seg', label: 'Strategy', value: 'fixed', options: [['fixed', 'fixed size'], ['head', 'heading-aware']] },
        { id: 'size', label: 'Chunk size', min: 60, max: 600, step: 10, value: 150, fmt: v => v + ' tok' },
        { id: 'ov', label: 'Overlap', min: 0, max: 50, step: 5, value: 0, fmt: v => v + '%' } ],
      metrics: [['n', 'Chunks'], ['ok', 'Answers intact'], ['idx', 'Tokens indexed'], ['avg', 'Avg chunk']]
    }, (s, stage, M, cap) => {
      const step = Math.max(10, Math.round(s.size * (1 - s.ov / 100)));
      const chunks = [];
      const cut = (a, b) => { for (let x = a; x < b; x += step) { chunks.push([x, Math.min(b, x + s.size)]); if (x + s.size >= b) break; } };
      if (s.mode === 'fixed') cut(0, DOC);
      else heads.forEach((h, i) => cut(h, heads[i + 1] || DOC));
      const intact = ans.map(([a, l]) => chunks.some(([x, y]) => x <= a && a + l <= y));
      const okN = intact.filter(Boolean).length, idx = chunks.reduce((t, [x, y]) => t + y - x, 0);
      const RW = 400, W = 780, x0 = 30, x1 = W - 10, rowH = 66, H = 14 + Math.ceil(DOC / RW) * rowH;
      const sx = t => x0 + (x1 - x0) * (t % RW) / RW;
      let g = '';
      for (let row = 0; row < DOC / RW; row++) {
        const y = 14 + row * rowH;
        g += `<rect class="b-dim" x="${x0}" y="${y}" width="${x1 - x0}" height="40" opacity=".5"></rect><text class="tx" x="${x0 - 4}" y="${y + 24}" text-anchor="end">${row * RW}</text>`;
      }
      const seg = (a, b, fn) => { let x = a; while (x < b) { const e = Math.min(b, (Math.floor(x / RW) + 1) * RW); fn(x, e, Math.floor(x / RW)); x = e; } };
      chunks.forEach(([a, b], i) => seg(a, b, (x, e, row) => {
        const y = 14 + row * rowH + (i % 2 ? 14 : 2);
        g += `<rect class="b-acc" x="${sx(x).toFixed(1)}" y="${y}" width="${Math.max(1, (x1 - x0) * (e - x) / RW - 1.5).toFixed(1)}" height="11" opacity="${i % 2 ? .45 : .8}" rx="1"></rect>`;
      }));
      ans.forEach(([a, l], k) => seg(a, a + l, (x, e, row) => {
        const y = 14 + row * rowH + 30;
        g += `<rect class="${intact[k] ? 'b-ok' : 'b-bad'}" x="${sx(x).toFixed(1)}" y="${y}" width="${((x1 - x0) * (e - x) / RW).toFixed(1)}" height="7" rx="1"></rect>`;
      }));
      heads.forEach(h => { const y = 14 + Math.floor(h / RW) * rowH; g += `<line x1="${sx(h)}" x2="${sx(h)}" y1="${y - 3}" y2="${y + 43}" stroke="var(--fde)" stroke-width="2"></line>`; });
      g += `<text class="tx" x="${x1}" y="${H - 6}" text-anchor="end">bars: chunks (two lanes so overlap shows) · amber lines: headings · green/red: answer spans intact/split</text>`;
      stage.innerHTML = svg(W, H + 6, g);
      M('n', chunks.length); M('ok', okN + ' / ' + ans.length, okN === ans.length ? 'ok' : okN < 5 ? 'bad' : 'warn');
      M('idx', idx.toLocaleString(), idx > DOC * 1.4 ? 'warn' : ''); M('avg', Math.round(idx / chunks.length) + ' tok');
      cap.innerHTML = s.mode === 'fixed'
        ? (okN === ans.length && !s.ov ? 'At this size no answer happens to straddle a boundary. Move the size slider: most sizes cut through at least one answer, which is why fixed windows are fragile.' : s.ov ? `Overlap rescues answers that straddle a boundary, at the price of indexing ${Math.round(100 * idx / DOC - 100)}% extra tokens.` : 'Fixed windows ignore the document’s structure, so boundaries cut through answers (red). Try overlap, or switch to heading-aware.')
        : 'Heading-aware chunking starts a new chunk at every section, so answers rarely straddle sections. Long sections still need a size limit inside them.';
    });
  };

  /* 4.5 — fusing a keyword ranking with a vector ranking */
  SIMS.fusion = host => {
    // doc, bm25 rank, vector rank, bm25 score, cosine, relevant?
    const D = [['refund-policy', 1, 4, 14.2, .71, 1], ['error-E4012', 2, 9, 12.9, .52, 1], ['billing-faq', 3, 2, 9.8, .78, 0], ['money-back', 8, 1, 3.1, .83, 1],
      ['invoices-csv', 4, 7, 8.7, .60, 0], ['plans-compare', 6, 3, 5.0, .75, 0], ['sso-setup', 9, 10, 1.2, .40, 0], ['cancel-plan', 5, 5, 6.3, .69, 0], ['chargebacks', 7, 6, 4.4, .66, 0], ['api-limits', 10, 8, 0.9, .55, 0]];
    return shell(host, {
      id: 'fu', title: 'Hybrid fusion · query "refund for duplicate charge error E4012"',
      controls: [
        { id: 'mode', type: 'seg', label: 'Method', value: 'rrf', options: [['bm25', 'BM25 only'], ['vec', 'vector only'], ['rrf', 'RRF'], ['lin', 'weighted scores']] },
        { id: 'k', label: 'RRF k', min: 1, max: 120, value: 60 },
        { id: 'a', label: 'Vector weight (weighted)', min: 0, max: 100, step: 5, value: 50, fmt: v => (v / 100).toFixed(2) } ],
      metrics: [['top3', 'Relevant in top 3'], ['mrr', 'MRR'], ['first', 'Top result']]
    }, (s, stage, M, cap) => {
      const mm = (v, arr) => { const lo = Math.min(...arr), hi = Math.max(...arr); return (v - lo) / (hi - lo || 1); };
      const bs = D.map(d => d[3]), cs = D.map(d => d[4]);
      const score = d => s.mode === 'bm25' ? 1 / d[1] : s.mode === 'vec' ? 1 / d[2] : s.mode === 'rrf' ? 1 / (s.k + d[1]) + 1 / (s.k + d[2]) : (1 - s.a / 100) * mm(d[3], bs) + (s.a / 100) * mm(d[4], cs);
      const ranked = D.map(d => ({ d, v: score(d) })).sort((a, b) => b.v - a.v);
      const max = ranked[0].v, W = 760, x0 = 130, x1 = W - 150, rowH = 26, H = 12 + D.length * rowH;
      let g = '';
      ranked.forEach((o, i) => {
        const y = 8 + i * rowH, w = (x1 - x0) * o.v / max;
        g += `<text class="tx" x="${x0 - 8}" y="${y + 13}" text-anchor="end" style="font-size:11px;${o.d[5] ? 'fill:var(--ok);font-weight:700' : ''}">${i + 1}. ${o.d[0]}</text>
          <rect class="${o.d[5] ? 'b-ok' : 'b-acc'}" x="${x0}" y="${y + 2}" width="${Math.max(2, w).toFixed(1)}" height="15" opacity="${o.d[5] ? .9 : .55}" rx="1"></rect>
          <text class="tx" x="${x1 + 12}" y="${y + 13}">bm25 #${o.d[1]} · vec #${o.d[2]}</text>`;
      });
      stage.innerHTML = svg(W, H, g);
      const top3 = ranked.slice(0, 3).filter(o => o.d[5]).length, firstRel = ranked.findIndex(o => o.d[5]) + 1;
      M('top3', top3 + ' / 3', top3 === 3 ? 'ok' : top3 === 1 ? 'bad' : 'warn'); M('mrr', (1 / firstRel).toFixed(2)); M('first', ranked[0].d[0], ranked[0].d[5] ? 'ok' : 'bad');
      cap.innerHTML = { bm25: 'Keywords find the exact error code and the policy page, but miss "money-back", which uses different words.', vec: 'Vectors find the paraphrase ("money back") but bury the exact error code page.', rrf: `Reciprocal rank fusion only uses ranks, so it needs no score calibration. A document ranked well by both lists rises. Small k lets the very top ranks dominate; k = 60 is the usual default.`, lin: 'Weighted fusion needs scores on the same scale (here min-max normalised per query) and a tuned weight; it can beat RRF when tuned on your eval set, and lose badly when not.' }[s.mode];
    });
  };

  /* 5.9 — compounding errors in multi-step agents */
  SIMS.compound = host => shell(host, {
    id: 'cp', title: 'Compounding errors · success of an N-step agent task',
    controls: [
      { id: 'p', label: 'Per-step success', min: 80, max: 99.9, step: 0.1, value: 95, fmt: v => (+v).toFixed(1) + '%' },
      { id: 'n', label: 'Steps in the task', min: 1, max: 60, value: 20 },
      { id: 'v', label: 'Verifier catches a bad step', min: 0, max: 95, step: 5, value: 0, fmt: v => v + '%' },
      { id: 'r', label: 'Retries after a caught error', min: 0, max: 3, value: 1 } ],
    metrics: [['raw', 'Success, no checks'], ['with', 'Success with checks'], ['cost', 'Avg steps run'], ['half', 'Steps until 50%']]
  }, (s, stage, M, cap) => {
    const p = s.p / 100, v = s.v / 100;
    // a wrong step is caught with probability v; each retry is right with probability p (up to r retries)
    const stepOk = Math.min(1, p + (1 - p) * v * (1 - Math.pow(1 - p, s.r)));
    let retries = 0; for (let k = 0; k < s.r; k++) retries += Math.pow(1 - p, k);
    const perStep = 1 + (1 - p) * v * retries;
    const curve = q => Array.from({ length: 61 }, (_, i) => Math.pow(q, i));
    const a = curve(p), b = curve(stepOk);
    const W = 760, H = 250, x0 = 46, x1 = W - 14, y0 = 14, y1 = H - 28;
    const sx = i => x0 + (x1 - x0) * i / 60, sy = v => y1 - (y1 - y0) * v;
    const path = arr => arr.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
    let g = axes(x0, y0, x1, y1, [0, 10, 20, 30, 40, 50, 60].map(i => [sx(i), i + ' steps']), [0, .25, .5, .75, 1].map(v => [sy(v), Math.round(v * 100) + '%']));
    g += `<path d="${path(a)}" fill="none" stroke="var(--bad)" stroke-width="2.4"></path><path d="${path(b)}" fill="none" stroke="var(--ok)" stroke-width="2.4"></path>`;
    g += `<line x1="${sx(s.n)}" x2="${sx(s.n)}" y1="${y0}" y2="${y1}" stroke="var(--accent)" stroke-dasharray="4 4"></line>`;
    g += `<text class="tx" x="${x1}" y="${y0 + 10}" text-anchor="end" style="fill:var(--bad)">no checks</text><text class="tx" x="${x1}" y="${y0 + 24}" text-anchor="end" style="fill:var(--ok)">with verifier + retries</text>`;
    stage.innerHTML = svg(W, H, g);
    const raw = Math.pow(p, s.n), w = Math.pow(stepOk, s.n);
    const half = q => q >= 1 ? '∞' : Math.max(1, Math.floor(Math.log(0.5) / Math.log(q)));
    M('raw', (raw * 100).toFixed(1) + '%', raw < .5 ? 'bad' : raw < .8 ? 'warn' : 'ok');
    M('with', (w * 100).toFixed(1) + '%', w < .5 ? 'bad' : w < .8 ? 'warn' : 'ok');
    M('cost', (s.n * perStep).toFixed(1));
    M('half', half(p) + ' → ' + half(stepOk));
    cap.innerHTML = `At ${(+s.p).toFixed(1)}% per step, a ${s.n}-step task succeeds ${(raw * 100).toFixed(0)}% of the time: errors compound. ` +
      (s.v ? `A verifier that catches ${s.v}% of bad steps, with ${s.r} retr${s.r === 1 ? 'y' : 'ies'}, lifts per-step reliability to ${(stepOk * 100).toFixed(2)}% and the task to ${(w * 100).toFixed(0)}%.` : 'Add a verifier (tests, schema checks, a judge) and retries to see how much they recover.');
  });

  /* 6.1 — context budget: what fills the window on every call */
  SIMS.ctx = host => shell(host, {
    id: 'cx', title: 'Context budget · one agent request, section by section',
    controls: [
      { id: 'win', type: 'seg', label: 'Context window', value: '200', options: [['200', '200k tokens'], ['1000', '1M tokens']] },
      { id: 'tools', label: 'Tools loaded', min: 0, max: 120, value: 25, fmt: v => v + ' × 350' },
      { id: 'turns', label: 'History turns', min: 0, max: 120, value: 30, fmt: v => v + ' × 700' },
      { id: 'chunks', label: 'Retrieved chunks', min: 0, max: 60, value: 12, fmt: v => v + ' × 450' },
      { id: 'tr', label: 'Old tool results kept', min: 0, max: 60, value: 20, fmt: v => v + ' × 2,500' },
      { id: 'out', label: 'Output reserve', min: 1, max: 64, value: 8, fmt: v => v + 'k' } ],
    metrics: [['used', 'Input tokens'], ['fill', 'Window used'], ['cost', 'Input cost / call'], ['cached', 'Cacheable prefix']]
  }, (s, stage, M, cap) => {
    const win = +s.win * 1000;
    const parts = [['system', 3000, 'b-acc'], ['tools', s.tools * 350, 'b-be'], ['memory', 1500, 'b-ok'], ['history', s.turns * 700, 'b-warn'],
      ['tool results', s.tr * 2500, 'b-bad'], ['retrieved', s.chunks * 450, 'b-dim'], ['output reserve', s.out * 1000, 'b-dim']];
    const input = parts.slice(0, 6).reduce((a, p) => a + p[1], 0), total = input + s.out * 1000;
    const W = 760, x0 = 20, x1 = W - 20, scaleMax = Math.max(win, total), sx = v => x0 + (x1 - x0) * v / scaleMax;
    let x = 0, g = '';
    parts.forEach(([name, v, cls], i) => {
      if (!v) return;
      g += `<rect class="${cls}" x="${sx(x).toFixed(1)}" y="30" width="${Math.max(1, sx(x + v) - sx(x)).toFixed(1)}" height="44" opacity="${name === 'output reserve' ? .35 : .85}"></rect>`;
      x += v;
    });
    g += `<line x1="${sx(win)}" x2="${sx(win)}" y1="18" y2="86" stroke="var(--text)" stroke-width="2" stroke-dasharray="5 4"></line><text class="tx" x="${sx(win) - 4}" y="14" text-anchor="end">window ${s.win === '200' ? '200k' : '1M'}</text>`;
    let lx = x0, ly = 110;
    parts.forEach(([name, v, cls]) => {
      const label = `${name} ${(v / 1000).toFixed(1)}k`;
      if (lx + label.length * 6.4 + 26 > x1) { lx = x0; ly += 20; }
      g += `<rect class="${cls}" x="${lx}" y="${ly - 9}" width="10" height="10" opacity="${name === 'output reserve' ? .35 : .85}"></rect><text class="tx" x="${lx + 14}" y="${ly}">${label}</text>`;
      lx += label.length * 6.4 + 34;
    });
    stage.innerHTML = svg(W, ly + 14, g);
    const prefix = 3000 + s.tools * 350 + 1500;              // system + tools + memory: stable across calls
    const cost = ((input - prefix) * 3 + prefix * 0.3) / 1e6; // example: $3/M input, cached reads at 0.1x
    M('used', input.toLocaleString(), total > win ? 'bad' : '');
    M('fill', Math.round(100 * total / win) + '%', total > win ? 'bad' : total > 0.7 * win ? 'warn' : 'ok');
    M('cost', '$' + cost.toFixed(3)); M('cached', Math.round(100 * prefix / input) + '%');
    cap.innerHTML = total > win ? 'Over the window: the request fails. Something must be dropped, compacted or offloaded before the call.' :
      s.tr * 2500 > input * 0.4 ? 'Old tool results dominate the context. Clearing them (lesson 6.2) or offloading them to files (6.3) frees most of the budget.' :
      s.tools * 350 > input * 0.3 ? 'Tool definitions take a large share on every call. Load tools on demand or split them across sub-agents (6.4, 6.5).' :
      'Every token here is re-sent and re-read on every step. Keep only what helps the next decision; cache the stable prefix (example prices: $3 per million input tokens, cached reads at a tenth).';
  });

  /* 7.2 — how big must an eval set be to see a real difference? */
  SIMS.evalsize = host => shell(host, {
    id: 'es', title: 'Eval set size · can you tell prompt B from prompt A?',
    controls: [
      { id: 'n', label: 'Labelled examples', min: 20, max: 2000, step: 10, value: 100 },
      { id: 'a', label: 'True accuracy of A', min: 50, max: 98, value: 82, fmt: v => v + '%' },
      { id: 'd', label: 'True improvement of B', min: 0, max: 15, step: 0.5, value: 3, fmt: v => '+' + v + ' pts' } ],
    metrics: [['ci', '95% CI half-width'], ['se', 'Std error of diff'], ['pow', 'Chance to detect'], ['need', 'n for 80% power']]
  }, (s, stage, M, cap) => {
    const pA = s.a / 100, pB = Math.min(0.995, pA + s.d / 100), n = s.n;
    const half = 1.96 * Math.sqrt(pA * (1 - pA) / n);
    // paired comparison approximated as independent (conservative): se of difference
    const se = Math.sqrt(pA * (1 - pA) / n + pB * (1 - pB) / n);
    const z = (pB - pA) / se;
    const cdf = x => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
    const power = 1 - cdf(1.96 - z);
    const need = s.d > 0 ? Math.ceil(Math.pow(1.96 + 0.8416, 2) * (pA * (1 - pA) + pB * (1 - pB)) / Math.pow(pB - pA, 2)) : Infinity;
    const W = 760, H = 170, x0 = 60, x1 = W - 20, lo = Math.max(0, Math.min(pA, pB) - 0.2), hi = Math.min(1, Math.max(pA, pB) + 0.12);
    const sx = v => x0 + (x1 - x0) * (v - lo) / (hi - lo);
    const ticks = []; for (let v = Math.ceil(lo * 20) / 20; v <= hi + 1e-9; v += 0.05) ticks.push([sx(v), Math.round(v * 100) + '%']);
    let g = axes(x0, 10, x1, H - 24, ticks, []);
    [['A', pA, 'var(--text-2)', 60], ['B', pB, 'var(--accent)', 110]].forEach(([lab, p, col, y]) => {
      const h = 1.96 * Math.sqrt(p * (1 - p) / n);
      g += `<line x1="${sx(Math.max(lo, p - h))}" x2="${sx(Math.min(hi, p + h))}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="6" stroke-linecap="round" opacity=".55"></line>
        <circle cx="${sx(p)}" cy="${y}" r="6" fill="${col}"></circle><text class="tx" x="${x0 - 10}" y="${y + 4}" text-anchor="end" style="font-size:12px;font-weight:700">${lab}</text>`;
    });
    stage.innerHTML = svg(W, H, g);
    M('ci', '±' + (half * 100).toFixed(1) + ' pts', half > s.d / 100 ? 'warn' : 'ok');
    M('se', (se * 100).toFixed(1) + ' pts'); M('pow', Math.round(power * 100) + '%', power < 0.5 ? 'bad' : power < 0.8 ? 'warn' : 'ok');
    M('need', isFinite(need) ? need.toLocaleString() + ' / variant' : '∞');
    cap.innerHTML = s.d === 0 ? 'With no true difference, any gap you see is noise. Small eval sets make noise look like progress.' :
      power < 0.8 ? `With ${n} examples the confidence intervals overlap heavily: a real +${s.d}-point gain is detected only ${Math.round(power * 100)}% of the time. You need about ${need.toLocaleString()} examples per variant (or a paired design, which needs fewer).` :
      `With ${n} examples a +${s.d}-point improvement is detected reliably. Paired comparisons on the same items need even fewer.`;
  });

  /* 9.3 — static vs continuous batching on one GPU */
  SIMS.batching = host => shell(host, {
    id: 'bt', title: 'Batching · static vs continuous on one inference server',
    controls: [
      { id: 'mode', type: 'seg', label: 'Scheduler', value: 'cont', options: [['static', 'static batches'], ['cont', 'continuous batching']] },
      { id: 'slots', label: 'Max batch (KV slots)', min: 2, max: 32, value: 12 },
      { id: 'rate', label: 'Arrivals per second', min: 1, max: 40, value: 14 },
      { id: 'var', label: 'Output length spread', min: 0, max: 100, step: 5, value: 70, fmt: v => v + '%' } ],
    metrics: [['tput', 'Output tokens / s'], ['lat', 'Mean latency'], ['p95', 'p95 latency'], ['util', 'Slot utilisation']]
  }, (s, stage, M, cap) => {
    const r = rng(5), N = 60, step = a => 10 + 0.25 * a;          // ms per decode step grows slowly with batch size
    let t = 0; const reqs = [];
    for (let i = 0; i < N; i++) { t += -Math.log(1 - r()) * 1000 / s.rate; const base = 120, spread = s.var / 100; reqs.push({ i, arr: t, len: Math.max(8, Math.round(base * (1 + spread * (r() * 2 - 1)))), start: null, end: null, slot: null }); }
    const slots = Array(s.slots).fill(null); let now = 0, done = 0, busySlotMs = 0, queue = [], next = 0, tokens = 0;
    const segs = [];
    while (done < N && now < 600000) {
      while (next < N && reqs[next].arr <= now) queue.push(reqs[next++]);
      const active = slots.filter(Boolean).length;
      if (s.mode === 'cont') {
        for (let k = 0; k < slots.length && queue.length; k++) if (!slots[k]) { const q = queue.shift(); q.start = now; q.slot = k; q.left = q.len; slots[k] = q; }
      } else if (active === 0 && (queue.length >= s.slots || (queue.length && next >= N) || (queue.length && now - queue[0].arr > 400))) {
        for (let k = 0; k < slots.length && queue.length; k++) { const q = queue.shift(); q.start = now; q.slot = k; q.left = q.len; slots[k] = q; }
      }
      const a = slots.filter(Boolean).length;
      if (!a) { now = next < N ? Math.max(now + 1, reqs[next].arr) : now + 1; continue; }
      const dt = step(a); now += dt; busySlotMs += a * dt;
      slots.forEach((q, k) => { if (!q) return; q.left--; tokens++; if (q.left <= 0) { q.end = now; segs.push(q); done++; if (s.mode === 'cont') slots[k] = null; } });
      if (s.mode === 'static' && slots.every(q => !q || q.left <= 0)) slots.fill(null);
    }
    const lat = reqs.filter(q => q.end).map(q => q.end - q.arr).sort((x, y) => x - y);
    const total = now, W = 760, x0 = 34, x1 = W - 10, rowH = Math.max(6, Math.min(16, 200 / s.slots)), H = 14 + s.slots * rowH + 26;
    const sx = v => x0 + (x1 - x0) * v / total;
    let g = axes(x0, 8, x1, 10 + s.slots * rowH, [0, .25, .5, .75, 1].map(f => [sx(f * total), (f * total / 1000).toFixed(1) + 's']), []);
    segs.forEach(q => { g += `<rect class="${q.i % 2 ? 'b-acc' : 'b-be'}" x="${sx(q.start).toFixed(1)}" y="${10 + q.slot * rowH}" width="${Math.max(1, sx(q.end) - sx(q.start)).toFixed(1)}" height="${rowH - 2}" opacity=".8" rx="1"></rect>`; });
    g += `<text class="tx" x="${x0 - 4}" y="${16}" text-anchor="end">slot 1</text><text class="tx" x="${x0 - 4}" y="${8 + s.slots * rowH}" text-anchor="end">${s.slots}</text>`;
    stage.innerHTML = svg(W, H, g);
    const mean = lat.reduce((a, b) => a + b, 0) / lat.length, p95 = lat[Math.floor(0.95 * (lat.length - 1))], util = busySlotMs / (total * s.slots);
    M('tput', Math.round(tokens / (total / 1000)).toLocaleString()); M('lat', (mean / 1000).toFixed(2) + ' s', mean > 4000 ? 'bad' : ''); M('p95', (p95 / 1000).toFixed(2) + ' s', p95 > 6000 ? 'bad' : p95 > 3000 ? 'warn' : 'ok');
    M('util', Math.round(util * 100) + '%', util > 0.7 ? 'ok' : 'warn');
    cap.innerHTML = s.mode === 'static' ? 'Static batching waits to fill a batch, then holds every slot until the longest sequence finishes: short requests leave idle slots (gaps) and new arrivals queue.' : 'Continuous batching admits a waiting request into any slot the moment a sequence finishes, so slots stay busy and short requests are not stuck behind long ones. Push the arrival rate up to see the queue build once slots run out.';
  });

  /* 9.7 — GPU memory and throughput for self-hosted serving */
  SIMS.gpu = host => {
    const MODELS = { '8': { p: 8.0, L: 32, kv: 8 }, '70': { p: 70.6, L: 80, kv: 8 }, '405': { p: 405, L: 126, kv: 8 } };
    const GPUS = { h100: { mem: 80, bw: 3.35, name: 'H100 80GB' }, h200: { mem: 141, bw: 4.8, name: 'H200 141GB' }, b200: { mem: 180, bw: 7.7, name: 'B200 ~180GB' } };
    return shell(host, {
      id: 'gp', title: 'GPU sizing · weights, KV cache and decode speed',
      controls: [
        { id: 'm', type: 'seg', label: 'Model (Llama-3.1-style)', value: '70', options: [['8', '8B'], ['70', '70B'], ['405', '405B']] },
        { id: 'q', type: 'seg', label: 'Weight precision', value: '8', options: [['16', 'BF16'], ['8', 'FP8'], ['4', 'INT4']] },
        { id: 'g', type: 'seg', label: 'GPU', value: 'h100', options: [['h100', 'H100'], ['h200', 'H200'], ['b200', 'B200']] },
        { id: 'tp', label: 'GPUs per replica (TP)', min: 1, max: 8, value: 2 },
        { id: 'ctx', label: 'Tokens per sequence', min: 1, max: 128, value: 8, fmt: v => v + 'k' },
        { id: 'users', label: 'Concurrent sequences', min: 1, max: 256, value: 48 } ],
      metrics: [['fit', 'Memory per GPU'], ['kvcap', 'Max sequences (KV)'], ['tps', 'Tokens/s per sequence'], ['agg', 'Replica tokens/s']]
    }, (s, stage, M, cap) => {
      const md = MODELS[s.m], gpu = GPUS[s.g];
      const wGB = md.p * (+s.q) / 8, kvPerTok = 2 * md.L * md.kv * 128 * 2 / 1e9;   // GB per token, BF16 KV cache
      const kvGB = kvPerTok * s.ctx * 1000 * s.users, usable = gpu.mem * 0.9 * s.tp, overhead = 4 * s.tp;
      const perGPU = (wGB + kvGB + overhead) / s.tp, maxSeq = Math.max(0, Math.floor((usable - wGB - overhead) / (kvPerTok * s.ctx * 1000)));
      const avgKvRead = kvPerTok * s.ctx * 500 * Math.min(s.users, maxSeq);          // average half-full sequences per step
      const stepS = (wGB + avgKvRead) / (gpu.bw * 1000 * s.tp * 0.6);                // ~60% of peak bandwidth
      const tps = 1 / stepS, agg = tps * Math.min(s.users, maxSeq);
      const W = 760, H = 120, x0 = 20, x1 = W - 20, scale = Math.max(gpu.mem, perGPU) * 1.05, sx = v => x0 + (x1 - x0) * v / scale;
      let x = 0, g = '';
      [['weights', wGB / s.tp, 'b-acc'], ['KV cache', kvGB / s.tp, 'b-warn'], ['runtime overhead', overhead / s.tp, 'b-dim']].forEach(([n, v, c]) => {
        g += `<rect class="${c}" x="${sx(x).toFixed(1)}" y="26" width="${Math.max(1, sx(x + v) - sx(x)).toFixed(1)}" height="40" opacity=".85"></rect>`;
        if (sx(x + v) - sx(x) > 90) g += `<text class="tx" x="${(sx(x) + 6).toFixed(1)}" y="50" style="fill:var(--bg);font-weight:700">${n} ${v.toFixed(0)} GB</text>`;
        x += v;
      });
      g += `<line x1="${sx(gpu.mem)}" x2="${sx(gpu.mem)}" y1="14" y2="78" stroke="var(--text)" stroke-width="2" stroke-dasharray="5 4"></line><text class="tx" x="${sx(gpu.mem) - 4}" y="11" text-anchor="end">${gpu.name} capacity</text>`;
      g += `<text class="tx" x="${x0}" y="98">per GPU: weights ${(wGB / s.tp).toFixed(0)} GB · KV ${(kvGB / s.tp).toFixed(0)} GB · KV per token ${(kvPerTok * 1e6).toFixed(0)} KB</text>`;
      stage.innerHTML = svg(W, H, g);
      const over = perGPU > gpu.mem * 0.9;
      M('fit', perGPU.toFixed(0) + ' / ' + gpu.mem + ' GB', over ? 'bad' : perGPU > gpu.mem * 0.75 ? 'warn' : 'ok');
      M('kvcap', maxSeq.toLocaleString(), maxSeq < s.users ? 'bad' : 'ok'); M('tps', over ? '–' : tps.toFixed(0), tps < 20 ? 'warn' : 'ok'); M('agg', over ? '–' : Math.round(agg).toLocaleString());
      cap.innerHTML = wGB > usable ? 'The weights alone do not fit: add GPUs (tensor parallelism) or quantise.' :
        maxSeq < s.users ? `Weights fit, but the KV cache for ${s.users} sequences of ${s.ctx}k tokens does not: only ${maxSeq} fit. Shorten contexts, quantise the KV cache, or add GPUs.` :
        `Decode is memory-bandwidth bound: every step reads all weights plus the active KV cache, so more sequences per step raise total throughput while each sequence slows slightly. Rough model: 60% of peak bandwidth, BF16 KV cache; benchmark your own setup.`;
    });
  };

  /* 10.7 — error budget: how one incident spends a month of reliability */
  SIMS.burn = host => shell(host, {
    id: 'bu', title: 'Error budget · one incident against a 30-day SLO',
    controls: [
      { id: 'slo', type: 'seg', label: 'Availability SLO', value: '99.9', options: [['99', '99%'], ['99.5', '99.5%'], ['99.9', '99.9%'], ['99.95', '99.95%']] },
      { id: 'err', label: 'Error rate during the incident', min: 1, max: 60, value: 8, fmt: v => v + '%' },
      { id: 'det', label: 'Minutes to detect', min: 1, max: 120, value: 12, fmt: v => v + ' min' },
      { id: 'mit', label: 'Minutes to mitigate (rollback)', min: 1, max: 120, value: 5, fmt: v => v + ' min' } ],
    metrics: [['burn', 'Burn rate'], ['spent', 'Budget used by incident'], ['left', 'Budget left at day 30'], ['exh', 'Time to exhaust at this rate']]
  }, (s, stage, M, cap) => {
    const budget = 1 - (+s.slo) / 100, base = budget * 0.25, mins = 30 * 24 * 60;     // background errors use 25% of budget
    const dur = s.det + s.mit, burn = (s.err / 100) / budget;
    const used = t => (base * Math.min(t, mins) + (s.err / 100 - base) * Math.max(0, Math.min(t - 10 * 1440, dur))) / (budget * mins);
    const W = 760, H = 210, x0 = 46, x1 = W - 14, y0 = 12, y1 = H - 28, ymax = Math.max(1.05, used(mins) * 1.08);
    const sx = d => x0 + (x1 - x0) * d / 30, sy = v => y1 - (y1 - y0) * v / ymax;
    let path = '';
    for (let i = 0; i <= 300; i++) { const d = i / 10; path += `${i ? 'L' : 'M'}${sx(d).toFixed(1)},${sy(used(d * 1440)).toFixed(1)}`; }
    let g = axes(x0, y0, x1, y1, [0, 5, 10, 15, 20, 25, 30].map(d => [sx(d), 'day ' + d]), [0, .25, .5, .75, 1].filter(v => v <= ymax).map(v => [sy(v), Math.round(v * 100) + '%']));
    g += `<line x1="${x0}" x2="${x1}" y1="${sy(1)}" y2="${sy(1)}" stroke="var(--bad)" stroke-width="2" stroke-dasharray="5 4"></line><text class="tx" x="${x1}" y="${sy(1) - 5}" text-anchor="end" style="fill:var(--bad)">budget exhausted</text>`;
    g += `<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.6"></path><text class="tx" x="${sx(10) + 6}" y="${sy(used(10 * 1440 + dur)) - 6}">incident (${dur} min)</text>`;
    stage.innerHTML = svg(W, H, g);
    const inc = (s.err / 100) * dur / (budget * mins), left = 1 - used(mins);
    const exh = budget * mins / (s.err / 100);
    M('burn', burn.toFixed(0) + '×', burn > 14.4 ? 'bad' : burn > 6 ? 'warn' : 'ok');
    M('spent', (inc * 100).toFixed(1) + '%', inc > 0.5 ? 'bad' : inc > 0.2 ? 'warn' : 'ok');
    M('left', (left * 100).toFixed(0) + '%', left < 0 ? 'bad' : left < 0.3 ? 'warn' : 'ok');
    M('exh', exh < 120 ? exh.toFixed(0) + ' min' : (exh / 60).toFixed(1) + ' h');
    cap.innerHTML = `A ${s.err}% error rate burns a ${s.slo}% budget ${burn.toFixed(0)}× faster than allowed; the ${dur}-minute incident used ${(inc * 100).toFixed(1)}% of the month’s budget (background errors use another 25%). ` +
      (s.det > s.mit * 2 ? 'Detection dominates: multi-window burn-rate alerts (lesson walk) cut it more than a faster rollback would.' : 'Mitigation dominates: rehearse one-minute rollbacks for every behaviour lever.');
  });

  /* 11.3 — Monte Carlo schedule: why the sum of likely estimates misleads */
  SIMS.schedule = host => shell(host, {
    id: 'sc', title: 'Schedule risk · a chain of tasks with long-tailed estimates',
    controls: [
      { id: 'n', label: 'Tasks in the critical chain', min: 2, max: 12, value: 6 },
      { id: 'likely', label: 'Likely days per task', min: 1, max: 10, value: 4 },
      { id: 'tail', label: 'Pessimistic estimate', min: 1.2, max: 4, step: 0.1, value: 2.5, fmt: v => (+v).toFixed(1) + '× likely' },
      { id: 'dep', label: 'Customer dependency slip risk', min: 0, max: 60, step: 5, value: 25, fmt: v => v + '%' },
      { id: 'dl', label: 'Deadline (working days)', min: 5, max: 80, value: 30 } ],
    metrics: [['naive', 'Sum of likely'], ['p50', 'P50'], ['p85', 'P85'], ['hit', 'P(on time)']]
  }, (s, stage, M, cap) => {
    const r = rng(11), N = 4000, ends = [];
    const tri = (a, m, b) => { const u = r(), f = (m - a) / (b - a); return u < f ? a + Math.sqrt(u * (b - a) * (m - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - m)); };
    for (let k = 0; k < N; k++) {
      let t = r() < s.dep / 100 ? tri(2, 5, 15) : 0;                                   // waiting on access, data or SMEs
      for (let i = 0; i < s.n; i++) t += tri(s.likely * 0.7, s.likely, s.likely * s.tail);
      ends.push(t);
    }
    ends.sort((a, b) => a - b);
    const pct = q => ends[Math.floor(q * (N - 1))], naive = s.n * s.likely, hit = ends.filter(e => e <= s.dl).length / N;
    const lo = Math.floor(Math.min(naive, ends[0])), hi = Math.ceil(Math.max(ends[N - 1], s.dl)) + 1, B = 40, w = (hi - lo) / B, bins = Array(B).fill(0);
    ends.forEach(e => bins[Math.min(B - 1, Math.floor((e - lo) / w))]++);
    const W = 760, H = 200, x0 = 40, x1 = W - 14, y0 = 14, y1 = H - 28, mx = Math.max(...bins);
    const sx = v => x0 + (x1 - x0) * (v - lo) / (hi - lo), sy = c => y1 - (y1 - y0) * c / mx;
    let g = axes(x0, y0, x1, y1, Array.from({ length: 6 }, (_, i) => lo + (hi - lo) * i / 5).map(v => [sx(v), Math.round(v) + 'd']), []);
    bins.forEach((c, i) => { const a = lo + i * w; g += `<rect class="${a + w <= s.dl ? 'b-ok' : 'b-bad'}" x="${sx(a).toFixed(1)}" y="${sy(c).toFixed(1)}" width="${Math.max(1, sx(a + w) - sx(a) - 1).toFixed(1)}" height="${(y1 - sy(c)).toFixed(1)}" opacity=".75"></rect>`; });
    [[naive, 'sum of likely', 'var(--text-2)'], [pct(0.5), 'P50', 'var(--accent)'], [pct(0.85), 'P85', 'var(--warn)']].forEach(([v, lab, col], i) => {
      g += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${y0}" y2="${y1}" stroke="${col}" stroke-width="2" stroke-dasharray="4 3"></line><text class="tx" x="${sx(v) + 4}" y="${y0 + 10 + i * 13}" style="fill:${col}">${lab}</text>`;
    });
    stage.innerHTML = svg(W, H, g);
    M('naive', naive + ' d'); M('p50', pct(0.5).toFixed(1) + ' d'); M('p85', pct(0.85).toFixed(1) + ' d', pct(0.85) > s.dl ? 'bad' : 'ok');
    M('hit', Math.round(hit * 100) + '%', hit < 0.5 ? 'bad' : hit < 0.8 ? 'warn' : 'ok');
    const beat = Math.round(100 * ends.filter(e => e <= naive).length / N);
    cap.innerHTML = `The sum of likely estimates (${naive} days) is met in ${beat < 1 ? 'almost none' : 'only ' + beat + '%'} of simulated projects: long right tails and dependency slips push the total later. ` +
      (hit < 0.8 ? 'To promise this deadline with confidence, cut tasks from the chain (scope), shorten tails (de-risk early), or chase customer dependencies in week one.' : 'This deadline is a safe promise at about P85 or better.');
  });

  /* 11.7 — ROI and payback for an executive one-pager */
  SIMS.roi = host => shell(host, {
    id: 'ro', title: 'Business case · value, run cost and payback',
    controls: [
      { id: 'vol', label: 'Items per month', min: 1, max: 200, value: 9, fmt: v => v + 'k' },
      { id: 'min', label: 'Minutes saved per item', min: 0.5, max: 30, step: 0.5, value: 10, fmt: v => v + ' min' },
      { id: 'rate', label: 'Loaded cost per hour', min: 20, max: 150, step: 5, value: 60, fmt: v => '$' + v },
      { id: 'adopt', label: 'Adoption', min: 10, max: 100, step: 5, value: 80, fmt: v => v + '%' },
      { id: 'run', label: 'Run cost per item', min: 0.01, max: 2, step: 0.01, value: 0.4, fmt: v => '$' + (+v).toFixed(2) },
      { id: 'build', label: 'Build + rollout cost', min: 20, max: 1000, step: 10, value: 300, fmt: v => '$' + v + 'k' } ],
    metrics: [['val', 'Annual value'], ['net', 'Annual net'], ['pay', 'Payback'], ['roi', '2-year ROI']]
  }, (s, stage, M, cap) => {
    const items = s.vol * 1000 * s.adopt / 100, value = items * s.min / 60 * s.rate, run = items * s.run, net = value - run, build = s.build * 1000;
    const cum = Array.from({ length: 25 }, (_, m) => -build + net * m);
    const W = 760, H = 200, x0 = 64, x1 = W - 14, y0 = 14, y1 = H - 28, lo = Math.min(...cum, 0), hi = Math.max(...cum, 1);
    const sx = m => x0 + (x1 - x0) * m / 24, sy = v => y1 - (y1 - y0) * (v - lo) / (hi - lo);
    const fmt = v => (v < 0 ? '-' : '') + '$' + (Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(1) + 'M' : Math.round(Math.abs(v) / 1000) + 'k');
    let g = axes(x0, y0, x1, y1, [0, 6, 12, 18, 24].map(m => [sx(m), 'month ' + m]), [lo, (lo + hi) / 2, hi].map(v => [sy(v), fmt(v)]));
    g += `<line x1="${x0}" x2="${x1}" y1="${sy(0)}" y2="${sy(0)}" stroke="var(--text-2)" stroke-width="1.5"></line>`;
    g += `<path d="${cum.map((v, m) => `${m ? 'L' : 'M'}${sx(m).toFixed(1)},${sy(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${net > 0 ? 'var(--ok)' : 'var(--bad)'}" stroke-width="2.6"></path>`;
    const pay = net > 0 ? build / net : Infinity;
    if (pay <= 24) g += `<circle cx="${sx(pay)}" cy="${sy(0)}" r="5" fill="var(--accent)"></circle><text class="tx" x="${sx(pay) + 8}" y="${sy(0) - 8}">break-even</text>`;
    stage.innerHTML = svg(W, H, g);
    M('val', fmt(value * 12)); M('net', fmt(net * 12), net > 0 ? 'ok' : 'bad');
    M('pay', isFinite(pay) ? pay.toFixed(1) + ' months' : 'never', pay > 18 ? 'bad' : pay > 9 ? 'warn' : 'ok');
    M('roi', isFinite(pay) ? Math.round(100 * (net * 24 - build) / build) + '%' : '–');
    cap.innerHTML = `At ${s.adopt}% adoption, ${Math.round(items).toLocaleString()} items a month save ${Math.round(items * s.min / 60).toLocaleString()} hours. ` +
      (net <= 0 ? 'Run cost exceeds the value of time saved: cut tokens per item (routing, caching) or target slower tasks.' :
        `Lead the one-pager with the payback (${pay.toFixed(1)} months) and show the conservative case: try halving adoption to see how sensitive it is.`);
  });

  /* 12.1 — back-of-envelope: requests, tokens and monthly cost */
  SIMS.envelope = host => shell(host, {
    id: 'en', title: 'Back of the envelope · from users to tokens to dollars',
    controls: [
      { id: 'users', label: 'Active users', min: 1, max: 200, value: 20, fmt: v => v + 'k' },
      { id: 'act', label: 'Requests per user per day', min: 1, max: 100, value: 40 },
      { id: 'peak', label: 'Peak / average', min: 1, max: 6, step: 0.5, value: 3, fmt: v => v + '×' },
      { id: 'tin', label: 'Input tokens per request', min: 0.5, max: 100, step: 0.5, value: 3, fmt: v => v + 'k' },
      { id: 'tout', label: 'Output tokens per request', min: 50, max: 4000, step: 50, value: 300 },
      { id: 'cache', label: 'Input share cacheable', min: 0, max: 90, step: 5, value: 60, fmt: v => v + '%' } ],
    metrics: [['rps', 'Peak requests / s'], ['tps', 'Peak input tok/s'], ['mid', 'Mid tier / month'], ['per', 'Mid tier / 1k req']]
  }, (s, stage, M, cap) => {
    const perDay = s.users * 1000 * s.act, avg = perDay / (8 * 3600), peak = avg * s.peak, month = perDay * 30;
    const tiers = [['small', 1, 5, 'b-ok'], ['mid', 3, 15, 'b-acc'], ['large', 15, 75, 'b-warn']];   // example $ per M tokens in/out
    const cost = (pin, pout, cached) => month * (s.tin * 1000 * pin * (cached ? (1 - s.cache / 100 * 0.9) : 1) + s.tout * pout) / 1e6;
    const rows = tiers.flatMap(([n, pin, pout, c]) => [[n + ' (no cache)', cost(pin, pout, false), c, .45], [n + ' (prefix cache)', cost(pin, pout, true), c, .9]]);
    const W = 760, H = 24 + rows.length * 26, x0 = 150, x1 = W - 90, mx = Math.max(...rows.map(r => r[1]));
    const fmt = v => '$' + (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.round(v / 1000) + 'k');
    let g = '';
    rows.forEach(([n, v, c, op], i) => {
      const y = 10 + i * 26;
      g += `<text class="tx" x="${x0 - 8}" y="${y + 13}" text-anchor="end">${n}</text><rect class="${c}" x="${x0}" y="${y}" width="${Math.max(1, (x1 - x0) * v / mx).toFixed(1)}" height="18" opacity="${op}" rx="2"></rect><text class="tx" x="${(x0 + (x1 - x0) * v / mx + 6).toFixed(1)}" y="${y + 13}">${fmt(v)}/mo</text>`;
    });
    stage.innerHTML = svg(W, H, g);
    const mid = cost(3, 15, true);
    M('rps', peak.toFixed(1)); M('tps', Math.round(peak * s.tin) + 'k'); M('mid', fmt(mid)); M('per', '$' + (mid / month * 1000).toFixed(2));
    cap.innerHTML = `${perDay.toLocaleString()} requests a day over an 8-hour working day is ${avg.toFixed(1)} req/s on average and ${peak.toFixed(1)} at peak. ` +
      `Input tokens dominate cost when prompts are long: caching the stable ${s.cache}% of each prompt (read at a tenth of the price) or routing to a smaller tier changes the bill more than anything else. Example prices only.`;
  });
})();

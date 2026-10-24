/* Interactive architecture diagrams from a small spec.
   spec = { title, w, h, nodes:[{id,x,y,w,h,label,sub,tone,info}], edges:[{a,b,label,dash,step,bend}],
            groups:[{x,y,w,h,label}], steps:['caption', ...], caption } */
(function () {
  const A = window.AISA;
  let seq = 0;
  function boxEdge(n, tx, ty) {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2, dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return [cx, cy];
    const sx = (n.w / 2) / Math.abs(dx || 1e-9), sy = (n.h / 2) / Math.abs(dy || 1e-9), s = Math.min(sx, sy);
    return [cx + dx * s, cy + dy * s];
  }
  A.diagram = function (host, spec) {
    if (!host || !spec) return;
    const uid = 'dg' + (++seq);
    const N = {};
    spec.nodes.forEach(n => { if (n._fixedW === undefined) n._fixedW = !!n.w; n.w = n.w || 150; n.h = n.h || (n.sub ? 52 : 40); N[n.id] = n; });
    // Auto-layout: spec.cols = [['a'], ['b', 'c'], ...] places nodes column by column (left to right),
    // spread evenly top to bottom. Column widths grow to fit their longest label or subtitle, and the
    // viewBox widens to match (the SVG scales to the container). spec.groups may name columns: {cols: [1, 2], label}.
    if (spec.cols && !spec._laid) {
      const C = spec.cols.length, rows = Math.max(...spec.cols.map(c => c.length));
      const need = n => Math.ceil(Math.max(n.label.length * 8.4 + 20, (n.sub || '').length * 6.6 + 18, 104));
      const colW = spec.cols.map(col => Math.max(...col.filter(id => N[id]).map(id => N[id]._fixedW ? N[id].w : need(N[id]))));
      const top = (spec.groups || []).length ? 34 : 18, bot = 16, padX = 16, minGap = 36;
      const natural = 2 * padX + colW.reduce((a, b) => a + b, 0) + minGap * (C - 1);
      spec.w = Math.max(spec.w || 820, natural);
      const gap = C > 1 ? (spec.w - 2 * padX - colW.reduce((a, b) => a + b, 0)) / (C - 1) : 0;
      spec.h = spec.h || Math.max(200, 60 + rows * 92);
      let x = padX;
      spec.cols.forEach((col, i) => {
        col.forEach((id, j) => {
          if (!id || !N[id]) return; const n = N[id];
          if (!n._fixedW) n.w = colW[i];
          n.x = Math.round(x + (colW[i] - n.w) / 2);
          n.y = Math.round(top + (spec.h - top - bot) * (j + 0.5) / col.length - n.h / 2);
        });
        x += colW[i] + gap;
      });
      (spec.groups || []).forEach(g => {
        if (!g.cols) return; const ids = g.cols.flatMap(i => spec.cols[i] || []).filter(id => N[id]);
        const xs = ids.map(id => N[id].x), xe = ids.map(id => N[id].x + N[id].w), ys = ids.map(id => N[id].y), ye = ids.map(id => N[id].y + N[id].h);
        g.x = Math.min(...xs) - 10; g.w = Math.max(...xe) - g.x + 10; g.y = Math.min(...ys) - 26; g.h = Math.max(...ye) - g.y + 10;
        g.y = Math.max(4, g.y);
      });
      spec._laid = true;
    }
    const W = spec.w || 800, H = spec.h || 360;
    const groups = (spec.groups || []).map(g => `<g class="dg-group"><rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="2"></rect><text x="${g.x + 10}" y="${g.y + 15}">${A.esc(g.label)}</text></g>`).join('');
    const edges = spec.edges.map((e, k) => {
      const a = N[e.a], b = N[e.b]; if (!a || !b) return '';
      const ac = [a.x + a.w / 2, a.y + a.h / 2], bc = [b.x + b.w / 2, b.y + b.h / 2];
      let mx = (ac[0] + bc[0]) / 2, my = (ac[1] + bc[1]) / 2;
      if (e.bend) { const dx = bc[0] - ac[0], dy = bc[1] - ac[1], L = Math.hypot(dx, dy) || 1; mx += -dy / L * e.bend; my += dx / L * e.bend; }
      const p1 = boxEdge(a, mx, my), p2 = boxEdge(b, mx, my);
      const d = e.bend ? `M${p1[0].toFixed(1)},${p1[1].toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}` : `M${p1[0].toFixed(1)},${p1[1].toFixed(1)} L${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
      const lx = e.bend ? (p1[0] + 2 * mx + p2[0]) / 4 : (p1[0] + p2[0]) / 2, ly = e.bend ? (p1[1] + 2 * my + p2[1]) / 4 : (p1[1] + p2[1]) / 2;
      const room = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) - 14;
      const lab = e.label && e.label.length * 6.3 + 10 <= room ? (() => { const tw = e.label.length * 6.3 + 10; return `<rect class="lb" x="${(lx - tw / 2).toFixed(1)}" y="${(ly - 9).toFixed(1)}" width="${tw.toFixed(1)}" height="16"></rect><text x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="middle">${A.esc(e.label)}</text>`; })() : '';
      return `<g class="dg-edge ${e.dash ? 'dash' : ''}" data-k="${k}" data-step="${e.step || ''}"><path d="${d}" marker-end="url(#${uid}-a)"></path>${lab}</g>`;
    }).join('');
    const nodes = spec.nodes.map(n => `<g class="dg-node t-${n.tone || 'base'}" data-id="${n.id}" tabindex="0" role="button" aria-label="${A.esc(n.label)}"><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="2"></rect>
      <text x="${n.x + n.w / 2}" y="${n.y + (n.sub ? n.h / 2 - 3 : n.h / 2 + 4.5)}" text-anchor="middle">${A.esc(n.label)}</text>${n.sub ? `<text class="sub" x="${n.x + n.w / 2}" y="${n.y + n.h / 2 + 13}" text-anchor="middle">${A.esc(n.sub)}</text>` : ''}</g>`).join('');
    const hasSteps = (spec.steps || []).length > 0;
    host.innerHTML = `
      <div class="dg-tool"><span class="faint mono" style="font-size:11px">Click any box for its role${hasSteps ? ' · play the request flow step by step' : ''}</span>
        ${hasSteps ? `<span class="badges"><button class="btn sm" data-dg="prev">← Step</button><button class="btn sm volt" data-dg="play">▶ Play flow</button><button class="btn sm" data-dg="next">Step →</button></span>` : ''}</div>
      <div class="dg-wrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${A.esc(spec.title || 'diagram')}">
        <defs><marker id="${uid}-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path class="dg-arrow" d="M0,0 L10,5 L0,10 z"></path></marker></defs>
        ${groups}${edges}${nodes}</svg></div>
      <div class="dg-info" aria-live="polite"><b>${hasSteps ? 'Request flow' : 'How to read it'}</b><span class="dg-txt">${spec.caption || ''}</span></div>`;
    const info = host.querySelector('.dg-txt'), lbl = host.querySelector('.dg-info b');
    const select = id => {
      host.querySelectorAll('.dg-node').forEach(g => g.classList.toggle('sel', g.dataset.id === id));
      const n = N[id]; lbl.textContent = n.label; info.innerHTML = n.info || n.sub || '';
    };
    host.querySelectorAll('.dg-node').forEach(g => {
      g.addEventListener('click', () => select(g.dataset.id));
      g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(g.dataset.id); } });
    });
    if (!hasSteps) return;
    let k = 0, timer = null;
    const show = s => {
      k = Math.max(0, Math.min(spec.steps.length, s));
      host.querySelectorAll('.dg-edge').forEach(g => g.classList.toggle('hot', +g.dataset.step === k));
      host.querySelectorAll('.dg-node').forEach(g => g.classList.remove('sel'));
      lbl.textContent = k ? `Step ${k} / ${spec.steps.length}` : 'Request flow';
      info.innerHTML = k ? spec.steps[k - 1] : (spec.caption || '');
    };
    const stop = () => { clearInterval(timer); timer = null; const b = host.querySelector('[data-dg=play]'); if (b) b.textContent = '▶ Play flow'; };
    host.querySelector('[data-dg=prev]').onclick = () => { stop(); show(k - 1); };
    host.querySelector('[data-dg=next]').onclick = () => { stop(); show(k + 1 > spec.steps.length ? 1 : k + 1); };
    host.querySelector('[data-dg=play]').onclick = ev => {
      if (timer) { stop(); return; }
      ev.currentTarget.textContent = '❚❚ Pause'; show(1);
      timer = setInterval(() => { if (k >= spec.steps.length) { stop(); return; } show(k + 1); }, 2200);
    };
  };
})();

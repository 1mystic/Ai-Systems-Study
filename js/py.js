/* Main-thread side of the in-browser Python runner. */
(function () {
  const A = window.AISA;
  let worker = null, dead = false, seq = 0;
  const pending = {};
  function spawn() {
    try {
      worker = new Worker('js/pyworker.js');
      worker.onmessage = ev => { const m = ev.data, p = pending[m.id]; if (!p) return; if (m.type === 'status') p.status(m.text); else { delete pending[m.id]; clearTimeout(p.t); if (m.unavailable) dead = true; p.resolve(m); } };
      worker.onerror = () => { dead = true; Object.values(pending).forEach(p => { clearTimeout(p.t); p.resolve({ unavailable: true }); }); for (const k in pending) delete pending[k]; };
    } catch (e) { dead = true; }
  }
  A.py = {
    run(code, status) {
      if (dead) return Promise.resolve({ unavailable: true });
      if (!worker) spawn();
      if (dead) return Promise.resolve({ unavailable: true });
      const id = ++seq;
      return new Promise(resolve => {
        const t = setTimeout(() => {
          delete pending[id]; worker.terminate(); worker = null;
          resolve({ ok: false, out: '', err: 'Stopped after 60 seconds. Look for an infinite loop or a missing await.' });
        }, 60000);
        pending[id] = { resolve, status: status || (() => {}), t };
        worker.postMessage({ id, code });
      });
    }
  };
})();

/* Runs learner code in Pyodide inside a worker so a long loop can be stopped.
   The host does not serve .zip/.whl files, so the standard library and the few wheels we need
   arrive as base64 inside .js data files (built by tools/pack.mjs) and are handed to Pyodide from memory. */
let py = null, version = '';
const base = new URL('../vendor/pyodide/', self.location.href).href;
const WHEELS = {
  pydantic: ['typing_extensions-4.11.0-py3-none-any.whl', 'annotated_types-0.6.0-py3-none-any.whl',
             'pydantic_core-2.27.2-cp312-cp312-pyodide_2024_0_wasm32.whl', 'pydantic-2.10.5-py3-none-any.whl'],
  sqlite3: ['sqlite3-1.0.0-cp312-cp312-pyodide_2024_0_wasm32.whl'],
  numpy: ['numpy-2.0.2-cp312-cp312-pyodide_2024_0_wasm32.whl']
};
const installed = new Set();
function bytesOf(name) {
  importScripts(base + name + '.js');
  const b64 = self.__PYBLOB[name]; delete self.__PYBLOB[name];
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function boot() {
  importScripts(base + 'pyodide.js');
  const stdlib = URL.createObjectURL(new Blob([bytesOf('python_stdlib.zip')], { type: 'application/zip' }));
  py = await loadPyodide({ indexURL: base, stdLibURL: stdlib });
  version = py.runPython('import sys; sys.version.split()[0]');
}
async function ensurePackages(src) {
  for (const [mod, wheels] of Object.entries(WHEELS)) {
    const re = new RegExp('^\\s*(?:from\\s+' + mod + '\\b|import\\s+(?:[\\w.]+\\s*,\\s*)*' + mod + '\\b)', 'm');
    if (!re.test(src)) continue;
    for (const w of wheels) {
      if (installed.has(w)) continue;
      await py.unpackArchive(bytesOf(w), 'wheel', { extractDir: '/lib/python3.12/site-packages' });
      installed.add(w);
    }
  }
  py.runPython('import importlib; importlib.invalidate_caches()');
}
let ready = null;
self.onmessage = async (ev) => {
  const { id, code } = ev.data;
  try {
    if (!ready) { self.postMessage({ id, type: 'status', text: 'Loading Python (first run downloads ~12 MB)…' }); ready = boot(); }
    await ready;
  } catch (e) {
    self.postMessage({ id, type: 'done', unavailable: true, err: String(e) }); return;
  }
  const out = [], err = [];
  py.setStdout({ batched: s => out.push(s) });
  py.setStderr({ batched: s => err.push(s) });
  // The browser already runs an event loop, so asyncio.run(main()) becomes a top-level await.
  const src = code.replace(/^(\s*)asyncio\.run\(/gm, '$1await (').replace(/^(?=\S)(.*?)\basyncio\.run\(/gm, '$1await (');
  try {
    self.postMessage({ id, type: 'status', text: 'Running…' });
    await ensurePackages(src);
    const g = py.toPy({ __name__: '__main__' });
    await py.runPythonAsync(src, { globals: g });
    self.postMessage({ id, type: 'done', ok: true, out: out.join('\n'), version });
  } catch (e) {
    const msg = String(e.message || e).split('\n').filter(l => !/^\s*File "\/lib\/python/.test(l)).join('\n');
    self.postMessage({ id, type: 'done', ok: false, out: out.join('\n'), err: (err.join('\n') + '\n' + msg).trim() });
  }
};

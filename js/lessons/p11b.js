/* Phase 11 · FDE craft (part 2) */
(function () {
const L = AISA.lesson;

/* ===================================================================== 11.5 */
L({
  id: '11.5', title: 'Data-stack integration', minutes: 55, roles: ['fde', 'be'],
  tags: 'warehouses and lakehouses · Snowflake, Databricks, BigQuery · incremental sync · watermarks · CDC · idempotent upserts · deletes · data contracts · freshness SLAs',
  mental: 'AI systems are only as current and correct as the data feeding them. Integrate with the customer\u2019s data stack through approved routes, move only what changed, propagate deletes, validate against data contracts, and monitor freshness as a first-class SLO.',
  intro: `<p>Customer knowledge lives in warehouses and lakehouses (Snowflake, Databricks, BigQuery, Redshift), SaaS systems (Salesforce, ServiceNow, SharePoint, Confluence) and operational databases. Getting it into retrieval indexes and agent tools reliably is a large share of FDE work. The hard parts are not the first load but the hundredth: changes, deletions, schema drift, permissions and freshness.</p>
  <p>Many platforms now offer AI features in place (for example Snowflake Cortex and Databricks vector search). Using them can keep data inside existing governance; the integration patterns below apply either way.</p>`,
  points: [
    'Prefer the customer\u2019s existing pipelines and orchestration (Airflow, Dagster, dbt, Databricks Workflows) over a new stack.',
    'Incremental sync with a watermark (<code class="i">updated_at</code> or a change sequence); never full reloads for large sources.',
    'Change data capture (CDC) streams inserts, updates and deletes with ordering; apply them idempotently using the sequence number.',
    'Deletes must propagate to indexes and caches (legal and permission reasons); use tombstones.',
    'Hash content to skip re-embedding unchanged rows; embeddings are the expensive step.',
    'Data contracts (schema, types, allowed values, freshness) checked at the boundary; quarantine bad records instead of failing the whole batch.'
  ],
  concept: { title: 'A newspaper\u2019s corrections column', body: `<p>A newspaper does not reprint every past issue when a fact changes. It publishes corrections and retractions, numbered and dated, and readers who keep an archive apply them in order. Incremental sync and CDC are the same idea: send only the changes, in order, including retractions (deletes).</p>` },
  walk: [
    { h: 'Watermark sync', body: '<p>Read rows changed since the last successful watermark, upsert them, then advance the watermark in the same transaction as the writes.</p>', code: String.raw`last = state.get("kb_articles_watermark", "1970-01-01")
rows = warehouse.query("SELECT id, title, body, acl, updated_at, is_deleted FROM kb.articles "
                       "WHERE updated_at > %s ORDER BY updated_at LIMIT 5000", [last])
for r in rows:
    if r.is_deleted: index.delete(doc_id=r.id)            # tombstone
    elif sha(r.body) != index.hash(r.id): index.upsert(r.id, chunks(r.body), acl=r.acl)
state.set("kb_articles_watermark", rows[-1].updated_at)   # only after the writes succeed` },
    { h: 'Watermark pitfalls', body: '<p>Rows with equal timestamps at a batch boundary can be skipped; use <code class="i">(updated_at, id)</code> as a compound cursor or overlap the window slightly and rely on idempotent upserts. Clock skew between systems can also hide rows; a sequence number from the source (log sequence number in CDC) is safer.</p>' },
    { h: 'Data contracts', body: '<p>Agree with the data owner: column names and types, allowed values, null rules, primary key, freshness (e.g. updated hourly), and who is notified when it breaks. Validate each batch; quarantine failures with reasons; alert when quarantine rate or staleness exceeds thresholds.</p>' }
  ],
  analogy: `<p><b>Restocking a shop from a warehouse.</b> You do not empty the shelves and refill everything each morning. You read yesterday\u2019s delivery note (changes), restock what changed, pull recalled items (deletes), and reject damaged boxes at the loading dock (contract checks) instead of refusing the whole truck.</p>`,
  diagram: {
    title: 'Keeping an AI index in sync with the data stack',
    cols: [['src', 'cdc'], ['contract'], ['q'], ['diff'], ['emb'], ['idx'], ['fresh']],
    nodes: [
      { id: 'src', label: 'Warehouse / SaaS', sub: 'Snowflake · Databricks · SharePoint', tone: 'fde', info: 'Approved views or APIs with a service identity.' },
      { id: 'cdc', label: 'CDC stream', sub: 'inserts · updates · deletes', tone: 'fde', info: 'Ordered by sequence number.' },
      { id: 'contract', label: 'Data contract', sub: 'schema · values · freshness', tone: 'warn', info: 'Validate at the boundary.' },
      { id: 'q', label: 'Quarantine', sub: 'bad records + reasons', tone: 'bad', info: 'Do not fail the batch; alert on rate.' },
      { id: 'diff', label: 'Change detection', sub: 'content hash', tone: 'acc', info: 'Skip unchanged; handle deletes.' },
      { id: 'emb', label: 'Chunk + embed', sub: 'only changed docs', tone: 'be', info: 'The expensive step.' },
      { id: 'idx', label: 'Index', sub: 'idempotent upserts · ACLs', tone: 'ok', info: 'Keyed by source id and version.' },
      { id: 'fresh', label: 'Freshness SLO', sub: 'lag · coverage', tone: 'warn', info: 'Alert when the index falls behind (10.7).' }
    ],
    edges: [{ a: 'src', b: 'contract' }, { a: 'cdc', b: 'contract' }, { a: 'contract', b: 'q', label: 'fail' }, { a: 'contract', b: 'diff', bend: 40, label: 'pass' }, { a: 'diff', b: 'emb' }, { a: 'emb', b: 'idx' }, { a: 'idx', b: 'fresh' }],
    caption: 'Validate, detect changes, embed only what changed, watch freshness.'
  },
  illustrated: { title: 'Integration options', body: `<div class="tbl"><table><thead><tr><th>pattern</th><th>good for</th><th>watch out for</th></tr></thead><tbody>
    <tr><td>scheduled incremental pull</td><td>warehouses, most SaaS APIs</td><td>boundary rows, API rate limits</td></tr>
    <tr><td>CDC (Debezium, native streams)</td><td>operational databases, low latency</td><td>ordering, schema changes, ops burden</td></tr>
    <tr><td>webhooks</td><td>SaaS events (ticket updated)</td><td>missed events: pair with periodic reconciliation</td></tr>
    <tr><td>in-platform AI (vector search in the lakehouse)</td><td>keeping data under existing governance</td><td>feature gaps, platform lock-in</td></tr>
    <tr><td>query in place via tools (text-to-SQL, APIs)</td><td>live numbers, structured data</td><td>latency, permissions, query safety</td></tr></tbody></table></div>` },
  code: {
    title: 'Incremental sync with a compound cursor, hashes, tombstones and a data contract', file: 'sync.py', browser: true,
    intro: '<p>A source table (standing in for a warehouse view) and a target index, both in SQLite. Three sync runs show: initial load, an update batch with rows sharing a timestamp across the batch boundary, unchanged rows skipped by hash, a delete propagated, and contract violations quarantined. Embedding is simulated and counted, because that is the cost to minimise.</p>',
    src: String.raw`import hashlib, sqlite3
from pydantic import BaseModel, Field, ValidationError
from typing import Literal

src = sqlite3.connect(":memory:"); idx = sqlite3.connect(":memory:")
src.execute("CREATE TABLE articles (id INT PRIMARY KEY, title TEXT, body TEXT, acl TEXT, updated_at TEXT, is_deleted INT DEFAULT 0)")
idx.executescript("""CREATE TABLE docs (id INT PRIMARY KEY, sha TEXT, acl TEXT, chunks INT);
CREATE TABLE quarantine (id INT, reason TEXT); CREATE TABLE state (k TEXT PRIMARY KEY, v TEXT);""")

class Article(BaseModel):                         # the data contract
    id: int
    title: str = Field(min_length=3)
    body: str = Field(min_length=20)
    acl: Literal["all", "support", "finance"]
    updated_at: str
    is_deleted: int

embedded = 0
def embed_and_store(a: Article, sha):
    global embedded
    n = max(1, len(a.body) // 200); embedded += n
    idx.execute("INSERT INTO docs VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET sha=excluded.sha, acl=excluded.acl, chunks=excluded.chunks", (a.id, sha, a.acl, n))

def sync(batch_size=4):
    global embedded
    embedded, stats = 0, {"upserted": 0, "skipped": 0, "deleted": 0, "quarantined": 0}
    cur = (idx.execute("SELECT v FROM state WHERE k='cursor'").fetchone() or ["1970-01-01|0"])[0]
    ts, last_id = cur.split("|")
    while True:
        rows = src.execute("SELECT * FROM articles WHERE (updated_at, id) > (?, ?) ORDER BY updated_at, id LIMIT ?",
                           (ts, int(last_id), batch_size)).fetchall()
        if not rows: break
        for r in rows:
            try:
                a = Article(**dict(zip(["id", "title", "body", "acl", "updated_at", "is_deleted"], r)))
            except ValidationError as e:
                idx.execute("INSERT INTO quarantine VALUES (?,?)", (r[0], "; ".join(f"{x['loc'][0]}: {x['msg']}" for x in e.errors())))
                stats["quarantined"] += 1
                continue
            if a.is_deleted:
                stats["deleted"] += idx.execute("DELETE FROM docs WHERE id=?", (a.id,)).rowcount
                continue
            sha = hashlib.sha256((a.title + a.body + a.acl).encode()).hexdigest()
            if (idx.execute("SELECT sha FROM docs WHERE id=?", (a.id,)).fetchone() or [None])[0] == sha:
                stats["skipped"] += 1
            else:
                embed_and_store(a, sha); stats["upserted"] += 1
        ts, last_id = rows[-1][4], rows[-1][0]
        idx.execute("INSERT OR REPLACE INTO state VALUES ('cursor', ?)", (f"{ts}|{last_id}",))
        idx.commit()                                      # cursor advances with the writes
    return stats | {"chunks_embedded": embedded}

body = lambda i, v=1: f"Article {i} version {v}: how to handle refunds, invoices and plan changes for enterprise customers."
src.executemany("INSERT INTO articles VALUES (?,?,?,?,?,0)", [(i, f"Guide {i}", body(i), "all" if i % 3 else "support", "2026-10-20T09:00") for i in range(1, 11)])
print("run 1:", sync())
src.execute("UPDATE articles SET body=?, updated_at='2026-10-21T10:00' WHERE id IN (2, 3, 4, 5, 6)", (body(0, 2),))
src.execute("UPDATE articles SET updated_at='2026-10-21T10:00' WHERE id=7")               # touched, content unchanged
src.execute("UPDATE articles SET is_deleted=1, updated_at='2026-10-21T10:05' WHERE id=8")
src.execute("INSERT INTO articles VALUES (11, 'Ok', 'short', 'everyone', '2026-10-21T10:06', 0)")  # breaks the contract
print("run 2:", sync())
print("run 3 (nothing changed):", sync())
print("index:", idx.execute("SELECT COUNT(*), SUM(chunks) FROM docs").fetchone(), "| quarantine:", idx.execute("SELECT * FROM quarantine").fetchall())`
  },
  lab: {
    title: 'Apply an out-of-order CDC stream idempotently', file: 'cdc_lab.py', browser: true,
    scenario: `<p>The customer\u2019s ticket database streams changes (Debezium-style events with an operation, the row after the change, and a log sequence number, LSN). Events can arrive late, duplicated or out of order across partitions. Build the consumer that keeps a retrieval index correct: apply each change only if its LSN is newer than what the index holds for that row, handle deletes with tombstones (so a late update cannot resurrect a deleted row), and prove the final state equals the source.</p>`,
    steps: ['Generate a source history of 300 operations over 60 tickets (create, update, delete, re-create is not allowed).', 'Build the event list, then shuffle within windows, duplicate 10% and delay 5% to the end.', 'Consumer state per id: last_lsn and either the row or a tombstone.', 'Apply rule: ignore events with lsn \u2264 last_lsn; deletes write a tombstone with their lsn.', 'Compare the index with the true final source state; count ignored stale and duplicate events.'],
    checks: ['Final index equals the source exactly.', 'No deleted ticket reappears.', 'Re-applying the whole stream changes nothing (idempotent).'],
    hints: ['Tombstones can be garbage-collected after a retention window longer than the maximum event delay.', 'Real CDC tools (Debezium, cloud database streams) attach LSNs or offsets you can use the same way.'],
    starter: String.raw`import random
random.seed(9)
source, events, lsn = {}, [], 0
for _ in range(300):
    lsn += 1
    tid = random.randint(1, 60)
    if tid not in source:
        source[tid] = {"id": tid, "status": "open", "text": f"ticket {tid} v{lsn}"}; events.append({"op": "c", "lsn": lsn, "after": dict(source[tid])})
    elif random.random() < 0.08 and source[tid] is not None:
        source[tid] = None; events.append({"op": "d", "lsn": lsn, "id": tid})
    elif source[tid] is not None:
        source[tid] = {**source[tid], "status": random.choice(["open", "pending", "solved"]), "text": f"ticket {tid} v{lsn}"}; events.append({"op": "u", "lsn": lsn, "after": dict(source[tid])})
# TODO: disorder the stream, consume, verify`,
    solution: String.raw`import random
random.seed(9)
source, events, lsn = {}, [], 0
for _ in range(300):
    lsn += 1
    tid = random.randint(1, 60)
    if tid not in source:
        source[tid] = {"id": tid, "status": "open", "text": f"ticket {tid} v{lsn}"}; events.append({"op": "c", "lsn": lsn, "after": dict(source[tid])})
    elif random.random() < 0.08 and source[tid] is not None:
        source[tid] = None; events.append({"op": "d", "lsn": lsn, "id": tid})
    elif source[tid] is not None:
        source[tid] = {**source[tid], "status": random.choice(["open", "pending", "solved"]), "text": f"ticket {tid} v{lsn}"}; events.append({"op": "u", "lsn": lsn, "after": dict(source[tid])})

stream = []
for i in range(0, len(events), 20):                       # reorder within windows (partitions)
    w = events[i:i + 20]; random.shuffle(w); stream += w
stream += random.sample(events, len(events) // 10)        # duplicates
late = random.sample(range(len(stream)), len(stream) // 20)
stream = [e for k, e in enumerate(stream) if k not in late] + [stream[k] for k in late]

index, stats = {}, {"applied": 0, "stale_or_duplicate": 0}
def consume(e):
    key = e["after"]["id"] if e["op"] != "d" else e["id"]
    cur = index.get(key)
    if cur and e["lsn"] <= cur["lsn"]:
        stats["stale_or_duplicate"] += 1; return
    index[key] = {"lsn": e["lsn"], "row": None if e["op"] == "d" else e["after"]}
    stats["applied"] += 1

for e in stream: consume(e)
live = {k: v["row"] for k, v in index.items() if v["row"] is not None}
truth = {k: v for k, v in source.items() if v is not None}
print(f"events {len(events)}, delivered {len(stream)} (shuffled, duplicated, delayed) -> {stats}")
print("index == source:", live == truth, f"({len(live)} live tickets, {sum(v['row'] is None for v in index.values())} tombstones)")
deleted = {k for k, v in source.items() if v is None}
print("deleted tickets resurrected:", len(deleted & set(live)))
before = dict(index); [consume(e) for e in stream]
print("idempotent (replay changes nothing):", index == before)`
  },
  design: {
    lead: '<p>Data integration determines whether an AI system is trusted: stale, missing or leaked data destroys confidence faster than any model error. Design for change, deletion, permissions and freshness from the first pipeline.</p>',
    scale: [{ h: 'Large corpora', p: 'Parallelise by partition, batch embeddings, and keep per-source state; reindex in the background with alias swaps (4.4) when chunking or models change.' }, { h: 'Many sources', p: 'One connector framework with shared contracts, state, metrics and quarantine; per-source configs rather than per-source code.' }],
    fail: [{ h: 'Deletes not propagated', p: 'Deleted or permission-restricted documents keep appearing in answers. Treat deletes as first-class events and reconcile periodically.' }, { h: 'Schema drift', p: 'A renamed column silently empties a field. Contracts and quarantine metrics catch it on the first batch.' }],
    trade: [{ h: 'Copy vs in-platform AI', p: 'Copying into your index gives control over chunking and retrieval; in-platform vector search keeps governance and lineage in the customer\u2019s stack.' }, { h: 'Latency vs cost', p: 'CDC gives minutes of lag at higher operational cost; hourly batches are simpler and often enough. Pick by freshness SLO.' }],
    prompt: '<p>Index 2 million Confluence and SharePoint pages for a RAG assistant with permission-aware retrieval and a freshness SLO of one hour.</p>',
    answer: '<ul><li>Connectors using delta APIs or change feeds with per-space cursors; periodic full reconciliation weekly for missed events and deletes.</li><li>ACLs synced with each document and on group changes; enforced at query time.</li><li>Content hashing to skip unchanged pages; batch embedding with rate limits; quarantine for parse failures.</li><li>Freshness metrics per source (lag p95, failed pages) with alerts; reindex via a new index and alias swap when models change.</li></ul>'
  },
  quiz: [
    { q: 'Why use a compound cursor (updated_at, id)?', o: ['It is faster', 'Rows sharing a timestamp at a batch boundary are not skipped', 'For encryption', 'It sorts alphabetically'], a: 1, why: 'Ties at the boundary break simple timestamp watermarks.' },
    { q: 'In a CDC consumer, a late update arrives for a deleted row. The correct behaviour:', o: ['Recreate the row', 'Ignore it because the tombstone has a newer LSN', 'Crash', 'Delete the index'], a: 1, why: 'Tombstones prevent resurrection.' },
    { q: 'What is the main reason to hash content before embedding?', o: ['Security', 'Skip re-embedding unchanged documents, the expensive step', 'Compression', 'Deduplication of users'], a: 1, why: 'Cost and time.' }
  ],
  interview: [
    { q: 'How do you keep a RAG index in sync with source systems?', a: '<p>Incremental sync via cursors or change feeds, applied idempotently with sequence numbers; deletes as tombstones; content hashing to avoid re-embedding; data contracts with quarantine; permissions synced with documents; periodic reconciliation; and freshness and quarantine metrics with alerts.</p>' },
    { q: 'A customer\u2019s data lives in Snowflake. How would you build retrieval over it?', a: '<p>Options: use in-platform AI features (such as vector search and LLM functions offered in the platform) to keep data and governance in place, or sync approved views into an external index through their orchestration with a service role. Choose by governance requirements, feature needs and latency; either way enforce row and document permissions and monitor freshness.</p>' }
  ]
});

/* ===================================================================== 11.6 */
L({
  id: '11.6', title: 'Thin frontends: TypeScript, Streamlit', minutes: 50, roles: ['fde'],
  tags: 'Streamlit for internal tools · AppTest · TypeScript SSE clients · streaming UX · citations and feedback · embedding into existing apps',
  mental: 'FDEs build just enough frontend to put the system in users\u2019 hands and learn: a Streamlit app for internal pilots in hours, or a small TypeScript client that streams into the customer\u2019s existing web app. The backend owns logic; the frontend renders streams, citations, status and feedback.',
  intro: `<p>Users judge an AI system by its interface: how fast the first words appear, whether sources are visible, whether they can correct it. FDEs rarely build full products, but they routinely build pilot UIs and integrate into existing applications (Salesforce panels, internal portals, Teams or Slack apps). Two tools cover most cases: Streamlit for Python-native internal tools, and TypeScript for embedding into web apps.</p>`,
  points: [
    'Keep the frontend thin: no prompts, keys or business logic in the browser; call your backend API.',
    'Stream tokens (SSE, 1.x) and show progress for tool steps; first visible output under a second matters more than total time.',
    'Show citations and let users open sources; trust grows when answers are checkable.',
    'Capture feedback (thumbs, corrections, \u201cwrong source\u201d) with trace ids so it flows into evals (7.7).',
    'Streamlit: fast to build, test with <code class="i">AppTest</code>, deploy behind SSO; good for pilots and internal tools.',
    'TypeScript: typed event protocol, robust SSE parsing across chunk boundaries, cancellation with <code class="i">AbortController</code>.'
  ],
  concept: { title: 'A shop window, not the shop', body: `<p>The frontend is the shop window: it should show what is inside clearly and invite people in, but the stock, prices and rules live in the shop (the backend). Change the window freely; never keep the till in it.</p>` },
  walk: [
    { h: 'A Streamlit pilot UI', body: '<p>Chat, sources and feedback in a few dozen lines. Session state holds the conversation; the backend call is a function you can mock in tests.</p>', file: 'app.py', code: String.raw`if q := st.chat_input("Ask about a claim"):
    st.session_state.history.append(("user", q))
    with st.chat_message("assistant"):
        result = backend.ask(q, user=st.session_state.user)       # your API, not a model call
        st.write(result.answer)
        with st.expander(f"Sources ({len(result.sources)})"):
            for s in result.sources: st.markdown(f"- [{s.title}]({s.url})")
        st.feedback("thumbs", key=f"fb-{result.trace_id}")` },
    { h: 'A TypeScript streaming client', body: '<p>Fetch with a stream reader; buffer partial lines; dispatch typed events; support cancel. The Code tab runs this exact client with Node against a Python SSE server.</p>', lang: 'ts', file: 'client.ts', code: String.raw`type Ev = { event: "delta"; text: string } | { event: "citation"; id: string; title: string } | { event: "done"; trace_id: string };
const res = await fetch(url, { method: "POST", body: JSON.stringify({ q }), signal: controller.signal });
const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
let buf = "";
for (;;) {
  const { value, done } = await reader.read(); if (done) break;
  buf += value;
  let i; while ((i = buf.indexOf("\n\n")) >= 0) { handle(parse(buf.slice(0, i))); buf = buf.slice(i + 2); }
}` },
    { h: 'Embedding into existing apps', body: '<p>Customers often want the assistant where users already work: a side panel in the CRM, a Teams or Slack bot, a browser extension. Reuse the same backend API and event protocol; adapt only the rendering and authentication (the host app\u2019s SSO or tokens).</p>' }
  ],
  analogy: `<p><b>A theatre stage.</b> The audience sees actors, lights and props (the frontend), but the script, direction and stage machinery are backstage (the backend). A touring production can play many theatres because the stage is thin and the machinery travels with it.</p>`,
  diagram: {
    title: 'Thin frontends over one backend API',
    cols: [['st', 'ts', 'bot'], ['proto'], ['api'], ['svc', 'fb']],
    nodes: [
      { id: 'st', label: 'Streamlit pilot', sub: 'internal users', tone: 'fde', info: 'Fast to build; AppTest for tests; behind SSO.' },
      { id: 'ts', label: 'TypeScript widget', sub: 'inside the customer app', tone: 'fde', info: 'Typed SSE client, cancellation.' },
      { id: 'bot', label: 'Teams / Slack bot', sub: 'where users work', tone: 'fde', info: 'Same API, different rendering.' },
      { id: 'proto', label: 'Event protocol', sub: 'delta · citation · status · done', tone: 'acc', info: 'Versioned, documented, tested.' },
      { id: 'api', label: 'Backend API', sub: 'auth · prompts · tools', tone: 'be', info: 'All logic and secrets live here.' },
      { id: 'svc', label: 'AI services', sub: 'RAG · agents · models', tone: 'ok', info: 'Phases 3\u20139.' },
      { id: 'fb', label: 'Feedback store', sub: 'trace id + rating', tone: 'warn', info: 'Feeds evals and monitoring.' }
    ],
    edges: [{ a: 'st', b: 'proto' }, { a: 'ts', b: 'proto' }, { a: 'bot', b: 'proto' }, { a: 'proto', b: 'api' }, { a: 'api', b: 'svc' }, { a: 'api', b: 'fb' }],
    caption: 'Many thin clients, one typed stream protocol, one backend.'
  },
  illustrated: { title: 'Streamlit or TypeScript?', body: `<div class="tbl"><table><thead><tr><th>situation</th><th>choose</th></tr></thead><tbody>
    <tr><td>internal pilot, 20 users, needs to exist this week</td><td>Streamlit behind SSO</td></tr>
    <tr><td>analysts exploring data with charts</td><td>Streamlit</td></tr>
    <tr><td>assistant inside the customer\u2019s existing web app</td><td>TypeScript widget or component</td></tr>
    <tr><td>public-facing, branded, high traffic</td><td>the customer\u2019s frontend team, your API and protocol</td></tr>
    <tr><td>users live in Teams or Slack</td><td>a bot using the same API</td></tr></tbody></table></div>` },
  code: {
    title: 'A tested Streamlit app and a TypeScript SSE client, run for real', file: 'terminal', lang: 'bash', deps: 'uv add streamlit · Node 22+',
    intro: '<p>Runs a Streamlit chat app headlessly with <code class="i">AppTest</code> (asserting answers, citations and the fallback), then starts a small Python SSE server and streams from it with a TypeScript client executed by Node\u2019s built-in type stripping. The server deliberately splits events across network chunks to show why buffering matters.</p>',
    files: {
      'app.py': 'import streamlit as st\nimport backend\n\nst.title("Claims assistant")\nif "history" not in st.session_state:\n    st.session_state.history = []\nfor role, text in st.session_state.history:\n    st.chat_message(role).write(text)\nif q := st.chat_input("Ask about a claim"):\n    st.session_state.history.append(("user", q))\n    st.chat_message("user").write(q)\n    r = backend.ask(q)\n    with st.chat_message("assistant"):\n        st.write(r["answer"])\n        if r["sources"]:\n            st.caption("Sources: " + ", ".join(r["sources"]))\n    st.session_state.history.append(("assistant", r["answer"]))\n',
      'backend.py': 'def ask(q):\n    if "windscreen" in q.lower():\n        return {"answer": "Windscreen damage is covered with a $100 excess.", "sources": ["motor-playbook \\u00a74.2"]}\n    return {"answer": "I could not find that in the claims playbook. Try asking a claims manager.", "sources": []}\n',
      'test_app.py': 'from streamlit.testing.v1 import AppTest\n\nat = AppTest.from_file("app.py").run()\nassert at.title[0].value == "Claims assistant"\nat.chat_input[0].set_value("Is windscreen damage covered?").run()\nmsgs = at.chat_message\nassert msgs[-1].name == "assistant" and "covered" in msgs[-1].markdown[0].value\nassert "motor-playbook" in at.caption[0].value\nat.chat_input[0].set_value("What is the fraud threshold?").run()\nassert "could not find" in at.chat_message[-1].markdown[0].value\nprint(f"AppTest: {len(at.chat_message)} messages rendered, citation shown, fallback ok, exceptions={len(at.exception)}")\n',
      'server.py': 'import json, time\nfrom http.server import BaseHTTPRequestHandler, HTTPServer\n\nclass H(BaseHTTPRequestHandler):\n    def log_message(self, *a): pass\n    def do_POST(self):\n        self.rfile.read(int(self.headers.get("content-length", 0)))\n        self.send_response(200)\n        self.send_header("content-type", "text/event-stream")\n        self.send_header("cache-control", "no-cache")\n        self.end_headers()\n        events = [("status", {"text": "searching playbook"})] + [("delta", {"text": w + " "}) for w in "Windscreen damage is covered with a $100 excess.".split()] + [("citation", {"id": "motor-4.2", "title": "Motor playbook 4.2"}), ("done", {"trace_id": "tr_8f2"})]\n        wire = "".join(f"event: {e}\\ndata: {json.dumps(d)}\\n\\n" for e, d in events).encode()\n        for i in range(0, len(wire), 37):          # odd chunk size splits events mid-line\n            self.wfile.write(wire[i:i + 37]); self.wfile.flush(); time.sleep(0.01)\n\nHTTPServer(("127.0.0.1", 8765), H).serve_forever()\n',
      'client.ts': 'type Ev =\n  | { event: "status"; text: string }\n  | { event: "delta"; text: string }\n  | { event: "citation"; id: string; title: string }\n  | { event: "done"; trace_id: string };\n\nfunction parse(block: string): Ev {\n  let event = "message", data = "";\n  for (const line of block.split("\\n")) {\n    if (line.startsWith("event: ")) event = line.slice(7);\n    else if (line.startsWith("data: ")) data += line.slice(6);\n  }\n  return { event, ...JSON.parse(data) } as Ev;\n}\n\nasync function ask(q: string): Promise<void> {\n  const controller = new AbortController();\n  const t0 = performance.now();\n  const res = await fetch("http://127.0.0.1:8765/ask", { method: "POST", body: JSON.stringify({ q }), signal: controller.signal });\n  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();\n  let buf = "", answer = "", chunks = 0, first = 0;\n  const cites: string[] = [];\n  for (;;) {\n    const { value, done } = await reader.read();\n    if (done) break;\n    chunks++;\n    buf += value;\n    let i: number;\n    while ((i = buf.indexOf("\\n\\n")) >= 0) {\n      const ev = parse(buf.slice(0, i));\n      buf = buf.slice(i + 2);\n      switch (ev.event) {\n        case "status": console.log("[status] " + ev.text); break;\n        case "delta": if (!first) first = performance.now() - t0; answer += ev.text; break;\n        case "citation": cites.push(ev.title); break;\n        case "done": console.log("answer: " + answer.trim()); console.log("citations: " + cites.join(", ") + " | trace " + ev.trace_id); break;\n      }\n    }\n  }\n  console.log(chunks + " network chunks reassembled; first token after " + (first < 200 ? "<200" : Math.round(first)) + " ms");\n}\n\nawait ask("Is windscreen damage covered?");\n'
    },
    src: String.raw`export STREAMLIT_LOGGER_LEVEL=error
python3 test_app.py 2>&1 | grep -v "ScriptRunContext"
python3 server.py & SERVER=$!
sleep 0.5
node --experimental-strip-types --no-warnings client.ts
kill $SERVER`
  },
  lab: {
    title: 'A versioned stream protocol with a chunk-safe parser', file: 'protocol_lab.py', browser: true,
    scenario: `<p>Three frontends (Streamlit, a TypeScript widget, a Teams bot) will consume your backend stream. Define the protocol once with Pydantic models: <code class="i">status</code>, <code class="i">delta</code>, <code class="i">citation</code>, <code class="i">tool</code>, <code class="i">error</code>, <code class="i">done</code>, each with a protocol version. Write the encoder and an incremental parser that accepts arbitrary byte chunks (including splits inside multi-byte UTF-8 characters), rejects unknown or malformed events with a typed error, and reassembles the answer. Fuzz it with random chunkings.</p>`,
    steps: ['Pydantic models with a discriminator on <code class="i">event</code> and a <code class="i">v: Literal[1]</code> field.', '<code class="i">encode(events) -> bytes</code> in SSE format.', 'An incremental parser class with <code class="i">feed(bytes) -> list[Event]</code> using an incremental UTF-8 decoder.', 'Fuzz: 500 random chunkings of a stream containing non-ASCII text; all must parse identically.', 'Malformed and unknown events produce <code class="i">ProtocolError</code> with the offending block.'],
    checks: ['All chunkings yield the same events.', 'UTF-8 split across chunks does not corrupt text.', 'Unknown event types are reported, not silently dropped.'],
    hints: ['<code class="i">codecs.getincrementaldecoder("utf-8")()</code> keeps partial bytes between calls.', 'A <code class="i">TypeAdapter</code> over an annotated union with <code class="i">Field(discriminator="event")</code> validates quickly.'],
    starter: String.raw`import codecs, json, random
from typing import Annotated, Literal, Union
from pydantic import BaseModel, Field, TypeAdapter, ValidationError
# TODO: event models, encode, Parser.feed, fuzz test`,
    solution: String.raw`import codecs, json, random
from typing import Annotated, Literal, Union
from pydantic import BaseModel, Field, TypeAdapter, ValidationError

class Status(BaseModel): event: Literal["status"]; v: Literal[1] = 1; text: str
class Delta(BaseModel): event: Literal["delta"]; v: Literal[1] = 1; text: str
class Citation(BaseModel): event: Literal["citation"]; v: Literal[1] = 1; id: str; title: str
class Tool(BaseModel): event: Literal["tool"]; v: Literal[1] = 1; name: str; state: Literal["start", "end", "error"]
class Error(BaseModel): event: Literal["error"]; v: Literal[1] = 1; code: str; message: str
class Done(BaseModel): event: Literal["done"]; v: Literal[1] = 1; trace_id: str
Event = TypeAdapter(Annotated[Union[Status, Delta, Citation, Tool, Error, Done], Field(discriminator="event")])

class ProtocolError(Exception): pass

def encode(events) -> bytes:
    out = []
    for e in events:
        d = e.model_dump(); name = d["event"]
        out.append(f"event: {name}\ndata: {json.dumps(d, ensure_ascii=False)}\n\n")
    return "".join(out).encode()

class Parser:
    def __init__(self):
        self.dec, self.buf = codecs.getincrementaldecoder("utf-8")(), ""
    def feed(self, chunk: bytes):
        self.buf += self.dec.decode(chunk)
        out = []
        while "\n\n" in self.buf:
            block, self.buf = self.buf.split("\n\n", 1)
            data = "".join(l[6:] for l in block.split("\n") if l.startswith("data: "))
            try:
                out.append(Event.validate_python(json.loads(data)))
            except json.JSONDecodeError as e:
                raise ProtocolError(f"bad JSON in {block[:40]!r}: {e.msg}") from None
            except ValidationError as e:
                err = e.errors()[0]
                raise ProtocolError(f"invalid event in {block[:40]!r}: {err['msg']}") from None
        return out

stream = [Status(event="status", text="Suche im Handbuch…"), Tool(event="tool", name="policy_lookup", state="start"),
          Tool(event="tool", name="policy_lookup", state="end")] + \
         [Delta(event="delta", text=w + " ") for w in "Glasschäden sind mit 100 € Selbstbeteiligung gedeckt — siehe §4.2.".split()] + \
         [Citation(event="citation", id="kfz-4.2", title="Kfz-Handbuch §4.2"), Done(event="done", trace_id="tr_91a")]
wire = encode(stream)
reference = None
rng = random.Random(0)
for trial in range(500):
    p, events, i = Parser(), [], 0
    while i < len(wire):
        n = rng.randint(1, 23); events += p.feed(wire[i:i + n]); i += n
    if reference is None: reference = events
    assert events == reference, trial
answer = "".join(e.text for e in reference if isinstance(e, Delta)).strip()
print(f"500 random chunkings -> identical {len(reference)} events")
print("answer:", answer)
print("citations:", [e.title for e in reference if isinstance(e, Citation)], "| tools:", [(e.name, e.state) for e in reference if isinstance(e, Tool)])
for bad in (b'event: delta\ndata: {"event": "delta", "v": 2, "text": "x"}\n\n', b'event: confetti\ndata: {"event": "confetti", "v": 1}\n\n', b'data: {not json}\n\n'):
    try:
        Parser().feed(bad)
    except ProtocolError as e:
        print("ProtocolError:", e)`
  },
  design: {
    lead: '<p>Frontends are where trust is won or lost. Keep them thin and replaceable, share one typed protocol, make streaming, sources and feedback first-class, and test UIs like code.</p>',
    scale: [{ h: 'Many surfaces', p: 'A versioned event protocol and a small client SDK per language (TypeScript, Python) prevent each surface from re-implementing parsing and auth.' }, { h: 'From pilot to product', p: 'Streamlit pilots prove value; production surfaces usually move into the customer\u2019s frontend stack using the same API.' }],
    fail: [{ h: 'Logic in the browser', p: 'Prompts, keys or tool logic in client code leak and cannot be governed. Keep them server-side.' }, { h: 'Fragile stream parsing', p: 'Parsers that assume one event per network chunk break under real proxies and mobile networks.' }],
    trade: [{ h: 'Speed of building vs polish', p: 'Streamlit gets feedback in days with limited design control; custom frontends take longer but fit the customer\u2019s product.' }, { h: 'Rich UI vs simplicity', p: 'Showing tool steps and sources builds trust; too much detail overwhelms. Collapse details by default.' }],
    prompt: '<p>Users of a pilot say the assistant \u201cfeels slow\u201d although median end-to-end time is 6 seconds. What do you change?</p>',
    answer: '<ul><li>Measure time to first visible output; stream tokens and show status for retrieval and tools immediately.</li><li>Render citations progressively; let users stop generation.</li><li>Reduce time to first token on the backend (smaller model for routing, prompt caching, parallel retrieval).</li><li>Track perceived-latency metrics and feedback per trace to confirm the change.</li></ul>'
  },
  quiz: [
    { q: 'Where should prompts and API keys live?', o: ['In the TypeScript bundle', 'In the backend', 'In localStorage', 'In the Streamlit sidebar'], a: 1, why: 'Frontends are public; keep secrets and logic server-side.' },
    { q: 'Why buffer SSE input until a blank line?', o: ['For speed', 'Network chunks can split events anywhere', 'Browsers require it', 'To compress'], a: 1, why: 'Events and even characters can be split across chunks.' },
    { q: 'What makes Streamlit apps testable in CI?', o: ['Screenshots', 'streamlit.testing.v1.AppTest running the script headlessly', 'Manual QA only', 'Nothing'], a: 1, why: 'AppTest drives widgets and inspects elements.' }
  ],
  interview: [
    { q: 'How would you build a UI for an AI pilot quickly?', a: '<p>For internal users, Streamlit behind SSO calling the backend API: chat with streaming, visible sources, feedback tied to trace ids, tested with AppTest. For an existing web app, a small TypeScript component consuming a typed SSE protocol with cancellation. In both, all logic and secrets stay in the backend.</p>' },
    { q: 'What makes streaming robust in production?', a: '<p>A typed, versioned event protocol; parsers that buffer across chunk boundaries and decode UTF-8 incrementally; heartbeats and proxy-friendly headers; cancellation; clear error and done events; and resume or retry semantics for dropped connections.</p>' }
  ]
});

/* ===================================================================== 11.7 */
L({
  id: '11.7', title: 'Executive communication', minutes: 40, roles: ['fde'], sim: 'roi',
  tags: 'BLUF · one-pagers · business metrics not model metrics · ROI and payback · uncertainty in plain words · status reports · asks and decisions',
  mental: 'Executives decide; your job is to make the decision easy. Lead with the answer and the ask, translate model metrics into business outcomes, quantify value and uncertainty honestly, and keep it to one page.',
  intro: `<p>An FDE who can build but not explain stalls at the pilot. Sponsors need to justify budgets, renewals and expansion to their own leadership. They rarely care about F1 scores; they care about hours saved, revenue, risk and customer experience, how sure you are, and what you need from them. Good executive communication is a skill you can practise with templates and numbers.</p>`,
  points: [
    '<b>BLUF</b> (bottom line up front): the conclusion and the decision needed in the first two sentences.',
    'Translate: \u201cextraction F1 0.96\u201d \u2192 \u201cadjusters re-key 4% of fields instead of 100%, saving 11 minutes per claim\u201d.',
    'Quantify value with ranges: annualised hours or money saved, with a conservative case.',
    'Show cost and payback alongside value: build, run (tokens, infrastructure), people.',
    'Name risks and mitigations briefly; say what you are not sure about.',
    'End with explicit asks: decisions, access, people, dates.'
  ],
  concept: { title: 'A pilot\u2019s weather briefing', body: `<p>Before take-off, a pilot does not want the meteorologist\u2019s model outputs. They want: can we fly, which route, what to watch for, and what changes the plan. An executive update is the same: decision, recommendation, risk, triggers.</p>` },
  walk: [
    { h: 'One-pager structure', body: '<p>Five blocks, one page.</p>', code: String.raw`1. Bottom line: The claims pilot cut handling time 28% (range 22-33%) on 1,140 claims. Recommend rollout to all
   motor adjusters in Q1. Decision needed by 15 Nov: budget approval and IT time for SSO.
2. Results in business terms: hours saved, quality, user adoption, customer impact.
3. Economics: annual value (conservative / expected), run cost, payback period.
4. Risks and mitigations: three bullets maximum.
5. Asks: who, what, by when.` },
    { h: 'Numbers executives trust', body: '<p>Use their baseline, their volumes and their cost rates. Prefer measured pilot data to projections, show the conservative case, and say how it was measured (sample size, period). A bootstrap interval in plain words (\u201cmost likely 28%, very likely between 22% and 33%\u201d) beats a p-value.</p>' },
    { h: 'Status updates', body: '<p>Weekly, short: overall status (green, amber, red) with one-line reason, progress against milestones, risks that changed, asks. Amber early is better than red late.</p>' }
  ],
  analogy: `<p><b>A newspaper front page.</b> The headline tells you what happened, the first paragraph tells you why it matters, and details follow for those who want them. Most readers stop after the first paragraph, and that is fine if it was the right paragraph.</p>`,
  diagram: {
    title: 'From technical results to an executive decision',
    cols: [['tech'], ['biz'], ['econ'], ['risk'], ['bluf']],
    nodes: [
      { id: 'tech', label: 'Technical results', sub: 'F1 · latency · cost / call', tone: 'acc', info: 'What the team measured.' },
      { id: 'biz', label: 'Business outcomes', sub: 'minutes · errors · CSAT', tone: 'fde', info: 'Translated with the customer\u2019s baseline.' },
      { id: 'econ', label: 'Economics', sub: 'value · cost · payback', tone: 'be', info: 'Ranges, conservative case.' },
      { id: 'risk', label: 'Risks + asks', sub: 'what could change it', tone: 'warn', info: 'Short and specific.' },
      { id: 'bluf', label: 'One page', sub: 'BLUF + decision', tone: 'ok', info: 'Answer first, ask explicitly.' }
    ],
    edges: [{ a: 'tech', b: 'biz' }, { a: 'biz', b: 'econ' }, { a: 'econ', b: 'risk' }, { a: 'risk', b: 'bluf' }],
    caption: 'Translate, quantify, qualify, then lead with the answer.'
  },
  illustrated: { title: 'Rewrite', body: `<div class="tbl"><table><thead><tr><th>engineer\u2019s update</th><th>executive version</th></tr></thead><tbody>
    <tr><td>We improved retrieval recall@10 from 0.71 to 0.89 with hybrid search and a reranker, and groundedness is now 0.94.</td><td>Agents now get a correct, sourced answer for 9 in 10 policy questions (was 7 in 10). That removes about 300 escalations a month.</td></tr>
    <tr><td>p95 latency is 4.2s, we might try a smaller model.</td><td>Answers arrive in about 2 seconds for most questions; we are working on the slowest 5%.</td></tr>
    <tr><td>We are blocked on SSO.</td><td>We need IT to register the app in Entra ID by Friday to keep the 1 December pilot date.</td></tr></tbody></table></div>` },
  code: {
    title: 'Pilot results to a one-pager with bootstrap ranges and payback', file: 'exec_onepager.py', browser: true,
    intro: '<p>Takes per-claim handling times from a pilot (control vs assisted, synthetic but realistic), bootstraps the time saving, converts to annual hours and money with the customer\u2019s volumes and rates, subtracts run costs, computes payback, and prints a one-page summary with the conservative case.</p>',
    src: String.raw`import numpy as np
rng = np.random.default_rng(21)
control = rng.lognormal(np.log(38), 0.35, 620)          # minutes per claim, adjusters without the assistant
assisted = rng.lognormal(np.log(27.5), 0.38, 1140)      # pilot claims with the assistant
CLAIMS_PER_YEAR, COST_PER_HOUR = 108_000, 62            # customer volumes and loaded adjuster cost
RUN_COST_PER_CLAIM = 0.42                                # tokens + infrastructure, measured in pilot
BUILD_AND_ROLLOUT = 380_000                              # one-off
ADOPTION = 0.85                                          # share of claims expected to use it at scale

boot = []
for _ in range(5000):
    c = rng.choice(control, control.size); a = rng.choice(assisted, assisted.size)
    boot.append(1 - np.median(a) / np.median(c))
saving = 1 - np.median(assisted) / np.median(control)
lo, hi = np.percentile(boot, [5, 95])

def annual(save_frac):
    minutes = np.median(control) * save_frac * CLAIMS_PER_YEAR * ADOPTION
    value = minutes / 60 * COST_PER_HOUR
    cost = RUN_COST_PER_CLAIM * CLAIMS_PER_YEAR * ADOPTION
    return minutes / 60, value, cost, value - cost

hours, value, run, net = annual(saving)
_, _, _, net_lo = annual(lo)
payback = BUILD_AND_ROLLOUT / (net / 12); payback_lo = BUILD_AND_ROLLOUT / (net_lo / 12)
print(f"""BOTTOM LINE
The pilot cut median claim handling time by {saving:.0%} (very likely between {lo:.0%} and {hi:.0%}) across {assisted.size:,} claims.
Rolled out to all motor adjusters, that frees about {hours:,.0f} adjuster hours a year. Recommend rollout in Q1.
Decision needed by 15 November: rollout budget (${'$'}{BUILD_AND_ROLLOUT:,}) and two weeks of IT time for SSO and the policy API.

ECONOMICS (annual, at {ADOPTION:.0%} adoption)
  value of time freed     ${'$'}{value:,.0f}
  run cost                ${'$'}{run:,.0f}  (${'$'}{RUN_COST_PER_CLAIM:.2f} per claim)
  net                     ${'$'}{net:,.0f}   conservative case: ${'$'}{net_lo:,.0f}
  payback                 {payback:.1f} months   conservative case: {payback_lo:.1f} months

HOW WE MEASURED
  {control.size} claims without and {assisted.size:,} with the assistant, same team, 6 weeks; medians to limit outlier effects.

RISKS
  - Gains may shrink on complex claims (pilot skewed to standard motor claims) -> track by claim type in rollout.
  - Adoption below 85% lowers value proportionally -> training and in-tool feedback.

ASKS
  - Budget approval (CFO) by 15 Nov  - IT: Entra ID app registration and policy API access by 22 Nov""")`
  },
  lab: {
    title: 'Turn a technical status into an executive update', file: 'status_lab.py', browser: true,
    scenario: `<p>Your team\u2019s weekly notes are below as data: milestone progress, eval metrics, incidents, blockers. Write code that computes the overall status (green, amber or red) from rules, picks the three numbers that matter to the sponsor, translates model metrics into business terms using the provided mappings, and prints a seven-line update with BLUF and explicit asks.</p>`,
    steps: ['Status rules: red if any milestone is more than 5 days late or a P1 incident is open; amber if a blocker is older than 3 days or a key metric is below target; else green.', 'Translate recall and groundedness into \u201ccorrect sourced answers per 10 questions\u201d and escalations avoided per month.', 'Pick the headline: the biggest change in a business metric this week.', 'Asks: one line per blocker with owner and date.', 'Print an update no longer than seven lines.'],
    checks: ['Status matches the rules.', 'No model metric names appear in the update.', 'Every blocker becomes an ask with an owner and date.'],
    hints: ['Write the update text from data so it stays honest when numbers change.', 'Keep the sponsor\u2019s vocabulary: claims, adjusters, escalations.'],
    starter: String.raw`week = {
  "milestones": [{"name": "eval set 300 claims", "due_in_days": -2, "done": True},
                 {"name": "review UI in pilot", "due_in_days": 3, "done": False, "forecast_slip_days": 4}],
  "metrics": {"grounded_answer_rate": (0.81, 0.90), "answer_rate_last_week": 0.74, "questions_per_month": 4200, "escalation_share_of_failures": 0.6},
  "incidents": [{"sev": 2, "open": False, "summary": "stale index for 6h, fixed"}],
  "blockers": [{"what": "SSO app registration", "owner": "IT (M. Rossi)", "age_days": 5, "needed_by": "Fri 30 Oct"}],
}
# TODO: status(), translate(), update text`,
    solution: String.raw`week = {
  "milestones": [{"name": "eval set 300 claims", "due_in_days": -2, "done": True},
                 {"name": "review UI in pilot", "due_in_days": 3, "done": False, "forecast_slip_days": 4}],
  "metrics": {"grounded_answer_rate": (0.81, 0.90), "answer_rate_last_week": 0.74, "questions_per_month": 4200, "escalation_share_of_failures": 0.6},
  "incidents": [{"sev": 2, "open": False, "summary": "stale index for 6h, fixed"}],
  "blockers": [{"what": "SSO app registration", "owner": "IT (M. Rossi)", "age_days": 5, "needed_by": "Fri 30 Oct"}],
}

def status(w):
    reasons = []
    if any(not m["done"] and m.get("forecast_slip_days", 0) > 5 for m in w["milestones"]) or any(i["sev"] == 1 and i["open"] for i in w["incidents"]):
        return "RED", ["milestone > 5 days late or P1 open"]
    for b in w["blockers"]:
        if b["age_days"] > 3: reasons.append(f"{b['what']} blocked {b['age_days']} days")
    value, target = w["metrics"]["grounded_answer_rate"]
    if value < target: reasons.append("answer quality below target")
    return ("AMBER" if reasons else "GREEN"), reasons

m = week["metrics"]
rate, target = m["grounded_answer_rate"]
per10, per10_last, per10_target = round(rate * 10), round(m["answer_rate_last_week"] * 10), round(target * 10)
avoided = (rate - m["answer_rate_last_week"]) * m["questions_per_month"] * m["escalation_share_of_failures"]
st, reasons = status(week)
slip = next(x for x in week["milestones"] if not x["done"])
lines = [
    f"Status {st}: {'; '.join(reasons)}. Pilot start at risk by {slip['forecast_slip_days']} days unless SSO lands this week.",
    f"Headline: adjusters now get a correct, sourced answer for {per10} in 10 questions (was {per10_last} last week; target {per10_target}).",
    f"That avoids about {avoided:,.0f} escalations a month at current volume.",
    "Done: 300-claim test set built with the claims team.",
    f"Next: review screen in the pilot ({slip['name']}); closing the quality gap to {per10_target} in 10.",
    "Incident: index was out of date for 6 hours on Tuesday; fixed, and an alert now catches it.",
] + [f"Ask: {b['owner']} to complete {b['what']} by {b['needed_by']}." for b in week["blockers"]]
print("\n".join(lines))
banned = ["recall", "groundedness", "grounded_answer_rate", "F1", "p95"]
print("\nlines:", len(lines), "| model jargon present:", [w for w in banned if any(w in l for l in lines)])`
  },
  design: {
    lead: '<p>Executive communication is a system: a regular cadence, a consistent format, numbers derived from the same eval and monitoring data the team uses, and explicit decisions. It turns technical progress into organisational momentum.</p>',
    scale: [{ h: 'Multiple stakeholders', p: 'Same facts, different cuts: the CFO wants payback, the COO wants operations metrics, the CISO wants risk. Keep one source of truth and tailor the first paragraph.' }, { h: 'Expansion', p: 'A crisp results one-pager is the document that gets forwarded to fund the next use case; write it to travel without you.' }],
    fail: [{ h: 'Burying the ask', p: 'An update without a clear request leaves blockers unresolved for weeks.' }, { h: 'Over-claiming', p: 'Projected savings presented as measured ones destroy credibility when finance checks. Label projections and show conservative cases.' }],
    trade: [{ h: 'Precision vs clarity', p: 'Ranges and caveats are honest; too many confuse. One range for the headline and a short \u201chow we measured\u201d line usually suffice.' }, { h: 'Optimism vs early warning', p: 'Calling amber early can feel uncomfortable; it buys time to fix problems with the sponsor\u2019s help.' }],
    prompt: '<p>The pilot met its quality target but adoption is only 40% of adjusters. Write the gist of the sponsor update.</p>',
    answer: '<ul><li>BLUF: quality target met; value limited by adoption; recommend a two-week adoption push before rollout decision.</li><li>Numbers: time saved per assisted claim, adoption rate, value at current vs target adoption.</li><li>Reasons for low adoption from interviews and telemetry (e.g. extra clicks, trust).</li><li>Asks: team leads to schedule 30-minute sessions; approve two UI changes; decision date moved by two weeks.</li></ul>'
  },
  quiz: [
    { q: 'BLUF means:', o: ['Big list of updates first', 'Bottom line up front: conclusion and decision first', 'A chart type', 'Budget line'], a: 1, why: 'Executives read the top first, sometimes only the top.' },
    { q: 'Which is the best executive phrasing?', o: ['Recall@10 rose to 0.89', 'Agents now get a correct, sourced answer for 9 in 10 questions', 'We tuned the reranker', 'Latency p95 is 4.2s'], a: 1, why: 'Business outcomes in their vocabulary.' },
    { q: 'Why show a conservative case for ROI?', o: ['To look modest', 'Finance will test the numbers; credible ranges survive scrutiny', 'It is required by law', 'It is always the true value'], a: 1, why: 'Credibility drives decisions.' }
  ],
  interview: [
    { q: 'How do you communicate AI pilot results to executives?', a: '<p>One page, bottom line first with the decision needed, results in business terms using their baseline and volumes, economics with a conservative case and payback, how it was measured, the two or three risks that matter, and explicit asks with owners and dates.</p>' },
    { q: 'Tell me about explaining a technical setback to a non-technical stakeholder.', a: '<p>STAR: what happened in business terms, the impact, what you did immediately, what you need from them, and how you prevent recurrence, delivered early and without jargon. Emphasise ownership and a clear plan.</p>' }
  ]
});

/* ===================================================================== 11.8 */
L({
  id: '11.8', title: 'Playbooks and product feedback', minutes: 40, roles: ['fde'],
  tags: 'reusable playbooks · deployment checklists · templates and reference architectures · field feedback loops · weighting by impact · writing for product teams',
  mental: 'FDEs scale themselves in two directions: sideways, by turning each engagement into reusable playbooks and templates for the next one; and upstream, by turning patterns seen across customers into precise, evidence-backed feedback that changes the product.',
  intro: `<p>The first deployment of a pattern takes weeks; the fifth should take days. That happens only when FDEs capture what worked as playbooks (checklists, templates, code, reference architectures) and when product teams hear clearly which missing features cost time across many customers. Many FDE organisations measure both: reuse of field assets, and product changes that came from field feedback.</p>`,
  points: [
    'A playbook covers a use case end to end: discovery questions, decomposition, architecture, eval set template, integration checklists, rollout plan, known pitfalls.',
    'Make playbooks executable where possible: templates, scripts, infrastructure modules, eval harnesses, not only documents.',
    'Parameterise by customer profile: cloud, identity provider, data platform, industry regulation.',
    'Field feedback should be specific: the job the customer was doing, what blocked them, the workaround, the cost, and how many customers hit it.',
    'Aggregate and weight feedback by impact (customers, revenue, time lost), dedupe similar requests, attach evidence.',
    'Close the loop: tell customers when their feedback ships, and update playbooks when the product changes.'
  ],
  concept: { title: 'Field guides and letters home', body: `<p>Explorers wrote field guides so the next expedition would not rediscover the same river crossings, and letters home so the people building better equipment knew what failed in the field. FDEs do both: playbooks for the next team, feedback for the product team.</p>` },
  walk: [
    { h: 'A good feedback item', body: '<p>Specific, evidenced, sized.</p>', code: String.raw`Title:    Bulk ACL sync for SharePoint connector
Job:      Index 400k SharePoint pages with per-user permissions for a RAG assistant
Blocker:  Connector syncs ACLs page by page; initial sync took 9 days; group changes take 24h to apply
Workaround: custom Graph delta job (3 FDE weeks), now maintained per customer
Impact:   5 customers ($4.1M ARR) hit this in Q3; 2 pilots delayed > 2 weeks
Ask:      Group-level ACL sync with change notifications
Evidence: links to 5 engagement notes, timing logs` },
    { h: 'Playbook as code', body: '<p>Store playbooks as structured data plus templates: steps with owners, durations, prerequisites and conditions (\u201conly if IdP is Okta\u201d). A generator produces the plan for a specific customer, and gaps show up as unresolved prerequisites. The lab builds one.</p>' },
    { h: 'Keep them alive', body: '<p>Each engagement ends with a retro that updates the playbook: what took longer, what was missing, which pitfalls were new. A playbook nobody updates becomes wrong within months in this field.</p>' }
  ],
  analogy: `<p><b>A recipe book that improves with every dinner service.</b> Each time the dish is cooked for a new restaurant, the head chef notes what changed (local ingredients, oven quirks) and updates the recipe; and when a supplier\u2019s ingredient keeps causing trouble across restaurants, the chef writes to the supplier with specifics.</p>`,
  diagram: {
    title: 'Scaling the field: playbooks and feedback',
    cols: [['eng1', 'eng2', 'eng3'], ['retro'], ['pb', 'fb'], ['next', 'prod']],
    nodes: [
      { id: 'eng1', label: 'Engagement A', sub: 'bank · Azure', tone: 'fde', info: 'Real deployment.' },
      { id: 'eng2', label: 'Engagement B', sub: 'insurer · AWS', tone: 'fde', info: 'Real deployment.' },
      { id: 'eng3', label: 'Engagement C', sub: 'retailer · GCP', tone: 'fde', info: 'Real deployment.' },
      { id: 'retro', label: 'Retro + notes', sub: 'what worked · blockers', tone: 'acc', info: 'Structured capture at the end of each phase.' },
      { id: 'pb', label: 'Playbooks', sub: 'templates · code · checklists', tone: 'ok', info: 'Parameterised by customer profile.' },
      { id: 'fb', label: 'Product feedback', sub: 'deduped · weighted', tone: 'warn', info: 'Evidence and impact attached.' },
      { id: 'next', label: 'Next engagement', sub: 'days, not weeks', tone: 'be', info: 'Starts from the playbook.' },
      { id: 'prod', label: 'Product roadmap', sub: 'fixes blockers', tone: 'be', info: 'Removes workarounds for everyone.' }
    ],
    edges: [{ a: 'eng1', b: 'retro' }, { a: 'eng2', b: 'retro' }, { a: 'eng3', b: 'retro' }, { a: 'retro', b: 'pb' }, { a: 'retro', b: 'fb' }, { a: 'pb', b: 'next' }, { a: 'fb', b: 'prod' }],
    caption: 'Every engagement makes the next one faster and the product better.'
  },
  illustrated: { title: 'Weak vs strong feedback', body: `<div class="tbl"><table><thead><tr><th>weak</th><th>strong</th></tr></thead><tbody>
    <tr><td>\u201cCustomers want better SharePoint support.\u201d</td><td>\u201c5 customers ($4.1M ARR) needed group-level ACL sync; initial sync took 9 days; we built a workaround costing 3 FDE weeks each.\u201d</td></tr>
    <tr><td>\u201cThe eval tooling is clunky.\u201d</td><td>\u201cFDEs export traces to CSV to build eval sets in 7 of 9 engagements; a \u2018save trace as eval case\u2019 action would remove ~2 days per engagement.\u201d</td></tr></tbody></table></div>` },
  code: {
    title: 'Aggregate field feedback: dedupe, weight by impact, rank with evidence', file: 'feedback.py', browser: true,
    intro: '<p>Takes free-text feedback notes from many engagements, embeds them with a simple TF-IDF in NumPy, clusters near-duplicates by cosine similarity, weights each cluster by distinct customers, ARR and reported time lost, and prints a ranked product feedback report with representative quotes. Real teams use an embedding model; the mechanics are the same.</p>',
    src: String.raw`import re
import numpy as np
from collections import Counter

NOTES = [
    ("acme", 1.2, 15, "SharePoint connector syncs permissions page by page, initial ACL sync took 9 days"),
    ("globex", 0.9, 10, "ACL sync for SharePoint too slow; group changes take a day to apply to the index"),
    ("initech", 0.6, 12, "Need group-level permission sync for SharePoint, page-level sync is too slow"),
    ("umbrella", 0.8, 3, "Want to save a production trace as an eval case directly"),
    ("acme", 1.2, 2, "Exporting traces to CSV to build eval sets is painful"),
    ("hooli", 0.5, 4, "Eval sets: no way to turn traces into eval cases without export"),
    ("globex", 0.9, 1, "Dark mode for the admin console"),
    ("stark", 1.4, 8, "Private networking for the batch API in EU regions is missing"),
    ("wayne", 0.7, 6, "Batch API lacks private endpoint support in Europe"),
    ("initech", 0.6, 9, "SharePoint permission sync: group membership changes are not picked up for 24 hours"),
]  # (customer, ARR $M, FDE days lost, note)

SYN = {"acl": "permission", "acls": "permission", "permissions": "permission", "syncs": "sync", "traces": "trace",
       "exporting": "export", "cases": "case", "sets": "set", "europe": "eu"}          # tiny normaliser; an embedding model does this for you
STOP = {"the", "for", "and", "too", "are", "not", "way", "want", "need", "take", "took", "into", "without", "directly", "with", "is", "to", "in", "as", "of", "on", "by", "up", "no"}
tok = lambda s: [SYN.get(w, w) for w in re.findall(r"[a-z]+", s.lower()) if len(w) > 1 and SYN.get(w, w) not in STOP]
docs = [tok(n[3]) for n in NOTES]
vocab = sorted({w for d in docs for w in d})
df = Counter(w for d in docs for w in set(d))
X = np.array([[d.count(w) * np.log(len(docs) / df[w]) for w in vocab] for d in docs])
X /= np.linalg.norm(X, axis=1, keepdims=True)
S = X @ X.T

clusters, seen = [], set()
for i in range(len(NOTES)):                      # greedy single-link clustering at a threshold
    if i in seen: continue
    group, frontier = {i}, [i]
    while frontier:
        j = frontier.pop()
        for k in np.where(S[j] > 0.15)[0]:
            if k not in group: group.add(k); frontier.append(k)
    seen |= group; clusters.append(sorted(group))

rows = []
for g in clusters:
    custs = {NOTES[i][0]: NOTES[i][1] for i in g}
    days = sum(NOTES[i][2] for i in g)
    score = len(custs) * 2 + sum(custs.values()) + days / 5
    terms = Counter(w for i in g for w in docs[i]).most_common(3)
    rows.append((score, g, custs, days, " ".join(t for t, _ in terms)))
print(f"{len(NOTES)} notes -> {len(clusters)} themes\n")
for rank, (score, g, custs, days, terms) in enumerate(sorted(rows, key=lambda r: -r[0]), 1):
    rep = max(g, key=lambda i: S[i, g].sum())
    print(f"{rank}. [{terms}] score {score:.1f} | {len(custs)} customer{'s' if len(custs) > 1 else ''}, ${'$'}{sum(custs.values()):.1f}M ARR, {days} FDE days lost")
    print(f"   e.g. \"{NOTES[rep][3]}\" ({NOTES[rep][0]})")`
  },
  lab: {
    title: 'A playbook as code, instantiated per customer', file: 'playbook_lab.py', browser: true,
    scenario: `<p>Your team has deployed the \u201cpermission-aware RAG assistant\u201d pattern six times. Encode the playbook as data: steps with durations, owners (us or customer), prerequisites, and conditions on the customer profile (cloud, IdP, data sources, regulated industry). Write a generator that produces a tailored plan for two new customers, orders steps by dependencies, totals our effort versus customer effort, and flags missing information that blocks planning.</p>`,
    steps: ['Define about 12 steps; conditions are small lambdas over the profile.', 'Profiles: a bank on Azure with Entra ID and SharePoint (regulated); a retailer on AWS with Okta and Confluence.', 'Filter by condition, check prerequisites exist, topologically order.', 'Sum days by owner; list steps owned by the customer early (they are the usual critical path).', 'Flag profile fields needed but missing (e.g. data residency for regulated customers).'],
    checks: ['The bank plan includes regulatory steps and the Entra ID integration; the retailer plan includes Okta and Confluence steps.', 'Every included step\u2019s prerequisites are included.', 'Missing profile fields are reported before planning.'],
    hints: ['Keep conditions declarative so the playbook is reviewable by non-engineers.', 'After each engagement, update durations with actuals.'],
    starter: String.raw`from graphlib import TopologicalSorter
PLAYBOOK = [
  # (id, title, owner, days, prerequisites, condition)
]
PROFILES = {
  "bank":     {"cloud": "azure", "idp": "entra", "sources": ["sharepoint"], "regulated": True, "residency": None},
  "retailer": {"cloud": "aws", "idp": "okta", "sources": ["confluence", "zendesk"], "regulated": False},
}
# TODO: playbook steps, plan(profile), report`,
    solution: String.raw`from graphlib import TopologicalSorter
PLAYBOOK = [
  # (id, title, owner, days, prerequisites, condition)
  ("discovery", "Discovery and success criteria", "us", 4, [], lambda p: True),
  ("sec_pack", "Send security pack, start DPA", "us", 1, [], lambda p: True),
  ("sec_review", "Customer security review", "customer", 10, ["sec_pack"], lambda p: True),
  ("dpia", "Data protection impact assessment", "customer", 8, ["sec_pack"], lambda p: p["regulated"]),
  ("model_risk", "Model risk management review of eval evidence", "customer", 10, ["evals"], lambda p: p["regulated"]),
  ("entra", "Entra ID app registration + SCIM", "customer", 3, ["sec_review"], lambda p: p["idp"] == "entra"),
  ("okta", "Okta OIDC app + SCIM", "customer", 2, ["sec_review"], lambda p: p["idp"] == "okta"),
  ("foundry", "Microsoft Foundry endpoint + Private Link", "us", 3, ["sec_review"], lambda p: p["cloud"] == "azure"),
  ("bedrock", "Amazon Bedrock access + PrivateLink", "us", 3, ["sec_review"], lambda p: p["cloud"] == "aws"),
  ("sp_conn", "SharePoint connector with ACL sync", "us", 6, ["discovery"], lambda p: "sharepoint" in p["sources"]),
  ("cf_conn", "Confluence connector with space permissions", "us", 4, ["discovery"], lambda p: "confluence" in p["sources"]),
  ("zd_conn", "Zendesk macros and tickets ingestion", "us", 3, ["discovery"], lambda p: "zendesk" in p["sources"]),
  ("evals", "Eval set (200 questions) with SMEs", "customer", 5, ["discovery"], lambda p: True),
  ("pilot", "Pilot with 25 users", "us", 10, ["evals"], lambda p: True),
]
NEEDS = {"residency": lambda p: p["regulated"], "idp": lambda p: True, "cloud": lambda p: True}
PROFILES = {
  "bank":     {"cloud": "azure", "idp": "entra", "sources": ["sharepoint"], "regulated": True, "residency": None},
  "retailer": {"cloud": "aws", "idp": "okta", "sources": ["confluence", "zendesk"], "regulated": False},
}

def plan(profile):
    missing = [f for f, need in NEEDS.items() if need(profile) and not profile.get(f)]
    steps = {s[0]: s for s in PLAYBOOK if s[5](profile)}
    infra = [k for k in steps if k in ("entra", "okta", "foundry", "bedrock", "dpia", "model_risk")] + [k for k in steps if k.endswith("_conn")]
    steps["pilot"] = (*steps["pilot"][:4], steps["pilot"][4] + infra, steps["pilot"][5])     # pilot needs identity, model, data
    broken = [(k, d) for k, s in steps.items() for d in s[4] if d not in steps]
    order = list(TopologicalSorter({k: set(s[4]) for k, s in steps.items()}).static_order())
    finish = {}
    for k in order:
        finish[k] = max([finish[d] for d in steps[k][4]], default=0) + steps[k][3]
    return missing, broken, order, steps, finish

for name, prof in PROFILES.items():
    missing, broken, order, steps, finish = plan(prof)
    print(f"=== {name} ===")
    if missing: print("  BLOCKING: profile is missing", missing)
    print("  prerequisites ok:", not broken)
    for owner in ("customer", "us"):
        print(f"  {owner:<8} {sum(steps[k][3] for k in steps if steps[k][2] == owner):>3} days:",
              ", ".join(k for k in order if steps[k][2] == owner))
    crit = max(finish, key=finish.get)
    print(f"  earliest pilot end: day {finish[crit]} | start customer-owned steps first: {[k for k in order if steps[k][2] == 'customer'][:3]}")`
  },
  design: {
    lead: '<p>FDE organisations scale through assets and influence: playbooks that compress the next engagement, and feedback that removes recurring blockers from the product. Design the capture, the format and the review cadence so both happen by default.</p>',
    scale: [{ h: 'Many FDEs', p: 'A shared repository of playbooks, templates and reference code with owners per playbook; quarterly reviews retire stale ones.' }, { h: 'Feedback at volume', p: 'A structured intake (job, blocker, workaround, impact, evidence), deduped and weighted, reviewed with product leads monthly.' }],
    fail: [{ h: 'Playbook rot', p: 'Playbooks written once and never updated mislead new FDEs. Update after every engagement.' }, { h: 'Anecdote-driven feedback', p: 'The loudest customer\u2019s request is not the most important one. Weight by breadth and impact with evidence.' }],
    trade: [{ h: 'Standardisation vs tailoring', p: 'Too rigid a playbook ignores customer specifics; too loose gives no leverage. Parameterise and allow documented deviations.' }, { h: 'Building workarounds vs waiting for product', p: 'Workarounds unblock today\u2019s customer but create maintenance; file feedback and plan to retire the workaround.' }],
    prompt: '<p>You lead a team of 12 FDEs. Every engagement rebuilds the same SharePoint connector. What do you do?</p>',
    answer: '<ul><li>Short term: harden the best implementation into a shared, tested module with config, owned by one FDE.</li><li>Capture the pattern in the playbook with known pitfalls and timings.</li><li>Write a product feedback item with breadth, ARR and time-lost evidence; propose the product build it natively.</li><li>Track reuse and time saved; retire the module when the product ships the feature.</li></ul>'
  },
  quiz: [
    { q: 'What makes product feedback actionable?', o: ['It is loud', 'Job, blocker, workaround, impact and evidence across customers', 'It mentions competitors', 'It is long'], a: 1, why: 'Product teams prioritise with specifics and impact.' },
    { q: 'Why make playbooks executable (templates, code)?', o: ['They look technical', 'They compress time to value and stay consistent across engagements', 'Documents are banned', 'For security'], a: 1, why: 'Reusable assets beat reread documents.' },
    { q: 'When should a playbook be updated?', o: ['Never', 'After each engagement with actual durations and new pitfalls', 'Yearly', 'When the customer asks'], a: 1, why: 'Fast-moving field; keep it current.' }
  ],
  interview: [
    { q: 'How do you make your work scale beyond one customer?', a: '<p>I turn each engagement into reusable assets: a parameterised playbook with checklists, templates and code, updated with actuals after each project; and I write structured product feedback with breadth, impact and evidence so recurring blockers get fixed in the product, then update playbooks when they ship.</p>' },
    { q: 'Give an example of field feedback that changed a product.', a: '<p>STAR: the pattern you saw across customers, how you quantified it (customers, ARR, time lost), how you presented it to the product team with evidence and a proposed solution, and what shipped and how it shortened later deployments.</p>' }
  ]
});
})();

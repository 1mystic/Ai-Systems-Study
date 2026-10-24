/* Phase 9 · Serving, scale and reliability (part 2: 9.7–9.11) */
(function () {
const L = AISA.lesson;

/* ===================================================================== 9.7 */
L({
  id: '9.7', title: 'GPU capacity planning', minutes: 50, roles: ['be', 'fde'], sim: 'gpu',
  tags: 'memory budget · tensor parallelism · KV per user · bandwidth-bound throughput · replicas · utilisation · cost per million tokens · build vs buy',
  mental: 'A capacity plan answers three questions with numbers: does the model fit (weights plus KV cache per GPU), how fast does it serve (decode is bandwidth-bound, so tokens per second follow memory bandwidth and batch size), and how many replicas meet peak demand with headroom. From that, cost per million tokens falls out and can be compared with API prices.',
  intro: `<p>Customers ask FDEs “should we self-host, and how many GPUs would we need?” long before anyone has run a benchmark. A good back-of-the-envelope plan, built from model shape, GPU specs and traffic, answers within a factor of two, and tells you what to benchmark next. This lesson builds that plan and the build-versus-buy comparison.</p>`,
  points: [
    'Weights: parameters × bytes per parameter (2 for BF16, 1 for FP8, about 0.5 for INT4) plus overhead.',
    'KV cache: bytes per token (9.3) × tokens per sequence × concurrent sequences; usually the binding constraint for long contexts.',
    'Tensor parallelism splits a model across GPUs in one node: memory per GPU falls and bandwidth adds up, with some communication overhead.',
    'Decode speed: each step reads weights plus active KV from memory, so step time ≈ bytes read ÷ effective bandwidth; aggregate throughput grows with batch size until compute or memory limits.',
    'Replicas = peak concurrent sequences ÷ sequences per replica at the SLO, plus headroom for failures, deploys and bursts.',
    'Cost per million output tokens = hourly fleet cost ÷ output tokens per hour at realistic utilisation (rarely above 50% to 60% averaged over a day).'
  ],
  concept: { title: 'Fit, speed, count', body: `<p>Planning is three checks in order. Fit: weights and KV cache must fit in memory with room to spare. Speed: at the batch size you need, does each sequence still decode fast enough for the SLO? Count: how many such replicas cover peak demand with headroom? Everything else, including cost, follows from those three numbers, and each estimate gets replaced by a benchmark as soon as hardware is available.</p>` },
  walk: [
    { h: 'Fit', body: '<p>70B in FP8: about 71 GB of weights. On 2×H100 (160 GB, about 144 GB usable at 90%), roughly 65 GB remain for KV and activations, or about 200,000 tokens of KV at 320 KB per token: 25 sequences of 8,000 tokens.</p>' },
    { h: 'Speed', body: '<p>Two H100s provide about 6.7 TB/s of peak bandwidth; at 60% effective, a step that reads 71 GB of weights plus about 30 GB of active KV takes roughly 25 ms, so about 40 tokens per second per sequence and about 1,000 tokens per second for 25 sequences.</p>' },
    { h: 'Count and cost', body: '<p>For 300 concurrent sequences at peak: 300 ÷ 25 = 12 replicas, plus 20% headroom = 15 replicas = 30 GPUs. At an assumed $2.50 per GPU-hour, the fleet costs $75 per hour; at 50% average utilisation it generates about 15 × 1,000 × 3,600 × 0.5 ≈ 27 million output tokens per hour, roughly $2.80 per million output tokens before input-token work and engineering costs. Compare with API prices for equivalent quality.</p>' }
  ],
  analogy: `<p><b>Planning a bus service.</b> Will the passengers and their luggage fit on one bus (memory)? How fast can a full bus run the route (bandwidth)? How many buses cover the rush hour with spares (replicas)? Then you divide the fleet cost by the passengers carried, and compare with paying for taxis (API calls).</p>`,
  diagram: {
    title: 'From traffic to a GPU fleet',
    cols: [['traffic'], ['model'], ['fit', 'speed'], ['replicas'], ['cost']],
    nodes: [
      { id: 'traffic', label: 'Traffic profile', sub: 'peak concurrency · tokens', tone: 'fde', info: 'Peak concurrent sequences, prompt and output lengths, daily shape.' },
      { id: 'model', label: 'Model + precision', sub: 'params · layers · KV heads', tone: 'acc', info: 'Determines weight bytes and KV bytes per token.' },
      { id: 'fit', label: 'Fit check', sub: 'weights + KV per GPU', info: 'Choose TP size and max context so memory fits with headroom.' },
      { id: 'speed', label: 'Speed check', sub: 'TPOT at batch size', tone: 'be', info: 'Bandwidth-based step time must meet the SLO.' },
      { id: 'replicas', label: 'Replica count', sub: '+ headroom', tone: 'warn', info: 'Peak sequences divided by sequences per replica, plus spares.' },
      { id: 'cost', label: '$ per million tokens', sub: 'vs API price', tone: 'ok', info: 'Fleet cost over tokens served at real utilisation.' }
    ],
    edges: [{ a: 'traffic', b: 'fit' }, { a: 'model', b: 'fit' }, { a: 'model', b: 'speed' }, { a: 'fit', b: 'replicas' }, { a: 'speed', b: 'replicas' }, { a: 'replicas', b: 'cost' }],
    caption: 'Fit, speed, count, then cost.'
  },
  illustrated: { title: 'Hardware reference points (approximate)', body: `<div class="tbl"><table><thead><tr><th>GPU</th><th>memory</th><th>peak memory bandwidth</th><th>notes</th></tr></thead><tbody>
    <tr><td>NVIDIA H100 SXM</td><td class="n">80 GB</td><td class="n">≈ 3.35 TB/s</td><td>FP8 support; common in 2024 to 2026 fleets</td></tr>
    <tr><td>NVIDIA H200</td><td class="n">141 GB</td><td class="n">≈ 4.8 TB/s</td><td>same compute class as H100, more and faster memory</td></tr>
    <tr><td>NVIDIA B200</td><td class="n">≈ 180–192 GB</td><td class="n">≈ 8 TB/s</td><td>Blackwell generation; FP4 support</td></tr></tbody></table></div>
    <p>Vendor and cloud configurations vary; use the exact SKU’s specifications and your own benchmarks for final plans.</p>` },
  code: {
    title: 'A capacity planner from model shape to cost per million tokens', file: 'capacity_plan.py', browser: true,
    intro: '<p>A planner that takes a model shape, precision, GPU type and traffic profile, tries each tensor-parallel size that fits, estimates decode speed from memory bandwidth, finds the batch size that meets the TPOT target, and computes replicas, fleet cost and cost per million output tokens, keeping the cheapest option. The constants (60% effective bandwidth, overheads, prices) are assumptions to replace with benchmarks.</p>',
    src: String.raw`import math
from dataclasses import dataclass

@dataclass
class Model:
    name: str; params_b: float; layers: int; kv_heads: int; head_dim: int = 128
    def weight_gb(self, bits): return self.params_b * bits / 8
    def kv_gb_per_token(self): return 2 * self.layers * self.kv_heads * self.head_dim * 2 / 1e9     # BF16 KV

@dataclass
class GPU:
    name: str; mem_gb: float; bw_tbs: float; usd_hour: float

def plan(m: Model, bits: int, g: GPU, ctx_tokens: int, peak_seqs: int, tpot_ms: float, headroom=1.2, util=0.5):
    options = [r for tp in (1, 2, 4, 8) if (r := plan_tp(m, bits, g, ctx_tokens, peak_seqs, tpot_ms, tp, headroom, util))]
    return min(options, key=lambda r: r["$/M out tokens"]) if options else None

def plan_tp(m, bits, g, ctx_tokens, peak_seqs, tpot_ms, tp, headroom, util):
    usable = g.mem_gb * 0.9 * tp - 3 * tp
    kv_room = usable - m.weight_gb(bits)
    max_seqs = int(kv_room / (m.kv_gb_per_token() * ctx_tokens)) if kv_room > 0 else 0
    if max_seqs < 4:
        return None
    bw = g.bw_tbs * 1000 * tp * 0.6 * 0.85 ** math.log2(tp)                      # GB/s effective; each TP doubling loses ~15% to communication
    best = None
    for b in range(1, max_seqs + 1):
        step_ms = (m.weight_gb(bits) + m.kv_gb_per_token() * ctx_tokens * 0.5 * b) / bw * 1000
        if step_ms <= tpot_ms:
            best = (b, step_ms)
    if best is None:
        return None                                                              # cannot meet TPOT at this TP size
    b, step_ms = best
    replicas = math.ceil(peak_seqs / b * headroom)
    gpus = replicas * tp
    tok_per_hour = replicas * b * (1000 / step_ms) * 3600 * util
    usd_hour = gpus * g.usd_hour
    return {"model": m.name, "bits": bits, "gpu": g.name, "tp": tp, "seqs/replica": b, "TPOT ms": round(step_ms, 1),
            "replicas": replicas, "GPUs": gpus, "$/hour": round(usd_hour), "$/M out tokens": round(usd_hour / (tok_per_hour / 1e6), 2)}

MODELS = [Model("8B", 8.0, 32, 8), Model("70B", 70.6, 80, 8)]
GPUS = [GPU("H100-80GB", 80, 3.35, 2.50), GPU("H200-141GB", 141, 4.8, 3.50)]       # assumed hourly prices
for m in MODELS:
    for bits in (16, 8):
        for g in GPUS:
            r = plan(m, bits, g, ctx_tokens=8000, peak_seqs=300, tpot_ms=30)
            print(r)`
  },
  lab: {
    title: 'Build vs buy break-even', file: 'build_vs_buy_lab.py', browser: true,
    scenario: `<p>A customer is choosing between a hosted API and self-hosting a 70B-class open model on reserved GPUs for an internal assistant. Using the given traffic forecast and prices, compute monthly cost for both options over 24 months of growth, find the break-even month, and list the non-price factors that should go into the decision.</p>`,
    steps: ['Traffic starts at 400 million input and 60 million output tokens per month and grows 20% per month.', 'API: $3 per million input, $15 per million output tokens, minus 40% of input cost thanks to prompt caching.', 'Self-host: each replica (2 GPUs at $2.50 per GPU-hour, 730 hours per month) serves 450 million output tokens per month at target utilisation; input tokens are cheap on the same hardware; add a fixed $18,000 per month for engineering and operations.', 'Replicas = ceil(output tokens / capacity) + 1 spare; compute both costs per month.', 'Print the table, the break-even month, and a short list of non-price factors.'],
    checks: ['Monthly costs for both options are printed for 24 months.', 'The break-even month (if any) is identified.', 'Non-price factors are listed.'],
    hints: ['Use a loop over months with tokens multiplied by 1.2 each month.', 'Self-hosting is a step function because replicas are whole numbers.'],
    starter: String.raw`import math
months = range(1, 13)
# TODO`,
    solution: String.raw`import math
inp, out = 400e6, 60e6
API_IN, API_OUT, CACHE_SAVING = 3.0, 15.0, 0.40
GPU_HOUR, GPUS_PER_REPLICA, HOURS, REPLICA_CAP, FIXED = 2.50, 2, 730, 450e6, 18_000

print(f"{'month':>5} {'in tok M':>9} {'out tok M':>9} {'API $':>9} {'replicas':>8} {'self $':>9}")
breakeven = None
for m in range(1, 25):
    api = inp / 1e6 * API_IN * (1 - CACHE_SAVING) + out / 1e6 * API_OUT
    replicas = math.ceil(out / REPLICA_CAP) + 1
    self_host = replicas * GPUS_PER_REPLICA * GPU_HOUR * HOURS + FIXED
    if breakeven is None and self_host < api:
        breakeven = m
    if m % 3 == 0 or m == 1:
        print(f"{m:>5} {inp / 1e6:>9.0f} {out / 1e6:>9.0f} {api:>9,.0f} {replicas:>8} {self_host:>9,.0f}")
    inp *= 1.2; out *= 1.2
print(f"\nbreak-even month: {breakeven or 'not within 24 months'}")
print("non-price factors: model quality gap vs frontier APIs; data residency and control; burst capacity;"
      " team skills and on-call; upgrade cadence; vendor terms; time to market.")`
  },
  design: {
    lead: '<p>Capacity plans are living models: start from first-principles estimates, replace them with benchmarks, and update them with production metrics. Keep them in code so assumptions are visible and adjustable.</p>',
    scale: [{ h: 'Daily shape', p: 'Peak-to-average ratios of 3× are common for business tools; autoscaling, batch work in off-peak hours (9.8) and reserved-plus-on-demand mixes improve utilisation.' }, { h: 'Fleet heterogeneity', p: 'Mix GPU types per workload: memory-rich GPUs for long contexts, cheaper ones for small models and embeddings.' }],
    fail: [{ h: 'Ignoring KV memory', p: 'Plans based on weights alone overestimate capacity badly for long contexts.' }, { h: 'Assuming 100% utilisation', p: 'Real fleets average far less; cost per token at 30% utilisation is three times the theoretical number.' }],
    trade: [{ h: 'Bigger GPUs vs more GPUs', p: 'Fewer, larger-memory GPUs reduce parallelism overhead and fit longer contexts; more smaller GPUs give finer scaling.' }, { h: 'Reserved vs on-demand', p: 'Reserved capacity is cheaper per hour and idle at night; on-demand covers bursts at higher prices.' }],
    prompt: '<p>Plan GPU capacity for an internal 70B assistant: 6,000 employees, 15% concurrent at peak, 8k-token contexts, 30 ms TPOT target.</p>',
    answer: '<ul><li>Peak sequences ≈ 900 (assume one active sequence per concurrent user).</li><li>Fit and speed per replica from the planner (for example 2×H200 FP8), validated by a load test.</li><li>Replicas = 900 ÷ sequences per replica × 1.2 headroom; spread across zones.</li><li>Off-peak capacity used for batch jobs; monthly review of utilisation and cost per million tokens against API pricing.</li></ul>'
  },
  quiz: [
    { q: 'For long contexts, what usually limits concurrent sequences per GPU?', o: ['Model weights', 'KV-cache memory', 'CPU cores', 'Disk speed'], a: 1, why: 'KV grows with tokens per sequence times sequences.' },
    { q: 'Why does tensor parallelism raise decode speed?', o: ['It removes the KV cache', 'Weights are split across GPUs, so each reads less and bandwidth adds up', 'It changes the model', 'It skips layers'], a: 1, why: 'Decode is bandwidth-bound; more GPUs share the reading.' },
    { q: 'Cost per million tokens rises sharply when:', o: ['Utilisation is low', 'Prompts are cached', 'Batch size is large', 'TPOT is low'], a: 0, why: 'Idle capacity still costs money.' }
  ],
  interview: [
    { q: 'How do you estimate GPUs needed to serve a model?', a: '<p>Compute weight memory from parameters and precision, KV bytes per token from layers, KV heads and head size, and choose a tensor-parallel size that leaves room for the KV cache of the target batch at the expected context length. Estimate decode step time from bytes read per step over effective bandwidth to check the TPOT target, then divide peak concurrent sequences by sequences per replica and add headroom. Validate with a load test.</p>' },
    { q: 'When does self-hosting beat an API on cost?', a: '<p>At high, steady volume where reserved GPUs stay well utilised, when an open model meets the quality bar, and when the team can operate it. Low or bursty volume, frontier-quality needs, or no operations capacity favour APIs. I model both monthly, including engineering and on-call costs, and include non-price factors like data control.</p>' }
  ]
});

/* ===================================================================== 9.8 */
L({
  id: '9.8', title: 'Batch inference', minutes: 45, roles: ['be', 'fde'],
  tags: 'Message Batches API · OpenAI Batch · 50% discount · custom ids · chunking · reconciliation · retries · offline pipelines',
  mental: 'Anything that does not need an answer in seconds should go through batch interfaces: hosted batch APIs process large request sets asynchronously at about half price, and self-hosted offline runs keep GPUs full. The engineering is in preparing idempotent requests, chunking, tracking, reconciling results and retrying failures.',
  intro: `<p>Backfills, nightly classification, evaluation runs, embedding re-indexing, document extraction across an archive: much of an AI platform’s token volume needs throughput, not latency. Anthropic’s Message Batches API and OpenAI’s Batch API both process requests asynchronously, typically within 24 hours and often much sooner, at a 50% discount. Self-hosted engines reach their best throughput on the same kind of offline work.</p>`,
  points: [
    'Each request carries a unique <code class="i">custom_id</code> that maps results back to your records, independent of order.',
    'Respect batch limits (for example, the Anthropic API allows up to 100,000 requests or 256 MB per batch); chunk large jobs.',
    'Batch results can be succeeded, errored, canceled or expired; reconcile every id and retry the retryable ones.',
    'Prompt caching still applies inside batches for shared prefixes, compounding the savings.',
    'Make jobs idempotent and resumable: store job state, batch ids and processed ids, so a crashed coordinator can pick up where it left off.',
    'Validate outputs (schemas, Phase 3.3) before writing them to downstream systems.'
  ],
  concept: { title: 'Freight, not courier', body: `<p>A courier delivers one parcel fast at a premium; freight moves pallets overnight at a fraction of the price. Most back-office AI work is freight. The skill is packing well (chunking and ids), tracking every pallet (reconciliation), and re-shipping the ones that fell off the truck (retries).</p>` },
  walk: [
    { h: 'Submit a batch', body: '<p>With the Anthropic Python SDK; each request has an id and normal message parameters. Shown, not run here.</p>', code: String.raw`batch = client.messages.batches.create(requests=[
    {"custom_id": f"ticket-{t.id}", "params": {"model": "claude-haiku-5-5", "max_tokens": 200,
                                              "system": SYSTEM, "messages": [{"role": "user", "content": t.text}]}}
    for t in tickets])
# later
batch = client.messages.batches.retrieve(batch.id)
if batch.processing_status == "ended":
    for result in client.messages.batches.results(batch.id):
        handle(result.custom_id, result.result)          # result.type: succeeded / errored / canceled / expired` },
    { h: 'Reconcile', body: '<p>Compare submitted ids with returned ids; retry errored and expired ones in a new batch with a cap on attempts; send repeated failures to a dead-letter list for inspection.</p>' },
    { h: 'Self-hosted offline runs', body: '<p>For open models, offline mode in engines such as vLLM processes large prompt lists with maximal batching; a simple coordinator with checkpointing (the lab) gives the same resumability.</p>' }
  ],
  analogy: `<p><b>A print shop’s overnight run.</b> Daytime walk-ins get printed immediately at full price; bulk orders are queued for the night presses at half price. Each job has a ticket number, the shop counts every finished stack against the order, and anything misprinted goes back in the next run.</p>`,
  diagram: {
    title: 'A batch pipeline',
    cols: [['src'], ['prep'], ['chunk'], ['api'], ['rec'], ['sink', 'retry']],
    nodes: [
      { id: 'src', label: 'Source records', sub: 'tickets · docs', tone: 'fde', info: 'What needs processing, each with a stable id.' },
      { id: 'prep', label: 'Prepare requests', sub: 'custom_id · cached prefix', tone: 'acc', info: 'Deterministic requests; shared system prompt marked for caching.' },
      { id: 'chunk', label: 'Chunk + submit', sub: 'limits · job state', info: 'Respect count and size limits; record batch ids.' },
      { id: 'api', label: 'Batch API / offline engine', sub: '≈ 50% price · async', tone: 'be', info: 'Processes asynchronously, usually within hours.' },
      { id: 'rec', label: 'Reconcile', sub: 'every id accounted for', tone: 'warn', info: 'Succeeded, errored, expired, missing.' },
      { id: 'sink', label: 'Validated results', sub: 'to warehouse / app', tone: 'ok', info: 'Schema-checked outputs written idempotently.' },
      { id: 'retry', label: 'Retry / dead-letter', sub: 'capped attempts', tone: 'bad', info: 'Retryable failures go into the next batch; others for inspection.' }
    ],
    edges: [{ a: 'src', b: 'prep' }, { a: 'prep', b: 'chunk' }, { a: 'chunk', b: 'api' }, { a: 'api', b: 'rec' }, { a: 'rec', b: 'sink' }, { a: 'rec', b: 'retry' }, { a: 'retry', b: 'chunk', dash: true, bend: -60 }],
    caption: 'Prepare, chunk, submit, reconcile, retry.'
  },
  illustrated: { title: 'What batching and caching save', body: `<p>2 million ticket classifications: 1,200 input tokens each (1,000 of them a shared system prompt and examples) and 20 output tokens. Prices per million tokens: $1 input, $5 output (illustrative).</p>
    <div class="tbl"><table><thead><tr><th>mode</th><th>input $</th><th>output $</th><th>total</th></tr></thead><tbody>
    <tr><td>real-time, no caching</td><td class="n">2,400</td><td class="n">200</td><td class="n">$2,600</td></tr>
    <tr><td>batch (50% off)</td><td class="n">1,200</td><td class="n">100</td><td class="n">$1,300</td></tr>
    <tr><td>batch + cached prefix (reads at 0.1×)</td><td class="n">≈ 300</td><td class="n">100</td><td class="n">≈ $400</td></tr></tbody></table></div>
    <p>Cache hits inside batches are best-effort; treat the last row as an upper bound on savings.</p>` },
  code: {
    title: 'Preparing, chunking and reconciling a batch job', file: 'batch_job.py', browser: true,
    intro: '<p>Builds 25,000 classification requests with stable custom ids, splits them by count and size limits, simulates batch results with a few errored and expired entries (seeded), reconciles every id, prepares a retry batch, and compares the cost with real-time calls.</p>',
    src: String.raw`import hashlib, json, random

random.seed(3)
SYSTEM = "Classify the support ticket into billing, bug, how_to or other. Reply with the label only. " + "Example... " * 150
tickets = [{"id": f"T{100000 + i}", "text": "ticket text " * random.randint(10, 80)} for i in range(25_000)]

def request(t):
    return {"custom_id": f"triage-v3-{t['id']}",                    # stable: same ticket + prompt version -> same id
            "params": {"model": "claude-haiku-5-5", "max_tokens": 10,
                       "system": [{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
                       "messages": [{"role": "user", "content": t["text"]}]}}

def chunk(reqs, max_count=10_000, max_bytes=50_000_000):          # stricter than the API limits, to keep batches small
    batch, size = [], 0
    for r in reqs:
        b = len(json.dumps(r))
        if batch and (len(batch) == max_count or size + b > max_bytes):
            yield batch; batch, size = [], 0
        batch.append(r); size += b
    if batch: yield batch

reqs = [request(t) for t in tickets]
batches = list(chunk(reqs))
print(f"{len(reqs):,} requests -> {len(batches)} batches of {[len(b) for b in batches]}")

def fake_results(batch):                                            # what a finished batch returns
    out = []
    for r in batch:
        roll = random.random()
        kind = "errored" if roll < 0.004 else "expired" if roll < 0.006 else "succeeded"
        out.append({"custom_id": r["custom_id"], "result": {"type": kind, "label": random.choice(["billing", "bug", "how_to"]) if kind == "succeeded" else None}})
    return out[: len(out) - (3 if batch is batches[-1] else 0)]      # a few results missing entirely

submitted = {r["custom_id"] for r in reqs}
results = [x for b in batches for x in fake_results(b)]
by_type = {}
for x in results:
    by_type.setdefault(x["result"]["type"], []).append(x["custom_id"])
missing = submitted - {x["custom_id"] for x in results}
retry = by_type.get("errored", []) + by_type.get("expired", []) + sorted(missing)
print("results:", {k: len(v) for k, v in by_type.items()}, "| missing:", len(missing))
print(f"retry batch: {len(retry)} requests; accounted for: {len(results) + len(missing) == len(submitted)}")

in_tok = len(SYSTEM) // 4 + 60; out_tok = 3
realtime = len(reqs) * (in_tok * 1.0 + out_tok * 5.0) / 1e6
batch_cost = realtime * 0.5
print(f"cost estimate: real-time ${'$'}{realtime:,.2f} vs batch ${'$'}{batch_cost:,.2f} (before prompt-cache savings)")`
  },
  lab: {
    title: 'A resumable offline runner', file: 'offline_runner_lab.py', browser: true,
    scenario: `<p>A customer needs 5,000 contracts summarised by their self-hosted model overnight. Build an offline runner with bounded concurrency that records progress in SQLite, survives a crash halfway, resumes without redoing finished items, retries transient failures with a cap, and writes a final report.</p>`,
    steps: ['SQLite table <code class="i">jobs(id PRIMARY KEY, status, attempts, result)</code>; insert all items as pending.', 'Worker: take pending or retryable items, call the fake model (async, seeded transient failures), mark done or failed with attempts + 1.', 'Run with a semaphore of 16; simulate a crash by stopping after 2,000 completions.', 'Restart: process only remaining items; items failing 3 times become dead-lettered.', 'Report counts and confirm no item was processed successfully twice.'],
    checks: ['After resume, all items are done or dead-lettered.', 'No duplicate successful processing.', 'Attempts never exceed 3.'],
    hints: ['Count successful calls per id in a dict to prove exactly-once success.', 'Commit after each status update so a crash loses at most in-flight items.'],
    starter: String.raw`import asyncio, random, sqlite3
db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE jobs (id TEXT PRIMARY KEY, status TEXT, attempts INT, result TEXT)")
db.executemany("INSERT INTO jobs VALUES (?, 'pending', 0, NULL)", [(f"C{i:05d}",) for i in range(5000)])
rng = random.Random(9)
SUCCESS_CALLS = {}

async def fake_model(doc_id):
    await asyncio.sleep(0)
    if rng.random() < 0.03:
        raise TimeoutError("transient")
    SUCCESS_CALLS[doc_id] = SUCCESS_CALLS.get(doc_id, 0) + 1
    return f"summary of {doc_id}"

# TODO: run(stop_after=None), resume, report`,
    solution: String.raw`import asyncio, random, sqlite3
db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE jobs (id TEXT PRIMARY KEY, status TEXT, attempts INT, result TEXT)")
db.executemany("INSERT INTO jobs VALUES (?, 'pending', 0, NULL)", [(f"C{i:05d}",) for i in range(5000)])
rng = random.Random(9)
SUCCESS_CALLS = {}
MAX_ATTEMPTS = 3

async def fake_model(doc_id):
    await asyncio.sleep(0)
    if rng.random() < 0.03:
        raise TimeoutError("transient")
    SUCCESS_CALLS[doc_id] = SUCCESS_CALLS.get(doc_id, 0) + 1
    return f"summary of {doc_id}"

class Crash(Exception):
    pass

async def run(stop_after=None, concurrency=16):
    todo = [r[0] for r in db.execute("SELECT id FROM jobs WHERE status IN ('pending', 'retry') ORDER BY id")]
    sem, done = asyncio.Semaphore(concurrency), {"n": 0}
    async def one(doc_id):
        async with sem:
            if stop_after is not None and done["n"] >= stop_after:
                raise Crash()
            attempts = db.execute("SELECT attempts FROM jobs WHERE id=?", (doc_id,)).fetchone()[0]
            while attempts < MAX_ATTEMPTS:
                attempts += 1
                try:
                    res = await fake_model(doc_id)
                    db.execute("UPDATE jobs SET status='done', attempts=?, result=? WHERE id=?", (attempts, res, doc_id)); db.commit()
                    done["n"] += 1
                    return
                except TimeoutError:
                    db.execute("UPDATE jobs SET status='retry', attempts=? WHERE id=?", (attempts, doc_id)); db.commit()
            db.execute("UPDATE jobs SET status='dead' WHERE id=?", (doc_id,)); db.commit()
    results = await asyncio.gather(*(one(d) for d in todo), return_exceptions=True)
    return sum(isinstance(r, Crash) for r in results)

def counts():
    return dict(db.execute("SELECT status, count(*) FROM jobs GROUP BY status").fetchall())

async def main():
    crashed = await run(stop_after=2000)
    print("after crash :", counts(), f"({crashed} tasks aborted)")
    await run()
    print("after resume:", counts())
    print("max attempts:", db.execute("SELECT max(attempts) FROM jobs").fetchone()[0],
          "| any doc summarised twice:", any(v > 1 for v in SUCCESS_CALLS.values()))

asyncio.run(main())`
  },
  design: {
    lead: '<p>Batch pipelines are data pipelines with expensive, flaky steps. Design them with the same discipline: idempotent units, durable state, reconciliation, observability and cost tracking.</p>',
    scale: [{ h: 'Orchestrate with your data stack', p: 'Run batch jobs from the orchestrator the customer already uses (Airflow, Dagster, Databricks Workflows, ADF) with job state in their warehouse.' }, { h: 'Off-peak self-hosting', p: 'Schedule offline runs on self-hosted fleets during low-traffic hours to raise utilisation (9.7).' }],
    fail: [{ h: 'Lost results', p: 'Without reconciliation, missing or expired results silently become gaps in downstream data.' }, { h: 'Prompt drift mid-job', p: 'Changing the prompt halfway through a backfill mixes two versions. Put the prompt version in custom ids and job metadata.' }],
    trade: [{ h: 'Batch latency vs cost', p: 'Hosted batches can take hours; anything users wait for must stay real-time.' }, { h: 'Hosted batch vs self-hosted offline', p: 'Hosted batches need no infrastructure; self-hosted offline runs suit open models, data residency, and very large steady volumes.' }],
    prompt: '<p>Re-classify 40 million historical support tickets with a new taxonomy within a week. Design it.</p>',
    answer: '<ul><li>Freeze prompt version and taxonomy; eval on a sample first.</li><li>Stable custom ids including the prompt version; chunk into batches under limits; shared prefix cached.</li><li>Coordinator with job state in the warehouse; reconciliation and capped retries; dead-letter review.</li><li>Throughput and cost dashboards; validated outputs written idempotently to a new column, switched over when complete.</li></ul>'
  },
  quiz: [
    { q: 'Why does every batch request need a unique custom id?', o: ['For billing', 'Results may come back in any order; ids map them to records and enable reconciliation', 'APIs reject requests without ids for speed', 'For caching'], a: 1, why: 'Ids make results traceable and retries safe.' },
    { q: 'Typical price of hosted batch processing relative to real-time?', o: ['Same', 'About half', 'Double', 'Free'], a: 1, why: 'Major providers discount batch processing by about 50%.' },
    { q: 'A batch returns errored and expired results. You should:', o: ['Ignore them', 'Reconcile and resubmit retryable ones with a cap, dead-letter the rest', 'Restart the entire job', 'Delete the batch'], a: 1, why: 'Every id must be accounted for.' }
  ],
  interview: [
    { q: 'How do you design a large LLM batch job?', a: '<p>Freeze and evaluate the prompt, generate deterministic requests with stable custom ids including the prompt version, cache the shared prefix, chunk under API limits, track job and batch state durably, reconcile every id after completion, retry retryable failures with caps, validate outputs before writing idempotently, and monitor cost and progress.</p>' },
    { q: 'When would you not use a batch API?', a: '<p>When a user or system waits on the answer, when results are needed within minutes, or when the workload is a conversation where each step depends on the previous answer. Those stay real-time, possibly with caching and cheaper models.</p>' }
  ]
});

/* ===================================================================== 9.9 */
L({
  id: '9.9', title: 'Durable execution: Temporal, Inngest', minutes: 55, roles: ['be', 'fde'],
  tags: 'workflows and activities · event history · deterministic replay · retries · timers · signals · sagas · long-running agents',
  mental: 'Durable execution engines record every step of a workflow in an event history, so code can run for minutes or months, survive crashes and deploys, wait for humans, and retry failed steps, while you write it as ordinary sequential code. For agents with real side effects, it turns fragile loops into reliable processes.',
  intro: `<p>Agent loops (5.1) and pipelines live in processes that crash, get redeployed and time out. Durable execution engines solve this: <b>Temporal</b> (widely used for AI agents; OpenAI’s Agents SDK has an official Temporal integration, generally available since March 2026) and <b>Inngest</b> (event-driven durable functions with steps) are common choices, alongside cloud workflow services. The core idea is event sourcing plus deterministic replay. This lesson builds a tiny engine to make that idea concrete, then maps it to the real tools.</p>`,
  points: [
    '<b>Workflow</b>: deterministic orchestration code (no direct I/O, randomness or clocks). <b>Activities</b> (Temporal) or <b>steps</b> (Inngest): the side-effecting calls, such as model calls, tool calls and database writes.',
    'Every activity result is recorded in the event history; after a crash, the workflow code is replayed and recorded results are returned instead of re-running activities.',
    'Retries with backoff and timeouts are configured per activity, not hand-written.',
    'Durable timers and signals let workflows sleep for days or wait for human approval without holding a process.',
    'Sagas: for multi-step side effects, register compensations (refund reversal, cancellation) and run them on failure.',
    'Versioning matters: changing workflow code while old runs are in flight needs the engine’s versioning mechanisms.'
  ],
  concept: { title: 'A flight recorder you can replay', body: `<p>Imagine your program writes every external result into a flight recorder. If the process dies, a new process runs the same code from the start, but every time it asks for an external result it already has, the recorder answers instantly instead of calling out again. The code reaches the exact point where it died, and continues. That is durable execution, and it is why workflow code must be deterministic: the replay must take the same path.</p>` },
  walk: [
    { h: 'Temporal in Python', body: '<p>Workflows orchestrate; activities do the I/O. Shown, not run here.</p>', code: String.raw`from datetime import timedelta
from temporalio import activity, workflow
from temporalio.common import RetryPolicy

@activity.defn
async def call_model(prompt: str) -> str: ...            # model and tool calls live in activities

@workflow.defn
class RefundInvestigation:
    def __init__(self): self.approved = None
    @workflow.signal
    def decide(self, approved: bool): self.approved = approved

    @workflow.run
    async def run(self, ticket_id: str) -> str:
        finding = await workflow.execute_activity(call_model, f"investigate {ticket_id}",
                      start_to_close_timeout=timedelta(minutes=2), retry_policy=RetryPolicy(maximum_attempts=5))
        await workflow.wait_condition(lambda: self.approved is not None, timeout=timedelta(days=3))
        return "refunded" if self.approved else "declined"` },
    { h: 'Inngest step functions', body: '<p>Each <code class="i">step.run</code> is memoised: on retries or resumption, completed steps return their saved result. Shown, not run here.</p>', code: String.raw`@client.create_function(fn_id="investigate-refund", trigger=inngest.TriggerEvent(event="refund/requested"))
async def investigate(ctx: inngest.Context, step: inngest.Step) -> str:
    finding = await step.run("investigate", call_model, ctx.event.data["ticket_id"])
    await step.sleep("cooling-off", timedelta(hours=1))
    return await step.run("notify", send_summary, finding)` },
    { h: 'Keep workflows deterministic', body: '<p>No <code class="i">datetime.now()</code>, random numbers, network calls or reading files in workflow code; use the engine’s time and random APIs or move the call into an activity.</p>' }
  ],
  analogy: `<p><b>A recipe with a checklist.</b> A cook ticks each step as it is done and writes down measurements. If they are called away and another cook takes over, the new cook follows the recipe from the top but skips ticked steps, using the recorded measurements, and carries on from the first unticked step.</p>`,
  diagram: {
    title: 'Durable execution with replay',
    cols: [['client'], ['engine'], ['hist'], ['worker'], ['acts']],
    nodes: [
      { id: 'client', label: 'Start / signal', sub: 'API · UI · events', tone: 'fde', info: 'Starts workflows, sends approvals and other signals.' },
      { id: 'engine', label: 'Engine', sub: 'Temporal / Inngest', tone: 'acc', info: 'Schedules tasks, persists history, manages timers and retries.' },
      { id: 'hist', label: 'Event history', sub: 'per workflow run', tone: 'be', info: 'Every activity result, timer and signal, in order.' },
      { id: 'worker', label: 'Worker', sub: 'replays workflow code', info: 'Runs deterministic workflow code; can crash and be replaced.' },
      { id: 'acts', label: 'Activities', sub: 'model calls · tools · DB', tone: 'ok', info: 'Side effects with timeouts and retry policies.' }
    ],
    edges: [{ a: 'client', b: 'engine' }, { a: 'engine', b: 'hist' }, { a: 'engine', b: 'worker' }, { a: 'worker', b: 'acts' }, { a: 'acts', b: 'engine', dash: true, bend: 70, label: 'results' }],
    caption: 'Results are recorded once; workers replay code against the history.'
  },
  illustrated: { title: 'What survives a crash', body: `<div class="tbl"><table><thead><tr><th>step</th><th>plain agent loop</th><th>durable workflow</th></tr></thead><tbody>
    <tr><td>investigate (model calls)</td><td>re-run after restart, paying again</td><td>replayed from history</td></tr>
    <tr><td>issue refund (side effect)</td><td>may run twice</td><td>recorded once; not repeated</td></tr>
    <tr><td>wait 3 days for approval</td><td>process must stay alive</td><td>durable timer and signal; no process held</td></tr>
    <tr><td>deploy new code mid-run</td><td>run lost</td><td>continues with versioning rules</td></tr></tbody></table></div>` },
  code: {
    title: 'A tiny durable-execution engine with replay', file: 'durable_engine.py', browser: true,
    intro: '<p>A workflow is a Python generator that yields activity requests; the engine executes activities, records results in an event history (SQLite), and on restart replays the generator, feeding recorded results back without re-executing them. We crash the worker in the middle of a refund investigation, start a new worker, and show that completed activities are not repeated and the run finishes.</p>',
    src: String.raw`import json, sqlite3

db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE history (run_id TEXT, seq INT, activity TEXT, args TEXT, result TEXT, PRIMARY KEY (run_id, seq))")
EXECUTED = []                                                     # proves which activities really ran

def activity(name):
    def deco(fn):
        def call(*args):
            EXECUTED.append(name); return fn(*args)
        call.activity_name = name; return call
    return deco

@activity("investigate")
def investigate(ticket): return {"duplicate": True, "charge": "ch_2", "cents": 4800}
@activity("issue_refund")
def issue_refund(charge, cents): return {"refund_id": "rf_1"}
@activity("notify")
def notify(ticket, refund_id): return f"emailed customer about {refund_id}"

def refund_workflow(ticket):                                       # deterministic orchestration only
    finding = yield (investigate, ticket)
    if not finding["duplicate"]:
        return "no action"
    refund = yield (issue_refund, finding["charge"], finding["cents"])
    note = yield (notify, ticket, refund["refund_id"])
    return note

class Crash(Exception):
    pass

def run_worker(run_id, wf, *args, crash_after=None):
    gen, seq, send = wf(*args), 0, None
    try:
        while True:
            fn, *a = gen.send(send)
            row = db.execute("SELECT result FROM history WHERE run_id=? AND seq=?", (run_id, seq)).fetchone()
            if row:                                                # replay: return the recorded result
                send = json.loads(row[0])
            else:
                if crash_after is not None and seq == crash_after:
                    raise Crash(f"worker died before activity #{seq} ({fn.activity_name})")
                send = fn(*a)
                db.execute("INSERT INTO history VALUES (?, ?, ?, ?, ?)", (run_id, seq, fn.activity_name, json.dumps(a), json.dumps(send)))
                db.commit()
            seq += 1
    except StopIteration as done:
        return done.value

try:
    run_worker("wf-4812", refund_workflow, "T-4812", crash_after=2)
except Crash as e:
    print("worker 1:", e)
print("history after crash:", [r[0] for r in db.execute("SELECT activity FROM history ORDER BY seq")])
print("worker 2 result:", run_worker("wf-4812", refund_workflow, "T-4812"))
print("activities actually executed across both workers:", EXECUTED)
assert EXECUTED.count("issue_refund") == 1`
  },
  lab: {
    title: 'A saga with compensations', file: 'saga_lab.py', browser: true,
    scenario: `<p>An onboarding workflow for an enterprise customer creates a workspace, provisions SSO, creates a billing account and charges the first invoice. If any step fails permanently, earlier steps must be undone in reverse order (delete the billing account, remove SSO config, archive the workspace). Implement the saga on top of the Code tab’s engine idea: each step registers a compensation; on failure, run compensations in reverse; record everything so it is idempotent across retries.</p>`,
    steps: ['Define four activities and their compensations; make the charge step fail permanently for one customer (seeded).', 'Write <code class="i">run_saga(customer)</code>: execute steps in order, pushing each compensation on a stack after success.', 'On a permanent failure, pop and run compensations in reverse; record each compensation so re-running the saga does not compensate twice.', 'Run for two customers, one succeeding and one failing; then re-run the failing one to show idempotency.', 'Print the event logs.'],
    checks: ['The successful customer has all four steps done and no compensations.', 'The failing customer has compensations in reverse order.', 'Re-running does not repeat compensations.'],
    hints: ['Store events as (customer, kind, name) in a set or table and check before acting.', 'Retry transient failures before deciding a failure is permanent.'],
    starter: String.raw`STEPS = ["create_workspace", "provision_sso", "create_billing_account", "charge_first_invoice"]
COMPENSATE = {"create_workspace": "archive_workspace", "provision_sso": "remove_sso", "create_billing_account": "delete_billing_account"}
EVENTS = []
def act(customer, name):
    if name == "charge_first_invoice" and customer == "globex":
        raise RuntimeError("card declined (permanent)")
    return f"{name} ok"
# TODO: run_saga`,
    solution: String.raw`STEPS = ["create_workspace", "provision_sso", "create_billing_account", "charge_first_invoice"]
COMPENSATE = {"create_workspace": "archive_workspace", "provision_sso": "remove_sso", "create_billing_account": "delete_billing_account"}
EVENTS = []                                   # durable event log: (customer, kind, name)
SIDE_EFFECTS = []

def done(customer, kind, name):
    return (customer, kind, name) in EVENTS

def act(customer, name):
    if name == "charge_first_invoice" and customer == "globex":
        raise RuntimeError("card declined (permanent)")
    SIDE_EFFECTS.append((customer, name))
    return f"{name} ok"

def run_saga(customer):
    stack = []
    for step in STEPS:
        if done(customer, "step", step):
            if step in COMPENSATE: stack.append(COMPENSATE[step])
            continue
        if done(customer, "failed", step):
            break
        try:
            act(customer, step)
            EVENTS.append((customer, "step", step))
            if step in COMPENSATE: stack.append(COMPENSATE[step])
        except RuntimeError as e:
            EVENTS.append((customer, "failed", step))
            print(f"{customer}: {step} failed: {e}; compensating")
            break
    else:
        return "completed"
    while stack:
        comp = stack.pop()
        if not done(customer, "compensated", comp):
            SIDE_EFFECTS.append((customer, comp)); EVENTS.append((customer, "compensated", comp))
    return "rolled back"

print("acme  :", run_saga("acme"))
print("globex:", run_saga("globex"))
print("globex re-run:", run_saga("globex"))
for c in ("acme", "globex"):
    print(f"{c} side effects:", [e for cc, e in SIDE_EFFECTS if cc == c])
assert [e for cc, e in SIDE_EFFECTS if cc == "globex"].count("remove_sso") == 1`
  },
  design: {
    lead: '<p>Durable execution changes how you build long-running AI processes: model calls and tools become retried, recorded activities; humans become signals; time becomes durable timers. The cost is a new piece of infrastructure and the discipline of deterministic workflow code.</p>',
    scale: [{ h: 'Workers scale horizontally', p: 'Add workers to process more workflows; the engine distributes tasks and tracks state. Activity concurrency limits protect model rate limits.' }, { h: 'Large payloads', p: 'Keep big documents and transcripts in object storage and pass references through workflow history, which has size limits.' }],
    fail: [{ h: 'Non-determinism', p: 'Calling the clock, random numbers or the network inside workflow code breaks replay. Lint for it and use engine APIs.' }, { h: 'Non-idempotent activities', p: 'Activities may run more than once (retries after timeouts); side effects need idempotency keys.' }],
    trade: [{ h: 'Temporal vs Inngest vs cloud workflows', p: 'Temporal: powerful, code-first, self-host or cloud; Inngest: event-driven steps with simple deployment; cloud services integrate with their platform. Choose by team and infrastructure.' }, { h: 'Durable engine vs checkpointing graph', p: 'Graph checkpointers (5.6) persist agent state at node boundaries; durable engines add retries, timers, signals and cross-service guarantees.' }],
    prompt: '<p>An insurance claims agent needs documents from customers, waits days for them, calls models and adjusters, and pays claims. Design the execution layer.</p>',
    answer: '<ul><li>One durable workflow per claim; model calls, document parsing and payments as activities with retries and idempotency keys.</li><li>Signals for uploaded documents and adjuster decisions; durable timers for reminders and SLA escalations.</li><li>Saga compensations for payments and notifications; large files in object storage by reference.</li><li>Workflow versioning for prompt and policy changes; dashboards of runs by state and age.</li></ul>'
  },
  quiz: [
    { q: 'Why must workflow code be deterministic?', o: ['For speed', 'It is replayed against recorded history after crashes and must take the same path', 'Engines cannot run Python', 'To save memory'], a: 1, why: 'Replay must reproduce the same sequence of activity calls.' },
    { q: 'Where should a model call live in a Temporal design?', o: ['In workflow code directly', 'In an activity with timeout and retry policy', 'In a signal', 'In the client'], a: 1, why: 'Side effects and I/O belong in activities.' },
    { q: 'What is a saga compensation?', o: ['A retry', 'An action that undoes an earlier completed step when a later step fails', 'A timer', 'A log'], a: 1, why: 'Sagas keep multi-step side effects consistent without distributed transactions.' }
  ],
  interview: [
    { q: 'Why use a durable execution engine for AI agents?', a: '<p>Agents run long, call unreliable services and take real actions. A durable engine records each step, replays after crashes or deploys without repeating side effects, provides retries and timeouts per activity, durable timers and signals for human approval, and visibility into every run, so agents become reliable processes instead of fragile loops.</p>' },
    { q: 'Explain replay in durable execution.', a: '<p>Workflow code is deterministic and its interactions with the outside world go through the engine, which records results in an event history. When a worker restarts, it runs the workflow code from the beginning; each activity call that already has a recorded result returns it immediately, so the code reaches the same state and continues from where it stopped.</p>' }
  ]
});

/* ===================================================================== 9.10 */
L({
  id: '9.10', title: 'Multi-tenancy, quotas, rate limits', minutes: 50, roles: ['be', 'fde'],
  tags: 'tenant isolation · token-based limits · hierarchical budgets · weighted fair queuing · noisy neighbours · priority tiers · spend caps',
  mental: 'In a shared AI platform, one tenant’s batch job must not starve another’s chat, and nobody should be able to spend an unbounded amount. Limit by tokens as well as requests, budget hierarchically (organisation, team, user), schedule fairly with weights per tier, and enforce hard and soft spend caps.',
  intro: `<p>Lesson 1.5 built a token bucket for requests per second. LLM platforms need more: costs vary 1,000× between requests, so limits must count tokens; enterprise tenants have contracts with tiers and priorities; and finance wants monthly caps with alerts before anyone hits them. This lesson builds those controls for a multi-tenant gateway.</p>`,
  points: [
    'Count tokens: input tokens per minute (ITPM) and output tokens per minute (OTPM) limits, like provider limits, not just requests per minute.',
    'Hierarchical budgets: an organisation’s budget is shared by teams and users; a request must pass every level.',
    'Fair scheduling: weighted fair queuing or deficit round robin gives each tenant its share of capacity when busy, while idle capacity is shared.',
    'Priority tiers: interactive traffic before batch; enterprise before free tier; but with guarantees so low tiers still progress.',
    'Spend caps: soft limits trigger alerts and degraded modes (smaller models); hard limits block with a clear error.',
    'Isolation beyond rate limits: per-tenant keys, data partitions, caches and logs (4.8, 9.2).'
  ],
  concept: { title: 'Fair lanes on a shared motorway', body: `<p>A shared GPU fleet is a motorway. Without rules, one convoy of lorries (a backfill job) fills every lane. Lane allocation by weight (fair queuing), toll budgets per company (quotas) and an express lane for ambulances (priority tiers) keep traffic moving for everyone, and the toll office sends a warning before an account runs dry.</p>` },
  walk: [
    { h: 'Charge tokens, not requests', body: '<p>Reserve an estimate at admission (input tokens plus max_tokens), then settle with actual usage when the response finishes, so limits stay accurate without blocking on unknown output length.</p>' },
    { h: 'Schedule fairly', body: '<p>Deficit round robin: each tenant has a queue and a quantum proportional to its weight; on each round a tenant may dispatch requests up to its accumulated deficit in tokens. Busy tenants get their share; idle shares flow to others.</p>' },
    { h: 'Implement limits in shared storage', body: '<p>Gateways run as many instances, so counters live in Redis or similar, updated atomically (Lua scripts or atomic increments with expiry), keyed by tenant, team and window.</p>' }
  ],
  analogy: `<p><b>A shared office printer with departmental budgets.</b> Each department has a monthly page budget (quota) split among teams, the printer alternates between departments’ queues so one 500-page job does not block a one-page boarding pass (fair queuing), urgent jobs jump the queue within limits (priority), and finance gets an email at 80% of budget (soft cap).</p>`,
  diagram: {
    title: 'Admission and scheduling in a multi-tenant gateway',
    cols: [['req'], ['auth'], ['budget'], ['queues'], ['sched'], ['fleet']],
    nodes: [
      { id: 'req', label: 'Request', sub: 'tenant · team · user · tier', tone: 'fde', info: 'Identity and tier from the API key or token.' },
      { id: 'auth', label: 'Estimate tokens', sub: 'input + max_tokens', info: 'Reservation size for admission.' },
      { id: 'budget', label: 'Hierarchical budgets', sub: 'org → team → user', tone: 'warn', info: 'Token-per-minute and monthly spend checks at every level; soft and hard caps.' },
      { id: 'queues', label: 'Per-tenant queues', sub: 'by tier', tone: 'acc', info: 'Interactive and batch separated.' },
      { id: 'sched', label: 'Fair scheduler', sub: 'weighted DRR', tone: 'be', info: 'Shares capacity by weight; idle share is redistributed.' },
      { id: 'fleet', label: 'Model capacity', sub: 'providers · GPUs', tone: 'ok', info: 'Actual usage settles reservations afterwards.' }
    ],
    edges: [{ a: 'req', b: 'auth' }, { a: 'auth', b: 'budget' }, { a: 'budget', b: 'queues' }, { a: 'queues', b: 'sched' }, { a: 'sched', b: 'fleet' }, { a: 'fleet', b: 'budget', dash: true, bend: -70, label: 'settle' }],
    caption: 'Reserve, check every level, queue per tenant, schedule fairly, settle actual usage.'
  },
  illustrated: { title: 'FIFO vs fair queuing under a noisy neighbour', body: `<p>Tenant A submits a 2,000-request backfill; tenants B and C send interactive traffic.</p>
    <div class="tbl"><table><thead><tr><th></th><th>FIFO: B p95 wait</th><th>fair (equal weights): B p95 wait</th></tr></thead><tbody>
    <tr><td>during A’s burst</td><td class="n">minutes (behind A’s queue)</td><td class="n">seconds</td></tr>
    <tr><td>A’s total completion time</td><td class="n">fastest</td><td class="n">slightly slower, still uses idle capacity</td></tr></tbody></table></div>
    <p>The Code tab measures this.</p>` },
  code: {
    title: 'Token budgets and deficit round robin vs FIFO', file: 'fair_sched.py', browser: true,
    intro: '<p>Three tenants share a capacity of 20,000 tokens per second. Tenant A floods the system with a backfill; B and C send steady interactive requests. We compare FIFO scheduling with weighted deficit round robin (DRR), measuring each tenant’s p95 wait, and apply per-tenant tokens-per-minute limits with reservations.</p>',
    src: String.raw`import random
from collections import deque

random.seed(4)
CAPACITY = 20_000                                  # tokens per second the fleet can process
def workload():
    reqs = []
    for i in range(2000):                          # tenant A: backfill burst at t=0
        reqs.append({"tenant": "A", "t": 0.0 + i * 0.001, "tokens": random.randint(1500, 3000)})
    for tenant, rate in (("B", 4), ("C", 2)):
        t = 0.0
        while t < 120:
            t += random.expovariate(rate)
            reqs.append({"tenant": tenant, "t": t, "tokens": random.randint(800, 2500)})
    return sorted(reqs, key=lambda r: r["t"])

def simulate(policy, weights={"A": 1, "B": 1, "C": 1}, quantum=3000):
    reqs = workload(); i, now = 0, 0.0
    queues = {k: deque() for k in weights}; fifo = deque(); deficit = {k: 0 for k in weights}
    waits = {k: [] for k in weights}; order = list(weights); rr = 0
    while i < len(reqs) or any(queues.values()) or fifo:
        while i < len(reqs) and reqs[i]["t"] <= now:
            (fifo if policy == "fifo" else queues[reqs[i]["tenant"]]).append(reqs[i]); i += 1
        nxt = None
        if policy == "fifo":
            if fifo: nxt = fifo.popleft()
        else:
            for _ in range(len(order) * 50):
                k = order[rr % len(order)]
                if queues[k]:
                    if deficit[k] >= queues[k][0]["tokens"]:
                        nxt = queues[k].popleft(); deficit[k] -= nxt["tokens"]; break
                    deficit[k] += quantum * weights[k]
                else:
                    deficit[k] = 0
                rr += 1
        if nxt is None:
            now = reqs[i]["t"] if i < len(reqs) else now; continue
        waits[nxt["tenant"]].append(now - nxt["t"])
        now += nxt["tokens"] / CAPACITY
    p95 = lambda xs: sorted(xs)[int(0.95 * (len(xs) - 1))]
    return {k: (len(v), round(p95(v), 2)) for k, v in waits.items()}

print("FIFO                   :", simulate("fifo"))
print("DRR equal weights      :", simulate("drr"))
print("DRR weights A1 B3 C3   :", simulate("drr", {"A": 1, "B": 3, "C": 3}))
print("(tenant: (requests, p95 wait seconds))")

class TokenLimiter:                                 # per-tenant tokens-per-minute with reservation and settlement
    def __init__(self, tpm): self.tpm, self.used = tpm, 0
    def reserve(self, est):
        if self.used + est > self.tpm: return False
        self.used += est; return True
    def settle(self, est, actual): self.used += actual - est

lim = TokenLimiter(tpm=50_000)
admitted = rejected = 0
for _ in range(40):
    est = 1200 + 1000                                # input + max_tokens
    if lim.reserve(est):
        admitted += 1; lim.settle(est, 1200 + random.randint(50, 400))
    else:
        rejected += 1
print(f"\nTPM limiter: admitted {admitted}, rejected {rejected} (429 with retry-after), used {lim.used:,} of {lim.tpm:,} tokens this minute")`
  },
  lab: {
    title: 'Hierarchical monthly budgets with soft and hard caps', file: 'budgets_lab.py', browser: true,
    scenario: `<p>A customer has one organisation, three teams and many users. Finance sets a monthly budget per organisation and per team, plus a per-user daily cap. Implement admission that checks all levels, degrades to a cheaper model at 80% of a team’s budget (soft cap), blocks at 100% (hard cap) with a clear message, and emits alerts once per threshold crossing. Simulate a month of usage and report.</p>`,
    steps: ['Budgets: org $10,000; teams support $5,000, sales $3,000, research $4,000 (sum exceeds the org on purpose); per-user daily cap $40.', '<code class="i">admit(user, team, est_cost)</code> returns allow, degrade (switch to the cheap model at one fifth of the cost), or block, with a reason.', 'Emit an alert the first time each budget passes 80% and 100%.', 'Simulate 30 days of seeded requests per team, with research spiking in week 3.', 'Report spend per level, blocked counts, degraded counts and alerts.'],
    checks: ['No level exceeds its hard cap.', 'Alerts fire once per threshold per budget.', 'Degraded requests cost less and are counted.'],
    hints: ['Check the strictest outcome across levels: block beats degrade beats allow.', 'Reset the per-user daily counters each simulated day.'],
    starter: String.raw`import random
random.seed(12)
ORG = 10_000
TEAMS = {"support": 5_000, "sales": 3_000, "research": 4_000}
USER_DAILY = 40
# TODO: admit, simulate 30 days, report`,
    solution: String.raw`import random
from collections import defaultdict
random.seed(12)
ORG = 10_000
TEAMS = {"support": 5_000, "sales": 3_000, "research": 4_000}
USER_DAILY = 40
spend = {"org": 0.0, **{t: 0.0 for t in TEAMS}}
user_day = defaultdict(float)
alerts, stats = [], defaultdict(lambda: {"allow": 0, "degrade": 0, "block": 0})

def check_alerts(name, used, cap):
    for pct in (0.8, 1.0):
        tag = (name, pct)
        if used >= cap * pct and tag not in {a[:2] for a in alerts}:
            alerts.append((name, pct, f"{name} passed {int(pct * 100)}% (${'$'}{used:,.0f} of ${'$'}{cap:,})"))

def admit(user, team, cost):
    for name, cap in (("org", ORG), (team, TEAMS[team])):
        if spend[name] + cost > cap:
            check_alerts(name, cap, cap)                  # hitting the hard cap counts as crossing 100%
            return "block", f"{name} monthly budget exhausted", 0
    if user_day[user] + cost > USER_DAILY:
        return "block", "user daily cap reached", 0
    if spend[team] >= 0.8 * TEAMS[team] or spend["org"] >= 0.8 * ORG:
        return "degrade", "over 80% of budget: cheaper model", cost / 5
    return "allow", "", cost

for day in range(1, 31):
    user_day.clear()
    for team in TEAMS:
        n = {"support": 120, "sales": 60, "research": 70}[team] * (8 if team == "research" and 15 <= day <= 21 else 1)
        for _ in range(n):
            user = f"{team}-u{random.randint(1, 25)}"
            decision, reason, charged = admit(user, team, random.uniform(0.2, 2.5))
            stats[team][decision] += 1
            spend["org"] += charged; spend[team] += charged; user_day[user] += charged
            check_alerts(team, spend[team], TEAMS[team]); check_alerts("org", spend["org"], ORG)

print({k: round(v) for k, v in spend.items()})
for t, s in stats.items():
    print(f"{t:<9} {dict(s)}")
for a in alerts:
    print("ALERT:", a[2])
assert spend["org"] <= ORG and all(spend[t] <= TEAMS[t] for t in TEAMS)`
  },
  design: {
    lead: '<p>Multi-tenancy is a contract with each customer: guaranteed shares, predictable limits, clear errors and isolation of data and cost. Encode those contracts in the gateway and make them visible to customers and finance.</p>',
    scale: [{ h: 'Distributed counters', p: 'Atomic counters in Redis with sliding or fixed windows; local token caches with periodic sync reduce latency at very high QPS.' }, { h: 'Customer visibility', p: 'Expose usage, limits and remaining budget via API and dashboards, plus rate-limit headers, so customers can self-manage.' }],
    fail: [{ h: 'Request-only limits', p: 'A tenant sending a few huge requests bypasses RPM limits and drains capacity. Limit tokens.' }, { h: 'Starvation', p: 'Strict priority lets high tiers starve low tiers entirely. Use weights or guaranteed minimum shares.' }],
    trade: [{ h: 'Pooling vs dedicated capacity', p: 'Pooled capacity is efficient; dedicated replicas for large tenants give isolation and predictable latency at higher cost.' }, { h: 'Hard blocks vs degradation', p: 'Blocking protects budgets; degrading to cheaper models keeps users working. Decide per tenant contract.' }],
    prompt: '<p>Design quotas for an AI platform serving 500 business customers on three plans, with interactive and batch traffic.</p>',
    answer: '<ul><li>Per-plan ITPM and OTPM limits and monthly token allowances; per-customer overrides in config.</li><li>Separate interactive and batch queues; weighted DRR by plan with minimum shares.</li><li>Reservations at admission, settlement on completion; soft caps degrade, hard caps block with clear errors and headers.</li><li>Usage API and dashboards per customer; alerts to account managers at 80% and 100%.</li></ul>'
  },
  quiz: [
    { q: 'Why limit tokens rather than only requests?', o: ['Tokens are easier to count', 'Request costs vary enormously; a few huge requests can drain capacity under an RPM limit', 'Providers forbid RPM limits', 'For caching'], a: 1, why: 'Token-based limits track real resource use.' },
    { q: 'What does weighted fair queuing prevent?', o: ['All errors', 'One tenant’s burst starving others’ requests', 'Prompt injection', 'High costs entirely'], a: 1, why: 'Each tenant gets its weighted share when the system is busy.' },
    { q: 'A soft cap at 80% of budget should:', o: ['Block all requests', 'Alert and possibly degrade to cheaper models', 'Delete the tenant', 'Do nothing'], a: 1, why: 'Soft caps warn and adapt before the hard cap blocks.' }
  ],
  interview: [
    { q: 'How would you implement rate limiting for an LLM API used by many tenants?', a: '<p>Token-based limits (input and output tokens per minute) plus request limits, enforced with atomic counters in shared storage, reserving an estimate at admission and settling actual usage afterwards. Hierarchical budgets per organisation, team and user, weighted fair scheduling across tenants with separate interactive and batch queues, and clear 429 responses with retry-after and usage headers.</p>' },
    { q: 'How do you handle a noisy neighbour on shared GPUs?', a: '<p>Per-tenant queues with weighted fair scheduling so bursts only consume the tenant’s share plus idle capacity, token limits that cap burst size, separate batch lanes, and for the largest tenants, dedicated capacity. Monitor per-tenant latency to verify isolation.</p>' }
  ]
});

/* ===================================================================== 9.11 */
L({
  id: '9.11', title: 'Observability: OpenTelemetry, Langfuse', minutes: 50, roles: ['be', 'fde'],
  tags: 'metrics · traces · logs · GenAI semantic conventions · token and latency histograms · SLOs · burn-rate alerts · Langfuse',
  mental: 'Production AI needs the three pillars plus AI-specific signals: metrics for SLOs and cost (latency, TTFT, tokens, errors per model and tenant), traces for individual requests (3.7), and evaluation scores attached to traces (7.7). OpenTelemetry carries them in a vendor-neutral way; LLM-focused tools such as Langfuse add prompt, cost and evaluation views on top.',
  intro: `<p>Lesson 3.7 traced single requests. This lesson completes the picture for a running platform: metrics that power dashboards and alerts, service level objectives for latency and quality, burn-rate alerting that pages humans only when it matters, and where LLM-specific observability tools fit. Langfuse, an open-source LLM engineering platform, ingests OpenTelemetry traces and adds prompt management, cost tracking and evaluation scores; many teams pair it with their general observability stack.</p>`,
  points: [
    'GenAI metric conventions include client token usage (<code class="i">gen_ai.client.token.usage</code>, split by input and output) and operation duration (<code class="i">gen_ai.client.operation.duration</code>), with attributes for provider, model and operation.',
    'Add your own: TTFT, TPOT, cost, cache hit rate, guardrail blocks, tool errors, per tenant and feature.',
    'Use histograms for latency and tokens, not averages; set SLOs on percentiles (for example TTFT p95 under 1.5 s).',
    'Alert on SLO burn rate across two windows (for example 1 hour and 5 minutes) to catch fast and slow budget burns without noise.',
    'Watch cardinality: tenant and model as metric attributes are fine; user ids and prompts are not.',
    'Attach evaluation scores and user feedback to traces so quality is observable alongside latency and cost.'
  ],
  concept: { title: 'Instruments for a new kind of engine', body: `<p>A web service dashboard shows requests, errors and latency. An AI service needs those plus a fuel gauge (tokens and cost), an engine-temperature gauge (TTFT and TPOT, queue depth, KV usage) and a quality gauge (eval and feedback scores). SLOs turn the gauges into promises, and burn-rate alerts say when a promise is at risk.</p>` },
  walk: [
    { h: 'Record GenAI metrics', body: '<p>Histograms with low-cardinality attributes.</p>', code: String.raw`meter = metrics.get_meter("ai-gateway")
tokens = meter.create_histogram("gen_ai.client.token.usage", unit="{token}")
duration = meter.create_histogram("gen_ai.client.operation.duration", unit="s")
attrs = {"gen_ai.operation.name": "chat", "gen_ai.provider.name": "anthropic", "gen_ai.request.model": MODEL, "app.tenant": tenant}
tokens.record(usage.input_tokens, {**attrs, "gen_ai.token.type": "input"})
tokens.record(usage.output_tokens, {**attrs, "gen_ai.token.type": "output"})
duration.record(elapsed_s, attrs)` },
    { h: 'Define SLOs and burn rates', body: '<p>SLO: 99% of interactive requests have TTFT under 1.5 s over 30 days, so the error budget is 1%. Burn rate = observed bad fraction ÷ 1%. A burn rate of 14.4 sustained for an hour consumes 2% of a 30-day budget; page when both the 1-hour and 5-minute windows exceed it.</p>' },
    { h: 'Choose the stack', body: '<p>Emit OpenTelemetry from gateways, services and engines; send it to the customer’s observability backend for SLOs and paging, and to an LLM-focused tool (Langfuse or similar) for prompt-level debugging, cost and evals.</p>' }
  ],
  analogy: `<p><b>A cockpit.</b> Dozens of gauges, but pilots are alerted only when something matters: a warning light when fuel burn will not reach the destination, not every time consumption flickers. Burn-rate alerts are that warning light for your error budget.</p>`,
  diagram: {
    title: 'Observability pipeline for AI services',
    cols: [['svc', 'gw', 'eng'], ['otel'], ['metrics', 'traces'], ['slo', 'llm'], ['page']],
    nodes: [
      { id: 'svc', label: 'App services', sub: 'spans · metrics', tone: 'fde', info: 'Business context: tenant, feature, outcome.' },
      { id: 'gw', label: 'Gateway', sub: 'tokens · cost · route', info: 'Per-call usage and routing data.' },
      { id: 'eng', label: 'Inference engines', sub: 'TTFT · KV · queue', info: 'Prometheus metrics from vLLM or SGLang.' },
      { id: 'otel', label: 'OTel collector', sub: 'redact · sample · route', tone: 'acc', info: 'One pipeline; redaction and sampling before export.' },
      { id: 'metrics', label: 'Metrics backend', sub: 'histograms', tone: 'be', info: 'Prometheus, Datadog, Grafana and similar.' },
      { id: 'traces', label: 'Trace backend', sub: 'requests', info: 'Tempo, Honeycomb, Datadog and similar.' },
      { id: 'slo', label: 'SLOs + burn alerts', sub: 'multi-window', tone: 'warn', info: 'Pages only when error budget is at risk.' },
      { id: 'llm', label: 'Langfuse-style view', sub: 'prompts · cost · evals', tone: 'ok', info: 'LLM-specific debugging and quality tracking.' },
      { id: 'page', label: 'On-call', sub: 'runbooks (10.7)', tone: 'bad', info: 'Humans paged with links to dashboards and traces.' }
    ],
    edges: [{ a: 'svc', b: 'otel' }, { a: 'gw', b: 'otel' }, { a: 'eng', b: 'otel' }, { a: 'otel', b: 'metrics' }, { a: 'otel', b: 'traces' }, { a: 'metrics', b: 'slo' }, { a: 'traces', b: 'llm' }, { a: 'slo', b: 'page' }],
    caption: 'One telemetry pipeline feeding SLOs, traces and LLM-specific views.'
  },
  illustrated: { title: 'Burn rates for a 99% SLO (30-day window)', body: `<div class="tbl"><table><thead><tr><th>burn rate</th><th>bad fraction</th><th>budget used per hour</th><th>budget gone in</th><th>action</th></tr></thead><tbody>
    <tr><td class="n">1</td><td class="n">1%</td><td class="n">0.14%</td><td class="n">30 days</td><td>none</td></tr>
    <tr><td class="n">6</td><td class="n">6%</td><td class="n">0.83%</td><td class="n">5 days</td><td>ticket</td></tr>
    <tr><td class="n">14.4</td><td class="n">14.4%</td><td class="n">2%</td><td class="n">≈ 2 days</td><td>page</td></tr></tbody></table></div>` },
  code: {
    title: 'GenAI metrics with OpenTelemetry and an SLO report', file: 'genai_metrics.py', deps: 'uv add opentelemetry-sdk',
    intro: '<p>Records token-usage and duration histograms with GenAI attributes, plus a custom TTFT histogram, for simulated traffic across two models and two tenants, using an in-memory metric reader (swap for an OTLP or Prometheus exporter in production). Then reads the aggregated data points and computes per-model token totals and the share of requests violating a TTFT SLO.</p>',
    src: String.raw`import random
from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.metrics.view import ExplicitBucketHistogramAggregation, View

reader = InMemoryMetricReader()
ttft_buckets = View(instrument_name="app.ttft", aggregation=ExplicitBucketHistogramAggregation([0.25, 0.5, 1.0, 1.5, 2.5, 5.0]))
metrics.set_meter_provider(MeterProvider(metric_readers=[reader], views=[ttft_buckets]))
meter = metrics.get_meter("ai-gateway")
token_usage = meter.create_histogram("gen_ai.client.token.usage", unit="{token}", description="tokens per call")
duration = meter.create_histogram("gen_ai.client.operation.duration", unit="s")
ttft = meter.create_histogram("app.ttft", unit="s", description="time to first token")

random.seed(7)
for _ in range(2000):
    model = random.choice(["claude-haiku-5-5", "claude-sonnet-5-5"])
    tenant = random.choice(["acme", "globex"])
    attrs = {"gen_ai.operation.name": "chat", "gen_ai.provider.name": "anthropic", "gen_ai.request.model": model, "app.tenant": tenant}
    tin, tout = random.randint(500, 6000), random.randint(50, 600)
    first = random.lognormvariate(-0.9 if model.endswith("haiku-5-5") else -0.3, 0.5) * (1.6 if tenant == "globex" else 1)
    token_usage.record(tin, {**attrs, "gen_ai.token.type": "input"})
    token_usage.record(tout, {**attrs, "gen_ai.token.type": "output"})
    duration.record(first + tout * 0.02, attrs)
    ttft.record(first, attrs)

data = reader.get_metrics_data()
by_name = {m.name: m for rm in data.resource_metrics for sm in rm.scope_metrics for m in sm.metrics}
print("tokens by model and type:")
for dp in sorted(by_name["gen_ai.client.token.usage"].data.data_points, key=lambda d: (d.attributes["gen_ai.request.model"], d.attributes["gen_ai.token.type"], d.attributes["app.tenant"])):
    a = dp.attributes
    print(f"  {a['gen_ai.request.model']:<18} {a['app.tenant']:<7} {a['gen_ai.token.type']:<7} calls={dp.count:>4} tokens={int(dp.sum):>9,}")
print("\nTTFT SLO (< 1.5 s) by model and tenant:")
for dp in by_name["app.ttft"].data.data_points:
    bounds, counts = list(dp.explicit_bounds), list(dp.bucket_counts)
    good = sum(c for b, c in zip(bounds, counts) if b <= 1.5)
    bad = dp.count - good
    print(f"  {dp.attributes['gen_ai.request.model']:<18} {dp.attributes['app.tenant']:<7} violations {bad / dp.count:6.1%}  burn rate vs 1% budget: {bad / dp.count / 0.01:5.1f}")`
  },
  lab: {
    title: 'Multi-window burn-rate alerting', file: 'burn_rate_lab.py', browser: true,
    scenario: `<p>You have per-minute counts of requests and TTFT SLO violations for a 24-hour day, including a short blip, a slow degradation and a real incident (seeded). Implement Google-SRE-style multi-window burn-rate alerts for a 99% SLO: page when the 1-hour and 5-minute burn rates both exceed 14.4, ticket when the 6-hour and 30-minute rates both exceed 6. Show which events page, which ticket, and that the blip does neither.</p>`,
    steps: ['Generate the seeded per-minute series in the starter.', 'Compute rolling bad fractions over 5, 30, 60 and 360 minutes.', 'Burn rate = bad fraction / 0.01.', 'Fire a page when 1h and 5m burn both exceed 14.4, a ticket when 6h and 30m both exceed 6; record the first minute of each alert episode.', 'Print the alert timeline and classify each injected event.'],
    checks: ['The incident pages within minutes of starting.', 'The slow degradation raises a ticket but not a page.', 'The two-minute blip triggers nothing.'],
    hints: ['Use numpy cumulative sums for rolling windows.', 'An episode starts when the condition becomes true after being false.'],
    starter: String.raw`import numpy as np
rng = np.random.default_rng(10)
minutes = 24 * 60
reqs = rng.poisson(300, minutes)
bad_rate = np.full(minutes, 0.004)
bad_rate[300:302] = 0.35          # 2-minute blip
bad_rate[600:960] = 0.07          # slow degradation for 6 hours
bad_rate[1200:1240] = 0.40        # incident
bad = rng.binomial(reqs, bad_rate)
# TODO`,
    solution: String.raw`import numpy as np
rng = np.random.default_rng(10)
minutes = 24 * 60
reqs = rng.poisson(300, minutes)
bad_rate = np.full(minutes, 0.004)
bad_rate[300:302] = 0.35
bad_rate[600:960] = 0.07
bad_rate[1200:1240] = 0.40
bad = rng.binomial(reqs, bad_rate)

def rolling(x, w):
    c = np.cumsum(np.insert(x, 0, 0))
    out = np.empty(len(x))
    for i in range(len(x)):
        out[i] = c[i + 1] - c[max(0, i + 1 - w)]
    return out

def burn(w):
    return rolling(bad, w) / np.maximum(rolling(reqs, w), 1) / 0.01

b5, b30, b60, b360 = burn(5), burn(30), burn(60), burn(360)
page = (b60 > 14.4) & (b5 > 14.4)
ticket = (b360 > 6) & (b30 > 6)

def episodes(mask):
    starts = np.where(mask & ~np.roll(mask, 1))[0]
    ends = np.where(mask & ~np.roll(mask, -1))[0]
    return list(zip(starts, ends))

fmt = lambda m: f"{m // 60:02d}:{m % 60:02d}"
for name, mask in [("PAGE", page), ("TICKET", ticket)]:
    for s, e in episodes(mask):
        print(f"{name:<6} {fmt(s)} -> {fmt(e)}")
print("\nblip 05:00-05:02 paged?", bool(page[300:330].any()), "| ticketed?", bool(ticket[300:330].any()))
print("degradation 10:00-16:00 paged?", bool(page[600:960].any()), "| ticketed?", bool(ticket[600:960].any()))
print("incident 20:00-20:40 paged?", bool(page[1200:1240].any()), f"(first page at {fmt(int(np.argmax(page[1200:])) + 1200)})")`
  },
  design: {
    lead: '<p>Observability for AI platforms combines classic SRE practice with AI-specific signals. Design the telemetry once, centrally (gateway, collector, conventions), so every new feature is observable on day one.</p>',
    scale: [{ h: 'Collector pipeline', p: 'An OpenTelemetry collector redacts, samples and routes telemetry; tail-based sampling keeps slow and errored traces.' }, { h: 'Cardinality budgets', p: 'Agree which attributes are allowed on metrics (model, tenant, feature, route) and keep high-cardinality data in traces.' }],
    fail: [{ h: 'Alert fatigue', p: 'Threshold alerts on averages page on every blip. Use SLO burn rates with multiple windows.' }, { h: 'Blind spots in quality', p: 'Latency and error dashboards look green while answers get worse. Track eval and feedback scores as first-class metrics (7.7).' }],
    trade: [{ h: 'General vs LLM-specific tools', p: 'General observability gives SLOs and correlation with infrastructure; LLM tools give prompt, cost and eval views. Most teams need both, fed from one pipeline.' }, { h: 'Content capture', p: 'Capturing prompts and outputs eases debugging and raises privacy obligations (8.5). Make it opt-in per tenant with redaction.' }],
    prompt: '<p>Set up observability for a multi-tenant AI assistant platform before launch.</p>',
    answer: '<ul><li>OTel SDKs in services and gateway; GenAI conventions plus TTFT, TPOT, cost, cache and guardrail metrics by model, tenant and feature.</li><li>Collector with redaction and tail sampling; traces to the trace backend and an LLM-focused tool with eval scores attached.</li><li>SLOs: availability, TTFT p95, quality score; multi-window burn-rate paging with runbooks.</li><li>Per-tenant dashboards for customers and cost dashboards for finance.</li></ul>'
  },
  quiz: [
    { q: 'Why record latency as a histogram rather than an average?', o: ['Histograms are smaller', 'SLOs are about percentiles; averages hide tails', 'Averages are not allowed', 'For caching'], a: 1, why: 'Tail latency is what users feel and SLOs measure.' },
    { q: 'What does a burn rate of 14.4 on a 99% SLO mean?', o: ['14.4% of requests succeed', 'Errors are consuming the budget 14.4 times faster than sustainable', 'Latency is 14.4 s', 'Nothing'], a: 1, why: 'Burn rate = observed error fraction over the allowed fraction.' },
    { q: 'Which attribute should not be on a metric?', o: ['Model name', 'Tenant', 'User prompt text', 'Operation name'], a: 2, why: 'Unbounded cardinality explodes metric storage; keep it in traces, redacted.' }
  ],
  interview: [
    { q: 'What do you monitor for an LLM service in production?', a: '<p>Request rate, errors, and latency histograms including TTFT and TPOT; tokens and cost by model, tenant and feature; cache hit rates; queue depth and KV usage for self-hosted engines; guardrail and tool error rates; and quality signals: sampled eval scores and user feedback. SLOs on latency, availability and quality with multi-window burn-rate alerts, and traces for drill-down.</p>' },
    { q: 'How do OpenTelemetry and tools like Langfuse fit together?', a: '<p>OpenTelemetry is the vendor-neutral way to emit traces and metrics with GenAI conventions from every component. Langfuse and similar tools consume those traces to provide LLM-specific views: prompts, costs, evaluation scores and datasets. General observability backends handle SLOs, alerting and infrastructure correlation. One pipeline, several consumers.</p>' }
  ]
});
})();

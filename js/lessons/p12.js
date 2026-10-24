/* Phase 12 · System design cases (part 1) */
(function () {
const L = AISA.lesson;

/* ===================================================================== 12.1 */
L({
  id: '12.1', title: 'Design framework', minutes: 50, roles: ['be', 'fde'], sim: 'envelope',
  tags: 'requirements · back-of-envelope estimates · latency budgets · quality and evals as requirements · high-level design · deep dives · failure modes · trade-offs',
  mental: 'An AI system design interview, and a real design review, follow one path: clarify requirements (including quality and safety), estimate scale and cost, sketch the end-to-end design, deep-dive the riskiest components, then cover evaluation, failure modes and trade-offs. The AI-specific additions are quality as a measured requirement, token economics and non-determinism.',
  intro: `<p>Classic system design asks about QPS, storage and consistency. AI system design adds new axes: how good must answers be and how will we know, how many tokens per request and what they cost, what latency users perceive with streaming, which parts are deterministic, and what happens when the model is wrong or unavailable. This lesson gives a repeatable framework used in the case studies that follow (12.2–12.6).</p>`,
  points: [
    '<b>Requirements</b>: users and use cases, functional scope, quality bar (with a metric), latency (TTFT and total), safety and compliance, scale, budget.',
    '<b>Estimates</b>: requests per second at peak, tokens in and out per request, tokens per second, monthly cost per model choice, storage for indexes and traces.',
    '<b>High-level design</b>: clients, API and gateway, orchestration, retrieval and tools, models, data pipelines, evaluation and observability.',
    '<b>Deep dives</b>: pick the two riskiest parts (retrieval quality, agent reliability, serving cost) and go deep.',
    '<b>Evaluation</b>: offline eval sets, online metrics, release gates (Phase 7).',
    '<b>Failures and trade-offs</b>: provider outage, bad answers, prompt injection, cost spikes; and the choices you made with alternatives.'
  ],
  concept: { title: 'An architect’s brief before the drawings', body: `<p>Architects first ask who will live in the building, how many, what budget, what the site allows and what must never fail (fire exits). Then they sketch, then detail the hardest parts. Jumping straight to the facade is how buildings end up beautiful and unusable. Design interviews reward the same order.</p>` },
  walk: [
    { h: 'Clarify with numbers', body: '<p>Turn vague requirements into numbers you can design against.</p>', code: String.raw`Users: 20k support agents, 8 h shifts, peak 3x average
Use: suggest replies for tickets; ~40 suggestions per agent per day
Quality: >= 85% of suggestions accepted with light edits; zero PII leaks across tenants
Latency: first tokens < 1 s, full draft < 6 s (p95)
Scale: 20k x 40 / (8 x 3600) ~ 28 req/s average, ~ 80 req/s peak
Tokens: 3,000 in (ticket + retrieved context) + 300 out per request
Budget: < $0.01 per suggestion` },
    { h: 'Estimate cost and capacity', body: '<p>Tokens per second and dollars per month decide architecture: which model tier, whether to cache prompts, whether to self-host. The simulator above computes these from your inputs. At 80 req/s with 3,000 input tokens, input throughput is 240k tokens/s: prompt caching of the shared prefix matters.</p>' },
    { h: 'Latency budget', body: '<p>Split the target across components: auth and routing 50 ms, retrieval 150 ms, reranking 100 ms, model TTFT 400 ms, generation 300 tokens at 60 tokens/s = 5 s streamed. Parallelise independent steps; stream the slow part. The lab simulates this with distributions rather than averages.</p>' }
  ],
  analogy: `<p><b>Planning a wedding.</b> Guest count and budget first (requirements), then catering per head and venue size (estimates), then the overall plan (design), then the risky details: dietary restrictions and the weather backup (deep dives and failure modes). Nobody chooses napkins first.</p>`,
  diagram: {
    title: 'Reference architecture for an AI application',
    cols: [['client'], ['gw'], ['orch'], ['ret', 'tools', 'guard'], ['models'], ['obs', 'evals']],
    nodes: [
      { id: 'client', label: 'Clients', sub: 'web · bots · API', tone: 'fde', info: 'Thin frontends (11.6).' },
      { id: 'gw', label: 'API + gateway', sub: 'auth · quotas · routing', tone: 'acc', info: 'Rate limits, budgets, model routing, fallbacks (9.8).' },
      { id: 'orch', label: 'Orchestrator', sub: 'workflow or agent', tone: 'be', info: 'Pipelines where possible, agents where needed (5.x).' },
      { id: 'ret', label: 'Retrieval', sub: 'hybrid · rerank · ACL', tone: 'be', info: 'Phase 4.' },
      { id: 'tools', label: 'Tools', sub: 'MCP · APIs · DB', tone: 'be', info: 'Phase 5.' },
      { id: 'guard', label: 'Guardrails', sub: 'input · output', tone: 'bad', info: 'Phase 8.' },
      { id: 'models', label: 'Models', sub: 'API · cloud · self-hosted', tone: 'warn', info: 'Phases 2, 9, 10.6.' },
      { id: 'obs', label: 'Tracing + metrics', sub: 'tokens · latency · cost', tone: 'ok', info: '3.7, 7.7.' },
      { id: 'evals', label: 'Evals', sub: 'offline · online · gates', tone: 'ok', info: 'Phase 7.' }
    ],
    edges: [{ a: 'client', b: 'gw' }, { a: 'gw', b: 'orch' }, { a: 'orch', b: 'ret' }, { a: 'orch', b: 'tools' }, { a: 'orch', b: 'guard' }, { a: 'ret', b: 'models', dash: true }, { a: 'orch', b: 'models', bend: -70 }, { a: 'models', b: 'obs' }, { a: 'obs', b: 'evals' }],
    caption: 'The same skeleton fits most cases; the deep dives differ.'
  },
  illustrated: { title: 'A 45-minute interview plan', body: `<div class="tbl"><table><thead><tr><th>minutes</th><th>do</th></tr></thead><tbody>
    <tr><td class="n">0–8</td><td>clarify users, scope, quality bar, latency, scale, constraints; write numbers down</td></tr>
    <tr><td class="n">8–12</td><td>estimates: QPS, tokens/s, cost per request and month, storage</td></tr>
    <tr><td class="n">12–22</td><td>high-level design and data flow for the main request</td></tr>
    <tr><td class="n">22–35</td><td>two deep dives on the riskiest components</td></tr>
    <tr><td class="n">35–42</td><td>evaluation, monitoring, failure modes, security</td></tr>
    <tr><td class="n">42–45</td><td>trade-offs made and what you would do with more time</td></tr></tbody></table></div>` },
  code: {
    title: 'Back-of-envelope calculator for AI systems', file: 'envelope.py', browser: true,
    intro: '<p>A requirements dataclass in, derived numbers out: average and peak requests per second, token throughput, monthly cost for three model tiers with and without prompt caching, and storage for traces. Prices are example values for illustration, not current list prices; plug in your provider’s.</p>',
    src: String.raw`from dataclasses import dataclass

@dataclass
class Req:
    users: int; actions_per_user_day: int; active_hours: float; peak_factor: float
    in_tokens: int; out_tokens: int; cached_prefix_tokens: int; trace_kb: float; retention_days: int

# example prices per million tokens (input, output); cached input billed at 10% of input
TIERS = {"small": (1.0, 5.0), "mid": (3.0, 15.0), "large": (15.0, 75.0)}

def estimate(r: Req):
    per_day = r.users * r.actions_per_user_day
    avg_rps = per_day / (r.active_hours * 3600)
    peak_rps = avg_rps * r.peak_factor
    print(f"requests/day {per_day:,.0f} | avg {avg_rps:.1f} rps | peak {peak_rps:.1f} rps")
    print(f"peak token throughput: {peak_rps * r.in_tokens / 1e3:,.0f}k input tok/s, {peak_rps * r.out_tokens / 1e3:,.1f}k output tok/s")
    month = per_day * 30
    for tier, (pin, pout) in TIERS.items():
        plain = month * (r.in_tokens * pin + r.out_tokens * pout) / 1e6
        uncached = r.in_tokens - r.cached_prefix_tokens
        cached = month * (uncached * pin + r.cached_prefix_tokens * pin * 0.1 + r.out_tokens * pout) / 1e6
        print(f"  {tier:<6} ${'$'}{plain:>10,.0f}/month  with prefix caching ${'$'}{cached:>10,.0f}  -> ${'$'}{cached / month * 1000:.2f} per 1k requests")
    storage_gb = per_day * r.trace_kb * r.retention_days / 1e6
    print(f"trace storage at {r.retention_days} days retention: {storage_gb:,.0f} GB")

print("== support copilot ==")
estimate(Req(users=20_000, actions_per_user_day=40, active_hours=8, peak_factor=3, in_tokens=3000, out_tokens=300,
             cached_prefix_tokens=1800, trace_kb=24, retention_days=30))
print("\n== internal research agent ==")
estimate(Req(users=2_000, actions_per_user_day=3, active_hours=10, peak_factor=2, in_tokens=120_000, out_tokens=6000,
             cached_prefix_tokens=60_000, trace_kb=900, retention_days=90))`
  },
  lab: {
    title: 'Latency budget with distributions, not averages', file: 'latency_budget_lab.py', browser: true,
    scenario: `<p>A RAG assistant must deliver first visible tokens within 1.5 s at p95. Components have measured latency distributions (lognormal). The current design runs everything in sequence. Simulate the end-to-end TTFT distribution, find which components dominate the tail, then evaluate design changes: run query rewriting and permission lookup in parallel with embedding, cache embeddings for repeated queries, drop the reranker for short queries, and use prompt caching on the stable system prompt and tool definitions (cuts model TTFT by about 45% for the 80% of requests that hit the cache). Find the cheapest set of changes that meets the target.</p>`,
    steps: ['Sample 50,000 requests per component with NumPy lognormal (median and spread given).', 'Sequential TTFT = sum; parallel groups take the max.', 'Report p50, p95 and the share of p95 contributed by each component (compare conditional means in the tail).', 'Apply each change and combinations; print p95 for each.', 'Pick the smallest set of changes that meets 1.2 s.'],
    checks: ['The sequential p95 is above target.', 'Each change’s effect is quantified separately.', 'The chosen design meets the target with the fewest changes.'],
    hints: ['p95 of a sum is not the sum of p95s; simulate.', 'Caching affects only the share of requests that hit; model it with a Bernoulli mask.'],
    starter: String.raw`import itertools
import numpy as np
rng = np.random.default_rng(3)
N = 50_000
# component: (median seconds, sigma of log)
C = {"auth": (0.03, 0.3), "rewrite": (0.25, 0.5), "acl_lookup": (0.08, 0.6), "embed": (0.06, 0.4),
     "search": (0.09, 0.5), "rerank": (0.18, 0.5), "ttft_model": (0.42, 0.45)}
TARGET = 1.5
# TODO`,
    solution: String.raw`import itertools
import numpy as np
rng = np.random.default_rng(3)
N = 50_000
C = {"auth": (0.03, 0.3), "rewrite": (0.25, 0.5), "acl_lookup": (0.08, 0.6), "embed": (0.06, 0.4),
     "search": (0.09, 0.5), "rerank": (0.18, 0.5), "ttft_model": (0.42, 0.45)}
TARGET = 1.5
S = {k: rng.lognormal(np.log(m), s, N) for k, (m, s) in C.items()}
short_query = rng.random(N) < 0.55            # 55% of queries are short and keyword-like
cache_hit = rng.random(N) < 0.35              # repeated queries
prefix_hit = rng.random(N) < 0.80             # prompt cache hits on the stable prefix

def ttft(parallel=False, cache=False, skip_rerank_short=False, prompt_cache=False):
    embed = np.where(cache_hit, 0.002, S["embed"]) if cache else S["embed"]
    rerank = np.where(short_query, 0.0, S["rerank"]) if skip_rerank_short else S["rerank"]
    front = np.maximum.reduce([S["rewrite"], S["acl_lookup"], embed]) if parallel else S["rewrite"] + S["acl_lookup"] + embed
    model = np.where(prefix_hit, S["ttft_model"] * 0.55, S["ttft_model"]) if prompt_cache else S["ttft_model"]
    return S["auth"] + front + S["search"] + rerank + model

base = ttft()
p50, p95 = np.percentile(base, [50, 95])
print(f"sequential: p50 {p50:.2f}s p95 {p95:.2f}s (target {TARGET}s)")
tail = base >= p95
print("mean seconds per component, all requests vs slowest 5%:")
for k in C:
    print(f"  {k:<11} {S[k].mean():.3f} -> {S[k][tail].mean():.3f}")
changes = {"parallel": "parallel front", "cache": "embedding cache", "skip_rerank_short": "skip rerank (short)", "prompt_cache": "prompt cache"}
results = []
for k in range(len(changes) + 1):
    for combo in itertools.combinations(changes, k):
        p = np.percentile(ttft(**{c: True for c in combo}), 95)
        results.append((len(combo), p, combo))
        print(f"  {' + '.join(changes[c] for c in combo) or 'no changes':<68} p95 {p:.2f}s {'OK' if p <= TARGET else ''}")
best = min((r for r in results if r[1] <= TARGET), key=lambda r: (r[0], r[1]))
print(f"\nchosen: {' + '.join(changes[c] for c in best[2])} -> p95 {best[1]:.2f}s")`
  },
  design: {
    lead: '<p>A design framework is a checklist that keeps you from forgetting the parts that sink AI systems: measured quality, token economics, failure behaviour and safety. Use it in interviews and in real design docs.</p>',
    scale: [{ h: 'Think in tokens', p: 'Throughput and cost scale with tokens, not requests. Shrink inputs (better retrieval, caching, compaction) before buying capacity.' }, { h: 'Peak vs average', p: 'Design capacity and rate limits for peak with headroom; use batch APIs or queues for work that can wait.' }],
    fail: [{ h: 'No quality requirement', p: 'Without a measurable quality bar, every design looks fine. State the metric and how it is evaluated.' }, { h: 'Single provider', p: 'Model APIs have outages and throttling. Design fallbacks and graceful degradation.' }],
    trade: [{ h: 'Quality vs latency vs cost', p: 'Bigger models, more context and agents raise quality and cost; routing and caching recover cost. Make the triangle explicit for each component.' }, { h: 'Pipeline vs agent', p: 'Pipelines are predictable and cheap; agents handle open-ended tasks. Prefer pipelines, embed agents where the path is truly unknown.' }],
    prompt: '<p>“Design ChatGPT-style chat for 50,000 employees of a company, with access to internal documents.” Give the first 12 minutes.</p>',
    answer: '<ul><li>Clarify: use cases, document sources and permissions, quality bar (grounded answers with citations, measured on an eval set), latency (TTFT < 1 s), compliance (data residency, retention), budget.</li><li>Estimate: 50k × 10 chats/day ≈ 5.8 rps average, ~20 rps peak; 4k input + 500 output tokens; monthly cost per tier; index size from document counts.</li><li>Sketch: SSO → API/gateway → orchestrator with hybrid retrieval and ACL filtering → model via cloud platform → streaming back; ingestion pipeline; tracing and evals.</li><li>Name deep dives: permission-aware retrieval and cost controls.</li></ul>'
  },
  quiz: [
    { q: 'Why estimate tokens per second, not just requests per second?', o: ['Tokens are cheaper', 'Cost and model throughput scale with tokens', 'Interviewers like it', 'For storage'], a: 1, why: 'A request can be 500 or 500,000 tokens.' },
    { q: 'Is the p95 of a sequence of steps equal to the sum of their p95s?', o: ['Yes', 'No: simulate or measure the end-to-end distribution', 'Only for two steps', 'Only with caching'], a: 1, why: 'Tails do not add linearly.' },
    { q: 'What is the AI-specific requirement often forgotten in design interviews?', o: ['QPS', 'A measurable quality bar and how it is evaluated', 'Storage', 'Load balancing'], a: 1, why: 'Quality is the product.' }
  ],
  interview: [
    { q: 'Walk me through how you approach an AI system design question.', a: '<p>Clarify users, scope, quality bar with a metric, latency, safety, scale and budget; estimate QPS, tokens, cost and storage; sketch the end-to-end design; deep-dive the riskiest components; cover evaluation and monitoring, failure modes and security; summarise the trade-offs and what I would do next.</p>' },
    { q: 'How do you reduce the cost of an LLM feature without hurting quality?', a: '<p>Measure where tokens go; shrink inputs with better retrieval and context management; cache stable prefixes and frequent answers; route easy requests to smaller models and verify with evals; batch offline work; set budgets and limits; and confirm with paired evals that quality holds.</p>' }
  ]
});

/* ===================================================================== 12.2 */
L({
  id: '12.2', title: 'Support copilot', minutes: 60, roles: ['fde', 'be'],
  tags: 'agent-assist vs auto-reply · intent routing · retrieval over KB and past tickets · confidence thresholds · tool actions · multi-tenancy · deflection and CSAT metrics',
  mental: 'A support copilot is a ladder of automation: suggest to agents first, then auto-reply only for intents and confidence levels where measured precision is very high, with tools for account-specific facts and humans for anything risky. Every rung is gated by evals and online metrics.',
  intro: `<p>This is the most common enterprise AI deployment and a classic interview case. The design must handle many tenants (each with its own knowledge base, tone and policies), sensitive customer data, tool access to account systems (orders, billing), multiple channels, and a measurable business goal: faster resolution and higher deflection without hurting satisfaction.</p>`,
  points: [
    'Requirements: channels (email, chat), languages, tenants, policies (refund limits), latency per channel, success metrics (handle time, deflection, CSAT, accuracy).',
    'Flow: ingest ticket → classify intent and risk → retrieve from KB, macros and similar solved tickets → call tools for account facts → draft with citations → guardrails → route.',
    'Routing by confidence and intent: auto-reply (high precision intents), suggest to agent, or human only (legal, threats, VIP, refunds above limits).',
    'Multi-tenancy: per-tenant indexes or filters, per-tenant prompts and policies in config, strict isolation tests.',
    'Learning loop: agent edits and accept rates become eval data; KB gaps become content tasks.',
    'Metrics: suggestion acceptance, edit distance, auto-reply precision (audited), reopen rate, CSAT, time to first response.'
  ],
  concept: { title: 'A new hire with a great manual', body: `<p>On day one, a new support hire drafts replies and a senior checks them. As they prove reliable on simple question types, they are allowed to answer those directly, while tricky cases still go to seniors. A copilot earns autonomy the same way: per intent, by measured track record.</p>` },
  walk: [
    { h: 'Requirements and estimates', body: '<p>Example: 300 tenants, 2 million tickets a month, chat p95 first token < 1 s, email draft < 10 s, auto-reply precision ≥ 98% (audited sample), PII never crosses tenants. About 0.8 tickets per second on average, peaks of 5; each ticket ~4k input tokens with retrieval, ~350 output.</p>' },
    { h: 'Confidence that means something', body: '<p>Raw model self-reported confidence is poorly calibrated. Combine signals: intent classifier probability, retrieval scores and agreement, whether a macro matched, groundedness check result, policy rules. Calibrate the combined score on labelled data and set thresholds per intent to hit the precision target (the lab does this).</p>' },
    { h: 'Tools with guardrails', body: '<p>Order status and invoice lookups are read tools scoped to the ticket’s customer (identity from the helpdesk, not from the text). Write actions (refunds, cancellations) require policy checks and usually agent approval (5.x, 8.x).</p>' }
  ],
  analogy: `<p><b>Air traffic control automation.</b> Routine handoffs are automated, unusual situations always reach a human controller, and the system’s authority grows only where it has been proven safe with data.</p>`,
  diagram: {
    title: 'Support copilot architecture',
    cols: [['ch'], ['ing'], ['cls'], ['ret', 'tools'], ['draft'], ['guard'], ['auto', 'agent']],
    nodes: [
      { id: 'ch', label: 'Channels', sub: 'email · chat · forms', tone: 'fde', info: 'Through the helpdesk platform.' },
      { id: 'ing', label: 'Ticket intake', sub: 'tenant · customer id · PII tags', tone: 'acc', info: 'Identity from the helpdesk, not the text.' },
      { id: 'cls', label: 'Intent + risk', sub: 'classifier', tone: 'acc', info: 'Cheap model or fine-tuned classifier; risk rules.' },
      { id: 'ret', label: 'Retrieval', sub: 'KB · macros · solved tickets', tone: 'be', info: 'Per-tenant filters, hybrid + rerank.' },
      { id: 'tools', label: 'Account tools', sub: 'orders · billing (read)', tone: 'be', info: 'Scoped to the ticket’s customer.' },
      { id: 'draft', label: 'Draft reply', sub: 'cited · tenant tone', tone: 'warn', info: 'Prompt and policy per tenant from config.' },
      { id: 'guard', label: 'Checks', sub: 'grounded · PII · policy', tone: 'bad', info: 'Groundedness, PII, refund limits.' },
      { id: 'auto', label: 'Auto-reply', sub: 'approved intents only', tone: 'ok', info: 'Calibrated threshold per intent; audited.' },
      { id: 'agent', label: 'Agent suggestion', sub: 'edit · accept · reject', tone: 'ok', info: 'Edits feed evals and KB gaps.' }
    ],
    edges: [{ a: 'ch', b: 'ing' }, { a: 'ing', b: 'cls' }, { a: 'cls', b: 'ret' }, { a: 'cls', b: 'tools' }, { a: 'ret', b: 'draft' }, { a: 'tools', b: 'draft' }, { a: 'draft', b: 'guard' }, { a: 'guard', b: 'auto', label: 'high conf' }, { a: 'guard', b: 'agent' }],
    caption: 'Autonomy per intent, earned with calibrated confidence and audits.'
  },
  illustrated: { title: 'Automation ladder by intent', body: `<div class="tbl"><table><thead><tr><th>intent</th><th>volume</th><th>mode</th><th>why</th></tr></thead><tbody>
    <tr><td>order status</td><td class="n">31%</td><td>auto-reply</td><td>tool answer is exact; precision 99.4% audited</td></tr>
    <tr><td>how-to</td><td class="n">24%</td><td>auto above threshold, else suggest</td><td>KB coverage varies</td></tr>
    <tr><td>billing dispute</td><td class="n">12%</td><td>suggest</td><td>needs judgement</td></tr>
    <tr><td>refund request</td><td class="n">9%</td><td>suggest; refund needs approval</td><td>money movement</td></tr>
    <tr><td>legal, threats, security</td><td class="n">1%</td><td>human only</td><td>risk</td></tr></tbody></table></div>` },
  code: {
    title: 'A miniature copilot pipeline with routing and metrics', file: 'copilot.py', browser: true,
    intro: '<p>An end-to-end sketch on synthetic tickets: intent classification (keyword stand-in), BM25 retrieval over a tenant-filtered KB with NumPy, a read tool for order status, a templated draft (standing in for the model), PII and grounding checks, and routing to auto-reply, suggestion or human. It reports automation rate and audited precision by intent. Each stand-in marks where the real component goes.</p>',
    src: String.raw`import math, random, re
from collections import Counter
random.seed(4)

KB = [("acme", "kb-1", "Reset your password from Settings > Security > Reset password. Links expire after 30 minutes."),
      ("acme", "kb-2", "Invoices are available under Billing > Invoices and can be downloaded as PDF."),
      ("acme", "kb-3", "Refunds above $200 require approval from the billing team."),
      ("globex", "kb-9", "Globex customers reset passwords via the SSO portal only.")]
ORDERS = {"A-1001": "shipped on 21 Oct, arriving 24 Oct", "A-1002": "processing, ships within 2 days"}
INTENTS = {"order_status": ["order", "where", "shipped", "tracking"], "password": ["password", "reset", "login"],
           "invoice": ["invoice", "receipt", "pdf"], "refund": ["refund", "money back"], "legal": ["lawyer", "legal", "sue"]}
POLICY = {"order_status": "auto", "password": "auto_if_confident", "invoice": "auto_if_confident", "refund": "suggest", "legal": "human"}

def classify(text):
    scores = {i: sum(w in text.lower() for w in ws) for i, ws in INTENTS.items()}
    best = max(scores, key=scores.get)
    return (best, scores[best] / (sum(scores.values()) or 1)) if scores[best] else ("other", 0.0)

def bm25(query, tenant, k1=1.4, b=0.75):
    docs = [(i, t) for ten, i, t in KB if ten == tenant]                 # tenant isolation at the filter
    toks = [re.findall(r"\w+", t.lower()) for _, t in docs]
    avg = sum(map(len, toks)) / len(toks); q = re.findall(r"\w+", query.lower())
    df = Counter(w for d in toks for w in set(d))
    def score(d):
        tf = Counter(d)
        return sum(math.log(1 + (len(toks) - df[w] + .5) / (df[w] + .5)) * tf[w] * (k1 + 1) / (tf[w] + k1 * (1 - b + b * len(d) / avg)) for w in q if w in tf)
    ranked = sorted(((score(d), docs[i]) for i, d in enumerate(toks)), reverse=True)
    return ranked[0] if ranked and ranked[0][0] > 0 else (0, None)

def handle(ticket):
    intent, p = classify(ticket["text"])
    if POLICY.get(intent) == "human" or intent == "other":
        return "human", None, intent
    if intent == "order_status":
        m = re.search(r"A-\d{4}", ticket["text"])
        if not m or m.group() not in ORDERS: return "suggest", "Could you share your order number?", intent
        return "auto", f"Your order {m.group()} is {ORDERS[m.group()]}.", intent
    score, doc = bm25(ticket["text"], ticket["tenant"])
    if doc is None: return "suggest", None, intent
    draft = f"{doc[1]} [{doc[0]}]"
    if re.search(r"\b\d{12,19}\b", draft): return "suggest", draft, intent               # PII check
    conf = min(1.0, p * 0.6 + min(score, 4) / 10)                                          # combined, would be calibrated
    mode = "auto" if POLICY[intent] == "auto_if_confident" and conf >= 0.75 else "suggest"
    return mode, draft, intent

TEMPL = [("acme", "Where is my order A-1001?", "order_status"), ("acme", "I cannot login, how do I reset my password?", "password"),
         ("acme", "Need the invoice pdf for September", "invoice"), ("acme", "I want a refund of $350", "refund"),
         ("acme", "My lawyer will contact you", "legal"), ("globex", "How do I reset my password?", "password"),
         ("acme", "Order status for A-1002 please, not shipped yet?", "order_status"), ("acme", "Your product is great", "other")]
tickets = [dict(zip(["tenant", "text", "truth"], random.choice(TEMPL))) for _ in range(400)]
outcomes = Counter(); correct = Counter()
for t in tickets:
    mode, draft, intent = handle(t)
    outcomes[mode] += 1
    if mode == "auto":
        correct["auto"] += intent == t["truth"] and (t["tenant"] != "globex" or "SSO" in (draft or ""))
print("routing:", dict(outcomes), f"| automation rate {outcomes['auto'] / len(tickets):.0%}")
print(f"audited auto-reply precision: {correct['auto'] / outcomes['auto']:.1%}")
for tenant, text, _ in TEMPL[:6]:
    print(f"  [{tenant}] {text[:44]:<44} -> {handle({'tenant': tenant, 'text': text})[0]}")
print("tenant isolation: globex password answer cites", handle({"tenant": "globex", "text": "How do I reset my password?"})[1])`
  },
  lab: {
    title: 'Choose per-intent thresholds for auto-reply', file: 'thresholds_lab.py', browser: true,
    scenario: `<p>You have 6,000 labelled historical tickets scored by the copilot: intent, a combined confidence score and whether the draft would have been correct (agents judged). The business wants auto-replies with ≥ 98% precision per intent, using a lower confidence bound so small samples do not fool you. Find the threshold per intent that maximises automation under that constraint, report overall deflection, and estimate monthly savings.</p>`,
    steps: ['Generate data: per intent, a volume share and a relation between confidence and correctness (given).', 'For each intent, scan thresholds; precision of tickets above threshold, with a Wilson 95% lower bound.', 'Choose the lowest threshold whose lower bound ≥ 0.98 and with at least 50 tickets above it; else no auto-reply for that intent.', 'Report automation per intent and overall.', 'Savings: auto-replied tickets × minutes per ticket × cost per minute, minus audit cost for a 5% sample.'],
    checks: ['Precision lower bounds meet 98% for every auto intent.', 'Intents that cannot meet the bar get no auto-reply.', 'Savings include audit costs.'],
    hints: ['Wilson lower bound: (p + z²/2n − z√(p(1−p)/n + z²/4n²)) / (1 + z²/n).', 'Report thresholds so they can live in config (10.1).'],
    starter: String.raw`import math, random
random.seed(8)
INTENTS = {"order_status": (0.31, 0.9), "password": (0.18, 0.7), "how_to": (0.24, 0.55), "billing": (0.12, 0.4), "refund": (0.09, 0.3), "other": (0.06, 0.2)}
# intent: (share, quality) ; quality shifts how often confident drafts are correct
data = []
for _ in range(6000):
    intent = random.choices(list(INTENTS), weights=[s for s, _ in INTENTS.values()])[0]
    q = INTENTS[intent][1]
    conf = random.betavariate(2 + 6 * q, 2)
    correct = random.random() < 1 - (1 - conf) ** (1 + 3 * q)
    data.append((intent, conf, correct))
MIN_PER_TICKET, COST_PER_MIN, MONTHLY_TICKETS = 6.5, 0.9, 120_000
# TODO`,
    solution: String.raw`import math, random
random.seed(8)
INTENTS = {"order_status": (0.31, 0.9), "password": (0.18, 0.7), "how_to": (0.24, 0.55), "billing": (0.12, 0.4), "refund": (0.09, 0.3), "other": (0.06, 0.2)}
data = []
for _ in range(6000):
    intent = random.choices(list(INTENTS), weights=[s for s, _ in INTENTS.values()])[0]
    q = INTENTS[intent][1]
    conf = random.betavariate(2 + 6 * q, 2)
    correct = random.random() < 1 - (1 - conf) ** (1 + 3 * q)
    data.append((intent, conf, correct))
MIN_PER_TICKET, COST_PER_MIN, MONTHLY_TICKETS = 6.5, 0.9, 120_000

def wilson_lower(k, n, z=1.96):
    if n == 0: return 0.0
    p = k / n
    return (p + z * z / (2 * n) - z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n)

chosen, auto_total = {}, 0
for intent in INTENTS:
    rows = [(c, ok) for i, c, ok in data if i == intent]
    best = None
    for t in [x / 100 for x in range(50, 100)]:
        above = [ok for c, ok in rows if c >= t]
        if len(above) >= 50 and wilson_lower(sum(above), len(above)) >= 0.98:
            best = (t, len(above), sum(above) / len(above), wilson_lower(sum(above), len(above))); break
    chosen[intent] = best
    if best:
        auto_total += best[1]
        print(f"{intent:<13} threshold {best[0]:.2f} | auto {best[1] / len(rows):5.1%} of intent | precision {best[2]:.1%} (lower bound {best[3]:.1%})")
    else:
        print(f"{intent:<13} no threshold meets the bar -> suggest only")
rate = auto_total / len(data)
auto_month = rate * MONTHLY_TICKETS
saving = auto_month * MIN_PER_TICKET * COST_PER_MIN
audit = auto_month * 0.05 * 3 * COST_PER_MIN                       # 5% sample, 3 minutes to audit each
print(f"\noverall auto-reply rate {rate:.1%} -> {auto_month:,.0f} tickets/month; savings ${'$'}{saving:,.0f} - audit ${'$'}{audit:,.0f} = ${'$'}{saving - audit:,.0f}/month")
print("config:", {k: (round(v[0], 2) if v else None) for k, v in chosen.items()})`
  },
  design: {
    lead: '<p>The support copilot design balances automation against trust. The core mechanisms: per-tenant isolation, intent-level autonomy with calibrated thresholds, scoped tools, a learning loop from agent edits, and metrics tied to business outcomes.</p>',
    scale: [{ h: 'Hundreds of tenants', p: 'Shared infrastructure with tenant-scoped indexes or filters, per-tenant config (prompts, policies, thresholds), per-tenant quotas and cost tracking (9.10).' }, { h: 'Peaks', p: 'Incidents at a tenant create ticket floods with the same intent; semantic caching (9.2) and macros absorb them cheaply.' }],
    fail: [{ h: 'Cross-tenant leakage', p: 'A retrieval filter bug can expose one customer’s data to another. Enforce tenancy at the data layer, test with canary documents, and alert on violations.' }, { h: 'Confident wrong auto-replies', p: 'Audit samples continuously; automatic rollback of an intent to suggest-only when audited precision drops (10.7).' }],
    trade: [{ h: 'Deflection vs CSAT', p: 'Aggressive automation raises deflection and can hurt satisfaction and reopen rates. Track both and tune thresholds per intent.' }, { h: 'Shared vs per-tenant indexes', p: 'Shared indexes with filters are cheaper; per-tenant indexes give stronger isolation and simpler deletion.' }],
    prompt: '<p>Design an AI copilot for a SaaS helpdesk with 300 customer tenants and 2 million tickets per month.</p>',
    answer: '<ul><li>Requirements and numbers: channels, latency per channel, quality bar (acceptance, audited precision ≥ 98% for auto), isolation, budget per ticket.</li><li>Pipeline: intake with tenant and customer identity → intent and risk → hybrid retrieval over tenant KB, macros, solved tickets → scoped read tools → cited draft → checks → auto, suggest or human per calibrated per-intent thresholds.</li><li>Learning loop: edits and outcomes into evals and KB gap reports; release gates per tenant.</li><li>Ops: caching, model routing, per-tenant budgets, audits, rollback of autonomy, isolation tests.</li></ul>'
  },
  quiz: [
    { q: 'Where should the customer identity for account tools come from?', o: ['The ticket text', 'The helpdesk’s authenticated ticket metadata', 'The model', 'A guess'], a: 1, why: 'Text can be spoofed or injected.' },
    { q: 'Why use a lower confidence bound for precision?', o: ['To be pessimistic for fun', 'Small samples can show high precision by chance', 'It is faster', 'Regulations'], a: 1, why: 'Bounds protect against noise.' },
    { q: 'Which intent should never be auto-replied?', o: ['Order status', 'Password reset', 'Legal threats', 'Invoice download'], a: 2, why: 'High risk routes to humans.' }
  ],
  interview: [
    { q: 'Design a support copilot. How do you decide what can be automated?', a: '<p>Per intent, using labelled historical data: combine signals into a calibrated confidence, choose thresholds whose precision lower bound meets the business target, start with suggestions, enable auto-reply for intents that pass, audit samples continuously, and roll back an intent to suggestions automatically if audited precision drops.</p>' },
    { q: 'How do you measure success for a support copilot?', a: '<p>Business: handle time, first response time, deflection, CSAT and reopen rate. Product: suggestion acceptance and edit distance, auto-reply audited precision. System: latency, cost per ticket, guardrail blocks. Compare against a baseline or control group.</p>' }
  ]
});

/* ===================================================================== 12.3 */
L({
  id: '12.3', title: 'Coding assistant', minutes: 60, roles: ['be'],
  tags: 'repository context · symbol and dependency graphs · code retrieval · edit formats · sandboxed execution · tests as verifiers · pass@k · agentic loops',
  mental: 'A coding assistant’s quality comes mostly from context and verification: finding the right code to show the model, asking for edits in a format that applies cleanly, and checking every change by running tests in a sandbox before a human sees it.',
  intro: `<p>Coding assistants range from inline completion (latency-critical, small context) to agents that take an issue, explore the repository, edit several files, run tests and open a pull request (Claude Code and similar tools). The design questions: how to select context from a large repository, how to represent edits, how to execute code safely, how to verify, and how to evaluate (SWE-bench-style task suites, pass@k).</p>`,
  points: [
    'Context: repository map (files, symbols, imports), retrieval by symbols and text, recently edited files, and the open file; pack into a token budget by relevance.',
    'Edits: search-and-replace blocks or unified diffs with exact anchors; validate they apply before running anything.',
    'Execution: isolated sandboxes (containers or microVMs) with no secrets, limited network, CPU and time limits.',
    'Verification: run existing tests, linters and type checks; generate and run new tests; iterate on failures.',
    'Metrics: pass@1 and pass@k on task suites, acceptance rate of suggestions, time to merged PR, regressions.',
    'Latency tiers: completion in ~100s of ms (small model, local context); chat and agents in seconds to minutes.'
  ],
  concept: { title: 'A new engineer joining a large codebase', body: `<p>A good new engineer does not read every file. They look at the directory structure, follow imports from the code they need to change, read the tests, make a small change, run the tests, and only then ask for review. A coding assistant should work the same way, and the system should make that cheap and safe.</p>` },
  walk: [
    { h: 'Repository map', body: '<p>Parse files into symbols (functions, classes) and their references; rank by relevance to the task (mentions in the issue, call graph distance, recency). Tools like ctags, tree-sitter or Python’s <code class="i">ast</code> do the parsing. The Code tab builds a small map with <code class="i">ast</code>.</p>' },
    { h: 'Edit formats', body: '<p>Whole-file rewrites waste tokens and break large files; free-form diffs often fail to apply. Search-and-replace blocks with unique anchors (as many agents use) or unified diffs with context are reliable when validated.</p>', code: String.raw`<<<<<<< SEARCH
def total(items):
    return sum(i.price for i in items)
=======
def total(items, discount=0.0):
    return round(sum(i.price for i in items) * (1 - discount), 2)
>>>>>>> REPLACE` },
    { h: 'Verify in a sandbox', body: '<p>Every candidate change runs in a fresh, network-restricted sandbox: apply edit, run tests, collect output. Failures go back to the model with the error. Sampling several candidates and picking one that passes tests raises success (pass@k), at proportional cost.</p>' }
  ],
  analogy: `<p><b>A surgeon with imaging and a checklist.</b> Scans show exactly where to operate (context selection), instruments are precise (edit formats), the operating room is sterile and separate (sandbox), and vitals are checked before closing (tests).</p>`,
  diagram: {
    title: 'Coding agent loop',
    cols: [['task'], ['map'], ['ctx'], ['llm'], ['edit'], ['sb'], ['pr']],
    nodes: [
      { id: 'task', label: 'Issue / request', sub: 'text · failing test', tone: 'fde', info: 'What to change and how to know it works.' },
      { id: 'map', label: 'Repo map', sub: 'symbols · imports · tests', tone: 'acc', info: 'Built incrementally; cached per commit.' },
      { id: 'ctx', label: 'Context packer', sub: 'rank · token budget', tone: 'acc', info: 'Most relevant code within budget.' },
      { id: 'llm', label: 'Model', sub: 'plan · edits', tone: 'warn', info: 'Search/replace blocks or diffs.' },
      { id: 'edit', label: 'Apply edits', sub: 'validate anchors', tone: 'be', info: 'Reject edits that do not apply cleanly.' },
      { id: 'sb', label: 'Sandbox', sub: 'tests · lint · types', tone: 'bad', info: 'Isolated, no secrets, time-limited.' },
      { id: 'pr', label: 'Pull request', sub: 'human review', tone: 'ok', info: 'Diff, test results, explanation.' }
    ],
    edges: [{ a: 'task', b: 'map' }, { a: 'map', b: 'ctx' }, { a: 'ctx', b: 'llm' }, { a: 'llm', b: 'edit' }, { a: 'edit', b: 'sb' }, { a: 'sb', b: 'pr', label: 'pass' }, { a: 'sb', b: 'llm', dash: true, bend: 60, label: 'errors' }],
    caption: 'Select context, edit precisely, verify in a sandbox, iterate, then hand to a human.'
  },
  illustrated: { title: 'Products and their constraints', body: `<div class="tbl"><table><thead><tr><th>mode</th><th>latency</th><th>context</th><th>verification</th></tr></thead><tbody>
    <tr><td>inline completion</td><td>~100–300 ms</td><td>open file, nearby files</td><td>user accepts or not</td></tr>
    <tr><td>chat about code</td><td>seconds</td><td>retrieved symbols and files</td><td>user runs it</td></tr>
    <tr><td>agent: issue to PR</td><td>minutes</td><td>explores repo with tools</td><td>tests in sandbox, then review</td></tr>
    <tr><td>batch migrations</td><td>hours</td><td>per-file plus conventions</td><td>full CI per change</td></tr></tbody></table></div>` },
  code: {
    title: 'A repository map with ast and a token-budgeted context packer', file: 'repo_map.py', browser: true,
    intro: '<p>Parses a small in-memory repository with Python’s <code class="i">ast</code> into symbols, imports and call references; ranks files for a task by symbol mentions, call-graph proximity and test coverage; and packs the most relevant snippets into a token budget, preferring signatures over full bodies for distant files.</p>',
    src: String.raw`import ast, re
from collections import defaultdict

REPO = {
"shop/models.py": '''from dataclasses import dataclass
@dataclass
class Item:
    sku: str
    price: float
    qty: int = 1
''',
"shop/cart.py": '''from shop.models import Item
from shop.pricing import apply_discount
def total(items: list[Item]) -> float:
    """Sum of price * qty."""
    return sum(i.price * i.qty for i in items)
def checkout(items, code=None):
    amount = total(items)
    return apply_discount(amount, code)
''',
"shop/pricing.py": '''CODES = {"WELCOME10": 0.10, "VIP25": 0.25}
def apply_discount(amount: float, code: str | None) -> float:
    rate = CODES.get(code, 0.0)
    return amount * (1 - rate)
''',
"shop/emails.py": '''def receipt(order_id, amount):
    return f"Order {order_id}: {amount:.2f} EUR"
''',
"tests/test_cart.py": '''from shop.cart import checkout, total
from shop.models import Item
def test_total():
    assert total([Item("a", 2.0, 3)]) == 6.0
def test_checkout_discount():
    assert checkout([Item("a", 10.0)], "WELCOME10") == 9.0
''',
}

defs, refs, imports = {}, defaultdict(set), defaultdict(set)
for path, src in REPO.items():
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            sig = src.splitlines()[node.lineno - 1].strip()
            defs[node.name] = (path, sig, ast.get_source_segment(src, node))
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            refs[path].add(node.func.id)
        elif isinstance(node, ast.ImportFrom):
            imports[path].add(node.module.replace(".", "/") + ".py")
print("symbols:", {k: v[0] for k, v in defs.items()})

def rank(task):
    words = set(re.findall(r"[a-z_]+", task.lower()))
    mentioned = {s for s in defs if s.lower() in words}
    score = defaultdict(float)
    for s in mentioned:
        score[defs[s][0]] += 3
    for path in REPO:
        callees = refs[path] & set(defs)
        score[path] += sum(1.5 for c in callees if c in mentioned)          # calls a mentioned symbol
        score[path] += sum(1.0 for imp in imports[path] if score.get(imp, 0) >= 3)
        if path.startswith("tests/") and refs[path] & mentioned: score[path] += 2   # tests that exercise it
    return sorted(((round(v, 1), p) for p, v in score.items() if v > 0), reverse=True)

def pack(task, budget_tokens=220):
    out, used = [], 0
    for i, (s, path) in enumerate(rank(task)):
        full = REPO[path]; sigs = "\n".join(d[1] for d in defs.values() if d[0] == path)
        text = full if i < 2 else sigs                                        # top files in full, others as signatures
        cost = len(text) // 4
        if used + cost > budget_tokens:
            text, cost = sigs, len(sigs) // 4
            if used + cost > budget_tokens: continue
        out.append((path, s, "full" if text == full else "signatures", cost)); used += cost
    return out, used

task = "Discount codes should be case-insensitive in apply_discount and checkout should round to 2 decimals"
print("ranking:", rank(task))
packed, used = pack(task)
for p in packed: print("  include", p)
print(f"context tokens used: {used} (emails.py left out: unrelated)")`
  },
  lab: {
    title: 'Verify candidate patches and estimate pass@k', file: 'passk_lab.py', browser: true,
    scenario: `<p>For a task (“make discount codes case-insensitive and round to 2 decimals”), a model produced 8 candidate implementations as search-and-replace edits (given). Build the verification harness: apply each edit to the file (rejecting edits whose search block is not found exactly once), execute the module in an isolated namespace, run the hidden tests, and record pass or fail with the error. Then compute pass@1, pass@3 and pass@8 with the unbiased estimator, and explain what that means for sampling strategy and cost.</p>`,
    steps: ['Implement <code class="i">apply(src, search, replace)</code> with an exactly-once check.', 'Run each candidate in a fresh dict namespace; catch exceptions; run the tests as functions.', 'Record status: applied/not applied, passed/failed with the first error.', 'Unbiased pass@k = 1 − C(n−c, k)/C(n, k) for n samples with c correct.', 'Print results and a recommendation: how many samples per task to request.'],
    checks: ['Edits with missing anchors are rejected before execution.', 'pass@k increases with k as expected.', 'The recommendation weighs success against cost.'],
    hints: ['Real systems run this in a container sandbox; exec in a namespace is only for the lab.', '<code class="i">math.comb</code> computes binomial coefficients.'],
    starter: String.raw`import math
ORIGINAL = '''CODES = {"WELCOME10": 0.10, "VIP25": 0.25}
def apply_discount(amount, code):
    rate = CODES.get(code, 0.0)
    return amount * (1 - rate)
'''
SEARCH = '''    rate = CODES.get(code, 0.0)
    return amount * (1 - rate)'''
CANDIDATES = [
    '''    rate = CODES.get((code or "").upper(), 0.0)
    return round(amount * (1 - rate), 2)''',
    '''    rate = CODES.get(code.upper(), 0.0)
    return round(amount * (1 - rate), 2)''',
    '''    rate = CODES.get(code.lower(), 0.0)
    return round(amount * (1 - rate), 2)''',
    '''    rate = CODES.get((code or "").upper(), 0.0)
    return amount * (1 - rate)''',
    '''    rate = CODES.get(str(code).upper(), 0)
    return round(amount - amount * rate, 2)''',
    '''    rate = CODES.get((code or "").strip().upper(), 0.0)
    return round(amount * (1 - rate), 2)''',
    '''    rate = CODES.get(code, 0.0)
    return round(amount * (1 - rate), 2)''',
    '''    rate = CODES[(code or "").upper()]
    return round(amount * (1 - rate), 2)''',
]
def tests(ns):
    f = ns["apply_discount"]
    assert f(100, "welcome10") == 90.0
    assert f(19.99, "VIP25") == 14.99
    assert f(50, None) == 50.0
    assert f(50, "unknown") == 50.0
# TODO: apply, run, pass@k`,
    solution: String.raw`import math
ORIGINAL = '''CODES = {"WELCOME10": 0.10, "VIP25": 0.25}
def apply_discount(amount, code):
    rate = CODES.get(code, 0.0)
    return amount * (1 - rate)
'''
SEARCH = '''    rate = CODES.get(code, 0.0)
    return amount * (1 - rate)'''
CANDIDATES = [
    '''    rate = CODES.get((code or "").upper(), 0.0)
    return round(amount * (1 - rate), 2)''',
    '''    rate = CODES.get(code.upper(), 0.0)
    return round(amount * (1 - rate), 2)''',
    '''    rate = CODES.get(code.lower(), 0.0)
    return round(amount * (1 - rate), 2)''',
    '''    rate = CODES.get((code or "").upper(), 0.0)
    return amount * (1 - rate)''',
    '''    rate = CODES.get(str(code).upper(), 0)
    return round(amount - amount * rate, 2)''',
    '''    rate = CODES.get((code or "").strip().upper(), 0.0)
    return round(amount * (1 - rate), 2)''',
    '''    rate = CODES.get(code, 0.0)
    return round(amount * (1 - rate), 2)''',
    '''    rate = CODES[(code or "").upper()]
    return round(amount * (1 - rate), 2)''',
]
def tests(ns):
    f = ns["apply_discount"]
    assert f(100, "welcome10") == 90.0
    assert f(19.99, "VIP25") == 14.99
    assert f(50, None) == 50.0
    assert f(50, "unknown") == 50.0

def apply(src, search, replace):
    if src.count(search) != 1:
        raise ValueError(f"search block found {src.count(search)} times")
    return src.replace(search, replace)

results = []
for i, cand in enumerate(CANDIDATES + ["    return amount"]):          # last one has a bad anchor on purpose
    search = SEARCH if i < len(CANDIDATES) else "    rate = CODES.get(code)"
    try:
        new = apply(ORIGINAL, search, cand)
    except ValueError as e:
        results.append((i, "not applied", str(e))); continue
    ns = {}
    try:
        exec(compile(new, f"candidate_{i}.py", "exec"), ns)
        tests(ns)
        results.append((i, "pass", ""))
    except AssertionError:
        results.append((i, "fail", "assertion failed"))
    except Exception as e:
        results.append((i, "fail", f"{type(e).__name__}: {e}"))
for r in results: print(f"candidate {r[0]}: {r[1]:<12} {r[2]}")

n = len(CANDIDATES); c = sum(r[1] == "pass" for r in results if r[0] < n)
pass_at = lambda k: 1 - math.comb(n - c, k) / math.comb(n, k)
print(f"\nn={n}, correct={c}: pass@1 {pass_at(1):.2f} | pass@3 {pass_at(3):.2f} | pass@8 {pass_at(8):.2f}")
print("recommendation: sample 3 candidates in parallel and return the first that passes the tests: "
      f"success rises from {pass_at(1):.0%} to {pass_at(3):.0%} for 3x generation cost; tests are cheap relative to engineer time.")`
  },
  design: {
    lead: '<p>Coding assistants succeed when the system does what good engineers do: gather the right context, make small precise changes, and prove them with tests. Model quality matters, but context selection and verification usually decide the outcome.</p>',
    scale: [{ h: 'Large monorepos', p: 'Incremental indexing per commit, symbol graphs and embeddings cached; context packing under strict budgets; prompt caching of stable repository context.' }, { h: 'Sandboxes at volume', p: 'Pools of pre-warmed containers or microVMs with dependency caches; per-task time and resource limits; cost tracking per task.' }],
    fail: [{ h: 'Unsafe execution', p: 'Generated code can delete data or exfiltrate secrets. Sandboxes without credentials, restricted network and read-only mounts are mandatory.' }, { h: 'Tests that do not test', p: 'Agents may weaken tests to pass. Protect existing tests, review diffs to tests separately, and run hidden tests in evals.' }],
    trade: [{ h: 'More samples vs better context', p: 'pass@k improves with samples at linear cost; better context improves pass@1 for every call. Do both, measure each.' }, { h: 'Autonomy vs review', p: 'Agents that open PRs save time; human review remains the control point, especially for security-sensitive code.' }],
    prompt: '<p>Design a system that turns GitHub issues into pull requests for a 2-million-line repository.</p>',
    answer: '<ul><li>Trigger on labelled issues; agent with tools (search, read file, edit, run tests) inside a sandbox built from the repo’s CI image.</li><li>Context: repository map and symbol search; tests related to touched code; conventions file (like CLAUDE.md or AGENTS.md).</li><li>Edits via search/replace blocks; tests, lint and type checks each iteration; sample several attempts for hard issues.</li><li>PR with diff, rationale and test results; human review; metrics: merge rate, time to merge, regressions; evals on a held-out set of past issues.</li></ul>'
  },
  quiz: [
    { q: 'What usually matters most for a coding assistant’s success on a repo task?', o: ['Font size', 'Context selection and verification with tests', 'Temperature 1.0', 'Longer prompts always'], a: 1, why: 'Right context plus verification.' },
    { q: 'Why validate that an edit’s search block appears exactly once?', o: ['Style', 'Ambiguous or missing anchors produce wrong or failed edits', 'Speed', 'Licensing'], a: 1, why: 'Edits must apply deterministically.' },
    { q: 'With 8 samples and 4 correct, pass@1 is:', o: ['0.25', '0.5', '0.75', '1.0'], a: 1, why: 'c/n = 4/8.' }
  ],
  interview: [
    { q: 'How would you design a coding agent’s execution environment?', a: '<p>Ephemeral sandboxes (containers or microVMs) built from the project’s CI image, with no production credentials, restricted network (package mirrors only), CPU, memory and time limits, read-write only to the workspace, full logs of commands, and automatic teardown. Results and diffs flow back; humans review before merge.</p>' },
    { q: 'How do you evaluate a coding assistant?', a: '<p>Task suites of real issues with hidden tests (SWE-bench style) measuring pass@1 and pass@k, cost and time per task; online metrics such as suggestion acceptance, PR merge rate and post-merge regressions; and safety checks that tests were not weakened.</p>' }
  ]
});
})();

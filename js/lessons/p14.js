/* Phase 14 · Interviews and portfolio */
(function () {
const L = AISA.lesson;

/* ===================================================================== 14.1 */
L({
  id: '14.1', title: 'FDE loop: coding, decomposition, case, behavioral', minutes: 60, roles: ['fde'],
  tags: 'practical coding · data wrangling · problem decomposition · customer case role-play · STAR stories · communication under ambiguity · preparation plan',
  mental: 'FDE interviews test whether you can be trusted alone with a customer: write working code quickly on messy, practical problems; turn an ambiguous business ask into a plan; handle a live customer scenario with judgement; and show, through specific stories, ownership, communication and learning. Prepare each format deliberately.',
  intro: `<p>Loops differ by company, but FDE and similar customer-facing engineering roles (forward deployed, solutions, applied AI engineers) commonly combine four kinds of interviews: a practical coding session, a decomposition or problem-solving session on an ambiguous business problem, a customer case or role-play, and behavioural interviews. Some add a take-home or a technical presentation. This lesson gives a preparation method and practice material for each; check the specific company’s published guidance and recruiter notes for its actual format.</p>`,
  points: [
    '<b>Practical coding</b>: parse, transform and aggregate realistic data; call APIs; handle edge cases; write tests; talk while you code. Correct and clear beats clever.',
    '<b>Decomposition</b>: clarify goals and constraints, map the workflow, break it into components with mechanisms, sequence by risk, define success metrics (11.1–11.3).',
    '<b>Customer case</b>: listen first, restate the problem, ask about impact and constraints, propose a pilot, handle pushback honestly, agree next steps.',
    '<b>Behavioural</b>: 8–10 STAR stories (situation, task, action, result) with numbers, covering ownership, ambiguity, conflict, failure, customer impact and influence.',
    'Show judgement about AI: when not to use an LLM, how you would evaluate, what could go wrong.',
    'Practise out loud and timed; record yourself; get feedback from someone who has interviewed.'
  ],
  concept: { title: 'An audition for a field job', body: `<p>A field medic is not hired for reciting textbooks; they are tested in realistic scenarios: assess, decide, act, communicate, under time pressure and with incomplete information. FDE interviews are auditions for the same kind of job, in software and with customers.</p>` },
  walk: [
    { h: 'Practical coding pattern', body: '<p>A typical prompt: “Here are API usage logs from a customer. Find tenants that exceeded their quota in any rolling hour and summarise their usage.” Clarify formats and edge cases, write a small correct solution, test it with your own cases, then discuss scale (streaming, partitioning). The Code tab is a worked example with tests.</p>' },
    { h: 'Decomposition script', body: '<ol><li>Restate the goal and ask 3–5 clarifying questions (users, volumes, systems, constraints, success).</li><li>Draw the current workflow.</li><li>Propose components and mechanisms; say why AI or not for each.</li><li>Identify the riskiest assumption and the first thin slice.</li><li>Define metrics and the pilot plan; mention security and change management.</li></ol>' },
    { h: 'Customer role-play moves', body: '<p>When the interviewer plays a frustrated or sceptical customer: acknowledge, ask what outcome matters, separate facts from feelings, offer options with trade-offs, commit to specific next steps and dates. Never promise what you cannot verify (model capabilities, timelines); say how you would find out.</p>' }
  ],
  analogy: `<p><b>A driving test.</b> Examiners do not care about trivia; they watch whether you check mirrors (clarify), signal (communicate), handle the unexpected calmly (ambiguity), and arrive safely (working result). Practise the routine until it is automatic, then the test feels like driving.</p>`,
  diagram: {
    title: 'A typical FDE loop and what each round tests',
    cols: [['screen'], ['code', 'decomp'], ['case', 'beh'], ['decision']],
    nodes: [
      { id: 'screen', label: 'Recruiter / HM screen', sub: 'motivation · fit', tone: 'fde', info: 'Why this role; customer-facing experience.' },
      { id: 'code', label: 'Practical coding', sub: 'data · APIs · tests', tone: 'acc', info: 'Working code on realistic problems.' },
      { id: 'decomp', label: 'Decomposition', sub: 'ambiguous business ask', tone: 'be', info: 'Structure, judgement, prioritisation.' },
      { id: 'case', label: 'Customer case', sub: 'role-play', tone: 'warn', info: 'Listening, trust, handling pushback.' },
      { id: 'beh', label: 'Behavioural', sub: 'STAR stories', tone: 'warn', info: 'Ownership, ambiguity, impact.' },
      { id: 'decision', label: 'Debrief', sub: 'signals per round', tone: 'ok', info: 'Consistent strengths across rounds.' }
    ],
    edges: [{ a: 'screen', b: 'code' }, { a: 'screen', b: 'decomp' }, { a: 'code', b: 'case' }, { a: 'decomp', b: 'beh' }, { a: 'case', b: 'decision' }, { a: 'beh', b: 'decision' }],
    caption: 'Formats vary by company; the signals are consistent.'
  },
  illustrated: { title: 'A four-week preparation plan', body: `<div class="tbl"><table><thead><tr><th>week</th><th>focus</th><th>practice</th></tr></thead><tbody>
    <tr><td>1</td><td>practical coding</td><td>10 timed data/API problems (45 min each), tests included</td></tr>
    <tr><td>2</td><td>decomposition and cases</td><td>6 ambiguous asks out loud; 3 role-plays with a friend</td></tr>
    <tr><td>3</td><td>behavioural</td><td>write 10 STAR stories with numbers; rehearse 2-minute versions</td></tr>
    <tr><td>4</td><td>mocks and polish</td><td>2 full mock loops; review recordings; refine portfolio talking points (14.3)</td></tr></tbody></table></div>` },
  code: {
    title: 'Worked practical-coding problem: rolling-hour quota breaches, with tests', file: 'quota_breaches.py', browser: true,
    intro: '<p>A realistic FDE coding task solved the way you would in an interview: parse messy log lines (bad rows, mixed timestamp formats), compute per-tenant token usage in any rolling 60-minute window with a two-pointer sweep, report breaches with the peak window, and test edge cases. Comments mark what to say out loud.</p>',
    src: String.raw`from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

LOGS = """ts,tenant,tokens
2026-10-20T09:00:05Z,acme,40000
2026-10-20T09:20:00Z,acme,35000
2026-10-20 09:59:59+00:00,acme,30000
2026-10-20T10:00:06Z,acme,1000
2026-10-20T09:10:00Z,globex,90000
2026-10-20T10:15:00Z,globex,20000
not-a-date,globex,500
2026-10-20T11:00:00Z,initech,-5
2026-10-20T11:30:00Z,initech,60000
2026-10-20T12:29:59Z,initech,45000
"""
QUOTA = {"acme": 100_000, "globex": 100_000, "initech": 100_000}

def parse(text):
    # say: "I'll skip and count bad rows rather than crash; in production I'd log them."
    rows, bad = [], 0
    for line in text.strip().splitlines()[1:]:
        try:
            ts, tenant, tok = line.split(",")
            t = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(timezone.utc)
            tok = int(tok)
            if tok < 0: raise ValueError("negative tokens")
            rows.append((t, tenant, tok))
        except ValueError:
            bad += 1
    return sorted(rows), bad

def breaches(rows, quota, window=timedelta(hours=1)):
    # say: "Per tenant, a sliding window with a deque: O(n) after sorting."
    by = defaultdict(list)
    for t, tenant, tok in rows: by[tenant].append((t, tok))
    out = {}
    for tenant, events in by.items():
        q, total, peak = deque(), 0, (0, None, None)
        for t, tok in events:
            q.append((t, tok)); total += tok
            while t - q[0][0] >= window:            # window is [t - 1h, t], exclusive of exactly 1h old
                total -= q.popleft()[1]
            if total > peak[0]: peak = (total, q[0][0], t)
        if peak[0] > quota.get(tenant, float("inf")):
            out[tenant] = peak
    return out

rows, bad = parse(LOGS)
result = breaches(rows, QUOTA)
print(f"parsed {len(rows)} rows, skipped {bad} bad rows")
for tenant, (total, start, end) in sorted(result.items()):
    print(f"BREACH {tenant}: {total:,} tokens between {start:%H:%M:%S} and {end:%H:%M:%S} (quota {QUOTA[tenant]:,})")

# tests: say "let me check the edge cases I mentioned"
assert "acme" in result and result["acme"][0] == 105_000                  # 09:00:05..09:59:59
assert "globex" not in result                                              # 90k then 20k more than an hour later
assert result["initech"][0] == 105_000                                     # 11:30 + 12:29:59, negative row skipped
assert breaches([(datetime(2026, 1, 1, 9, tzinfo=timezone.utc), "x", 60_000), (datetime(2026, 1, 1, 10, tzinfo=timezone.utc), "x", 60_000)], {"x": 100_000}) == {}
print("all tests pass | scale discussion: stream per tenant partition, same deque logic, state in Redis or Flink for many tenants")`
  },
  lab: {
    title: 'Build and audit your STAR story bank', file: 'star_lab.py', browser: true,
    scenario: `<p>Behavioural rounds probe a set of competencies with follow-up questions. Encode your stories as structured data (situation, task, actions, result, metrics, competencies, year). Write an auditor that checks each story for the common weaknesses (no number in the result, “we” instead of “I” in actions, situation longer than actions, stories older than five years) and checks coverage of the competencies FDE loops commonly probe, then prints the gaps to fill. Replace the sample stories with your own.</p>`,
    steps: ['Define a list of competencies (customer obsession, ownership, ambiguity, conflict, failure and learning, influence without authority, technical depth, speed with quality).', 'Write at least five sample stories as dicts.', 'Checks per story: metric in result; first-person actions; action length ≥ situation length; recency.', 'Coverage: each competency covered by at least two stories (follow-ups ask for another example).', 'Print a report with fixes and missing competencies.'],
    checks: ['Each weakness is detected on the sample stories.', 'Coverage gaps are listed.', 'The report suggests concrete fixes.'],
    hints: ['A number can be time, money, percentage or count; “improved a lot” is not a result.', 'Interviewers ask “what did you do?”: actions should be yours, specific and the longest part.'],
    starter: String.raw`import re
COMPETENCIES = ["customer obsession", "ownership", "ambiguity", "conflict", "failure and learning", "influence", "technical depth", "speed with quality"]
STORIES = [
  {"title": "Rescued a stalled pilot", "year": 2025, "competencies": ["ownership", "customer obsession"],
   "situation": "A bank pilot had stalled for six weeks because SSO and data access were blocked and the sponsor was losing patience.",
   "task": "Get the pilot live before the steering committee in three weeks.",
   "actions": "I mapped every blocker with an owner, met the IT lead daily, built a temporary read-only export so we could evaluate in parallel, and sent the sponsor a two-line status every Friday.",
   "result": "Pilot went live in 16 days; handling time fell 27% and the bank expanded to two more teams."},
  # TODO: add more, including some weak ones to test the auditor
]
# TODO: audit and coverage report`,
    solution: String.raw`import re
COMPETENCIES = ["customer obsession", "ownership", "ambiguity", "conflict", "failure and learning", "influence", "technical depth", "speed with quality"]
STORIES = [
  {"title": "Rescued a stalled pilot", "year": 2025, "competencies": ["ownership", "customer obsession"],
   "situation": "A bank pilot had stalled for six weeks because SSO and data access were blocked and the sponsor was losing patience.",
   "task": "Get the pilot live before the steering committee in three weeks.",
   "actions": "I mapped every blocker with an owner, met the IT lead daily, built a temporary read-only export so we could evaluate in parallel, and sent the sponsor a two-line status every Friday.",
   "result": "Pilot went live in 16 days; handling time fell 27% and the bank expanded to two more teams."},
  {"title": "Pushed back on fine-tuning", "year": 2026, "competencies": ["influence", "customer obsession", "technical depth"],
   "situation": "The CTO wanted to fine-tune a model on ten years of tickets.",
   "task": "Find the approach that would actually reduce escalations.",
   "actions": "I ran error analysis on 300 failed answers, showed that 70% were missing or stale knowledge, prototyped retrieval over the knowledge base in two days, and presented both options with costs.",
   "result": "They chose retrieval; escalations dropped 31% in six weeks and the fine-tuning budget funded a second use case."},
  {"title": "Outage during a demo", "year": 2024, "competencies": ["failure and learning"],
   "situation": "During an executive demo our provider rate-limited us and the assistant stopped responding, in front of the customer's COO and three of their directors, which was very embarrassing for everyone involved in the project.",
   "task": "Recover the demo.",
   "actions": "We switched to slides.",
   "result": "The customer was understanding and we learned a lot."},
  {"title": "Disagreement on scope", "year": 2019, "competencies": ["conflict"],
   "situation": "A product manager wanted five features in the pilot.",
   "task": "Agree a realistic scope.",
   "actions": "We discussed it and I showed a forecast with confidence levels for each option, then we agreed on two features with the others as phase two.",
   "result": "Delivered on time."},
  {"title": "Ambiguous analytics ask", "year": 2026, "competencies": ["ambiguity", "speed with quality"],
   "situation": "A retailer asked for 'an AI analyst'.",
   "task": "Define something useful in two weeks.",
   "actions": "I interviewed six analysts, found metric definitions disagreed across teams, built a small semantic layer for the top 20 metrics and natural-language queries on top, and set up an eval of 120 real questions.",
   "result": "Answered 84% of the eval questions correctly; weekly report preparation fell from 2 days to 3 hours."},
]
NUM = re.compile(r"\d")
issues = []
for s in STORIES:
    p = []
    if not NUM.search(s["result"]): p.append("result has no number: quantify time, money, % or count")
    if re.search(r"\bwe\b", s["actions"], re.I) and not re.search(r"\bI\b", s["actions"]): p.append("actions say 'we', not 'I': state your own actions")
    if len(s["actions"]) < len(s["situation"]): p.append("situation is longer than actions: cut context, expand what you did")
    if 2026 - s["year"] > 5: p.append(f"story is from {s['year']}: find a more recent example if possible")
    issues.append((s["title"], p))
print("STORY AUDIT")
for title, p in issues:
    print(f"  {'OK  ' if not p else 'FIX '} {title}")
    for x in p: print(f"        - {x}")
cover = {c: [s["title"] for s in STORIES if c in s["competencies"] and not dict(issues)[s["title"]]] for c in COMPETENCIES}
print("\nCOVERAGE (strong stories only; aim for 2 each)")
for c, titles in cover.items():
    print(f"  {c:<20} {len(titles)} {'<- gap' if len(titles) < 2 else ''}")
print("\nNext: fix the weak stories, then write new ones for:", ", ".join(c for c, t in cover.items() if len(t) < 2))`
  },
  design: {
    lead: '<p>Treat interview preparation like an engagement: understand the requirements (the company’s format and values), decompose them into practice areas, build assets (story bank, code templates, portfolio talking points), rehearse with feedback, and measure progress.</p>',
    scale: [{ h: 'Many companies at once', p: 'Keep a shared core (stories, coding fluency, frameworks) and tailor the top layer per company: their products, customers and published values.' }, { h: 'Reusable assets', p: 'A story bank, a decomposition template and a portfolio one-pager serve every loop.' }],
    fail: [{ h: 'Jumping to solutions', p: 'In decomposition and case rounds, proposing an LLM before clarifying the problem is the most common failure signal.' }, { h: 'Vague stories', p: 'Stories without your specific actions and measurable results read as passengers on someone else’s project.' }],
    trade: [{ h: 'Breadth vs depth', p: 'Know the whole stack at a working level and two areas deeply (for example retrieval and evaluation) so deep-dive questions land.' }, { h: 'Speed vs correctness in coding', p: 'Working, tested code with clear structure beats an unfinished optimal solution; mention the optimisation you would do next.' }],
    prompt: '<p>Practice prompt: “A logistics company wants to use AI to reduce late deliveries. You have 30 minutes.”</p>',
    answer: '<ul><li>Clarify: how lateness is measured, volumes, root causes known, systems (TMS, telematics), who acts on predictions.</li><li>Map workflow: planning, dispatch, execution, exceptions.</li><li>Decompose: delay prediction (classic ML on telematics and history, not an LLM), dispatcher assistant (LLM summarising exceptions with tool access), customer notifications (templated plus generation).</li><li>Riskiest assumption: data quality of telematics; first slice: prediction on one depot; metrics: on-time rate, dispatcher time per exception; pilot plan and change management.</li></ul>'
  },
  quiz: [
    { q: 'In a decomposition interview, the first thing to do is:', o: ['Propose a model', 'Clarify goals, users, constraints and success metrics', 'Draw a UI', 'Estimate GPUs'], a: 1, why: 'Structure before solutions.' },
    { q: 'A strong STAR result includes:', o: ['Feelings only', 'A measurable outcome and what changed because of your actions', 'The team’s achievements', 'A long situation'], a: 1, why: 'Specific, quantified impact.' },
    { q: 'In practical coding rounds, what usually matters most?', o: ['Clever one-liners', 'Correct, readable, tested code with clear communication', 'Memorised algorithms', 'Speed of typing'], a: 1, why: 'It mirrors real FDE work.' }
  ],
  interview: [
    { q: 'Why do you want to be a forward deployed engineer?', a: '<p>Connect your experience to the job: you like building with customers, turning ambiguous problems into working systems, and seeing measured impact; give one short example; show you understand the trade-offs (travel or customer time, context switching, ambiguity) and why they suit you.</p>' },
    { q: 'Tell me about a time you had to deliver with incomplete information.', a: '<p>STAR with emphasis on how you reduced ambiguity: the questions you asked, the assumption you tested first, the thin slice you shipped, how you communicated uncertainty, and the measured result.</p>' }
  ]
});

/* ===================================================================== 14.2 */
L({
  id: '14.2', title: 'AI-backend loop: coding, design, serving deep dive', minutes: 60, roles: ['be'],
  tags: 'concurrency coding · async batching · rate limiting · LLM system design · serving fundamentals · KV-cache math · throughput and latency estimates · debugging questions',
  mental: 'AI backend interviews look like strong backend interviews with an AI layer: production-quality concurrent code, system design with token economics and evaluation, and a deep dive where you reason quantitatively about serving (memory, bandwidth, batching, caching). Practise deriving numbers on a whiteboard.',
  intro: `<p>Backend roles for AI systems (AI platform, inference, applied AI infrastructure) commonly interview on three axes: coding (often concurrency, data structures, API design, with tests), system design (the cases in Phase 12), and a technical deep dive into serving, retrieval or evaluation. Interviewers look for correct reasoning about latency, throughput, cost and failure, not memorised numbers. This lesson gives a worked coding problem and a serving calculator you should be able to reproduce by hand.</p>`,
  points: [
    'Coding favourites: async micro-batching, token-bucket rate limiters, retry with backoff and jitter, LRU and TTL caches, streaming parsers, top-k with heaps, consistent hashing.',
    'Design: requirements with numbers, tokens per second, cost per request, caching layers, model routing, evals and release gates, failure modes.',
    'Serving deep dive: KV-cache bytes per token = 2 × layers × KV heads × head dim × bytes per value.',
    'Decode is usually memory-bandwidth bound: each step reads the weights once for the whole batch, so throughput grows with batch size until compute or KV memory limits it.',
    'Prefill is compute bound: time scales with prompt tokens; prefix caching removes repeated prefill.',
    'Be ready to debug: “p99 TTFT doubled after a deploy”, “GPU utilisation is 30% but queues are long”.'
  ],
  concept: { title: 'A delivery van and a warehouse', body: `<p>Every decode step is a van trip from the warehouse (GPU memory) carrying the whole model’s weights to the workers (compute units). One trip can serve many orders at once (the batch), so filling the van is the main lever, until the loading dock (KV-cache memory) runs out of space for orders in progress.</p>` },
  walk: [
    { h: 'KV-cache arithmetic', body: '<p>For a model with 32 layers, 8 KV heads of dimension 128, in 16-bit precision: 2 × 32 × 8 × 128 × 2 bytes = 131,072 bytes = 128 KiB per token. A 16k-token context is 2 GiB per sequence. With 40 GB left for KV cache, about 20 such sequences fit concurrently. Grouped-query attention (fewer KV heads) is why modern models fit more.</p>' },
    { h: 'Throughput estimate', body: '<p>An 8B model in 16-bit is ~16 GB. On a GPU with ~3.3 TB/s memory bandwidth, one decode step that reads all weights takes at least ~5 ms, so a single sequence decodes at most ~200 tokens/s; a batch of 32 shares the read and approaches 32× that until compute or KV traffic dominates. Quantisation to 8 or 4 bits halves or quarters the bytes read.</p>' },
    { h: 'Concurrency coding', body: '<p>A frequent question: “Implement a client that batches embedding requests: flush at 64 items or 10 ms, whichever first; callers await their own result.” The Code tab solves it with asyncio futures and tests the batching behaviour.</p>' }
  ],
  analogy: `<p><b>A lift in a busy building.</b> The lift trip time is mostly fixed (reading weights); carrying more people per trip (batching) raises throughput; the lift’s floor space (KV memory) caps how many can ride; and people who all go to the same floor can share the ride (prefix caching).</p>`,
  diagram: {
    title: 'Serving deep dive: where time and memory go',
    cols: [['req'], ['prefill'], ['kv'], ['decode'], ['out']],
    nodes: [
      { id: 'req', label: 'Request', sub: 'prompt tokens P', tone: 'fde', info: 'Long prompts make prefill expensive.' },
      { id: 'prefill', label: 'Prefill', sub: 'compute bound · ~P tokens', tone: 'acc', info: 'Determines TTFT; prefix cache skips repeated parts.' },
      { id: 'kv', label: 'KV cache', sub: 'bytes/token × context', tone: 'warn', info: 'Caps concurrent sequences; paged allocation.' },
      { id: 'decode', label: 'Decode steps', sub: 'bandwidth bound · batch', tone: 'be', info: 'TPOT; continuous batching shares weight reads.' },
      { id: 'out', label: 'Tokens out', sub: 'streamed', tone: 'ok', info: 'Total time ≈ TTFT + N × TPOT.' }
    ],
    edges: [{ a: 'req', b: 'prefill' }, { a: 'prefill', b: 'kv' }, { a: 'kv', b: 'decode' }, { a: 'decode', b: 'out' }, { a: 'decode', b: 'kv', dash: true, bend: 50, label: 'grows' }],
    caption: 'Prefill sets TTFT, decode sets TPOT, KV memory sets concurrency.'
  },
  illustrated: { title: 'Debugging prompts and first checks', body: `<div class="tbl"><table><thead><tr><th>symptom</th><th>first checks</th></tr></thead><tbody>
    <tr><td>p99 TTFT doubled after deploy</td><td>prompt length change (template), prefix-cache hit rate, batch scheduler config, queue time vs prefill time</td></tr>
    <tr><td>GPU util 30% but long queues</td><td>max concurrent sequences limited by KV memory or config, tokenizer or CPU bottleneck, small batch limits</td></tr>
    <tr><td>OOM under load</td><td>max model length vs memory, too many concurrent long sequences, memory utilisation setting</td></tr>
    <tr><td>cost per request up 40%</td><td>output length drift, retries, cache misses, routing to a larger model</td></tr></tbody></table></div>` },
  code: {
    title: 'Worked coding problem: an async micro-batcher with tests', file: 'microbatch.py', browser: true,
    intro: '<p>Callers await <code class="i">embed(text)</code>; the batcher groups concurrent calls into batches of up to 64 or flushes after 10 ms, calls a (fake) batch embedding API once per batch, and resolves each caller’s future. It propagates errors to the right callers, bounds in-flight batches with a semaphore, and is tested for batching behaviour, latency bound and error handling.</p>',
    src: String.raw`import asyncio, time

class MicroBatcher:
    def __init__(self, fn, max_batch=64, max_wait=0.010, max_inflight=4):
        self.fn, self.max_batch, self.max_wait = fn, max_batch, max_wait
        self.items, self.timer, self.sem = [], None, asyncio.Semaphore(max_inflight)
        self.batches = []

    async def submit(self, x):
        fut = asyncio.get_running_loop().create_future()
        self.items.append((x, fut))
        if len(self.items) >= self.max_batch:
            self._flush()
        elif self.timer is None:
            self.timer = asyncio.get_running_loop().call_later(self.max_wait, self._flush)
        return await fut

    def _flush(self):
        if self.timer: self.timer.cancel(); self.timer = None
        batch, self.items = self.items[: self.max_batch], self.items[self.max_batch:]
        if self.items:                                           # leftovers start a new timer
            self.timer = asyncio.get_running_loop().call_later(self.max_wait, self._flush)
        if batch: asyncio.ensure_future(self._run(batch))

    async def _run(self, batch):
        async with self.sem:
            self.batches.append(len(batch))
            try:
                results = await self.fn([x for x, _ in batch])
                for (_, fut), r in zip(batch, results): fut.set_result(r)
            except Exception as e:
                for _, fut in batch: fut.set_exception(e)

calls = 0
async def fake_embed(texts):
    global calls; calls += 1
    await asyncio.sleep(0.02)                                       # one network round trip per batch
    if any(t == "boom" for t in texts): raise RuntimeError("provider 500")
    return [[float(len(t))] for t in texts]

async def main():
    b = MicroBatcher(fake_embed)
    t0 = time.perf_counter()
    out = await asyncio.gather(*(b.submit(f"text {i}") for i in range(200)))
    dt = time.perf_counter() - t0
    print(f"200 calls -> {calls} API calls, batch sizes {b.batches}, {dt * 1000:.0f} ms total")
    assert out[5] == [6.0] and sorted(b.batches, reverse=True)[:3] == [64, 64, 64] and sum(b.batches) == 200
    t0 = time.perf_counter(); single = await b.submit("alone"); lat = time.perf_counter() - t0
    print(f"single call waited {lat * 1000:.0f} ms (bounded by max_wait + one round trip)")
    assert lat < 0.010 + 0.02 + 0.02
    res = await asyncio.gather(b.submit("ok"), b.submit("boom"), return_exceptions=True)
    print("error propagation:", [type(r).__name__ if isinstance(r, Exception) else r for r in res])
    assert all(isinstance(r, RuntimeError) for r in res)          # same batch -> both fail; a real client would retry the good ones
    print("all tests pass")

asyncio.run(main())`
  },
  lab: {
    title: 'Serving back-of-envelope drill', file: 'serving_drill_lab.py', browser: true,
    scenario: `<p>Interviewers often ask you to estimate serving capacity on a whiteboard. Build the calculator you would use, then answer the drill: for an 8B and a 70B model (architecture numbers given), on an 80 GB GPU with 3.35 TB/s bandwidth and about 990 dense 16-bit TFLOPS, compute KV bytes per token, how many 8k-token sequences fit after weights, the bandwidth-bound decode ceiling at batch 1 and at the maximum batch, and the compute-bound prefill time for a 4k prompt. Then answer three what-ifs: 8-bit weights, 32k context, and tensor parallelism across 4 GPUs for the 70B model.</p>`,
    steps: ['KV bytes/token = 2 × layers × kv_heads × head_dim × bytes.', 'Free memory = GPU memory × 0.9 − weight bytes; max sequences = free / (KV bytes/token × context).', 'Decode step time ≈ (weight bytes + batch × KV bytes read) / bandwidth; tokens/s = batch / step time.', 'Prefill time ≈ 2 × params × prompt tokens / (FLOPS × utilisation 0.5).', 'Print a table for each model and the what-ifs.'],
    checks: ['8B KV is 128 KiB per token in 16-bit.', 'The 70B model does not fit on one 80 GB GPU in 16-bit.', 'Larger batches raise aggregate tokens/s but the per-sequence rate falls.'],
    hints: ['Assume the average sequence is half-way through its context when estimating KV read per step.', 'Tensor parallelism splits weights and KV across GPUs and adds communication overhead; use 85% efficiency.'],
    starter: String.raw`GPU = {"mem_gb": 80, "bw_tbs": 3.35, "tflops": 990}
MODELS = {"8B": {"params": 8.0e9, "layers": 32, "kv_heads": 8, "head_dim": 128},
          "70B": {"params": 70.6e9, "layers": 80, "kv_heads": 8, "head_dim": 128}}
# TODO: functions and the drill`,
    solution: String.raw`GPU = {"mem_gb": 80, "bw_tbs": 3.35, "tflops": 990}
MODELS = {"8B": {"params": 8.0e9, "layers": 32, "kv_heads": 8, "head_dim": 128},
          "70B": {"params": 70.6e9, "layers": 80, "kv_heads": 8, "head_dim": 128}}

def analyse(name, m, w_bytes=2, kv_bytes=2, context=8192, prompt=4096, gpus=1, eff=1.0):
    kv_tok = 2 * m["layers"] * m["kv_heads"] * m["head_dim"] * kv_bytes
    weights = m["params"] * w_bytes
    free = GPU["mem_gb"] * 1e9 * 0.9 * gpus - weights
    if free <= 0:
        return f"{name:<22} weights {weights / 1e9:5.0f} GB do not fit in {GPU['mem_gb'] * gpus} GB"
    max_seq = int(free // (kv_tok * context))
    if max_seq < 1:
        return f"{name:<22} weights fit ({weights / 1e9:.0f} GB) but no room for even one {context // 1024}k-token KV cache"
    bw = GPU["bw_tbs"] * 1e12 * gpus * eff
    def tps(batch):
        step = (weights + batch * kv_tok * context / 2) / bw
        return batch / step, 1 / step
    t1, _ = tps(1)
    tmax, per_seq = tps(max(1, max_seq))
    prefill = 2 * m["params"] * prompt / (GPU["tflops"] * 1e12 * gpus * eff * 0.5)
    return (f"{name:<22} KV {kv_tok / 1024:5.0f} KiB/tok | fits {max_seq:>4} x {context // 1024}k seqs | decode batch 1 {t1:6.0f} tok/s"
            f" | batch {max_seq} {tmax:7.0f} tok/s ({per_seq:4.0f}/seq) | prefill 4k {prefill * 1000:5.0f} ms")

for name, m in MODELS.items():
    print(analyse(f"{name} fp16", m))
print("what-ifs:")
print(analyse("8B int8 weights", MODELS["8B"], w_bytes=1))
print(analyse("8B 32k context", MODELS["8B"], context=32768))
print(analyse("70B fp16, TP=4", MODELS["70B"], gpus=4, eff=0.85))
print(analyse("70B int8, 1 GPU", MODELS["70B"], w_bytes=1))
print("""
Talking points: decode is bandwidth bound, so batching multiplies throughput until KV memory runs out; int8 weights
free memory and halve weight reads; long contexts cut concurrency proportionally; TP=4 makes 70B fit with room for KV.""")`
  },
  design: {
    lead: '<p>Backend AI interviews reward quantitative reasoning and production instincts: correct concurrent code, designs with numbers and failure handling, and serving estimates derived from first principles.</p>',
    scale: [{ h: 'From estimate to plan', p: 'Use the back-of-envelope numbers to choose GPU counts and batching settings, then validate with load tests (9.7) and adjust.' }, { h: 'Platform thinking', p: 'Interviewers for platform roles look for multi-tenancy, quotas, observability and cost attribution (12.6).' }],
    fail: [{ h: 'Memorised numbers without derivation', p: 'Quoting “X tokens per second” without showing how it follows from bandwidth and model size is a weak signal. Derive it.' }, { h: 'Untested concurrent code', p: 'Race conditions and lost errors are common in batching and retry code. Write small tests during the interview.' }],
    trade: [{ h: 'Latency vs throughput', p: 'Bigger batches raise throughput and per-token latency; state which SLO you optimise and how you would tune.' }, { h: 'Quantisation vs quality', p: 'Lower precision raises capacity and speed with a quality risk that must be measured on your evals.' }],
    prompt: '<p>Deep-dive prompt: “Our 70B chat model has p99 TTFT of 4 s at peak. Walk me through how you would investigate and fix it.”</p>',
    answer: '<ul><li>Split TTFT into queue time and prefill time from metrics; check prompt length distribution and prefix-cache hit rate.</li><li>If queueing: capacity or scheduler limits (max sequences, KV memory), autoscaling lag; add replicas, tune limits, prioritise interactive traffic.</li><li>If prefill: long prompts; enable or fix prefix caching, trim prompts, chunked prefill or disaggregated prefill (9.6).</li><li>Validate with a load test and SLO dashboards; roll out behind a flag.</li></ul>'
  },
  quiz: [
    { q: 'KV bytes per token for 32 layers, 8 KV heads, head dim 128, 16-bit:', o: ['32 KiB', '64 KiB', '128 KiB', '1 MiB'], a: 2, why: '2 × 32 × 8 × 128 × 2 = 131,072 bytes.' },
    { q: 'Decode at small batch sizes is usually limited by:', o: ['Disk', 'Memory bandwidth (reading weights each step)', 'CPU', 'Network'], a: 1, why: 'Each token step reads the weights.' },
    { q: 'What does prefix caching mainly reduce?', o: ['Output length', 'Prefill compute and TTFT for repeated prompt prefixes', 'Model size', 'Network latency'], a: 1, why: 'Shared prefixes skip recomputation.' }
  ],
  interview: [
    { q: 'Implement a micro-batcher for embedding calls. What edge cases matter?', a: '<p>Flush on size or timeout, whichever first; leftovers start a new timer; each caller gets its own result; errors propagate to the callers of the failed batch (with per-item retry where possible); bounded in-flight batches; cancellation of waiting callers; and a shutdown that flushes pending items. Test batching, latency bound and errors.</p>' },
    { q: 'Estimate how many concurrent users an 8B model on one 80 GB GPU can serve.', a: '<p>Weights ~16 GB in 16-bit; KV ~128 KiB per token; with ~56 GB free and an average 4k-token context, about 100 sequences fit. Decode at that batch is bandwidth bound: around 30–40 tokens per second per sequence by the formula above. If users read at ~10 tokens/s and are active a fraction of the time, a few hundred concurrent users is plausible; confirm with a load test.</p>' }
  ]
});

/* ===================================================================== 14.3 */
L({
  id: '14.3', title: 'Portfolio: 3–5 public builds', minutes: 50, roles: ['fde', 'be'],
  tags: 'project selection · coverage of role skills · evals in the README · architecture diagrams · cost and latency notes · demos · write-ups · talking points',
  mental: 'A portfolio is evidence. Three to five public projects, each solving a realistic problem end to end with evaluation, cost and failure analysis, show more than any certificate. Choose projects that together cover the role’s skills, and make each one easy to understand in two minutes.',
  intro: `<p>Hiring managers for FDE and AI backend roles look for proof that you can ship working AI systems: not notebooks, but deployable services with tests, evals, and honest write-ups. This course’s labs and micro-projects are designed to grow into such projects. This lesson helps you choose a set of builds, structure each repository, and turn them into interview talking points.</p>`,
  points: [
    'Choose projects that mirror real customer problems: support copilot, document extraction, research agent, inference gateway, evaluation harness.',
    'Each project: a README with the problem, architecture diagram, how to run it in one command, eval results with the eval set, cost and latency numbers, known limitations.',
    'Show engineering: tests, CI, typed code, configuration, Docker, tracing; secrets never committed.',
    'Show judgement: what you tried that did not work and why; trade-offs you made.',
    'Add a short demo (video or hosted page) and a write-up (blog post or design doc) for at least two projects.',
    'Prepare a two-minute and a ten-minute walkthrough for each, including a failure you fixed.'
  ],
  concept: { title: 'An architect’s portfolio of built work', body: `<p>Architects do not show certificates; they show buildings, with plans, constraints, photos and what they would do differently. A good AI portfolio does the same: the problem, the plan, the evidence that it works, and honest notes on its limits.</p>` },
  walk: [
    { h: 'A suggested set', body: '<ol><li><b>Permission-aware RAG assistant</b> with hybrid search, reranking, citations and an eval report (Phases 4, 7, 8).</li><li><b>Agent with MCP tools</b> and human approval for writes, with trajectory evals (Phases 5–6).</li><li><b>Document extraction pipeline</b> with validation, review queue and STP metrics (12.5, 13.3).</li><li><b>LLM gateway</b> with routing, budgets, caching and dashboards; load-tested (Phase 9).</li><li><b>Eval and release harness</b> used in CI with a prompt registry (Phases 7, 10).</li></ol>' },
    { h: 'README skeleton', body: '<p>Readers skim; put the evidence first.</p>', lang: 'md', file: 'README.md', code: String.raw`# Claims Copilot: cited answers over policy documents
Problem · who it is for · one-line result (e.g. "grounded answers 91% on 200 real questions, $1.10 per 1k requests")
## Demo            link or GIF
## Architecture    diagram + 5 bullet data flow
## Results         eval set description, metrics table vs baseline, slices, cost and latency
## Run it          docker compose up / uv run ... (one command), sample data included
## Design choices  what I chose, alternatives, why
## Limitations     known failures and next steps` },
    { h: 'Talking points', body: '<p>For each project, prepare: the problem in one sentence; the architecture in one diagram; the hardest technical problem and how you solved it; one number that shows it works; one failure and what it taught you; what you would do for a real customer at scale.</p>' }
  ],
  analogy: `<p><b>A chef’s tasting menu.</b> Five dishes chosen to show range (techniques, ingredients) with a coherent story, each plated so a guest understands it at first sight, and the chef ready to explain any choice.</p>`,
  diagram: {
    title: 'From course labs to a portfolio',
    cols: [['labs'], ['pick'], ['build'], ['evidence'], ['story']],
    nodes: [
      { id: 'labs', label: 'Course labs', sub: 'micro-projects', tone: 'fde', info: 'Each phase’s labs are seeds.' },
      { id: 'pick', label: 'Pick 3–5', sub: 'cover role skills', tone: 'acc', info: 'Coverage matrix against the target role.' },
      { id: 'build', label: 'Build end to end', sub: 'tests · CI · Docker', tone: 'be', info: 'Realistic data, one-command run.' },
      { id: 'evidence', label: 'Evidence', sub: 'evals · cost · latency', tone: 'warn', info: 'Numbers with baselines and limitations.' },
      { id: 'story', label: 'Story', sub: 'demo · write-up · talk', tone: 'ok', info: 'Two-minute and ten-minute versions.' }
    ],
    edges: [{ a: 'labs', b: 'pick' }, { a: 'pick', b: 'build' }, { a: 'build', b: 'evidence' }, { a: 'evidence', b: 'story' }],
    caption: 'Select for coverage, build for real, prove with numbers, tell it well.'
  },
  illustrated: { title: 'What reviewers notice in 2 minutes', body: `<div class="tbl"><table><thead><tr><th>strong signal</th><th>weak signal</th></tr></thead><tbody>
    <tr><td>eval table with baseline and slices</td><td>“works great” with screenshots</td></tr>
    <tr><td>one-command run with sample data</td><td>a page of setup steps, missing keys</td></tr>
    <tr><td>cost per request and latency percentiles</td><td>no mention of cost</td></tr>
    <tr><td>limitations and failure analysis</td><td>no limitations</td></tr>
    <tr><td>tests and CI badge</td><td>a single notebook</td></tr></tbody></table></div>` },
  code: {
    title: 'A portfolio-readiness checker for repositories', file: 'portfolio_check.py', browser: true,
    intro: '<p>Scores a repository (given as a dictionary of file paths to contents) against the signals reviewers look for: README sections with evidence, eval results with a baseline, cost and latency numbers, tests, CI, one-command run, an architecture diagram, a lockfile, and no committed secrets. Two sample repositories show a strong and a weak project.</p>',
    src: String.raw`import re

CHECKS = [
    ("README has problem + results up top", lambda f: bool(re.search(r"(?is)^# .{0,400}?\d", f.get("README.md", "")))),
    ("eval results with a baseline", lambda f: bool(re.search(r"(?i)baseline", f.get("README.md", ""))) and any(p.startswith("evals/") for p in f)),
    ("cost and latency numbers", lambda f: bool(re.search(r"\$\s?\d", f.get("README.md", ""))) and bool(re.search(r"(?i)p9[59]|latency", f.get("README.md", "")))),
    ("limitations section", lambda f: "## Limitations" in f.get("README.md", "")),
    ("architecture diagram", lambda f: any(p.endswith((".png", ".svg", ".mmd")) for p in f) or "mermaid" in f.get("README.md", "")),
    ("one-command run", lambda f: "docker-compose.yml" in f or "compose.yaml" in f or bool(re.search(r"uv run|docker compose up", f.get("README.md", "")))),
    ("tests", lambda f: any(p.startswith("tests/") for p in f)),
    ("CI workflow", lambda f: any(p.startswith(".github/workflows/") for p in f)),
    ("lockfile", lambda f: "uv.lock" in f or "poetry.lock" in f),
    ("no committed secrets", lambda f: not any(re.search(r"sk-[A-Za-z0-9-]{16,}|AKIA[0-9A-Z]{16}", c) for c in f.values()) and ".env" not in f),
]

STRONG = {
    "README.md": "# Claims Copilot\nCited answers over policy documents: grounded 91% on 200 real questions (baseline 74%), $1.10 per 1k requests, p95 2.1 s.\n"
                 "## Demo\n## Architecture\n~~~mermaid\ngraph LR; UI-->API-->Retriever-->LLM\n~~~\n## Run it\ndocker compose up\n## Limitations\nScanned PDFs below 150 dpi fail.",
    "evals/results.json": "{}", "tests/test_api.py": "", ".github/workflows/ci.yml": "", "uv.lock": "", "docker-compose.yml": "",
}
WEAK = {
    "README.md": "# my rag project\nThis is a RAG chatbot using LangChain. It works really well!\n\nInstall the requirements and set your key.",
    "notebook.ipynb": "", "app.py": 'OPENAI_API_KEY = "sk-proj-abcdefghijklmnop1234"', ".env": "KEY=...",
}
for name, repo in (("strong", STRONG), ("weak", WEAK)):
    results = [(label, check(repo)) for label, check in CHECKS]
    score = sum(ok for _, ok in results)
    print(f"{name}: {score}/{len(CHECKS)}")
    for label, ok in results:
        if not ok: print(f"   missing: {label}")`
  },
  lab: {
    title: 'Choose your portfolio set for a target role', file: 'portfolio_plan_lab.py', browser: true,
    scenario: `<p>You have about 120 hours over the next two months. Candidate projects (from this course) each cover some of the target role’s skills, take an estimated number of hours, and have an “interest to reviewers” score. Pick 3–5 projects that maximise weighted skill coverage (each skill counts once, weighted by how much the role emphasises it) within the time budget, with at least one project demonstrating customer-facing work for FDE roles. Compare the best sets for an FDE target and an AI-backend target.</p>`,
    steps: ['Encode skills with weights per role (FDE vs backend).', 'Encode projects with skills covered, hours and interest score.', 'Enumerate all subsets of size 3–5 within 120 hours; score = weighted coverage + 0.5 × interest.', 'Apply the FDE constraint (at least one project with discovery or customer artefacts).', 'Print the best set per role, uncovered skills, hours, and a build order (riskiest or most reusable first).'],
    checks: ['Both plans respect the hour budget.', 'The FDE plan includes a customer-facing project.', 'Uncovered skills are listed so you can address them in interviews or small extras.'],
    hints: ['Reusable infrastructure (gateway, eval harness) first makes later projects faster.', 'A strong write-up can count as customer-facing evidence: a discovery memo and pilot plan for a realistic scenario.'],
    starter: String.raw`import itertools
SKILLS = {  # skill: (FDE weight, backend weight)
  "retrieval": (3, 3), "agents_tools": (3, 2), "evals": (3, 3), "security": (2, 2), "serving_perf": (1, 3), "data_integration": (3, 2),
  "frontend_demo": (2, 1), "discovery_comm": (3, 1), "cloud_deploy": (2, 3), "cost_ops": (2, 3), "benchmarking": (0, 4)}
PROJECTS = {  # name: (skills, hours, interest 1-5, customer_facing)
  "rag_copilot": ({"retrieval", "evals", "security", "frontend_demo"}, 35, 4, False),
  "mcp_agent": ({"agents_tools", "security", "evals"}, 30, 5, False),
  "doc_extraction": ({"data_integration", "evals", "frontend_demo"}, 30, 4, False),
  "llm_gateway": ({"serving_perf", "cost_ops", "cloud_deploy"}, 40, 4, False),
  "eval_harness": ({"evals", "cloud_deploy", "cost_ops"}, 20, 3, False),
  "pilot_casebook": ({"discovery_comm", "data_integration", "frontend_demo"}, 15, 4, True),
  "vllm_bench": ({"serving_perf", "cloud_deploy", "benchmarking"}, 25, 4, False),
}
BUDGET = 120
# TODO`,
    solution: String.raw`import itertools
SKILLS = {  # skill: (FDE weight, backend weight)
  "retrieval": (3, 3), "agents_tools": (3, 2), "evals": (3, 3), "security": (2, 2), "serving_perf": (1, 3), "data_integration": (3, 2),
  "frontend_demo": (2, 1), "discovery_comm": (3, 1), "cloud_deploy": (2, 3), "cost_ops": (2, 3), "benchmarking": (0, 4)}
PROJECTS = {  # name: (skills, hours, interest 1-5, customer_facing)
  "rag_copilot": ({"retrieval", "evals", "security", "frontend_demo"}, 35, 4, False),
  "mcp_agent": ({"agents_tools", "security", "evals"}, 30, 5, False),
  "doc_extraction": ({"data_integration", "evals", "frontend_demo"}, 30, 4, False),
  "llm_gateway": ({"serving_perf", "cost_ops", "cloud_deploy"}, 40, 4, False),
  "eval_harness": ({"evals", "cloud_deploy", "cost_ops"}, 20, 3, False),
  "pilot_casebook": ({"discovery_comm", "data_integration", "frontend_demo"}, 15, 4, True),
  "vllm_bench": ({"serving_perf", "cloud_deploy", "benchmarking"}, 25, 4, False),
}
BUDGET = 120
REUSE_FIRST = ["eval_harness", "llm_gateway", "rag_copilot", "mcp_agent", "doc_extraction", "vllm_bench", "pilot_casebook"]

def best(role):
    w = {s: v[0 if role == "fde" else 1] for s, v in SKILLS.items()}
    top = None
    for k in (3, 4, 5):
        for combo in itertools.combinations(PROJECTS, k):
            hours = sum(PROJECTS[p][1] for p in combo)
            if hours > BUDGET: continue
            if role == "fde" and not any(PROJECTS[p][3] for p in combo): continue
            covered = set().union(*(PROJECTS[p][0] for p in combo))
            score = sum(w[s] for s in covered) + 0.5 * sum(PROJECTS[p][2] for p in combo)
            if top is None or score > top[0]: top = (score, combo, hours, covered)
    score, combo, hours, covered = top
    order = sorted(combo, key=REUSE_FIRST.index)
    missing = sorted((s for s in set(SKILLS) - covered if w[s] > 0), key=lambda s: -w[s])
    print(f"{role.upper()}: {', '.join(order)} | {hours} h | score {score:.1f} | uncovered: {missing or 'none'}")
    return combo

fde, be = best("fde"), best("backend")
print("shared projects:", sorted(set(fde) & set(be)), "-> build these first; they serve both applications")`
  },
  design: {
    lead: '<p>Design your portfolio like a product for a specific customer (the hiring team): understand what they value, cover it efficiently, make the evidence easy to verify, and tell a coherent story about the engineer you are.</p>',
    scale: [{ h: 'Reuse across projects', p: 'A shared eval harness, gateway and deployment template make each new project faster and show platform thinking.' }, { h: 'Keeping it current', p: 'Models and libraries change quickly; pin versions, note the date of results, and refresh key numbers before interviews.' }],
    fail: [{ h: 'Tutorial clones', p: 'Projects that repeat a framework’s quickstart show little. Add a real dataset, evals, failure analysis and design decisions.' }, { h: 'Leaked keys and private data', p: 'Committed secrets or customer data in a public repo is an instant negative. Use synthetic or public data and secret scanning.' }],
    trade: [{ h: 'Breadth vs depth', p: 'Three deep projects with evidence beat ten shallow ones. Add one small, sharp extra project for an uncovered skill if needed.' }, { h: 'Polish vs progress', p: 'A clear README and one-command run matter more than UI polish; spend design effort where reviewers look first.' }],
    prompt: '<p>You have two weeks before an FDE interview and one finished RAG project. What do you add?</p>',
    answer: '<ul><li>Week 1: add an eval report with baseline and slices, cost and latency numbers, limitations, and a one-command run; record a 2-minute demo.</li><li>Week 2: write a customer-style discovery memo and pilot plan for the same scenario (11.1–11.3) and a short design doc on scaling it to 300 tenants (12.2).</li><li>Prepare talking points: hardest problem, one failure, one number, what you would do with a real customer.</li></ul>'
  },
  quiz: [
    { q: 'The strongest single addition to a RAG portfolio project is usually:', o: ['A logo', 'An eval report with a baseline, slices, cost and latency', 'More frameworks', 'A longer README intro'], a: 1, why: 'Evidence of quality and judgement.' },
    { q: 'How many portfolio projects are typically enough?', o: ['1', '3–5 deep, complementary projects', '20 small ones', 'None'], a: 1, why: 'Depth and coverage beat volume.' },
    { q: 'What should never appear in a public portfolio repo?', o: ['Tests', 'API keys or real customer data', 'Diagrams', 'A licence'], a: 1, why: 'Security and confidentiality.' }
  ],
  interview: [
    { q: 'Walk me through a project you are proud of.', a: '<p>Two-minute structure: the problem and who it serves; the architecture in one breath; the hardest technical challenge and how you solved it; the evidence it works (one or two numbers versus a baseline); a failure and what you changed; what you would do to take it to production for a real customer.</p>' },
    { q: 'What would you do differently if you rebuilt it?', a: '<p>Show reflection with specifics: evaluate earlier, design the data contract or permission model first, choose a simpler pipeline where an agent was unnecessary, or add observability from day one, each tied to a lesson you learned from the project.</p>' }
  ]
});
})();

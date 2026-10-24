/* Phase 6 · Context engineering */
(function () {
const L = AISA.lesson;

/* ===================================================================== 6.1 */
L({
  id: '6.1', title: 'Context budgets', minutes: 45, roles: ['be', 'fde'], sim: 'ctx',
  tags: 'context window · token accounting · section budgets · context rot · prompt caching · count_tokens',
  mental: 'The context window is a budget you spend on every call, not a bucket you fill. Each section (system prompt, tools, memory, history, tool results, retrieved documents, output reserve) earns its tokens only if it helps the next decision. Allocate deliberately, measure, and trim the lowest-value content first.',
  intro: `<p>Windows of 200,000 tokens and more make it tempting to include everything. Two things argue against it. Cost and latency: every token is re-sent and re-processed on every step of an agent. And quality: models get measurably worse at using information as contexts grow long and noisy, an effect practitioners call context rot. Anthropic\u2019s guidance on context engineering frames the goal as the smallest set of high-signal tokens that gets the job done.</p>
  <p>This phase is about managing that budget in long-running agents. This lesson sets up the accounting.</p>`,
  points: [
    'Know your sections and their sizes on every call: system, tool definitions, memory, history, tool results, retrieved chunks, and reserved output tokens.',
    'Count tokens with the provider\u2019s tokenizer or token-counting endpoint, not character estimates, when budgets are tight.',
    'Give each section a cap and a priority; trim from the lowest-priority section first.',
    'Keep the stable prefix (system, tools, memory) first and cached; put volatile content last.',
    'Old tool results are usually the biggest and least useful section in long agent runs.',
    'Always reserve room for the output; a full window with no output budget fails.'
  ],
  concept: { title: 'Attention is the scarce resource', body: `<p>A model reading 150,000 tokens to answer a question that needs 2,000 of them has to find the needle in a haystack you built. Bigger windows raise the ceiling but do not remove the cost of noise. The discipline is the same as writing a good briefing note: what does the reader need for the next decision, and what can stay in the filing cabinet, retrievable on request?</p>` },
  walk: [
    { h: 'Measure before you optimise', body: '<p>Log per-section token counts with every call. The Anthropic API also has a token-counting endpoint for exact numbers before sending.</p>', code: String.raw`count = client.messages.count_tokens(model=MODEL, system=system, tools=tools, messages=messages)
print(count.input_tokens)       # exact input tokens for this request, before you pay for it` },
    { h: 'Allocate by section', body: `<div class="tbl"><table><thead><tr><th>section</th><th>typical cap</th><th>priority</th><th>when over cap</th></tr></thead><tbody>
      <tr><td>system + policies</td><td>3\u20138k</td><td>must keep</td><td>edit the prompt, not at run time</td></tr>
      <tr><td>tool definitions</td><td>5\u201315k</td><td>high</td><td>load tools on demand (6.5) or split across sub-agents (6.4)</td></tr>
      <tr><td>memory</td><td>1\u20133k</td><td>high</td><td>fewer, better memories (5.4)</td></tr>
      <tr><td>recent history</td><td>10\u201330k</td><td>high</td><td>compact older turns (6.2)</td></tr>
      <tr><td>tool results</td><td>20\u201360k</td><td>medium</td><td>clear old results, offload to files (6.2, 6.3)</td></tr>
      <tr><td>retrieved chunks</td><td>5\u201320k</td><td>medium</td><td>rerank and keep top k (4.6)</td></tr>
      <tr><td>output reserve</td><td>4\u201332k</td><td>must keep</td><td>never squeeze to zero</td></tr></tbody></table></div>` },
    { h: 'Trim by value, not by age alone', body: '<p>Recent is usually more relevant, but a decision made in turn 3 can matter more than chatter in turn 40. Summaries and notes (6.2, 6.3) keep such items alive cheaply.</p>' }
  ],
  analogy: `<p><b>Packing a carry-on bag.</b> The airline\u2019s size limit is the window. You pack what you need for this trip, put bulky items in checked luggage you can fetch later (files and retrieval), and always leave room to bring something back (output reserve).</p>`,
  diagram: {
    title: 'Where the tokens of one agent call go',
    cols: [['sys', 'tools', 'mem'], ['hist', 'tres', 'ret'], ['alloc'], ['req', 'out']],
    groups: [{ cols: [0], label: 'STABLE · CACHED' }, { cols: [1], label: 'VOLATILE' }],
    nodes: [
      { id: 'sys', label: 'System', sub: 'role · rules', tone: 'acc', info: 'Stable instructions; cached.' },
      { id: 'tools', label: 'Tool definitions', sub: 'schemas', tone: 'be', info: 'Can be large with many tools; cached.' },
      { id: 'mem', label: 'Memory', sub: 'few items', tone: 'ok', info: 'Selected long-term memories.' },
      { id: 'hist', label: 'History', sub: 'recent turns', tone: 'warn', info: 'Older turns compacted into a summary.' },
      { id: 'tres', label: 'Tool results', sub: 'often the biggest', tone: 'bad', info: 'Clear or offload old ones.' },
      { id: 'ret', label: 'Retrieved', sub: 'top-k chunks', info: 'Reranked, permission-filtered evidence.' },
      { id: 'alloc', label: 'Budget allocator', sub: 'caps · priorities', tone: 'fde', info: 'Fits sections into the budget, trimming low-priority content first.' },
      { id: 'req', label: 'Request', sub: 'fits window', info: 'What is actually sent.' },
      { id: 'out', label: 'Output reserve', sub: 'max_tokens', info: 'Room for the answer.' }
    ],
    edges: [{ a: 'sys', b: 'alloc' }, { a: 'tools', b: 'alloc' }, { a: 'mem', b: 'alloc' }, { a: 'hist', b: 'alloc' }, { a: 'tres', b: 'alloc' }, { a: 'ret', b: 'alloc' }, { a: 'alloc', b: 'req' }, { a: 'alloc', b: 'out', dash: true }],
    caption: 'Stable sections first and cached; volatile sections trimmed by priority.'
  },
  illustrated: { title: 'A budget for a 200k window', body: `<div class="tbl"><table><thead><tr><th>section</th><th>naive agent at step 40</th><th>managed agent at step 40</th></tr></thead><tbody>
    <tr><td>system + tools + memory</td><td class="n">14k</td><td class="n">14k (cached)</td></tr>
    <tr><td>history</td><td class="n">38k</td><td class="n">6k summary + 8k recent</td></tr>
    <tr><td>tool results</td><td class="n">125k</td><td class="n">10k (last 4 kept, rest cleared, big ones in files)</td></tr>
    <tr><td>retrieved</td><td class="n">18k</td><td class="n">6k (reranked top 8)</td></tr>
    <tr><td>output reserve</td><td class="n">8k</td><td class="n">8k</td></tr>
    <tr><td><b>total</b></td><td class="n"><b>203k: over the window</b></td><td class="n"><b>52k</b></td></tr></tbody></table></div>` },
  code: {
    title: 'A section-aware context packer', file: 'packer.py', browser: true,
    intro: '<p>Builds one request from sections with caps and priorities. Items inside a section are kept newest-first (or by score), whole items only, and anything dropped is reported so you can log it. Token counts use a 4-characters-per-token estimate; swap in the provider\u2019s counter for exact numbers.</p>',
    src: String.raw`from dataclasses import dataclass, field

def tokens(text: str) -> int:
    return max(1, len(text) // 4)

@dataclass
class Section:
    name: str
    items: list[str]                 # newest or most relevant LAST
    cap: int                         # max tokens for this section
    priority: int                    # lower number = trimmed later
    keep_whole: bool = False         # must be included entirely or the build fails
    kept: list[str] = field(default_factory=list)
    dropped: int = 0

def pack(sections: list[Section], window: int, output_reserve: int) -> dict:
    budget = window - output_reserve
    for s in sections:                                  # 1) apply section caps, newest items first
        used = 0
        for item in reversed(s.items):
            t = tokens(item)
            if used + t > s.cap and not s.keep_whole:
                s.dropped += 1; continue
            s.kept.insert(0, item); used += t
    total = lambda: sum(tokens(i) for s in sections for i in s.kept)
    for s in sorted(sections, key=lambda s: -s.priority):   # 2) still too big: trim lowest priority first
        while total() > budget and s.kept and not s.keep_whole:
            s.kept.pop(0); s.dropped += 1                # oldest item in that section goes first
    if total() > budget:
        raise ValueError("must-keep sections alone exceed the budget")
    return {s.name: (sum(tokens(i) for i in s.kept), len(s.kept), s.dropped) for s in sections} | {"TOTAL": (total(), None, None)}

history = [f"turn {i}: " + "user and assistant discuss the migration plan " * 12 for i in range(60)]
results = [f"tool result {i}: " + "row,value\n" * 900 for i in range(25)]
chunks = [f"chunk {i}: " + "policy text about data retention " * 20 for i in range(15)]
sections = [
    Section("system", ["You are the migration assistant. " * 120], cap=4_000, priority=0, keep_whole=True),
    Section("tools", ["tool schema " * 60] * 30, cap=12_000, priority=1, keep_whole=True),
    Section("memory", ["prefers concise answers", "uses Postgres 16", "deadline is 30 Nov"], cap=500, priority=1),
    Section("history", history, cap=20_000, priority=2),
    Section("tool_results", results, cap=30_000, priority=4),
    Section("retrieved", chunks, cap=6_000, priority=3),
]
report = pack(sections, window=60_000, output_reserve=8_000)
print(f"{'section':<14}{'tokens':>8}{'items':>7}{'dropped':>9}")
for name, (t, n, d) in report.items():
    print(f"{name:<14}{t:>8}{n if n is not None else '':>7}{d if d is not None else '':>9}")
print("budget for input: 52000")`
  },
  lab: {
    title: 'Pack by value, not by recency', file: 'value_pack_lab.py', browser: true,
    scenario: `<p>An analyst agent has 40 candidate context items: old decisions, recent chatter, tool outputs and retrieved notes, each with a token cost and a relevance score from your retriever. Recency-only packing keeps chatter and drops a critical decision from early in the session. Implement value-based packing: must-include items first, then the best value per token, and compare the total relevance kept with the recency baseline under an 8,000-token budget.</p>`,
    steps: ['Use the seeded items in the starter; each has kind, age, tokens, relevance and a <code class="i">must</code> flag.', 'Baseline: newest-first until the budget is full.', 'Value packing: include all must items, then greedily add by relevance per token.', 'Optional: compare with an exact 0/1 knapsack by dynamic programming over tokens in units of 50.', 'Print total relevance, tokens and whether the early decision is kept for each strategy.'],
    checks: ['Both strategies stay within 8,000 tokens.', 'Value packing keeps the must-include decision; recency does not.', 'Value packing achieves higher total relevance.'],
    hints: ['Sort by relevance / tokens descending for the greedy pass.', 'For knapsack, round tokens up to units of 50 to keep the table small.'],
    starter: String.raw`import random
random.seed(21)
items = []
for i in range(40):
    kind = random.choice(["chatter", "tool_output", "retrieved", "note"])
    items.append({"id": i, "kind": kind, "age": 40 - i, "tokens": random.randint(80, 900),
                  "relevance": round(random.random() * (0.4 if kind == "chatter" else 1.0), 2), "must": False})
items[2].update(kind="decision", tokens=300, relevance=0.95, must=True)    # an early decision that still matters
BUDGET = 8_000

def by_recency(items):
    # TODO
    return []

def by_value(items):
    # TODO
    return []

for name, fn in [("recency", by_recency), ("value", by_value)]:
    picked = fn(items)
    print(name, sum(i["tokens"] for i in picked), round(sum(i["relevance"] for i in picked), 2), any(i["id"] == 2 for i in picked))`,
    solution: String.raw`import random
random.seed(21)
items = []
for i in range(40):
    kind = random.choice(["chatter", "tool_output", "retrieved", "note"])
    items.append({"id": i, "kind": kind, "age": 40 - i, "tokens": random.randint(80, 900),
                  "relevance": round(random.random() * (0.4 if kind == "chatter" else 1.0), 2), "must": False})
items[2].update(kind="decision", tokens=300, relevance=0.95, must=True)
BUDGET = 8_000

def by_recency(items):
    out, used = [], 0
    for it in sorted(items, key=lambda i: i["age"]):
        if used + it["tokens"] <= BUDGET:
            out.append(it); used += it["tokens"]
    return out

def by_value(items):
    out = [i for i in items if i["must"]]
    used = sum(i["tokens"] for i in out)
    for it in sorted((i for i in items if not i["must"]), key=lambda i: -i["relevance"] / i["tokens"]):
        if used + it["tokens"] <= BUDGET:
            out.append(it); used += it["tokens"]
    return out

def by_knapsack(items, unit=50):
    must = [i for i in items if i["must"]]
    cap = (BUDGET - sum(i["tokens"] for i in must)) // unit
    rest = [i for i in items if not i["must"]]
    w = [-(-i["tokens"] // unit) for i in rest]
    best = [[0.0] * (cap + 1) for _ in range(len(rest) + 1)]
    for k, it in enumerate(rest, 1):
        for c in range(cap + 1):
            best[k][c] = best[k - 1][c]
            if w[k - 1] <= c:
                best[k][c] = max(best[k][c], best[k - 1][c - w[k - 1]] + it["relevance"])
    chosen, c = [], cap
    for k in range(len(rest), 0, -1):
        if best[k][c] != best[k - 1][c]:
            chosen.append(rest[k - 1]); c -= w[k - 1]
    return must + chosen

print(f"{'strategy':<10}{'tokens':>8}{'relevance':>11}  early decision kept")
for name, fn in [("recency", by_recency), ("value", by_value), ("knapsack", by_knapsack)]:
    picked = fn(items)
    print(f"{name:<10}{sum(i['tokens'] for i in picked):>8}{sum(i['relevance'] for i in picked):>11.2f}  {any(i['id'] == 2 for i in picked)}")`
  },
  design: {
    lead: '<p>Context is a resource shared by quality, cost and latency. Make its use observable per request and per section, and make the allocation policy explicit, versioned code.</p>',
    scale: [{ h: 'Cost per step', p: 'An agent with 100k input tokens per step and 40 steps sends 4 million tokens per task. Caching the stable prefix and trimming tool results are the biggest levers.' }, { h: 'Per-tenant policies', p: 'Enterprise tenants may need larger memory or retrieval budgets; keep allocations configurable per tenant and use case.' }],
    fail: [{ h: 'Silent truncation', p: 'Dropping content without logging makes \u201cthe agent forgot\u201d bugs impossible to debug. Log what was dropped and why.' }, { h: 'Starved output', p: 'Filling the window leaves no room for the answer and produces max_tokens stops. Reserve output first.' }],
    trade: [{ h: 'Big window vs smart selection', p: 'Bigger windows cost more per call and still degrade with noise; selection costs engineering but pays on every request.' }, { h: 'Exact counting vs estimates', p: 'Token-counting calls add latency; estimates are fine with margin, exact counts matter near the limit.' }],
    prompt: '<p>An agent costs $2.40 per task and sometimes hits the context limit at step 50. Plan the fix.</p>',
    answer: '<ul><li>Log per-section tokens per step; find the growth source (usually tool results).</li><li>Cache the stable prefix; clear old tool results beyond the last few; offload big outputs to files.</li><li>Compact history at a threshold; cap retrieval to reranked top k.</li><li>Re-run the task eval to confirm quality held; track cost per task and max context per run.</li></ul>'
  },
  quiz: [
    { q: 'In long agent runs, which section usually grows fastest?', o: ['System prompt', 'Accumulated tool results', 'Memory', 'Output reserve'], a: 1, why: 'Every tool call appends its result and all are re-sent.' },
    { q: 'Why put system, tools and memory first?', o: ['Models read them faster', 'They are stable across calls, so the prefix can be cached', 'APIs require it', 'They are smaller'], a: 1, why: 'Prompt caching works on a shared prefix.' },
    { q: 'What happens if input fills the whole window?', o: ['The model compresses it', 'There is no room for output; the request fails or stops at max_tokens', 'It is free', 'Nothing'], a: 1, why: 'Always reserve output tokens.' }
  ],
  interview: [
    { q: 'What is context engineering, and how does it differ from prompt engineering?', a: '<p>Prompt engineering is writing good instructions. Context engineering is deciding, on every model call, the whole set of tokens the model sees: instructions, tools, memory, history, tool results and retrieved data, within a budget. In agents that context changes every step, so it needs policies for allocation, compaction, offloading and isolation.</p>' },
    { q: 'How would you cut an agent\u2019s cost by half without hurting quality?', a: '<p>Measure per-section tokens first. Usually: cache the stable prefix, clear or offload old tool results, compact history, return smaller tool results, and use a smaller model for helper steps. Validate each change with the task eval set.</p>' }
  ]
});

/* ===================================================================== 6.2 */
L({
  id: '6.2', title: 'Compaction and summarization', minutes: 50, roles: ['be', 'fde'],
  tags: 'threshold compaction · structured summaries · tool-result clearing · what to keep · server-side compaction',
  mental: 'When a conversation nears its budget, replace the old part with a faithful, structured summary and keep the recent turns verbatim. Separately, clear stale tool results that the model has already used. Both buy room to keep going; both lose detail, so keep what decisions depend on and pointers to the rest.',
  intro: `<p>Compaction is how long-running assistants and coding agents keep working past the context window: summarise the history so far, start a fresh context with that summary, and continue. Done well, the agent barely notices. Done badly, it forgets a decision, re-does work, or contradicts itself.</p>
  <p>Providers now offer this as a feature: Anthropic\u2019s API supports clearing old tool results (context editing) and server-side compaction of conversations, and coding agents compact automatically. Building it once by hand shows what to keep and how to test it.</p>`,
  points: [
    'Trigger on a token threshold (for example 70% to 80% of the budget), not on turn count.',
    'Summaries should be structured: goal, decisions and reasons, facts learned, open questions, current state, files or ids touched, next steps.',
    'Keep the last few turns verbatim so tone and immediate context survive.',
    '<b>Tool-result clearing</b> replaces old tool outputs with a short placeholder; keep the most recent few and any tool you mark as important.',
    'Never compact away hard constraints (user instructions, policies) into vague prose; carry them forward exactly.',
    'Test compaction: ask questions after compaction whose answers lived only in the compacted part.'
  ],
  concept: { title: 'Minutes of the meeting so far', body: `<p>A good chair, halfway through a long meeting, reads out the minutes: what we decided, why, what is still open, who is doing what. Latecomers can participate fully without hearing every word. Compaction is writing those minutes for the model, and the test is the same: could someone act correctly using only the minutes and the last few minutes of discussion?</p>` },
  walk: [
    { h: 'A structured summary prompt', body: '<p>Ask for fixed sections, and require exact values (ids, numbers, paths) rather than paraphrase.</p>', code: String.raw`SUMMARY_PROMPT = """Summarise the conversation so far for a colleague who will continue the work.
Use exactly these sections: GOAL, CONSTRAINTS (verbatim user instructions), DECISIONS (with reasons),
FACTS (ids, numbers, file paths exactly), DONE, OPEN QUESTIONS, NEXT STEPS.
Wrap the result in <summary></summary>."""` },
    { h: 'Clear old tool results', body: '<p>Many tool results are only needed for the step right after them. With the Anthropic API\u2019s context editing (beta at the time of writing), the request declares the strategy and the API applies it.</p>', code: String.raw`response = client.beta.messages.create(
    model=MODEL, max_tokens=4096, messages=messages, tools=tools,
    betas=["context-management-2025-06-27"],
    context_management={"edits": [{"type": "clear_tool_uses_20250919",
                                   "trigger": {"type": "input_tokens", "value": 50_000},
                                   "keep": {"type": "tool_uses", "value": 4},
                                   "exclude_tools": ["read_requirements"]}]})` },
    { h: 'Server-side compaction', body: '<p>The API can also compact the conversation itself when a token threshold is reached, returning a compaction block that replaces earlier history. Parameter names are evolving, so check the current documentation; the design questions in this lesson stay the same.</p>' }
  ],
  analogy: `<p><b>A relay race baton.</b> The next runner does not need the first runner\u2019s whole experience, only the baton handed over cleanly at the right moment. Drop it (lose a decision) and the race is lost, however fast everyone runs.</p>`,
  diagram: {
    title: 'Compaction at a threshold',
    cols: [['ctx'], ['chk'], ['old', 'recent'], ['sum'], ['new']],
    nodes: [
      { id: 'ctx', label: 'Growing context', sub: 'turns + tool results', tone: 'fde', info: 'Each step adds tokens.' },
      { id: 'chk', label: 'Over threshold?', sub: 'e.g. 75% of budget', tone: 'warn', info: 'Checked before each call.' },
      { id: 'old', label: 'Older turns', sub: 'to summarise', info: 'Everything except the last few turns.' },
      { id: 'recent', label: 'Recent turns', sub: 'kept verbatim', tone: 'ok', info: 'The last few turns stay as they are.' },
      { id: 'sum', label: 'Structured summary', sub: 'goal · decisions · facts · next', tone: 'acc', info: 'Written by a model call with a fixed template; exact ids and constraints carried forward.' },
      { id: 'new', label: 'New context', sub: 'summary + recent', tone: 'be', info: 'The agent continues with a fraction of the tokens.' }
    ],
    edges: [{ a: 'ctx', b: 'chk', step: 1 }, { a: 'chk', b: 'old', step: 2 }, { a: 'chk', b: 'recent', step: 2 }, { a: 'old', b: 'sum', step: 3 }, { a: 'sum', b: 'new', step: 4 }, { a: 'recent', b: 'new', step: 4 }],
    steps: ['The context grows with every step.', 'At the threshold, it is split into old and recent parts.', 'The old part is summarised into fixed sections.', 'The new context is the summary plus recent turns.'],
    caption: 'Summarise the old, keep the recent, carry constraints exactly.'
  },
  illustrated: { title: 'What a lossy summary breaks', body: `<div class="tbl"><table><thead><tr><th>original detail</th><th>vague summary</th><th>structured summary</th></tr></thead><tbody>
    <tr><td>\u201cNever touch the prod_billing schema\u201d (user, turn 4)</td><td>\u201cUser has some database concerns\u201d</td><td>CONSTRAINTS: \u201cNever touch the prod_billing schema\u201d</td></tr>
    <tr><td>migration uses batch size 5,000 after 20,000 timed out</td><td>\u201cTuned the migration\u201d</td><td>DECISIONS: batch 5,000 (20,000 timed out at 30 s)</td></tr>
    <tr><td>table ids 18, 44, 71 still failing</td><td>\u201cA few tables failing\u201d</td><td>OPEN: tables 18, 44, 71 fail on FK checks</td></tr></tbody></table></div>` },
  code: {
    title: 'Threshold compaction and tool-result clearing, measured', file: 'compaction.py', deps: 'uv add anthropic',
    intro: '<p class="callout"><b>Runs without a key</b> The SDK is real; a local fake model writes the summary from the transcript it receives, so you can see the request and the result.</p><p>A simulated migration session grows over 30 steps. Strategy A clears old tool results (keeping the last 3); strategy B compacts the history into a structured summary when the context passes a threshold. After compaction we check that the facts a later step needs are still present.</p>',
    src: String.raw`import json, re
import anthropic
try:
    import httpx2 as httpx
except ImportError:
    import httpx

def ntok(x) -> int:
    return len(json.dumps(x)) // 4

# ---- fake model that writes a structured summary from what it is sent ----
def fake_api(request):
    body = json.loads(request.content)
    text = json.dumps(body["messages"])
    constraints = sorted(set(re.findall(r"CONSTRAINT: ([^\"\\]+)", text)))
    decisions = sorted(set(re.findall(r"DECIDED: ([^\"\\]+)", text)))
    failing = sorted(set(re.findall(r"table (\d+) failed", text)) - set(re.findall(r"table (\d+) fixed", text)), key=int)
    summary = ("<summary>GOAL: migrate billing tables to Postgres 16\nCONSTRAINTS: " + "; ".join(constraints) +
               "\nDECISIONS: " + "; ".join(decisions) + f"\nOPEN: tables {', '.join(failing)} still failing" +
               "\nNEXT: fix the open tables, then run the row-count check</summary>")
    return httpx.Response(200, json={"id": "m", "type": "message", "role": "assistant", "model": body["model"],
        "content": [{"type": "text", "text": summary}], "stop_reason": "end_turn", "stop_sequence": None,
        "usage": {"input_tokens": ntok(body["messages"]), "output_tokens": ntok(summary)}})
client = anthropic.Anthropic(api_key="test", http_client=httpx.Client(transport=httpx.MockTransport(fake_api)))
# ---------------------------------------------------------------------------

def session(steps=30):
    """A synthetic agent transcript: each step = assistant tool call + user tool result."""
    msgs = [{"role": "user", "content": "Migrate the billing tables. CONSTRAINT: never touch the prod_billing schema"}]
    for i in range(1, steps + 1):
        note = {5: "DECIDED: batch size 5000 because 20000 timed out", 12: "table 18 failed FK check", 14: "table 44 failed FK check",
                17: "table 18 fixed", 21: "table 71 failed FK check", 25: "DECIDED: run row-count check before cutover"}.get(i, "")
        msgs.append({"role": "assistant", "content": f"step {i}: run migrate_batch({i})"})
        msgs.append({"role": "user", "content": f"result {i}: " + "rows copied ok; " * 160 + note})
    return msgs

def clear_tool_results(msgs, keep=3):
    results = [k for k, m in enumerate(msgs) if m["content"].startswith("result")]
    out = [dict(m) for m in msgs]
    for k in results[:-keep]:
        out[k]["content"] = "[old tool result cleared]"
    return out

def compact(msgs, keep_recent=4, threshold=8_000):
    if ntok(msgs) < threshold:
        return msgs
    old, recent = msgs[:-keep_recent], msgs[-keep_recent:]
    resp = client.messages.create(model="claude-haiku-5-5", max_tokens=600, system="Summarise for a colleague who continues the work.",
                                  messages=old + [{"role": "assistant", "content": "ok"}, {"role": "user", "content": "Write the <summary>."}])
    return [{"role": "user", "content": "Summary of earlier work:\n" + resp.content[0].text}] + recent

msgs = session()
cleared, compacted = clear_tool_results(msgs), compact(msgs)
print(f"original      : {ntok(msgs):>6} tokens, {len(msgs)} messages")
print(f"clear results : {ntok(cleared):>6} tokens (kept last 3 results)")
print(f"compacted     : {ntok(compacted):>6} tokens, {len(compacted)} messages\n")
print(compacted[0]["content"])
needed = ["prod_billing", "5000", "44", "71", "row-count"]
print("\nfacts a later step needs, still present after compaction:", {f: f in json.dumps(compacted) for f in needed})
print("same facts after clearing tool results only:            ", {f: f in json.dumps(cleared) for f in needed})`
  },
  lab: {
    title: 'A compaction regression test', file: 'compaction_test_lab.py', browser: true,
    scenario: `<p>Your team is changing the summary prompt and the threshold. Before shipping, you need an automated test that catches lossy compaction. Build a test harness: generate sessions with planted facts of different kinds (constraints, numeric decisions, ids, open questions), run a compactor, and score which facts survive. Compare a naive compactor (keeps the first sentence of each old message) with a structured one that extracts tagged facts.</p>`,
    steps: ['Write <code class="i">make_session(seed)</code> that plants 6 facts at random positions among 60 filler messages, each tagged by kind, and returns (messages, facts).', 'Write <code class="i">naive_compact</code>: keep the first 60 characters of each old message plus the last 4 messages verbatim.', 'Write <code class="i">structured_compact</code>: scan old messages for lines starting with CONSTRAINT:, DECIDED:, ID:, OPEN: and keep them verbatim in sections, plus the last 4 messages.', 'Score each compactor over 50 seeds: survival rate per fact kind and tokens after compaction.', 'Print a table and a pass/fail against a 98% survival requirement.'],
    checks: ['The structured compactor passes the requirement; the naive one fails.', 'Token counts after compaction are reported for both.', 'Results are reproducible across runs.'],
    hints: ['Plant facts mid-message too, so the naive first-60-characters rule misses some.', 'Survival means the exact fact string appears in the compacted text.'],
    starter: String.raw`import random
KINDS = ["CONSTRAINT", "DECIDED", "ID", "OPEN"]

def make_session(seed):
    rng = random.Random(seed)
    # TODO: 60 filler messages, 6 planted facts; return messages, facts
    return [], []

def naive_compact(msgs, keep=4):
    return msgs

def structured_compact(msgs, keep=4):
    return msgs

# TODO: score over 50 seeds`,
    solution: String.raw`import random
from collections import defaultdict
KINDS = ["CONSTRAINT", "DECIDED", "ID", "OPEN"]
FILLER = "checked logs, nothing unusual, continuing with the next batch of rows"

def make_session(seed):
    rng = random.Random(seed)
    msgs = [f"msg {i}: {FILLER}" for i in range(60)]
    facts = []
    for j in range(6):
        kind = rng.choice(KINDS)
        fact = f"{kind}: item-{seed}-{j} value {rng.randint(100, 999)}"
        pos = rng.randint(0, 50)                                    # never in the last messages
        if rng.random() < 0.5:
            msgs[pos] = f"{fact}\n{msgs[pos]}"                       # at the start of a message
        else:
            msgs[pos] = f"{msgs[pos]}\n{fact}"                       # buried after filler
        facts.append((kind, fact))
    return msgs, facts

def naive_compact(msgs, keep=4):
    old, recent = msgs[:-keep], msgs[-keep:]
    return "SUMMARY: " + " | ".join(m[:60] for m in old) + "\n" + "\n".join(recent)

def structured_compact(msgs, keep=4):
    old, recent = msgs[:-keep], msgs[-keep:]
    sections = defaultdict(list)
    for m in old:
        for line in m.splitlines():
            for k in KINDS:
                if line.startswith(k + ":"):
                    sections[k].append(line)
    body = "\n".join(f"{k}S:\n  " + "\n  ".join(sections[k]) for k in KINDS if sections[k])
    return f"<summary>\n{body}\n</summary>\n" + "\n".join(recent)

def score(compactor, seeds=range(50)):
    survived, total, tokens = defaultdict(int), defaultdict(int), []
    for s in seeds:
        msgs, facts = make_session(s)
        text = compactor(msgs)
        tokens.append(len(text) // 4)
        for kind, fact in facts:
            total[kind] += 1; survived[kind] += fact in text
    rates = {k: survived[k] / total[k] for k in KINDS if total[k]}
    overall = sum(survived.values()) / sum(total.values())
    return rates, overall, sum(tokens) / len(tokens)

original = sum(len("\n".join(make_session(s)[0])) // 4 for s in range(50)) / 50
print(f"original session: ~{original:.0f} tokens\n")
print(f"{'compactor':<12}" + "".join(f"{k:>12}" for k in KINDS) + f"{'overall':>10}{'tokens':>8}  verdict")
for name, fn in [("naive", naive_compact), ("structured", structured_compact)]:
    rates, overall, tok = score(fn)
    print(f"{name:<12}" + "".join(f"{rates.get(k, 0):>12.0%}" for k in KINDS) + f"{overall:>10.0%}{tok:>8.0f}  {'PASS' if overall >= 0.98 else 'FAIL'}")`
  },
  design: {
    lead: '<p>Compaction is lossy compression on the critical path of long tasks. Treat summaries as data with a schema, test them for information loss, and keep the originals somewhere retrievable.</p>',
    scale: [{ h: 'Cheap summariser', p: 'Summaries can use a smaller, faster model; the instructions and schema matter more than model size.' }, { h: 'Cache awareness', p: 'Compaction and clearing change the prefix and invalidate cached tokens; clear in larger chunks less often so caching still pays.' }],
    fail: [{ h: 'Constraint drift', p: 'User instructions paraphrased into vagueness get violated later. Carry constraints verbatim.' }, { h: 'Summary of a summary', p: 'Repeated compaction compounds loss. Keep facts in structured sections that are merged, not re-summarised, each time.' }],
    trade: [{ h: 'Clearing vs compacting', p: 'Clearing tool results is cheap and safe for outputs already used; compaction saves more but loses nuance.' }, { h: 'Provider feature vs your own', p: 'Server-side compaction is easy to adopt; your own gives control over the schema, tests and storage of originals.' }],
    prompt: '<p>Design compaction for a coding agent whose sessions run for hours across hundreds of tool calls.</p>',
    answer: '<ul><li>Clear tool results beyond the last few; keep file reads retrievable via the file system rather than in context.</li><li>Compact at about 75% of budget into a structured summary with constraints verbatim, decisions, files touched and next steps.</li><li>Persist progress notes and the full transcript to disk (6.3) so nothing is truly lost.</li><li>Regression tests that plant facts and check survival; monitor post-compaction error rates.</li></ul>'
  },
  quiz: [
    { q: 'What should trigger compaction?', o: ['Every 10 turns', 'Approaching a token threshold of the budget', 'Each new user message', 'Errors'], a: 1, why: 'Turn counts do not track token growth; thresholds do.' },
    { q: 'Which content must be carried forward verbatim?', o: ['Greetings', 'User constraints and exact ids or values', 'Filler logs', 'Old tool outputs'], a: 1, why: 'Paraphrased constraints and numbers cause errors later.' },
    { q: 'Why keep the last few turns verbatim after compaction?', o: ['To use more tokens', 'They hold the immediate context and tone the next step depends on', 'Summaries cannot include them', 'For caching'], a: 1, why: 'Recent detail matters most for the next action.' }
  ],
  interview: [
    { q: 'How do you keep a long-running agent within its context window?', a: '<p>Measure growth per section; clear tool results the model has already used; offload large outputs to files and keep references; compact history at a threshold into a structured summary with constraints and ids carried verbatim, keeping recent turns; and use sub-agents for noisy exploration. Then test that critical facts survive compaction.</p>' },
    { q: 'How would you test a summarisation-based compaction step?', a: '<p>Generate sessions with planted facts of each kind at random positions, compact, and measure exact survival per kind and the token reduction. Gate prompt or threshold changes on a survival target, and check task-level evals after compaction for regressions.</p>' }
  ]
});

/* ===================================================================== 6.3 */
L({
  id: '6.3', title: 'Offloading to files and state', minutes: 45, roles: ['be', 'fde'],
  tags: 'scratchpad files · structured notes · progress files · memory tool · references not payloads · path safety',
  mental: 'Context is working memory; files are long-term storage the agent controls. Write large outputs, notes and progress to files, keep only short references and summaries in context, and read back exactly the slice you need when you need it.',
  intro: `<p>Coding agents do this naturally: they do not paste whole repositories into context, they read files on demand. The same idea works for any agent: a 40,000-token query result becomes a file plus a 200-token summary; decisions and progress live in a notes file the agent re-reads at the start of each session. Anthropic\u2019s API includes a file-based memory tool for exactly this pattern, letting the model create, read and edit files in a memory directory that your application stores.</p>`,
  points: [
    'Large tool outputs go to files; the tool returns a path, size and short preview instead of the payload.',
    'Give the agent precise read tools: line ranges, search (grep), head and tail, so it fetches slices, not whole files.',
    'Structured notes (NOTES.md, progress.json, todo lists) persist decisions and state across compactions and sessions.',
    'Keep files per user and task; treat the directory as data with retention and access rules.',
    'Validate every path: no traversal outside the allowed directory, no symlink tricks, size limits on writes.',
    'Files are also how sub-agents and later sessions share results without sharing context.'
  ],
  concept: { title: 'References, not payloads', body: `<p>Instead of carrying a heavy box everywhere, you put it in a locker and carry the key. The context holds keys: \u201cresults in /work/q3_orders.csv, 48,213 rows, columns region, amount, status; top regions EMEA and AMER\u201d. When the agent needs a detail, it opens the locker and takes out only that item.</p>` },
  walk: [
    { h: 'Wrap big results', body: '<p>A tool wrapper decides: small results inline, large ones to a file with a preview.</p>', code: String.raw`def offload(name: str, payload: str, inline_limit: int = 2_000) -> str:
    if len(payload) <= inline_limit:
        return payload
    path = WORKDIR / f"{name}.txt"
    path.write_text(payload)
    lines = payload.splitlines()
    return f"Saved {len(lines)} lines to {path.name}. First lines:\n" + "\n".join(lines[:5]) + "\nUse read_file(path, start, end) or grep_file(path, pattern)."` },
    { h: 'Keep a notes file', body: '<p>Instruct the agent to update NOTES.md after each milestone: goal, decisions, current state, next steps. At the start of a session or after compaction, it reads NOTES.md first.</p>' },
    { h: 'Use the provider\u2019s memory tool where it fits', body: '<p>With the memory tool, the model issues file commands (view, create, edit and so on) against a memory directory, and your code executes them on your storage. You own where the files live and must enforce path safety, as the lab does.</p>' }
  ],
  analogy: `<p><b>A detective\u2019s case board and filing cabinet.</b> The board shows the key facts and open leads (notes in context). The cabinet holds every statement and photo (files). The detective pulls a folder when a lead needs it, and the board survives the weekend when the detective goes home (session reset).</p>`,
  diagram: {
    title: 'Offloading large outputs and state',
    cols: [['agent'], ['tool'], ['fs', 'ctx'], ['read']],
    nodes: [
      { id: 'agent', label: 'Agent', sub: 'context window', tone: 'fde', info: 'Holds references and summaries, not payloads.' },
      { id: 'tool', label: 'Tool wrapper', sub: 'inline or offload', tone: 'acc', info: 'Small results inline; large ones written to files with a preview.' },
      { id: 'fs', label: 'Work directory', sub: 'files · NOTES.md · progress', tone: 'be', info: 'Per task and user; path-checked; retained by policy.' },
      { id: 'ctx', label: 'Reference', sub: 'path · size · preview', tone: 'ok', info: 'A few hundred tokens instead of tens of thousands.' },
      { id: 'read', label: 'Slice reads', sub: 'lines · grep · head', info: 'The agent fetches only the part it needs.' }
    ],
    edges: [{ a: 'agent', b: 'tool', step: 1 }, { a: 'tool', b: 'fs', label: 'payload', step: 2 }, { a: 'tool', b: 'ctx', label: 'pointer', step: 2 }, { a: 'ctx', b: 'agent', dash: true, bend: -60, step: 3 }, { a: 'agent', b: 'read', dash: true, bend: 50, step: 4 }, { a: 'read', b: 'fs', step: 4 }],
    steps: ['The agent calls a tool that produces a large result.', 'The payload goes to a file; a pointer goes to context.', 'The agent sees path, size and a preview.', 'Later it reads exactly the slice it needs.'],
    caption: 'Payloads in files, pointers in context.'
  },
  illustrated: { title: 'Tokens with and without offloading', body: `<div class="tbl"><table><thead><tr><th>step</th><th>inline</th><th>offloaded</th></tr></thead><tbody>
    <tr><td>query returns 48,000 rows</td><td class="n">\u2248 60,000 tokens in context</td><td class="n">\u2248 250 tokens (path, columns, preview)</td></tr>
    <tr><td>agent needs EMEA totals</td><td>already in context, buried</td><td>grep_file(\u201cEMEA\u201d) \u2192 \u2248 900 tokens</td></tr>
    <tr><td>next 20 steps</td><td>60,000 tokens re-sent each step</td><td>a few hundred re-sent</td></tr></tbody></table></div>` },
  code: {
    title: 'An offloading tool layer with slice reads and notes', file: 'offload.py', browser: true,
    intro: '<p>A small file toolkit for agents: an offloading wrapper, <code class="i">read_file</code> with line ranges, <code class="i">grep_file</code>, and a notes file. A simulated agent session compares context size when a big query result is kept inline versus offloaded.</p>',
    src: String.raw`import os, re, tempfile, json, random

WORK = tempfile.mkdtemp(prefix="agent-work-")
ntok = lambda s: len(s) // 4

def safe(path: str) -> str:
    full = os.path.realpath(os.path.join(WORK, path))
    if not full.startswith(os.path.realpath(WORK) + os.sep):
        raise PermissionError(f"path outside work dir: {path}")
    return full

def offload(name: str, payload: str, inline_limit: int = 2_000) -> str:
    if len(payload) <= inline_limit:
        return payload
    with open(safe(name), "w") as f:
        f.write(payload)
    lines = payload.splitlines()
    return (f"Saved {len(lines)} lines ({ntok(payload)} tokens) to {name}. Header and first rows:\n" + "\n".join(lines[:4]) +
            f"\nUse read_file('{name}', start, end) or grep_file('{name}', pattern).")

def read_file(path: str, start: int = 1, end: int = 50) -> str:
    with open(safe(path)) as f:
        lines = f.read().splitlines()
    return "\n".join(f"{i}: {l}" for i, l in enumerate(lines[start - 1:end], start))

def grep_file(path: str, pattern: str, limit: int = 20) -> str:
    with open(safe(path)) as f:
        hits = [f"{i}: {l}" for i, l in enumerate(f, 1) if re.search(pattern, l)]
    more = f"\n... {len(hits) - limit} more matches" if len(hits) > limit else ""
    return "".join(h if h.endswith("\n") else h + "\n" for h in hits[:limit]) + more

def update_notes(section: str, text: str):
    path = safe("NOTES.md"); notes = open(path).read() if os.path.exists(path) else "# NOTES\n"
    notes += f"\n## {section}\n{text}\n"
    open(path, "w").write(notes)

random.seed(4)
rows = ["order_id,region,amount,status"] + [f"o{i},{random.choice(['EMEA', 'AMER', 'APAC'])},{random.randint(10, 900)},{random.choice(['paid', 'refunded'])}" for i in range(12_000)]
big_result = "\n".join(rows)

inline_ctx = big_result
pointer = offload("q3_orders.csv", big_result)
print(pointer, "\n")
emea_refunds = grep_file("q3_orders.csv", r",EMEA,\d+,refunded", limit=3)
print("grep EMEA refunded (first 3):\n" + emea_refunds)
print("read lines 2-4:\n" + read_file("q3_orders.csv", 2, 4))
update_notes("Q3 refunds", "Data in q3_orders.csv (12,000 rows). Next: total refunded amount per region.")
print("\ncontext tokens if inline:", ntok(inline_ctx), "| with offloading:", ntok(pointer) + ntok(emea_refunds))
try:
    read_file("../../etc/passwd")
except PermissionError as e:
    print("blocked:", e)`
  },
  lab: {
    title: 'A safe memory directory tool', file: 'memory_dir_lab.py', browser: true,
    scenario: `<p>You are implementing the server side of a file-based memory tool for an agent: the model sends commands (view, create, str_replace, insert, delete) with paths under <code class="i">/memories</code>, and your code executes them on per-user storage. Security review requires: no access outside the user\u2019s directory, file size limits, and clear errors. Implement the command handler and attack it with traversal attempts.</p>`,
    steps: ['Map <code class="i">/memories/...</code> to a per-user directory on disk; reject anything that resolves outside it (including <code class="i">..</code>, absolute paths and URL-encoded tricks).', '<code class="i">view</code>: directory listing or file contents with line numbers.', '<code class="i">create</code>: write a file (max 20 KB); <code class="i">str_replace</code>: replace a unique string, error if absent or not unique; <code class="i">insert</code>: insert text at a line; <code class="i">delete</code>: remove a file.', 'Return strings the model can read; never raise raw exceptions to the model.', 'Run a scripted session plus five attack paths.'],
    checks: ['The normal session ends with the expected file content.', 'All five attacks are rejected.', 'A non-unique str_replace returns an error explaining why.'],
    hints: ['<code class="i">urllib.parse.unquote</code> before resolving catches <code class="i">%2e%2e</code>.', 'Compare <code class="i">os.path.realpath</code> results, with a trailing separator on the root.'],
    starter: String.raw`import os, tempfile, urllib.parse
ROOT = tempfile.mkdtemp()

def resolve(user: str, path: str) -> str:
    # TODO: map /memories/... to ROOT/user/..., reject escapes
    return path

def handle(user: str, cmd: dict) -> str:
    # TODO: view, create, str_replace, insert, delete
    return "not implemented"

session = [
    {"command": "create", "path": "/memories/customer_acme.md", "file_text": "# Acme\n- plan: Pro\n- contact: Priya\n"},
    {"command": "str_replace", "path": "/memories/customer_acme.md", "old_str": "plan: Pro", "new_str": "plan: Enterprise"},
    {"command": "insert", "path": "/memories/customer_acme.md", "insert_line": 3, "insert_text": "- renewal: 2027-03-01"},
    {"command": "view", "path": "/memories/customer_acme.md"},
]
for c in session:
    print(handle("u1", c))`,
    solution: String.raw`import os, tempfile, urllib.parse
ROOT = tempfile.mkdtemp()
MAX_BYTES = 20_000

class Reject(Exception):
    pass

def resolve(user: str, path: str) -> str:
    path = urllib.parse.unquote(path)
    if path != "/memories" and not path.startswith("/memories/"):
        raise Reject("paths must start with /memories")
    base = os.path.realpath(os.path.join(ROOT, user))
    os.makedirs(base, exist_ok=True)
    full = os.path.realpath(os.path.join(base, path[len("/memories"):].lstrip("/")))
    if full != base and not full.startswith(base + os.sep):
        raise Reject("path escapes the memory directory")
    return full

def handle(user: str, cmd: dict) -> str:
    try:
        p, c = resolve(user, cmd["path"]), cmd["command"]
        if c == "view":
            if os.path.isdir(p):
                return "Directory:\n" + "\n".join(sorted(os.listdir(p))) or "(empty)"
            lines = open(p).read().splitlines()
            return "\n".join(f"{i:>3}| {l}" for i, l in enumerate(lines, 1))
        if c == "create":
            text = cmd["file_text"]
            if len(text.encode()) > MAX_BYTES:
                return f"Error: file larger than {MAX_BYTES} bytes"
            os.makedirs(os.path.dirname(p), exist_ok=True); open(p, "w").write(text)
            return f"Created {cmd['path']}"
        if c == "str_replace":
            text = open(p).read(); n = text.count(cmd["old_str"])
            if n != 1:
                return f"Error: old_str found {n} times; it must appear exactly once"
            open(p, "w").write(text.replace(cmd["old_str"], cmd["new_str"]))
            return f"Edited {cmd['path']}"
        if c == "insert":
            lines = open(p).read().splitlines()
            lines.insert(cmd["insert_line"], cmd["insert_text"]); open(p, "w").write("\n".join(lines) + "\n")
            return f"Inserted at line {cmd['insert_line']}"
        if c == "delete":
            os.remove(p); return f"Deleted {cmd['path']}"
        return f"Error: unknown command {c}"
    except Reject as e:
        return f"Error: {e}"
    except FileNotFoundError:
        return f"Error: {cmd.get('path')} does not exist"

session = [
    {"command": "create", "path": "/memories/customer_acme.md", "file_text": "# Acme\n- plan: Pro\n- contact: Priya\n"},
    {"command": "str_replace", "path": "/memories/customer_acme.md", "old_str": "plan: Pro", "new_str": "plan: Enterprise"},
    {"command": "insert", "path": "/memories/customer_acme.md", "insert_line": 3, "insert_text": "- renewal: 2027-03-01"},
    {"command": "str_replace", "path": "/memories/customer_acme.md", "old_str": "-", "new_str": "*"},
    {"command": "view", "path": "/memories/customer_acme.md"},
]
for c in session:
    print(f"{c['command']:<12} -> {handle('u1', c)}")
print("\nattacks:")
for path in ["/memories/../u2/secrets.md", "/memories/%2e%2e/%2e%2e/etc/passwd", "/etc/passwd", "/memories/../../x", "/memoriesX/../u2/a.md"]:
    print(f"  {path:<38} -> {handle('u1', {'command': 'view', 'path': path})}")`
  },
  design: {
    lead: '<p>Agent file systems turn context management into storage management: per-user isolation, retention, quotas and security reviews, just like any other user data store.</p>',
    scale: [{ h: 'Storage backend', p: 'Local disk for single-node agents; object storage or a database-backed virtual file system for multi-node deployments, keyed by tenant, user and task.' }, { h: 'Quotas and retention', p: 'Cap files and bytes per task; expire work directories after the task, keep notes per policy.' }],
    fail: [{ h: 'Path traversal', p: 'A model (or an injected instruction) asking for ../../ must never reach other users\u2019 files or the host. Resolve and check every path.' }, { h: 'Poisoned notes', p: 'Notes written from untrusted content can carry instructions into later sessions. Label sources and keep policy outside notes.' }],
    trade: [{ h: 'Files vs database state', p: 'Files are natural for models to read and write; databases give queries, transactions and access control. Many systems use files as the interface and a database underneath.' }, { h: 'Inline vs offload threshold', p: 'Offloading small results adds extra read calls; offloading large ones saves tokens. Tune the threshold from transcripts.' }],
    prompt: '<p>Design state management for a research agent that runs for hours across several sessions and produces a 30-page report.</p>',
    answer: '<ul><li>Per-task work directory: sources/, notes/NOTES.md, drafts/ per section, progress.json.</li><li>Search and fetch tools save pages to sources/ and return pointers with summaries.</li><li>Each session starts by reading NOTES.md and progress.json; ends by updating them.</li><li>Path-safe tools, quotas, retention; the final report assembled from drafts, not from context.</li></ul>'
  },
  quiz: [
    { q: 'A tool returns 50,000 tokens of rows. The best default is:', o: ['Put all rows in context', 'Save them to a file and return path, size and a short preview', 'Drop them', 'Summarise without saving'], a: 1, why: 'Pointers in context, payload retrievable on demand.' },
    { q: 'Why must a memory file tool resolve paths with realpath and check the prefix?', o: ['For speed', 'To stop traversal outside the user\u2019s directory, including encoded and symlink tricks', 'To compress files', 'Models require it'], a: 1, why: 'Path safety is a core security control.' },
    { q: 'What belongs in a NOTES.md for a long task?', o: ['Every tool output', 'Goal, decisions, current state and next steps', 'The system prompt', 'API keys'], a: 1, why: 'Compact, durable state for the next session.' }
  ],
  interview: [
    { q: 'How do agents work with data far bigger than their context window?', a: '<p>They treat the context as working memory and files or databases as storage: tools write large outputs to files and return pointers with previews, the agent reads slices with line ranges and search, keeps structured notes of decisions and progress, and delegates heavy reading to sub-agents that return summaries.</p>' },
    { q: 'What security issues come with giving an agent a file system?', a: '<p>Path traversal and symlink escapes, cross-user access, unbounded writes, sensitive data persisting longer than intended, and poisoned notes carrying injected instructions into later sessions. Mitigate with per-user roots, realpath checks, quotas, retention, provenance labels and keeping policy outside writable files.</p>' }
  ]
});

/* ===================================================================== 6.4 */
L({
  id: '6.4', title: 'Sub-agents', minutes: 45, roles: ['be', 'fde'],
  tags: 'context isolation · delegation tool · condensed returns · typed reports · parallel exploration · budgets',
  mental: 'A sub-agent is a context firewall: it does noisy work (reading 30 files, running 15 searches) in its own window and returns a short, structured report. The parent\u2019s context grows by the size of the report, not the size of the work.',
  intro: `<p>Lesson 5.5 used multiple agents for parallel breadth. Here the motive is context hygiene. Even a single sequential task benefits from delegating exploration: \u201cfind where invoice totals are computed\u201d might take 25 tool calls and 80,000 tokens of file reads, yet the parent only needs three file paths and a two-line explanation.</p>
  <p>Coding agents use this heavily: the main agent spawns explorers, test runners or reviewers with their own instructions and tools, and receives only their conclusions.</p>`,
  points: [
    'Expose delegation as a tool, for example <code class="i">delegate(task, tools, budget)</code>, that runs a fresh agent loop and returns its report.',
    'The sub-agent starts with a clean context: only its brief and its own system prompt and tools.',
    'Require a typed, size-limited report (findings, evidence pointers, confidence, open questions).',
    'Give sub-agents the minimum tools they need, often read-only, which also limits damage from injected content.',
    'Budget each delegation (steps and tokens); report budget exhaustion as a result, not an exception.',
    'The parent should verify important claims cheaply, for example by reading the specific lines the report points to.'
  ],
  concept: { title: 'Send a scout, get a map', body: `<p>A general does not march the whole army into every valley. A scout explores, comes back, and hands over a sketch map with the three things that matter. The general\u2019s attention stays on the campaign. The sketch is only useful if it is accurate and specific, which is why the report format matters as much as the scout.</p>` },
  walk: [
    { h: 'The delegation tool', body: '<p>To the parent model it is just another tool. Inside, it runs a whole agent loop.</p>', code: String.raw`class Report(BaseModel):
    answer: str = Field(max_length=600)
    evidence: list[str] = Field(max_length=8)     # file:line pointers, URLs, record ids
    confidence: Literal["high", "medium", "low"]
    open_questions: list[str] = []

def delegate(task: str, allowed_tools: list[str], max_steps: int = 20) -> Report:
    sub = Agent(system=EXPLORER_PROMPT, tools=pick(allowed_tools), output_type=Report)
    return sub.run(task, max_steps=max_steps)` },
    { h: 'Write the brief like a ticket', body: '<p>Objective, scope boundaries, what to return, and what not to do (\u201cdo not edit files\u201d). Vague briefs produce vague reports and duplicated work.</p>' },
    { h: 'Verify cheaply', body: '<p>When a report says \u201ctotals are computed in billing/totals.py lines 40 to 72\u201d, the parent reads those lines before acting. Evidence pointers make verification cheap.</p>' }
  ],
  analogy: `<p><b>A partner at a law firm with associates.</b> The associate reads 2,000 pages of discovery and writes a two-page memo with citations. The partner reads the memo, checks two key citations, and decides strategy. The partner never needed the 2,000 pages in their head.</p>`,
  diagram: {
    title: 'Context firewall with a sub-agent',
    cols: [['parent'], ['tool'], ['sub'], ['work'], ['rep']],
    groups: [{ cols: [2, 3], label: 'SUB-AGENT CONTEXT (discarded)' }],
    nodes: [
      { id: 'parent', label: 'Parent agent', sub: 'main context', tone: 'fde', info: 'Keeps the plan and decisions; grows slowly.' },
      { id: 'tool', label: 'delegate()', sub: 'brief · tools · budget', tone: 'acc', info: 'A tool that starts a fresh agent loop.' },
      { id: 'sub', label: 'Sub-agent', sub: 'clean context', tone: 'be', info: 'Its own system prompt and restricted tools.' },
      { id: 'work', label: 'Noisy work', sub: '25 calls · 80k tokens', tone: 'warn', info: 'File reads, searches, dead ends: stays here.' },
      { id: 'rep', label: 'Typed report', sub: '≈ 400 tokens · evidence', tone: 'ok', info: 'All the parent receives.' }
    ],
    edges: [{ a: 'parent', b: 'tool', step: 1 }, { a: 'tool', b: 'sub', step: 2 }, { a: 'sub', b: 'work', step: 3 }, { a: 'work', b: 'rep', step: 4 }, { a: 'rep', b: 'parent', dash: true, bend: -70, step: 5 }],
    steps: ['The parent decides to delegate.', 'A fresh sub-agent starts with a brief.', 'It does the noisy work in its own context.', 'It writes a short typed report.', 'Only the report enters the parent\u2019s context.'],
    caption: 'The parent pays for the report, not the exploration.'
  },
  illustrated: { title: 'Parent context growth', body: `<div class="tbl"><table><thead><tr><th>task phase</th><th>single agent</th><th>with sub-agents</th></tr></thead><tbody>
    <tr><td>explore codebase</td><td class="n">+80k</td><td class="n">+0.5k (report)</td></tr>
    <tr><td>check three libraries\u2019 docs</td><td class="n">+45k</td><td class="n">+1.2k (3 reports)</td></tr>
    <tr><td>implement and test</td><td class="n">+30k</td><td class="n">+30k (done by parent)</td></tr>
    <tr><td>parent context at the end</td><td class="n">\u2248 160k</td><td class="n">\u2248 36k</td></tr></tbody></table></div>
    <p>Total tokens across all agents may be similar or higher; the win is a parent that stays focused and within budget.</p>` },
  code: {
    title: 'Delegation with typed reports, measured', file: 'subagents.py', browser: true,
    intro: '<p>A parent works through a task that needs three explorations. Each exploration is a simulated sub-agent loop that reads many files (seeded sizes) and returns a validated <code class="i">Report</code>. We compare the parent\u2019s context with and without delegation, and show a sub-agent that runs out of budget returning a partial report instead of crashing.</p>',
    src: String.raw`import random
from typing import Literal
from pydantic import BaseModel, Field

class Report(BaseModel):
    answer: str = Field(max_length=300)
    evidence: list[str] = Field(max_length=6)
    confidence: Literal["high", "medium", "low"]
    budget_exhausted: bool = False

ntok = lambda s: len(s) // 4

def explore(task: str, rng: random.Random, max_steps: int) -> tuple[Report, int, list[str]]:
    """Simulated sub-agent loop: reads files until it finds the answer or runs out of steps."""
    transcript, found_at = [], rng.randint(4, 14)
    for step in range(1, max_steps + 1):
        path = f"src/module_{rng.randint(1, 80)}.py"
        transcript.append(f"read_file({path}) -> " + "code line\n" * rng.randint(150, 600))
        if step == found_at:
            rep = Report(answer=f"{task}: implemented in {path}, function compute(), lines 40-72",
                         evidence=[f"{path}:40-72", "tests/test_totals.py:12"], confidence="high")
            return rep, sum(map(ntok, transcript)), transcript
    rep = Report(answer=f"{task}: not found within {max_steps} steps; searched {len(transcript)} files",
                 evidence=[t.split(" ->")[0] for t in transcript[-3:]], confidence="low", budget_exhausted=True)
    return rep, sum(map(ntok, transcript)), transcript

rng = random.Random(7)
tasks = ["where invoice totals are computed", "how tax is rounded", "where currency conversion happens"]
parent_inline, parent_delegated, sub_total = 2_000, 2_000, 0
for i, t in enumerate(tasks):
    report, tokens, transcript = explore(t, rng, max_steps=8 if i == 2 else 20)
    parent_inline += tokens                                  # without delegation, every read lands in the parent
    parent_delegated += ntok(report.model_dump_json())       # with delegation, only the report does
    sub_total += tokens
    print(f"[{report.confidence:<6}] steps={len(transcript):>2} sub-agent tokens={tokens:>6} | {report.answer[:72]}")
print(f"\nparent context without delegation: {parent_inline:,} tokens")
print(f"parent context with delegation   : {parent_delegated:,} tokens (sub-agents used {sub_total:,} in their own windows)")`
  },
  lab: {
    title: 'Briefs, budgets and verification', file: 'delegate_lab.py', browser: true,
    scenario: `<p>A parent agent must answer \u201cWhich of our 6 services still call the deprecated payments API?\u201d. Implement <code class="i">delegate</code> that runs one sub-agent per service in sequence with a step budget, validates each report, and then verify reports by checking their evidence against the (simulated) repository. One sub-agent hallucinates evidence; your verification must catch it.</p>`,
    steps: ['The starter provides a fake repository (files per service with or without <code class="i">payments_v1</code> calls) and a fake sub-agent.', 'Validate each report with Pydantic; invalid reports count as failures.', 'Verify: every evidence pointer <code class="i">file:line</code> must exist and contain <code class="i">payments_v1</code>.', 'Mark verified, unverified, or failed per service; compute the final answer only from verified reports.', 'Print the per-service table and the final answer.'],
    checks: ['The hallucinated report is marked unverified.', 'The final list contains only services with verified evidence.', 'Parent context used is reported (sum of report sizes).'],
    hints: ['Split evidence on \u201c:\u201d to get file and line.', 'Treat a report claiming \u201cno calls\u201d with high confidence as verified only if a scan of that service finds none (cheap check).'],
    starter: String.raw`import random
from typing import Literal
from pydantic import BaseModel, Field, ValidationError

REPO = {}
for svc in ["checkout", "invoicing", "refunds", "reports", "notifications", "admin"]:
    for f in range(3):
        lines = ["def handler():", "    return ok()"] * 10
        if svc in ("checkout", "refunds") and f == 1:
            lines[7] = "    payments_v1.charge(order)"
        REPO[f"{svc}/file{f}.py"] = lines

class Report(BaseModel):
    service: str
    uses_deprecated: bool
    evidence: list[str] = Field(max_length=5)
    confidence: Literal["high", "medium", "low"]

def fake_subagent(service):
    if service == "reports":                         # hallucinates
        return {"service": service, "uses_deprecated": True, "evidence": ["reports/file2.py:8"], "confidence": "high"}
    hits = [f"{p}:{i + 1}" for p, ls in REPO.items() if p.startswith(service) for i, l in enumerate(ls) if "payments_v1" in l]
    return {"service": service, "uses_deprecated": bool(hits), "evidence": hits, "confidence": "high"}

# TODO: delegate, verify, final answer`,
    solution: String.raw`import json
from typing import Literal
from pydantic import BaseModel, Field, ValidationError

REPO = {}
for svc in ["checkout", "invoicing", "refunds", "reports", "notifications", "admin"]:
    for f in range(3):
        lines = ["def handler():", "    return ok()"] * 10
        if svc in ("checkout", "refunds") and f == 1:
            lines[7] = "    payments_v1.charge(order)"
        REPO[f"{svc}/file{f}.py"] = lines

class Report(BaseModel):
    service: str
    uses_deprecated: bool
    evidence: list[str] = Field(max_length=5)
    confidence: Literal["high", "medium", "low"]

def fake_subagent(service):
    if service == "reports":
        return {"service": service, "uses_deprecated": True, "evidence": ["reports/file2.py:8"], "confidence": "high"}
    hits = [f"{p}:{i + 1}" for p, ls in REPO.items() if p.startswith(service) for i, l in enumerate(ls) if "payments_v1" in l]
    return {"service": service, "uses_deprecated": bool(hits), "evidence": hits, "confidence": "high"}

def delegate(service):
    try:
        return Report.model_validate(fake_subagent(service)), None
    except ValidationError as e:
        return None, str(e.errors()[0]["msg"])

def verify(r: Report) -> bool:
    if r.uses_deprecated:
        for ev in r.evidence:
            path, _, line = ev.rpartition(":")
            lines = REPO.get(path)
            if not lines or not line.isdigit() or int(line) > len(lines) or "payments_v1" not in lines[int(line) - 1]:
                return False
        return bool(r.evidence)
    return not any("payments_v1" in l for p, ls in REPO.items() if p.startswith(r.service) for l in ls)   # cheap scan

parent_tokens, rows, confirmed = 0, [], []
for svc in sorted({p.split("/")[0] for p in REPO}):
    report, err = delegate(svc)
    if err:
        rows.append((svc, "failed", err)); continue
    parent_tokens += len(report.model_dump_json()) // 4
    ok = verify(report)
    rows.append((svc, "verified" if ok else "UNVERIFIED", f"uses_deprecated={report.uses_deprecated} evidence={report.evidence}"))
    if ok and report.uses_deprecated:
        confirmed.append(svc)
for r in rows:
    print(f"{r[0]:<14} {r[1]:<11} {r[2]}")
print("\nservices still calling payments_v1 (verified only):", confirmed)
print("parent context spent on reports:", parent_tokens, "tokens")`
  },
  design: {
    lead: '<p>Sub-agents trade total tokens for focus and safety. Design their interface like an internal API: a brief, a restricted toolset, a budget, and a typed, verifiable result.</p>',
    scale: [{ h: 'Model tiers', p: 'Exploration sub-agents can often use a smaller model; the parent keeps the stronger model for decisions.' }, { h: 'Parallel when independent', p: 'Independent delegations run concurrently (5.5); dependent ones run in sequence with the earlier reports in the brief.' }],
    fail: [{ h: 'Telephone game', p: 'Reports that paraphrase without evidence lose precision at each hop. Require pointers to sources.' }, { h: 'Over-delegation', p: 'Spawning a sub-agent for a one-call lookup adds latency and tokens. Delegate exploration, not trivial steps.' }],
    trade: [{ h: 'Isolation vs shared context', p: 'Isolation keeps the parent clean but the sub-agent misses context the parent has. Put essential context in the brief.' }, { h: 'Read-only vs write sub-agents', p: 'Read-only explorers are safe to run freely; sub-agents that write need the same approvals as the parent.' }],
    prompt: '<p>A coding agent must upgrade a library across a 400-file repository. Where do sub-agents help?</p>',
    answer: '<ul><li>Explorer sub-agents per package find usages and return file:line lists, read-only.</li><li>The parent plans changes from verified reports; edits happen in the parent or in write-enabled sub-agents per package with tests as verifiers.</li><li>A reviewer sub-agent checks diffs against the upgrade guide.</li><li>Budgets per sub-agent; the parent context stays focused on plan, progress and test results.</li></ul>'
  },
  quiz: [
    { q: 'What is the main benefit of a sub-agent for a sequential task?', o: ['Fewer total tokens always', 'Keeping noisy exploration out of the parent\u2019s context', 'Faster models', 'No tools needed'], a: 1, why: 'Context isolation: the parent sees only the report.' },
    { q: 'Why include evidence pointers in a sub-agent report?', o: ['For formatting', 'So the parent can cheaply verify claims before acting', 'To use more tokens', 'Pydantic requires it'], a: 1, why: 'Verifiable reports beat confident prose.' },
    { q: 'A sub-agent hits its step budget. It should:', o: ['Crash the run', 'Return a partial report marked as budget-exhausted with what it found', 'Keep going', 'Delete its transcript'], a: 1, why: 'Budget exhaustion is a result the parent can act on.' }
  ],
  interview: [
    { q: 'How do sub-agents help with context limits?', a: '<p>They run noisy work such as reading many files or doing many searches in a separate context and return a short typed report with evidence. The parent\u2019s context grows by the report size, so it stays within budget and focused. Total tokens may rise, so I use them for exploration-heavy steps and cheaper models where evals allow.</p>' },
    { q: 'How do you make sub-agent output trustworthy?', a: '<p>Typed reports validated in code, required evidence pointers, restricted tools, budgets, and cheap verification of key claims by the parent before acting. I also treat report content as data, since sub-agents may have read untrusted material.</p>' }
  ]
});

/* ===================================================================== 6.5 */
L({
  id: '6.5', title: 'Agent skills', minutes: 45, roles: ['fde', 'be'],
  tags: 'SKILL.md · YAML frontmatter · progressive disclosure · bundled scripts and references · open standard · skill design',
  mental: 'A skill is a folder of instructions, scripts and references that an agent loads only when a task needs it. Only a short name and description sit in context all the time; the full instructions and files come in on demand. Skills package procedural knowledge the way MCP packages tools.',
  intro: `<p>Agents need know-how as well as tools: how this customer formats board reports, the steps of a deployment checklist, the right way to fill a tax form. Putting all of that in the system prompt bloats every call. Anthropic introduced Agent Skills in October 2025 and published the format as an open standard in December 2025; by late 2026 many agent products and coding tools load skills in the same format.</p>
  <p>For FDEs, skills are a practical way to encode a customer\u2019s processes once and reuse them across their agents, with version control and review like any other code.</p>`,
  points: [
    'A skill is a directory with a <code class="i">SKILL.md</code> file: YAML frontmatter (<code class="i">name</code>, <code class="i">description</code>) plus Markdown instructions; optional scripts, references and assets.',
    '<b>Progressive disclosure</b>: level 1 is the name and description for every skill (always in context); level 2 is the SKILL.md body (loaded when relevant); level 3 is bundled files (loaded only when the body points to them).',
    'The description decides when a skill triggers: say what it does and when to use it, specifically.',
    'Keep SKILL.md focused and short; move long references into separate files the agent reads only if needed.',
    'Scripts let the agent run deterministic code instead of re-deriving steps, saving tokens and errors.',
    'Skills are code: review them, version them, and treat third-party skills as untrusted, since their instructions and scripts run with the agent\u2019s permissions.'
  ],
  concept: { title: 'A shelf of manuals with good spines', body: `<p>An expert does not memorise every manual. They know which manuals exist from the spines on the shelf (names and descriptions), pull the right one when a task comes up (load SKILL.md), and open an appendix only when a step needs it (references and scripts). Good skills, like good manuals, have clear spines and short main chapters.</p>` },
  walk: [
    { h: 'A minimal skill', body: '<p>The frontmatter is what the agent sees up front; the body is loaded on demand.</p>', lang: 'bash', file: 'skills/board-report/SKILL.md', code: String.raw`---
name: board-report
description: Build Acme's monthly board report from finance exports. Use when asked for a board pack, monthly KPIs for the board, or investor update numbers.
---
# Board report
1. Run scripts/load_exports.py on the CSVs in the request.
2. Compute the KPIs defined in references/kpi_definitions.md (read it only if a KPI is unclear).
3. Use the section order: Summary, Revenue, Burn, Hiring, Risks.
4. Numbers in millions with one decimal; flag any KPI that moved more than 10% month on month.` },
    { h: 'Load progressively', body: '<p>At startup, a loader reads only the frontmatter of every skill into the system prompt. When the model decides a skill applies, it reads SKILL.md (often via a file-read tool), then any referenced files it needs.</p>' },
    { h: 'Write the description like a search query match', body: '<p>Good: \u201cBuild Acme\u2019s monthly board report from finance exports. Use when asked for a board pack, monthly KPIs\u2026\u201d Bad: \u201cHelps with reports.\u201d Vague descriptions trigger on the wrong tasks or never.</p>' }
  ],
  analogy: `<p><b>Recipe cards in a professional kitchen.</b> The chef knows the list of dishes by name. When an order comes in, the cook pulls that dish\u2019s card, follows it, and checks the sauce sub-recipe on the back only if needed. New dishes are added as new cards, without retraining the whole kitchen.</p>`,
  diagram: {
    title: 'Progressive disclosure of skills',
    cols: [['meta'], ['task'], ['body'], ['refs', 'scripts'], ['done']],
    nodes: [
      { id: 'meta', label: 'Level 1: metadata', sub: 'name + description · all skills', tone: 'acc', info: 'About a hundred tokens per skill, always in context.' },
      { id: 'task', label: 'Task arrives', sub: 'matches a description', tone: 'fde', info: 'The model decides a skill is relevant.' },
      { id: 'body', label: 'Level 2: SKILL.md', sub: 'instructions', tone: 'be', info: 'Loaded only for the relevant skill.' },
      { id: 'refs', label: 'Level 3: references', sub: 'read if needed', info: 'Long documents the body points to.' },
      { id: 'scripts', label: 'Scripts', sub: 'run, not read', tone: 'ok', info: 'Deterministic code executed by the agent; only output enters context.' },
      { id: 'done', label: 'Result', sub: 'consistent process', info: 'The customer\u2019s procedure, followed the same way every time.' }
    ],
    edges: [{ a: 'meta', b: 'task', step: 1 }, { a: 'task', b: 'body', step: 2 }, { a: 'body', b: 'refs', dash: true, step: 3 }, { a: 'body', b: 'scripts', step: 3 }, { a: 'refs', b: 'done', step: 4 }, { a: 'scripts', b: 'done', step: 4 }],
    steps: ['Every skill\u2019s name and description is visible.', 'A matching task loads one SKILL.md.', 'References are read and scripts run only if needed.', 'The procedure completes consistently.'],
    caption: 'Cheap to know a skill exists; pay for its details only when used.'
  },
  illustrated: { title: 'Token cost of 40 skills', body: `<div class="tbl"><table><thead><tr><th>approach</th><th>tokens in every call</th><th>tokens when one skill is used</th></tr></thead><tbody>
    <tr><td>everything in the system prompt (40 \u00d7 3k)</td><td class="n">\u2248 120,000</td><td class="n">\u2248 120,000</td></tr>
    <tr><td>progressive disclosure (40 \u00d7 \u2248100 metadata)</td><td class="n">\u2248 4,000</td><td class="n">\u2248 4,000 + 3,000 body + references if read</td></tr></tbody></table></div>` },
  code: {
    title: 'A skill loader with validation and progressive disclosure', file: 'skills.py', browser: true,
    intro: '<p>Creates three skills on disk, validates their frontmatter against the published format rules (name up to 64 lowercase letters, digits and hyphens; description up to 1,024 characters), builds the level-1 system prompt section, then simulates a task that loads one skill\u2019s body and one reference, with token counts at each level. A simple keyword match stands in for the model\u2019s choice of skill.</p>',
    src: String.raw`import os, re, tempfile

ROOT = tempfile.mkdtemp(prefix="skills-")
SKILLS = {
    "board-report": ("Build Acme's monthly board report from finance exports. Use when asked for a board pack, monthly KPIs or investor update numbers.",
                     "# Board report\n1. Run scripts/load_exports.py on the CSVs.\n2. KPI definitions: references/kpis.md (read only if a KPI is unclear).\n3. Sections: Summary, Revenue, Burn, Hiring, Risks.\n" + "Detail line.\n" * 60,
                     {"references/kpis.md": "ARR: annualised recurring revenue...\n" * 120, "scripts/load_exports.py": "print('loaded')\n"}),
    "refund-policy": ("Apply Acme's refund rules to a customer case. Use when deciding whether and how much to refund.",
                      "# Refunds\nDuplicate charges: full refund. Annual plans: pro rata within 6 months.\n" + "Rule detail.\n" * 40, {}),
    "Bad Skill": ("helps", "body", {}),
}
for name, (desc, body, files) in SKILLS.items():
    d = os.path.join(ROOT, name.lower().replace(" ", "-") if name != "Bad Skill" else "bad-skill")
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "SKILL.md"), "w").write(f"---\nname: {name}\ndescription: {desc}\n---\n{body}")
    for rel, content in files.items():
        os.makedirs(os.path.dirname(os.path.join(d, rel)), exist_ok=True); open(os.path.join(d, rel), "w").write(content)

ntok = lambda s: max(1, len(s) // 4)

def parse(path):
    text = open(path).read()
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    meta = dict(line.split(": ", 1) for line in m.group(1).splitlines())
    return meta, m.group(2)

def validate(meta, folder):
    errs = []
    if not re.fullmatch(r"[a-z0-9-]{1,64}", meta.get("name", "")): errs.append("name must be 1-64 lowercase letters, digits or hyphens")
    if meta.get("name") != os.path.basename(folder): errs.append("name should match the folder name")
    desc = meta.get("description", "")
    if not 1 <= len(desc) <= 1024: errs.append("description must be 1-1024 characters")
    if "use when" not in desc.lower(): errs.append("description should say when to use the skill")
    return errs

registry = {}
for folder in sorted(os.listdir(ROOT)):
    meta, body = parse(os.path.join(ROOT, folder, "SKILL.md"))
    errs = validate(meta, folder)
    print(f"{folder:<14} {'OK' if not errs else 'REJECTED: ' + '; '.join(errs)}")
    if not errs:
        registry[meta["name"]] = {"desc": meta["description"], "dir": os.path.join(ROOT, folder), "body": body}

level1 = "Available skills (read SKILL.md before using one):\n" + "\n".join(f"- {n}: {s['desc']}" for n, s in registry.items())
print(f"\nlevel 1, in every request: {ntok(level1)} tokens\n{level1}\n")

task = "Prepare the October board pack from these exports; also explain ARR."
chosen = max(registry, key=lambda n: len(set(re.findall(r"\w+", task.lower())) & set(re.findall(r"\w+", registry[n]["desc"].lower()))))
body = registry[chosen]["body"]
print(f"task -> skill '{chosen}' | level 2 body: {ntok(body)} tokens")
if "ARR" in task and "references/kpis.md" in body:
    ref = open(os.path.join(registry[chosen]["dir"], "references/kpis.md")).read()
    print(f"body points to references/kpis.md and the task needs a KPI definition -> level 3: {ntok(ref)} tokens")
everything = sum(ntok(s["body"]) for s in registry.values()) + ntok(ref)
print(f"\nloaded for this task: {ntok(level1) + ntok(body) + ntok(ref)} tokens vs {everything + ntok(level1)} if everything sat in the system prompt")`
  },
  lab: {
    title: 'Write and lint a customer skill', file: 'skill_lint_lab.py', browser: true,
    scenario: `<p>Encode a customer\u2019s enterprise onboarding checklist as a skill, and build the linter their platform team will run in CI on every skill pull request. The linter must enforce the format rules and good practice: specific description with a \u201cuse when\u201d clause, body under 500 lines, every file the body references exists, scripts referenced are executable Python files, and no obvious secrets.</p>`,
    steps: ['Write the skill files in a temp folder: SKILL.md (frontmatter and steps), <code class="i">references/sso_matrix.md</code>, <code class="i">scripts/check_domain.py</code>.', 'Implement <code class="i">lint(skill_dir)</code> returning a list of findings with severities (error or warning).', 'Rules: frontmatter name and description format; name matches folder; description mentions when to use; body under 500 lines; referenced <code class="i">references/</code> and <code class="i">scripts/</code> paths exist; scripts parse as Python; no strings that look like API keys.', 'Run the linter on your skill (expect zero errors) and on a deliberately broken copy (missing reference, a fake key, vague description).'],
    checks: ['Your skill passes with no errors.', 'The broken copy reports each planted problem.', 'Findings name the file and rule.'],
    hints: ['Find references with a regex like <code class="i">(references|scripts)/[\\w./-]+</code>.', 'Use <code class="i">ast.parse</code> to check scripts and a pattern like <code class="i">sk-[A-Za-z0-9]{20,}</code> for keys.'],
    starter: String.raw`import ast, os, re, shutil, tempfile

def write_skill(root):
    d = os.path.join(root, "enterprise-onboarding")
    os.makedirs(os.path.join(d, "references")); os.makedirs(os.path.join(d, "scripts"))
    # TODO: write SKILL.md, references/sso_matrix.md, scripts/check_domain.py
    return d

def lint(skill_dir):
    # TODO
    return []

root = tempfile.mkdtemp()
d = write_skill(root)
print(lint(d))`,
    solution: String.raw`import ast, os, re, shutil, tempfile

SKILL_MD = """---
name: enterprise-onboarding
description: Run Acme's enterprise customer onboarding checklist (SSO, SCIM, data residency, admin training). Use when a new enterprise contract is signed or someone asks to onboard an enterprise workspace.
---
# Enterprise onboarding
1. Verify the customer's email domain with scripts/check_domain.py.
2. Choose the SSO setup from references/sso_matrix.md based on their identity provider.
3. Enable SCIM only after SSO login works for two admins.
4. Confirm data residency region in writing before importing users.
5. Book admin training; record the date in the CRM.
"""

def write_skill(root, broken=False):
    d = os.path.join(root, "enterprise-onboarding")
    os.makedirs(os.path.join(d, "references")); os.makedirs(os.path.join(d, "scripts"))
    md = SKILL_MD
    if broken:
        md = md.replace("description: Run Acme's", "description: Onboarding helper. Run Acme's").replace("Use when a new", "For a new")
        md += "\nTemporary token for testing: sk-abcdefghijklmnopqrstuvwxyz123456\n"
    open(os.path.join(d, "SKILL.md"), "w").write(md)
    if not broken:
        open(os.path.join(d, "references", "sso_matrix.md"), "w").write("| IdP | protocol |\n| Okta | SAML |\n| Entra ID | SAML or OIDC |\n")
    open(os.path.join(d, "scripts", "check_domain.py"), "w").write("import sys\nprint(sys.argv[1].endswith('.com'))\n")
    return d

def lint(skill_dir):
    out = []
    text = open(os.path.join(skill_dir, "SKILL.md")).read()
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        return [("error", "SKILL.md", "missing YAML frontmatter")]
    meta = dict(l.split(": ", 1) for l in m.group(1).splitlines() if ": " in l); body = m.group(2)
    name, desc = meta.get("name", ""), meta.get("description", "")
    if not re.fullmatch(r"[a-z0-9-]{1,64}", name): out.append(("error", "SKILL.md", "name format"))
    if name != os.path.basename(skill_dir): out.append(("error", "SKILL.md", "name must match folder"))
    if not 1 <= len(desc) <= 1024: out.append(("error", "SKILL.md", "description length"))
    if "use when" not in desc.lower(): out.append(("warning", "SKILL.md", "description lacks a 'use when' clause"))
    if len(body.splitlines()) > 500: out.append(("warning", "SKILL.md", "body over 500 lines: move detail to references/"))
    for ref in sorted(set(re.findall(r"(?:references|scripts)/[\w./-]+\w", body))):
        p = os.path.join(skill_dir, ref)
        if not os.path.exists(p):
            out.append(("error", ref, "referenced file does not exist")); continue
        if ref.startswith("scripts/") and ref.endswith(".py"):
            try: ast.parse(open(p).read())
            except SyntaxError as e: out.append(("error", ref, f"script does not parse: {e.msg}"))
    for root, _, files in os.walk(skill_dir):
        for f in files:
            if re.search(r"sk-[A-Za-z0-9]{20,}", open(os.path.join(root, f)).read()):
                out.append(("error", os.path.relpath(os.path.join(root, f), skill_dir), "looks like an API key"))
    return out

for label, broken in [("good skill", False), ("broken copy", True)]:
    root = tempfile.mkdtemp()
    findings = lint(write_skill(root, broken))
    print(f"{label}: {sum(f[0] == 'error' for f in findings)} errors, {sum(f[0] == 'warning' for f in findings)} warnings")
    for sev, where, msg in findings:
        print(f"   {sev:<8} {where:<28} {msg}")
    shutil.rmtree(root)`
  },
  design: {
    lead: '<p>Skills are a distribution format for organisational know-how. Manage them like a package registry: ownership, review, versioning, testing, and security scanning.</p>',
    scale: [{ h: 'Skill catalogues', p: 'Dozens of skills are cheap thanks to progressive disclosure; hundreds need grouping per agent or role so level-1 metadata stays small.' }, { h: 'Shared across products', p: 'Because the format is an open standard, one reviewed skill can serve several agents and tools in the customer\u2019s estate.' }],
    fail: [{ h: 'Malicious or careless skills', p: 'A third-party skill\u2019s instructions and scripts run with the agent\u2019s permissions. Allow-list sources, review code, scan for secrets and network calls.' }, { h: 'Description collisions', p: 'Two skills with overlapping descriptions trigger unpredictably. Lint for overlap as with tools (5.2).' }],
    trade: [{ h: 'Skill vs tool vs MCP server', p: 'Skills carry know-how and scripts; tools and MCP servers carry capabilities and live data. Many tasks use a skill that tells the agent how to use certain tools.' }, { h: 'Skill vs system prompt', p: 'Always-relevant rules belong in the system prompt; task-specific procedures belong in skills.' }],
    prompt: '<p>A bank wants its 30 operational procedures available to an internal agent. How do you package and govern them?</p>',
    answer: '<ul><li>One skill per procedure, owned by the procedure\u2019s team, with precise descriptions and short bodies; long policy text in references.</li><li>Deterministic checks as scripts (validators, calculators) rather than prose.</li><li>Git repository with CI lint, review by compliance, versioned releases; agents load only approved versions.</li><li>Eval tasks per skill to catch trigger and procedure regressions.</li></ul>'
  },
  quiz: [
    { q: 'What is always in the agent\u2019s context under progressive disclosure?', o: ['All SKILL.md bodies', 'Each skill\u2019s name and description', 'All scripts', 'Nothing'], a: 1, why: 'Level-1 metadata only; bodies and files load on demand.' },
    { q: 'Which description is best?', o: ['"Helps with reports"', '"Build Acme\u2019s monthly board report from finance exports. Use when asked for a board pack or monthly KPIs."', '"board"', '"Very useful skill"'], a: 1, why: 'Specific about what and when.' },
    { q: 'Why include scripts in a skill?', o: ['To make it longer', 'Deterministic steps run reliably and only their output enters context', 'Scripts are required', 'For styling'], a: 1, why: 'Code is cheaper and more reliable than re-deriving steps in prose.' }
  ],
  interview: [
    { q: 'What are agent skills and why use them?', a: '<p>Folders with a SKILL.md (name, description, instructions) plus optional scripts and references. Agents see only names and descriptions until a task needs a skill, then load its instructions and files progressively. They package procedural know-how reusably without bloating every request, and the format is an open standard supported by many agent products.</p>' },
    { q: 'How would you govern skills in an enterprise?', a: '<p>Treat them as code: owners, repositories, CI linting for format, references and secrets, security review of scripts, versioned releases, allow-listed sources for third-party skills, and evals that check each skill triggers on the right tasks and produces correct results.</p>' }
  ]
});

/* ===================================================================== 6.6 */
L({
  id: '6.6', title: 'Long-horizon harnesses', minutes: 55, roles: ['be', 'fde'],
  tags: 'multi-session agents · initializer and worker sessions · feature lists · progress files · git as memory · verify before advancing',
  mental: 'For work that takes many context windows (hours or days), the harness, not the model, provides continuity: a durable task list, a progress log, version control, and a fixed routine for every session: get bearings, pick one item, do it, verify it, record it, leave things clean.',
  intro: `<p>Some tasks outlast any context window: building an application, migrating a codebase, a week-long research project. Anthropic described a harness pattern for long-running coding agents in late 2025: a first <b>initializer</b> session sets up the environment, a detailed feature list and a progress file; every later <b>worker</b> session reads those, works on one feature, tests it end to end, commits, and updates the progress file. Without this structure, agents tended to attempt everything at once or declare victory early.</p>
  <p>The same pattern generalises beyond coding to any long project an FDE might hand to agents.</p>`,
  points: [
    'Separate the first session (set up environment, write the task list, create progress notes) from worker sessions.',
    'Keep the task list in a structured file (for example JSON with id, description, steps, passes) that workers update but never delete from.',
    'Every session starts the same way: read progress notes and recent history (for example git log), run a quick health check, then choose the next item.',
    'Work on one item at a time; mark it done only after verification (tests, end-to-end checks).',
    'End every session with a clean, committed state and an updated progress file, so the next session can start cold.',
    'Fix regressions first: if a health check shows a previously passing item broken, repair it before new work.'
  ],
  concept: { title: 'Shift handover in a hospital', body: `<p>Nurses work in shifts, but patient care is continuous. It works because of rituals: a structured handover, a chart that every shift reads and updates, checks before any new intervention, and nothing left half-done without a note. A long-horizon harness gives agents the same rituals, so that each fresh context window behaves like a well-briefed new shift rather than an amnesiac.</p>` },
  walk: [
    { h: 'The durable artefacts', body: '<p>Three files and the version history carry all continuity.</p>', lang: 'bash', file: 'workspace/', code: String.raw`features.json        # [{"id": "F07", "desc": "user can reset password", "steps": [...], "passes": false}, ...]
progress.md          # what each session did, decisions, known issues, next suggestions
init.sh              # how to start the app and run the test suite
git log              # one commit per completed item, with a descriptive message` },
    { h: 'The session routine', body: '<p>Written into the worker\u2019s prompt or a skill (6.5), so every session follows it.</p>', code: String.raw`1. Read progress.md and the last 20 lines of git log.
2. Run init.sh and the smoke test. If anything that passed before now fails, fix that first.
3. Pick the highest-priority feature with passes=false. Work only on it.
4. Verify it end to end. Only then set passes=true.
5. Commit with a clear message, append to progress.md, leave the tree clean.` },
    { h: 'Guard the task list', body: '<p>Workers may only flip <code class="i">passes</code> and append notes; they cannot remove or rewrite items. That stops a struggling agent from \u201cfinishing\u201d by deleting the hard parts.</p>' }
  ],
  analogy: `<p><b>Building a house with different crews each day.</b> The site manager keeps the plan (feature list), the site diary (progress notes) and inspection sign-offs (verification). Each morning\u2019s crew reads the diary, checks yesterday\u2019s work still stands, does one job properly, gets it inspected and writes up the diary. Nobody tears out the plumbing plan because it looked hard.</p>`,
  diagram: {
    title: 'Initializer and worker sessions around durable state',
    cols: [['init'], ['state'], ['w1', 'w2', 'w3'], ['done']],
    groups: [{ cols: [1], label: 'DURABLE STATE' }],
    nodes: [
      { id: 'init', label: 'Initializer session', sub: 'env · task list · notes', tone: 'acc', info: 'Runs once: sets up the environment, writes features.json, progress.md, init.sh, first commit.' },
      { id: 'state', label: 'features.json · progress.md · git', sub: 'shared across sessions', tone: 'be', info: 'The only memory that survives context resets.' },
      { id: 'w1', label: 'Worker session 1', sub: 'bearings → 1 item → verify', tone: 'fde', info: 'Reads state, health-checks, does one item, verifies, commits, notes.' },
      { id: 'w2', label: 'Worker session 2', sub: 'fresh context', info: 'Starts cold from the files, not from memory.' },
      { id: 'w3', label: 'Worker session N', sub: 'regressions first', info: 'If something broke, fixes it before new work.' },
      { id: 'done', label: 'All items pass', sub: 'verified', tone: 'ok', info: 'Completion is a property of the task list, not a claim by the agent.' }
    ],
    edges: [{ a: 'init', b: 'state', step: 1 }, { a: 'state', b: 'w1', step: 2 }, { a: 'state', b: 'w2', step: 3 }, { a: 'state', b: 'w3', step: 4 }, { a: 'w1', b: 'state', dash: true, bend: 40 }, { a: 'w3', b: 'done', step: 5 }],
    steps: ['The initializer creates the durable state.', 'Each worker reads it, does one verified item and writes back.', 'The next worker starts cold from the same files.', 'Regressions are fixed before new work.', 'The project is done when every item passes verification.'],
    caption: 'Continuity lives in files and history, not in any one context window.'
  },
  illustrated: { title: 'Failure modes the routine prevents', body: `<div class="tbl"><table><thead><tr><th>failure</th><th>without the harness</th><th>with it</th></tr></thead><tbody>
    <tr><td>one-shotting</td><td>agent attempts the whole app in one session, runs out of context mid-way</td><td>one item per session</td></tr>
    <tr><td>premature victory</td><td>\u201cdone!\u201d with half the features missing</td><td>done only when all items pass verification</td></tr>
    <tr><td>amnesia</td><td>new session re-does or undoes earlier work</td><td>reads progress and git log first</td></tr>
    <tr><td>silent regressions</td><td>new work breaks old features unnoticed</td><td>smoke test at session start, fix first</td></tr></tbody></table></div>` },
  code: {
    title: 'A multi-session harness, simulated end to end', file: 'harness.py', browser: true,
    intro: '<p>A simulated project of 8 features worked by a sequence of fresh \u201csessions\u201d that share only files: features.json and progress.md in a work directory. A seeded fake worker sometimes fails verification, occasionally breaks an earlier feature, and one session crashes mid-way. The harness routine (bearings, regressions first, one item, verify, record) still converges, and the task list cannot be shrunk.</p>',
    src: String.raw`import json, os, random, tempfile

WORK = tempfile.mkdtemp(prefix="harness-")
FEATURES, PROGRESS = os.path.join(WORK, "features.json"), os.path.join(WORK, "progress.md")

def initializer():
    feats = [{"id": f"F{i:02d}", "desc": d, "priority": i, "passes": False} for i, d in enumerate(
        ["sign up", "log in", "reset password", "create project", "invite member", "upload file", "search", "export CSV"], 1)]
    json.dump(feats, open(FEATURES, "w"), indent=1)
    open(PROGRESS, "w").write("# progress\nsession 0: initialised 8 features\n")

def save_features(old, new):
    assert [f["id"] for f in new] == [f["id"] for f in old], "workers may not add, remove or reorder features"
    json.dump(new, open(FEATURES, "w"), indent=1)

def worker_session(n, rng, crash=False):
    feats = json.load(open(FEATURES)); before = json.loads(json.dumps(feats))
    notes = open(PROGRESS).read().splitlines()[-3:]                      # 1) bearings from files only
    broken = [f for f in feats if f["passes"] and rng.random() < 0.05]    # 2) smoke test finds regressions
    for f in broken:
        f["passes"] = False
    target = broken[0] if broken else next((f for f in sorted(feats, key=lambda f: f["priority"]) if not f["passes"]), None)
    if target is None:
        return "nothing left"
    if crash:
        return f"crashed while working on {target['id']} (nothing recorded; next session starts cold)"
    verified = rng.random() < 0.75                                        # 3) one item, 4) verify end to end
    target["passes"] = verified
    save_features(before, feats)                                          # 5) record
    line = f"session {n}: {'fixed regression' if broken else 'worked'} {target['id']} -> {'PASS' if verified else 'failed verification, retry next'}"
    open(PROGRESS, "a").write(line + "\n")
    return line

rng = random.Random(11)
initializer()
session = 0
while not all(f["passes"] for f in json.load(open(FEATURES))) and session < 40:
    session += 1
    print(worker_session(session, rng, crash=(session == 4)))

feats = json.load(open(FEATURES))
print(f"\nall {len(feats)} features pass after {session} sessions:", all(f["passes"] for f in feats))
try:                                                                      # a struggling worker tries to 'finish' by deleting work
    save_features(feats, [f for f in feats if f["id"] != "F07"])
except AssertionError as e:
    print("blocked:", e)`
  },
  lab: {
    title: 'The session-start routine', file: 'session_start_lab.py', browser: true,
    scenario: `<p>Implement the part of the harness that every worker session runs first. Given features.json, the last test results, and the git-style log, produce a session brief: what changed since last time, any regressions (items marked passing whose tests now fail), and the single next item to work on, with reasons. The brief is what goes into the fresh context window.</p>`,
    steps: ['Inputs in the starter: features (id, priority, passes, depends_on), test results per feature from the smoke run, and a list of recent commits.', 'Regressions: features with passes=True whose test result is fail. They go first, highest priority first.', 'Otherwise pick the highest-priority feature with passes=False whose dependencies all pass.', 'If nothing is eligible but items remain, report a blocked state listing what blocks what.', 'Render a brief under 1,500 characters: last 3 commits, regressions, next item and why.'],
    checks: ['With a regression present, the brief targets it.', 'A feature whose dependency fails is never chosen.', 'The brief stays under the size limit.'],
    hints: ['Compute eligibility with all(passes[d] for d in depends_on).', 'Keep the brief factual; it will be read by a model with no other memory.'],
    starter: String.raw`features = [
    {"id": "F01", "desc": "sign up", "priority": 1, "passes": True, "depends_on": []},
    {"id": "F02", "desc": "log in", "priority": 2, "passes": True, "depends_on": ["F01"]},
    {"id": "F03", "desc": "reset password", "priority": 3, "passes": False, "depends_on": ["F02"]},
    {"id": "F04", "desc": "create project", "priority": 4, "passes": True, "depends_on": ["F02"]},
    {"id": "F05", "desc": "invite member", "priority": 5, "passes": False, "depends_on": ["F04"]},
    {"id": "F06", "desc": "export CSV", "priority": 6, "passes": False, "depends_on": ["F07"]},
    {"id": "F07", "desc": "search", "priority": 7, "passes": False, "depends_on": []},
]
smoke = {"F01": "pass", "F02": "pass", "F04": "fail"}
commits = ["a1f: F04 create project passes e2e", "9c2: refactor auth middleware", "77d: F02 log in passes e2e", "3be: init"]

def session_brief(features, smoke, commits, limit=1500):
    # TODO
    return ""

print(session_brief(features, smoke, commits))`,
    solution: String.raw`features = [
    {"id": "F01", "desc": "sign up", "priority": 1, "passes": True, "depends_on": []},
    {"id": "F02", "desc": "log in", "priority": 2, "passes": True, "depends_on": ["F01"]},
    {"id": "F03", "desc": "reset password", "priority": 3, "passes": False, "depends_on": ["F02"]},
    {"id": "F04", "desc": "create project", "priority": 4, "passes": True, "depends_on": ["F02"]},
    {"id": "F05", "desc": "invite member", "priority": 5, "passes": False, "depends_on": ["F04"]},
    {"id": "F06", "desc": "export CSV", "priority": 6, "passes": False, "depends_on": ["F07"]},
    {"id": "F07", "desc": "search", "priority": 7, "passes": False, "depends_on": []},
]
smoke = {"F01": "pass", "F02": "pass", "F04": "fail"}
commits = ["a1f: F04 create project passes e2e", "9c2: refactor auth middleware", "77d: F02 log in passes e2e", "3be: init"]

def session_brief(features, smoke, commits, limit=1500):
    by_id = {f["id"]: f for f in features}
    regressions = sorted((f for f in features if f["passes"] and smoke.get(f["id"]) == "fail"), key=lambda f: f["priority"])
    passing = {f["id"]: f["passes"] and smoke.get(f["id"], "pass") != "fail" for f in features}
    todo = sorted((f for f in features if not passing[f["id"]] and f not in regressions), key=lambda f: f["priority"])
    eligible = [f for f in todo if all(passing[d] for d in f["depends_on"])]
    blocked = [f"{f['id']} waits on {[d for d in f['depends_on'] if not passing[d]]}" for f in todo if f not in eligible]
    lines = ["SESSION BRIEF", "Recent commits: " + " | ".join(commits[:3])]
    lines.append(f"Status: {sum(passing.values())}/{len(features)} features passing.")
    if regressions:
        r = regressions[0]
        lines.append(f"REGRESSION: {r['id']} ({r['desc']}) was passing but its smoke test now fails. Possible cause: '{commits[1]}'.")
        lines.append(f"NEXT: fix {r['id']} before any new work. Do not start other features this session.")
    elif eligible:
        n = eligible[0]
        lines.append(f"NEXT: {n['id']} ({n['desc']}), highest priority with all dependencies passing.")
    else:
        lines.append("BLOCKED: no eligible features. " + "; ".join(blocked))
    if blocked:
        lines.append("Blocked items: " + "; ".join(blocked))
    lines.append("Rules: one item only; verify end to end before setting passes=true; commit and update progress.md.")
    brief = "\n".join(lines)
    return brief[:limit]

b = session_brief(features, smoke, commits)
print(b)
print(f"\n({len(b)} characters)")
fixed = dict(smoke, F04="pass")
print("\nafter the regression is fixed:\n" + session_brief([dict(f) for f in features], fixed, ["e10: fix F04 after auth refactor"] + commits).split("\n")[3])`
  },
  design: {
    lead: '<p>Long-horizon agents are a workflow-engineering problem. The model does the work in bounded sessions; the harness provides memory, ordering, verification and recovery, and is where most of the reliability comes from.</p>',
    scale: [{ h: 'Sessions as jobs', p: 'Each worker session is a job with its own budget; a scheduler starts the next when the previous ends, possibly in parallel on independent items in separate branches.' }, { h: 'Cost visibility', p: 'Track tokens and time per completed item; long projects can spend a lot, so budgets and kill switches matter.' }],
    fail: [{ h: 'Weak verification', p: 'If \u201cpasses\u201d is whatever the agent claims, the harness converges on fiction. Verification must be executable: tests, end-to-end checks, or human review.' }, { h: 'Environment drift', p: 'Broken setup scripts waste every session. The health check and init script are part of the deliverable.' }],
    trade: [{ h: 'One item per session vs batching', p: 'One item per session is slower but robust; batching saves overhead and risks half-finished work at context limits.' }, { h: 'Single agent vs specialised sessions', p: 'Specialised sessions (tester, reviewer, cleaner) can raise quality; a single worker routine is simpler to reason about.' }],
    prompt: '<p>A customer wants agents to migrate 300 internal reports from a legacy BI tool to a new one over two weeks. Design the harness.</p>',
    answer: '<ul><li>Initializer inventories reports into reports.json (id, owner, source query, priority, passes) and writes the migration playbook as a skill.</li><li>Worker sessions: read progress, smoke-test recently migrated reports, migrate one report, verify numbers against the legacy output on sample dates, commit, update progress.</li><li>Regressions first; reports failing verification twice go to a human queue.</li><li>Dashboard of passes, failures, cost per report; owners sign off in batches.</li></ul>'
  },
  quiz: [
    { q: 'What carries continuity between worker sessions?', o: ['The model\u2019s memory', 'Durable files and version history (task list, progress notes, commits)', 'A bigger context window', 'The system prompt only'], a: 1, why: 'Each session starts with a fresh context; files persist.' },
    { q: 'Why may workers not delete items from the task list?', o: ['JSON cannot shrink', 'To stop an agent from \u201cfinishing\u201d by removing hard work', 'For speed', 'Git forbids it'], a: 1, why: 'Completion must mean all original items pass verification.' },
    { q: 'At session start, a previously passing feature fails its smoke test. What next?', o: ['Ignore it and continue', 'Fix the regression before starting new work', 'Delete the feature', 'Start a new project'], a: 1, why: 'Regressions first keeps the project converging.' }
  ],
  interview: [
    { q: 'How would you build an agent that works on a project for days?', a: '<p>Split it into an initializer session that sets up the environment, a structured task list and progress notes, and repeated worker sessions with a fixed routine: read notes and history, run health checks, fix regressions first, do one item, verify it end to end, commit and update notes. Continuity lives in files and version control; completion is defined by verified items, not the agent\u2019s claim.</p>' },
    { q: 'What makes long-running agents fail, and how do harnesses help?', a: '<p>They try to do everything at once, lose context mid-task, forget earlier work, declare victory early and break things unnoticed. A harness constrains scope per session, externalises memory, enforces verification and regression checks, and makes every session start from a known state.</p>' }
  ]
});
})();

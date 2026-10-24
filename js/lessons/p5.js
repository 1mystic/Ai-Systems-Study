/* Phase 5 · Agents (part 1: 5.1–5.5) */
(function () {
const L = AISA.lesson;
const FAKE_NOTE = '<p class="callout"><b>Runs without a key</b> The SDK is real; only the network is replaced by a local fake model that plans tool calls from the conversation so far, so every step is visible and repeatable. Delete the fake and set your API key to run against the real service.</p>';

/* ===================================================================== 5.1 */
L({
  id: '5.1', title: 'The agent loop by hand', minutes: 55, roles: ['fde', 'be'],
  tags: 'perceive-decide-act loop · stop conditions · step and token budgets · loop detection · transcripts',
  mental: 'An agent is the tool-calling loop from lesson 3.4 where the model, not your code, decides the sequence of steps. Your code owns everything around the model: the budget, the stop conditions, safety checks on each action, and a transcript of what happened.',
  intro: `<p>Frameworks hide the loop, and hidden loops are hard to debug at 2 a.m. with a customer on the phone. Writing it by hand once, in about sixty lines, shows you exactly what every agent framework does: call the model, run the tools it asks for, append the results, repeat until it answers or a limit is hit.</p>
  <p>The difference from a fixed workflow is control. In a workflow, your code decides the steps. In an agent, the model decides them at run time, which is powerful for open-ended tasks and risky for everything else. Anthropic’s guidance on building agents makes the same point: use the simplest pattern that works, and reach for autonomous agents only when the steps cannot be known in advance.</p>`,
  points: [
    'The loop: send messages and tools; if the model returns tool calls, execute them and append results; otherwise return its answer.',
    'Always bound it: maximum steps, maximum tokens or cost, and wall-clock time.',
    'Detect stuck agents: the same tool with the same arguments several times in a row, or no progress for N steps.',
    'Every action passes through your validation and authorization layer (lesson 3.4), whatever the model asked for.',
    'Record a transcript of every step (model output, tool call, result, tokens, latency) for debugging and evals (Phase 7.5).',
    'Prefer workflows (fixed steps) when you can enumerate the steps; use agents when the path depends on what is discovered.'
  ],
  concept: { title: 'The model drives, your code steers', body: `<p>Think of the model as a capable driver and your loop as the car: the driver chooses the route, but the car has a speed limiter (budget), a fuel gauge (tokens), lane-keeping (validation) and a black-box recorder (transcript). The driver can be brilliant and still occasionally drive in circles; the car must notice and stop.</p>` },
  walk: [
    { h: 'The loop in its smallest form', body: '<p>Everything else in this phase decorates these lines.</p>', code: String.raw`messages = [{"role": "user", "content": task}]
for step in range(MAX_STEPS):
    resp = client.messages.create(model=MODEL, system=SYSTEM, tools=TOOLS, messages=messages, max_tokens=1024)
    messages.append({"role": "assistant", "content": resp.content})
    if resp.stop_reason != "tool_use":
        return final_text(resp)
    messages.append({"role": "user", "content": [run(call) for call in tool_calls(resp)]})
raise BudgetExceeded(f"no answer after {MAX_STEPS} steps")` },
    { h: 'Add budgets and a stuck detector', body: '<p>Track cumulative tokens from <code class="i">resp.usage</code> and stop when the budget is spent. Keep a counter of identical (tool, arguments) pairs; three in a row means the agent is stuck, so stop and hand over to a human with the transcript.</p>' },
    { h: 'Workflow or agent?', body: `<div class="tbl"><table><thead><tr><th>task</th><th>choose</th><th>why</th></tr></thead><tbody>
      <tr><td>classify a ticket, then route it</td><td>workflow</td><td>fixed two steps; cheaper and testable</td></tr>
      <tr><td>extract invoice fields, validate, store</td><td>workflow</td><td>steps known in advance</td></tr>
      <tr><td>investigate why a customer was double-charged</td><td>agent</td><td>which records to inspect depends on findings</td></tr>
      <tr><td>fix a failing test in an unknown codebase</td><td>agent</td><td>open-ended exploration</td></tr></tbody></table></div>` }
  ],
  analogy: `<p><b>A junior investigator with a radio.</b> They decide which records to pull next and report back after each one. Headquarters (your loop) logs every report, refuses requests they are not cleared for, and calls them back if they ask for the same file three times or the case exceeds its budget.</p>`,
  diagram: {
    title: 'The agent loop and its guard rails',
    cols: [['task'], ['model'], ['dec'], ['guard', 'ans'], ['tools'], ['log']],
    nodes: [
      { id: 'task', label: 'Task', sub: 'goal + context', tone: 'fde', info: 'What the agent should achieve, with relevant context.' },
      { id: 'model', label: 'Model', sub: 'decides next step', tone: 'acc', info: 'Chooses to call tools or answer.' },
      { id: 'dec', label: 'stop_reason?', sub: 'tool_use / end_turn', info: 'Your code branches on why the model stopped.' },
      { id: 'guard', label: 'Budget + guard', sub: 'steps · tokens · loops · authz', tone: 'bad', info: 'Every iteration checks limits and validates each call.' },
      { id: 'ans', label: 'Final answer', sub: 'or handoff', tone: 'ok', info: 'Returned to the user, or escalated with the transcript.' },
      { id: 'tools', label: 'Tools', sub: 'run · results', tone: 'be', info: 'Executed only after the guard approves.' },
      { id: 'log', label: 'Transcript', sub: 'every step', info: 'Model outputs, calls, results, tokens and timings, for debugging and evals.' }
    ],
    edges: [{ a: 'task', b: 'model', step: 1 }, { a: 'model', b: 'dec', step: 2 }, { a: 'dec', b: 'guard', label: 'tool_use', step: 3 }, { a: 'dec', b: 'ans', label: 'end_turn', dash: true, step: 6 }, { a: 'guard', b: 'tools', step: 4 }, { a: 'tools', b: 'log', step: 5 }, { a: 'tools', b: 'model', dash: true, bend: -70, label: 'results', step: 5 }],
    steps: ['The task starts the loop.', 'The model decides what to do next.', 'If it wants tools, the guard checks budgets and authorization.', 'Approved tools run.', 'Results are logged and fed back to the model.', 'When it answers, the loop ends.'],
    caption: 'The model chooses the path; your loop enforces the limits.'
  },
  illustrated: { title: 'A transcript worth keeping', body: `<div class="tbl"><table><thead><tr><th>step</th><th>model action</th><th>result</th><th>tokens in / out</th></tr></thead><tbody>
    <tr><td class="n">1</td><td>search_invoices(customer=c42)</td><td>3 invoices</td><td class="n">1,210 / 48</td></tr>
    <tr><td class="n">2</td><td>get_charges(INV-991)</td><td>2 charges of $48 within 9 s</td><td class="n">1,420 / 40</td></tr>
    <tr><td class="n">3</td><td>issue_refund(ch_2, 4800)</td><td>guard: within limit, ran</td><td class="n">1,610 / 52</td></tr>
    <tr><td class="n">4</td><td>answer</td><td>“Refunded the duplicate $48…”</td><td class="n">1,790 / 61</td></tr></tbody></table></div>
    <p>Note input tokens grow every step: the whole transcript is re-sent. Long tasks need context management (Phase 6).</p>` },
  code: {
    title: 'An agent loop with budgets, a stuck detector and a transcript', file: 'agent_loop.py', deps: 'uv add anthropic',
    intro: FAKE_NOTE + '<p>Two runs. The first investigates a double charge and refunds it in four steps. The second asks about an invoice that does not exist; the fake model keeps retrying the same lookup, and the stuck detector stops it after three identical calls.</p>',
    src: String.raw`import json, time
from dataclasses import dataclass, field
import anthropic
try:
    import httpx2 as httpx
except ImportError:
    import httpx

# ---- fake model: plans the next call from the tool results it has seen ----
def fake_api(request):
    body = json.loads(request.content)
    msgs = body["messages"]
    results = [b for m in msgs if m["role"] == "user" and isinstance(m["content"], list) for b in m["content"]]
    task = msgs[0]["content"]
    def say(content, stop):
        return httpx.Response(200, json={"id": "m", "type": "message", "role": "assistant", "model": body["model"], "content": content,
            "stop_reason": stop, "stop_sequence": None, "usage": {"input_tokens": 900 + 220 * len(results), "output_tokens": 45}})
    call = lambda i, name, args: say([{"type": "tool_use", "id": f"t{i}", "name": name, "input": args}], "tool_use")
    if "INV-404" in task:
        return call(len(results), "get_invoice", {"invoice_id": "INV-404"})          # never gives up
    plan = [("search_invoices", {"customer_id": "c42"}), ("get_charges", {"invoice_id": "INV-991"}),
            ("issue_refund", {"charge_id": "ch_2", "amount_cents": 4800})]
    if len(results) < len(plan):
        return call(len(results), *plan[len(results)])
    return say([{"type": "text", "text": "Found two $48 charges on INV-991 nine seconds apart and refunded the duplicate (rf_1)."}], "end_turn")
client = anthropic.Anthropic(api_key="test", http_client=httpx.Client(transport=httpx.MockTransport(fake_api)))
# ---------------------------------------------------------------------------

def search_invoices(customer_id): return [{"id": "INV-991", "total": 9600}, {"id": "INV-950", "total": 4800}]
def get_charges(invoice_id): return [{"id": "ch_1", "amount": 4800, "t": "10:00:01"}, {"id": "ch_2", "amount": 4800, "t": "10:00:10"}]
def get_invoice(invoice_id): raise KeyError(f"invoice {invoice_id} not found")
def issue_refund(charge_id, amount_cents):
    if amount_cents > 5000: raise PermissionError("needs approval")
    return {"refund_id": "rf_1"}
TOOLS = {f.__name__: f for f in (search_invoices, get_charges, get_invoice, issue_refund)}
TOOL_DEFS = [{"name": n, "description": n.replace("_", " "), "input_schema": {"type": "object"}} for n in TOOLS]

@dataclass
class Budget:
    max_steps: int = 8
    max_tokens: int = 20_000
    max_repeats: int = 3

@dataclass
class Run:
    transcript: list = field(default_factory=list)
    tokens: int = 0
    outcome: str = ""

def run_agent(task: str, budget: Budget = Budget()) -> Run:
    run, messages, last_call, repeats = Run(), [{"role": "user", "content": task}], None, 0
    for step in range(1, budget.max_steps + 1):
        t0 = time.perf_counter()
        resp = client.messages.create(model="claude-sonnet-5-5", max_tokens=1024, tools=TOOL_DEFS, messages=messages)
        run.tokens += resp.usage.input_tokens + resp.usage.output_tokens
        messages.append({"role": "assistant", "content": resp.content})
        if resp.stop_reason != "tool_use":
            run.outcome = "answered: " + resp.content[0].text
            run.transcript.append((step, "answer", "", resp.usage.input_tokens)); return run
        results = []
        for c in (b for b in resp.content if b.type == "tool_use"):
            key = (c.name, json.dumps(c.input, sort_keys=True))
            repeats = repeats + 1 if key == last_call else 1; last_call = key
            try:
                out, err = json.dumps(TOOLS[c.name](**c.input)), False
            except Exception as e:
                out, err = f"Error: {e}", True
            results.append({"type": "tool_result", "tool_use_id": c.id, "content": out, "is_error": err})
            run.transcript.append((step, f"{c.name}({c.input})", out[:46], resp.usage.input_tokens))
        messages.append({"role": "user", "content": results})
        if repeats >= budget.max_repeats:
            run.outcome = f"stopped: same call {repeats}x in a row -> hand to a human"; return run
        if run.tokens > budget.max_tokens:
            run.outcome = f"stopped: token budget {budget.max_tokens} exceeded"; return run
    run.outcome = f"stopped: {budget.max_steps} steps without an answer"
    return run

for task in ["Customer c42 says they were charged twice. Investigate and fix it.", "What is the status of INV-404?"]:
    r = run_agent(task)
    print(f"TASK: {task}")
    for step, action, result, tin in r.transcript:
        print(f"  {step}. {action:<52} {result:<46} in={tin}")
    print(f"  -> {r.outcome} | total tokens {r.tokens}\n")`
  },
  lab: {
    title: 'Write the loop with three stop conditions', file: 'loop_lab.py', browser: true,
    scenario: `<p>Your customer’s platform team wants a framework-free agent runner they can audit. Using the scripted fake model in the starter, implement <code class="i">run_agent</code> with a step limit, a cost limit in dollars, and a no-progress detector (no new information for 3 steps, meaning tool results identical to ones already seen). Run the three scenarios and make each end for the right reason.</p>`,
    steps: ['Call <code class="i">fake_model(scenario, history)</code>; it returns either <code class="i">{"answer": ...}</code> or <code class="i">{"tool": name, "args": {...}, "tokens": n}</code>.', 'Execute tools from the <code class="i">TOOLS</code> dict, catching exceptions into error results.', 'Track cost at $3 per million tokens; stop above $0.01.', 'Stop when 3 consecutive results were already seen earlier in the run.', 'Return outcome, steps and cost; print all three scenarios.'],
    checks: ['“happy” answers in 3 steps.', '“spinner” stops for no progress.', '“chatty” stops on the cost limit.'],
    hints: ['Keep a set of result strings seen so far.', 'Check limits after each step, before calling the model again.'],
    starter: String.raw`import json
TOOLS = {
    "lookup": lambda q: {"q": q, "hits": 2 if q == "INV-991" else 0},
    "charges": lambda inv: [4800, 4800],
}
def fake_model(scenario, history):
    n = len(history)
    if scenario == "happy":
        return [{"tool": "lookup", "args": {"q": "INV-991"}, "tokens": 900}, {"tool": "charges", "args": {"inv": "INV-991"}, "tokens": 1100},
                {"answer": "Duplicate charge confirmed."}][min(n, 2)]
    if scenario == "spinner":
        return {"tool": "lookup", "args": {"q": "INV-404"}, "tokens": 800}
    if scenario == "chatty":
        return {"tool": "lookup", "args": {"q": f"page-{n}"}, "tokens": 1200 + 400 * n}

def run_agent(scenario, max_steps=10, max_cost=0.01):
    history = []
    # TODO
    return {"outcome": "todo", "steps": 0, "cost": 0.0}

for s in ("happy", "spinner", "chatty"):
    print(s, run_agent(s))`,
    solution: String.raw`import json
TOOLS = {
    "lookup": lambda q: {"q": q, "hits": 2 if q == "INV-991" else 0},
    "charges": lambda inv: [4800, 4800],
}
def fake_model(scenario, history):
    n = len(history)
    if scenario == "happy":
        return [{"tool": "lookup", "args": {"q": "INV-991"}, "tokens": 900}, {"tool": "charges", "args": {"inv": "INV-991"}, "tokens": 1100},
                {"answer": "Duplicate charge confirmed."}][min(n, 2)]
    if scenario == "spinner":
        return {"tool": "lookup", "args": {"q": "INV-404"}, "tokens": 800}
    if scenario == "chatty":
        return {"tool": "lookup", "args": {"q": f"page-{n}"}, "tokens": 1200 + 400 * n}

PRICE_PER_TOKEN = 3 / 1_000_000

def run_agent(scenario, max_steps=10, max_cost=0.01, max_stale=3):
    history, seen, stale, cost = [], set(), 0, 0.0
    for step in range(1, max_steps + 1):
        act = fake_model(scenario, history)
        if "answer" in act:
            return {"outcome": "answered: " + act["answer"], "steps": step, "cost": round(cost, 5)}
        cost += act["tokens"] * PRICE_PER_TOKEN
        try:
            result = json.dumps(TOOLS[act["tool"]](**act["args"]), sort_keys=True)
        except Exception as e:
            result = f"error: {e}"
        history.append((act, result))
        stale = stale + 1 if result in seen else 0
        seen.add(result)
        if stale >= max_stale:
            return {"outcome": f"stopped: no new information for {stale} steps", "steps": step, "cost": round(cost, 5)}
        if cost > max_cost:
            return {"outcome": f"stopped: cost {cost:.4f} > {max_cost}", "steps": step, "cost": round(cost, 5)}
    return {"outcome": "stopped: step limit", "steps": max_steps, "cost": round(cost, 5)}

for s in ("happy", "spinner", "chatty"):
    print(f"{s:<8}", run_agent(s))`
  },
  design: {
    lead: '<p>An agent run is a long, stateful, expensive request with a variable number of steps. Design it like a job: budgets, cancellation, durable state, progress events and full transcripts.</p>',
    scale: [{ h: 'Runs as jobs', p: 'Long agent runs belong on a queue or durable workflow (Phase 9.9), with progress streamed to the UI, not inside one HTTP request.' }, { h: 'Cost ceilings', p: 'Per-run, per-user and per-tenant budgets, enforced in the loop and in the gateway, so one runaway agent cannot burn a month’s budget.' }],
    fail: [{ h: 'Loops and thrashing', p: 'Repeating calls, oscillating between two tools, or re-reading the same file. Detect patterns, not just exact repeats.' }, { h: 'Silent partial success', p: 'An agent that refunds and then fails to update the ticket leaves inconsistent state. Make actions idempotent and record them (lesson 5.9).' }],
    trade: [{ h: 'Autonomy vs predictability', p: 'More autonomy handles more cases and is harder to test, cost and secure. Constrain autonomy to what the task needs.' }, { h: 'Hand-written loop vs framework', p: 'A hand loop is transparent and dependency-free; frameworks add state, checkpoints, tracing and integrations (lessons 5.6 and 5.7).' }],
    prompt: '<p>Design the runtime for a billing-investigation agent used by 300 support agents, each run taking up to 2 minutes and 20 tool calls.</p>',
    answer: '<ul><li>Run submitted as a job with an id; worker executes the loop; progress events streamed over SSE.</li><li>Budgets: 25 steps, 60k tokens, 3 minutes; stuck detection; cancel button.</li><li>Write tools behind approval rules and idempotency keys; read tools scoped to the requesting agent’s permissions.</li><li>Transcripts stored for 90 days, sampled into evals; dashboards for cost per run and stop reasons.</li></ul>'
  },
  quiz: [
    { q: 'What distinguishes an agent from a workflow?', o: ['Agents use bigger models', 'In an agent the model decides the sequence of steps at run time', 'Workflows cannot call tools', 'Agents never stop'], a: 1, why: 'Workflows follow code-defined steps; agents choose steps dynamically.' },
    { q: 'The agent called get_invoice(INV-404) three times in a row with identical arguments. Your loop should:', o: ['Keep going until max_steps', 'Stop, mark the run as stuck and hand over with the transcript', 'Delete the invoice', 'Raise the token budget'], a: 1, why: 'Repeated identical calls signal no progress.' },
    { q: 'Why do input tokens grow on every step of an agent run?', o: ['Tools add hidden tokens', 'The full conversation, including all tool results, is re-sent each call', 'The model gets slower', 'Caching is disabled'], a: 1, why: 'Stateless API: the transcript is the state.' }
  ],
  interview: [
    { q: 'Implement an agent loop on a whiteboard. What would you add before production?', a: '<p>The core is call model, run requested tools, append results, repeat until an answer. For production I add step, token, time and cost budgets; stuck detection; validation and authorization on every call; idempotency for writes; a transcript with tokens and latency per step; cancellation; and running it as a job with progress events.</p>' },
    { q: 'When would you not use an agent?', a: '<p>When the steps are known in advance, such as classify then route, or extract then validate. A fixed workflow is cheaper, faster, easier to test and to secure. I reserve agents for open-ended tasks where the path depends on what is discovered, and even then I constrain the tools and budgets.</p>' }
  ]
});

/* ===================================================================== 5.2 */
L({
  id: '5.2', title: 'Tool design', minutes: 50, roles: ['fde', 'be'],
  tags: 'agent-computer interface · names and descriptions · schemas · errors · pagination · idempotency · tool count',
  mental: 'Tools are the interface between the model and your systems, and the model reads them literally. Design them like an API for a smart new colleague who has only the documentation: few, distinct, clearly named tools with tight schemas, helpful errors and small, relevant results.',
  intro: `<p>When an agent picks the wrong tool, passes a malformed id or drowns in a 40,000-token result, the cause is usually the tool definition, not the model. Anthropic’s engineering guidance on writing tools for agents describes tool design as an interface discipline in its own right, and most agent quality wins in deployments come from refining tools, not prompts.</p>
  <p>As an FDE you will wrap a customer’s existing APIs as tools. The trap is exposing their REST endpoints one-to-one. Agents need tools shaped around tasks.</p>`,
  points: [
    'Fewer, task-shaped tools beat many thin endpoint wrappers: <code class="i">find_customer_charges</code> rather than list_customers + list_invoices + list_charges.',
    'Names are verbs plus nouns and unambiguous; namespacing (<code class="i">billing_refund</code>, <code class="i">crm_get_contact</code>) helps when catalogues grow.',
    'Descriptions say what the tool does, when to use it and not use it, and what it returns; include an example input for tricky formats.',
    'Schemas are tight: enums for categories, patterns for ids, required fields, and no free-form strings where a structure exists.',
    'Errors are actionable (“no invoice INV-99; ids look like INV-123; try search_invoices”), and results are concise, paginated and human-readable, with ids for follow-up.',
    'Write tools carry idempotency keys and are marked as such; read-only tools are safe to retry and parallelise.'
  ],
  concept: { title: 'The agent-computer interface', body: `<p>Humans get UIs; agents get tool definitions. Everything the model knows about your system comes through names, descriptions, schemas, results and errors. A good tool reduces the decisions the model must make: it merges steps the model would always do together, returns exactly what the next decision needs, and fails in a way that explains how to succeed.</p>` },
  walk: [
    { h: 'Before and after', body: `<div class="tbl"><table><thead><tr><th>before</th><th>after</th></tr></thead><tbody>
      <tr><td><code class="i">get(id)</code> “gets object”</td><td><code class="i">get_invoice(invoice_id)</code> “Fetch one invoice by id (format INV-123). Returns status, total and charge ids. Use search_invoices if you only know the customer.”</td></tr>
      <tr><td>returns the raw 200-field JSON</td><td>returns 8 relevant fields and a <code class="i">detail_level</code> option</td></tr>
      <tr><td>error: “500 Internal Server Error”</td><td>error: “Invoice INV-99 not found for this customer. Ids look like INV-123.”</td></tr>
      <tr><td>list returns 5,000 rows</td><td>returns 20 with a <code class="i">next_cursor</code> and a total count</td></tr></tbody></table></div>` },
    { h: 'Generate definitions from types', body: '<p>Define inputs as Pydantic models; the JSON schema, validation and descriptions come from one place.</p>', code: String.raw`class IssueRefund(BaseModel):
    """Refund one charge. Use only after confirming the charge is a duplicate or eligible under policy."""
    charge_id: str = Field(pattern=r"^ch_\w+$", description="Charge id from get_invoice, e.g. ch_2")
    amount_cents: int = Field(gt=0, le=500_000, description="Amount in cents; must not exceed the charge")
    reason: Literal["duplicate", "service_issue", "goodwill"]
    idempotency_key: str = Field(description="Reuse the same key when retrying the same refund")` },
    { h: 'Test tools with the model', body: '<p>Run your eval tasks, read transcripts, and look for wrong tool choices, malformed arguments and wasted calls. Each pattern points at a definition to fix. Some teams let a model propose tool description improvements from failed transcripts, then re-run the eval.</p>' }
  ],
  analogy: `<p><b>A hospital’s order sheet.</b> A good order form has named boxes, tick-boxes for standard doses and a field for the patient id in a fixed format, so a busy doctor rarely orders the wrong thing. A blank page saying “write your order” gets you creative spelling and mistakes.</p>`,
  diagram: {
    title: 'A tool registry between the model and your systems',
    cols: [['model'], ['defs', 'call'], ['reg'], ['val', 'idem'], ['api'], ['res']],
    nodes: [
      { id: 'model', label: 'Model', tone: 'fde', info: 'Sees only definitions; produces calls.' },
      { id: 'defs', label: 'Tool definitions', sub: 'name · description · schema', tone: 'acc', info: 'Generated from typed models; the model’s whole view of your system.' },
      { id: 'call', label: 'tool_use', sub: 'name + args', info: 'A proposed call with arguments.' },
      { id: 'reg', label: 'Registry', sub: 'dispatch', tone: 'be', info: 'Looks up the tool, validates, runs, shapes the result.' },
      { id: 'val', label: 'Validate', sub: 'schema + authz', info: 'Typed validation and permission checks.' },
      { id: 'idem', label: 'Idempotency', sub: 'writes only', tone: 'warn', info: 'A retried write with the same key returns the first result.' },
      { id: 'api', label: 'Customer APIs', sub: 'REST · DB · SaaS', info: 'The real systems, often with awkward shapes.' },
      { id: 'res', label: 'Shaped result', sub: 'concise · paged · ids', tone: 'ok', info: 'Small, relevant output or an actionable error.' }
    ],
    edges: [{ a: 'defs', b: 'model', step: 1 }, { a: 'model', b: 'call', step: 2 }, { a: 'call', b: 'reg', step: 2 }, { a: 'reg', b: 'val', step: 3 }, { a: 'reg', b: 'idem', step: 3 }, { a: 'val', b: 'api', step: 4 }, { a: 'idem', b: 'api', step: 4 }, { a: 'api', b: 'res', step: 5 }],
    steps: ['Definitions tell the model what exists.', 'The model proposes a call.', 'The registry validates and, for writes, checks idempotency.', 'The real API runs.', 'The result is trimmed and shaped for the next decision.'],
    caption: 'One registry turns awkward APIs into agent-friendly tools.'
  },
  illustrated: { title: 'Why result size matters', body: `<p>An agent investigates 10 customers, calling <code class="i">get_customer</code> each time.</p>
    <div class="tbl"><table><thead><tr><th>result shape</th><th>tokens per call</th><th>after 10 calls</th></tr></thead><tbody>
    <tr><td>raw CRM record, 200 fields</td><td class="n">≈ 3,500</td><td class="n">35,000 tokens of context, mostly noise</td></tr>
    <tr><td>12 relevant fields</td><td class="n">≈ 250</td><td class="n">2,500 tokens</td></tr>
    <tr><td>summary plus <code class="i">detail_level="full"</code> on demand</td><td class="n">≈ 120</td><td class="n">1,200 tokens, full detail only when asked</td></tr></tbody></table></div>` },
  code: {
    title: 'A typed tool registry with good errors, truncation and idempotency', file: 'registry.py', browser: true,
    intro: '<p>A registry that turns Pydantic models into tool definitions, validates calls, returns actionable errors, caps result size with a pagination hint, and makes write tools idempotent. The calls at the bottom are the kind a model really makes, including a malformed id and a retried refund.</p>',
    src: String.raw`import json
from typing import Literal, Callable
from pydantic import BaseModel, Field, ValidationError

class Tool:
    def __init__(self, name: str, args: type[BaseModel], fn: Callable, write: bool = False):
        self.name, self.args, self.fn, self.write = name, args, fn, write

    def definition(self) -> dict:
        schema = self.args.model_json_schema()
        schema.pop("title", None)
        return {"name": self.name, "description": (self.args.__doc__ or "").strip(), "input_schema": schema}

class Registry:
    def __init__(self, max_chars: int = 400):
        self.tools: dict[str, Tool] = {}; self.max_chars = max_chars; self.done: dict[str, str] = {}

    def add(self, tool: Tool): self.tools[tool.name] = tool

    def call(self, name: str, args: dict) -> dict:
        tool = self.tools.get(name)
        if not tool:
            return {"is_error": True, "content": f"Unknown tool {name}. Available: {', '.join(self.tools)}"}
        try:
            a = tool.args.model_validate(args)
        except ValidationError as e:
            msg = "; ".join(f"{x['loc'][0]}: {x['msg']}" for x in e.errors())
            return {"is_error": True, "content": f"Invalid arguments for {name}: {msg}"}
        if tool.write and a.idempotency_key in self.done:
            return {"content": self.done[a.idempotency_key] + " (replayed: already done, not repeated)"}
        try:
            out = json.dumps(tool.fn(a), separators=(",", ":"))
        except LookupError as e:
            return {"is_error": True, "content": str(e)}
        if len(out) > self.max_chars:
            out = out[: self.max_chars] + f'... [truncated {len(out) - self.max_chars} chars; pass page=2 or narrow the filter]'
        if tool.write:
            self.done[a.idempotency_key] = out
        return {"content": out}

INVOICES = {f"INV-{900 + i}": {"customer": "c42", "total": 4800 * (1 + i % 2), "charges": [f"ch_{i}a", f"ch_{i}b"]} for i in range(40)}

class SearchInvoices(BaseModel):
    """Find a customer's invoices, newest first, 10 per page. Use when you know the customer but not the invoice id."""
    customer_id: str = Field(pattern=r"^c\d+$", description="Customer id, e.g. c42")
    page: int = Field(1, ge=1)

class GetInvoice(BaseModel):
    """Fetch one invoice by id (format INV-123): total and charge ids. Use search_invoices if you only know the customer."""
    invoice_id: str = Field(pattern=r"^INV-\d+$", description="Invoice id, e.g. INV-991")

class IssueRefund(BaseModel):
    """Refund one charge after confirming it is eligible. Retrying with the same idempotency_key is safe."""
    charge_id: str = Field(pattern=r"^ch_\w+$")
    amount_cents: int = Field(gt=0, le=500_000)
    reason: Literal["duplicate", "service_issue", "goodwill"]
    idempotency_key: str

def search(a):
    ids = sorted(INVOICES, reverse=True)
    return {"invoices": [{"id": i, "total": INVOICES[i]["total"]} for i in ids[(a.page - 1) * 10: a.page * 10]], "total": len(ids)}
def get(a):
    if a.invoice_id not in INVOICES:
        raise LookupError(f"No invoice {a.invoice_id} for this customer. Ids look like INV-939; try search_invoices.")
    return INVOICES[a.invoice_id]
refunds = []
def refund(a):
    refunds.append(a.charge_id); return {"refund_id": f"rf_{len(refunds)}", "status": "succeeded"}

reg = Registry()
reg.add(Tool("search_invoices", SearchInvoices, search)); reg.add(Tool("get_invoice", GetInvoice, get))
reg.add(Tool("issue_refund", IssueRefund, refund, write=True))

print(json.dumps(reg.tools["issue_refund"].definition())[:230], "...\n")
for name, args in [("get_invoice", {"invoice_id": "991"}),
                   ("get_invoice", {"invoice_id": "INV-1"}),
                   ("search_invoices", {"customer_id": "c42"}),
                   ("issue_refund", {"charge_id": "ch_3b", "amount_cents": 4800, "reason": "dup", "idempotency_key": "k1"}),
                   ("issue_refund", {"charge_id": "ch_3b", "amount_cents": 4800, "reason": "duplicate", "idempotency_key": "k1"}),
                   ("issue_refund", {"charge_id": "ch_3b", "amount_cents": 4800, "reason": "duplicate", "idempotency_key": "k1"})]:
    r = reg.call(name, args)
    print(f"{name}({json.dumps(args)[:48]}...)\n   {'ERROR ' if r.get('is_error') else ''}{r['content'][:150]}")
print("refunds actually issued:", len(refunds))`
  },
  lab: {
    title: 'Lint and consolidate a tool catalogue', file: 'tool_lint_lab.py', browser: true,
    scenario: `<p>A customer’s first agent prototype exposes nine tools generated straight from their OpenAPI spec, and the agent keeps choosing the wrong one. Write a linter that scores each definition and flags overlapping tools, then propose a consolidated catalogue of four tools that passes the linter.</p>`,
    steps: ['Rules: snake_case verb_noun name; description at least 60 characters and mentions when to use it (contains “use”); every property has a description; id-like properties (ending in _id) have a pattern; properties named status/type/reason have an enum.', 'Flag pairs of tools whose descriptions share more than half their words (Jaccard over word sets) as overlapping.', 'Print a report: per tool, the rules it fails.', 'Write the consolidated four-tool catalogue and show it passes with no overlaps.'],
    checks: ['The original catalogue shows at least six failing tools and at least one overlapping pair.', 'The new catalogue has zero failures and zero overlaps.'],
    hints: ['<code class="i">re.fullmatch(r"[a-z]+(_[a-z]+)+", name)</code> checks the name shape.', 'Lower-case and strip punctuation before comparing descriptions.'],
    starter: String.raw`import re
CATALOG = [
    {"name": "getCustomer", "description": "Gets customer", "input_schema": {"properties": {"id": {"type": "string"}}}},
    {"name": "customer_lookup", "description": "Look up a customer record by id", "input_schema": {"properties": {"customer_id": {"type": "string"}}}},
    {"name": "fetch_customer_info", "description": "Look up customer record info by id", "input_schema": {"properties": {"customer_id": {"type": "string", "description": "id"}}}},
    {"name": "list_invoices", "description": "List invoices", "input_schema": {"properties": {"customer_id": {"type": "string"}, "status": {"type": "string"}}}},
    {"name": "invoice", "description": "Invoice endpoint", "input_schema": {"properties": {"invoice_id": {"type": "string"}}}},
    {"name": "list_charges", "description": "List charges for an invoice", "input_schema": {"properties": {"invoice_id": {"type": "string"}}}},
    {"name": "create_refund", "description": "Creates a refund object", "input_schema": {"properties": {"charge_id": {"type": "string"}, "amount": {"type": "integer"}, "reason": {"type": "string"}}}},
    {"name": "post_refund_v2", "description": "Creates a refund object (v2)", "input_schema": {"properties": {"charge_id": {"type": "string"}, "amount": {"type": "integer"}}}},
    {"name": "search", "description": "Search anything", "input_schema": {"properties": {"q": {"type": "string"}}}},
]
def lint(tool):
    # TODO: return list of failed rule names
    return []
def overlaps(catalog):
    # TODO
    return []
for t in CATALOG:
    print(t["name"], lint(t))`,
    solution: String.raw`import re
CATALOG = [
    {"name": "getCustomer", "description": "Gets customer", "input_schema": {"properties": {"id": {"type": "string"}}}},
    {"name": "customer_lookup", "description": "Look up a customer record by id", "input_schema": {"properties": {"customer_id": {"type": "string"}}}},
    {"name": "fetch_customer_info", "description": "Look up customer record info by id", "input_schema": {"properties": {"customer_id": {"type": "string", "description": "id"}}}},
    {"name": "list_invoices", "description": "List invoices", "input_schema": {"properties": {"customer_id": {"type": "string"}, "status": {"type": "string"}}}},
    {"name": "invoice", "description": "Invoice endpoint", "input_schema": {"properties": {"invoice_id": {"type": "string"}}}},
    {"name": "list_charges", "description": "List charges for an invoice", "input_schema": {"properties": {"invoice_id": {"type": "string"}}}},
    {"name": "create_refund", "description": "Creates a refund object", "input_schema": {"properties": {"charge_id": {"type": "string"}, "amount": {"type": "integer"}, "reason": {"type": "string"}}}},
    {"name": "post_refund_v2", "description": "Creates a refund object (v2)", "input_schema": {"properties": {"charge_id": {"type": "string"}, "amount": {"type": "integer"}}}},
    {"name": "search", "description": "Search anything", "input_schema": {"properties": {"q": {"type": "string"}}}},
]
ENUM_NAMES = {"status", "type", "reason"}

def lint(tool):
    fails, props = [], tool["input_schema"].get("properties", {})
    if not re.fullmatch(r"[a-z]+(_[a-z0-9]+)+", tool["name"]): fails.append("name")
    d = tool["description"]
    if len(d) < 60: fails.append("short_description")
    if "use" not in d.lower(): fails.append("no_when_to_use")
    for p, spec in props.items():
        if not spec.get("description"): fails.append(f"undocumented:{p}")
        if (p.endswith("_id") or p == "id") and "pattern" not in spec: fails.append(f"no_pattern:{p}")
        if p in ENUM_NAMES and "enum" not in spec: fails.append(f"no_enum:{p}")
    return fails

def words(s): return set(re.findall(r"[a-z]+", s.lower()))
def overlaps(catalog, threshold=0.5):
    out = []
    for i, a in enumerate(catalog):
        for b in catalog[i + 1:]:
            wa, wb = words(a["description"]), words(b["description"])
            j = len(wa & wb) / len(wa | wb)
            if j > threshold: out.append((a["name"], b["name"], round(j, 2)))
    return out

def report(title, catalog):
    print(f"== {title}")
    bad = 0
    for t in catalog:
        f = lint(t); bad += bool(f)
        print(f"  {t['name']:<22} {'OK' if not f else ', '.join(f)}")
    print(f"  failing tools: {bad}/{len(catalog)} | overlaps: {overlaps(catalog)}")

report("original", CATALOG)
NEW = [
    {"name": "find_customer", "description": "Find a customer by id, email or company name. Use first when the user names a customer; returns id, plan and status.",
     "input_schema": {"properties": {"query": {"type": "string", "description": "Customer id (c42), email or company name"}}}},
    {"name": "list_customer_invoices", "description": "List a customer's invoices newest first, 10 per page, optionally by status. Use after find_customer.",
     "input_schema": {"properties": {"customer_id": {"type": "string", "pattern": "^c\\d+$", "description": "Customer id, e.g. c42"},
                                     "status": {"type": "string", "enum": ["open", "paid", "void"], "description": "Filter by status"}}}},
    {"name": "get_invoice_charges", "description": "Get one invoice with all its charges and their timestamps. Use to check for duplicate charges.",
     "input_schema": {"properties": {"invoice_id": {"type": "string", "pattern": "^INV-\\d+$", "description": "Invoice id, e.g. INV-991"}}}},
    {"name": "issue_refund", "description": "Refund one charge. Use only after confirming eligibility; retrying with the same idempotency_key is safe.",
     "input_schema": {"properties": {"charge_id": {"type": "string", "pattern": "^ch_\\w+$", "description": "Charge id from get_invoice_charges"},
                                     "amount_cents": {"type": "integer", "description": "Amount in cents, at most the charge amount"},
                                     "reason": {"type": "string", "enum": ["duplicate", "service_issue", "goodwill"], "description": "Why the refund is issued"},
                                     "idempotency_key": {"type": "string", "description": "Same key for retries of the same refund"}}}},
]
report("consolidated", NEW)`
  },
  design: {
    lead: '<p>A tool catalogue is a product with one very literal user. Version it, evaluate it against tasks, and keep it small per agent; route to subsets when the catalogue grows.</p>',
    scale: [{ h: 'Large catalogues', p: 'Hundreds of tools overflow context and confuse selection. Group tools per agent or task, or use tool search, where the model first finds relevant tools and only those definitions are loaded.' }, { h: 'Shared tool services', p: 'Expose tools once (often as MCP servers, lesson 5.3) and reuse them across agents and teams, with central auth, limits and logging.' }],
    fail: [{ h: 'Endpoint mirroring', p: 'One tool per REST endpoint forces multi-call choreography and invites mistakes. Shape tools around tasks.' }, { h: 'Leaky results', p: 'Returning raw records exposes fields the user should not see and wastes context. Shape and redact results.' }],
    trade: [{ h: 'Granular vs composite tools', p: 'Composite tools reduce calls and errors but are less flexible; keep a few granular tools for edge cases.' }, { h: 'Strict schemas', p: 'Strict schemas prevent malformed calls but need careful design for optional and nested fields.' }],
    prompt: '<p>Wrap a customer’s 140-endpoint ERP API for a procurement agent. How do you design the tools?</p>',
    answer: '<ul><li>Interview users for the 10 to 15 tasks the agent must do; design one tool per task, not per endpoint.</li><li>Typed inputs with enums and id patterns; concise results with ids; pagination; actionable errors.</li><li>Writes (purchase orders) behind approval thresholds and idempotency keys.</li><li>Eval suite of real procurement tasks; read transcripts to refine names and descriptions.</li></ul>'
  },
  quiz: [
    { q: 'Which tool definition is better for an agent?', o: ['get(id): "gets object"', 'get_invoice(invoice_id): "Fetch one invoice by id (INV-123). Use search_invoices if you only know the customer."', 'invoice_endpoint_v2', 'api_call(path, body)'], a: 1, why: 'Specific name, format hint and guidance on when to use it.' },
    { q: 'A tool returns 30,000 tokens of raw JSON. What is the main problem?', o: ['JSON is invalid', 'It floods the context, raising cost and degrading the model’s focus', 'Tools cannot return JSON', 'It is too fast'], a: 1, why: 'Results should be concise and relevant, with detail on demand.' },
    { q: 'Why give write tools an idempotency key?', o: ['For logging only', 'So a retried call does not perform the action twice', 'To speed them up', 'Models require it'], a: 1, why: 'Retries happen; side effects must not double.' }
  ],
  interview: [
    { q: 'How do you turn a customer’s REST API into tools for an agent?', a: '<p>Start from the tasks users need, not the endpoints. Design a few composite tools per task with clear verb-noun names, descriptions that say when to use them, typed schemas with enums and id formats, concise paged results with ids, actionable errors, and idempotency for writes. Then evaluate with real tasks and refine from transcripts.</p>' },
    { q: 'Your agent keeps picking the wrong tool. How do you debug it?', a: '<p>Read transcripts for the failing tasks, look for overlapping names or descriptions, missing "when to use" guidance, or results that mislead the next step. Merge or rename overlapping tools, add disambiguating guidance and examples, and re-run the eval set to confirm the fix without regressions.</p>' }
  ]
});

/* ===================================================================== 5.3 */
L({
  id: '5.3', title: 'MCP server and client', minutes: 60, roles: ['fde', 'be'],
  tags: 'Model Context Protocol · tools · resources · prompts · stdio · Streamable HTTP · 2026-07-28 spec · auth',
  mental: 'MCP is a standard way to expose tools, resources and prompts to any AI application. Write the integration once as an MCP server, and every MCP-capable host (Claude apps, IDEs, agent frameworks, your own agents) can use it.',
  intro: `<p>Before MCP, every AI application needed its own connector for every system: N apps times M systems. The Model Context Protocol, introduced by Anthropic in late 2024 and now an open standard used across the industry, turns that into N plus M: systems expose MCP servers, applications include MCP clients.</p>
  <p>For FDEs, MCP servers are among the most common deliverables in 2026: wrapping a customer’s internal systems so their chosen AI tools can use them safely. The protocol’s 2026-07-28 revision made it stateless (no initialisation handshake or protocol sessions), which makes servers easy to run behind ordinary load balancers.</p>`,
  points: [
    'Three server primitives: <b>tools</b> (actions the model can call), <b>resources</b> (data the host can read, addressed by URI), <b>prompts</b> (reusable templates users can pick).',
    'Transports: <b>stdio</b> for local servers launched by the host, <b>Streamable HTTP</b> for remote servers you deploy.',
    'The Python SDK (v2) offers <code class="i">MCPServer</code> for servers and <code class="i">Client</code> for clients; type hints and docstrings become schemas and descriptions.',
    'Since the 2026-07-28 spec: each request carries version and capabilities, servers advertise themselves via <code class="i">server/discover</code>, and any state lives in explicit handles you return from tools.',
    'Remote servers use OAuth-based authorization; validate tokens, scope tools per user, and never pass the user’s token through to other services blindly.',
    'Tool design rules from lesson 5.2 apply unchanged; MCP is the transport, not a substitute for good tools.'
  ],
  concept: { title: 'USB for AI integrations', body: `<p>Before USB, every device needed its own port and driver. MCP plays that role for AI: a common plug between models and systems. The value is not in any single integration but in reuse: the billing MCP server you build for a customer’s support agent also works in their analysts’ desktop assistant and their engineers’ IDE, with one place to enforce permissions and log usage.</p>` },
  walk: [
    { h: 'A server in a few lines', body: '<p>Type hints become the input schema; return types become structured output.</p>', code: String.raw`from mcp.server import MCPServer
mcp = MCPServer("acme-billing")

@mcp.tool()
def get_invoice(invoice_id: str) -> Invoice:
    """Fetch one invoice by id (format INV-123)."""
    return billing_api.invoice(invoice_id)

@mcp.resource("policy://refunds")
def refund_policy() -> str:
    """Current refund policy text."""
    return POLICY` },
    { h: 'Run it two ways', body: '<p>Locally, a host launches it over stdio from a config entry; remotely, you serve it over Streamable HTTP behind your normal ingress.</p>', lang: 'bash', file: 'run', code: String.raw`uv run mcp dev server.py                              # MCP Inspector for manual testing
uv run mcp run server.py --transport streamable-http  # remote: http://host:8000/mcp

# a typical host config entry for a local stdio server
# {"mcpServers": {"acme-billing": {"command": "uv", "args": ["run", "server.py"]}}}` },
    { h: 'Use it from your own agent', body: '<p>Connect with <code class="i">Client</code>, list tools, convert them into the model’s tool format, and dispatch tool calls back to the server. The Code tab does exactly this, in process.</p>' }
  ],
  analogy: `<p><b>A universal power adapter for a world trip.</b> Instead of buying a different charger for each country (each AI app), every device (system) gets one standard plug, and each country gets one adapter. Add a new device, and it works everywhere.</p>`,
  diagram: {
    title: 'MCP hosts, clients and servers',
    cols: [['h1', 'h2', 'h3'], ['client'], ['s1', 's2'], ['sys1', 'sys2']],
    nodes: [
      { id: 'h1', label: 'Claude apps', sub: 'host', tone: 'fde', info: 'Desktop and web apps that include an MCP client.' },
      { id: 'h2', label: 'IDE / coding agent', sub: 'host', info: 'Developer tools that load MCP servers.' },
      { id: 'h3', label: 'Your agent', sub: 'host', info: 'A custom agent using the SDK’s Client.' },
      { id: 'client', label: 'MCP client', sub: 'per server connection', tone: 'acc', info: 'Speaks the protocol: discover, list, call, read.' },
      { id: 's1', label: 'billing server', sub: 'Streamable HTTP · OAuth', tone: 'be', info: 'Remote server behind your ingress, with authorization.' },
      { id: 's2', label: 'files server', sub: 'stdio · local', info: 'Launched by the host as a subprocess.' },
      { id: 'sys1', label: 'Billing API', sub: 'customer system', info: 'The system the server wraps.' },
      { id: 'sys2', label: 'Local folder', sub: 'user files', info: 'Local resources exposed by a stdio server.' }
    ],
    edges: [{ a: 'h1', b: 'client' }, { a: 'h2', b: 'client' }, { a: 'h3', b: 'client' }, { a: 'client', b: 's1', label: 'HTTP' }, { a: 'client', b: 's2', label: 'stdio' }, { a: 's1', b: 'sys1' }, { a: 's2', b: 'sys2' }],
    caption: 'Many hosts, many servers, one protocol in between.'
  },
  illustrated: { title: 'What a stateless protocol changes', body: `<div class="tbl"><table><thead><tr><th></th><th>before (session-based)</th><th>2026-07-28 (stateless)</th></tr></thead><tbody>
    <tr><td>connection start</td><td>initialize handshake, then a session id header</td><td>each request carries version and capabilities; optional server/discover</td></tr>
    <tr><td>load balancing</td><td>sticky sessions or a shared session store</td><td>any instance can serve any request</td></tr>
    <tr><td>state such as a shopping basket</td><td>implicit in the protocol session</td><td>explicit handle returned by a tool and passed back by the model</td></tr>
    <tr><td>asking the user mid-call</td><td>held-open streams</td><td><code class="i">input_required</code> result; the client retries with answers</td></tr></tbody></table></div>
    <p>Older clients still work: the Python SDK falls back to the initialise handshake for legacy servers.</p>` },
  code: {
    title: 'An MCP server, a client, and a bridge to the model’s tool format', file: 'mcp_demo.py', deps: 'uv add "mcp[cli]" pydantic',
    intro: '<p>A billing server with two tools, a resource and a prompt, tested in process with the SDK’s <code class="i">Client</code> (the same code connects to a URL or a stdio command). Note how a <code class="i">ToolError</code> message reaches the client while unexpected exceptions do not leak internals, and how bad arguments are rejected before your code runs.</p>',
    src: String.raw`import asyncio, json, logging
from mcp import Client
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import BaseModel
logging.disable(logging.WARNING)                     # keep the demo output readable

mcp = MCPServer("acme-billing")

class Invoice(BaseModel):
    invoice_id: str
    total_cents: int
    charges: list[str]

INVOICES = {"INV-991": Invoice(invoice_id="INV-991", total_cents=9600, charges=["ch_1", "ch_2"])}

@mcp.tool()
def get_invoice(invoice_id: str) -> Invoice:
    """Fetch one invoice by id (format INV-123): total and charge ids."""
    if invoice_id not in INVOICES:
        raise ToolError(f"No invoice {invoice_id}. Ids look like INV-991.")
    return INVOICES[invoice_id]

@mcp.tool()
def issue_refund(charge_id: str, amount_cents: int, idempotency_key: str) -> str:
    """Refund one charge. Amounts above 5000 cents need human approval."""
    if amount_cents > 5000:
        raise ToolError("Over the 5000-cent auto-refund limit: ask a billing lead to approve.")
    return f"refund for {charge_id} queued ({idempotency_key})"

@mcp.resource("policy://refunds")
def refund_policy() -> str:
    """The current refund policy."""
    return "Duplicate charges are refunded automatically within 5 business days."

@mcp.prompt()
def investigate(invoice_id: str) -> str:
    """Start a duplicate-charge investigation."""
    return f"Investigate invoice {invoice_id} for duplicate charges and propose a fix."

def to_model_tools(mcp_tools) -> list[dict]:
    """Bridge: MCP tool listings -> the model's tool definitions (lesson 3.4)."""
    return [{"name": t.name, "description": t.description, "input_schema": t.input_schema} for t in mcp_tools]

async def main():
    async with Client(mcp) as client:                 # Client("https://.../mcp") or Client(StdioServerParameters(...)) in real use
        tools = (await client.list_tools()).tools
        for d in to_model_tools(tools):
            print("tool:", d["name"], "| params:", list(d["input_schema"]["properties"]), "|", d["description"][:44])
        r = await client.call_tool("get_invoice", {"invoice_id": "INV-991"})
        print("get_invoice ->", r.structured_content)
        r = await client.call_tool("get_invoice", {"invoice_id": "991"})
        print("not found   ->", r.is_error, "|", r.content[0].text)
        r = await client.call_tool("issue_refund", {"charge_id": "ch_2", "amount_cents": 9000, "idempotency_key": "k1"})
        print("over limit  ->", r.is_error, "|", r.content[0].text)
        r = await client.call_tool("issue_refund", {"charge_id": "ch_2"})
        print("bad args    ->", r.is_error, "|", r.content[0].text.splitlines()[0])
        res = await client.read_resource("policy://refunds")
        print("resource    ->", res.contents[0].text)
        p = await client.get_prompt("investigate", {"invoice_id": "INV-991"})
        print("prompt      ->", p.messages[0].content.text)

asyncio.run(main())`
  },
  lab: {
    title: 'A ticketing MCP server with pagination and a resource template', file: 'tickets_mcp_lab.py', deps: 'uv add "mcp[cli]"',
    scenario: `<p>The customer wants their support tickets available in every AI tool their team uses. Build an MCP server with: a <code class="i">search_tickets</code> tool that pages results with a cursor, a <code class="i">ticket://{ticket_id}</code> resource template for full ticket text, and a <code class="i">add_internal_note</code> tool that refuses notes containing card numbers. Then write client-side tests.</p>`,
    steps: ['Create 45 fake tickets in memory.', '<code class="i">search_tickets(query, cursor=None)</code> returns at most 10 matches plus <code class="i">next_cursor</code> (an opaque string) or null.', 'Resource template <code class="i">ticket://{ticket_id}</code> returns the ticket body.', '<code class="i">add_internal_note(ticket_id, note)</code> raises ToolError if the note contains 13 to 19 consecutive digits.', 'With <code class="i">Client(mcp)</code>, page through all “refund” tickets and assert the count, read one resource, and assert the card-number note is rejected.'],
    checks: ['Paging returns every matching ticket exactly once.', 'The resource returns the right ticket.', 'The note with a card number is rejected with a clear message.'],
    hints: ['Return a Pydantic model so clients receive structured_content; plain dicts arrive only as text.', 'Encode the cursor as a base64 offset so clients treat it as opaque.', 'A regex like <code class="i">\\d{13,19}</code> after removing spaces and dashes catches card-like numbers.'],
    starter: String.raw`import asyncio, base64, logging, re
from mcp import Client
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
logging.disable(logging.WARNING)

TICKETS = {str(4800 + i): {"subject": ("Refund request" if i % 3 == 0 else "Login issue"), "body": f"Ticket {4800 + i} body"} for i in range(45)}
mcp = MCPServer("acme-tickets")

# TODO: search_tickets tool, ticket://{ticket_id} resource, add_internal_note tool

async def main():
    async with Client(mcp) as c:
        print((await c.list_tools()).tools)
asyncio.run(main())`,
    solution: String.raw`import asyncio, base64, logging, re
from mcp import Client
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import BaseModel
logging.disable(logging.WARNING)

TICKETS = {str(4800 + i): {"subject": ("Refund request" if i % 3 == 0 else "Login issue"), "body": f"Ticket {4800 + i} body"} for i in range(45)}

class TicketHit(BaseModel):
    id: str
    subject: str

class SearchResult(BaseModel):          # a typed return value becomes structured output for clients
    tickets: list[TicketHit]
    total: int
    next_cursor: str | None
NOTES: dict[str, list[str]] = {}
mcp = MCPServer("acme-tickets")
PAGE = 10

@mcp.tool()
def search_tickets(query: str, cursor: str | None = None) -> SearchResult:
    """Search tickets by subject words, 10 per page. Pass next_cursor back to get the next page."""
    start = int(base64.b64decode(cursor).decode()) if cursor else 0
    hits = [tid for tid, t in TICKETS.items() if query.lower() in t["subject"].lower()]
    page = hits[start:start + PAGE]
    nxt = base64.b64encode(str(start + PAGE).encode()).decode() if start + PAGE < len(hits) else None
    return SearchResult(tickets=[TicketHit(id=t, subject=TICKETS[t]["subject"]) for t in page], total=len(hits), next_cursor=nxt)

@mcp.resource("ticket://{ticket_id}")
def ticket(ticket_id: str) -> str:
    """Full text of one ticket."""
    if ticket_id not in TICKETS:
        raise ToolError(f"No ticket {ticket_id}")
    return f"[{ticket_id}] {TICKETS[ticket_id]['subject']}: {TICKETS[ticket_id]['body']}"

@mcp.tool()
def add_internal_note(ticket_id: str, note: str) -> str:
    """Add an internal note to a ticket. Never include card numbers or secrets."""
    if re.search(r"\d{13,19}", re.sub(r"[ -]", "", note)):
        raise ToolError("Note rejected: it looks like it contains a card number. Remove it and retry.")
    NOTES.setdefault(ticket_id, []).append(note)
    return f"note added to {ticket_id}"

async def main():
    async with Client(mcp) as c:
        seen, cursor, pages = [], None, 0
        while True:
            r = (await c.call_tool("search_tickets", {"query": "refund", "cursor": cursor})).structured_content
            seen += [t["id"] for t in r["tickets"]]; pages += 1
            cursor = r["next_cursor"]
            if not cursor:
                break
        assert len(seen) == len(set(seen)) == r["total"]
        print(f"paged {len(seen)} refund tickets in {pages} pages (total {r['total']})")
        res = await c.read_resource("ticket://4803")
        print("resource:", res.contents[0].text)
        bad = await c.call_tool("add_internal_note", {"ticket_id": "4803", "note": "card 4242 4242 4242 4242 charged twice"})
        ok = await c.call_tool("add_internal_note", {"ticket_id": "4803", "note": "verified duplicate, refunded"})
        print("card note:", bad.is_error, "|", bad.content[0].text)
        print("clean note:", ok.is_error, "|", ok.structured_content)

asyncio.run(main())`
  },
  design: {
    lead: '<p>A remote MCP server is a production API whose caller is an AI on behalf of a user. It needs the same engineering as any API, plus care about who the real user is and what the model may do on their behalf.</p>',
    scale: [{ h: 'Stateless servers', p: 'Since the 2026-07-28 revision, any instance can serve any request: scale horizontally behind a load balancer; gateways can route on the Mcp-Method and Mcp-Name headers.' }, { h: 'Gateways', p: 'Enterprises put an MCP gateway in front of many servers for central auth, allow-lists, rate limits and audit logs.' }],
    fail: [{ h: 'Confused deputy', p: 'A server acting with its own broad credentials on behalf of any user lets the model access data the user cannot. Act with the user’s identity and scopes.' }, { h: 'Tool poisoning', p: 'Third-party servers can ship malicious tool descriptions or results that inject instructions. Allow-list servers and review them (Phase 8.4).' }],
    trade: [{ h: 'stdio vs remote', p: 'stdio servers are simple and local but run with the user’s machine permissions; remote servers centralise control and need auth and hosting.' }, { h: 'Generic vs task-shaped', p: 'A generic SQL tool is flexible and dangerous; task-shaped tools are safer and easier for models to use.' }],
    prompt: '<p>Design an MCP server that gives a bank’s employees AI access to their CRM, deployed for 5,000 users.</p>',
    answer: '<ul><li>Remote Streamable HTTP server, stateless, behind the bank’s gateway and SSO-backed OAuth.</li><li>Calls the CRM with the end user’s delegated token so CRM permissions apply; no shared service account for reads.</li><li>Task-shaped tools with redacted results; writes behind confirmation (input_required) and idempotency keys.</li><li>Audit log per call with user, tool and arguments; rate limits per user; allow-listed clients.</li></ul>'
  },
  quiz: [
    { q: 'Which MCP primitive is meant for data a host can read by URI?', o: ['Tools', 'Resources', 'Prompts', 'Sessions'], a: 1, why: 'Resources are addressable data; tools are actions; prompts are templates.' },
    { q: 'What did the 2026-07-28 specification remove?', o: ['Tools', 'The initialisation handshake and protocol-level sessions', 'JSON-RPC', 'Resources'], a: 1, why: 'Each request now carries version and capabilities; state lives in explicit handles.' },
    { q: 'Your remote MCP server uses one admin API key for every user. The risk is:', o: ['Slower responses', 'Users can reach data through the model that they could not access directly', 'Higher token cost', 'None'], a: 1, why: 'The confused-deputy problem: act with the user’s identity.' }
  ],
  interview: [
    { q: 'Why build an MCP server rather than custom tools inside one agent?', a: '<p>Reuse and control. One server makes the integration available to every MCP-capable host the customer uses, with permissions, rate limits and audit in one place. The tools inside still need careful design; MCP standardises transport, discovery and auth, not tool quality.</p>' },
    { q: 'How do you secure a remote MCP server?', a: '<p>OAuth-based authorization with token validation, calls to downstream systems made with the user’s delegated identity, least-privilege task-shaped tools, confirmation for risky actions, input validation, output redaction, rate limits, audit logs, and allow-listing which clients and servers may connect.</p>' }
  ]
});

/* ===================================================================== 5.4 */
L({
  id: '5.4', title: 'Memory', minutes: 50, roles: ['be', 'fde'],
  tags: 'short-term · working · long-term memory · episodic · semantic · procedural · write policy · retrieval scoring · forgetting',
  mental: 'Models do not remember; systems do. Memory is a data store your agent writes selected facts into and reads relevant ones back from. The hard parts are deciding what to keep, resolving conflicts, retrieving the right few items, and forgetting on request.',
  intro: `<p>Users expect an assistant to remember that they prefer short answers, that their company uses SAP, and what was decided last week. Within one conversation that is just history (lesson 3.1). Across conversations it needs a memory system: explicit storage, an extraction step, retrieval, and governance.</p>
  <p>Memory is also a privacy surface: it stores personal data indefinitely unless you design it not to. Users must be able to see, correct and delete what is stored.</p>`,
  points: [
    '<b>Short-term</b>: the conversation itself. <b>Working</b>: a scratchpad or state for the current task.',
    '<b>Long-term</b>: <i>semantic</i> (facts and preferences), <i>episodic</i> (what happened in past sessions), <i>procedural</i> (learned ways of doing things, such as instructions or skills).',
    'A write policy decides what is worth storing: stated preferences and durable facts, not every sentence or passing mood.',
    'Store facts with keys so updates replace old values (“prefers Python” then “now prefers Go”) instead of accumulating contradictions.',
    'Retrieve by relevance, recency and importance, and inject only a few items into context.',
    'Provide view, edit and forget operations; set retention; never store secrets or special-category data without a clear basis.'
  ],
  concept: { title: 'A notebook with an editor', body: `<p>Imagine an assistant with a notebook. After each meeting they write down only what will matter later, cross out facts that changed, and before the next meeting they read the relevant pages, not the whole notebook. The skill is in the editing: what to write, what to cross out, and what to read back.</p>` },
  walk: [
    { h: 'Extract, then upsert', body: '<p>After a turn (often asynchronously), a small model call extracts candidate memories as structured records. Code validates them and upserts by key.</p>', code: String.raw`class Memory(BaseModel):
    kind: Literal["preference", "fact", "event"]
    key: str           # e.g. "preference.language", stable so updates replace
    text: str
    importance: int = Field(ge=1, le=5)

candidates = extract_memories(turns)          # structured output from a small model
for m in candidates:
    store.upsert(user_id, m)                  # replaces same key, keeps history for audit` },
    { h: 'Score at retrieval', body: '<p>A common formula, popularised by the Generative Agents paper: score = relevance + recency + importance, each normalised. Take the top few and put them in the system prompt under a clear heading.</p>' },
    { h: 'Make memory visible', body: '<p>Show users what is remembered and let them delete it. Internally, keep an audit trail of writes, and a hard delete path for privacy requests.</p>' }
  ],
  analogy: `<p><b>A good family doctor’s records.</b> They note allergies and long-term conditions (semantic), visit summaries (episodic) and what treatment works for you (procedural). They update records when things change, glance at the relevant sections before each visit, and you can ask to see or correct them.</p>`,
  diagram: {
    title: 'Memory write and read paths',
    cols: [['conv'], ['ext'], ['val'], ['store'], ['ret'], ['ctx']],
    nodes: [
      { id: 'conv', label: 'Conversation', sub: 'turns', tone: 'fde', info: 'Source of candidate memories.' },
      { id: 'ext', label: 'Extractor', sub: 'small model · async', tone: 'acc', info: 'Proposes structured memories after a turn.' },
      { id: 'val', label: 'Write policy', sub: 'allow-list · PII rules', tone: 'bad', info: 'Drops secrets and disallowed categories; validates keys.' },
      { id: 'store', label: 'Memory store', sub: 'keyed · versioned', tone: 'be', info: 'Facts, preferences, events per user, with history and TTL.' },
      { id: 'ret', label: 'Retriever', sub: 'relevance + recency + importance', info: 'Scores and picks a few memories for the next request.' },
      { id: 'ctx', label: 'Prompt', sub: '"What you know about the user"', tone: 'ok', info: 'A short, clearly labelled section of the system prompt.' }
    ],
    edges: [{ a: 'conv', b: 'ext', step: 1 }, { a: 'ext', b: 'val', step: 2 }, { a: 'val', b: 'store', step: 3 }, { a: 'store', b: 'ret', step: 4 }, { a: 'ret', b: 'ctx', step: 5 }],
    steps: ['A turn finishes.', 'An extractor proposes memories.', 'The write policy filters and the store upserts by key.', 'At the next request, the retriever scores memories.', 'The top few go into the prompt.'],
    caption: 'Write selectively, upsert by key, read back a few.'
  },
  illustrated: { title: 'Retrieval scoring by hand', body: `<p>Query: “which language should the code examples use?” Weights: relevance 1, recency 1, importance 1.</p>
    <div class="tbl"><table><thead><tr><th>memory</th><th>relevance</th><th>recency</th><th>importance</th><th>score</th></tr></thead><tbody>
    <tr><td>prefers Go for new services (2 days ago)</td><td class="n">0.8</td><td class="n">0.95</td><td class="n">0.8</td><td class="n">2.55</td></tr>
    <tr><td>prefers Python (8 months ago, superseded)</td><td class="n">0.8</td><td class="n">0.10</td><td class="n">0.8</td><td>not retrieved: replaced by key</td></tr>
    <tr><td>company uses SAP (3 months ago)</td><td class="n">0.1</td><td class="n">0.40</td><td class="n">0.6</td><td class="n">1.10</td></tr>
    <tr><td>had a bad week (5 days ago)</td><td colspan="4">never stored: transient mood fails the write policy</td></tr></tbody></table></div>` },
  code: {
    title: 'A memory store with keyed upserts, scoring and forgetting', file: 'memory.py', browser: true,
    intro: '<p>SQLite-backed long-term memory. A rule-based extractor stands in for the small model call that proposes memories; everything after extraction is what production systems do: policy filtering, keyed upserts with history, scored retrieval, and a forget operation that really deletes.</p>',
    src: String.raw`import math, re, sqlite3, time

db = sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE memory (user TEXT, key TEXT, kind TEXT, text TEXT, importance INT, updated REAL, PRIMARY KEY (user, key));
CREATE TABLE memory_history (user TEXT, key TEXT, text TEXT, replaced REAL);
""")
NOW = 1_793_000_000.0                                    # fixed clock so the demo is repeatable
DAY = 86_400

def extract(turn: str) -> list[dict]:
    """Stand-in for a small-model extraction call returning structured candidates."""
    out = []
    if m := re.search(r"I (?:now )?prefer (\w+)", turn):
        out.append({"key": "preference.language", "kind": "preference", "text": f"prefers {m.group(1)}", "importance": 4})
    if m := re.search(r"we use (\w+) for (\w+)", turn):
        out.append({"key": f"fact.tool.{m.group(2)}", "kind": "fact", "text": f"uses {m.group(1)} for {m.group(2)}", "importance": 3})
    if re.search(r"\b\d{13,19}\b", turn):
        out.append({"key": "fact.card", "kind": "fact", "text": turn, "importance": 5})
    if "tired" in turn:
        out.append({"key": "mood", "kind": "event", "text": "user is tired", "importance": 1})
    return out

def allowed(m: dict) -> bool:                            # write policy
    if re.search(r"\d{13,19}", m["text"]): return False   # never store card-like numbers
    if m["kind"] == "event" and m["importance"] < 2: return False   # transient states are not durable
    return True

def remember(user: str, turn: str, at: float):
    for m in extract(turn):
        if not allowed(m):
            print(f"   policy dropped: {m['key']}"); continue
        old = db.execute("SELECT text FROM memory WHERE user=? AND key=?", (user, m["key"])).fetchone()
        if old and old[0] != m["text"]:
            db.execute("INSERT INTO memory_history VALUES (?,?,?,?)", (user, m["key"], old[0], at))
        db.execute("INSERT OR REPLACE INTO memory VALUES (?,?,?,?,?,?)", (user, m["key"], m["kind"], m["text"], m["importance"], at))

def recall(user: str, query: str, k: int = 2, half_life_days: float = 30):
    q = set(re.findall(r"\w+", query.lower()))
    rows = db.execute("SELECT key, text, importance, updated FROM memory WHERE user=?", (user,)).fetchall()
    scored = []
    for key, text, imp, upd in rows:
        rel = len(q & set(re.findall(r"\w+", (key + " " + text).lower()))) / (len(q) or 1)
        rec = math.exp(-math.log(2) * (NOW - upd) / (half_life_days * DAY))
        scored.append((round(rel + rec + imp / 5, 2), text))
    return sorted(scored, reverse=True)[:k]

def forget(user: str, key: str | None = None):
    where, args = ("user=? AND key=?", (user, key)) if key else ("user=?", (user,))
    db.execute(f"DELETE FROM memory WHERE {where}", args); db.execute(f"DELETE FROM memory_history WHERE {where}", args)

print("writing:")
for turn, days_ago in [("I prefer Python for scripts", 240), ("we use SAP for invoicing", 90), ("I'm tired today", 5),
                       ("my card is 4242424242424242, refund it", 3), ("Actually I now prefer Go", 2)]:
    print(f" '{turn}'"); remember("u1", turn, NOW - days_ago * DAY)

print("\nstored:", db.execute("SELECT key, text FROM memory WHERE user='u1' ORDER BY key").fetchall())
print("history:", db.execute("SELECT key, text FROM memory_history").fetchall())
print("recall('which language for the code examples'):", recall("u1", "which language for the code examples"))
forget("u1", "preference.language")
print("after forget(preference.language):", db.execute("SELECT key FROM memory WHERE user='u1'").fetchall(),
      "| history rows:", db.execute("SELECT count(*) FROM memory_history").fetchone()[0])`
  },
  lab: {
    title: 'Consolidate episodic memory', file: 'consolidate_lab.py', browser: true,
    scenario: `<p>An account-management assistant logs an episodic memory after every call with a customer. After six months there are hundreds per account and retrieval is slow and noisy. Implement consolidation: when an account has more than 8 episodes older than 30 days, merge them into one summary memory per topic, keep recent episodes as they are, and expire summaries after 365 days.</p>`,
    steps: ['Generate the seeded episodes in the starter (topic, text, days_ago).', 'Write <code class="i">consolidate(episodes, now)</code>: group old episodes (≥ 30 days) by topic when there are more than 8 old ones; produce one summary per topic with count, date range and the three most recent texts.', 'Keep episodes younger than 30 days untouched.', 'Drop anything older than 365 days.', 'Print before and after counts and the summaries.'],
    checks: ['Recent episodes are unchanged.', 'Each topic with old episodes becomes exactly one summary.', 'Nothing older than 365 days survives.'],
    hints: ['Sort old episodes by days_ago ascending to pick the most recent ones for the summary.', 'A summary is a dict with kind="summary"; a real system would ask a model to write it.'],
    starter: String.raw`import random
random.seed(9)
TOPICS = ["renewal", "billing", "sso", "support quality"]
episodes = [{"kind": "episode", "topic": random.choice(TOPICS), "text": f"call note {i}", "days_ago": random.randint(0, 420)} for i in range(60)]

def consolidate(episodes, keep_recent_days=30, max_age_days=365, min_old=8):
    # TODO
    return episodes

after = consolidate(episodes)
print(len(episodes), "->", len(after))`,
    solution: String.raw`import random
from collections import defaultdict
random.seed(9)
TOPICS = ["renewal", "billing", "sso", "support quality"]
episodes = [{"kind": "episode", "topic": random.choice(TOPICS), "text": f"call note {i}", "days_ago": random.randint(0, 420)} for i in range(60)]

def consolidate(episodes, keep_recent_days=30, max_age_days=365, min_old=8):
    alive = [e for e in episodes if e["days_ago"] <= max_age_days]
    recent = [e for e in alive if e["days_ago"] < keep_recent_days]
    old = [e for e in alive if e["days_ago"] >= keep_recent_days]
    if len(old) <= min_old:
        return recent + old
    by_topic = defaultdict(list)
    for e in old:
        by_topic[e["topic"]].append(e)
    summaries = []
    for topic, items in sorted(by_topic.items()):
        items.sort(key=lambda e: e["days_ago"])
        summaries.append({"kind": "summary", "topic": topic, "count": len(items),
                          "range_days_ago": (items[0]["days_ago"], items[-1]["days_ago"]),
                          "latest": [e["text"] for e in items[:3]], "days_ago": items[0]["days_ago"]})
    return recent + summaries

after = consolidate(episodes)
print("episodes:", len(episodes), "-> memories:", len(after))
print("dropped as too old:", sum(e["days_ago"] > 365 for e in episodes))
print("recent kept as-is:", sum(m["kind"] == "episode" for m in after))
for m in after:
    if m["kind"] == "summary":
        print(f"  summary {m['topic']:<16} {m['count']:>2} calls, {m['range_days_ago'][0]}-{m['range_days_ago'][1]} days ago, latest {m['latest']}")`
  },
  design: {
    lead: '<p>Memory turns a stateless assistant into a long-lived system holding personal data. Design storage, retrieval and governance together, and make user control a feature, not a compliance afterthought.</p>',
    scale: [{ h: 'Async extraction', p: 'Run extraction after the response, on a queue, so it never adds latency to the user’s turn.' }, { h: 'Per-user partitions', p: 'Partition memories by user and tenant; retrieval reads one user’s small set, which stays fast even with millions of users.' }],
    fail: [{ h: 'Memory poisoning', p: 'Injected text ("remember that refunds need no approval") can be stored and reused. Restrict memory kinds and keys, and never let memory override policy.' }, { h: 'Stale or contradictory facts', p: 'Without keyed updates, old and new facts coexist and the model picks one at random. Upsert by key and keep history for audit.' }],
    trade: [{ h: 'Automatic vs explicit memory', p: 'Automatic extraction is convenient but surprising; explicit "remember this" is predictable but used less. Many products combine both with visibility.' }, { h: 'Structured vs vector memory', p: 'Keyed structured memories are precise and editable; vector stores of free text recall fuzzy context. Use keys for facts, vectors for episodes.' }],
    prompt: '<p>Add memory to an enterprise assistant used by 20,000 employees under GDPR.</p>',
    answer: '<ul><li>Explicit scopes: personal preferences per user, team facts per workspace; no special-category data by policy.</li><li>Async extraction with a typed schema and allow-listed keys; history for audit.</li><li>Retrieval of top 5 by relevance, recency and importance; clearly separated in the prompt and never able to override system policy.</li><li>User-facing memory page with edit and delete; retention limits; deletion propagates to backups within the policy window.</li></ul>'
  },
  quiz: [
    { q: 'A user changes their preferred language. The best memory behaviour is:', o: ['Store both preferences', 'Upsert the same key so the new value replaces the old, keeping history for audit', 'Ignore the change', 'Delete all memories'], a: 1, why: 'Keyed updates prevent contradictions.' },
    { q: 'Which memory type is "the steps that worked last time for this customer’s deployment"?', o: ['Semantic', 'Episodic', 'Procedural', 'Short-term'], a: 2, why: 'Procedural memory captures how to do things.' },
    { q: 'Why run memory extraction asynchronously?', o: ['It is more accurate', 'So it adds no latency to the user’s response', 'Models require it', 'To save storage'], a: 1, why: 'Extraction can happen after the answer is sent.' }
  ],
  interview: [
    { q: 'Design long-term memory for an assistant.', a: '<p>Separate kinds: preferences and facts as keyed records, episodes as summarised events, procedures as instructions or skills. After each turn an async extractor proposes typed memories; a write policy filters them; the store upserts by key with history. At request time I score by relevance, recency and importance and inject a few items. Users can view, edit and delete; retention and privacy rules are enforced in code.</p>' },
    { q: 'What are the risks of agent memory?', a: '<p>Privacy (storing personal or sensitive data indefinitely), poisoning (injected content stored and reused as truth), staleness and contradictions, and cost or noise from retrieving too much. Mitigations: write policies, keyed updates, provenance and history, retrieval limits, and memory that can never override system policy.</p>' }
  ]
});

/* ===================================================================== 5.5 */
L({
  id: '5.5', title: 'Multi-agent and A2A', minutes: 55, roles: ['be', 'fde'],
  tags: 'orchestrator-workers · parallel subagents · handoffs · context isolation · token cost · A2A agent cards · tasks',
  mental: 'Multiple agents help when work splits into independent parts that benefit from separate context windows and parallel execution; they hurt when parts depend tightly on each other. A2A is the open protocol for agents built by different teams or vendors to delegate tasks to one another.',
  intro: `<p>Single agents hit two limits: one context window, and one thing at a time. An orchestrator that spawns subagents for independent sub-tasks, each with a clean context, can explore more in parallel. Anthropic reported that its multi-agent research system, a lead agent directing parallel subagents, clearly outperformed a single agent on its internal research evaluation, while using many times more tokens than a chat interaction. That trade defines when multi-agent is worth it.</p>
  <p>Across organisational boundaries, agents also need a common protocol. <b>A2A (Agent2Agent)</b>, started by Google and now hosted by the Linux Foundation, reached v1.0 in 2026: agents publish an <b>Agent Card</b> and exchange messages that create <b>Tasks</b> with defined states.</p>`,
  points: [
    '<b>Orchestrator-workers</b>: a lead agent plans, delegates sub-tasks to workers in parallel, then synthesises.',
    '<b>Handoffs</b>: one agent transfers the conversation to a specialist (lesson 5.7); simpler than orchestration.',
    'Wins: breadth-first research, independent checks, isolating noisy work from the main context. Losses: tightly coupled tasks such as most coding, where agents step on each other.',
    'Cost scales with agents and steps; budget per subagent and measure whether quality gains justify it.',
    'Give each subagent a precise brief: objective, output format, tools, boundaries and a token budget.',
    'A2A: Agent Card at <code class="i">/.well-known/agent-card.json</code>; operations such as SendMessage and GetTask; task states including working, input-required, completed, failed.'
  ],
  concept: { title: 'Parallel minds, separate notebooks', body: `<p>Each subagent gets its own context window, like a researcher with their own notebook. That isolation is the real benefit: the lead agent receives only compact findings, not every page each researcher read. The cost is coordination: briefs must be precise, results must be merged, and duplicated effort wastes tokens.</p>` },
  walk: [
    { h: 'Orchestrate with asyncio', body: '<p>Fan out briefs, gather results with timeouts, tolerate partial failure, synthesise.</p>', code: String.raw`briefs = plan(question)                           # lead agent: 3 to 5 independent sub-questions
results = await asyncio.gather(*(run_subagent(b) for b in briefs), return_exceptions=True)
findings = [r for r in results if not isinstance(r, Exception)]
answer = synthesise(question, findings)` },
    { h: 'Publish an Agent Card', body: '<p>An A2A server describes itself: name, skills, interfaces, capabilities and security. Clients discover it, then send messages that become tasks.</p>' },
    { h: 'When to choose which', body: `<div class="tbl"><table><thead><tr><th>situation</th><th>pattern</th></tr></thead><tbody>
      <tr><td>one domain, a handful of tools</td><td>single agent</td></tr>
      <tr><td>clear specialisms (billing, technical, sales)</td><td>router or handoffs</td></tr>
      <tr><td>wide research across many sources</td><td>orchestrator with parallel subagents</td></tr>
      <tr><td>agents owned by different teams or vendors</td><td>A2A between them</td></tr>
      <tr><td>agent needs tools or data</td><td>MCP (lesson 5.3), not A2A</td></tr></tbody></table></div>` }
  ],
  analogy: `<p><b>An editor and freelance reporters.</b> The editor splits a big story into angles, sends each reporter a clear brief with a word limit and a deadline, and writes the final piece from their filed copy. Reporters do not read each other’s notes. When the paper commissions another newsroom, it uses a standard commissioning form: that is A2A.</p>`,
  diagram: {
    title: 'Orchestrator-workers inside, A2A across organisations',
    cols: [['user'], ['lead'], ['w1', 'w2', 'w3'], ['synth'], ['ext']],
    groups: [{ cols: [2], label: 'PARALLEL SUBAGENTS' }],
    nodes: [
      { id: 'user', label: 'Question', tone: 'fde', info: 'A broad task, such as a vendor comparison.' },
      { id: 'lead', label: 'Lead agent', sub: 'plan · brief · budget', tone: 'acc', info: 'Splits the work, writes briefs, sets budgets.' },
      { id: 'w1', label: 'Subagent A', sub: 'own context', info: 'Researches one angle with its own tools and context.' },
      { id: 'w2', label: 'Subagent B', sub: 'own context', info: 'Runs in parallel.' },
      { id: 'w3', label: 'Subagent C', sub: 'own context', info: 'Can fail or time out without sinking the run.' },
      { id: 'synth', label: 'Synthesise', sub: 'compact findings', tone: 'ok', info: 'Lead merges compact findings into the answer.' },
      { id: 'ext', label: 'Partner agent', sub: 'A2A · Agent Card', tone: 'be', info: 'An agent owned by another team or company, called over A2A.' }
    ],
    edges: [{ a: 'user', b: 'lead', step: 1 }, { a: 'lead', b: 'w1', step: 2 }, { a: 'lead', b: 'w2', step: 2 }, { a: 'lead', b: 'w3', step: 2 }, { a: 'w1', b: 'synth', step: 3 }, { a: 'w2', b: 'synth', step: 3 }, { a: 'w3', b: 'synth', dash: true, step: 3 }, { a: 'synth', b: 'ext', dash: true, label: 'A2A', step: 4 }],
    steps: ['The question reaches the lead agent.', 'It sends briefs to parallel subagents.', 'Compact findings come back; failures are tolerated.', 'Work owned by another organisation is delegated over A2A.'],
    caption: 'Parallel subagents for breadth; A2A for crossing ownership boundaries.'
  },
  illustrated: { title: 'The token bill of multi-agent work', body: `<p>A research question answered three ways (illustrative):</p>
    <div class="tbl"><table><thead><tr><th>approach</th><th>model calls</th><th>tokens</th><th>wall time</th></tr></thead><tbody>
    <tr><td>single chat answer</td><td class="n">1</td><td class="n">≈ 6k</td><td class="n">8 s</td></tr>
    <tr><td>single agent, sequential searches</td><td class="n">12</td><td class="n">≈ 60k</td><td class="n">90 s</td></tr>
    <tr><td>lead + 4 parallel subagents</td><td class="n">40</td><td class="n">≈ 200k</td><td class="n">35 s</td></tr></tbody></table></div>
    <p>Multi-agent is faster and broader, and several times more expensive. Worth it for high-value research; wasteful for routine questions.</p>` },
  code: {
    title: 'An orchestrator with parallel subagents, plus an A2A Agent Card', file: 'orchestrator.py', deps: 'uv add a2a-sdk',
    intro: '<p>Part 1: a lead agent fans out briefs to subagents in parallel with a per-subagent timeout and token budget, tolerates a failure, and synthesises. Subagents are simulated with seeded latency and token use so the run is repeatable. Part 2: the Agent Card a partner team would publish for its refund agent, built with the official A2A Python SDK and printed as JSON.</p>',
    src: String.raw`import asyncio, json, random, time
from dataclasses import dataclass

@dataclass
class Brief:
    topic: str
    objective: str
    max_tokens: int = 20_000

@dataclass
class Finding:
    topic: str
    summary: str
    tokens: int

async def subagent(brief: Brief, rng: random.Random) -> Finding:
    """Stand-in for a full agent loop (lesson 5.1) with its own context and tools."""
    await asyncio.sleep(rng.uniform(0.05, 0.15))
    if brief.topic == "pricing pages":
        await asyncio.sleep(1.0)                          # this one hangs; the timeout will cut it off
    tokens = rng.randint(9_000, 18_000)
    return Finding(brief.topic, f"{brief.topic}: 3 key facts with sources", tokens)

def plan(question: str) -> list[Brief]:
    """Stand-in for the lead agent's planning call."""
    return [Brief(t, f"Find {t} relevant to: {question}. Return 3 facts with sources.")
            for t in ("security certifications", "data residency", "pricing pages", "customer references")]

async def orchestrate(question: str, timeout_s: float = 0.5):
    rng, t0 = random.Random(3), time.perf_counter()
    briefs = plan(question)
    tasks = [asyncio.wait_for(subagent(b, rng), timeout_s) for b in briefs]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    found = [r for r in results if isinstance(r, Finding)]
    failed = [b.topic for b, r in zip(briefs, results) if not isinstance(r, Finding)]
    lead_tokens = 6_000 + 400 * len(found)               # planning + synthesis calls
    total = lead_tokens + sum(f.tokens for f in found)
    print(f"briefs: {len(briefs)} | succeeded: {len(found)} | failed/timed out: {failed}")
    print(f"wall time {time.perf_counter() - t0:.2f}s (parallel) | tokens: lead {lead_tokens:,} + subagents {sum(f.tokens for f in found):,} = {total:,}")
    print("answer built from:", [f.summary for f in found])

asyncio.run(orchestrate("Which vendor meets our EU data residency needs?"))

# ---- part 2: an A2A Agent Card for a partner team's refund agent ----
from google.protobuf.json_format import MessageToJson
from a2a.types import AgentCard, AgentCapabilities, AgentInterface, AgentSkill, AgentProvider
card = AgentCard(
    name="refund-agent", description="Investigates duplicate charges and issues refunds within policy.", version="1.4.0",
    provider=AgentProvider(organization="Acme Billing Platform", url="https://acme.example"),
    supported_interfaces=[AgentInterface(url="https://agents.acme.example/refunds/a2a", protocol_binding="JSONRPC")],
    capabilities=AgentCapabilities(streaming=True, push_notifications=True),
    default_input_modes=["text/plain", "application/json"], default_output_modes=["application/json"],
    skills=[AgentSkill(id="refund-duplicate", name="Refund duplicate charges", description="Find and refund duplicate charges on an invoice",
                       tags=["billing", "refunds"], examples=["Refund the duplicate charge on INV-991"])])
print("\nGET /.well-known/agent-card.json ->")
print(MessageToJson(card))`
  },
  lab: {
    title: 'Budgeted fan-out with a quality check', file: 'fanout_lab.py', browser: true,
    scenario: `<p>A customer’s due-diligence assistant sends one subagent per supplier document (12 documents). Some subagents are slow, some return empty findings, and the total budget is 110,000 tokens. Implement an orchestrator that runs at most 4 subagents at a time, cancels any that exceed 2 seconds (scaled), stops launching new ones when the budget would be exceeded, re-runs an empty finding once, and reports coverage.</p>`,
    steps: ['Use the seeded fake subagent in the starter: it returns <code class="i">(finding, tokens)</code> and may sleep long or return an empty finding.', 'Use an <code class="i">asyncio.Semaphore(4)</code> and <code class="i">asyncio.wait_for</code> for the time limit.', 'Reserve each subagent’s worst-case 15,000 tokens before launch; release the unused part afterwards.', 'Retry an empty finding once.', 'Print: documents covered, timed out, skipped for budget, tokens used.'],
    checks: ['Never more than 4 subagents in flight.', 'Token use never exceeds 110,000.', 'Every document is accounted for in exactly one category.'],
    hints: ['Keep reservations in a shared dict guarded by the event loop (no threads involved).', 'Track in-flight count with a counter you increment and decrement around the work.'],
    starter: String.raw`import asyncio, random
SCALE = 100
rng = random.Random(12)
PLAN = [(f"doc-{i:02d}", rng.random()) for i in range(12)]

async def fake_subagent(doc, roll, attempt):
    await asyncio.sleep((3.0 if roll < 0.15 else 0.5 + roll) / SCALE)
    if roll > 0.85 and attempt == 0:
        return "", 4_000
    return f"{doc}: obligations, renewal date, liability cap", 9_000 + int(roll * 5_000)

async def orchestrate(budget=110_000, limit=4, timeout=2.0):
    # TODO
    return {}

print(asyncio.run(orchestrate()))`,
    solution: String.raw`import asyncio, random
SCALE = 100
rng = random.Random(12)
PLAN = [(f"doc-{i:02d}", rng.random()) for i in range(12)]

async def fake_subagent(doc, roll, attempt):
    await asyncio.sleep((3.0 if roll < 0.15 else 0.5 + roll) / SCALE)
    if roll > 0.85 and attempt == 0:
        return "", 4_000
    return f"{doc}: obligations, renewal date, liability cap", 9_000 + int(roll * 5_000)

WORST = 15_000

async def orchestrate(budget=110_000, limit=4, timeout=2.0):
    sem = asyncio.Semaphore(limit)
    state = {"used": 0, "reserved": 0, "inflight": 0, "peak": 0}
    out = {"covered": [], "timed_out": [], "skipped_budget": [], "empty": []}

    async def one(doc, roll):
        async with sem:
            for attempt in range(2):
                if state["used"] + state["reserved"] + WORST > budget:
                    out["skipped_budget"].append(doc); return
                state["reserved"] += WORST; state["inflight"] += 1; state["peak"] = max(state["peak"], state["inflight"])
                try:
                    finding, tokens = await asyncio.wait_for(fake_subagent(doc, roll, attempt), timeout / SCALE)
                except TimeoutError:
                    state["used"] += WORST // 3              # a cancelled run still cost something
                    out["timed_out"].append(doc); return
                finally:
                    state["reserved"] -= WORST; state["inflight"] -= 1
                state["used"] += tokens
                if finding:
                    out["covered"].append(doc); return
            out["empty"].append(doc)

    await asyncio.gather(*(one(d, r) for d, r in PLAN))
    return {k: len(v) for k, v in out.items()} | {"tokens_used": state["used"], "peak_in_flight": state["peak"]}

r = asyncio.run(orchestrate())
print(r)
assert r["peak_in_flight"] <= 4 and r["tokens_used"] <= 110_000
assert r["covered"] + r["timed_out"] + r["skipped_budget"] + r["empty"] == 12`
  },
  design: {
    lead: '<p>Multi-agent systems multiply everything: calls, tokens, failure modes and debugging effort. Choose them for measurable gains, and engineer the coordination as carefully as the agents.</p>',
    scale: [{ h: 'Concurrency and quotas', p: 'Fan-out hits provider rate limits fast. Bound parallelism per run and per tenant, and use cheaper models for subagents where evals allow.' }, { h: 'Tracing across agents', p: 'One trace id across lead and subagents, with spans per agent (lesson 3.7), or debugging becomes impossible.' }],
    fail: [{ h: 'Vague briefs', p: 'Subagents with fuzzy objectives duplicate each other or wander. Briefs need scope, output format and boundaries.' }, { h: 'Cascading trust', p: 'A subagent that read a malicious web page can pass injected instructions up. Treat subagent output as data, not instructions (Phase 8).' }],
    trade: [{ h: 'Speed and breadth vs cost', p: 'Parallel subagents finish faster and cover more ground, at several times the tokens.' }, { h: 'A2A vs direct integration', p: 'A2A decouples teams and vendors with a standard contract; inside one codebase, plain function calls or a framework are simpler.' }],
    prompt: '<p>A consulting firm wants an assistant that produces a 10-page market scan in 15 minutes. Single or multi-agent?</p>',
    answer: '<ul><li>Multi-agent: lead plans 6 to 10 angles; subagents research in parallel with web and internal search tools and token budgets.</li><li>Findings returned as structured notes with citations; lead synthesises and a verifier checks citations.</li><li>Concurrency capped per run; cheaper models for subagents if evals hold.</li><li>Cost per report tracked against the value; single-agent fallback for quick scans.</li></ul>'
  },
  quiz: [
    { q: 'Which task benefits most from parallel subagents?', o: ['Fixing one failing unit test', 'Researching ten independent vendors', 'Formatting a date', 'Classifying a ticket'], a: 1, why: 'Independent sub-tasks parallelise well.' },
    { q: 'Where is an A2A agent’s card published?', o: ['/agent.json', '/.well-known/agent-card.json', '/mcp', '/openapi.json'], a: 1, why: 'A2A uses a well-known URI for discovery.' },
    { q: 'MCP or A2A: an agent needs to read a customer’s CRM.', o: ['A2A', 'MCP', 'Neither', 'Both are required'], a: 1, why: 'MCP connects agents to tools and data; A2A connects agents to agents.' }
  ],
  interview: [
    { q: 'When is a multi-agent architecture justified?', a: '<p>When the task decomposes into independent parts that benefit from parallel work and separate context windows, such as broad research or independent reviews, and when the value justifies a several-fold token cost. For tightly coupled tasks or simple routing I prefer a single agent or handoffs, which are cheaper and easier to debug.</p>' },
    { q: 'How do MCP and A2A differ?', a: '<p>MCP connects an AI application to tools, resources and prompts exposed by servers. A2A connects agents to other agents as peers: discovery through an Agent Card, delegation through messages that create tasks with lifecycle states, streaming and push notifications. An agent can use MCP for its tools and A2A to delegate to a partner’s agent.</p>' }
  ]
});
})();

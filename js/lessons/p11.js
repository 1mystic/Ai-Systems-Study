/* Phase 11 · FDE craft (part 1) */
(function () {
const L = AISA.lesson;

/* ===================================================================== 11.1 */
L({
  id: '11.1', title: 'Discovery: symptom vs problem', minutes: 45, roles: ['fde'],
  tags: 'stakeholder interviews · current-state mapping · five whys · baseline metrics · data before solutions · success criteria · problem statements',
  mental: 'Customers arrive with solutions (“we need a chatbot”, “fine-tune a model on our documents”). Discovery turns those asks into the underlying problem, measured with their own data, owned by a named person, with a success metric agreed before anything is built.',
  intro: `<p>Forward deployed engineers are judged on outcomes in the customer’s business, not on what was built. The most expensive mistake in an engagement is building the right thing for the wrong problem. Discovery is a structured, short phase (often days, not weeks) of interviews, observation and data analysis that ends in a written problem statement and success criteria both sides sign off.</p>`,
  points: [
    'Separate the <b>ask</b> (a proposed solution), the <b>symptom</b> (what hurts) and the <b>problem</b> (the cause you can change).',
    'Interview across levels: the sponsor (why now, what success means), the people doing the work (how it really happens), IT and security (constraints).',
    'Watch the work: shadow agents, reviewers or analysts for an hour; workflows on paper differ from workflows in practice.',
    'Get data early: ticket exports, logs, document samples, volumes, handling times. Size the problem with numbers.',
    'Write a problem statement: who, what, how much, why it matters, how we will know it is fixed.',
    'Agree success criteria and a baseline before building; otherwise every result is arguable.'
  ],
  concept: { title: 'A doctor does not prescribe what the patient asks for', body: `<p>A patient asking for antibiotics may have a viral infection. A good doctor asks questions, examines, runs a test, and then prescribes what fits. An FDE treats “we need a chatbot” the same way: a valid starting point for questions, not a specification.</p>` },
  walk: [
    { h: 'Questions that uncover the problem', body: '<p>Open, specific and about past behaviour, not hypotheticals.</p><ul><li>“Walk me through the last time this went wrong. What happened next?”</li><li>“What does this cost you today: hours, money, customers, risk?”</li><li>“Who feels this most? Who decides whether it is fixed?”</li><li>“What have you tried already? Why did it not work?”</li><li>“If this worked perfectly in six months, what number would have changed?”</li></ul>' },
    { h: 'Five whys, with data', body: '<p>“Agents are slow” → why? “They search five systems” → why? “Order status is not in the CRM” → why? ... Each answer is a hypothesis; check the important ones against data before accepting them. The lab does this with a ticket export.</p>' },
    { h: 'The written output', body: '<p>A one-page discovery summary: current state, problem statement with numbers, root causes, constraints, candidate approaches (including non-AI ones), success metrics with baseline and target, owners and next steps. Send it within a day while memories are fresh.</p>' }
  ],
  analogy: `<p><b>An architect visiting before drawing.</b> A client asks for “a bigger kitchen”. The architect watches how the family cooks and finds that the real problem is no space to put shopping down near the door. A shelf and a moved doorway solve it for a tenth of the cost.</p>`,
  diagram: {
    title: 'From ask to agreed problem',
    cols: [['ask'], ['int', 'obs', 'data'], ['hyp'], ['ps'], ['crit']],
    nodes: [
      { id: 'ask', label: 'The ask', sub: '“we need a chatbot”', tone: 'warn', info: 'A proposed solution; a starting point for questions.' },
      { id: 'int', label: 'Interviews', sub: 'sponsor · users · IT', tone: 'fde', info: 'Past behaviour, costs, constraints, previous attempts.' },
      { id: 'obs', label: 'Observation', sub: 'shadow the work', tone: 'fde', info: 'Real workflows, workarounds, tools.' },
      { id: 'data', label: 'Data', sub: 'exports · logs · samples', tone: 'acc', info: 'Size the problem; test hypotheses.' },
      { id: 'hyp', label: 'Root causes', sub: 'tested hypotheses', tone: 'be', info: 'Five whys checked against data.' },
      { id: 'ps', label: 'Problem statement', sub: 'who · what · how much', tone: 'ok', info: 'One page, signed off by the sponsor.' },
      { id: 'crit', label: 'Success criteria', sub: 'baseline → target', tone: 'ok', info: 'Agreed before building.' }
    ],
    edges: [{ a: 'ask', b: 'int' }, { a: 'ask', b: 'obs' }, { a: 'ask', b: 'data' }, { a: 'int', b: 'hyp' }, { a: 'obs', b: 'hyp' }, { a: 'data', b: 'hyp' }, { a: 'hyp', b: 'ps' }, { a: 'ps', b: 'crit' }],
    caption: 'Three sources of evidence converge on a measured, agreed problem.'
  },
  illustrated: { title: 'Ask, symptom, problem', body: `<div class="tbl"><table><thead><tr><th>the ask</th><th>the symptom</th><th>the problem found</th><th>what was built</th></tr></thead><tbody>
    <tr><td>“A chatbot for customers”</td><td>support queue up 40%</td><td>38% of tickets ask for order status that exists in the ERP</td><td>status self-service via an API tool, then a narrow assistant</td></tr>
    <tr><td>“Fine-tune on our contracts”</td><td>legal review takes 3 days</td><td>reviewers hunt for 12 standard clauses across varied templates</td><td>clause extraction with citations and a review UI</td></tr>
    <tr><td>“An AI analyst”</td><td>executives wait a week for reports</td><td>metric definitions differ across teams; the data model is the bottleneck</td><td>semantic layer first, then natural-language queries on it</td></tr></tbody></table></div>` },
  code: {
    title: 'Turn interview notes and a ticket export into a sized problem statement', file: 'discovery.py', browser: true,
    intro: '<p>Takes tagged interview notes (who said what) and a synthetic ticket export, sizes each candidate problem by volume and handling time, checks stakeholder claims against the data, and prints a draft problem statement with a baseline. The data is generated; in an engagement it comes from the customer’s helpdesk export.</p>',
    src: String.raw`import random, statistics
from collections import Counter, defaultdict
random.seed(11)

NOTES = [
    ("VP Support (sponsor)", "We need a chatbot so customers stop emailing us.", "ask"),
    ("VP Support (sponsor)", "Queue grew 40% since the price change; CSAT fell from 4.4 to 3.9.", "symptom"),
    ("Agent, tier 1", "Half my day is looking up where an order is. It is in the ERP but we cannot see it in the helpdesk.", "claim:order_status"),
    ("Agent, tier 1", "Refund questions take forever because I need finance to approve anything over $200.", "claim:refunds"),
    ("Team lead", "The knowledge base is outdated, so agents write the same answers again.", "claim:kb"),
    ("IT", "ERP has a read API; helpdesk is Zendesk-like; SSO via Entra ID.", "constraint"),
]
CATS = {"order_status": (0.38, 9), "refunds": (0.12, 22), "how_to": (0.27, 7), "billing": (0.15, 12), "other": (0.08, 10)}
tickets = []
for i in range(6000):
    cat = random.choices(list(CATS), weights=[w for w, _ in CATS.values()])[0]
    tickets.append({"cat": cat, "minutes": max(1, random.gauss(CATS[cat][1], CATS[cat][1] * 0.3)), "reopened": random.random() < (0.18 if cat == "how_to" else 0.06)})

by = defaultdict(list)
for t in tickets: by[t["cat"]].append(t)
total_min = sum(t["minutes"] for t in tickets)
print("Sizing (6,000 tickets, 30 days):")
for cat, ts in sorted(by.items(), key=lambda kv: -sum(t["minutes"] for t in kv[1])):
    mins = sum(t["minutes"] for t in ts)
    print(f"  {cat:<13} {len(ts)/len(tickets):5.1%} of tickets  {mins/total_min:5.1%} of agent time  median {statistics.median(t['minutes'] for t in ts):4.1f} min  reopened {sum(t['reopened'] for t in ts)/len(ts):.0%}")

print("\nClaims vs data:")
share = lambda c: len(by[c]) / len(tickets)
time_share = lambda c: sum(t["minutes"] for t in by[c]) / total_min
checks = {"order_status": f"supported: {share('order_status'):.0%} of tickets, {time_share('order_status'):.0%} of agent time ('half my day' overstates it)",
          "refunds": f"partly: only {share('refunds'):.0%} of tickets but slow (median {statistics.median(t['minutes'] for t in by['refunds']):.0f} min); bottleneck is an approval policy, not AI",
          "kb": f"plausible: how_to tickets reopen at {sum(t['reopened'] for t in by['how_to'])/len(by['how_to']):.0%} vs ~6% elsewhere"}
for who, text, tag in NOTES:
    if tag.startswith("claim:"):
        print(f"  {who:<15} '{text[:58]}...' -> {checks[tag.split(':')[1]]}")

hours = sum(t["minutes"] for t in by["order_status"]) / 60
print(f"""
DRAFT PROBLEM STATEMENT
Tier-1 agents spend {hours:,.0f} hours a month ({time_share('order_status'):.0%} of handling time) answering order-status questions
whose answers already exist in the ERP but are not visible in the helpdesk. Customers wait for answers they could get instantly.
Baseline: {share('order_status'):.0%} of tickets, median {statistics.median(t['minutes'] for t in by['order_status']):.0f} min each, CSAT 3.9.
Target (90 days): halve order-status tickets via self-service and agent-side lookup; CSAT back to 4.3.
Not in scope now: refund approvals (policy change, owner: Finance); KB refresh (phase 2 candidate).""")`
  },
  lab: {
    title: 'Test the sponsor’s hypothesis with their data', file: 'hypothesis_lab.py', browser: true,
    scenario: `<p>The COO of a logistics company says: “Our drivers call dispatch too much because the app is confusing; build an AI assistant in the app.” You have 30 days of call records (in SQLite). Write queries that test the hypothesis, find the real drivers of call volume, and write three findings with numbers plus one recommendation the COO can act on, which may not be an assistant.</p>`,
    steps: ['Load the generated <code class="i">calls</code> table: driver_id, reason, minutes, hour, app_version, route_changed (0/1).', 'Volume and minutes by reason; share of calls about the app.', 'Calls per driver by app version: does a newer version reduce calls?', 'Calls by whether the route changed that day, and by hour.', 'Print findings and a recommendation.'],
    checks: ['Findings cite numbers from queries.', 'The hypothesis is accepted or rejected explicitly.', 'The recommendation addresses the largest driver of volume.'],
    hints: ['Use GROUP BY with SUM(minutes) as well as COUNT(*); volume and effort can disagree.', 'Correlation is not causation: say what you would test next.'],
    starter: String.raw`import random, sqlite3
random.seed(3)
db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE calls (driver_id INT, reason TEXT, minutes REAL, hour INT, app_version TEXT, route_changed INT)")
for d in range(300):
    ver = random.choice(["4.1", "4.2"])
    for day in range(30):
        changed = random.random() < 0.25
        for _ in range(random.choice([0, 0, 1, 1, 2]) + (3 if changed else 0)):
            reason = random.choices(["route_change", "delivery_address", "app_issue", "pay", "other"],
                                    weights=[6 if changed else 0.5, 3, 1.2 if ver == "4.1" else 1.0, 1, 1])[0]
            db.execute("INSERT INTO calls VALUES (?,?,?,?,?,?)", (d, reason, max(0.5, random.gauss(4 if reason != "route_change" else 7, 1.5)),
                       random.choice([6, 7, 7, 8, 9, 12, 15, 16]), ver, int(changed)))
# TODO: queries and findings`,
    solution: String.raw`import random, sqlite3
random.seed(3)
db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE calls (driver_id INT, reason TEXT, minutes REAL, hour INT, app_version TEXT, route_changed INT)")
for d in range(300):
    ver = random.choice(["4.1", "4.2"])
    for day in range(30):
        changed = random.random() < 0.25
        for _ in range(random.choice([0, 0, 1, 1, 2]) + (3 if changed else 0)):
            reason = random.choices(["route_change", "delivery_address", "app_issue", "pay", "other"],
                                    weights=[6 if changed else 0.5, 3, 1.2 if ver == "4.1" else 1.0, 1, 1])[0]
            db.execute("INSERT INTO calls VALUES (?,?,?,?,?,?)", (d, reason, max(0.5, random.gauss(4 if reason != "route_change" else 7, 1.5)),
                       random.choice([6, 7, 7, 8, 9, 12, 15, 16]), ver, int(changed)))

total, total_min = db.execute("SELECT COUNT(*), SUM(minutes) FROM calls").fetchone()
print(f"{total:,} calls, {total_min/60:,.0f} dispatcher hours in 30 days")
for reason, n, m in db.execute("SELECT reason, COUNT(*), SUM(minutes) FROM calls GROUP BY reason ORDER BY SUM(minutes) DESC"):
    print(f"  {reason:<17} {n/total:5.1%} of calls  {m/total_min:5.1%} of minutes")
print("calls per driver-day by app version:")
for ver, cpd, app in db.execute("SELECT app_version, COUNT(*)*1.0/(COUNT(DISTINCT driver_id)*30), AVG(reason='app_issue') FROM calls GROUP BY app_version"):
    print(f"  v{ver}: {cpd:.2f} calls/driver-day, {app:.1%} about the app")
rows = dict(db.execute("SELECT route_changed, COUNT(*) FROM calls GROUP BY route_changed").fetchall())
print(f"route changed that day: {rows[1]/total:.0%} of calls (route changes occur on ~25% of driver-days)")
app_share = db.execute("SELECT AVG(reason='app_issue') FROM calls").fetchone()[0]
rc_min = db.execute("SELECT SUM(minutes) FROM calls WHERE reason='route_change'").fetchone()[0] / total_min
print(f"""
FINDINGS
1. The hypothesis is not supported: app issues are {app_share:.0%} of calls; v4.2 barely changes call rates.
2. Route changes drive the load: {rows[1]/total:.0%} of calls happen on route-change days, and route-change calls take {rc_min:.0%} of dispatcher minutes.
3. Delivery-address questions are the next biggest category; worth checking address data quality.
RECOMMENDATION
Push route changes to drivers proactively (in-app notification with the new stop list and reason), then measure call volume on
route-change days for two weeks. An in-app assistant can come later for address questions if volume remains.
NEXT TEST: A/B the proactive notification across depots before building anything conversational.""")`
  },
  design: {
    lead: '<p>Discovery is the highest-leverage week of an engagement. Its design goal: reach a measured, agreed problem fast, with evidence the sponsor trusts, and with non-AI options considered honestly.</p>',
    scale: [{ h: 'Across many customers', p: 'Reusable discovery kits: interview guides per use case, data request templates, a sizing notebook and a summary template make discovery repeatable across a team.' }, { h: 'Time-boxing', p: 'Two to ten working days for most engagements; the output is a decision, not a research report.' }],
    fail: [{ h: 'Building the ask', p: 'Delivering exactly what was requested without checking the problem often produces a polished tool nobody uses.' }, { h: 'Only talking to executives', p: 'Sponsors know the why; front-line users know the how. Missing either gives a wrong picture.' }],
    trade: [{ h: 'Speed vs certainty', p: 'More discovery reduces risk but delays value. Pick the riskiest assumptions and test those; build to learn the rest.' }, { h: 'Challenging the sponsor', p: 'Disagreeing with the ask risks friction; doing it with their own data and a clear alternative usually earns trust.' }],
    prompt: '<p>A bank’s Head of Operations asks you to “put GPT on our procedures manual”. Plan the first week.</p>',
    answer: '<ul><li>Day 1: sponsor interview (why now, outcomes, budget, risk appetite); request data: procedures, query logs, error and rework reports.</li><li>Days 2–3: shadow operations staff; interview compliance, IT security and the manual owners.</li><li>Day 4: size questions by type and cost; test hypotheses (findability vs outdated content vs ambiguous policy).</li><li>Day 5: one-page summary with problem statement, baseline, success criteria, constraints, two or three options including non-AI fixes, and a proposed pilot.</li></ul>'
  },
  quiz: [
    { q: '“We need a chatbot” is best treated as:', o: ['A specification', 'A proposed solution to investigate', 'A rejection', 'An eval metric'], a: 1, why: 'Find the problem behind the ask.' },
    { q: 'Which question best uncovers the real problem?', o: ['Would you like AI?', 'Walk me through the last time this went wrong', 'Which model do you prefer?', 'What colour should the UI be?'], a: 1, why: 'Past, specific behaviour reveals reality.' },
    { q: 'Why agree a baseline before building?', o: ['To slow things down', 'So success can be measured and is not arguable later', 'Providers require it', 'For pricing'], a: 1, why: 'No baseline, no proof of value.' }
  ],
  interview: [
    { q: 'How do you run discovery with a new customer?', a: '<p>Time-boxed: interview the sponsor for goals and constraints, the front-line users for how work really happens, and IT and security for constraints; shadow the work; get data early and size the problem; test the main hypotheses against data; write a one-page problem statement with baseline and success criteria and get it signed off; include non-AI options.</p>' },
    { q: 'Tell me about a time the customer asked for the wrong thing.', a: '<p>Use STAR: the ask, how you investigated (interviews, data), what you found with numbers, how you presented it to the sponsor with an alternative, and the measured outcome. Show respect for the customer’s intent while steering to the real problem.</p>' }
  ]
});

/* ===================================================================== 11.2 */
L({
  id: '11.2', title: 'Decomposition framework', minutes: 45, roles: ['fde'],
  tags: 'workflow mapping · task graphs · deterministic vs model vs human steps · interfaces and contracts · risk-first · thin vertical slices',
  mental: 'A vague goal becomes buildable when it is decomposed into a graph of steps with typed inputs and outputs, each assigned to the simplest reliable mechanism: code, a query, retrieval, a model call or a person. The riskiest step is built and tested first.',
  intro: `<p>“Automate RFP responses”, “AI for claims” and “a research agent” are not specifications. FDE interviews test exactly this skill: take an ambiguous business goal and break it into components with clear contracts, decide where AI adds value and where it adds risk, and propose an order of work. The same framework drives real engagements.</p>`,
  points: [
    'Map the current workflow first: steps, people, systems, inputs, outputs, volumes and failure points.',
    'Define each step’s contract: input type, output type, quality bar, latency and who consumes it.',
    'Assign the cheapest reliable mechanism: rules and code → database queries → retrieval → classification or extraction models → generation → agents → humans.',
    'Mark uncertainty and risk per step: data availability, accuracy needed, cost of errors, integration difficulty.',
    'Build a thin vertical slice end to end, starting with the riskiest assumption.',
    'Keep humans where judgement, accountability or regulation requires it; design their review step well.'
  ],
  concept: { title: 'Breaking a meal into recipes and stations', body: `<p>A banquet is impossible to cook as one task. A head chef splits it into dishes, each dish into preparations, each preparation onto a station with its own tools, and knows which dish is hardest so it is tested first. Some prep is done by machines, some needs a skilled cook, and the head chef tastes before anything leaves the kitchen.</p>` },
  walk: [
    { h: 'Map then type', body: '<p>Write the workflow as nodes with typed contracts. Typed contracts make components testable and replaceable.</p>', code: String.raw`@dataclass
class Step:
    name: str
    inputs: list[str]
    output: str
    mechanism: Literal["code", "query", "retrieval", "extract", "generate", "agent", "human"]
    accuracy_needed: float       # what the business needs
    risk: int                    # 1-5: data, accuracy, integration uncertainty` },
    { h: 'Choose mechanisms deliberately', body: '<p>Ask for each step: is there a deterministic answer (code or query)? Is the answer in documents (retrieval)? Is it a fixed set of labels or fields (classification or extraction)? Only then consider free generation or agents. Each step up adds cost, latency and variance.</p>' },
    { h: 'Order by risk and value', body: '<p>The first slice should touch the riskiest step (e.g. extraction accuracy on messy scans) with real data, end to end, even if other steps are stubbed. That answers the question that could kill the project.</p>' }
  ],
  analogy: `<p><b>Building a bridge.</b> Engineers do not start by painting railings. They survey the river bed (the riskiest unknown), design the load path piece by piece with known interfaces, use standard beams where possible and custom parts only where necessary.</p>`,
  diagram: {
    title: 'RFP response workflow, decomposed',
    cols: [['ingest'], ['split'], ['classify'], ['retrieve', 'reuse'], ['draft'], ['review'], ['assemble']],
    nodes: [
      { id: 'ingest', label: 'Ingest RFP', sub: 'code · PDF/DOCX parse', info: 'Deterministic parsing (4.1).' },
      { id: 'split', label: 'Split questions', sub: 'extract', tone: 'acc', info: 'Model-assisted extraction with schema.' },
      { id: 'classify', label: 'Route question', sub: 'classify: topic · owner', tone: 'acc', info: 'Fixed label set; cheap model.' },
      { id: 'reuse', label: 'Past answers', sub: 'retrieval', tone: 'be', info: 'Approved answers library; often enough.' },
      { id: 'retrieve', label: 'Product docs', sub: 'retrieval', tone: 'be', info: 'For new questions.' },
      { id: 'draft', label: 'Draft answer', sub: 'generate · cited', tone: 'warn', info: 'Only when no approved answer fits.' },
      { id: 'review', label: 'SME review', sub: 'human', tone: 'fde', info: 'Accountability; edits feed the library.' },
      { id: 'assemble', label: 'Assemble document', sub: 'code · template', tone: 'ok', info: 'Deterministic formatting.' }
    ],
    edges: [{ a: 'ingest', b: 'split' }, { a: 'split', b: 'classify' }, { a: 'classify', b: 'reuse' }, { a: 'classify', b: 'retrieve' }, { a: 'reuse', b: 'draft' }, { a: 'retrieve', b: 'draft' }, { a: 'draft', b: 'review' }, { a: 'review', b: 'assemble' }, { a: 'review', b: 'reuse', dash: true, bend: 50, label: 'approved' }],
    caption: 'Code where possible, retrieval before generation, people where accountability lives.'
  },
  illustrated: { title: 'Mechanism ladder', body: `<div class="tbl"><table><thead><tr><th>mechanism</th><th>use when</th><th>cost and variance</th></tr></thead><tbody>
    <tr><td>code / rules</td><td>logic is known and stable</td><td>lowest, deterministic</td></tr>
    <tr><td>database query or API</td><td>the answer exists in a system</td><td>low, exact</td></tr>
    <tr><td>retrieval</td><td>the answer is in documents</td><td>low, quality depends on the index</td></tr>
    <tr><td>classify / extract</td><td>fixed labels or fields from text</td><td>medium, measurable accuracy</td></tr>
    <tr><td>generate</td><td>new text grounded in sources</td><td>higher, needs evals and review</td></tr>
    <tr><td>agent</td><td>steps are not known in advance</td><td>highest, needs guardrails and budgets</td></tr>
    <tr><td>human</td><td>judgement, accountability, regulation</td><td>slow, expensive, essential</td></tr></tbody></table></div>` },
  code: {
    title: 'A typed task graph with risk-first slicing', file: 'decompose.py', browser: true,
    intro: '<p>Represents the RFP workflow as typed steps with mechanisms, costs, accuracy requirements and risks; validates that every input is produced upstream, finds the order and the critical path, estimates per-question cost by mechanism, and picks the first vertical slice by risk.</p>',
    src: String.raw`from dataclasses import dataclass
from graphlib import TopologicalSorter
from typing import Literal

@dataclass
class Step:
    name: str
    inputs: list[str]
    output: str
    mechanism: Literal["code", "query", "retrieval", "extract", "classify", "generate", "agent", "human"]
    est_days: float
    risk: int                          # 1 low .. 5 high
    note: str = ""

UNIT_COST = {"code": 0.0, "query": 0.0, "retrieval": 0.0005, "extract": 0.004, "classify": 0.001, "generate": 0.02, "agent": 0.15, "human": 4.0}
steps = [
    Step("ingest", ["rfp_file"], "rfp_text", "code", 2, 2, "PDF and DOCX; some scanned"),
    Step("split", ["rfp_text"], "questions", "extract", 3, 4, "question boundaries vary wildly between RFPs"),
    Step("route", ["questions"], "routed", "classify", 2, 2),
    Step("reuse", ["routed", "answer_library"], "candidates", "retrieval", 3, 3, "is the library clean enough?"),
    Step("draft", ["candidates", "product_docs"], "drafts", "generate", 4, 3),
    Step("review", ["drafts"], "approved", "human", 2, 2, "SMEs: 2 hours a week each"),
    Step("assemble", ["approved", "template"], "response_doc", "code", 2, 1),
]
external = {"rfp_file", "answer_library", "product_docs", "template"}
produced = {s.output: s for s in steps}
missing = [(s.name, i) for s in steps for i in s.inputs if i not in produced and i not in external]
print("contract check:", "ok" if not missing else missing)

deps = {s.name: {produced[i].name for i in s.inputs if i in produced} for s in steps}
order = list(TopologicalSorter(deps).static_order())
finish = {}
for n in order:
    s = next(x for x in steps if x.name == n)
    finish[n] = max([finish[d] for d in deps[n]], default=0) + s.est_days
path, n = [], order[-1]
while n:
    path.append(n)
    n = max(deps[n], key=lambda d: finish[d]) if deps[n] else None
print("order:", " -> ".join(order))
print("critical path:", " -> ".join(reversed(path)), f"({finish[order[-1]]:.0f} working days; every step waits on the previous one)")

reuse_rate = 0.6            # share of questions answered from the approved library
per_q = sum(UNIT_COST[s.mechanism] for s in steps if s.name not in ("draft", "review")) + (1 - reuse_rate) * UNIT_COST["generate"] + 0.25 * UNIT_COST["human"]
print(f"est. cost per question: ${'$'}{per_q:.2f} (25% of answers need 15 min SME edits); 200-question RFP: ${'$'}{200 * per_q:,.0f}")

riskiest = max(steps, key=lambda s: s.risk)
print(f"\nfirst vertical slice: real RFPs -> ingest -> {riskiest.name} (risk {riskiest.risk}: {riskiest.note}) -> stubbed rest -> sample output")
for s in sorted(steps, key=lambda s: -s.risk):
    print(f"  risk {s.risk}  {s.name:<9} {s.mechanism:<9} {s.note}")`
  },
  lab: {
    title: 'Decompose “AI for insurance claims”', file: 'claims_decompose_lab.py', browser: true,
    scenario: `<p>A mid-sized insurer’s COO says: “We want AI to handle motor claims end to end.” After discovery you know: 9,000 claims a month; a claim has a form, photos, a police report for some, and repair estimates; adjusters check coverage, liability, fraud signals and approve payment; regulation requires a human decision on denials. Decompose into typed steps, assign mechanisms with a reason for each, flag which steps must stay human, estimate the share of claims that could be fast-tracked, and choose the first slice.</p>`,
    steps: ['Define at least eight steps with inputs, output and mechanism (use the Step dataclass).', 'Add a <code class="i">why</code> for each mechanism choice; mark regulatory human steps.', 'Validate the graph (every input produced or external; no cycles).', 'Estimate fast-track share: claims under a payout threshold with no fraud flags and clear coverage (use the given distributions).', 'Print the decomposition table and the first slice with its success metric.'],
    checks: ['Coverage checking uses a query or rules against the policy system, not generation.', 'Denials route to a human.', 'The first slice has a measurable success metric.'],
    hints: ['Damage estimation from photos is a vision model step with high risk; it may not be the first slice.', 'Document extraction (forms, estimates) is usually the safest high-value start.'],
    starter: String.raw`import random
from dataclasses import dataclass, field
from graphlib import TopologicalSorter
random.seed(2)
@dataclass
class Step:
    name: str; inputs: list; output: str; mechanism: str; why: str; human_required: bool = False; risk: int = 2
claims = [{"payout": random.lognormvariate(7.6, 0.7), "fraud_flag": random.random() < 0.07, "coverage_clear": random.random() < 0.82} for _ in range(9000)]
# TODO: steps, validation, fast-track estimate, first slice`,
    solution: String.raw`import random
from dataclasses import dataclass, field
from graphlib import TopologicalSorter
random.seed(2)
@dataclass
class Step:
    name: str; inputs: list; output: str; mechanism: str; why: str; human_required: bool = False; risk: int = 2
claims = [{"payout": random.lognormvariate(7.6, 0.7), "fraud_flag": random.random() < 0.07, "coverage_clear": random.random() < 0.82} for _ in range(9000)]

steps = [
    Step("intake", ["claim_form", "attachments"], "claim_record", "code", "structured portal fields; deterministic"),
    Step("extract", ["claim_record"], "claim_facts", "extract", "police reports and estimates are varied documents; schema-bound extraction with confidence", risk=3),
    Step("coverage", ["claim_facts", "policy_db"], "coverage_result", "query", "policy terms live in the policy system; rules are explicit"),
    Step("damage", ["attachments"], "damage_estimate", "extract", "vision model suggests severity; checked against repair estimate", risk=5),
    Step("fraud", ["claim_facts", "history_db"], "fraud_score", "classify", "existing fraud model plus rules; explainable features", risk=3),
    Step("triage", ["coverage_result", "fraud_score", "damage_estimate"], "route", "code", "thresholds set by claims policy, auditable"),
    Step("summary", ["claim_facts", "coverage_result", "fraud_score"], "adjuster_brief", "generate", "cited summary saves adjuster reading time", risk=2),
    Step("decision", ["route", "adjuster_brief"], "decision", "human", "regulation: denials and large payouts need an accountable person", human_required=True),
    Step("payment", ["decision"], "payment", "query", "payment system API; deterministic"),
    Step("letter", ["decision", "claim_facts"], "customer_letter", "generate", "template + generated explanation, reviewed for denials", risk=2),
]
external = {"claim_form", "attachments", "policy_db", "history_db"}
produced = {s.output: s.name for s in steps}
bad = [(s.name, i) for s in steps for i in s.inputs if i not in produced and i not in external]
deps = {s.name: {produced[i] for i in s.inputs if i in produced} for s in steps}
order = list(TopologicalSorter(deps).static_order())
print("graph valid:", not bad, "| order:", " -> ".join(order))
for s in steps:
    print(f"  {s.name:<9} {s.mechanism:<9} risk {s.risk} {'HUMAN ' if s.human_required else ''}{s.why}")

fast = [c for c in claims if c["payout"] < 3000 and not c["fraud_flag"] and c["coverage_clear"]]
print(f"\nfast-track eligible (payout < $3,000, no fraud flag, clear coverage): {len(fast)/len(claims):.0%} of claims, "
      f"{sum(c['payout'] for c in fast)/sum(c['payout'] for c in claims):.0%} of payout value")
print("""first slice: intake -> extract -> coverage -> summary for adjusters (no automated decisions).
success metric: adjuster handling time per claim down 30% with extraction field accuracy >= 95% on 300 labelled claims;
then pilot fast-track approvals (human spot checks on 10%) for eligible claims. Damage-from-photos stays advisory until evaluated.""")`
  },
  design: {
    lead: '<p>Decomposition is architecture at the business level. Good decompositions use AI where it adds unique value, keep everything else simple and deterministic, and make each step independently testable and replaceable.</p>',
    scale: [{ h: 'Per-step evals', p: 'Each step with a model gets its own eval set and metric (extraction F1, routing accuracy, groundedness); end-to-end metrics alone hide where failures start.' }, { h: 'Replaceable components', p: 'Typed contracts let you swap a model, a retriever or a human step later without redesigning the system.' }],
    fail: [{ h: 'One giant prompt', p: 'Putting the whole workflow in a single agent prompt makes failures untraceable and accuracy unmeasurable.' }, { h: 'Automating accountability', p: 'Removing humans from decisions that regulation or trust require creates legal and reputational risk.' }],
    trade: [{ h: 'Agent vs pipeline', p: 'Pipelines are predictable and testable; agents handle variable paths. Use a pipeline where the path is known and an agent inside a step only where needed.' }, { h: 'Granularity', p: 'Too many steps adds integration overhead; too few hides failure modes. Split where the mechanism or owner changes.' }],
    prompt: '<p>In an interview: “Design an AI system to help a hospital’s billing team handle insurance denials.” Decompose it.</p>',
    answer: '<ul><li>Clarify: volumes, denial reasons, systems (EHR, billing), regulations (HIPAA), success metric (recovered revenue, days to resubmit).</li><li>Steps: ingest denial (code) → extract reason codes (extract) → look up claim and records (query) → retrieve payer policy (retrieval) → classify fixable vs not (classify) → draft appeal with citations (generate) → billing specialist review (human) → submit (API).</li><li>Riskiest step first: payer policy retrieval accuracy on real denials; evals per step; PHI controls throughout.</li></ul>'
  },
  quiz: [
    { q: 'Coverage checking against policy terms in a database should usually be:', o: ['Free generation', 'A query or rules against the policy system', 'An agent', 'Skipped'], a: 1, why: 'Deterministic answers belong in deterministic mechanisms.' },
    { q: 'The first vertical slice should:', o: ['Be the easiest step', 'Touch the riskiest assumption with real data end to end', 'Be the UI', 'Wait for all steps'], a: 1, why: 'Kill or confirm the biggest risk early.' },
    { q: 'Why type each step’s inputs and outputs?', o: ['For style', 'Steps become testable, replaceable and independently evaluable', 'Models require it', 'To slow down'], a: 1, why: 'Contracts enable modular systems.' }
  ],
  interview: [
    { q: 'How do you approach an ambiguous problem like “automate our RFPs”?', a: '<p>Clarify goals, volumes and constraints; map the current workflow; decompose into typed steps; assign the simplest reliable mechanism to each, reserving generation and agents for where they add unique value; keep humans for accountability; identify the riskiest step and propose a thin end-to-end slice with a success metric to test it first.</p>' },
    { q: 'When would you not use an LLM for a step?', a: '<p>When the answer is deterministic or already in a system (rules, queries, APIs), when exactness is mandatory and verifiable another way, when latency or cost budgets are tight and a smaller model or code suffices, or when regulation requires a human decision.</p>' }
  ]
});

/* ===================================================================== 11.3 */
L({
  id: '11.3', title: 'Scoping and sequencing', minutes: 45, roles: ['fde'], sim: 'schedule',
  tags: 'MVP and pilots · value vs effort vs risk · milestones with exit criteria · Monte Carlo estimates · cutting scope · dependencies on the customer',
  mental: 'Scope is a promise. Promise a small, valuable, measurable first outcome with explicit exit criteria; sequence work so risks are retired early; estimate with ranges, not single dates; and protect the deadline by cutting scope, not quality.',
  intro: `<p>Most FDE engagements run against a fixed window: a 6–12 week pilot, a renewal date, a board meeting. The difference between a successful pilot and a failed one is often scoping: what was promised, in what order, and how uncertainty was handled. Customer dependencies (data access, security reviews, SME time) are frequently the critical path.</p>`,
  points: [
    'Define the pilot: one use case, one user group, one success metric with baseline and target, an end date.',
    'Sequence milestones with exit criteria, not activities: “extraction F1 ≥ 0.95 on 300 real docs” beats “build extraction”.',
    'Score candidate work by value, effort and risk; do high-risk, high-value items first.',
    'Estimate with three points (optimistic, likely, pessimistic) and Monte Carlo the plan for P50 and P85 dates.',
    'List customer dependencies with owners and dates; they cause more delays than code.',
    'When late, cut scope (fewer document types, fewer integrations), never evals or security.'
  ],
  concept: { title: 'A weather forecast, not a timetable', body: `<p>A train timetable promises 9:14 exactly. A weather forecast says 70% chance of rain. Software estimates are forecasts: say “80% likely by 14 November”, update the forecast as you learn, and decide early what you will drop if clouds gather.</p>` },
  walk: [
    { h: 'Scope statement', body: '<p>In / out / later, written down and signed.</p>', code: String.raw`PILOT: Claims document extraction for the motor claims team (12 adjusters), 6 weeks.
IN:    claim forms, repair estimates (PDF, scanned); 14 fields; adjuster review UI; eval report.
OUT:   photos, fraud scoring, automated decisions, other claim types.
LATER: fast-track approvals (if pilot meets targets).
SUCCESS: field accuracy >= 95% on 300 labelled claims; handling time -30% on pilot claims.
CUSTOMER DEPENDENCIES: data access (IT, week 1), 300 labelled claims (claims ops, week 2), SSO app (IT, week 3).` },
    { h: 'Monte Carlo the plan', body: '<p>Sample each task’s duration from its three-point estimate, add dependencies, repeat 10,000 times, and read off percentiles. The simulator above and the Code tab show why the sum of “likely” estimates is almost always optimistic.</p>' },
    { h: 'Cut lines', body: '<p>Decide in advance what goes if time runs short: a second document type, an integration, a nice-to-have UI. Share these “cut lines” with the sponsor at the start so cutting later is a plan, not a failure.</p>' }
  ],
  analogy: `<p><b>Planning a road trip with a fixed arrival time.</b> You know the must-see stops and the optional ones, you estimate drive times with traffic ranges, and you know the visa office opens on Tuesday only (a dependency you do not control). If traffic is bad you skip a museum, not the visa office.</p>`,
  diagram: {
    title: 'A six-week pilot plan',
    cols: [['w1'], ['w2'], ['w3'], ['w4'], ['w5'], ['w6']],
    nodes: [
      { id: 'w1', label: 'Week 1', sub: 'access · data · baseline', tone: 'fde', info: 'Exit: data in hand, baseline measured.' },
      { id: 'w2', label: 'Week 2', sub: 'riskiest slice', tone: 'warn', info: 'Exit: extraction on 50 real docs, first accuracy number.' },
      { id: 'w3', label: 'Week 3', sub: 'eval set · iterate', tone: 'acc', info: 'Exit: 300 labelled claims; F1 trend.' },
      { id: 'w4', label: 'Week 4', sub: 'UI · SSO · integration', tone: 'be', info: 'Exit: adjusters can use it on real claims.' },
      { id: 'w5', label: 'Week 5', sub: 'live pilot', tone: 'be', info: 'Exit: handling time measured on pilot claims.' },
      { id: 'w6', label: 'Week 6', sub: 'results · decision', tone: 'ok', info: 'Exit: go/no-go with evidence.' }
    ],
    edges: [{ a: 'w1', b: 'w2' }, { a: 'w2', b: 'w3' }, { a: 'w3', b: 'w4' }, { a: 'w4', b: 'w5' }, { a: 'w5', b: 'w6' }],
    caption: 'Milestones are exit criteria; the riskiest work lands in week 2.'
  },
  illustrated: { title: 'Value, effort, risk', body: `<div class="tbl"><table><thead><tr><th>item</th><th>value</th><th>effort (days)</th><th>risk</th><th>decision</th></tr></thead><tbody>
    <tr><td>extraction from estimates</td><td>high</td><td class="n">6</td><td>high</td><td>first (retire risk)</td></tr>
    <tr><td>adjuster review UI</td><td>high</td><td class="n">4</td><td>low</td><td>in pilot</td></tr>
    <tr><td>policy-system lookup</td><td>medium</td><td class="n">5</td><td>medium (IT access)</td><td>in pilot if access by week 2</td></tr>
    <tr><td>damage from photos</td><td>medium</td><td class="n">10</td><td>very high</td><td>later</td></tr>
    <tr><td>custom dashboards</td><td>low</td><td class="n">3</td><td>low</td><td>cut line #1</td></tr></tbody></table></div>` },
  code: {
    title: 'Monte Carlo schedule with dependencies and cut lines', file: 'schedule.py', browser: true,
    intro: '<p>Three-point estimates for each task, dependencies including customer-owned ones (with their own delay risk), 10,000 simulated projects with NumPy, and the probability of meeting the deadline with and without cutting optional scope. Compares with the naive sum of “likely” estimates.</p>',
    src: String.raw`import numpy as np
rng = np.random.default_rng(7)
N = 10_000
# name: (optimistic, likely, pessimistic working days, depends_on, optional)
TASKS = {
    "access":      (2, 4, 12, [], False),          # customer IT; long tail
    "baseline":    (1, 2, 4, ["access"], False),
    "extract_v1":  (3, 5, 10, ["access"], False),
    "labels":      (3, 5, 12, ["access"], False),   # customer SMEs label 300 claims
    "evals":       (2, 3, 6, ["extract_v1", "labels"], False),
    "sso":         (1, 3, 10, ["access"], False),    # customer IT again
    "review_ui":   (3, 4, 7, ["extract_v1"], False),
    "policy_api":  (6, 10, 20, ["access"], True),     # optional; if in scope, the pilot needs it
    "dashboards":  (2, 3, 5, ["review_ui"], True),
    "pilot":       (5, 5, 6, ["evals", "sso", "review_ui", "policy_api"], False),
    "report":      (1, 2, 3, ["pilot"], False),
}
DEADLINE = 27            # working days until the steering committee

def triangular(o, m, p):
    return rng.triangular(o, m, p, N)

def simulate(include_optional=True):
    finish = {}
    for name, (o, m, p, deps, opt) in TASKS.items():           # insertion order is topological here
        if opt and not include_optional:
            finish[name] = np.zeros(N)                             # cut: nothing waits for it
            continue
        start = np.max([finish[d] for d in deps], axis=0) if deps else np.zeros(N)
        finish[name] = start + triangular(o, m, p)
    return np.max(np.stack(list(finish.values())), axis=0)

print(f"critical path using only 'likely' values: {4 + 10 + 5 + 2} days (access, policy_api, pilot, report); the simulation disagrees:")
for label, inc in (("full scope", True), ("after cut lines (no policy_api, dashboards)", False)):
    end = simulate(inc)
    p50, p85 = np.percentile(end, [50, 85])
    print(f"{label:<44} P50 {p50:4.1f} d  P85 {p85:4.1f} d  P(<= {DEADLINE} d) = {np.mean(end <= DEADLINE):.0%}")
# which task most often sits on the critical path?
access = triangular(*TASKS["access"][:3])
print(f"customer access alone exceeds 8 days in {np.mean(access > 8):.0%} of runs: chase it in week 1, it gates everything")`
  },
  lab: {
    title: 'Make a six-week promise you can keep', file: 'scope_lab.py', browser: true,
    scenario: `<p>A sponsor wants a pilot of a contract-review assistant in six weeks (30 working days). Candidate items come with value (1–5), three-point estimates and risk. Two engineers work in parallel. Choose the scope so that P(finish ≤ 30 days) ≥ 80%, maximising value, with must-haves always in. Print the chosen scope, the cut list, P50/P85 and the sponsor message.</p>`,
    steps: ['Simulate with two parallel workers: a simple scheduler assigns ready tasks to the next free worker.', 'Enumerate subsets of optional items (there are few), simulate each, keep those meeting the 80% target.', 'Choose the subset with the highest total value; break ties by lower P85.', 'Print scope, cuts, percentiles, and a three-sentence message to the sponsor.'],
    checks: ['Must-haves are always included.', 'The chosen plan meets P ≥ 80%.', 'The sponsor message states the confidence level and what was deferred.'],
    hints: ['Sample all durations once per simulation run, then schedule.', '2,000 runs per subset is enough for a decision at this precision.'],
    starter: String.raw`import itertools, random
random.seed(1)
ITEMS = {  # name: (value, o, m, p, deps, must)
  "data_access": (0, 2, 4, 10, [], True), "clause_extract": (5, 5, 8, 14, ["data_access"], True),
  "eval_set": (4, 3, 5, 9, ["data_access"], True), "review_ui": (4, 4, 6, 9, ["clause_extract"], True),
  "risk_scoring": (3, 4, 6, 12, ["clause_extract"], False), "redline_suggestions": (4, 6, 9, 16, ["clause_extract"], False),
  "sharepoint_sync": (2, 3, 5, 10, ["data_access"], False), "analytics": (1, 2, 3, 5, ["review_ui"], False),
  "pilot_and_report": (0, 6, 6, 7, ["review_ui", "eval_set"], True)}
# TODO: simulate(selection) -> finish times; choose scope`,
    solution: String.raw`import itertools, random
random.seed(1)
ITEMS = {  # name: (value, o, m, p, deps, must)
  "data_access": (0, 2, 4, 10, [], True), "clause_extract": (5, 5, 8, 14, ["data_access"], True),
  "eval_set": (4, 3, 5, 9, ["data_access"], True), "review_ui": (4, 4, 6, 9, ["clause_extract"], True),
  "risk_scoring": (3, 4, 6, 12, ["clause_extract"], False), "redline_suggestions": (4, 6, 9, 16, ["clause_extract"], False),
  "sharepoint_sync": (2, 3, 5, 10, ["data_access"], False), "analytics": (1, 2, 3, 5, ["review_ui"], False),
  "pilot_and_report": (0, 6, 6, 7, ["review_ui", "eval_set"], True)}
WORKERS, DEADLINE, RUNS = 2, 30, 2000

def one_run(selected):
    dur = {n: random.triangular(ITEMS[n][1], ITEMS[n][3], ITEMS[n][2]) for n in selected}
    done, free, pending = {}, [0.0] * WORKERS, list(selected)
    while pending:
        ready = [n for n in pending if all(d in done for d in ITEMS[n][4])]
        # pick the ready task whose dependencies finish earliest (prefer must-haves)
        n = min(ready, key=lambda x: (not ITEMS[x][5], max([done[d] for d in ITEMS[x][4]], default=0)))
        w = min(range(WORKERS), key=lambda i: free[i])
        start = max(free[w], max([done[d] for d in ITEMS[n][4]], default=0))
        done[n] = free[w] = start + dur[n]
        pending.remove(n)
    return max(done.values())

def evaluate(selected):
    ends = sorted(one_run(selected) for _ in range(RUNS))
    return sum(e <= DEADLINE for e in ends) / RUNS, ends[RUNS // 2], ends[int(RUNS * 0.85)]

must = [n for n, v in ITEMS.items() if v[5]]
optional = [n for n, v in ITEMS.items() if not v[5]]
results = []
for k in range(len(optional) + 1):
    for extra in itertools.combinations(optional, k):
        sel = must + list(extra)
        p, p50, p85 = evaluate(sel)
        results.append((sum(ITEMS[n][0] for n in sel), p, p50, p85, extra))
ok = [r for r in results if r[1] >= 0.8]
value, p, p50, p85, extra = max(ok, key=lambda r: (r[0], -r[3]))
full = next(r for r in results if len(r[4]) == len(optional))
print(f"everything: value {full[0]}, P(<=30d) {full[1]:.0%}, P85 {full[3]:.1f} d")
print(f"chosen:     value {value}, P(<=30d) {p:.0%}, P50 {p50:.1f} d, P85 {p85:.1f} d")
print("scope:", must + list(extra))
print("deferred:", [n for n in optional if n not in extra])
print(f"""
To the sponsor: We can commit to clause extraction, the review UI and a measured pilot with {', '.join(extra) or 'no optional items'} in six weeks,
with about {p:.0%} confidence; the full list has {'under 1%' if full[1] < 0.01 else f'{full[1]:.0%}'} confidence. {', '.join(n for n in optional if n not in extra)} move to phase 2
and come back in if data access lands in week 1 and extraction hits target by week 3.""")`
  },
  design: {
    lead: '<p>Scoping is risk management with the customer. Make the first promise small, valuable and measurable; make uncertainty visible with ranges; make customer dependencies explicit; and agree in advance what gets cut.</p>',
    scale: [{ h: 'Portfolio of engagements', p: 'Standard pilot templates (scope, milestones, exit criteria) and historical actuals improve estimates across a team.' }, { h: 'From pilot to production', p: 'Plan the path in the scope: what production needs (security review, SLOs, support) that the pilot skipped.' }],
    fail: [{ h: 'Single-date estimates', p: 'A single date is read as a promise and the plan has no slack for the long tails of access and data.' }, { h: 'Silent scope creep', p: 'Small additions without trade-offs sink pilots. Every addition names what it displaces.' }],
    trade: [{ h: 'Breadth vs depth', p: 'One use case done well with measured value beats three half-done; breadth comes in the expansion.' }, { h: 'Fixed scope vs fixed date', p: 'Pilots usually fix the date and flex scope; regulated deliverables may fix scope and flex the date.' }],
    prompt: '<p>The sponsor wants three use cases in an eight-week pilot. You estimate that only one fits with high confidence. What do you do?</p>',
    answer: '<ul><li>Show the forecast for one, two and three use cases (P50/P85) with the dependencies driving risk.</li><li>Propose one use case to production quality with a measured outcome, plus discovery on the other two in parallel.</li><li>Agree triggers to add the second (e.g. data access by week 2, target met by week 4).</li><li>Write it into the scope with cut lines and owners.</li></ul>'
  },
  quiz: [
    { q: 'Why is the sum of “likely” estimates usually optimistic?', o: ['Engineers are lazy', 'Task durations have long right tails and dependencies wait for the slowest', 'Tools are slow', 'It is not'], a: 1, why: 'Skew and max-of-dependencies push the total later.' },
    { q: 'A good milestone is:', o: ['Build extraction', 'Extraction F1 ≥ 0.95 on 300 real documents', 'Week 3', 'Meet the customer'], a: 1, why: 'Exit criteria are verifiable.' },
    { q: 'When a pilot is running late, cut:', o: ['Evals', 'Security review', 'Optional scope agreed as cut lines', 'Testing'], a: 2, why: 'Protect quality; flex scope.' }
  ],
  interview: [
    { q: 'How do you scope a pilot with an enterprise customer?', a: '<p>One use case, one user group, a success metric with baseline and target, and an end date. Milestones with exit criteria, riskiest work first, customer dependencies with owners and dates, three-point estimates and a P50/P85 forecast, cut lines agreed upfront, and the path to production sketched.</p>' },
    { q: 'How do you handle a sponsor who keeps adding requirements?', a: '<p>Welcome the input, log it, and show the trade-off against the agreed scope and forecast: what it displaces or how it moves the date and confidence. Let the sponsor choose explicitly. Most additions land in a phase 2 list with clear triggers.</p>' }
  ]
});

/* ===================================================================== 11.4 */
L({
  id: '11.4', title: 'Enterprise reality: SSO, ETL, compliance', minutes: 55, roles: ['fde', 'be'],
  tags: 'OIDC and SAML SSO · JWKS validation · group-to-role mapping · SCIM provisioning · data access patterns · security reviews · DPAs · SOC 2 and ISO 27001 · residency',
  mental: 'In enterprises, a working demo is about a third of the work. The rest is fitting into identity (SSO, groups, provisioning), data access (approved pipelines, least privilege), and compliance (security questionnaires, data processing terms, audit). Plan for them from day one; they are often the critical path.',
  intro: `<p>Before any user touches the pilot, IT will ask: how do users sign in (SSO through Entra ID, Okta or Ping)? How are accounts created and removed (SCIM)? How does data move and who can see what? Where is data processed and stored, and for how long? Is there a SOC 2 report or ISO 27001 certificate, a data processing agreement, a penetration test? An FDE who can answer these precisely, and build the integrations, unblocks deals.</p>`,
  points: [
    'SSO: OpenID Connect (modern, JSON tokens) or SAML 2.0 (older, XML assertions). The app trusts the identity provider and validates signed tokens.',
    'Validate ID tokens properly: signature against the IdP’s JWKS, issuer, audience, expiry, nonce; then map groups claims to app roles.',
    'SCIM provisions and deprovisions users and groups automatically; leavers must lose access everywhere, including caches and indexes.',
    'Data access: use approved routes (data warehouse views, APIs, ETL into the customer’s environment) with service identities and least privilege.',
    'Permissions must flow into retrieval: documents carry ACLs and queries filter by the user’s groups (4.x, 8.x).',
    'Compliance artefacts: security questionnaire answers, architecture and data-flow diagrams, DPA, subprocessor list, retention and residency statements.'
  ],
  concept: { title: 'A visitor badge at a secure office', body: `<p>You do not get your own key to the building. Reception (the identity provider) checks who you are and prints a badge with your name, department and expiry (a signed token). Each door (your app) checks the badge is genuine, current and meant for it, and opens only the rooms your department may enter. When you leave the company, the badge stops working everywhere the same day.</p>` },
  walk: [
    { h: 'OIDC sign-in in one paragraph', body: '<p>The app redirects the user to the IdP with its client id, redirect URI, scopes and a nonce, using the authorization code flow with PKCE. After login the IdP redirects back with a code; the backend exchanges it for an ID token (who the user is) and access token. The backend validates the ID token and creates a session. Libraries (Authlib, MSAL, the IdP’s SDKs) handle the flow; you must still get the validation and claim mapping right.</p>' },
    { h: 'Validate and map', body: '<p>The Code tab runs this with a locally generated key pair standing in for the IdP.</p>', code: String.raw`key = jwks_client.get_signing_key_from_jwt(id_token)          # by kid, from the IdP's JWKS
claims = jwt.decode(id_token, key.key, algorithms=["RS256"],
                    audience=CLIENT_ID, issuer=ISSUER, options={"require": ["exp", "iat", "sub"]})
roles = {GROUP_TO_ROLE[g] for g in claims.get("groups", []) if g in GROUP_TO_ROLE}` },
    { h: 'The security review', body: '<p>Prepare a pack before you are asked: architecture and data-flow diagram, what data goes to which model provider and region, retention and deletion, encryption, access control, logging, incident response, subprocessors, certifications, and the provider’s data-use terms (for example, API data not used for training by default). Answer the questionnaire precisely; vague answers cost weeks.</p>' }
  ],
  analogy: `<p><b>Moving into an office building with rules.</b> Your furniture (the demo) is ready, but you still need badges for staff, approval for the cables you run through shared ducts, a fire-safety inspection and a lease that says what you may store. Teams that start the paperwork on day one move in on time.</p>`,
  diagram: {
    title: 'Identity, data and compliance around an AI app',
    cols: [['user'], ['idp'], ['app'], ['ret', 'llm'], ['dw', 'audit']],
    nodes: [
      { id: 'user', label: 'Employee', sub: 'browser', tone: 'fde', info: 'Signs in with corporate SSO.' },
      { id: 'idp', label: 'Identity provider', sub: 'Entra ID · Okta · SCIM', tone: 'acc', info: 'Issues signed tokens; provisions users and groups.' },
      { id: 'app', label: 'AI app backend', sub: 'validates tokens · roles', tone: 'be', info: 'JWKS validation; groups mapped to roles and ACLs.' },
      { id: 'ret', label: 'Retrieval', sub: 'ACL-filtered', tone: 'be', info: 'Only documents the user may see.' },
      { id: 'llm', label: 'Model endpoint', sub: 'approved region', tone: 'warn', info: 'Per DPA and residency.' },
      { id: 'dw', label: 'Customer data', sub: 'warehouse · APIs · ETL', tone: 'ok', info: 'Approved routes, service identity, least privilege.' },
      { id: 'audit', label: 'Audit log', sub: 'who saw what', tone: 'bad', info: 'Required for compliance and incident response.' }
    ],
    edges: [{ a: 'user', b: 'idp', label: 'login' }, { a: 'idp', b: 'app', label: 'ID token' }, { a: 'app', b: 'ret' }, { a: 'app', b: 'llm' }, { a: 'ret', b: 'dw' }, { a: 'app', b: 'audit', bend: 50 }],
    caption: 'Identity decides who; ACLs decide what; audit records both.'
  },
  illustrated: { title: 'A security questionnaire, answered precisely', body: `<div class="tbl"><table><thead><tr><th>question</th><th>weak answer</th><th>strong answer</th></tr></thead><tbody>
    <tr><td>Where is data processed?</td><td>“In the cloud”</td><td>Your Azure tenant, West Europe; model calls via Microsoft Foundry in the same region over Private Link</td></tr>
    <tr><td>Is our data used for training?</td><td>“No”</td><td>Provider terms for API use exclude training by default; contract reference and retention period attached</td></tr>
    <tr><td>How is access controlled?</td><td>“Logins”</td><td>OIDC SSO with your IdP, groups mapped to roles, document ACLs enforced at retrieval, SCIM deprovisioning within 1 hour</td></tr>
    <tr><td>How long are prompts kept?</td><td>“Not long”</td><td>Traces 30 days with PII redaction; configurable; deletion on request within 7 days</td></tr></tbody></table></div>` },
  code: {
    title: 'Validate OIDC ID tokens against a JWKS and map groups to roles', file: 'oidc_validate.py', deps: 'uv add "pyjwt[crypto]"',
    intro: '<p>Generates an RSA key pair as a stand-in identity provider, publishes its JWKS, issues ID tokens with group claims, and validates them as a backend would: signature by key id, issuer, audience, expiry and required claims. Then maps groups to roles and document ACLs. Tampered, expired, wrong-audience and wrong-key tokens are rejected.</p>',
    src: String.raw`import json, time
import jwt
from jwt.algorithms import RSAAlgorithm
from cryptography.hazmat.primitives.asymmetric import rsa

ISSUER, CLIENT_ID = "https://login.example-idp.com/acme-tenant/v2.0", "ai-assistant-prod"
idp_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
rogue_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
jwk = json.loads(RSAAlgorithm.to_jwk(idp_key.public_key())); jwk.update(kid="2026-10", use="sig", alg="RS256")
JWKS = {"keys": [jwk]}                              # served by the IdP at its jwks_uri

def issue(key=idp_key, kid="2026-10", **over):
    now = int(time.time())
    claims = {"iss": ISSUER, "aud": CLIENT_ID, "sub": "u-4821", "email": "priya@acme.com", "iat": now, "exp": now + 3600,
              "groups": ["sg-claims-adjusters", "sg-emea"]} | over
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": kid})

def validate(token):
    header = jwt.get_unverified_header(token)
    if header.get("alg") != "RS256" or "kid" not in header:
        raise jwt.InvalidTokenError(f"unexpected header {header}")
    kid = header["kid"]
    jwk = next((k for k in JWKS["keys"] if k["kid"] == kid), None)
    if jwk is None:
        raise jwt.InvalidTokenError(f"unknown kid {kid} (refresh JWKS once, then reject)")
    return jwt.decode(token, RSAAlgorithm.from_jwk(json.dumps(jwk)), algorithms=["RS256"], audience=CLIENT_ID, issuer=ISSUER,
                      options={"require": ["exp", "iat", "sub", "aud", "iss"]}, leeway=60)

GROUP_TO_ROLE = {"sg-claims-adjusters": "adjuster", "sg-claims-managers": "manager", "sg-ai-admins": "admin"}
DOC_ACL = {"motor-claims-playbook": {"adjuster", "manager"}, "fraud-thresholds": {"manager"}, "emea-policy-terms": {"adjuster", "manager"}}

claims = validate(issue())
roles = {GROUP_TO_ROLE[g] for g in claims["groups"] if g in GROUP_TO_ROLE}
print(f"valid: sub={claims['sub']} email={claims['email']} roles={sorted(roles)}")
print("retrievable docs:", sorted(d for d, allowed in DOC_ACL.items() if roles & allowed))

good = issue()
h, p, s = good.split(".")
payload = json.loads(jwt.utils.base64url_decode(p)); payload["groups"].append("sg-claims-managers")
tampered = ".".join([h, jwt.utils.base64url_encode(json.dumps(payload).encode()).decode(), s])
cases = {"tampered groups": tampered, "expired": issue(exp=int(time.time()) - 600, iat=int(time.time()) - 4200),
         "wrong audience": issue(aud="some-other-app"), "signed by rogue key": issue(key=rogue_key),
         "unknown kid": issue(kid="old-2024"), "alg none": jwt.encode({"sub": "x", "aud": CLIENT_ID, "iss": ISSUER}, None, algorithm="none")}
for name, tok in cases.items():
    try:
        validate(tok); print(f"{name:<20} ACCEPTED (bug!)")
    except jwt.InvalidTokenError as e:
        print(f"{name:<20} rejected: {type(e).__name__}: {e}")`
  },
  lab: {
    title: 'SCIM-style deprovisioning across the AI stack', file: 'scim_lab.py', browser: true,
    scenario: `<p>An employee left on Friday. The IdP deactivated them and pushed a SCIM update, but your AI app keeps state in several places: a users table, active sessions, a per-user conversation memory, a semantic cache with user-scoped entries, and API tokens for an integration. Build a sync job that applies SCIM-like user and group changes, revokes everything for deactivated users, recomputes roles for changed groups, and writes an audit trail. Prove that a leaver can no longer retrieve anything.</p>`,
    steps: ['Tables: users, sessions, memories, cache_entries, api_tokens, audit.', 'Apply a batch of SCIM operations: deactivate a user, remove a user from a group, add a new user.', 'For deactivation: disable the user, delete sessions and tokens, purge memories and user-scoped cache entries; log each.', 'For group changes: recompute roles; invalidate sessions so new roles take effect.', 'Verify: an access check for the leaver fails; the moved user lost manager-only documents.'],
    checks: ['No session, token, memory or cache entry remains for the leaver.', 'Role changes take effect immediately (sessions invalidated).', 'Audit has one row per action with timestamp and actor.'],
    hints: ['Treat deprovisioning as idempotent: running the sync twice changes nothing more.', 'Caches are easy to forget; user-scoped semantic cache entries can leak answers (9.2).'],
    starter: String.raw`import sqlite3
db = sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, active INT, groups TEXT);
CREATE TABLE sessions (sid TEXT, user_id TEXT, roles TEXT);
CREATE TABLE memories (user_id TEXT, text TEXT);
CREATE TABLE cache_entries (key TEXT, user_id TEXT, answer TEXT);
CREATE TABLE api_tokens (token TEXT, user_id TEXT);
CREATE TABLE audit (ts INT, actor TEXT, action TEXT, target TEXT);
INSERT INTO users VALUES ('u1','ana@acme.com',1,'sg-claims-managers'),('u2','raj@acme.com',1,'sg-claims-adjusters,sg-claims-managers'),('u3','li@acme.com',1,'sg-claims-adjusters');
INSERT INTO sessions VALUES ('s1','u1','manager'),('s2','u2','adjuster,manager'),('s3','u3','adjuster');
INSERT INTO memories VALUES ('u1','prefers short summaries'),('u2','works EMEA claims');
INSERT INTO cache_entries VALUES ('k1','u1','fraud threshold is ...'),('k2',NULL,'office hours are ...');
INSERT INTO api_tokens VALUES ('t1','u1');
""")
GROUP_TO_ROLE = {"sg-claims-adjusters": "adjuster", "sg-claims-managers": "manager"}
DOC_ACL = {"playbook": {"adjuster", "manager"}, "fraud-thresholds": {"manager"}}
OPS = [{"op": "deactivate", "id": "u1"}, {"op": "remove_from_group", "id": "u2", "group": "sg-claims-managers"},
       {"op": "create", "id": "u4", "email": "sam@acme.com", "groups": ["sg-claims-adjusters"]}]
# TODO: apply(OPS), can_read(user_id, doc), verification`,
    solution: String.raw`import sqlite3
db = sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, active INT, groups TEXT);
CREATE TABLE sessions (sid TEXT, user_id TEXT, roles TEXT);
CREATE TABLE memories (user_id TEXT, text TEXT);
CREATE TABLE cache_entries (key TEXT, user_id TEXT, answer TEXT);
CREATE TABLE api_tokens (token TEXT, user_id TEXT);
CREATE TABLE audit (ts INT, actor TEXT, action TEXT, target TEXT);
INSERT INTO users VALUES ('u1','ana@acme.com',1,'sg-claims-managers'),('u2','raj@acme.com',1,'sg-claims-adjusters,sg-claims-managers'),('u3','li@acme.com',1,'sg-claims-adjusters');
INSERT INTO sessions VALUES ('s1','u1','manager'),('s2','u2','adjuster,manager'),('s3','u3','adjuster');
INSERT INTO memories VALUES ('u1','prefers short summaries'),('u2','works EMEA claims');
INSERT INTO cache_entries VALUES ('k1','u1','fraud threshold is ...'),('k2',NULL,'office hours are ...');
INSERT INTO api_tokens VALUES ('t1','u1');
""")
GROUP_TO_ROLE = {"sg-claims-adjusters": "adjuster", "sg-claims-managers": "manager"}
DOC_ACL = {"playbook": {"adjuster", "manager"}, "fraud-thresholds": {"manager"}}
OPS = [{"op": "deactivate", "id": "u1"}, {"op": "remove_from_group", "id": "u2", "group": "sg-claims-managers"},
       {"op": "create", "id": "u4", "email": "sam@acme.com", "groups": ["sg-claims-adjusters"]}]
clock = iter(range(1_000, 10_000))

def log(action, target):
    db.execute("INSERT INTO audit VALUES (?,?,?,?)", (next(clock), "scim-sync", action, target))

def purge(uid, table):
    n = db.execute(f"DELETE FROM {table} WHERE user_id=?", (uid,)).rowcount
    if n: log(f"purge {table} ({n})", uid)

def apply(ops):
    for op in ops:
        uid = op["id"]
        if op["op"] == "deactivate":
            if db.execute("UPDATE users SET active=0 WHERE id=? AND active=1", (uid,)).rowcount: log("deactivate", uid)
            for t in ("sessions", "api_tokens", "memories", "cache_entries"): purge(uid, t)
        elif op["op"] == "remove_from_group":
            groups = db.execute("SELECT groups FROM users WHERE id=?", (uid,)).fetchone()[0].split(",")
            if op["group"] in groups:
                db.execute("UPDATE users SET groups=? WHERE id=?", (",".join(g for g in groups if g != op["group"]), uid))
                log(f"remove group {op['group']}", uid)
                purge(uid, "sessions")                 # force re-login so new roles apply
        elif op["op"] == "create":
            if db.execute("INSERT OR IGNORE INTO users VALUES (?,?,1,?)", (uid, op["email"], ",".join(op["groups"]))).rowcount:
                log("create", uid)

def roles_of(uid):
    row = db.execute("SELECT active, groups FROM users WHERE id=?", (uid,)).fetchone()
    return set() if not row or not row[0] else {GROUP_TO_ROLE[g] for g in row[1].split(",") if g in GROUP_TO_ROLE}

def can_read(uid, doc):
    return bool(roles_of(uid) & DOC_ACL[doc])

print("before: u1 fraud-thresholds", can_read("u1", "fraud-thresholds"), "| u2 fraud-thresholds", can_read("u2", "fraud-thresholds"))
apply(OPS); apply(OPS)                                  # idempotent second run
print("after:  u1 fraud-thresholds", can_read("u1", "fraud-thresholds"), "| u1 playbook", can_read("u1", "playbook"),
      "| u2 fraud-thresholds", can_read("u2", "fraud-thresholds"), "| u2 playbook", can_read("u2", "playbook"), "| u4 playbook", can_read("u4", "playbook"))
for t in ("sessions", "api_tokens", "memories", "cache_entries"):
    print(f"  {t:<14} rows left for u1: {db.execute(f'SELECT COUNT(*) FROM {t} WHERE user_id=?', ('u1',)).fetchone()[0]}")
print("  shared cache entries kept:", db.execute("SELECT COUNT(*) FROM cache_entries WHERE user_id IS NULL").fetchone()[0])
print("audit:")
for row in db.execute("SELECT * FROM audit"): print("  ", row)`
  },
  design: {
    lead: '<p>Enterprise integration is product work, not paperwork. Build identity, permissions, data access and compliance evidence into the architecture so security reviews are fast and the system stays safe as people and data change.</p>',
    scale: [{ h: 'Multi-tenant identity', p: 'Each customer brings an IdP; support OIDC and SAML per tenant, map their groups to your roles in config (10.1), and support SCIM for lifecycle.' }, { h: 'Reusable compliance pack', p: 'Maintain a current security pack (architecture, data flows, subprocessors, certifications, standard questionnaire answers) so each review starts from 80%.' }],
    fail: [{ h: 'Token validation shortcuts', p: 'Skipping audience or issuer checks, accepting <code class="i">alg: none</code>, or trusting unverified claims gives attackers access. Use a maintained library and test negatives.' }, { h: 'Forgotten state on leavers', p: 'Sessions, tokens, memories and caches outlive accounts unless deprovisioning purges them.' }],
    trade: [{ h: 'Copy data vs query in place', p: 'Copying into your index is fast and flexible but expands the compliance surface; querying in place respects existing controls but adds latency and coupling.' }, { h: 'Group claims in tokens vs lookups', p: 'Tokens can carry groups (simple, may be truncated for users with many groups); lookups via Graph or SCIM data are complete but add calls.' }],
    prompt: '<p>A bank wants your AI assistant rolled out to 5,000 employees in six weeks. What identity and compliance work do you plan?</p>',
    answer: '<ul><li>Week 1: security pack sent; DPA and subprocessor review started; data-flow diagram agreed; region and provider confirmed.</li><li>OIDC SSO with their IdP, group-to-role mapping in config, SCIM provisioning and deprovisioning tested.</li><li>Document ACLs synced from source systems and enforced at retrieval; audit logging of queries and documents accessed.</li><li>Pen test or their red team on the pilot; retention and deletion procedures documented; go-live checklist signed by security.</li></ul>'
  },
  quiz: [
    { q: 'Which checks must ID-token validation include?', o: ['Only the signature', 'Signature via JWKS, issuer, audience, expiry and required claims', 'Only expiry', 'The email domain'], a: 1, why: 'All are needed to trust the token.' },
    { q: 'What is SCIM used for?', o: ['Encrypting data', 'Automated provisioning and deprovisioning of users and groups', 'Signing tokens', 'Vector search'], a: 1, why: 'It keeps app accounts in sync with the IdP.' },
    { q: 'A user leaves the company. Which AI-app state must be purged?', o: ['Only the users row', 'Sessions, tokens, personal memories and user-scoped cache entries too', 'Nothing', 'Only logs'], a: 1, why: 'Every place that grants access or holds their data.' }
  ],
  interview: [
    { q: 'How would you integrate an AI app with a customer’s SSO?', a: '<p>OIDC authorization code flow with PKCE against their IdP (or SAML if required), using a maintained library; validate ID tokens via the IdP’s JWKS with issuer, audience and expiry checks; map group claims to roles in configuration; enforce roles and document ACLs at retrieval; support SCIM for provisioning and deprovisioning; log access for audit.</p>' },
    { q: 'What do enterprise security reviews ask about AI systems?', a: '<p>Data flows and where data is processed and stored; whether data is used for training; retention and deletion; encryption and network isolation; access control and SSO; logging and audit; subprocessors and certifications; prompt injection and data leakage controls; incident response. Precise, documented answers shorten reviews dramatically.</p>' }
  ]
});
})();

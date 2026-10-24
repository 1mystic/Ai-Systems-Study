/* Phase 8 · Security and governance (8.7) */
(function () {
const L = AISA.lesson;

L({
  id: '8.7', title: 'EU AI Act and India DPDP', minutes: 55, roles: ['fde', 'be'],
  tags: 'risk tiers · provider vs deployer · transparency · high-risk obligations · Digital Omnibus dates · DPDP Act 2023 · DPDP Rules 2025 · consent · erasure · breach response',
  mental: 'Regulation turns into engineering requirements: know which rules apply to a system, which role your customer plays, and which obligations become logging, documentation, human oversight, consent records, retention timers and breach playbooks in the code you ship. You are not the lawyer, but you build what the lawyers ask for.',
  intro: `<p>Two regimes matter for many 2026 deployments. The <b>EU AI Act</b> regulates AI systems by risk level and applies to anyone placing AI systems on the EU market or whose outputs are used in the EU. India’s <b>Digital Personal Data Protection Act, 2023</b> and the <b>DPDP Rules, 2025</b> govern processing of digital personal data in India, which covers almost every assistant that touches customer data there.</p>
  <p>Dates have moved: the EU’s Digital Omnibus on AI, agreed in May 2026 and in force since late July 2026, postponed high-risk obligations; the DPDP Rules phase in between November 2025 and May 2027. Always confirm current dates with counsel. <i>This lesson is engineering guidance, not legal advice.</i></p>`,
  points: [
    '<b>EU AI Act tiers</b>: prohibited practices (in force since February 2025); high-risk systems (Annex III uses such as recruitment, credit scoring, education, essential services; Annex I safety components of regulated products); transparency obligations (Article 50); minimal risk.',
    '<b>Dates after the Digital Omnibus</b>: GPAI model obligations since 2 August 2025; Article 50 transparency from 2 August 2026; Annex III high-risk obligations from 2 December 2027; Annex I from 2 August 2028.',
    '<b>Roles</b>: providers (who build or brand the system) carry most high-risk duties (risk management, data governance, technical documentation, logging, human oversight, accuracy and robustness); deployers must use it as instructed, keep logs, ensure oversight and inform people.',
    '<b>Transparency</b>: people must be told they are interacting with an AI system unless obvious; synthetic content must be marked in machine-readable form.',
    '<b>DPDP</b>: lawful processing on consent (with a clear notice) or legitimate uses; purpose limitation; reasonable security safeguards; breach notification to the Data Protection Board and affected people; erasure when the purpose ends; verifiable parental consent for children; extra duties for Significant Data Fiduciaries; penalties up to ₹250 crore per breach type.',
    '<b>DPDP timeline</b>: Rules notified 13 November 2025; consent manager provisions from November 2026; most substantive obligations from 13 May 2027.'
  ],
  concept: { title: 'Compliance as architecture', body: `<p>Most obligations map to things you would build anyway, done deliberately: an inventory of AI systems and their purposes, logs that let you reconstruct decisions, human review points, documentation of data and evaluations, consent and purpose records, retention and erasure jobs, and an incident playbook. Teams that build these as features pass audits; teams that bolt them on at the end delay launches.</p>` },
  walk: [
    { h: 'Classify the system first', body: `<div class="tbl"><table><thead><tr><th>use case</th><th>EU AI Act view (typical)</th><th>key engineering consequences</th></tr></thead><tbody>
      <tr><td>customer support chatbot</td><td>transparency obligation (tell users it is AI)</td><td>disclosure in UI; logging per policy</td></tr>
      <tr><td>CV screening or ranking candidates</td><td>high-risk (Annex III, employment)</td><td>risk management, data governance, documentation, logs, human oversight, accuracy testing</td></tr>
      <tr><td>creditworthiness scoring of individuals</td><td>high-risk (Annex III)</td><td>as above, plus explanations and contestation paths in practice</td></tr>
      <tr><td>internal code assistant</td><td>minimal risk</td><td>good practice; company policies</td></tr>
      <tr><td>image generator for marketing</td><td>transparency (machine-readable marking of synthetic content)</td><td>watermark or metadata at generation time</td></tr></tbody></table></div>` },
    { h: 'Map DPDP duties to components', body: `<div class="tbl"><table><thead><tr><th>duty</th><th>component you build</th></tr></thead><tbody>
      <tr><td>notice and consent</td><td>consent ledger with purpose, version of notice, timestamp, withdrawal</td></tr>
      <tr><td>purpose limitation</td><td>purpose tags on data and checks at retrieval and in prompts</td></tr>
      <tr><td>security safeguards</td><td>encryption, access control, logging (lessons 8.4, 8.5)</td></tr>
      <tr><td>erasure</td><td>deletion jobs across stores: database, vector index, memory, caches, logs per policy</td></tr>
      <tr><td>breach notification</td><td>detection, an incident playbook and templates for the Board and affected people</td></tr>
      <tr><td>children’s data</td><td>age signals and verifiable parental consent flows</td></tr></tbody></table></div>` },
    { h: 'Keep evidence', body: '<p>Regulators and enterprise customers ask for evidence: system inventory, risk assessments, eval reports (Phase 7), red-team results (8.6), logs, consent records and deletion proofs. Generate them from the system, not by hand.</p>' }
  ],
  analogy: `<p><b>Building codes.</b> An architect does not argue the law; they design fire exits, wiring and load limits that satisfy it, and keep the drawings and inspection certificates. AI regulation works the same way: classify the building, design to the code, keep the paperwork, and get re-inspected when you renovate.</p>`,
  diagram: {
    title: 'From regulation to engineering controls',
    cols: [['inv'], ['cls'], ['eu', 'dpdp'], ['ctrl1', 'ctrl2', 'ctrl3'], ['evid']],
    nodes: [
      { id: 'inv', label: 'AI system inventory', sub: 'purpose · data · users', tone: 'fde', info: 'Every AI system, its purpose, data categories, users and markets.' },
      { id: 'cls', label: 'Classification', sub: 'risk tier · role', tone: 'acc', info: 'EU AI Act tier and provider/deployer role; DPDP fiduciary status.' },
      { id: 'eu', label: 'EU AI Act duties', sub: 'transparency · high-risk', info: 'Disclosure, logging, oversight, documentation, risk management.' },
      { id: 'dpdp', label: 'DPDP duties', sub: 'consent · erasure · breach', info: 'Notice and consent, purpose limits, safeguards, erasure, breach reporting.' },
      { id: 'ctrl1', label: 'Logs + oversight', sub: 'traces · review points', tone: 'be', info: 'Reconstruct decisions; humans can intervene.' },
      { id: 'ctrl2', label: 'Consent + purpose', sub: 'ledger · tags', tone: 'be', info: 'Processing tied to recorded consent and purpose.' },
      { id: 'ctrl3', label: 'Retention + erasure', sub: 'jobs across stores', tone: 'be', info: 'Including vector indexes, memory and caches.' },
      { id: 'evid', label: 'Evidence pack', sub: 'generated, versioned', tone: 'ok', info: 'Documentation, evals, red-team reports, deletion proofs.' }
    ],
    edges: [{ a: 'inv', b: 'cls' }, { a: 'cls', b: 'eu' }, { a: 'cls', b: 'dpdp' }, { a: 'eu', b: 'ctrl1' }, { a: 'dpdp', b: 'ctrl2' }, { a: 'dpdp', b: 'ctrl3' }, { a: 'ctrl1', b: 'evid' }, { a: 'ctrl2', b: 'evid' }, { a: 'ctrl3', b: 'evid' }],
    caption: 'Inventory and classify, map duties to controls, generate the evidence.'
  },
  illustrated: { title: 'Key dates at a glance (as of October 2026)', body: `<div class="tbl"><table><thead><tr><th>date</th><th>regime</th><th>what applies</th></tr></thead><tbody>
    <tr><td>2 Feb 2025</td><td>EU AI Act</td><td>prohibited practices; AI literacy</td></tr>
    <tr><td>2 Aug 2025</td><td>EU AI Act</td><td>general-purpose AI model obligations</td></tr>
    <tr><td>13 Nov 2025</td><td>DPDP Rules</td><td>notified; Board and definitions provisions in force</td></tr>
    <tr><td>2 Aug 2026</td><td>EU AI Act</td><td>Article 50 transparency (grace to 2 Dec 2026 for watermarking of systems already on the market)</td></tr>
    <tr><td>Nov 2026</td><td>DPDP Rules</td><td>consent manager registration and duties</td></tr>
    <tr><td>13 May 2027</td><td>DPDP Rules</td><td>notice, consent, fiduciary duties, rights, breach reporting, cross-border rules</td></tr>
    <tr><td>2 Dec 2027</td><td>EU AI Act (Omnibus)</td><td>Annex III high-risk obligations</td></tr>
    <tr><td>2 Aug 2028</td><td>EU AI Act (Omnibus)</td><td>Annex I high-risk obligations (regulated products)</td></tr></tbody></table></div>
    <p>Confirm with counsel before planning against these dates; further amendments are possible.</p>` },
  code: {
    title: 'An AI system inventory with an obligations gap report', file: 'compliance_gaps.py', browser: true,
    intro: '<p>A small compliance engine: each AI system is described as data (use case, markets, personal data, controls in place). Rules classify it under a simplified EU AI Act view and check DPDP-relevant controls when Indian personal data is processed, then report gaps with the date each obligation applies. It is a planning tool for engineers, deliberately simplified, not a legal determination.</p>',
    src: String.raw`from dataclasses import dataclass, field
from datetime import date

ANNEX_III = {"recruitment", "credit_scoring", "education_assessment", "essential_services_eligibility", "biometric_identification"}
TODAY = date(2026, 10, 24)

@dataclass
class AISystem:
    name: str
    use_case: str
    markets: set
    interacts_with_people: bool = True
    generates_media: bool = False
    indian_personal_data: bool = False
    children: bool = False
    controls: set = field(default_factory=set)

def obligations(s: AISystem) -> list[tuple[str, date, str]]:
    out = []
    if "EU" in s.markets:
        if s.use_case in ANNEX_III:
            for ctl in ["risk_management", "data_governance", "technical_documentation", "event_logging", "human_oversight", "accuracy_testing"]:
                out.append(("EU AI Act high-risk (Annex III)", date(2027, 12, 2), ctl))
        if s.interacts_with_people:
            out.append(("EU AI Act Art. 50", date(2026, 8, 2), "ai_disclosure"))
        if s.generates_media:
            out.append(("EU AI Act Art. 50", date(2026, 8, 2), "synthetic_content_marking"))
    if "IN" in s.markets and s.indian_personal_data:
        for ctl in ["privacy_notice", "consent_ledger", "purpose_tags", "security_safeguards", "erasure_jobs", "breach_playbook"]:
            out.append(("DPDP Act + Rules", date(2027, 5, 13), ctl))
        if s.children:
            out.append(("DPDP Act + Rules", date(2027, 5, 13), "verifiable_parental_consent"))
    return out

systems = [
    AISystem("support-assistant", "customer_support", {"EU", "IN"}, indian_personal_data=True,
             controls={"ai_disclosure", "privacy_notice", "security_safeguards", "event_logging"}),
    AISystem("cv-screener", "recruitment", {"EU"}, controls={"ai_disclosure", "event_logging", "accuracy_testing"}),
    AISystem("tutor-bot", "education_assessment", {"IN"}, indian_personal_data=True, children=True,
             controls={"privacy_notice", "consent_ledger", "security_safeguards"}),
    AISystem("banner-generator", "marketing_images", {"EU"}, interacts_with_people=False, generates_media=True),
]

for s in systems:
    obs = obligations(s)
    gaps = [(reg, d, c) for reg, d, c in obs if c not in s.controls]
    tier = ("EU: not in scope" if "EU" not in s.markets else "EU: high-risk" if s.use_case in ANNEX_III else "EU: transparency")
    print(f"{s.name} [{tier}] markets={sorted(s.markets)}: {len(obs) - len(gaps)}/{len(obs)} controls in place")
    for reg, d, c in sorted(gaps, key=lambda g: g[1]):
        status = "OVERDUE" if d <= TODAY else f"due in {(d - TODAY).days} days"
        print(f"   gap: {c:<28} {reg:<32} applies {d}  ({status})")`
  },
  lab: {
    title: 'A consent ledger with purpose checks and erasure', file: 'consent_lab.py', browser: true,
    scenario: `<p>For an Indian lending customer’s assistant, build the data-protection core: a consent ledger (who consented to which purpose under which notice version, and withdrawals), a purpose check that the assistant calls before using personal data, and an erasure job that removes a person’s data from every store (records, vector index, memory, cache) when consent is withdrawn or the purpose ends, producing an auditable deletion receipt.</p>`,
    steps: ['SQLite tables: consents(principal, purpose, notice_version, given_at, withdrawn_at), plus four stores holding personal data with a principal column.', '<code class="i">may_process(principal, purpose)</code>: true only with an active consent for that purpose.', '<code class="i">withdraw(principal, purpose)</code>: records withdrawal and triggers erasure of data held only for that purpose.', '<code class="i">erase(principal)</code>: deletes across all stores and returns a receipt with counts per store and a timestamp; the receipt itself contains no personal data beyond a hashed principal id.', 'Demonstrate: processing allowed, consent withdrawn, processing refused, erasure receipt, and a store check showing zero rows remain.'],
    checks: ['Processing is refused after withdrawal.', 'All four stores are empty for the principal after erasure.', 'The receipt has counts and a hashed id, not the raw identifier.'],
    hints: ['Keep a registry of stores so erasure cannot forget one.', 'Hash the principal id with a per-deployment salt for the receipt.'],
    starter: String.raw`import hashlib, json, sqlite3
db = sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE consents (principal TEXT, purpose TEXT, notice_version TEXT, given_at TEXT, withdrawn_at TEXT);
CREATE TABLE loan_records (principal TEXT, data TEXT);
CREATE TABLE vector_chunks (principal TEXT, chunk TEXT);
CREATE TABLE agent_memory (principal TEXT, memory TEXT);
CREATE TABLE response_cache (principal TEXT, response TEXT);
""")
# TODO: give consent, may_process, withdraw, erase, demo`,
    solution: String.raw`import hashlib, json, sqlite3
db = sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE consents (principal TEXT, purpose TEXT, notice_version TEXT, given_at TEXT, withdrawn_at TEXT);
CREATE TABLE loan_records (principal TEXT, data TEXT);
CREATE TABLE vector_chunks (principal TEXT, chunk TEXT);
CREATE TABLE agent_memory (principal TEXT, memory TEXT);
CREATE TABLE response_cache (principal TEXT, response TEXT);
""")
STORES = ["loan_records", "vector_chunks", "agent_memory", "response_cache"]     # registry: erasure covers every store
SALT = "deployment-salt-rotate-me"
NOW = iter(f"2027-06-0{d}T10:00:00" for d in range(1, 10))

def give_consent(p, purpose, notice="v3"):
    db.execute("INSERT INTO consents VALUES (?, ?, ?, ?, NULL)", (p, purpose, notice, next(NOW)))

def may_process(p, purpose):
    return db.execute("SELECT 1 FROM consents WHERE principal=? AND purpose=? AND withdrawn_at IS NULL", (p, purpose)).fetchone() is not None

def erase(p):
    counts = {}
    for s in STORES:
        counts[s] = db.execute(f"DELETE FROM {s} WHERE principal=?", (p,)).rowcount
    db.commit()
    return {"principal_hash": hashlib.sha256((SALT + p).encode()).hexdigest()[:16], "erased_at": next(NOW), "rows_deleted": counts}

def withdraw(p, purpose):
    db.execute("UPDATE consents SET withdrawn_at=? WHERE principal=? AND purpose=? AND withdrawn_at IS NULL", (next(NOW), p, purpose))
    if not db.execute("SELECT 1 FROM consents WHERE principal=? AND withdrawn_at IS NULL", (p,)).fetchone():
        return erase(p)                                   # no remaining purpose: erase everything held for them
    return None

p = "cust-9f21"
give_consent(p, "loan_servicing")
for s, val in [("loan_records", "loan 48,000 INR"), ("vector_chunks", "chunk: repayment schedule"), ("agent_memory", "prefers Hindi"), ("response_cache", "cached EMI answer")]:
    db.execute(f"INSERT INTO {s} VALUES (?, ?)", (p, val))
print("may process for loan_servicing:", may_process(p, "loan_servicing"))
print("may process for marketing     :", may_process(p, "marketing"))
receipt = withdraw(p, "loan_servicing")
print("after withdrawal, may process  :", may_process(p, "loan_servicing"))
print("erasure receipt:", json.dumps(receipt))
remaining = {s: db.execute(f"SELECT count(*) FROM {s} WHERE principal=?", (p,)).fetchone()[0] for s in STORES}
print("rows remaining per store:", remaining)
assert sum(remaining.values()) == 0 and p not in json.dumps(receipt)`
  },
  design: {
    lead: '<p>Regulatory readiness is a platform capability: an inventory of AI systems, per-system classification, shared controls (logging, oversight, consent, erasure, disclosure), and automatically generated evidence. Build it once and every new AI feature inherits it.</p>',
    scale: [{ h: 'Erasure across AI stores', p: 'Personal data hides in vector indexes, agent memory, caches, eval sets and traces. Tag data with principal and purpose at ingestion so deletion can find it everywhere.' }, { h: 'Logging that serves two masters', p: 'High-risk systems need logs to reconstruct decisions; privacy law wants minimisation. Log decisions and references, tokenize personal data (8.5), and set retention per purpose.' }],
    fail: [{ h: 'Classifying by product name', p: 'The same chatbot can be minimal risk for FAQs and high-risk when it starts ranking job applicants. Classify by use case and re-check when features change.' }, { h: 'Consent without enforcement', p: 'A consent banner whose records are never checked at processing time provides no protection. Check purpose and consent in the data path.' }],
    trade: [{ h: 'Build vs buy governance tooling', p: 'Governance platforms speed up inventories and documentation; the controls in the data path still have to be engineered.' }, { h: 'One global standard vs per-market variants', p: 'Building to the strictest common requirements simplifies operations; per-market variants reduce friction where rules are lighter.' }],
    prompt: '<p>A global HR-tech company wants an AI feature that ranks job applicants, sold in the EU and India. What engineering work do you plan?</p>',
    answer: '<ul><li>Classify: EU Annex III high-risk (employment) from 2 December 2027 under the Omnibus dates; DPDP applies to Indian applicants’ data.</li><li>Provider-side: risk management, data governance and bias evaluation by group, technical documentation, decision logging, human review of rankings, accuracy and robustness testing, user instructions.</li><li>Privacy: notice and consent or legitimate-use basis per market, purpose tags, retention and erasure across all stores, breach playbook.</li><li>Evidence generated from evals, red-team runs and logs; re-assessment on every model or feature change.</li></ul>'
  },
  quiz: [
    { q: 'After the Digital Omnibus on AI, when do Annex III high-risk obligations apply?', o: ['2 August 2026', '2 December 2027', '2 August 2025', 'They were repealed'], a: 1, why: 'The Omnibus fixed Annex III at 2 December 2027 and Annex I at 2 August 2028.' },
    { q: 'A customer-support chatbot in the EU most typically triggers:', o: ['High-risk obligations', 'Transparency obligations: tell people they are interacting with AI', 'Prohibition', 'Nothing at all'], a: 1, why: 'Article 50 transparency applies to systems interacting with people.' },
    { q: 'Under DPDP, when consent for the only purpose is withdrawn, the system should:', o: ['Keep data for analytics', 'Stop processing and erase data held for that purpose across stores, subject to legal retention', 'Delete only the main database rows', 'Ask the model'], a: 1, why: 'Erasure must cover every store, including indexes, memory and caches.' }
  ],
  interview: [
    { q: 'How do you prepare an AI product for the EU AI Act?', a: '<p>Inventory AI systems and classify each by use case, market and role; for transparency-tier systems, add AI disclosure and synthetic content marking; for high-risk ones, build risk management, data governance and bias testing, technical documentation, decision logging, human oversight and accuracy testing, and generate evidence from evals and logs. Track the current dates, which the 2026 Digital Omnibus moved.</p>' },
    { q: 'What does DPDP compliance mean for a RAG assistant in India?', a: '<p>A lawful basis with a clear notice, consent records tied to purposes and checked at processing time, minimisation of personal data in prompts and logs, security safeguards, erasure across databases, vector indexes, memory and caches when purposes end or consent is withdrawn, breach detection and notification to the Board and affected people, and special handling for children’s data.</p>' }
  ]
});
})();

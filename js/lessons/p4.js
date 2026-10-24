/* Phase 4 · Retrieval and RAG (part 1: 4.1–4.4). Shared Python snippets live on AISA.PY4 for p4b.js. */
(function () {
const L = AISA.lesson;

const CORPUS = String.raw`# ---- a small help-centre corpus used throughout Phase 4 ----
DOCS = [
    {"id": "refund-policy", "title": "Refund policy", "text": "Duplicate charges are refunded automatically within 5 business days. Other refunds need approval from billing support and are limited to the last 60 days."},
    {"id": "money-back", "title": "Getting your money back", "text": "If you paid for a plan you did not use, request your money back from the Billing page. Annual plans are reimbursed pro rata for the unused months."},
    {"id": "error-e4012", "title": "Error E4012", "text": "E4012 means the card issuer declined a retry of a failed payment. Ask the customer to update the card, then retry the invoice."},
    {"id": "error-e4013", "title": "Error E4013", "text": "E4013 means the card on file has expired. Ask the customer to add a new card before the next invoice is issued."},
    {"id": "invoices-csv", "title": "Export invoices", "text": "Admins can export all invoices as CSV from Billing, then Invoices, then Export. Exports include tax ids and line items."},
    {"id": "cancel-plan", "title": "Cancel a subscription", "text": "To cancel, open Billing and choose Cancel plan. Access continues until the end of the paid period. Cancelling does not delete data."},
    {"id": "sso-setup", "title": "Set up SAML SSO", "text": "Enterprise workspaces can sign in with SAML single sign-on through Okta, Entra ID or Google. Upload the identity provider metadata in Security settings."},
    {"id": "password-reset", "title": "Reset your password", "text": "Use Forgot password on the login page. The reset link expires after 30 minutes. SSO users reset their password with their identity provider."},
    {"id": "api-limits", "title": "API rate limits", "text": "The REST API allows 600 requests per minute per workspace. Requests over the limit get HTTP 429 with a Retry-After header."},
    {"id": "webhooks", "title": "Webhooks", "text": "Webhooks deliver invoice.paid and invoice.failed events. Each delivery is signed with HMAC SHA-256; verify the signature before trusting it."},
    {"id": "data-export", "title": "Export workspace data", "text": "Owners can export all workspace data as JSON. Large exports arrive as a download link that expires after 7 days."},
    {"id": "plans", "title": "Compare plans", "text": "Starter is free for 3 users. Pro costs 48 dollars per user per month and adds audit logs. Enterprise adds SAML SSO, SCIM and a 99.9% uptime SLA."},
    {"id": "chargebacks", "title": "Chargebacks and disputes", "text": "If a customer disputes a charge with their bank, the payment is frozen until the dispute is resolved. Do not issue a refund while a dispute is open."},
]
QUERIES = [   # (question, ids of the documents that answer it)
    ("I was charged twice, when do I get the money back?", {"refund-policy"}),
    ("what does error E4012 mean", {"error-e4012"}),
    ("reimbursement for an annual plan I never used", {"money-back"}),
    ("download all my bills as a spreadsheet", {"invoices-csv"}),
    ("can we log in through Okta", {"sso-setup"}),
    ("getting too many requests errors from the API", {"api-limits"}),
    ("customer opened a dispute with the bank, can we refund?", {"chargebacks"}),
    ("how to terminate my subscription", {"cancel-plan"}),
    ("payment failed with E4013", {"error-e4013"}),
]
`;

const EMB = String.raw`# ---- a toy embedding model (no download needed) ----
# Real embedding models learn that "money back" and "refund" mean the same thing from data.
# This stand-in gets that one property from a small synonym table, so the retrieval code around it is real.
import hashlib, re
import numpy as np

SYNONYMS = {
    "charged twice": "dup", "double charge": "dup", "duplicate": "dup",
    "money back": "refund", "refund": "refund", "refunded": "refund", "refunds": "refund", "reimburse": "refund", "reimbursed": "refund", "reimbursement": "refund",
    "invoice": "invoice", "invoices": "invoice", "bill": "invoice", "bills": "invoice",
    "spreadsheet": "csv", "csv": "csv", "download": "export", "export": "export", "exports": "export",
    "log in": "sso", "login": "sso", "sign in": "sso", "single sign-on": "sso", "sso": "sso", "saml": "sso", "okta": "sso",
    "cancel": "cancel", "cancelling": "cancel", "terminate": "cancel",
    "too many requests": "ratelimit", "rate limits": "ratelimit", "rate limit": "ratelimit", "429": "ratelimit",
    "dispute": "dispute", "disputes": "dispute", "chargebacks": "dispute", "chargeback": "dispute",
    "never used": "unused", "did not use": "unused", "unused": "unused",
}
STOP = set("a an the and or of to for in on with is are be can we i you my your our it its this that then from as at by do does what how when get getting all".split())

def tokens(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in STOP]

def concepts(text: str) -> list[str]:
    t, found = text.lower(), []
    for phrase in sorted(SYNONYMS, key=len, reverse=True):
        pat = r"\b" + re.escape(phrase) + r"\b"
        if re.search(pat, t):
            found.append("_" + SYNONYMS[phrase]); t = re.sub(pat, " ", t)
    return found

def embed(text: str, dim: int = 256) -> np.ndarray:
    # Like real models, it represents rare identifiers (E4012, INV-991) poorly:
    # any token containing a digit collapses into one shared "<code>" feature.
    words = ["<code>" if any(ch.isdigit() for ch in t) else t for t in tokens(text)]
    v = np.zeros(dim)
    for tok, w in [(t, 1.0) for t in words] + [(c, 3.0) for c in concepts(text)]:
        h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
        v[h % dim] += w if (h >> 64) & 1 else -w
    n = np.linalg.norm(v)
    return v / n if n else v
`;

const BM25 = String.raw`# ---- BM25 in plain Python (same formula as rank_bm25's BM25Okapi) ----
import math
from collections import Counter

class BM25:
    def __init__(self, docs_tokens, k1=1.5, b=0.75):
        self.k1, self.b, self.docs = k1, b, [Counter(d) for d in docs_tokens]
        self.lens = [len(d) for d in docs_tokens]; self.avg = sum(self.lens) / len(self.lens)
        df = Counter(t for d in docs_tokens for t in set(d)); N = len(docs_tokens)
        self.idf = {t: math.log((N - n + 0.5) / (n + 0.5) + 1) for t, n in df.items()}

    def scores(self, q_tokens):
        out = []
        for tf, dl in zip(self.docs, self.lens):
            s = 0.0
            for t in q_tokens:
                if t in tf:
                    f = tf[t]; s += self.idf[t] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * dl / self.avg))
            out.append(s)
        return out
`;
AISA.PY4 = { CORPUS, EMB, BM25 };

/* ===================================================================== 4.1 */
L({
  id: '4.1', title: 'Ingestion and document parsing', minutes: 50, roles: ['fde', 'be'],
  tags: 'loaders · HTML/Markdown/PDF · boilerplate · tables · metadata · content hashes · ACLs',
  mental: 'RAG quality is decided before any embedding: by what text you extract, how clean it is, and what metadata travels with it. Ingestion turns messy sources into normalised records with stable ids, structure, permissions and a content hash.',
  intro: `<p>Every retrieval failure you will debug traces back to one of three places: the text was never extracted correctly, it was split badly, or the search could not find it. This lesson is the first: getting clean, structured, well-labelled text out of real enterprise sources such as help centres, wikis, PDFs, ticket exports and shared drives.</p>
  <p>For an FDE this is often week one of a deployment: the customer’s documents are scanned PDFs, Confluence exports with repeated headers, spreadsheets and HTML with navigation menus. The ingestion pipeline you build here feeds every later lesson in this phase.</p>`,
  points: [
    'Normalise every source into one record shape: id, source, url, title, section path, text, updated_at, ACL and a content hash.',
    'Strip boilerplate (navigation, footers, cookie banners, repeated page headers); it pollutes both keyword and vector search.',
    'Keep structure: headings become a section path such as <code class="i">Billing › Refunds</code>, which later helps chunking and citations.',
    'Tables need special handling: flatten rows into “column: value” text, or keep them as Markdown, rather than losing the header-to-cell relation.',
    'PDFs: use a text-layer extractor for digital PDFs, layout-aware parsers or vision models for scans and complex layouts; always spot-check output.',
    'Hash the normalised text so re-ingestion can skip unchanged documents and detect duplicates.'
  ],
  concept: { title: 'Garbage in, confident garbage out', body: `<p>A model given a chunk that reads “Home | Pricing | Login · Acme Confidential Page 3 of 12 · refunds are reim- bursed” will still produce a fluent answer. That is the danger: bad extraction does not fail loudly, it degrades answers quietly. So ingestion gets the same care as any data pipeline: typed records, validation, and a sample you actually read.</p>` },
  walk: [
    { h: 'Choose a parser per source type', body: `<div class="tbl"><table><thead><tr><th>source</th><th>typical tools</th><th>watch out for</th></tr></thead><tbody>
      <tr><td>HTML pages</td><td>BeautifulSoup, trafilatura, stdlib html.parser</td><td>navigation, scripts, hidden text</td></tr>
      <tr><td>Digital PDF</td><td>pypdf, PyMuPDF</td><td>repeated headers, hyphenation, two-column order</td></tr>
      <tr><td>Scanned or complex PDF</td><td>Docling, Unstructured, cloud document AI, vision LLMs</td><td>OCR errors, tables, cost per page</td></tr>
      <tr><td>Office files</td><td>python-docx, openpyxl, converters</td><td>tracked changes, hidden sheets</td></tr>
      <tr><td>SaaS (Confluence, Drive, Zendesk)</td><td>their APIs or connectors</td><td>permissions, rate limits, deletions</td></tr></tbody></table></div>` },
    { h: 'Define the record', body: '<p>One schema for everything downstream.</p>', code: String.raw`class Section(BaseModel):
    doc_id: str            # stable id from the source system
    source: str            # "helpcenter", "confluence", ...
    url: str
    title: str
    path: list[str]        # heading path, e.g. ["Billing", "Refunds"]
    text: str
    updated_at: datetime
    acl: list[str]         # groups allowed to read it (lesson 4.8)
    content_hash: str` },
    { h: 'Read a sample', body: '<p>Before indexing anything, print 20 random records and read them. Most extraction bugs are obvious to a human in seconds and invisible to every metric.</p>' }
  ],
  analogy: `<p><b>Sorting donated books for a library.</b> Before anything goes on a shelf you remove the flyers stuck between pages, note the title, author and section, and label who may borrow it. Skip that step and the catalogue is useless, however good the librarian is.</p>`,
  diagram: {
    title: 'Ingestion pipeline',
    cols: [['html', 'pdf', 'saas'], ['parse'], ['clean'], ['struct'], ['rec'], ['store']],
    nodes: [
      { id: 'html', label: 'Help centre', sub: 'HTML', info: 'Web pages with navigation and scripts to strip.' },
      { id: 'pdf', label: 'Policies', sub: 'PDF · scans', tone: 'warn', info: 'Text layer or OCR; repeated headers, hyphenation, columns.' },
      { id: 'saas', label: 'Wiki · tickets', sub: 'APIs', info: 'Connectors with permissions and change feeds.' },
      { id: 'parse', label: 'Parse', sub: 'per source type', tone: 'be', info: 'Extract text and structure (headings, tables, lists).' },
      { id: 'clean', label: 'Clean', sub: 'boilerplate · fixes', info: 'Remove navigation, footers, repeated headers; fix hyphenation and whitespace.' },
      { id: 'struct', label: 'Structure', sub: 'sections · tables', info: 'Heading paths, tables flattened to readable rows.' },
      { id: 'rec', label: 'Section records', sub: 'id · acl · hash', tone: 'acc', info: 'Normalised records with metadata and a content hash.' },
      { id: 'store', label: 'Document store', sub: 'then chunk + index', tone: 'ok', info: 'Source of truth for chunking and indexing (lessons 4.2 to 4.4).' }
    ],
    edges: [{ a: 'html', b: 'parse', step: 1 }, { a: 'pdf', b: 'parse', step: 1 }, { a: 'saas', b: 'parse', step: 1 }, { a: 'parse', b: 'clean', step: 2 }, { a: 'clean', b: 'struct', step: 3 }, { a: 'struct', b: 'rec', step: 4 }, { a: 'rec', b: 'store', step: 5 }],
    steps: ['Each source type gets its own parser.', 'Boilerplate and extraction artefacts are removed.', 'Headings and tables are kept as structure.', 'Everything becomes one record shape with ACLs and a hash.', 'Records land in a store that chunking and indexing read from.'],
    caption: 'Many messy sources in, one clean record shape out.'
  },
  illustrated: { title: 'What a page header does to retrieval', body: `<p>A 40-page policy PDF has “Acme Confidential — Internal use only — Page N of 40” on every page. Left in, those 9 words appear in every chunk:</p>
    <div class="tbl"><table><thead><tr><th></th><th>header kept</th><th>header removed</th></tr></thead><tbody>
    <tr><td>share of each 200-token chunk that is boilerplate</td><td class="n">~5% to 10%</td><td class="n">0%</td></tr>
    <tr><td>query “internal policy on refunds”</td><td>matches every chunk on “internal” and “policy”</td><td>matches the refund section</td></tr>
    <tr><td>vector similarity between unrelated chunks</td><td>raised by the shared text</td><td>reflects real content</td></tr></tbody></table></div>` },
  code: {
    title: 'Normalise HTML, Markdown and a ticket export into records', file: 'ingest.py', browser: true,
    intro: '<p>Three sources, one record shape. The HTML parser drops navigation, scripts and footers, keeps the heading path and flattens a table into readable rows. Content hashes detect the duplicate FAQ entry that exists in two systems.</p>',
    src: String.raw`import hashlib, json, re
from html.parser import HTMLParser

HTML = """<html><head><script>track()</script></head><body>
<nav>Home | Pricing | Login</nav>
<h1>Billing</h1><h2>Refunds</h2>
<p>Duplicate charges are refunded automatically within 5 business days.</p>
<h2>Plans</h2>
<table><tr><th>Plan</th><th>Price</th><th>Seats</th></tr>
<tr><td>Starter</td><td>Free</td><td>3</td></tr><tr><td>Pro</td><td>$48/user</td><td>Unlimited</td></tr></table>
<footer>© Acme · Cookie settings</footer></body></html>"""

MARKDOWN = """# Security
## SSO
Enterprise workspaces can sign in with SAML through Okta or Entra ID.
## Refunds
Duplicate charges are refunded automatically within 5 business days.
"""

TICKETS = [{"id": 4812, "subject": "Charged twice", "body": "Customer was charged twice; refunded per policy.", "updated": "2026-10-14"}]

class HelpPage(HTMLParser):
    SKIP = {"nav", "script", "style", "footer"}
    def __init__(self):
        super().__init__(); self.path, self.sections, self.skip, self.buf = [], [], 0, []
        self.row, self.table, self.cell = None, None, False
    def flush(self):
        text = " ".join(" ".join(self.buf).split())
        if text:
            self.sections.append((list(self.path), text))
        self.buf = []
    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP: self.skip += 1
        elif tag in ("h1", "h2", "h3"): self.flush(); self.heading = int(tag[1]); self.buf_h = []
        elif tag == "table": self.table = []
        elif tag == "tr": self.row = []
        elif tag in ("td", "th"): self.cell = True; self.row.append("")
    def handle_endtag(self, tag):
        if tag in self.SKIP: self.skip -= 1
        elif tag in ("h1", "h2", "h3"):
            self.path = self.path[: self.heading - 1] + [" ".join(self.buf_h).strip()]; self.buf_h = None
        elif tag in ("td", "th"): self.cell = False
        elif tag == "tr": self.table.append(self.row)
        elif tag == "table":
            head, *rows = self.table
            self.buf.append(" ".join("; ".join(f"{h}: {v}" for h, v in zip(head, r)) + "." for r in rows)); self.table = None
    def handle_data(self, data):
        if self.skip: return
        if getattr(self, "buf_h", None) is not None: self.buf_h.append(data)
        elif self.cell: self.row[-1] += data.strip()
        elif self.table is None: self.buf.append(data)

def record(source, doc_id, path, text, updated="2026-10-01", acl=("all-staff",)):
    norm = " ".join(text.split())
    return {"doc_id": doc_id, "source": source, "path": " › ".join(path), "text": norm, "updated_at": updated,
            "acl": list(acl), "content_hash": hashlib.sha256(norm.lower().encode()).hexdigest()[:12]}

records = []
p = HelpPage(); p.feed(HTML); p.flush()
records += [record("helpcenter", f"hc-billing#{i}", path, text) for i, (path, text) in enumerate(p.sections)]
path = []
for block in re.split(r"\n(?=#)", MARKDOWN.strip()):
    head, _, body = block.partition("\n"); level = len(head) - len(head.lstrip("#"))
    path = path[: level - 1] + [head.lstrip("# ")]
    if body.strip():
        records.append(record("wiki", f"wiki-security#{len(records)}", path, body, acl=("support", "security")))
records += [record("zendesk", f"ticket-{t['id']}", ["Tickets", t["subject"]], t["body"], t["updated"], ("support",)) for t in TICKETS]

seen = {}
for r in records:
    dup = seen.setdefault(r["content_hash"], r["doc_id"]) != r["doc_id"]
    print(f"{r['doc_id']:<18} {r['path']:<22} acl={','.join(r['acl']):<17} hash={r['content_hash']} {'DUPLICATE of ' + seen[r['content_hash']] if dup else ''}")
    print("   ", r["text"][:96])`
  },
  lab: {
    title: 'Clean a PDF text dump', file: 'pdf_clean_lab.py', browser: true,
    scenario: `<p>A customer exported their 30-page refund handbook from a PDF with a text-layer extractor. The output has a repeated header and footer on every page, words hyphenated across lines, hard line wraps in the middle of sentences, and bullet lists that must stay as lists. Write the cleaner that runs before chunking.</p>`,
    steps: ['Split the dump into pages on the form-feed character <code class="i">\\f</code>.', 'Find lines that appear on more than half of the pages (after replacing digits with #) and drop them: those are headers and footers.', 'Join hyphenated breaks: <code class="i">reim-\\nbursed</code> becomes <code class="i">reimbursed</code>.', 'Join wrapped lines into paragraphs, but keep lines that start with a bullet or a number as separate list items.', 'Print the cleaned text and the number of characters removed.'],
    checks: ['No line contains “Page” or “Confidential”.', '“reimbursed” appears unbroken.', 'The three bullet items stay on separate lines.'],
    hints: ['<code class="i">re.sub(r"\\d+", "#", line)</code> makes “Page 3 of 30” and “Page 4 of 30” identical.', 'Handle hyphenation before joining lines.'],
    starter: String.raw`import re
from collections import Counter

BODIES = [
    "Duplicate charges are reim-\nbursed automatically within five\nbusiness days of the report.",
    "Refund amounts depend on the plan:\n- Annual plans: pro rata\n- Monthly plans: full month\n- Disputed charges: never while open",
    "Agents must log every refund in the\nbilling system with the ticket id\nand the approver's name.",
    "Refunds above five hundred dollars\nneed approval from a billing lead\nbefore they are issued.",
]
pages = [f"Acme Confidential - Refund Handbook\nSection {n}\n{body}\nPage {n} of 30" for n, body in enumerate(BODIES, 1)]
dump = "\f".join(pages)

def clean(dump: str) -> str:
    # TODO
    return dump

out = clean(dump)
print(out[:500])
print("removed", len(dump) - len(out), "chars")`,
    solution: String.raw`import re
from collections import Counter

BODIES = [
    "Duplicate charges are reim-\nbursed automatically within five\nbusiness days of the report.",
    "Refund amounts depend on the plan:\n- Annual plans: pro rata\n- Monthly plans: full month\n- Disputed charges: never while open",
    "Agents must log every refund in the\nbilling system with the ticket id\nand the approver's name.",
    "Refunds above five hundred dollars\nneed approval from a billing lead\nbefore they are issued.",
]
pages = [f"Acme Confidential - Refund Handbook\nSection {n}\n{body}\nPage {n} of 30" for n, body in enumerate(BODIES, 1)]
dump = "\f".join(pages)

BULLET = re.compile(r"^\s*([-*•]|\d+[.)])\s+")

def clean(dump: str) -> str:
    page_lines = [p.split("\n") for p in dump.split("\f")]
    shape = lambda l: re.sub(r"\d+", "#", l.strip())
    counts = Counter(s for lines in page_lines for s in {shape(l) for l in lines})
    repeated = {s for s, c in counts.items() if c > len(page_lines) / 2 and not s.startswith("Section")}
    out_pages = []
    for lines in page_lines:
        text = "\n".join(l for l in lines if shape(l) not in repeated)
        text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)          # de-hyphenate across line breaks
        paras, cur = [], ""
        for line in text.split("\n"):
            line = line.strip()
            if not line:
                continue
            if BULLET.match(line) or line.startswith("Section"):
                if cur: paras.append(cur); cur = ""
                paras.append(line)
            elif cur and not cur.endswith((".", ":", "?", "!")):
                cur += " " + line                               # a wrapped line continues the sentence
            else:
                if cur: paras.append(cur)
                cur = line
        if cur: paras.append(cur)
        out_pages.append("\n".join(paras))
    return "\n\n".join(out_pages)

out = clean(dump)
print(out)
print("---")
print("removed", len(dump) - len(out), "chars | 'Page' left:", "Page" in out, "| 'Confidential' left:", "Confidential" in out, "| reimbursed intact:", "reimbursed" in out)`
  },
  design: {
    lead: '<p>Ingestion is a data pipeline with all the usual concerns: incremental runs, idempotency, schema validation, monitoring and backfills. At enterprise scale it is often the largest part of a RAG deployment.</p>',
    scale: [{ h: 'Incremental by default', p: 'Track a watermark per source and a content hash per document; only re-parse and re-embed what changed (lesson 4.8).' }, { h: 'Expensive parsing as a queue', p: 'OCR and vision parsing cost seconds and money per page. Run them as background jobs with retries and per-tenant budgets (Phase 1.6).' }],
    fail: [{ h: 'Silent extraction failures', p: 'A PDF with no text layer yields empty records. Alert on empty or tiny outputs per document, and on sudden drops in characters per source.' }, { h: 'Lost permissions', p: 'Copying text without its ACL turns a private HR document into public context. ACLs are part of the record, never optional (lesson 4.8).' }],
    trade: [{ h: 'Simple extractors vs layout-aware parsers', p: 'Text-layer extraction is fast and cheap; layout-aware or vision parsing is slow and costly but handles tables, columns and scans. Route by document type.' }, { h: 'Markdown vs plain text', p: 'Keeping Markdown preserves headings and tables for chunking and display, at a small token cost.' }],
    prompt: '<p>A bank wants RAG over 2 million documents: half scanned PDFs, plus Confluence and SharePoint, all with permissions. Design ingestion.</p>',
    answer: '<ul><li>Connectors per source with change feeds or watermarks; permissions captured with every document.</li><li>Router: text-layer extraction when present, OCR or vision parsing for scans, with per-page cost tracking.</li><li>Queue-based workers, idempotent by document id plus content hash; dead-letter queue for failures.</li><li>Quality monitoring: characters per page, empty outputs, sampled human review; a backfill job for parser upgrades.</li></ul>'
  },
  quiz: [
    { q: 'Why remove navigation menus and page headers before indexing?', o: ['To save disk only', 'They add identical text to many chunks, distorting keyword and vector similarity', 'Embedding models reject them', 'They are copyrighted'], a: 1, why: 'Shared boilerplate makes unrelated chunks look similar and match generic queries.' },
    { q: 'What is the content hash for?', o: ['Encryption', 'Skipping unchanged documents and detecting duplicates on re-ingestion', 'Sorting results', 'Access control'], a: 1, why: 'Same normalised text, same hash: no need to re-embed.' },
    { q: 'Which field must never be dropped during ingestion?', o: ['Font size', 'The document’s access control list', 'Page colour', 'File size'], a: 1, why: 'Without ACLs, retrieval can leak private content to anyone.' }
  ],
  interview: [
    { q: 'A customer says the RAG bot gives wrong answers about their policies. Where do you start?', a: '<p>Look at what was retrieved for failing questions, then at the underlying chunks and the extracted text. Often the extraction is broken: tables flattened into nonsense, headers in every chunk, scanned pages with no text. Fix ingestion, then chunking, then retrieval, measuring with a small labelled question set at each step.</p>' },
    { q: 'How would you design ingestion so re-indexing 1 million documents is cheap?', a: '<p>Stable document ids, normalised text with a content hash, and a watermark per source. Each run fetches changes, re-parses only changed documents, skips identical hashes, and re-embeds only changed chunks. Deletions become tombstones. Parser and embedding model versions are stored so I can backfill selectively when they change.</p>' }
  ]
});

/* ===================================================================== 4.2 */
L({
  id: '4.2', title: 'Chunking', minutes: 50, roles: ['be', 'fde'], sim: 'chunk',
  tags: 'fixed · recursive · structure-aware · overlap · parent-child · contextual chunk headers',
  mental: 'Retrieval returns chunks, not documents. A chunk should be small enough to be specific and large enough to make sense on its own. Split along the document’s structure, keep answers in one piece, and give each chunk the context it lost when it was cut out.',
  intro: `<p>You cannot embed a 40-page handbook as one vector and expect a question about late fees to find it: one vector averages everything. You also cannot feed the whole corpus to the model. So documents are split into chunks, and each chunk is indexed separately. Where you cut decides whether the answer to a question exists anywhere as one retrievable piece.</p>`,
  points: [
    '<b>Fixed-size</b> chunks (for example 300 tokens) are simple and predictable but cut through sentences and sections.',
    '<b>Recursive</b> splitting tries paragraph breaks first, then sentences, then words, until each piece fits the size limit.',
    '<b>Structure-aware</b> chunking starts new chunks at headings, so a section stays together; long sections are split recursively.',
    '<b>Overlap</b> (10% to 20%) rescues answers that straddle a boundary, at the cost of more tokens indexed.',
    '<b>Parent-child</b>: retrieve small precise chunks, then hand the model their larger parent section for context.',
    '<b>Contextual headers</b>: prepend the document title and section path (or an LLM-written summary) to each chunk before indexing.'
  ],
  concept: { title: 'Every chunk must stand on its own', body: `<p>Imagine a chunk that says “This is limited to 60 days.” Limited what? For which plan? Without its title and heading, neither BM25 nor an embedding can match it to “how long do I have to request a refund?”. Good chunking keeps answers whole and carries context into each chunk, which is exactly what Anthropic’s contextual retrieval technique does by prepending a short, model-written context to every chunk before indexing.</p>` },
  walk: [
    { h: 'Pick a size from your questions', body: '<p>Look at real questions and the passages that answer them. Answers are usually one to five sentences: chunks of roughly 200 to 500 tokens keep them whole while staying specific. Then tune with an eval, not by intuition.</p>' },
    { h: 'Recursive split with overlap', body: '<p>Split on the largest separator that works, merge small pieces up to the limit, then add the tail of the previous chunk as overlap.</p>', code: String.raw`SEPARATORS = ["\n## ", "\n\n", ". ", " "]
def split(text, max_tokens):
    if n_tokens(text) <= max_tokens:
        return [text]
    for sep in SEPARATORS:
        if sep in text:
            parts = text.split(sep)
            return merge([p for part in parts for p in split(part, max_tokens)], max_tokens, sep)
    return hard_cut(text, max_tokens)` },
    { h: 'Add context to each chunk', body: '<p>Index <code class="i">"Refund handbook › Annual plans: " + chunk</code> instead of the bare chunk. The model-written variant asks an LLM for one or two sentences situating the chunk in the document; prompt caching makes that affordable because the document is the shared prefix for all its chunks.</p>' }
  ],
  analogy: `<p><b>Cutting a newspaper into clippings.</b> Cut through the middle of an article and the clipping is useless. Cut along article boundaries and each clipping makes sense. Write the newspaper name and section on the back of each one, and you can file and find it later.</p>`,
  diagram: {
    title: 'Chunking strategies',
    cols: [['doc'], ['fixed', 'struct', 'parent'], ['ctx'], ['index']],
    nodes: [
      { id: 'doc', label: 'Section records', sub: 'from ingestion', info: 'Clean text with heading paths (lesson 4.1).' },
      { id: 'fixed', label: 'Fixed / recursive', sub: 'size + overlap', info: 'Simple size-based splitting, preferring natural breaks.' },
      { id: 'struct', label: 'Structure-aware', sub: 'split at headings', tone: 'acc', info: 'Sections stay together; long ones split recursively.' },
      { id: 'parent', label: 'Parent-child', sub: 'small → large', tone: 'be', info: 'Index small child chunks; return the parent section as context.' },
      { id: 'ctx', label: 'Contextual header', sub: 'title › path or LLM summary', tone: 'fde', info: 'Prepend context so each chunk stands on its own.' },
      { id: 'index', label: 'Chunks to index', sub: 'text + metadata', tone: 'ok', info: 'Each chunk keeps doc id, path, ACL and position for citations.' }
    ],
    edges: [{ a: 'doc', b: 'fixed' }, { a: 'doc', b: 'struct' }, { a: 'doc', b: 'parent' }, { a: 'fixed', b: 'ctx' }, { a: 'struct', b: 'ctx' }, { a: 'parent', b: 'ctx' }, { a: 'ctx', b: 'index' }],
    caption: 'Choose a split, then give every chunk its context back.'
  },
  illustrated: { title: 'The same section, chunked three ways', body: `<p>Section “Refunds › Annual plans”, 420 tokens. Question: “can I get a refund on an annual plan after 3 months?”</p>
    <div class="tbl"><table><thead><tr><th>strategy</th><th>result</th></tr></thead><tbody>
    <tr><td>fixed 200, no overlap</td><td>answer split across chunks 2 and 3; neither matches strongly</td></tr>
    <tr><td>fixed 200, 20% overlap</td><td>chunk 3 holds the whole answer; 20% more tokens indexed</td></tr>
    <tr><td>structure-aware, 500 max</td><td>whole section is one chunk; matches, but is less specific for other questions</td></tr>
    <tr><td>contextual header added</td><td>“Refund handbook › Annual plans:” makes the chunk match “annual plan” even where the text only says “this plan”</td></tr></tbody></table></div>` },
  code: {
    title: 'Three chunkers measured on answer containment', file: 'chunking.py', browser: true,
    intro: '<p>A handbook with headings, and six questions whose answers are known sentences. For each strategy we count chunks, tokens indexed, and how many answers sit entirely inside one chunk. Token counts use a words-times-1.3 estimate; use the real tokenizer of your embedding model in production.</p>',
    src: String.raw`import re

DOC = """# Refund handbook
## Duplicate charges
When a customer is charged twice, the duplicate is refunded automatically. The refund reaches the card within 5 business days. No approval is needed.
## Annual plans
Annual plans can be refunded pro rata for unused months. The request must arrive within 6 months of renewal. After that, only credit notes are possible.
## Monthly plans
Monthly plans are not refunded for partial months. Cancelling stops the next renewal. Access continues until the period ends.
## Disputes
If the customer opened a chargeback with their bank, do not refund. The payment is frozen until the bank decides. Refunding during a dispute causes a double payout.
## Approvals
Refunds above 500 dollars need approval from a billing lead. Approvals are recorded in the billing system with the ticket id."""

ANSWERS = ["The refund reaches the card within 5 business days.", "The request must arrive within 6 months of renewal.",
           "Monthly plans are not refunded for partial months.", "Refunding during a dispute causes a double payout.",
           "Refunds above 500 dollars need approval from a billing lead.", "Annual plans can be refunded pro rata for unused months."]

ntok = lambda s: round(len(s.split()) * 1.3)

def fixed(text, size, overlap=0):
    words, step, out = text.split(), max(1, int(size / 1.3 * (1 - overlap))), []
    for i in range(0, len(words), step):
        out.append(" ".join(words[i:i + int(size / 1.3)]))
        if i + int(size / 1.3) >= len(words): break
    return out

def sentences(text):
    return [s for s in re.split(r"(?<=[.!?])\s+", text) if s]

def recursive(text, size):
    out, cur = [], ""
    for s in sentences(" ".join(text.split())):
        if cur and ntok(cur + " " + s) > size:
            out.append(cur); cur = s
        else:
            cur = (cur + " " + s).strip()
    return out + [cur] if cur else out

def by_heading(text, size, with_context=True):
    out, title, path = [], "", ""
    for block in re.split(r"\n(?=#)", text):
        head, _, body = block.partition("\n")
        if head.startswith("# "): title = head[2:]; continue
        path = head.lstrip("# ")
        for piece in recursive(body, size):
            out.append((f"{title} › {path}: " if with_context else "") + piece)
    return out

def report(name, chunks):
    flat = lambda s: " ".join(s.split())
    kept = sum(any(a in flat(c) for c in chunks) for a in ANSWERS)
    print(f"{name:<34} chunks={len(chunks):>2} tokens={sum(map(ntok, chunks)):>4} answers intact={kept}/{len(ANSWERS)}")

report("fixed 30 tokens", fixed(DOC, 30))
report("fixed 30 tokens + 30% overlap", fixed(DOC, 30, 0.3))
report("recursive by sentence, 30 max", recursive(DOC, 30))
report("heading-aware, 30 max", by_heading(DOC, 30, with_context=False))
report("heading-aware + context header", by_heading(DOC, 30))
print("\nexample chunk:", by_heading(DOC, 30)[-3])`
  },
  lab: {
    title: 'Parent-child chunking', file: 'parent_child_lab.py', browser: true,
    scenario: `<p>Small chunks retrieve precisely but give the model too little context; large chunks give context but match vaguely. Build the parent-child pattern: index one-sentence child chunks, each pointing to its parent section, and at query time return the parents of the best children, deduplicated, within a token budget.</p>`,
    steps: ['Split the handbook into sections (parents) and sentences (children); give each child a <code class="i">parent_id</code>.', 'Score children against a query with simple word overlap (a stand-in for vector search).', 'Take the top 4 children, map them to parents, deduplicate while keeping rank order.', 'Return parents until a 120-token budget is reached.', 'Run three queries and print which parents come back and why.'],
    checks: ['A query matching two sentences of the same section returns that section once.', 'The budget is never exceeded.', 'Each returned parent lists the child sentences that matched.'],
    hints: ['A dict from parent_id to the list of matching child ids keeps the evidence.', 'Python dicts keep insertion order, which preserves rank order when deduplicating.'],
    starter: String.raw`import re
DOC = """## Duplicate charges
When a customer is charged twice, the duplicate is refunded automatically. The refund reaches the card within 5 business days. No approval is needed.
## Annual plans
Annual plans can be refunded pro rata for unused months. The request must arrive within 6 months of renewal. After that, only credit notes are possible.
## Disputes
If the customer opened a chargeback with their bank, do not refund. The payment is frozen until the bank decides. Refunding during a dispute causes a double payout."""

ntok = lambda s: round(len(s.split()) * 1.3)
STOP = {"the", "a", "is", "to", "of", "do", "i", "my", "can", "how", "when", "with", "for", "an", "are", "after"}
words = lambda s: {w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in STOP}

def build(doc):
    # TODO: return parents {pid: {"title", "text"}} and children [{"id", "parent", "text"}]
    return {}, []

def retrieve(query, parents, children, k=4, budget=120):
    # TODO
    return []

parents, children = build(DOC)
for q in ["how long until a duplicate refund reaches my card", "refund for unused months of an annual plan", "customer opened a chargeback"]:
    print(q, "->", retrieve(q, parents, children))`,
    solution: String.raw`import re
DOC = """## Duplicate charges
When a customer is charged twice, the duplicate is refunded automatically. The refund reaches the card within 5 business days. No approval is needed.
## Annual plans
Annual plans can be refunded pro rata for unused months. The request must arrive within 6 months of renewal. After that, only credit notes are possible.
## Disputes
If the customer opened a chargeback with their bank, do not refund. The payment is frozen until the bank decides. Refunding during a dispute causes a double payout."""

ntok = lambda s: round(len(s.split()) * 1.3)
STOP = {"the", "a", "is", "to", "of", "do", "i", "my", "can", "how", "when", "with", "for", "an", "are", "after"}
words = lambda s: {w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in STOP}

def build(doc):
    parents, children = {}, []
    for i, block in enumerate(re.split(r"\n(?=## )", doc.strip())):
        head, _, body = block.partition("\n")
        pid = f"p{i}"
        parents[pid] = {"title": head.lstrip("# "), "text": " ".join(body.split())}
        for j, s in enumerate(re.split(r"(?<=[.!?])\s+", parents[pid]["text"])):
            children.append({"id": f"{pid}.c{j}", "parent": pid, "text": s})
    return parents, children

def retrieve(query, parents, children, k=4, budget=120):
    q = words(query)
    scored = sorted(children, key=lambda c: -len(q & words(c["text"])))[:k]
    hits = {}
    for c in scored:
        if q & words(c["text"]):
            hits.setdefault(c["parent"], []).append(c["id"])
    out, used = [], 0
    for pid, evidence in hits.items():
        cost = ntok(parents[pid]["text"])
        if used + cost > budget:
            continue
        out.append((parents[pid]["title"], evidence)); used += cost
    return out, used

parents, children = build(DOC)
print(len(parents), "parents,", len(children), "children")
for q in ["how long until a duplicate refund reaches my card", "refund for unused months of an annual plan", "customer opened a chargeback"]:
    got, used = retrieve(q, parents, children)
    print(f"{q!r}\n   -> {got} ({used} tokens of 120)")`
  },
  design: {
    lead: '<p>Chunking is a parameter of your index, so changing it means re-indexing. Version it, evaluate it with retrieval metrics, and keep enough metadata on each chunk to cite and to rebuild context.</p>',
    scale: [{ h: 'Chunk metadata', p: 'Store doc id, section path, character offsets, ACL and chunker version with each chunk, so you can cite, expand to parents and re-chunk selectively.' }, { h: 'Contextual headers at scale', p: 'Model-written context for millions of chunks is a batch job: use the batch API and prompt caching on the document prefix.' }],
    fail: [{ h: 'Orphan chunks', p: 'Chunks like "See the table above" or "This applies to all plans" mean nothing alone. Context headers or parent expansion fix them.' }, { h: 'Tables split mid-row', p: 'Keep tables whole or split by rows with the header repeated in each chunk.' }],
    trade: [{ h: 'Small vs large chunks', p: 'Small chunks retrieve precisely but lose context; large ones keep context but dilute similarity and cost more tokens per answer.' }, { h: 'Overlap', p: 'Overlap rescues boundary-straddling answers but inflates index size and creates near-duplicate results to deduplicate.' }],
    prompt: '<p>Your RAG system answers well on FAQs but badly on 200-page contracts. How would you chunk the contracts?</p>',
    answer: '<ul><li>Structure-aware: split on clause numbering and headings, never mid-clause.</li><li>Contextual header: contract name, party, clause path, effective date.</li><li>Parent-child: index sub-clauses, return the full clause plus its definitions section.</li><li>Evaluate with clause-level questions; compare against the FAQ chunker on the same metrics.</li></ul>'
  },
  quiz: [
    { q: 'What does overlap buy you?', o: ['Smaller indexes', 'Answers that straddle a boundary appear whole in at least one chunk', 'Faster queries', 'Better ACLs'], a: 1, why: 'The tail of one chunk repeats at the start of the next.' },
    { q: 'Why prepend the document title and section to each chunk?', o: ['For formatting', 'So the chunk carries context it lost when cut out, improving matching', 'To increase tokens', 'Embedding models require it'], a: 1, why: 'Chunks like "this is limited to 60 days" become findable with their context.' },
    { q: 'In parent-child retrieval, what is indexed and what is returned?', o: ['Parents indexed, children returned', 'Small children indexed, their larger parents returned as context', 'Both indexed and returned equally', 'Only titles'], a: 1, why: 'Precise matching on small pieces, enough context from the parent.' }
  ],
  interview: [
    { q: 'How do you choose a chunk size?', a: '<p>Start from how long real answers are, typically a few sentences, and from the document structure. Begin with structure-aware chunks of a few hundred tokens with contextual headers, then tune size and overlap using recall@k on a labelled question set. Smaller when questions are precise, larger or parent-child when answers need surrounding context.</p>' },
    { q: 'What is contextual retrieval?', a: '<p>Before indexing, each chunk gets a short context, written by an LLM from the whole document, that situates it, such as the company, the document and the section. That context is embedded and BM25-indexed with the chunk. Anthropic reported it substantially reduced retrieval failures, especially combined with BM25 and reranking. Prompt caching keeps the cost down because the document is a shared prefix.</p>' }
  ]
});

/* ===================================================================== 4.3 */
L({
  id: '4.3', title: 'Embeddings', minutes: 50, roles: ['be', 'fde'],
  tags: 'vectors · cosine similarity · normalisation · query vs document · dimensions · quantisation · caching',
  mental: 'An embedding model maps text to a point in a high-dimensional space where similar meanings land close together. Retrieval becomes geometry: embed the query, find the nearest chunk vectors. Everything else is engineering: which model, how many dimensions, how to store them cheaply, and when to re-embed.',
  intro: `<p>Keyword search fails when the customer writes “money back” and the docs say “refund”. Embeddings solve this by comparing meaning rather than words. They power semantic search, deduplication, clustering, classification and semantic caching (Phase 9.2).</p>
  <p>Lesson 2.1 showed how language models represent text internally; embedding models are trained specifically so that the distance between two vectors reflects how related two texts are.</p>`,
  points: [
    'An embedding is a fixed-length vector (commonly 384 to 3,072 numbers) produced by an embedding model.',
    'Similarity is usually cosine similarity; with normalised vectors it equals the dot product, which is what indexes compute fastest.',
    'Many models expect different inputs for queries and documents (prefixes or an <code class="i">input_type</code> parameter); use them as documented.',
    'Pick models with public benchmarks such as MTEB as a shortlist, then decide with your own labelled queries; domain fit beats leaderboard rank.',
    'Storage scales with vectors × dimensions × bytes: int8 or binary quantisation and shorter dimensions cut memory 4× to 32× with some recall loss.',
    'Changing the model means re-embedding everything: version your index by model name and dimension.'
  ],
  concept: { title: 'Meaning as distance', body: `<p>The model is trained on pairs of texts that belong together (a question and its answer, a title and its article) so their vectors end up close, and unrelated texts end up far apart. You never interpret individual numbers; you only compare vectors. That also means vectors from two different models are not comparable: a query embedded with model B searched against documents embedded with model A returns noise.</p>` },
  walk: [
    { h: 'Embed with a real model', body: '<p>Two common options: a local open model, or a hosted API. Both are shown, not run here.</p>', code: String.raw`# local, open weights
from sentence_transformers import SentenceTransformer
model = SentenceTransformer("all-MiniLM-L6-v2")                 # 384 dimensions
doc_vecs = model.encode(chunks, normalize_embeddings=True, batch_size=64)

# hosted API (OpenAI shown; Voyage, Cohere, Google and others are similar)
from openai import OpenAI
resp = OpenAI().embeddings.create(model="text-embedding-3-small", input=chunks, dimensions=512)
doc_vecs = [d.embedding for d in resp.data]` },
    { h: 'Search is a matrix product', body: '<p>With normalised vectors, similarity of one query to every chunk is one matrix-vector product. Exact search like this is fine up to around a few hundred thousand vectors; beyond that, use an approximate index (lesson 4.4).</p>', code: String.raw`scores = doc_matrix @ query_vec          # cosine similarity for every chunk
top = np.argsort(-scores)[:5]` },
    { h: 'Budget the storage', body: '<p>10 million chunks × 1,024 dimensions × 4 bytes = 41 GB of float32, before index overhead. int8 makes it 10 GB, binary about 1.3 GB. Quantised search usually retrieves a larger candidate set and rescores it with full-precision vectors.</p>' }
  ],
  analogy: `<p><b>A map of a city where every shop is placed by what it sells.</b> Bakeries cluster in one neighbourhood, hardware shops in another. To find “somewhere for fresh bread” you go to the bakery district, even if no shop is literally named “fresh bread”. The embedding model draws the map; search is finding the nearest shops to where your question lands.</p>`,
  diagram: {
    title: 'Embedding pipeline: index time and query time',
    cols: [['chunks', 'query'], ['model'], ['vecs', 'qv'], ['store'], ['top']],
    nodes: [
      { id: 'chunks', label: 'Chunks', sub: 'index time · batched', info: 'Embedded once, in batches, and cached by content hash.' },
      { id: 'query', label: 'User query', sub: 'query time', tone: 'fde', info: 'Embedded per request with the query-side input type.' },
      { id: 'model', label: 'Embedding model', sub: 'same model + version', tone: 'acc', info: 'Must be the same model for documents and queries.' },
      { id: 'vecs', label: 'Doc vectors', sub: 'normalised · versioned', info: 'Stored with model name and dimension.' },
      { id: 'qv', label: 'Query vector', sub: '1 × d', info: 'One vector per query (or several with multi-query, lesson 4.7).' },
      { id: 'store', label: 'Vector index', sub: 'exact or ANN', tone: 'be', info: 'Brute force for small sets; HNSW or IVF at scale (lesson 4.4).' },
      { id: 'top', label: 'Top-k chunks', sub: 'by cosine', tone: 'ok', info: 'Nearest neighbours go to fusion and reranking.' }
    ],
    edges: [{ a: 'chunks', b: 'model', step: 1 }, { a: 'model', b: 'vecs', step: 1 }, { a: 'vecs', b: 'store', step: 2 }, { a: 'query', b: 'model', step: 3 }, { a: 'model', b: 'qv', step: 3 }, { a: 'qv', b: 'store', step: 4 }, { a: 'store', b: 'top', step: 5 }],
    steps: ['At index time, chunks are embedded in batches.', 'Vectors are stored in an index with the model version.', 'At query time, the query is embedded with the same model.', 'The index finds the nearest document vectors.', 'Top-k chunks move on to fusion and reranking.'],
    caption: 'One model, two moments: batch at index time, single at query time.'
  },
  illustrated: { title: 'Memory for 10 million chunks at 1,024 dimensions', body: `<div class="tbl"><table><thead><tr><th>format</th><th>bytes per vector</th><th>total</th><th>typical use</th></tr></thead><tbody>
    <tr><td>float32</td><td class="n">4,096</td><td class="n">41 GB</td><td>baseline, rescoring</td></tr>
    <tr><td>float16 / bfloat16</td><td class="n">2,048</td><td class="n">20 GB</td><td>little or no recall loss</td></tr>
    <tr><td>int8 (scalar quantised)</td><td class="n">1,024</td><td class="n">10 GB</td><td>small recall loss, rescore top candidates</td></tr>
    <tr><td>binary (1 bit per dimension)</td><td class="n">128</td><td class="n">1.3 GB</td><td>first-pass candidates, then rescore</td></tr></tbody></table></div>
    <p>The Code tab measures the recall cost of int8 and binary on synthetic vectors.</p>` },
  code: {
    title: 'Similarity, search and quantisation, measured', file: 'embeddings.py', browser: true,
    intro: '<p>Part 1 embeds the help-centre corpus with the toy model and shows paraphrase matching, including one deliberate miss: the toy model, like real ones, represents error codes poorly, so “E4012” lands on the E4013 page. Lesson 4.5 fixes that with keyword search. Part 2 builds 10,000 synthetic 384-dimension vectors with cluster structure and measures how much recall@10 int8 and binary quantisation lose against exact float search, and how much rescoring recovers.</p>',
    src: CORPUS + EMB + String.raw`
# ---- part 1: semantic matching on the corpus ----
texts = [d["title"] + ". " + d["text"] for d in DOCS]
M = np.stack([embed(t) for t in texts])                    # (13, 256), rows are unit vectors
for q, rel in QUERIES[:4]:
    s = M @ embed(q)
    best = int(np.argmax(s))
    print(f"{q[:46]:<46} -> {DOCS[best]['id']:<14} cos={s[best]:.2f} {'OK' if DOCS[best]['id'] in rel else 'MISS'}")

# ---- part 2: quantisation trade-offs on synthetic vectors ----
rng = np.random.default_rng(0)
centers = rng.normal(size=(50, 384))
X = centers[rng.integers(0, 50, 10_000)] + 0.6 * rng.normal(size=(10_000, 384))
X = (X / np.linalg.norm(X, axis=1, keepdims=True)).astype(np.float32)
Q = X[rng.choice(10_000, 100, replace=False)] + 0.05 * rng.normal(size=(100, 384)).astype(np.float32)
Q /= np.linalg.norm(Q, axis=1, keepdims=True)

exact = np.argsort(-(Q @ X.T), axis=1)[:, :10]
def recall(found):
    return np.mean([len(set(f[:10]) & set(e)) / 10 for f, e in zip(found, exact)])

scale = np.abs(X).max()
X8 = np.round(X / scale * 127).astype(np.int8)                     # scalar quantisation
int8_top = np.argsort(-(Q @ X8.T.astype(np.float32)), axis=1)[:, :10]

Xb, Qb = X > 0, Q > 0                                               # 1 bit per dimension
ham = (Qb[:, None, :] != Xb[None, :, :]).sum(-1)
bin_top = np.argsort(ham, axis=1)[:, :10]
cand = np.argsort(ham, axis=1)[:, :100]                             # binary first pass, then rescore
rescored = np.array([c[np.argsort(-(X[c] @ q))][:10] for c, q in zip(cand, Q)])

print(f"\n{'format':<26}{'MB for 10k':>11}{'recall@10':>11}")
for name, mb, top in [("float32 exact", X.nbytes / 1e6, exact), ("int8", X8.nbytes / 1e6, int8_top),
                      ("binary", X.shape[0] * 384 / 8 / 1e6, bin_top), ("binary top-100 + rescore", X.shape[0] * 384 / 8 / 1e6, rescored)]:
    print(f"{name:<26}{mb:>11.2f}{recall(top):>11.2f}")`
  },
  lab: {
    title: 'An embedding cache with batching', file: 'embed_cache_lab.py', browser: true,
    scenario: `<p>The customer re-ingests their wiki every night. 95% of chunks have not changed, yet the job re-embeds all of them and the embedding bill keeps growing. Build an embedding service wrapper: a cache keyed by model and content hash, batched calls to the provider with a maximum batch size, and counters that prove the savings.</p>`,
    steps: ['Key the cache by <code class="i">(model, sha256(text))</code> so changing the model never reuses old vectors.', 'In <code class="i">embed_many(texts)</code>, look up all keys, collect misses, deduplicate them, and call the fake API in batches of at most 64.', 'Return vectors in the original order.', 'Run night 1 (1,000 chunks), then night 2 where 50 chunks changed and 20 are duplicates of others.', 'Print API calls, texts sent and cache hit rate for each night.'],
    checks: ['Night 2 sends only the changed, unique texts.', 'Output order matches input order.', 'Switching the model name causes a full re-embed.'],
    hints: ['A dict from key to first position helps deduplicate misses.', '<code class="i">range(0, len(misses), 64)</code> gives batch boundaries.'],
    starter: String.raw`import hashlib, random
calls = {"n": 0, "texts": 0}

def fake_api(model, batch):
    assert len(batch) <= 64, "provider limit is 64 inputs per call"
    calls["n"] += 1; calls["texts"] += len(batch)
    return [[hash((model, t)) % 997 / 997.0] * 4 for t in batch]

class EmbeddingService:
    def __init__(self, model):
        self.model, self.cache = model, {}
    def embed_many(self, texts):
        # TODO
        return [fake_api(self.model, [t])[0] for t in texts]

random.seed(1)
chunks = [f"chunk {i}: " + "text " * random.randint(5, 30) for i in range(1000)]
svc = EmbeddingService("embed-v3")
svc.embed_many(chunks); print("night 1:", calls)`,
    solution: String.raw`import hashlib, random
calls = {"n": 0, "texts": 0}

def fake_api(model, batch):
    assert len(batch) <= 64, "provider limit is 64 inputs per call"
    calls["n"] += 1; calls["texts"] += len(batch)
    return [[hash((model, t)) % 997 / 997.0] * 4 for t in batch]

class EmbeddingService:
    def __init__(self, model, batch_size=64):
        self.model, self.batch_size, self.cache = model, batch_size, {}
        self.hits = self.lookups = 0

    def key(self, text):
        return (self.model, hashlib.sha256(text.encode()).hexdigest())

    def embed_many(self, texts):
        keys = [self.key(t) for t in texts]
        self.lookups += len(keys)
        todo = {}                                        # key -> text, unique misses in first-seen order
        for k, t in zip(keys, texts):
            if k in self.cache:
                self.hits += 1
            else:
                todo.setdefault(k, t)
        items = list(todo.items())
        for i in range(0, len(items), self.batch_size):
            batch = items[i:i + self.batch_size]
            for (k, _), vec in zip(batch, fake_api(self.model, [t for _, t in batch])):
                self.cache[k] = vec
        return [self.cache[k] for k in keys]

def night(label, svc, texts):
    before = dict(calls); h0, l0 = svc.hits, svc.lookups
    out = svc.embed_many(texts)
    assert out[5] == svc.cache[svc.key(texts[5])]
    print(f"{label:<22} api_calls={calls['n'] - before['n']:>3} texts_sent={calls['texts'] - before['texts']:>5} "
          f"hit_rate={(svc.hits - h0) / (svc.lookups - l0):.0%}")

random.seed(1)
chunks = [f"chunk {i}: " + "text " * random.randint(5, 30) for i in range(1000)]
svc = EmbeddingService("embed-v3")
night("night 1", svc, chunks)
night2 = list(chunks)
for i in random.sample(range(1000), 50):
    night2[i] = night2[i] + " (edited)"
for i in range(20):
    night2[900 + i] = night2[100 + i]                  # duplicates of existing chunks
night("night 2 (50 changed)", svc, night2)
night("new model embed-v4", EmbeddingService("embed-v4"), night2)`
  },
  design: {
    lead: '<p>Embeddings are a derived dataset. Treat them like any other: versioned, reproducible, cached, and re-computable when the model changes.</p>',
    scale: [{ h: 'Throughput', p: 'Embedding millions of chunks is a batch workload: large batches, bounded concurrency, retries, and the provider’s batch API or your own GPU workers.' }, { h: 'Model migrations', p: 'Build the new index alongside the old one, evaluate, then switch queries over; never mix vectors from two models in one index.' }],
    fail: [{ h: 'Query and document mismatch', p: 'Forgetting the query prefix or input type for asymmetric models quietly lowers recall.' }, { h: 'Unnormalised vectors with dot product', p: 'Long documents with large norms dominate results. Normalise, or use cosine distance consistently.' }],
    trade: [{ h: 'Hosted API vs self-hosted model', p: 'APIs are easy and strong but send data out and bill per token; self-hosted models keep data in and cost GPU time and operations.' }, { h: 'Dimensions', p: 'More dimensions often help slightly but cost memory and latency; models trained for truncation let you choose per index.' }],
    prompt: '<p>Plan the embedding layer for 50 million chunks across 300 tenants, with a model upgrade expected next year.</p>',
    answer: '<ul><li>Index named by model and dimension; tenant id in payload or separate collections by size tier.</li><li>Content-hash cache so nightly changes cost little.</li><li>int8 or binary quantised storage with full-precision rescoring of top candidates.</li><li>Upgrade: dual-write new vectors in a background job, evaluate recall per tenant, flip traffic, keep old index for rollback.</li></ul>'
  },
  quiz: [
    { q: 'You upgraded the embedding model but only re-embedded new documents. What happens?', o: ['Nothing, vectors are compatible', 'Old and new vectors live in different spaces, so search quality collapses for mixed data', 'Search gets faster', 'Only the cache breaks'], a: 1, why: 'Vectors from different models are not comparable.' },
    { q: 'With normalised vectors, cosine similarity equals:', o: ['Euclidean distance', 'The dot product', 'Hamming distance', 'BM25'], a: 1, why: 'Cosine is the dot product divided by the norms, which are 1.' },
    { q: 'Why rescore binary-quantised results with float vectors?', o: ['To encrypt them', 'Binary search is a cheap first pass; rescoring the top candidates recovers most of the lost recall', 'Binary vectors cannot be stored', 'For ACLs'], a: 1, why: 'Fast approximate pass, precise second pass on a short list.' }
  ],
  interview: [
    { q: 'How do you choose an embedding model for a customer?', a: '<p>Shortlist from public benchmarks and constraints (languages, data residency, cost, latency, dimension), then build 100 to 300 labelled queries from their real data and compare recall@k and MRR across the shortlist. Domain fit often matters more than leaderboard rank. Also consider whether the model supports query and document modes and dimension truncation.</p>' },
    { q: 'How would you cut the memory of a 100-million-vector index?', a: '<p>Quantise: int8 roughly 4x smaller, binary 32x smaller, using the quantised index for a candidate pass and rescoring with full-precision vectors kept on disk. Use fewer dimensions if the model supports truncation. Measure recall on a labelled set at each step.</p>' }
  ]
});

/* ===================================================================== 4.4 */
L({
  id: '4.4', title: 'Vector DBs: pgvector, Qdrant', minutes: 55, roles: ['be', 'fde'],
  tags: 'pgvector · HNSW · IVF · distance operators · filters · Qdrant · payload indexes · recall vs latency',
  mental: 'A vector database stores vectors with metadata and answers “nearest k to this vector, where these conditions hold” fast, using an approximate index such as HNSW. Start with pgvector if you already run Postgres; reach for a dedicated engine like Qdrant when scale, filtering or operations demand it.',
  intro: `<p>Brute-force search (lesson 4.3) checks every vector. At millions of vectors and hundreds of queries per second that is too slow, so vector databases build approximate nearest neighbour (ANN) indexes that check a small fraction of vectors and still find most of the true nearest neighbours.</p>
  <p>This lesson uses two engines that cover most 2026 deployments: <b>pgvector</b>, the Postgres extension, which keeps vectors next to your relational data with transactions and SQL filters; and <b>Qdrant</b>, a dedicated vector engine with rich payload filtering, quantisation and horizontal scaling.</p>`,
  points: [
    'pgvector adds a <code class="i">vector(n)</code> type and distance operators: <code class="i">&lt;-&gt;</code> L2, <code class="i">&lt;=&gt;</code> cosine distance, <code class="i">&lt;#&gt;</code> negative inner product.',
    'HNSW indexes (graph-based) give the best speed and recall trade-off in most cases; IVFFlat is smaller and faster to build but needs training on existing data.',
    'Query-time knobs trade recall for speed: <code class="i">hnsw.ef_search</code> in pgvector, <code class="i">hnsw_ef</code> in Qdrant.',
    'Filtering matters: a filter applied after ANN search can return fewer than k results; engines offer filtered or iterative search to handle it.',
    'Qdrant stores a JSON payload per point; index the payload fields you filter on (tenant, ACL group, date).',
    'Measure recall@k of the ANN index against exact search on your data, not just latency.'
  ],
  concept: { title: 'Approximate, on purpose', body: `<p>An ANN index gives up a little recall for a lot of speed. HNSW builds a multi-layer graph where each vector links to its near neighbours; a search walks the graph greedily from an entry point towards the query, visiting a few hundred nodes instead of millions. The knobs decide how many neighbours each node keeps (build time, memory) and how wide the search is (query time, recall). You tune them by measuring recall against exact search.</p>` },
  walk: [
    { h: 'pgvector in three statements', body: '<p>Create the column, index it, query with a filter.</p>', lang: 'sql', file: 'pgvector.sql', code: String.raw`CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE chunks (id bigserial PRIMARY KEY, tenant text, body text, embedding vector(1024));
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
SELECT id, body, embedding <=> $1 AS distance
FROM chunks WHERE tenant = $2
ORDER BY embedding <=> $1 LIMIT 10;` },
    { h: 'Qdrant with a payload filter', body: '<p>The Python client also runs fully in memory for tests, which the Code tab uses.</p>', code: String.raw`from qdrant_client import QdrantClient, models
client = QdrantClient(url="http://localhost:6333")
client.create_collection("chunks", vectors_config=models.VectorParams(size=1024, distance=models.Distance.COSINE))
client.create_payload_index("chunks", field_name="tenant", field_schema="keyword")
hits = client.query_points("chunks", query=qvec, limit=10,
    query_filter=models.Filter(must=[models.FieldCondition(key="tenant", match=models.MatchValue(value="acme"))])).points` },
    { h: 'Choose the engine', body: `<div class="tbl"><table><thead><tr><th>need</th><th>lean towards</th></tr></thead><tbody>
      <tr><td>already on Postgres, up to tens of millions of vectors, SQL joins and transactions</td><td>pgvector</td></tr>
      <tr><td>hundreds of millions of vectors, heavy filtering, quantisation and sharding built in</td><td>Qdrant, Milvus, Weaviate, or managed services</td></tr>
      <tr><td>search plus keyword plus analytics in one place</td><td>Elasticsearch or OpenSearch with vectors</td></tr>
      <tr><td>embedded or serverless, files in object storage</td><td>LanceDB, turbopuffer and similar</td></tr></tbody></table></div>` }
  ],
  analogy: `<p><b>Finding a friend at a festival.</b> Checking every person (brute force) works for a dinner party, not for 100,000 people. Instead you ask someone near the entrance which direction your friend’s group went, then ask someone there, and so on, getting closer with each hop. You might end up next to their cousin instead, which is the small recall you trade for not searching the whole crowd.</p>`,
  diagram: {
    title: 'Filtered vector search',
    cols: [['q'], ['plan'], ['hnsw', 'filter'], ['cand'], ['res']],
    nodes: [
      { id: 'q', label: 'Query vector', sub: '+ tenant, acl', tone: 'fde', info: 'The embedded query and the caller’s filters.' },
      { id: 'plan', label: 'Planner', sub: 'filter strategy', tone: 'acc', info: 'Chooses filtered graph search, pre-filter scan, or iterative search depending on how selective the filter is.' },
      { id: 'hnsw', label: 'HNSW graph', sub: 'ef_search', tone: 'be', info: 'Greedy walk over a neighbour graph; ef controls breadth.' },
      { id: 'filter', label: 'Payload index', sub: 'tenant · acl · date', info: 'B-tree or keyword index on metadata.' },
      { id: 'cand', label: 'Candidates', sub: 'pass filter', info: 'Only vectors that satisfy the filter are kept.' },
      { id: 'res', label: 'Top-k', sub: 'id · score · payload', tone: 'ok', info: 'Results with scores and metadata for fusion and citations.' }
    ],
    edges: [{ a: 'q', b: 'plan', step: 1 }, { a: 'plan', b: 'hnsw', step: 2 }, { a: 'plan', b: 'filter', step: 2 }, { a: 'hnsw', b: 'cand', step: 3 }, { a: 'filter', b: 'cand', step: 3 }, { a: 'cand', b: 'res', step: 4 }],
    steps: ['The query arrives with a vector and filters.', 'The engine picks a strategy based on filter selectivity.', 'Graph search and metadata index combine to produce candidates that pass the filter.', 'The best k are returned with payloads.'],
    caption: 'Filters and ANN search must cooperate, or you get fewer than k results.'
  },
  illustrated: { title: 'The post-filter trap', body: `<p>An index of 1 million chunks, tenant “initech” owns 0.5% of them. Query: top 10 for initech.</p>
    <div class="tbl"><table><thead><tr><th>approach</th><th>what happens</th></tr></thead><tbody>
    <tr><td>ANN top 10, then filter by tenant</td><td>on average 0.05 of the 10 belong to initech: almost always an empty result</td></tr>
    <tr><td>ANN top 1,000, then filter</td><td>about 5 results, slower, still incomplete</td></tr>
    <tr><td>filtered search inside the index (Qdrant filtered search, pgvector 0.8+ iterative scans)</td><td>10 results from initech only</td></tr>
    <tr><td>separate collection or partition per large tenant</td><td>10 results, and isolation is structural</td></tr></tbody></table></div>` },
  code: {
    title: 'pgvector: HNSW index, distance operators and filters', file: 'pgvector_demo.sql', lang: 'sql', pg: true,
    intro: '<p>Runs against Postgres 16 with pgvector. Tiny 3-dimension vectors keep the output readable; the statements are the same at 1,024 dimensions. Disabling sequential scans forces the planner to show the HNSW index plan on this small table.</p>',
    src: String.raw`SET search_path = lab, public;
SELECT extversion AS pgvector_version FROM pg_extension WHERE extname = 'vector';

CREATE TABLE chunks (
  id        bigserial PRIMARY KEY,
  tenant    text NOT NULL,
  doc_id    text NOT NULL,
  body      text NOT NULL,
  embedding vector(3) NOT NULL
);
INSERT INTO chunks (tenant, doc_id, body, embedding) VALUES
 ('acme',   'refund-policy', 'Duplicate charges are refunded within 5 days.', '[0.9, 0.1, 0.0]'),
 ('acme',   'money-back',    'Request your money back from Billing.',          '[0.8, 0.3, 0.1]'),
 ('acme',   'sso-setup',     'Sign in with SAML through Okta.',                '[0.0, 0.2, 0.9]'),
 ('globex', 'refund-policy', 'Globex refunds need manager approval.',          '[0.85, 0.15, 0.05]'),
 ('globex', 'api-limits',    '600 requests per minute per workspace.',         '[0.1, 0.9, 0.2]');

CREATE INDEX chunks_hnsw ON chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX chunks_tenant ON chunks (tenant);

-- the three distance operators for one query vector ("how do refunds work?")
SELECT doc_id, tenant,
       round((embedding <-> '[0.88, 0.2, 0.05]')::numeric, 3) AS l2,
       round((embedding <=> '[0.88, 0.2, 0.05]')::numeric, 3) AS cosine_dist,
       round((embedding <#> '[0.88, 0.2, 0.05]')::numeric, 3) AS neg_inner
FROM chunks ORDER BY embedding <=> '[0.88, 0.2, 0.05]' LIMIT 3;

-- tenant-scoped search: only acme's chunks may come back
SELECT doc_id, round((1 - (embedding <=> '[0.88, 0.2, 0.05]'))::numeric, 3) AS cosine_sim
FROM chunks WHERE tenant = 'acme'
ORDER BY embedding <=> '[0.88, 0.2, 0.05]' LIMIT 2;

-- query-time recall/speed knob, and the index plan
SET hnsw.ef_search = 100;
SET enable_seqscan = off;
EXPLAIN (COSTS OFF) SELECT id FROM chunks ORDER BY embedding <=> '[0.88, 0.2, 0.05]' LIMIT 3;`,
    more: [{ note: '<b>Qdrant, in memory.</b> The same search with a payload filter and a payload index, using the real client in local mode (no server needed). Vectors come from the toy embedding model of lesson 4.3.', file: 'qdrant_demo.py', key: 'qdrant', src: CORPUS + EMB + String.raw`
import warnings
from qdrant_client import QdrantClient, models
warnings.filterwarnings("ignore", message=".*(Payload indexes|Local mode).*")   # local mode ignores these settings

client = QdrantClient(":memory:")                       # same API as a server at url="http://..."
client.create_collection("help", vectors_config=models.VectorParams(size=256, distance=models.Distance.COSINE))
client.create_payload_index("help", field_name="tenant", field_schema=models.PayloadSchemaType.KEYWORD)
points = []
for i, d in enumerate(DOCS):
    for tenant in ("acme", "globex"):
        points.append(models.PointStruct(id=len(points), vector=embed(d["title"] + ". " + d["text"]).tolist(),
                                         payload={"tenant": tenant, "doc_id": d["id"], "title": d["title"]}))
client.upsert("help", points=points)
print("points:", client.count("help").count)

q = "I was charged twice, when do I get the money back?"
only_acme = models.Filter(must=[models.FieldCondition(key="tenant", match=models.MatchValue(value="acme"))])
hits = client.query_points("help", query=embed(q).tolist(), query_filter=only_acme, limit=3,
                           search_params=models.SearchParams(hnsw_ef=128)).points
for h in hits:
    print(f"  {h.score:.3f} {h.payload['tenant']:<6} {h.payload['doc_id']}")` }]
  },
  lab: {
    title: 'Build an IVF index and tune nprobe', file: 'ivf_lab.py', browser: true,
    scenario: `<p>Before trusting a vector database’s defaults, understand the trade-off it makes. Build an inverted-file (IVF) index, the idea behind pgvector’s IVFFlat: cluster vectors with k-means, assign each to its nearest centroid, and at query time search only the <code class="i">nprobe</code> closest clusters. Measure recall@10 and the fraction of vectors scanned as nprobe grows.</p>`,
    steps: ['Generate 20,000 normalised vectors in 64 dimensions with cluster structure (seeded).', 'Run a few iterations of k-means with 100 centroids (sample-initialised).', 'Build inverted lists: centroid id to vector ids.', 'For 200 queries, search the nprobe nearest lists exactly and compute recall@10 against brute force.', 'Print recall and the share of vectors scanned for nprobe in 1, 2, 5, 10, 20.'],
    checks: ['Recall rises with nprobe and approaches 1.0.', 'Vectors scanned grow roughly linearly with nprobe.', 'You can name the nprobe that gives at least 0.95 recall.'],
    hints: ['Assign with <code class="i">argmax(X @ C.T)</code> when vectors and centroids are normalised.', 'Re-normalise centroids after each k-means update.'],
    starter: String.raw`import numpy as np
rng = np.random.default_rng(3)
N, D, K = 20_000, 64, 100
centers = rng.normal(size=(40, D))
X = centers[rng.integers(0, 40, N)] + 0.8 * rng.normal(size=(N, D))
X /= np.linalg.norm(X, axis=1, keepdims=True)
Q = X[rng.choice(N, 200, replace=False)] + 0.1 * rng.normal(size=(200, D)); Q /= np.linalg.norm(Q, axis=1, keepdims=True)
exact = np.argsort(-(Q @ X.T), axis=1)[:, :10]

# TODO: k-means, inverted lists, search with nprobe, recall table
`,
    solution: String.raw`import numpy as np
rng = np.random.default_rng(3)
N, D, K = 20_000, 64, 100
centers = rng.normal(size=(40, D))
X = centers[rng.integers(0, 40, N)] + 0.8 * rng.normal(size=(N, D))
X /= np.linalg.norm(X, axis=1, keepdims=True)
Q = X[rng.choice(N, 200, replace=False)] + 0.1 * rng.normal(size=(200, D)); Q /= np.linalg.norm(Q, axis=1, keepdims=True)
exact = np.argsort(-(Q @ X.T), axis=1)[:, :10]

C = X[rng.choice(N, K, replace=False)].copy()
for _ in range(8):                                     # spherical k-means
    assign = np.argmax(X @ C.T, axis=1)
    for k in range(K):
        members = X[assign == k]
        if len(members):
            c = members.mean(0); C[k] = c / np.linalg.norm(c)
assign = np.argmax(X @ C.T, axis=1)
lists = [np.where(assign == k)[0] for k in range(K)]
print("list sizes: min", min(map(len, lists)), "max", max(map(len, lists)))

def search(q, nprobe):
    probe = np.argsort(-(C @ q))[:nprobe]
    ids = np.concatenate([lists[k] for k in probe])
    return ids[np.argsort(-(X[ids] @ q))[:10]], len(ids)

print(f"{'nprobe':>6} {'recall@10':>10} {'scanned':>8}")
for nprobe in (1, 2, 5, 10, 20):
    rec, scanned = [], []
    for q, e in zip(Q, exact):
        top, n = search(q, nprobe)
        rec.append(len(set(top) & set(e)) / 10); scanned.append(n)
    print(f"{nprobe:>6} {np.mean(rec):>10.3f} {np.mean(scanned) / N:>8.1%}")`
  },
  design: {
    lead: '<p>The vector store is a stateful, memory-hungry service on the hot path of every RAG request. Size it, isolate tenants, plan re-indexing, and monitor recall as well as latency.</p>',
    scale: [{ h: 'Memory first', p: 'HNSW wants the graph and vectors in RAM for low latency. Estimate vectors × dimensions × bytes plus graph links (roughly m × 2 × 4 bytes per vector per layer) and quantise when it does not fit.' }, { h: 'Tenancy', p: 'Payload filters for many small tenants; separate collections, partitions or shards for the few large ones.' }],
    fail: [{ h: 'Empty filtered results', p: 'Selective filters with post-filtering return fewer than k. Use filtered or iterative search and test with your smallest tenant.' }, { h: 'Index build stalls', p: 'Building HNSW over tens of millions of vectors takes hours and lots of memory. Build offline, or use bulk-load modes, and swap atomically.' }],
    trade: [{ h: 'pgvector vs dedicated engine', p: 'pgvector: one database, transactions, joins, familiar operations. Dedicated engines: better scaling, quantisation and filtering features, one more system to run.' }, { h: 'HNSW vs IVF', p: 'HNSW: better recall and latency, more memory, slower builds. IVF: compact and quick to build, needs retraining as data drifts.' }],
    prompt: '<p>Design vector search for 400 million chunks, 2,000 tenants (a few very large), p95 under 100 ms at 500 QPS.</p>',
    answer: '<ul><li>Dedicated engine with sharding; large tenants on their own shards or collections, small tenants share with a tenant filter and payload index.</li><li>int8 or binary quantised vectors in RAM, full vectors on disk for rescoring.</li><li>Tune ef for recall ≥ 0.95 against exact search on sampled queries per tier.</li><li>Replicas for QPS; blue-green index rebuilds; dashboards for p95, recall probes and empty-result rates.</li></ul>'
  },
  quiz: [
    { q: 'In pgvector, which operator is cosine distance?', o: ['<->', '<=>', '<#>', '@@'], a: 1, why: '<-> is L2, <=> cosine distance, <#> negative inner product.' },
    { q: 'Raising hnsw.ef_search usually:', o: ['Lowers recall and latency', 'Raises recall and latency', 'Changes the stored vectors', 'Rebuilds the index'], a: 1, why: 'A wider search visits more nodes: better recall, slower.' },
    { q: 'Why can "ANN top 10, then filter by tenant" return nothing?', o: ['Filters are unsupported', 'The 10 nearest overall may all belong to other tenants', 'Vectors are encrypted', 'ef is too high'], a: 1, why: 'Post-filtering after a small top-k loses results for small tenants.' }
  ],
  interview: [
    { q: 'pgvector or a dedicated vector database for a new customer project?', a: '<p>If they already run Postgres and the corpus is up to tens of millions of chunks, pgvector: one system, SQL filters and joins, transactions with the source data, and familiar backups. I move to a dedicated engine when scale, filtering performance, quantisation needs or tenant isolation outgrow it, and I would decide with a benchmark on their data rather than by default.</p>' },
    { q: 'How does HNSW work and what do you tune?', a: '<p>It builds a layered proximity graph: each vector links to a few near neighbours, with sparse upper layers for long jumps. A search starts at the top, greedily moves towards the query and descends layers, keeping a candidate list of size ef. Build-time m and ef_construction set graph quality and memory; query-time ef sets recall versus latency, tuned against exact search.</p>' }
  ]
});
})();

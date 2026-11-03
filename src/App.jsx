import React, { useState, useEffect, useMemo, useRef } from "react";

/* ============================================================
   Testbench — a daily driver for test engineers
   Queue · Review · Cases · Flaky · Bench · Bug
   State persists via window.storage under one key.
   ============================================================ */

const STORAGE_KEY = "testbench:state";

const EMPTY = { queue: [], flaky: [], bug: null, theme: "dark" };

const KINDS = ["Test", "Bug", "Pipeline", "Review", "Admin"];
const PRIORITIES = ["P1", "P2", "P3"];
const STATUSES = ["open", "doing", "blocked", "done"];

const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------- storage ---------- */

async function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...EMPTY, ...JSON.parse(raw) };
  } catch (e) {
    /* first run, or storage blocked */
  }
  return EMPTY;
}

async function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- model helpers ---------- */

function flakeRate(t) {
  if (!t.runs.length) return 0;
  const fails = t.runs.filter((r) => r === "fail").length;
  return fails / t.runs.length;
}

function verdict(t) {
  const r = flakeRate(t);
  if (!t.runs.length) return { label: "no runs", tone: "idle" };
  if (r === 0) return { label: "stable", tone: "pass" };
  if (r === 1) return { label: "always failing", tone: "fail" };
  if (r >= 0.25) return { label: "flaky", tone: "flaky" };
  return { label: "mostly green", tone: "pass" };
}

/* ---------- test data generators ---------- */

function checkDigit(body) {
  let sum = 0;
  const rev = body.split("").reverse();
  for (let i = 0; i < rev.length; i++) {
    let d = parseInt(rev[i], 10);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return String((10 - (sum % 10)) % 10);
}

function digits(n) {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function card(brand) {
  const spec = {
    visa: { prefix: "4", len: 16 },
    mastercard: { prefix: String(51 + Math.floor(Math.random() * 5)), len: 16 },
    amex: { prefix: Math.random() < 0.5 ? "34" : "37", len: 15 },
  }[brand];
  const body = spec.prefix + digits(spec.len - spec.prefix.length - 1);
  return body + checkDigit(body);
}

function group(num) {
  return num.length === 15
    ? `${num.slice(0, 4)} ${num.slice(4, 10)} ${num.slice(10)}`
    : num.replace(/(.{4})/g, "$1 ").trim();
}

function msisdn(country) {
  if (country === "KE") return "+2547" + digits(8);
  if (country === "ZA") return "+2782" + digits(7);
  if (country === "GB") return "+447" + digits(9);
  return "+1" + digits(10);
}

function uuid4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function idemKey() {
  return "idem_" + Date.now().toString(36) + "_" + uid();
}

function amount() {
  const v = (Math.random() * 5000 + 1).toFixed(2);
  return v;
}

function tagEmail() {
  return `qa+${Date.now().toString(36)}@example.test`;
}

/* ---------- cron reader ---------- */

const CRON_FIELDS = [
  { name: "minute", plural: "minutes" },
  { name: "hour", plural: "hours" },
  { name: "day of the month", plural: "days" },
  { name: "month", plural: "months" },
  { name: "day of the week", plural: "days" },
];

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function nameFor(idx, v) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return v;
  if (idx === 4 && n >= 0 && n <= 7) return DOW[n];
  if (idx === 3 && n >= 1 && n <= 12) return MONTHS[n];
  return v;
}

function describeField(expr, idx) {
  const f = CRON_FIELDS[idx];
  if (expr === "*") return `every ${f.name}`;
  if (expr.startsWith("*/")) {
    const n = expr.slice(2);
    return `every ${n} ${f.plural}`;
  }
  if (expr.includes(",")) {
    return `${f.name} ${expr.split(",").map((v) => nameFor(idx, v.trim())).join(", ")}`;
  }
  if (expr.includes("-")) {
    const [a, b] = expr.split("-");
    return `${f.name} ${nameFor(idx, a)} through ${nameFor(idx, b)}`;
  }
  return `${f.name} ${nameFor(idx, expr)}`;
}

function readCron(line) {
  const parts = line.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { error: `A cron schedule needs 5 fields. This one has ${parts.filter(Boolean).length}.` };
  }
  return { parts: parts.map((p, i) => ({ expr: p, text: describeField(p, i), label: CRON_FIELDS[i].name })) };
}

const CRON_PRESETS = [
  { expr: "*/15 * * * *", use: "Smoke suite on a quarter-hour loop" },
  { expr: "0 2 * * *", use: "Full regression overnight" },
  { expr: "0 6 * * 1-5", use: "Weekday morning health check" },
  { expr: "0 */4 * * *", use: "Integration suite every four hours" },
  { expr: "30 23 * * 0", use: "Weekly performance run" },
];

/* ============================================================
   UI atoms
   ============================================================ */

function Copy({ text, small }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={small ? "btn btn-ghost btn-sm" : "btn btn-ghost"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch (e) {
          setDone(false);
        }
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function Empty({ children }) {
  return <p className="empty">{children}</p>;
}

/* ============================================================
   Module: Queue
   ============================================================ */

function Queue({ state, set }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("Test");
  const [priority, setPriority] = useState("P2");
  const [ref, setRef] = useState("");
  const [filter, setFilter] = useState("active");

  const add = () => {
    if (!title.trim()) return;
    set({
      ...state,
      queue: [
        { id: uid(), title: title.trim(), kind, priority, ref: ref.trim(), status: "open", note: "", created: Date.now() },
        ...state.queue,
      ],
    });
    setTitle("");
    setRef("");
  };

  const update = (id, patch) =>
    set({ ...state, queue: state.queue.map((t) => (t.id === id ? { ...t, ...patch } : t)) });

  const remove = (id) => set({ ...state, queue: state.queue.filter((t) => t.id !== id) });

  const shown = state.queue
    .filter((t) => (filter === "active" ? t.status !== "done" : filter === "done" ? t.status === "done" : true))
    .sort((a, b) => a.priority.localeCompare(b.priority) || b.created - a.created);

  return (
    <div>
      <h2 className="h2">Queue</h2>
      <p className="sub">What you owe today. Priority sorts the list; blocked items keep a note of what they're waiting on.</p>

      <div className="add-row">
        <input
          className="input grow"
          placeholder="Add a task — e.g. rerun M-Pesa callback suite against staging"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <input className="input narrow mono" placeholder="Ticket" value={ref} onChange={(e) => setRef(e.target.value)} />
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Task type">
          {KINDS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={add}>
          Add task
        </button>
      </div>

      <div className="filters">
        {["active", "done", "all"].map((f) => (
          <button key={f} className={"chip" + (filter === f ? " chip-on" : "")} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty>Nothing here yet. Add the first thing you need to get through today.</Empty>
      ) : (
        <ul className="list">
          {shown.map((t) => (
            <li key={t.id} className={"item status-" + t.status}>
              <div className="item-head">
                <span className={"pri pri-" + t.priority}>{t.priority}</span>
                <span className={"title" + (t.status === "done" ? " struck" : "")}>{t.title}</span>
                {t.ref && <span className="mono ticket">{t.ref}</span>}
                <span className="kind">{t.kind}</span>
              </div>
              <div className="item-foot">
                <select className="select select-sm" value={t.status} onChange={(e) => update(t.id, { status: e.target.value })} aria-label="Status">
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                {t.status === "blocked" && (
                  <input
                    className="input input-sm grow"
                    placeholder="Waiting on what?"
                    value={t.note}
                    onChange={(e) => update(t.id, { note: e.target.value })}
                  />
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => remove(t.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ============================================================
   Module: Review — static rules, no model involved
   ============================================================ */

const SEV_ORDER = { blocker: 0, major: 1, minor: 2, nit: 3 };

const RULES = {
  "Test automation": [
    { id: "fixed-wait", severity: "blocker", title: "Fixed wait instead of a condition",
      detail: "Wait on the state you need — element visible, request settled, spinner gone — not on the clock. Fixed sleeps are the single biggest source of flake.",
      re: /(thread\.sleep\s*\(|time\.sleep\s*\(|waitfortimeout\s*\(|\bsleep\s*\(\s*\d|implicitly_wait|setTimeout\s*\([^,]*,\s*\d{3,})/i },
    { id: "hardcoded-secret", severity: "blocker", title: "Credential hardcoded in the suite",
      detail: "Move it to an environment variable or a secret store. Anything committed here is committed forever.",
      re: /(password|passwd|secret|api[_-]?key|token|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*["'][^"']{4,}["']/i,
      exclude: /(process\.env|os\.environ|getenv|config\.|vault|\$\{|<%=|System\.getenv)/i },
    { id: "test-only", severity: "blocker", title: "Focused test left in the suite",
      detail: "A .only silently skips every other test in the file. The suite goes green while covering almost nothing.",
      re: /(\.only\s*\(|fdescribe\s*\(|fit\s*\()/ },
    { id: "conditional-test", severity: "major", title: "Branching logic inside a test",
      detail: "An if or a try in the test body means two tests share one name and one result. Split them so a failure tells you which path broke.",
      re: /^\s*(if\s*\(|else\b|switch\s*\(|try\s*\{|except\b|catch\s*\()/ },
    { id: "swallowed-error", severity: "major", title: "Exception caught and discarded",
      detail: "Swallowing the error turns a real defect into a pass. Let it propagate, or assert on it.",
      re: /(catch\s*\([^)]*\)\s*\{\s*\}|except[^:]*:\s*pass\b|catch\s*\{\s*\}|rescue\s*(=>\s*)?\{\s*\})/i },
    { id: "absolute-xpath", severity: "major", title: "Positional or absolute selector",
      detail: "This breaks the next time anyone touches the markup. Anchor on a test id, a role, or visible text instead.",
      re: /(["'`]\/html|["'`]\/\/\w+(\[\d+\])?\/|nth-child\(|\/div\[\d+\]|\[\d+\]\/)/i },
    { id: "retry-masking", severity: "major", title: "Retries configured on the test",
      detail: "Retries hide the failure rather than explaining it. Track the test in Flaky and fix the cause before allowing a rerun.",
      re: /(\bretries?\s*[:=]\s*[1-9]|@retry|@flaky|reruns\s*=|retryanalyzer|retry_on_failure)/i },
    { id: "skipped-test", severity: "minor", title: "Test disabled",
      detail: "A skip with no ticket reference becomes permanent. Link it to a defect or delete it.",
      re: /(\.skip\s*\(|\bxit\s*\(|xdescribe\s*\(|@ignore\b|@disabled\b|@pytest\.mark\.skip|t\.skip\s*\()/i },
    { id: "unseeded-random", severity: "minor", title: "Unseeded random data",
      detail: "A failure you can't reproduce is a failure you can't fix. Seed the generator and log the seed.",
      re: /(math\.random\s*\(|random\.(randint|choice|random)\s*\(|faker\.|uuid4\s*\(|new Random\s*\(\s*\))/i },
    { id: "env-url", severity: "minor", title: "Environment URL in the code",
      detail: "Pull the base URL from configuration so the same suite runs against every environment.",
      re: /["'`]https?:\/\/(?!localhost|127\.0\.0\.1|example\.)[\w.-]+/i },
    { id: "debug-output", severity: "nit", title: "Debug output left behind",
      detail: "Use the framework's reporter so the output lands in the test report rather than the console.",
      re: /^\s*(console\.log\s*\(|print\s*\(|System\.out\.print|puts\s+|fmt\.Print)/ },
  ],

  "Pipeline config": [
    { id: "plain-secret", severity: "blocker", title: "Secret written in plain text",
      detail: "Move it into the platform's secret store and reference it. A value committed here is exposed to everyone with repository read access.",
      re: /(password|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\b\s*[:=]\s*["']?[\w\-\/+]{8,}/i,
      exclude: /(\$\{?\{?|secrets\.|vault|\$CI_|\$\{env|masked|<%=|from_secret)/i },
    { id: "curl-pipe", severity: "blocker", title: "Script piped straight into a shell",
      detail: "You're executing whatever that URL serves at run time. Pin a version, verify a checksum, or vendor the script.",
      re: /(curl|wget)[^|\n]*\|\s*(sudo\s+)?(ba)?sh/i },
    { id: "floating-version", severity: "major", title: "Unpinned dependency or image",
      detail: "A floating tag means today's green build and tomorrow's red one run different code. Pin to a version or a digest.",
      re: /(:latest\b|@latest\b|@(main|master)\b|image:\s*\w[\w\/.-]*\s*$|FROM\s+\S+\s*$)/i },
    { id: "ignored-failure", severity: "major", title: "Failures allowed to pass",
      detail: "This stage can never fail the pipeline, so nobody will notice when it does. Either enforce it or remove it.",
      re: /(allow_failure:\s*true|continue-on-error:\s*true|\|\|\s*true\b|set\s+\+e\b|--exit-zero)/i },
    { id: "no-timeout", severity: "minor", title: "No timeout on the job",
      detail: "A hung job holds a runner until the platform default expires, often an hour. Set an explicit timeout.",
      re: /^\s*(script|run|steps|commands)\s*:/i, fileScoped: true,
      absent: /(timeout|timeout-minutes|time_limit)/i },
    { id: "no-cache", severity: "minor", title: "Dependency install without a cache",
      detail: "Caching the dependency directory usually takes minutes off every run for a few lines of config.",
      re: /\b(npm (ci|install)|yarn install|pip install|bundle install|mvn .*install)\b/i, fileScoped: true,
      absent: /\bcache\b/i },
    { id: "no-artifacts", severity: "minor", title: "Test stage without artifact capture",
      detail: "When this fails at 2am you'll want the report, the screenshots, and the logs. Publish them on failure.",
      re: /\b(pytest|jest|playwright|cypress|mvn test|gradle test|npm test)\b/i, fileScoped: true,
      absent: /(artifacts|upload-artifact|reports|junit)/i },
    { id: "no-expiry", severity: "nit", title: "Artifacts kept indefinitely",
      detail: "Set an expiry. Storage costs accumulate quietly across every branch and every run.",
      re: /^\s*artifacts\s*:/i, fileScoped: true, absent: /expire_in|retention-days/i },
  ],

  "Application code": [
    { id: "hardcoded-secret-app", severity: "blocker", title: "Credential in source",
      detail: "Read it from the environment or a secret manager. Rotate this value — it's in your history now.",
      re: /(password|secret|api[_-]?key|token|private[_-]?key|connection[_-]?string)\b\s*[:=]\s*["'][^"']{6,}["']/i,
      exclude: /(process\.env|os\.environ|getenv|System\.getenv|\$\{|config\.)/i },
    { id: "eval", severity: "blocker", title: "Dynamic code execution",
      detail: "If any part of that string reaches user input you have remote code execution. Parse it explicitly instead.",
      re: /\b(eval\s*\(|new Function\s*\(|exec\s*\(|__import__\s*\()/ },
    { id: "broad-catch", severity: "major", title: "Catch-all exception handler",
      detail: "This hides defects you haven't thought of alongside the one you have. Catch the specific type.",
      re: /(catch\s*\(\s*(Exception|Throwable|Error)\b|except\s*:|except\s+Exception\s*:|rescue\s*=>|catch\s*\(\s*\w+\s*\)\s*\{\s*\})/ },
    { id: "swallowed-error-app", severity: "major", title: "Error caught and discarded",
      detail: "Log it with context or rethrow. Silent failure is the hardest kind to diagnose in production.",
      re: /(catch\s*\([^)]*\)\s*\{\s*\}|except[^:]*:\s*pass\b|\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\))/ },
    { id: "unawaited", severity: "major", title: "Promise created but not awaited",
      detail: "The rejection goes unhandled and the ordering isn't what it looks like. Await it or handle it explicitly.",
      re: /^\s*(?!return|await|void)\w[\w.]*\.(then|catch)\s*\(/ },
    { id: "no-timeout-call", severity: "minor", title: "Network call without a timeout",
      detail: "Set an explicit timeout. Without one a slow dependency becomes your outage.",
      re: /^\s*(await\s+)?(fetch|axios|requests\.(get|post|put|delete)|http\.(get|post)|HttpClient)/i,
      exclude: /(timeout|signal|AbortController|deadline)/i },
    { id: "loose-equality", severity: "minor", title: "Loose equality comparison",
      detail: "Type coercion here produces results that surprise people reading the code. Use strict equality.",
      re: /[^=!<>]==[^=]|!=[^=]/, exclude: /(===|!==|#|\/\/|==\s*null)/ },
    { id: "magic-number", severity: "nit", title: "Unexplained numeric literal",
      detail: "Name it. A constant explains the intent that the number alone doesn't.",
      re: /[^\w.](86400|3600|1440|604800|2592000|65535|255|1024)\b/ },
    { id: "todo", severity: "nit", title: "Unresolved TODO",
      detail: "Link it to a ticket or resolve it, otherwise it stays here indefinitely.",
      re: /\b(TODO|FIXME|HACK|XXX)\b/ },
  ],
};

function analyse(code, lens) {
  const lines = code.split(/\r?\n/);
  const rules = RULES[lens] || [];
  const hits = new Map();

  const isComment = (l) => /^(\/\/|#(?!\s*\w+:)|\*|<!--|--)/.test(l);

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || isComment(line)) return;
    for (const r of rules) {
      if (r.fileScoped) continue;
      if (!r.re.test(line)) continue;
      if (r.exclude && r.exclude.test(line)) continue;
      if (!hits.has(r.id)) hits.set(r.id, { rule: r, lines: [], sample: line.slice(0, 100) });
      hits.get(r.id).lines.push(i + 1);
    }
  });

  // File-scoped rules: a trigger is present somewhere, the mitigation is absent everywhere.
  const whole = lines.filter((l) => !isComment(l.trim())).join("\n");
  for (const r of rules) {
    if (!r.fileScoped) continue;
    const trigger = lines.findIndex((l) => r.re.test(l));
    if (trigger === -1) continue;
    if (r.absent && r.absent.test(whole)) continue;
    hits.set(r.id, { rule: r, lines: [trigger + 1], sample: lines[trigger].trim().slice(0, 100) });
  }

  // Structural: a test declared with nothing asserted in it.
  const TEST_DECL = /(^|\s)(it|test|describe\s*\.\s*each|def test_\w+|@Test|func Test\w+|scenario)\s*[(:]/;
  const ASSERT = /(expect\s*\(|assert|should\b|verify\s*\(|\.to\.|toBe|toEqual|toHaveBeen|assertThat|require\.)/i;
  const noAssert = [];
  lines.forEach((raw, i) => {
    if (!TEST_DECL.test(raw)) return;
    const body = lines.slice(i, Math.min(i + 30, lines.length)).join("\n");
    if (!ASSERT.test(body)) noAssert.push(i + 1);
  });
  if (noAssert.length) {
    hits.set("no-assertion", {
      rule: {
        id: "no-assertion", severity: "blocker", title: "Test with no assertion",
        detail: "This passes as long as nothing throws, which is not the same as the behaviour being correct. Assert on the outcome.",
      },
      lines: noAssert,
      sample: lines[noAssert[0] - 1].trim().slice(0, 100),
    });
  }

  return [...hits.values()]
    .map((h) => ({
      severity: h.rule.severity, title: h.rule.title, detail: h.rule.detail,
      lines: h.lines, locate: h.sample,
    }))
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.lines.length - a.lines.length);
}

function Review() {
  const [code, setCode] = useState("");
  const [lens, setLens] = useState("Test automation");
  const [findings, setFindings] = useState(null);

  const run = () => setFindings(analyse(code, lens));

  const ruleCount = (RULES[lens] || []).length + 1;

  const asMarkdown = () =>
    (findings || [])
      .map((f) => `- **[${f.severity}] ${f.title}** (line${f.lines.length > 1 ? "s" : ""} ${f.lines.join(", ")}) — ${f.detail}`)
      .join("\n");

  return (
    <div>
      <h2 className="h2">Review</h2>
      <p className="sub">
        Paste a test file, a helper, or a pipeline stage. {ruleCount} rules run against it in your browser — nothing is uploaded
        and nothing is sent anywhere.
      </p>

      <div className="lens-row">
        {Object.keys(RULES).map((l) => (
          <button key={l} className={"chip" + (lens === l ? " chip-on" : "")} onClick={() => { setLens(l); setFindings(null); }}>
            {l}
          </button>
        ))}
      </div>

      <textarea
        className="textarea mono"
        rows={12}
        placeholder="Paste code or config here."
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />

      <div className="actions">
        <button className="btn btn-primary" onClick={run} disabled={!code.trim()}>
          Run {ruleCount} checks
        </button>
        {findings && findings.length > 0 && <Copy text={asMarkdown()} />}
        <button className="btn btn-ghost" onClick={() => { setCode(""); setFindings(null); }}>
          Clear
        </button>
      </div>

      {findings && findings.length === 0 && (
        <Empty>Nothing tripped a rule. That's a clean pass on these {ruleCount} checks, not a clean bill of health.</Empty>
      )}

      {findings && findings.length > 0 && (
        <ul className="findings">
          {findings.map((f, i) => (
            <li key={i} className={"finding sev-" + f.severity}>
              <div className="finding-head">
                <span className="sev-tag">{f.severity}</span>
                <span className="finding-title">{f.title}</span>
                <span className="mono finding-lines">
                  line{f.lines.length > 1 ? "s" : ""} {f.lines.slice(0, 8).join(", ")}
                  {f.lines.length > 8 ? ` +${f.lines.length - 8}` : ""}
                </span>
              </div>
              <p className="finding-detail">{f.detail}</p>
              {f.locate && <code className="mono locate">{f.locate}</code>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ============================================================
   Module: Cases — boundary and partition generation
   ============================================================ */

const FIELD_TYPES = ["string", "integer", "decimal", "date", "enum", "boolean"];

const blankField = () => ({ id: uid(), name: "", type: "string", min: "", max: "", values: "", required: true });

function generateCases(op, fields) {
  const conditions = [];
  const cases = [];
  let c = 1;
  let t = 1;

  const addCase = (title, value, field, expected, condId) => {
    cases.push({
      id: "T" + t++,
      title,
      steps: [
        `Set ${field} to ${value}`,
        "Leave every other field at a valid value",
        `Submit ${op || "the request"}`,
      ],
      expected,
      covers: [condId],
    });
  };

  const addCondition = (technique, condition) => {
    const id = "TC" + c++;
    conditions.push({ id, technique, condition });
    return id;
  };

  const num = (v) => (v === "" || v === null ? null : Number(v));

  for (const f of fields) {
    const name = f.name.trim();
    if (!name) continue;

    if (f.required) {
      const id = addCondition("Equivalence partitioning — invalid", `${name} absent`);
      addCase(`${name} omitted`, "nothing (omit the field)", name, "Rejected, with an error naming the missing field", id);
    }

    if (f.type === "string") {
      const lo = num(f.min);
      const hi = num(f.max);
      if (lo !== null) {
        const id = addCondition("Boundary value analysis", `${name} length at the lower bound of ${lo}`);
        if (lo > 0) addCase(`${name} one character below minimum`, `a ${lo - 1}-character value`, name, "Rejected", id);
        addCase(`${name} at minimum length`, `a ${lo}-character value`, name, "Accepted", id);
      }
      if (hi !== null) {
        const id = addCondition("Boundary value analysis", `${name} length at the upper bound of ${hi}`);
        addCase(`${name} at maximum length`, `a ${hi}-character value`, name, "Accepted", id);
        addCase(`${name} one character above maximum`, `a ${hi + 1}-character value`, name, "Rejected", id);
      }
      const idC = addCondition("Error guessing", `${name} contains characters that need escaping`);
      addCase(`${name} with special characters`, `a value containing ' " < > & and a newline`, name, "Accepted and stored intact, or rejected cleanly — never a 500", idC);
    }

    if (f.type === "integer" || f.type === "decimal") {
      const lo = num(f.min);
      const hi = num(f.max);
      const step = f.type === "integer" ? 1 : 0.01;
      if (lo !== null) {
        const id = addCondition("Boundary value analysis", `${name} at the lower bound of ${lo}`);
        addCase(`${name} just below minimum`, String(lo - step), name, "Rejected", id);
        addCase(`${name} at minimum`, String(lo), name, "Accepted", id);
      }
      if (hi !== null) {
        const id = addCondition("Boundary value analysis", `${name} at the upper bound of ${hi}`);
        addCase(`${name} at maximum`, String(hi), name, "Accepted", id);
        addCase(`${name} just above maximum`, String(hi + step), name, "Rejected", id);
      }
      const idT = addCondition("Equivalence partitioning — invalid", `${name} given a non-numeric value`);
      addCase(`${name} non-numeric`, '"abc"', name, "Rejected with a type error, not a server fault", idT);
      if (f.type === "decimal") {
        const idP = addCondition("Error guessing", `${name} with more precision than the field allows`);
        addCase(`${name} excess precision`, "a value with four decimal places", name, "Rounded per the documented rule, or rejected", idP);
      }
    }

    if (f.type === "enum") {
      const vals = f.values.split(",").map((v) => v.trim()).filter(Boolean);
      if (vals.length) {
        const id = addCondition("Equivalence partitioning — valid", `${name} set to each permitted value`);
        vals.forEach((v) => addCase(`${name} = ${v}`, v, name, "Accepted", id));
      }
      const idI = addCondition("Equivalence partitioning — invalid", `${name} outside the permitted set`);
      addCase(`${name} unknown value`, '"NOT_A_VALUE"', name, "Rejected, listing the permitted values", idI);
      const idCase = addCondition("Error guessing", `${name} in the wrong case`);
      addCase(`${name} case mismatch`, vals[0] ? vals[0].toLowerCase() + " (lowercased)" : "a lowercased value", name, "Behaviour matches the documented case sensitivity", idCase);
    }

    if (f.type === "boolean") {
      const id = addCondition("Equivalence partitioning — valid", `${name} true and false`);
      addCase(`${name} true`, "true", name, "Accepted", id);
      addCase(`${name} false`, "false", name, "Accepted", id);
      const idI = addCondition("Equivalence partitioning — invalid", `${name} given a non-boolean`);
      addCase(`${name} non-boolean`, '"maybe"', name, "Rejected, not silently coerced", idI);
    }

    if (f.type === "date") {
      const id = addCondition("Boundary value analysis", `${name} at the edges of the permitted range`);
      if (f.min) addCase(`${name} at earliest permitted`, f.min, name, "Accepted", id);
      if (f.max) addCase(`${name} at latest permitted`, f.max, name, "Accepted", id);
      const idF = addCondition("Equivalence partitioning — invalid", `${name} in a malformed format`);
      addCase(`${name} malformed`, '"31/02/2026"', name, "Rejected with a format error", idF);
      const idL = addCondition("Error guessing", `${name} on a leap day and across a DST change`);
      addCase(`${name} leap day`, "29 February of a leap year", name, "Accepted and stored without shifting", idL);
    }
  }

  if (fields.filter((f) => f.name.trim()).length > 1) {
    const id = addCondition("Pairwise", "Every field simultaneously at its invalid boundary");
    cases.push({
      id: "T" + t++,
      title: "All fields invalid at once",
      steps: ["Set every field to a value just outside its permitted range", `Submit ${op || "the request"}`],
      expected: "Every violation reported in one response, not just the first",
      covers: [id],
    });
  }

  return { conditions, cases };
}

function Cases() {
  const [op, setOp] = useState("");
  const [fields, setFields] = useState([blankField()]);
  const [out, setOut] = useState(null);

  const upd = (id, patch) => setFields((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const addField = () => setFields((fs) => [...fs, blankField()]);
  const rmField = (id) => setFields((fs) => (fs.length > 1 ? fs.filter((f) => f.id !== id) : fs));

  const named = fields.filter((f) => f.name.trim()).length;

  const asMarkdown = () => {
    if (!out) return "";
    const c = out.conditions.map((x) => `| ${x.id} | ${x.technique} | ${x.condition} |`).join("\n");
    const t = out.cases
      .map((x) => `### ${x.id} — ${x.title}\nCovers: ${x.covers.join(", ")}\n${x.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n**Expected:** ${x.expected}`)
      .join("\n\n");
    return `# ${op || "Test cases"}\n\n## Test conditions\n\n| ID | Technique | Condition |\n| --- | --- | --- |\n${c}\n\n## Test cases\n\n${t}`;
  };

  return (
    <div>
      <h2 className="h2">Cases</h2>
      <p className="sub">
        Describe the inputs and their constraints. Boundary values, equivalence partitions, and the usual error-guessing cases
        come out by the book — the same set every time, which is the point.
      </p>

      <div className="add-row">
        <input className="input grow" placeholder="What is being tested — e.g. POST /payments" value={op} onChange={(e) => setOp(e.target.value)} />
      </div>

      <div className="fields">
        {fields.map((f) => (
          <div key={f.id} className="field-row">
            <input className="input grow" placeholder="Field name" value={f.name} onChange={(e) => upd(f.id, { name: e.target.value })} />
            <select className="select" value={f.type} onChange={(e) => upd(f.id, { type: e.target.value })} aria-label="Type">
              {FIELD_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            {f.type === "enum" ? (
              <input className="input grow" placeholder="Permitted values, comma separated" value={f.values} onChange={(e) => upd(f.id, { values: e.target.value })} />
            ) : f.type === "boolean" ? (
              <span className="field-na">no bounds</span>
            ) : (
              <>
                <input className="input narrow" placeholder={f.type === "string" ? "min len" : "min"} value={f.min} onChange={(e) => upd(f.id, { min: e.target.value })} />
                <input className="input narrow" placeholder={f.type === "string" ? "max len" : "max"} value={f.max} onChange={(e) => upd(f.id, { max: e.target.value })} />
              </>
            )}
            <label className="req">
              <input type="checkbox" checked={f.required} onChange={(e) => upd(f.id, { required: e.target.checked })} />
              required
            </label>
            <button className="btn btn-ghost btn-sm" onClick={() => rmField(f.id)} disabled={fields.length === 1}>
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="actions">
        <button className="btn btn-ghost" onClick={addField}>
          Add field
        </button>
        <button className="btn btn-primary" onClick={() => setOut(generateCases(op, fields))} disabled={!named}>
          Generate cases
        </button>
        {out && <Copy text={asMarkdown()} />}
      </div>

      {out && (
        <div className="cases-out">
          <h3 className="h3">Conditions</h3>
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Technique</th>
                <th>Condition</th>
              </tr>
            </thead>
            <tbody>
              {out.conditions.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.id}</td>
                  <td>{c.technique}</td>
                  <td>{c.condition}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="h3">Cases</h3>
          {out.cases.map((c) => (
            <div key={c.id} className="case">
              <div className="case-head">
                <span className="mono case-id">{c.id}</span>
                <span className="case-title">{c.title}</span>
                <span className="covers mono">{c.covers.join(" ")}</span>
              </div>
              <ol className="steps">
                {c.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              <p className="expected">
                <span className="expected-key">Expected</span> {c.expected}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Module: Flaky
   ============================================================ */

function Flaky({ state, set }) {
  const [name, setName] = useState("");

  const add = () => {
    if (!name.trim()) return;
    set({ ...state, flaky: [{ id: uid(), name: name.trim(), runs: [] }, ...state.flaky] });
    setName("");
  };

  const record = (id, result) =>
    set({
      ...state,
      flaky: state.flaky.map((t) => (t.id === id ? { ...t, runs: [...t.runs, result].slice(-40) } : t)),
    });

  const undo = (id) =>
    set({ ...state, flaky: state.flaky.map((t) => (t.id === id ? { ...t, runs: t.runs.slice(0, -1) } : t)) });

  const remove = (id) => set({ ...state, flaky: state.flaky.filter((t) => t.id !== id) });

  const ranked = [...state.flaky].sort((a, b) => flakeRate(b) - flakeRate(a));

  return (
    <div>
      <h2 className="h2">Flaky</h2>
      <p className="sub">Log each run of a suspect test. Enough marks and the pattern speaks for itself — evidence beats a hunch when you're arguing for time to fix it.</p>

      <div className="add-row">
        <input
          className="input grow mono"
          placeholder="Test name — e.g. PayPal_refund_partial_amount"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn btn-primary" onClick={add}>
          Track test
        </button>
      </div>

      {ranked.length === 0 ? (
        <Empty>No tests tracked. Add the one that failed on you this morning.</Empty>
      ) : (
        <ul className="list">
          {ranked.map((t) => {
            const v = verdict(t);
            const pct = Math.round(flakeRate(t) * 100);
            return (
              <li key={t.id} className="item">
                <div className="item-head">
                  <span className="mono title">{t.name}</span>
                  <span className={"verdict tone-" + v.tone}>{v.label}</span>
                  {t.runs.length > 0 && (
                    <span className="rate">
                      {pct}% failing over {t.runs.length} run{t.runs.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                <div className="ticks">
                  {t.runs.length === 0 && <span className="tick-none">no runs recorded</span>}
                  {t.runs.map((r, i) => (
                    <span key={i} className={"tick tick-" + r} title={r} />
                  ))}
                </div>
                <div className="item-foot">
                  <button className="btn btn-sm btn-pass" onClick={() => record(t.id, "pass")}>
                    Passed
                  </button>
                  <button className="btn btn-sm btn-fail" onClick={() => record(t.id, "fail")}>
                    Failed
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => undo(t.id)} disabled={!t.runs.length}>
                    Undo
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => remove(t.id)}>
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ============================================================
   Module: Bench (test data + cron)
   ============================================================ */

function Bench() {
  const [rows, setRows] = useState([]);
  const [cron, setCron] = useState("0 2 * * *");

  const push = (label, value) => setRows((r) => [{ id: uid(), label, value }, ...r].slice(0, 14));

  const gens = [
    { label: "Visa card", fn: () => group(card("visa")) },
    { label: "Mastercard", fn: () => group(card("mastercard")) },
    { label: "Amex", fn: () => group(card("amex")) },
    { label: "MSISDN (KE)", fn: () => msisdn("KE") },
    { label: "MSISDN (ZA)", fn: () => msisdn("ZA") },
    { label: "MSISDN (GB)", fn: () => msisdn("GB") },
    { label: "UUID v4", fn: uuid4 },
    { label: "Idempotency key", fn: idemKey },
    { label: "Amount", fn: amount },
    { label: "Tagged email", fn: tagEmail },
    { label: "Timestamp (ISO)", fn: () => new Date().toISOString() },
  ];

  const read = readCron(cron);

  return (
    <div>
      <h2 className="h2">Bench</h2>
      <p className="sub">Throwaway values for manual runs and fixtures, plus a plain-language read of a schedule line.</p>

      <h3 className="h3">Test data</h3>
      <div className="gen-grid">
        {gens.map((g) => (
          <button key={g.label} className="gen" onClick={() => push(g.label, g.fn())}>
            {g.label}
          </button>
        ))}
      </div>
      <p className="fineprint">
        Card numbers pass a Luhn check and use real brand prefixes, so they look valid to client-side validation. They are not live
        accounts and will not authorise anywhere.
      </p>

      {rows.length > 0 && (
        <ul className="gen-out">
          {rows.map((r) => (
            <li key={r.id}>
              <span className="gen-label">{r.label}</span>
              <code className="mono gen-value">{r.value}</code>
              <Copy text={r.value} small />
            </li>
          ))}
        </ul>
      )}

      <h3 className="h3 spaced">Schedule reader</h3>
      <div className="add-row">
        <input className="input grow mono" value={cron} onChange={(e) => setCron(e.target.value)} aria-label="Cron expression" />
      </div>

      {read.error ? (
        <p className="error">{read.error}</p>
      ) : (
        <ul className="cron-out">
          {read.parts.map((p, i) => (
            <li key={i}>
              <code className="mono cron-field">{p.expr}</code>
              <span className="cron-text">{p.text}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="presets">
        {CRON_PRESETS.map((p) => (
          <button key={p.expr} className="preset" onClick={() => setCron(p.expr)}>
            <code className="mono">{p.expr}</code>
            <span>{p.use}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   Module: Bug
   ============================================================ */

const BUG_BLANK = {
  title: "",
  env: "",
  build: "",
  steps: "",
  expected: "",
  actual: "",
  evidence: "",
  severity: "major",
};

function Bug({ state, set }) {
  const b = state.bug || BUG_BLANK;
  const upd = (patch) => set({ ...state, bug: { ...b, ...patch } });

  const md = useMemo(() => {
    const stepList = b.steps
      .split("\n")
      .filter((s) => s.trim())
      .map((s, i) => `${i + 1}. ${s.replace(/^\d+[.)]\s*/, "").trim()}`)
      .join("\n");
    return [
      `# ${b.title || "Untitled defect"}`,
      ``,
      `**Severity:** ${b.severity}  `,
      `**Environment:** ${b.env || "—"}  `,
      `**Build / commit:** ${b.build || "—"}`,
      ``,
      `## Steps to reproduce`,
      stepList || "_None given._",
      ``,
      `## Expected`,
      b.expected || "_None given._",
      ``,
      `## Actual`,
      b.actual || "_None given._",
      ...(b.evidence ? [``, `## Evidence`, b.evidence] : []),
    ].join("\n");
  }, [b]);

  const missing = [
    !b.title && "a title",
    !b.steps.trim() && "steps to reproduce",
    !b.expected.trim() && "expected behaviour",
    !b.actual.trim() && "actual behaviour",
    !b.build && "a build or commit",
  ].filter(Boolean);

  return (
    <div>
      <h2 className="h2">Bug</h2>
      <p className="sub">Fill the fields, take the markdown. The gap list below tells you what a developer will come back and ask for.</p>

      <div className="bug-grid">
        <label className="field grow-2">
          <span>Title</span>
          <input className="input" value={b.title} onChange={(e) => upd({ title: e.target.value })} placeholder="Refund of a partially captured payment returns the full amount" />
        </label>
        <label className="field">
          <span>Severity</span>
          <select className="select" value={b.severity} onChange={(e) => upd({ severity: e.target.value })}>
            <option>blocker</option>
            <option>critical</option>
            <option>major</option>
            <option>minor</option>
          </select>
        </label>
        <label className="field">
          <span>Environment</span>
          <input className="input" value={b.env} onChange={(e) => upd({ env: e.target.value })} placeholder="Staging" />
        </label>
        <label className="field">
          <span>Build or commit</span>
          <input className="input mono" value={b.build} onChange={(e) => upd({ build: e.target.value })} placeholder="a91f3c2" />
        </label>
        <label className="field grow-2">
          <span>Steps — one per line</span>
          <textarea className="textarea" rows={5} value={b.steps} onChange={(e) => upd({ steps: e.target.value })} placeholder={"Create an order for 100.00\nCapture 40.00\nRequest a full refund"} />
        </label>
        <label className="field grow-2">
          <span>Expected</span>
          <textarea className="textarea" rows={2} value={b.expected} onChange={(e) => upd({ expected: e.target.value })} />
        </label>
        <label className="field grow-2">
          <span>Actual</span>
          <textarea className="textarea" rows={2} value={b.actual} onChange={(e) => upd({ actual: e.target.value })} />
        </label>
        <label className="field grow-2">
          <span>Evidence — logs, trace IDs, screenshots</span>
          <textarea className="textarea mono" rows={3} value={b.evidence} onChange={(e) => upd({ evidence: e.target.value })} />
        </label>
      </div>

      {missing.length > 0 && (
        <p className="gaps">
          Still missing: {missing.join(", ")}.
        </p>
      )}

      <div className="actions">
        <Copy text={md} />
        <button className="btn btn-ghost" onClick={() => set({ ...state, bug: BUG_BLANK })}>
          Clear the form
        </button>
      </div>

      <pre className="preview mono">{md}</pre>
    </div>
  );
}

/* ============================================================
   Shell
   ============================================================ */

const TOOLS = [
  { key: "queue", label: "Queue", hint: "Today's work" },
  { key: "review", label: "Review", hint: "Code and config" },
  { key: "cases", label: "Cases", hint: "Conditions from a requirement" },
  { key: "flaky", label: "Flaky", hint: "Run history" },
  { key: "bench", label: "Bench", hint: "Data and schedules" },
  { key: "bug", label: "Bug", hint: "Report builder" },
];

export default function Testbench() {
  const [tool, setTool] = useState("queue");
  const [state, setState] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    loadState().then((s) => {
      setState(s);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const ok = await saveState(state);
      setSaveFailed(!ok);
    }, 400);
    return () => clearTimeout(timer.current);
  }, [state, loaded]);

  const metrics = useMemo(() => {
    const open = state.queue.filter((t) => t.status === "open").length;
    const doing = state.queue.filter((t) => t.status === "doing").length;
    const blocked = state.queue.filter((t) => t.status === "blocked").length;
    const flaky = state.flaky.filter((t) => {
      const r = flakeRate(t);
      return t.runs.length >= 3 && r > 0 && r < 1;
    }).length;
    return { open, doing, blocked, flaky };
  }, [state]);

  return (
    <div className={"tb " + (state.theme === "light" ? "light" : "dark")}>
      <style>{`
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

.tb.dark {
  --paper:#121A18; --panel:#1B2523; --ink:#EDF2F0; --ink2:#A5B3AF;
  --rule:#36443F; --rule2:#26322F;
  --pass:#4FBF9B; --flaky:#E0A63C; --fail:#E2705C; --focus:#83B6E8;
  --accent:#E8EEEC; --on-accent:#121A18; --accent-hover:#FFFFFF;
  --placeholder:#788884;
  color-scheme:dark;
}
.tb.light {
  --paper:#EEF1EF; --panel:#FFFFFF; --ink:#14201D; --ink2:#54645F;
  --rule:#CCD6D2; --rule2:#E2E8E6;
  --pass:#1C6B58; --flaky:#9A6310; --fail:#993629; --focus:#2B5F8F;
  --accent:#14201D; --on-accent:#FFFFFF; --accent-hover:#000000;
  --placeholder:#8A9A95;
  color-scheme:light;
}
.tb {
  background:var(--paper); color:var(--ink);
  font-family:'Archivo','Helvetica Neue',Arial,sans-serif;
  font-size:15px; line-height:1.5; min-height:100vh;
  -webkit-font-smoothing:antialiased;
}
.tb *,.tb *::before,.tb *::after{box-sizing:border-box;}
.tb .mono{font-family:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;font-size:0.86em;}
.tb button,.tb input,.tb select,.tb textarea{font-family:inherit;font-size:inherit;}
.tb :focus-visible{outline:2px solid var(--focus);outline-offset:2px;}

/* signal strip */
.strip{display:flex;align-items:baseline;gap:2.5rem;flex-wrap:wrap;
  padding:1.6rem 2rem 1.1rem;border-bottom:1px solid var(--rule);background:var(--panel);}
.brand{margin-right:auto;}
.brand h1{margin:0;font-size:1.35rem;font-weight:700;letter-spacing:-0.02em;}
.brand p{margin:0.15rem 0 0;font-size:0.8rem;color:var(--ink2);}
.metric{display:flex;align-items:baseline;gap:0.45rem;}
.metric b{font-size:2rem;font-weight:600;letter-spacing:-0.03em;line-height:1;font-variant-numeric:tabular-nums;}
.metric span{font-size:0.82rem;color:var(--ink2);}
.m-open b{color:var(--ink);} .m-doing b{color:var(--focus);}
.m-blocked b{color:var(--fail);} .m-flaky b{color:var(--flaky);}

/* shell */
.shell{display:flex;align-items:stretch;min-height:70vh;}
.rail{width:180px;flex:none;border-right:1px solid var(--rule);background:var(--panel);padding:0.75rem 0;}
.rail-btn{display:block;width:100%;text-align:left;background:none;border:0;cursor:pointer;color:var(--ink);
  padding:0.6rem 1.1rem;border-left:3px solid transparent;}
.rail-btn strong{display:block;font-weight:600;font-size:1rem;color:var(--ink);}
.rail-btn em{display:block;font-style:normal;font-size:0.78rem;color:var(--ink2);margin-top:0.12rem;}
.rail-btn:hover{background:var(--rule2);}
.rail-btn.on{border-left-color:var(--accent);background:var(--rule2);}
.rail-btn.on strong{font-weight:600;}
.pane{flex:1;padding:1.75rem 2rem 4rem;max-width:900px;}

/* type */
.h2{margin:0;font-size:1.5rem;font-weight:600;letter-spacing:-0.02em;}
.h3{margin:1.8rem 0 0.6rem;font-size:0.95rem;font-weight:600;}
.h3.spaced{margin-top:2.4rem;}
.sub{margin:0.35rem 0 1.4rem;color:var(--ink2);max-width:62ch;font-size:0.9rem;}
.empty{color:var(--ink2);font-size:0.9rem;padding:1.6rem 0;border-top:1px solid var(--rule2);}
.error{color:var(--fail);font-size:0.88rem;margin:0.8rem 0 0;}
.fineprint{font-size:0.78rem;color:var(--ink2);margin:0.7rem 0 0;max-width:62ch;}

/* controls */
.input,.select,.textarea{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:0.45rem 0.6rem;color:var(--ink);}
.textarea{width:100%;resize:vertical;line-height:1.55;}
.input::placeholder,.textarea::placeholder{color:var(--placeholder);}
.narrow{width:110px;} .grow{flex:1;min-width:140px;}
.input-sm,.select-sm{padding:0.25rem 0.4rem;font-size:0.85rem;}
.add-row{display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;}
.actions{display:flex;gap:0.5rem;margin-top:0.9rem;flex-wrap:wrap;}
.btn{border:1px solid var(--rule);background:var(--panel);border-radius:2px;padding:0.45rem 0.95rem;cursor:pointer;
  color:var(--ink);font-weight:600;font-size:0.92rem;letter-spacing:0.005em;}
.btn:hover{border-color:var(--ink);}
.btn:disabled{opacity:0.6;cursor:not-allowed;}
.btn-primary{background:var(--accent);color:var(--on-accent);border-color:var(--accent);}
.btn-primary:hover{background:var(--accent-hover);border-color:var(--accent-hover);}
.theme-toggle{border:1px solid var(--rule);background:var(--panel);color:var(--ink);border-radius:2px;
  padding:0.35rem 0.75rem;font-size:0.85rem;font-weight:600;cursor:pointer;align-self:center;}
.theme-toggle:hover{border-color:var(--ink);}
.btn-ghost{background:none;border-color:var(--rule);color:var(--ink);}
.btn-ghost:hover{background:var(--panel);border-color:var(--ink);}
.btn-sm{padding:0.28rem 0.65rem;font-size:0.87rem;}
.btn-pass{color:var(--pass);border-color:var(--pass);}
.btn-pass:hover{background:var(--pass);color:var(--on-accent);border-color:var(--pass);}
.btn-fail{color:var(--fail);border-color:var(--fail);}
.btn-fail:hover{background:var(--fail);color:var(--on-accent);border-color:var(--fail);}
.chip{border:1px solid var(--rule);background:var(--panel);border-radius:999px;padding:0.26rem 0.8rem;
  font-size:0.88rem;font-weight:500;cursor:pointer;color:var(--ink);}
.chip:hover{border-color:var(--ink);}
.chip-on{background:var(--accent);color:var(--on-accent);border-color:var(--accent);}
.filters,.lens-row{display:flex;gap:0.4rem;margin-bottom:1rem;flex-wrap:wrap;}

/* lists */
.list{list-style:none;margin:0;padding:0;}
.item{border-top:1px solid var(--rule2);padding:0.8rem 0;}
.item-head{display:flex;align-items:baseline;gap:0.6rem;flex-wrap:wrap;}
.item-foot{display:flex;align-items:center;gap:0.4rem;margin-top:0.5rem;flex-wrap:wrap;}
.title{flex:1;min-width:180px;}
.struck{text-decoration:line-through;color:var(--ink2);}
.pri{font-size:0.72rem;font-weight:600;padding:0.1rem 0.35rem;border:1px solid currentColor;border-radius:2px;}
.pri-P1{color:var(--fail);} .pri-P2{color:var(--flaky);} .pri-P3{color:var(--ink2);}
.ticket{color:var(--focus);} .kind{font-size:0.78rem;color:var(--ink2);}
.status-blocked .title{color:var(--fail);}
.status-done{opacity:0.55;}

/* flaky ticks */
.ticks{display:flex;gap:2px;margin-top:0.5rem;align-items:center;height:14px;}
.tick{width:7px;height:14px;border-radius:1px;display:inline-block;}
.tick-pass{background:var(--pass);} .tick-fail{background:var(--fail);}
.tick-none{font-size:0.78rem;color:var(--ink2);}
.verdict{font-size:0.78rem;font-weight:600;}
.tone-pass{color:var(--pass);} .tone-fail{color:var(--fail);}
.tone-flaky{color:var(--flaky);} .tone-idle{color:var(--ink2);}
.rate{font-size:0.78rem;color:var(--ink2);font-variant-numeric:tabular-nums;}

/* findings */
.findings{list-style:none;margin:1.2rem 0 0;padding:0;}
.finding{border-left:3px solid var(--rule);padding:0.7rem 0 0.7rem 0.9rem;margin-bottom:0.9rem;}
.sev-blocker{border-left-color:var(--fail);} .sev-major{border-left-color:var(--flaky);}
.sev-minor{border-left-color:var(--focus);} .sev-nit{border-left-color:var(--rule);}
.finding-head{display:flex;gap:0.6rem;align-items:baseline;}
.sev-tag{font-size:0.74rem;font-weight:600;color:var(--ink2);}
.finding-title{font-weight:600;}
.finding-detail{margin:0.3rem 0 0;font-size:0.9rem;max-width:70ch;}
.finding-lines{margin-left:auto;color:var(--ink2);font-size:0.78rem;white-space:nowrap;}
.fields{display:flex;flex-direction:column;gap:0.5rem;margin-top:0.4rem;}
.field-row{display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;}
.field-na{font-size:0.82rem;color:var(--ink2);flex:1;min-width:120px;}
.req{display:flex;align-items:center;gap:0.3rem;font-size:0.82rem;color:var(--ink2);white-space:nowrap;}
.req input{accent-color:var(--focus);}
.locate{display:block;margin-top:0.4rem;background:var(--panel);border:1px solid var(--rule2);padding:0.3rem 0.5rem;overflow-x:auto;}

/* cases */
.table{border-collapse:collapse;width:100%;font-size:0.88rem;}
.table th{text-align:left;font-weight:600;border-bottom:1px solid var(--rule);padding:0.4rem 0.6rem 0.4rem 0;}
.table td{border-bottom:1px solid var(--rule2);padding:0.45rem 0.6rem 0.45rem 0;vertical-align:top;}
.case{border-top:1px solid var(--rule2);padding:0.9rem 0;}
.case-head{display:flex;gap:0.6rem;align-items:baseline;flex-wrap:wrap;}
.case-id{color:var(--focus);} .case-title{font-weight:600;flex:1;}
.covers{font-size:0.75rem;color:var(--ink2);}
.steps{margin:0.5rem 0 0.5rem 1.2rem;padding:0;font-size:0.9rem;}
.steps li{margin-bottom:0.15rem;}
.expected{margin:0;font-size:0.9rem;}
.expected-key{font-weight:600;margin-right:0.4rem;}
.questions{background:var(--panel);border:1px solid var(--rule);padding:0.8rem 1rem;margin-top:1.2rem;}
.questions h3{margin-top:0;} .questions ul{margin:0;padding-left:1.1rem;font-size:0.9rem;}

/* bench */
.gen-grid{display:flex;flex-wrap:wrap;gap:0.4rem;}
.gen{border:1px solid var(--rule);background:var(--panel);border-radius:2px;padding:0.38rem 0.75rem;
  font-size:0.9rem;font-weight:500;color:var(--ink);cursor:pointer;}
.gen:hover{border-color:var(--ink);}
.gen-out{list-style:none;margin:1rem 0 0;padding:0;}
.gen-out li{display:flex;align-items:center;gap:0.7rem;border-top:1px solid var(--rule2);padding:0.35rem 0;}
.gen-label{font-size:0.78rem;color:var(--ink2);width:130px;flex:none;}
.gen-value{flex:1;}
.cron-out{list-style:none;margin:0.8rem 0 0;padding:0;}
.cron-out li{display:flex;gap:0.8rem;align-items:baseline;border-top:1px solid var(--rule2);padding:0.35rem 0;}
.cron-field{width:80px;flex:none;color:var(--focus);}
.cron-text{font-size:0.9rem;}
.presets{display:flex;flex-direction:column;gap:0;margin-top:1.4rem;}
.preset{display:flex;gap:0.9rem;align-items:baseline;text-align:left;background:none;border:0;color:var(--ink);
  border-top:1px solid var(--rule2);padding:0.45rem 0;cursor:pointer;font-size:0.88rem;}
.preset:hover{background:var(--rule2);}
.preset code{width:110px;flex:none;}

/* bug */
.bug-grid{display:flex;flex-wrap:wrap;gap:0.8rem;}
.field{display:flex;flex-direction:column;gap:0.25rem;flex:1;min-width:170px;}
.field>span{font-size:0.78rem;color:var(--ink2);}
.grow-2{flex-basis:100%;}
.gaps{margin:1rem 0 0;font-size:0.88rem;color:var(--flaky);}
.preview{background:var(--panel);border:1px solid var(--rule);padding:1rem;margin-top:1.2rem;
  white-space:pre-wrap;overflow-x:auto;font-size:0.82rem;line-height:1.6;}
.savewarn{font-size:0.78rem;color:var(--flaky);padding:0 2rem 0.8rem;}

@media (max-width:720px){
  .shell{flex-direction:column;}
  .rail{width:100%;display:flex;overflow-x:auto;border-right:0;border-bottom:1px solid var(--rule);padding:0;}
  .rail-btn{border-left:0;border-bottom:3px solid transparent;white-space:nowrap;padding:0.6rem 0.9rem;}
  .rail-btn.on{border-left:0;border-bottom-color:var(--accent);}
  .rail-btn em{display:none;}
  .pane{padding:1.25rem;}
  .strip{padding:1.1rem 1.25rem 0.9rem;gap:1.4rem;}
  .metric b{font-size:1.5rem;}
}
@media (prefers-reduced-motion:reduce){.tb *{transition:none!important;animation:none!important;}}
      `}</style>

      <header className="strip">
        <div className="brand">
          <h1>Testbench</h1>
          <p>Six things you do most days, in one place</p>
        </div>
        <div className="metric m-open">
          <b>{metrics.open}</b>
          <span>open</span>
        </div>
        <div className="metric m-doing">
          <b>{metrics.doing}</b>
          <span>in progress</span>
        </div>
        <div className="metric m-blocked">
          <b>{metrics.blocked}</b>
          <span>blocked</span>
        </div>
        <div className="metric m-flaky">
          <b>{metrics.flaky}</b>
          <span>flaky</span>
        </div>
        <button
          className="theme-toggle"
          onClick={() => setState({ ...state, theme: state.theme === "light" ? "dark" : "light" })}
        >
          {state.theme === "light" ? "Switch to dark" : "Switch to light"}
        </button>
      </header>

      {saveFailed && <p className="savewarn">Changes aren't saving right now. Copy anything you need before you close this.</p>}

      <div className="shell">
        <nav className="rail">
          {TOOLS.map((t) => (
            <button key={t.key} className={"rail-btn" + (tool === t.key ? " on" : "")} onClick={() => setTool(t.key)}>
              <strong>{t.label}</strong>
              <em>{t.hint}</em>
            </button>
          ))}
        </nav>

        <main className="pane">
          {tool === "queue" && <Queue state={state} set={setState} />}
          {tool === "review" && <Review />}
          {tool === "cases" && <Cases />}
          {tool === "flaky" && <Flaky state={state} set={setState} />}
          {tool === "bench" && <Bench />}
          {tool === "bug" && <Bug state={state} set={setState} />}
        </main>
      </div>
    </div>
  );
}

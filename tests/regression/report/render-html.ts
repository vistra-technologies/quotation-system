import { problemsOf, type ReportData, type ReportTest, type Section } from "./report-data";
import { REPORT_CSS } from "./report-style";

/** The one escaper: every dynamic string in the document goes through it. */
export function esc(v: unknown): string {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
/** JSON safe to embed in a <script> block: `<` can never open a tag or close the script. */
export function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c").replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028").replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029");
}
/** Only relative file paths become links — never a URL scheme or an absolute path. */
function safeRel(p: string | undefined): string | null {
  if (!p) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith("/") || p.startsWith("\\")) return null;
  return p.replace(/\\/g, "/");
}
const fmtDur = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s` : `${(ms / 1000).toFixed(1)} s`);
const num = (n: number) => n.toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const np = (d: ReportData, s: Section) => (d.notProduced ?? []).includes(s);
const NOT_PRODUCED = '<span class="badc">not produced — see console</span>';
const mark = (ok: boolean) => (ok ? '<span class="good">✓</span>' : '<span class="badc">✗</span>');
const msg = (html: string) => `<div class="card"><p style="padding:14px 18px;margin:0">${html}</p></div>`;

function stat(label: string, big: string, small: string, w: number, produced = true): string {
  return `<div class="stat"><span>${esc(label)}</span><b>${produced ? esc(big) : "—"}</b><small>${produced ? esc(small) : NOT_PRODUCED}</small><div class="bar"><i style="width:${produced ? w : 0}%"></i></div></div>`;
}

function failureRow(area: string, t: ReportTest): string {
  const links = [
    ["trace", safeRel(t.trace)],
    ["screenshot", safeRel(t.screenshot)],
  ]
    .filter((l): l is [string, string] => !!l[1])
    .map(([n, h]) => `<a href="${esc(h)}">${n}</a>`)
    .join("");
  const body = t.error
    ? `<div class="err">${esc(t.error)}</div>`
    : t.status === "skipped"
      ? '<div class="err">skipped — the suite allows no silent skips</div>'
      : "";
  return `<div class="t"><span class="dot ${esc(t.status)}"></span><div><b>${esc(area)}</b> › ${esc(t.title)}</div><span class="dur">${esc(fmtDur(t.durationMs))}</span>${body}${links ? `<div class="links" style="grid-column:2/4">${links}</div>` : ""}</div>`;
}

export function renderReport(d: ReportData): string {
  const all = d.areas.flatMap((a) => a.tests.map((t) => ({ area: a.name, t })));
  const passed = all.filter((x) => x.t.status === "passed").length;
  const failedL = all.filter((x) => x.t.status === "failed");
  const skippedL = all.filter((x) => x.t.status === "skipped");
  const flakyL = all.filter((x) => x.t.flaky);
  const bad = failedL.concat(skippedL);
  const c = d.cleanup;
  const pass = d.verdict === "PASS";
  const problems = problemsOf(d);
  const sub = pass ? "all tests passed · cleanup <b>clean</b> · coverage complete" : problems.map((p) => `<b>${esc(p)}</b>`).join(" · ");
  const rc = d.coverage.routes;
  const pg = d.coverage.pages;
  const cleanBlock = np(d, "cleanup")
    ? msg(NOT_PRODUCED)
    : `<div class="card kv">
    <div>Created &amp; deleted</div><div>${mark(c.deleted.length >= c.created && c.cleanupErrors.length === 0)} ${esc(c.created)} rows created and ${esc(c.deleted.length)} deleted${c.cleanupErrors.length ? ` — errors: <code>${esc(c.cleanupErrors.join("; "))}</code>` : ""}</div>
    <div>Stray <code>rgr-</code> rows</div><div>${mark(c.strays.length === 0)} ${c.strays.length ? esc(JSON.stringify(c.strays)) : "none found by the post-run sweep"}</div>
    <div>Shared settings</div><div>${mark(c.revertFailures.length === 0)} ${c.revertFailures.length ? `revert FAILED: <code>${esc(c.revertFailures.join("; "))}</code>` : c.revertsOk.length ? `${esc(c.revertsOk.length)} changed and restored exactly (${c.revertsOk.map((r) => `<code>${esc(r)}</code>`).join(", ")})` : "none changed"}</div>
    <div>Other organizations</div><div>${mark(c.delta.length === 0)} ${c.delta.length ? c.delta.map((x) => `<code>${esc(x)}</code>`).join("<br>") : `unchanged — ${esc(c.orgsCompared)} orgs compared before vs after`}</div>
    <div>Test Org</div><div><code>${esc(d.testOrg)}</code> (persistent; test data lives here only)</div>
    <div>Throwaway org</div><div>${mark(!c.strays.some((s) => JSON.stringify(s).includes(d.orgB)))} <code>${esc(d.orgB)}</code></div>
    <div>Teardown</div><div>${mark(c.cleanupFailed !== true)} ${c.cleanupFailed === true ? "cleanup FAILED" : "completed"}</div>
  </div>`;
  const failBlock = np(d, "results")
    ? `<h2>Failures</h2>${msg(NOT_PRODUCED)}`
    : bad.length
      ? `<h2>Failures (${bad.length})</h2><div class="card"><div class="tests">${bad.map((x) => failureRow(x.area, x.t)).join("")}</div></div>`
      : "";
  const gaps = [
    ...d.coverage.untested.map((u) => `<li><span class="pill f">UNTESTED</span> &nbsp;<code>${esc(u)}</code></li>`),
    ...d.coverage.stale.map((u) => `<li><span class="pill s">STALE</span> &nbsp;<code>${esc(u)}</code> — registered but no longer exists</li>`),
  ];
  const gapBlock = np(d, "coverage")
    ? `<h2>Coverage gaps</h2>${msg(NOT_PRODUCED)}`
    : gaps.length
      ? `<h2>Coverage gaps (${gaps.length})</h2><div class="card"><ul class="l">${gaps.join("")}</ul></div>`
      : "";
  const flakyBlock = flakyL.length
    ? `<h2>Flaky (${flakyL.length})</h2><div class="card"><ul class="l">${flakyL.map((x) => `<li><span class="pill s">flaky*</span> &nbsp;<b>${esc(x.area)}</b> › ${esc(x.t.title)}</li>`).join("")}</ul></div>`
    : "";
  const areasJson = scriptJson(
    d.areas.map((a) => ({ name: a.name, tests: a.tests.map((t) => ({ title: t.title, status: t.status, dur: t.durationMs / 1000, flaky: t.flaky, err: t.error })) })),
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Regression report — ${esc(d.runId)}</title>
<style>
${REPORT_CSS}</style>
</head>
<body>
<div class="wrap">
  <section class="verdict ${pass ? "pass" : "fail"}" id="verdict">
    <div class="icon">${pass ? "✓" : "✕"}</div>
    <div>
      <h1>REGRESSION ${esc(d.verdict)}</h1>
      <p>${sub}</p>
    </div>
    <div class="meta">Run <code>${esc(d.runId)}</code><br>${esc(d.startedAt)} · ${esc(fmtDur(d.durationMs))}<br>${esc(d.target)}<br>commit ${d.commit ? `<code>${esc(d.commit)}</code>` : "unknown"}</div>
  </section>

  <div class="grid">
    ${stat("Tests", num(all.length), `${num(passed)} passed · ${failedL.length} failed · ${skippedL.length} skipped · ${flakyL.length} flaky*`, pct(passed, all.length), !np(d, "results"))}
    ${stat("API routes covered", `${num(rc.covered)} / ${num(rc.total)}`, `${num(rc.total - rc.covered)} untested`, pct(rc.covered, rc.total), !np(d, "coverage"))}
    ${stat("Pages covered", `${num(pg.covered)} / ${num(pg.total)}`, `${num(pg.total - pg.covered)} untested`, pct(pg.covered, pg.total), !np(d, "coverage"))}
    ${stat("Unit tests", `${num(d.unit.passed)} / ${num(d.unit.total)}`, d.unit.failed ? `${d.unit.failed} failing` : "all passing", pct(d.unit.passed, d.unit.total), !np(d, "unit"))}
  </div>

  <h2>Cleanup &amp; safety — did the run leave things as it found them?</h2>
  ${cleanBlock}

  ${failBlock}
  ${gapBlock}
  ${flakyBlock}

  <h2>Results by area</h2>
  <div class="tools">
    <input id="q" placeholder="Search tests…">
    <button class="chip on" data-f="all">All</button><button class="chip" data-f="failed">Failed</button><button class="chip" data-f="skipped">Skipped</button><button class="chip" data-f="flaky">Flaky*</button>
  </div>
  <div class="card" id="areas"></div>
  <p style="font-size:12px;color:var(--muted)">* Flaky = failed in the parallel run, passed when re-run once at one worker (the sign-in rate limit is the known cause). Still counted and listed, never hidden.</p>
</div>

<script>
const AREAS=${areasJson};
const root=document.getElementById("areas");let filter="all",q="";
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function render(){
  root.innerHTML="";
  for(const a of AREAS){
    const tests=a.tests.filter(t=>(filter==="all"||t.status===filter||(filter==="flaky"&&t.flaky))&&t.title.toLowerCase().includes(q));
    if(!tests.length)continue;
    const p=a.tests.filter(t=>t.status==="passed").length,f=a.tests.filter(t=>t.status==="failed").length,s=a.tests.filter(t=>t.status==="skipped").length;
    const d=document.createElement("details");if(f||filter!=="all"||q)d.open=true;
    d.innerHTML='<summary><span class="tw">›</span><span class="area">'+esc(a.name)+'</span><span class="cnt">'+a.tests.length+' tests</span>'+(f?'<span class="pill f">'+f+' failed</span>':"")+(s?'<span class="pill s">'+s+' skipped</span>':"")+'<span class="pill p">'+p+' passed</span></summary><div class="tests">'+tests.map(t=>'<div class="t"><span class="dot '+esc(t.status)+'"></span><div>'+esc(t.title)+(t.flaky?' <span class="pill s">flaky*</span>':"")+'</div><span class="dur">'+t.dur.toFixed(1)+' s</span>'+(t.err?'<div class="err">'+esc(t.err)+'</div>':"")+'</div>').join("")+'</div>';
    root.appendChild(d);
  }
  if(!root.children.length)root.innerHTML='<p style="padding:20px;color:var(--muted)">No tests match.</p>';
}
document.getElementById("q").oninput=e=>{q=e.target.value.toLowerCase();render()};
document.querySelectorAll(".chip").forEach(b=>b.onclick=()=>{document.querySelectorAll(".chip").forEach(x=>x.classList.remove("on"));b.classList.add("on");filter=b.dataset.f;render()});
render();
</script>
</body>
</html>
`;
}

/** The approved mockup's stylesheet, verbatim except the font stack (system fonts; no external requests). */
export const REPORT_CSS = String.raw`  :root{
    --primary:#4E7F58;--primary-dark:#3E6647;--primary-softer:#ECF0ED;--bg:#F7F8EF;--card:#FBFAF5;--white:#fff;
    --border:#E0E2D7;--heading:#1B281E;--body:#3A4038;--muted:#5C665C;
    --ok-bg:#D4F1D4;--ok:#2E6B34;--bad-bg:#FFD9D4;--bad:#B3261E;--warn-bg:#F7E7C4;--warn:#875711;--info-bg:#C7EFFF;--info:#0B6E99;
  }
  *{box-sizing:border-box}
  body{margin:0;font:14px/1.45 system-ui,"Segoe UI",sans-serif;color:var(--body);background:var(--bg)}
  .wrap{max-width:1100px;margin:0 auto;padding:24px 20px 60px}
  .banner{margin-bottom:14px;padding:9px 14px;border:1px dashed #C7CCB6;border-radius:8px;background:#fff;color:var(--muted);font-size:12.5px}
  .verdict{display:flex;align-items:center;gap:16px;padding:20px 24px;border-radius:14px;border:1px solid var(--border)}
  .verdict.fail{background:var(--bad-bg);border-color:#E3B3AE}
  .verdict.pass{background:var(--ok-bg)}
  .verdict h1{margin:0;font-size:26px;font-weight:800;letter-spacing:.01em}
  .verdict.fail h1{color:var(--bad)} .verdict.pass h1{color:var(--ok)}
  .verdict p{margin:2px 0 0;color:var(--heading)}
  .icon{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:800;font-size:22px;flex:none}
  .fail .icon{background:var(--bad)} .pass .icon{background:var(--ok)}
  .meta{margin-left:auto;text-align:right;font-size:12.5px;color:var(--muted)}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:14px 0}
  .stat{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:14px 16px}
  .stat b{display:block;font-size:24px;color:var(--heading);font-weight:800}
  .stat span{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
  .stat small{display:block;color:var(--muted);margin-top:2px}
  .bar{height:6px;border-radius:99px;background:var(--border);margin-top:8px;overflow:hidden}
  .bar i{display:block;height:100%;background:var(--primary)}
  h2{margin:26px 0 8px;font-size:16px;font-weight:800;color:var(--heading)}
  .card{background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden}
  .tools{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0}
  .tools input{flex:1;min-width:200px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font:inherit}
  .chip{border:1px solid var(--border);background:#fff;border-radius:999px;padding:6px 13px;font:inherit;font-weight:700;cursor:pointer;color:var(--body)}
  .chip.on{background:var(--primary);color:#fff;border-color:var(--primary)}
  details{border-bottom:1px solid var(--border)} details:last-child{border-bottom:0}
  summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:12px;padding:12px 16px}
  summary::-webkit-details-marker{display:none}
  summary:hover{background:rgba(236,240,237,.55)}
  .tw{width:14px;color:#8A8177;transition:transform .15s} details[open] .tw{transform:rotate(90deg)}
  .area{font-weight:800;color:var(--heading);flex:1}
  .cnt{font-size:12.5px;color:var(--muted)}
  .pill{border-radius:999px;padding:2px 9px;font-size:12px;font-weight:800}
  .pill.p{background:var(--ok-bg);color:var(--ok)} .pill.f{background:var(--bad-bg);color:var(--bad)} .pill.s{background:var(--warn-bg);color:var(--warn)}
  .tests{background:#fff;border-top:1px solid var(--border)}
  .t{display:grid;grid-template-columns:22px 1fr auto;gap:8px;padding:8px 16px 8px 42px;border-bottom:1px solid #F0F1E8;font-size:13px}
  .t:last-child{border-bottom:0}
  .dot{width:10px;height:10px;border-radius:50%;margin-top:5px}
  .dot.passed{background:#4caf62}.dot.failed{background:var(--bad)}.dot.skipped{background:#d9a53a}
  .dur{color:var(--muted);font-size:12px}
  .err{grid-column:2/4;margin-top:4px;background:var(--bad-bg);border:1px solid #E3B3AE;border-radius:8px;padding:8px 10px;font:12px ui-monospace,Menlo,Consolas,monospace;color:#7a1d17;white-space:pre-wrap}
  .links a{margin-right:12px;color:var(--info);font-weight:700;font-size:12.5px;text-decoration:none}
  .kv{display:grid;grid-template-columns:200px 1fr;gap:0}
  .kv div{padding:11px 18px;border-bottom:1px solid var(--border)}
  .kv div:nth-child(odd){font-weight:700;color:var(--muted);background:rgba(236,240,237,.4)}
  .kv div:nth-last-child(-n+2){border-bottom:0}
  .good{color:var(--ok);font-weight:800}.badc{color:var(--bad);font-weight:800}
  code{font:12.5px ui-monospace,Menlo,Consolas,monospace;background:#fff;border:1px solid var(--border);border-radius:5px;padding:1px 6px}
  ul.l{margin:0;padding:0;list-style:none} ul.l li{padding:6px 18px;border-bottom:1px solid var(--border);font-size:13px} ul.l li:last-child{border-bottom:0}
  @media(max-width:800px){.grid{grid-template-columns:repeat(2,1fr)}.verdict{flex-wrap:wrap}.meta{margin-left:0;text-align:left}.kv{grid-template-columns:1fr}}
`;

/** Default skin. Override any --saydo-* variable on .saydo-root, or pass ui={false} and build your own. */
export const STYLES = `
.saydo-root{--saydo-bg:#ffffff;--saydo-fg:#111827;--saydo-muted:#6b7280;--saydo-border:#e5e7eb;--saydo-surface:#f6f7f9;--saydo-accent:#4f46e5;--saydo-accent-fg:#ffffff;--saydo-danger:#dc2626;--saydo-danger-bg:#fef2f2;--saydo-radius:12px;--saydo-shadow:0 24px 60px rgba(15,23,42,.25);--saydo-font:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-family:var(--saydo-font);color:var(--saydo-fg)}
@media (prefers-color-scheme:dark){.saydo-root{--saydo-bg:#0f172a;--saydo-fg:#e5e7eb;--saydo-muted:#94a3b8;--saydo-border:#1e293b;--saydo-surface:#111c33;--saydo-accent:#818cf8;--saydo-accent-fg:#0b1020;--saydo-danger:#f87171;--saydo-danger-bg:#2a1215;--saydo-shadow:0 24px 60px rgba(0,0,0,.6)}}
.saydo-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.saydo-launcher{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;gap:8px;align-items:center;padding:10px 14px;border-radius:999px;border:1px solid var(--saydo-border);background:var(--saydo-bg);color:var(--saydo-fg);box-shadow:0 6px 20px rgba(15,23,42,.15);font:500 14px var(--saydo-font);cursor:pointer}
.saydo-launcher kbd{font:11px var(--saydo-font);color:var(--saydo-muted);border:1px solid var(--saydo-border);border-radius:6px;padding:1px 5px}
.saydo-launcher:focus-visible,.saydo-root button:focus-visible,.saydo-root input:focus-visible{outline:2px solid var(--saydo-accent);outline-offset:2px}
.saydo-overlay{position:fixed;inset:0;z-index:2147483001;background:rgba(15,23,42,.35);display:flex;justify-content:center;align-items:flex-start;padding:10vh 16px 16px}
.saydo-dialog{width:min(640px,100%);max-height:75vh;display:flex;flex-direction:column;background:var(--saydo-bg);border:1px solid var(--saydo-border);border-radius:var(--saydo-radius);box-shadow:var(--saydo-shadow);overflow:hidden}
.saydo-inputrow{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--saydo-border)}
.saydo-inputrow input{flex:1;border:0;background:transparent;color:var(--saydo-fg);font:16px var(--saydo-font);outline:none}
.saydo-spinner{width:16px;height:16px;border-radius:50%;border:2px solid var(--saydo-border);border-top-color:var(--saydo-accent);animation:saydo-spin .8s linear infinite}
@keyframes saydo-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.saydo-spinner{animation:none}}
.saydo-disclosure{margin:0;padding:6px 16px;font-size:12px;color:var(--saydo-muted);border-bottom:1px solid var(--saydo-border)}
.saydo-body{overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px}
.saydo-item{font-size:14px;line-height:1.45;padding:8px 12px;border-radius:10px;max-width:90%;white-space:pre-wrap;overflow-wrap:anywhere}
.saydo-user{align-self:flex-end;background:var(--saydo-accent);color:var(--saydo-accent-fg)}
.saydo-assistant{align-self:flex-start;background:var(--saydo-surface)}
.saydo-action{align-self:flex-start;font-size:13px;color:var(--saydo-muted);padding:2px 12px}
.saydo-action[data-status="ok"]::before{content:"✓ "}
.saydo-notice{font-size:13px;color:var(--saydo-muted);background:var(--saydo-surface);border:1px dashed var(--saydo-border);border-radius:10px;padding:8px 12px}
.saydo-notice button,.saydo-footer button{background:none;border:0;color:var(--saydo-accent);font:inherit;cursor:pointer;padding:0;text-decoration:underline}
.saydo-section{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--saydo-muted);margin:6px 0 2px}
.saydo-option{display:flex;justify-content:space-between;gap:12px;width:100%;text-align:left;padding:8px 10px;border-radius:8px;border:0;background:transparent;color:var(--saydo-fg);font:14px var(--saydo-font);cursor:pointer}
.saydo-option[aria-selected="true"],.saydo-option:hover{background:var(--saydo-surface)}
.saydo-option small{color:var(--saydo-muted);font-family:ui-monospace,monospace}
.saydo-hint{font-size:13px;color:var(--saydo-muted);margin:4px 0}
.saydo-footer{display:flex;justify-content:space-between;align-items:center;padding:8px 16px;border-top:1px solid var(--saydo-border);font-size:12px;color:var(--saydo-muted)}
.saydo-confirm{border:1px solid var(--saydo-border);border-radius:10px;padding:14px;background:var(--saydo-bg)}
.saydo-confirm.danger{border-color:var(--saydo-danger);background:var(--saydo-danger-bg)}
.saydo-confirm h2{font-size:16px;margin:2px 0 10px}
.saydo-kicker{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--saydo-muted);margin:0}
.saydo-confirm.danger .saydo-kicker{color:var(--saydo-danger)}
.saydo-confirm dl{margin:0 0 10px;display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;font-size:14px}
.saydo-confirm dt{color:var(--saydo-muted)}
.saydo-confirm dd{margin:0;overflow-wrap:anywhere}
.saydo-confirm dd.untrusted{font-family:ui-monospace,monospace;font-size:13px}
.saydo-confirm label{display:block;font-size:13px;margin-bottom:10px}
.saydo-confirm label input{display:block;margin-top:4px;width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid var(--saydo-border);border-radius:8px;background:var(--saydo-bg);color:var(--saydo-fg);font:14px var(--saydo-font)}
.saydo-batch{margin:0 0 10px;padding-left:20px;display:grid;gap:8px;font-size:14px}
.saydo-batch dl{margin:4px 0 0}
.saydo-error{color:var(--saydo-danger);font-size:13px;margin:0 0 8px}
.saydo-actions{display:flex;justify-content:flex-end;gap:8px}
.saydo-actions button{padding:7px 14px;border-radius:8px;border:1px solid var(--saydo-border);background:var(--saydo-bg);color:var(--saydo-fg);font:500 14px var(--saydo-font);cursor:pointer}
.saydo-actions button.primary{background:var(--saydo-accent);border-color:var(--saydo-accent);color:var(--saydo-accent-fg)}
.saydo-confirm.danger .saydo-actions button.primary{background:var(--saydo-danger);border-color:var(--saydo-danger);color:#fff}
.saydo-actions button:disabled{opacity:.5;cursor:not-allowed}
.saydo-fineprint{font-size:11px;color:var(--saydo-muted);margin:10px 0 0}
.saydo-toasts{position:fixed;left:20px;bottom:20px;z-index:2147483002;display:flex;flex-direction:column;gap:8px}
.saydo-toast{display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:10px;background:var(--saydo-fg);color:var(--saydo-bg);font-size:14px;box-shadow:0 6px 20px rgba(15,23,42,.25)}
.saydo-toast button{background:none;border:0;color:inherit;font:600 14px var(--saydo-font);cursor:pointer;text-decoration:underline}
.saydo-inspect ul{list-style:none;margin:0 0 8px;padding:0;display:grid;gap:4px;font-size:13px}
.saydo-inspect li{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}
.saydo-inspect small{flex-basis:100%;color:var(--saydo-muted)}
.saydo-pill{font-size:11px;padding:1px 6px;border-radius:999px;background:var(--saydo-surface);color:var(--saydo-muted);border:1px solid var(--saydo-border)}
.saydo-pre{white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace;background:var(--saydo-surface);border-radius:8px;padding:8px;max-height:220px;overflow:auto;margin:0}
@media (max-width:480px){.saydo-launcher{right:16px;bottom:16px}.saydo-toasts{left:16px;right:16px}.saydo-overlay{padding-top:16px}}
.saydo-history .saydo-option{padding:0;align-items:stretch}
.saydo-history .saydo-option button{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:8px 10px;border-radius:8px}
.saydo-history .saydo-option button:first-child{flex:1;display:flex;justify-content:space-between;gap:12px;text-align:left;min-width:0}
.saydo-history .saydo-option button:first-child span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.saydo-history .saydo-option[aria-current="true"]{background:var(--saydo-surface)}
`;

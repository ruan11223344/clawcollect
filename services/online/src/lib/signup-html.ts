function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function baseLayout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
*,*::before,*::after{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;background:linear-gradient(180deg,#f7f8fb 0%,#eef2ff 100%);line-height:1.5;-webkit-font-smoothing:antialiased}
.cc-wrap{max-width:760px;margin:48px auto;padding:0 20px}
.cc-hero{display:grid;gap:20px}
.cc-card{background:#fff;border-radius:18px;padding:32px;box-shadow:0 10px 40px rgba(15,23,42,.08)}
.cc-eyebrow{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:.78rem;font-weight:700;letter-spacing:.02em;text-transform:uppercase}
h1{font-size:2rem;line-height:1.15;margin:14px 0 10px}
.cc-sub{color:#475569;font-size:1.02rem;margin:0}
.cc-grid{display:grid;gap:24px;grid-template-columns:1.1fr .9fr}
.cc-panel{background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:20px}
.cc-panel h2{font-size:1rem;margin:0 0 10px}
.cc-list{margin:0;padding-left:18px;color:#475569}
.cc-list li+li{margin-top:8px}
.cc-form{display:grid;gap:16px;margin-top:12px}
.cc-field label{display:block;font-size:.9rem;font-weight:600;margin-bottom:6px}
.cc-field input{width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:12px;font-size:.96rem;background:#fff}
.cc-field input:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 4px rgba(37,99,235,.12)}
.cc-note{font-size:.86rem;color:#64748b;margin:0}
.cc-alert{padding:14px 16px;border-radius:12px;font-size:.92rem}
.cc-alert-error{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
.cc-alert-success{background:#ecfdf5;border:1px solid #a7f3d0;color:#166534}
.cc-btn{display:inline-flex;align-items:center;justify-content:center;width:100%;padding:13px 16px;border:none;border-radius:12px;background:#0f172a;color:#fff;font-size:1rem;font-weight:600;cursor:pointer}
.cc-btn:hover{background:#111827}
.cc-code{margin-top:16px;padding:16px;border-radius:14px;background:#0f172a;color:#e2e8f0;overflow:auto;font-size:.88rem;line-height:1.55}
.cc-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px}
.cc-btn-secondary{background:#fff;color:#0f172a;border:1px solid #cbd5e1}
.cc-btn-secondary:hover{background:#f8fafc}
.cc-small{font-size:.84rem;color:#64748b}
.cc-footer{text-align:center;padding:20px 0 8px;color:#94a3b8;font-size:.8rem}
@media (max-width: 760px){
  .cc-grid{grid-template-columns:1fr}
  .cc-wrap{margin:24px auto}
  .cc-card{padding:24px}
  h1{font-size:1.65rem}
}
</style>
</head>
<body>
<div class="cc-wrap">
${body}
<div class="cc-footer">Hosted by ClawCollect on Dorapush</div>
</div>
</body>
</html>`;
}

function valueAttr(value: string | undefined): string {
  return value ? ` value="${esc(value)}"` : "";
}

export function renderSignupPage(data: {
  apiUrl: string;
  error?: string;
  requiresCode: boolean;
  values?: {
    workspaceName?: string;
    ownerName?: string;
    ownerEmail?: string;
  };
}): string {
  const errorHtml = data.error
    ? `<div class="cc-alert cc-alert-error">${esc(data.error)}</div>`
    : "";

  const codeField = data.requiresCode
    ? `
      <div class="cc-field">
        <label for="signup_code">Access code</label>
        <input id="signup_code" name="signupCode" type="password" autocomplete="one-time-code" required>
      </div>`
    : "";

  return baseLayout("Start Hosted ClawCollect", `
  <div class="cc-hero">
    <div class="cc-card">
      <span class="cc-eyebrow">Hosted Beta</span>
      <h1>Start using ClawCollect without deploying anything</h1>
      <p class="cc-sub">Create your own hosted workspace, get a dedicated API token, and connect OpenClaw in a few minutes.</p>
    </div>

    <div class="cc-grid">
      <div class="cc-card">
        <h2>Create your hosted workspace</h2>
        <p class="cc-note">You will receive a workspace-scoped API token. It is shown once, so save it immediately.</p>
        ${errorHtml}
        <form class="cc-form" method="post" action="/signup">
          <div class="cc-field">
            <label for="workspace_name">Workspace name</label>
            <input id="workspace_name" name="workspaceName" type="text" required${valueAttr(data.values?.workspaceName)}>
          </div>
          <div class="cc-field">
            <label for="owner_name">Your name</label>
            <input id="owner_name" name="ownerName" type="text"${valueAttr(data.values?.ownerName)}>
          </div>
          <div class="cc-field">
            <label for="owner_email">Email</label>
            <input id="owner_email" name="ownerEmail" type="email" required${valueAttr(data.values?.ownerEmail)}>
          </div>
          ${codeField}
          <button class="cc-btn" type="submit">Create hosted workspace</button>
        </form>
      </div>

      <div class="cc-card">
        <div class="cc-panel">
          <h2>What you get</h2>
          <ul class="cc-list">
            <li>Your own isolated workspace</li>
            <li>Your own API token</li>
            <li>Hosted form pages on <code>${esc(data.apiUrl)}</code></li>
            <li>No Cloudflare deployment required</li>
          </ul>
        </div>
        <div class="cc-panel" style="margin-top:16px">
          <h2>How it works</h2>
          <ul class="cc-list">
            <li>Install the OpenClaw plugin from npm</li>
            <li>Paste the hosted <code>apiUrl</code> and your token into plugin config</li>
            <li>Run <code>/collect form open</code> in chat</li>
          </ul>
        </div>
      </div>
    </div>
  </div>`);
}

export function renderSignupSuccessPage(data: {
  apiUrl: string;
  workspaceName: string;
  ownerEmail: string;
  token: string;
}): string {
  const configSnippet = `online: {
  enabled: true,
  apiUrl: "${data.apiUrl}",
  apiToken: "${data.token}"
}`;

  return baseLayout("Hosted Workspace Ready", `
  <div class="cc-card">
    <span class="cc-eyebrow">Workspace Ready</span>
    <h1>Your hosted workspace is ready</h1>
    <div class="cc-alert cc-alert-success">Workspace <strong>${esc(data.workspaceName)}</strong> has been created for ${esc(data.ownerEmail)}.</div>
    <p class="cc-note">Save this token now. It will not be shown again.</p>

    <div class="cc-panel" style="margin-top:18px">
      <h2>OpenClaw config</h2>
      <pre id="cc-config" class="cc-code">${esc(configSnippet)}</pre>
      <div class="cc-actions">
        <button id="cc-copy-config" type="button" class="cc-btn cc-btn-secondary">Copy config</button>
      </div>
    </div>

    <div class="cc-panel" style="margin-top:16px">
      <h2>Next steps</h2>
      <ol class="cc-list">
        <li>Install the plugin: <code>openclaw plugins install @clawcollect/clawcollect</code></li>
        <li>Add the config snippet above to your OpenClaw plugin config</li>
        <li>Enable the plugin and restart the daemon</li>
        <li>Run <code>/collect form open</code> in chat</li>
      </ol>
    </div>

    <p class="cc-small" style="margin-top:18px">Hosted service URL: <code>${esc(data.apiUrl)}</code></p>
  </div>
  <script>
  (function(){
    var btn = document.getElementById('cc-copy-config');
    var block = document.getElementById('cc-config');
    if(!btn || !block || !navigator.clipboard) return;
    btn.addEventListener('click', function(){
      navigator.clipboard.writeText(block.textContent || '').then(function(){
        btn.textContent = 'Copied';
        setTimeout(function(){ btn.textContent = 'Copy config'; }, 1200);
      });
    });
  })();
  </script>`);
}

export function renderSignupDisabledPage(): string {
  return baseLayout("Signup Unavailable", `
  <div class="cc-card">
    <span class="cc-eyebrow">Signup Closed</span>
    <h1>Hosted signup is not available right now</h1>
    <p class="cc-sub">Please contact the operator for manual provisioning.</p>
  </div>`);
}

/**
 * Minimal HTML renderer for public form pages.
 *
 * No framework — just template literals returning HTML strings.
 * Inline CSS for zero external dependencies.
 */

import type { FieldDefinition } from "./validation";

// ── Shared layout ────────────────────────────────────────────────

function layout(title: string, body: string, opts?: { branding?: boolean }): string {
  const brandingHtml = opts?.branding !== false
    ? `<footer class="cc-footer">Powered by <a href="https://github.com/nicepkg/openclaw" target="_blank" rel="noopener">ClawCollect</a></footer>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
*,*::before,*::after{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;background:#f5f5f7;line-height:1.5;-webkit-font-smoothing:antialiased}
.cc-wrap{max-width:560px;margin:40px auto;padding:0 20px}
.cc-card{background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:1.5rem;font-weight:600;margin:0 0 4px}
h2{font-size:1rem;font-weight:600;margin:0 0 12px}
.cc-desc{color:#666;margin:0 0 24px;font-size:.95rem}
.cc-field{margin-bottom:20px}
.cc-field label{display:block;font-weight:500;margin-bottom:6px;font-size:.9rem}
.cc-field .cc-req{color:#e53935;margin-left:2px}
.cc-field input[type="text"],.cc-field input[type="email"],.cc-field input[type="number"],.cc-field input[type="date"],.cc-field input[type="password"],.cc-field textarea,.cc-field select{width:100%;padding:10px 12px;border:1px solid #d0d0d0;border-radius:8px;font-size:.95rem;font-family:inherit;transition:border-color .15s;background:#fff;appearance:none;-webkit-appearance:none}
.cc-field textarea{min-height:100px;resize:vertical}
.cc-field select{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='7'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23666' stroke-width='1.5' fill='none'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:32px}
.cc-field input:focus,.cc-field textarea:focus,.cc-field select:focus{outline:none;border-color:#0066ff;box-shadow:0 0 0 3px rgba(0,102,255,.12)}
.cc-field .cc-checkbox-row{display:flex;align-items:center;gap:8px}
.cc-field input[type="checkbox"]{width:18px;height:18px;accent-color:#0066ff;flex-shrink:0}
.cc-field .cc-err{color:#e53935;font-size:.85rem;margin-top:4px;display:none}
.cc-field.has-error input,.cc-field.has-error textarea,.cc-field.has-error select{border-color:#e53935}
.cc-field.has-error .cc-err{display:block}
.cc-btn{display:block;width:100%;padding:12px;background:#0066ff;color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:500;cursor:pointer;transition:background .15s;margin-top:24px}
.cc-btn:hover{background:#0052cc}
.cc-btn:disabled{background:#999;cursor:not-allowed}
.cc-alert{padding:16px;border-radius:8px;margin-bottom:20px;font-size:.9rem}
.cc-alert-error{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
.cc-alert-success{background:#f0fdf4;color:#166534;border:1px solid #bbf7d0}
.cc-status{text-align:center;padding:48px 20px}
.cc-status h1{font-size:1.3rem;margin-bottom:8px}
.cc-status p{color:#666;margin:0}
.cc-confirmation{display:none}
.cc-summary{border:1px solid #e5e7eb;border-radius:10px;padding:18px;background:#fafafa}
.cc-summary-list{display:grid;gap:14px}
.cc-summary-row{padding-bottom:14px;border-bottom:1px solid #e5e7eb}
.cc-summary-row:last-child{padding-bottom:0;border-bottom:none}
.cc-summary-label{font-size:.8rem;font-weight:600;color:#666;margin-bottom:4px}
.cc-summary-value{white-space:pre-wrap;word-break:break-word}
.cc-edit-note{font-size:.85rem;color:#666;margin:12px 0 0}
.cc-confirmation-actions{display:none;gap:12px;flex-wrap:wrap;margin-top:20px}
.cc-btn-secondary{width:auto;margin-top:0;background:#fff;color:#1a1a1a;border:1px solid #d0d0d0}
.cc-btn-secondary:hover{background:#f5f5f5}
.cc-footer{text-align:center;padding:24px 0 16px;font-size:.8rem;color:#999}
.cc-footer a{color:#999;text-decoration:underline}
.cc-unknown{padding:10px 12px;background:#fff8e1;border:1px solid #ffe082;border-radius:8px;font-size:.85rem;color:#795548}
#cc-form-errors{display:none}
</style>
</head>
<body>
<div class="cc-wrap">
${body}
${brandingHtml}
</div>
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Field rendering ──────────────────────────────────────────────

function renderField(f: FieldDefinition): string {
  const req = f.required ? `<span class="cc-req">*</span>` : "";
  const id = `field_${esc(f.id)}`;

  switch (f.type) {
    case "text":
      return fieldWrap(f.id, `
        <label for="${id}">${esc(f.label)}${req}</label>
        <input type="text" id="${id}" name="${esc(f.id)}"${attr("minlength", f.minLength)}${attr("maxlength", f.maxLength)}${f.pattern ? ` pattern="${esc(f.pattern)}"` : ""}${f.required ? " required" : ""}>
        <div class="cc-err" id="err_${esc(f.id)}"></div>
      `);

    case "textarea":
      return fieldWrap(f.id, `
        <label for="${id}">${esc(f.label)}${req}</label>
        <textarea id="${id}" name="${esc(f.id)}"${attr("minlength", f.minLength)}${attr("maxlength", f.maxLength)}${f.required ? " required" : ""}></textarea>
        <div class="cc-err" id="err_${esc(f.id)}"></div>
      `);

    case "email":
      return fieldWrap(f.id, `
        <label for="${id}">${esc(f.label)}${req}</label>
        <input type="email" id="${id}" name="${esc(f.id)}"${f.required ? " required" : ""}>
        <div class="cc-err" id="err_${esc(f.id)}"></div>
      `);

    case "number":
      return fieldWrap(f.id, `
        <label for="${id}">${esc(f.label)}${req}</label>
        <input type="number" id="${id}" name="${esc(f.id)}"${attr("min", f.min)}${attr("max", f.max)}${f.required ? " required" : ""} step="any">
        <div class="cc-err" id="err_${esc(f.id)}"></div>
      `);

    case "select": {
      const opts = (f.options ?? []).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join("");
      return fieldWrap(f.id, `
        <label for="${id}">${esc(f.label)}${req}</label>
        <select id="${id}" name="${esc(f.id)}"${f.required ? " required" : ""}>
          <option value="">— Select —</option>
          ${opts}
        </select>
        <div class="cc-err" id="err_${esc(f.id)}"></div>
      `);
    }

    case "checkbox":
      return fieldWrap(f.id, `
        <div class="cc-checkbox-row">
          <input type="checkbox" id="${id}" name="${esc(f.id)}"${f.required ? " required" : ""}>
          <label for="${id}">${esc(f.label)}${req}</label>
        </div>
        <div class="cc-err" id="err_${esc(f.id)}"></div>
      `);

    case "date":
      return fieldWrap(f.id, `
        <label for="${id}">${esc(f.label)}${req}</label>
        <input type="date" id="${id}" name="${esc(f.id)}"${f.required ? " required" : ""}>
        <div class="cc-err" id="err_${esc(f.id)}"></div>
      `);

    default:
      return `<div class="cc-field"><div class="cc-unknown">Unsupported field type: "${esc(String((f as { type: string }).type))}" (${esc(f.label)})</div></div>`;
  }
}

function fieldWrap(fieldId: string, inner: string): string {
  return `<div class="cc-field" data-field="${esc(fieldId)}">${inner}</div>`;
}

function attr(name: string, value: number | undefined): string {
  return value !== undefined ? ` ${name}="${value}"` : "";
}

// ── Page renderers ───────────────────────────────────────────────

export interface FormPageData {
  title: string;
  description: string;
  schema: FieldDefinition[];
  branding: boolean;
  submitUrl: string;
  editUrlBase: string;
}

function renderConfirmationSection(): string {
  return `
  <div id="cc-success" class="cc-confirmation">
    <div id="cc-success-banner" class="cc-alert cc-alert-success"></div>
    <div class="cc-summary">
      <h2>Submitted Response</h2>
      <div id="cc-summary-list" class="cc-summary-list"></div>
    </div>
    <p id="cc-edit-note" class="cc-edit-note" style="display:none"></p>
    <div id="cc-success-actions" class="cc-confirmation-actions">
      <button type="button" id="cc-edit-btn" class="cc-btn cc-btn-secondary">Edit response</button>
    </div>
  </div>`;
}

function renderClientScript(data: FormPageData): string {
  const schemaJson = JSON.stringify(data.schema);

  return `
<script>
(function(){
  var form = document.getElementById("cc-form");
  var errBox = document.getElementById("cc-form-errors");
  var successBox = document.getElementById("cc-success");
  var successBanner = document.getElementById("cc-success-banner");
  var summaryList = document.getElementById("cc-summary-list");
  var editNote = document.getElementById("cc-edit-note");
  var editActions = document.getElementById("cc-success-actions");
  var editBtn = document.getElementById("cc-edit-btn");
  var pwSection = document.getElementById("cc-pw-section");
  var formSection = document.getElementById("cc-form-section");
  var pwForm = document.getElementById("cc-pw-form");
  var pwErr = document.getElementById("cc-pw-err");
  var passwordInput = document.getElementById("cc-password");
  var schema = ${schemaJson};
  var submitUrl = ${JSON.stringify(data.submitUrl)};
  var editUrlBase = ${JSON.stringify(data.editUrlBase)};
  var mode = "create";
  var password = null;
  var requestInFlight = false;
  var submission = null;

  function escapeHtml(value){
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function parseResponse(res){
    return res.text().then(function(text){
      if(!text) return {status: res.status, body: {}};
      try {
        return {status: res.status, body: JSON.parse(text)};
      } catch {
        return {status: res.status, body: {error: text}};
      }
    });
  }

  function hasOwn(obj, key){
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function resetErrors(){
    if(errBox){
      errBox.style.display = "none";
      errBox.textContent = "";
    }
    document.querySelectorAll(".cc-field.has-error").forEach(function(el){ el.classList.remove("has-error"); });
    document.querySelectorAll(".cc-err").forEach(function(el){ el.textContent = ""; el.style.display = "none"; });
  }

  function showFormError(message){
    if(!errBox) return;
    errBox.textContent = message;
    errBox.style.display = "block";
  }

  function showPasswordError(message){
    if(!pwErr) return;
    pwErr.textContent = message;
    pwErr.style.display = "block";
  }

  function clearPasswordError(){
    if(!pwErr) return;
    pwErr.textContent = "";
    pwErr.style.display = "none";
  }

  function collectData(){
    var data = {};
    schema.forEach(function(field){
      var el = document.getElementById("field_" + field.id);
      if(!el) return;
      if(field.type === "checkbox"){
        data[field.id] = !!el.checked;
        return;
      }
      if(field.type === "number"){
        if(el.value !== "") data[field.id] = parseFloat(el.value);
        return;
      }
      if(el.value !== "") data[field.id] = el.value;
    });
    return data;
  }

  function fillForm(data){
    schema.forEach(function(field){
      var el = document.getElementById("field_" + field.id);
      if(!el) return;
      if(field.type === "checkbox"){
        el.checked = !!(data && hasOwn(data, field.id) && data[field.id]);
        return;
      }
      if(data && hasOwn(data, field.id) && data[field.id] !== null && data[field.id] !== undefined){
        el.value = String(data[field.id]);
      } else {
        el.value = "";
      }
    });
  }

  function formatFieldValue(field, value){
    if(field.type === "checkbox") return value ? "Yes" : "No";
    if(value === undefined || value === null || value === "") return "";
    return String(value);
  }

  function renderSummary(data){
    if(!summaryList) return;
    var rows = [];
    schema.forEach(function(field){
      if(!hasOwn(data, field.id)) return;
      rows.push(
        '<div class="cc-summary-row">' +
          '<div class="cc-summary-label">' + escapeHtml(field.label) + '</div>' +
          '<div class="cc-summary-value">' + escapeHtml(formatFieldValue(field, data[field.id])) + '</div>' +
        '</div>'
      );
    });

    if(rows.length === 0){
      rows.push('<div class="cc-summary-row"><div class="cc-summary-value">No answers were captured.</div></div>');
    }

    summaryList.innerHTML = rows.join("");
  }

  function setSubmitState(busy){
    if(!form) return;
    var btn = form.querySelector("button[type=submit]");
    if(!btn) return;
    btn.disabled = busy;
    if(mode === "edit"){
      btn.textContent = busy ? "Saving…" : "Save changes";
      return;
    }
    btn.textContent = busy ? "Submitting…" : "Submit";
  }

  function showConfirmation(message){
    if(!submission || !successBox || !successBanner) return;
    renderSummary(submission.data || {});
    successBanner.textContent = message;
    successBox.style.display = "block";
    if(form) form.style.display = "none";
    if(formSection) formSection.style.display = "block";

    var canEdit = !!submission.editToken;
    if(editActions) editActions.style.display = canEdit ? "flex" : "none";
    if(editNote){
      if(canEdit){
        if(submission.editExpiresAt){
          var expiresAt = new Date(submission.editExpiresAt * 1000);
          if(!Number.isNaN(expiresAt.getTime())){
            editNote.textContent = "You can edit this response until " + expiresAt.toLocaleString() + ".";
          } else {
            editNote.textContent = "You can edit this response from this device using the button below.";
          }
        } else {
          editNote.textContent = "You can edit this response from this device using the button below.";
        }
        editNote.style.display = "block";
      } else {
        editNote.textContent = submission.editLockedMessage || "";
        editNote.style.display = submission.editLockedMessage ? "block" : "none";
      }
    }

    mode = canEdit ? "edit" : "locked";
    setSubmitState(false);
  }

  function beginEdit(){
    if(!submission || !submission.editToken || !form || !successBox) return;
    fillForm(submission.data || {});
    resetErrors();
    successBox.style.display = "none";
    form.style.display = "block";
    if(formSection) formSection.style.display = "block";
    mode = "edit";
    setSubmitState(false);

    var firstInput = form.querySelector("input, textarea, select");
    if(firstInput && typeof firstInput.focus === "function"){
      firstInput.focus();
    }
  }

  function lockEditing(message){
    if(!submission) return;
    submission.editToken = null;
    submission.editLockedMessage = message;
    showConfirmation("Your response has been submitted. Thank you!");
  }

  function handleValidationErrors(fieldErrors){
    fieldErrors.forEach(function(fe){
      var wrap = document.querySelector('[data-field="' + fe.field + '"]');
      var errEl = document.getElementById("err_" + fe.field);
      if(wrap) wrap.classList.add("has-error");
      if(errEl){
        errEl.textContent = fe.message;
        errEl.style.display = "block";
      }
    });
    showFormError("Please fix the errors below.");
  }

  if(editBtn){
    editBtn.addEventListener("click", function(){
      beginEdit();
    });
  }

  if(pwForm){
    pwForm.addEventListener("submit", function(e){
      e.preventDefault();
      var pw = passwordInput ? passwordInput.value : "";
      if(!pw){
        showPasswordError("Password required.");
        return;
      }
      clearPasswordError();
      password = pw;
      if(pwSection) pwSection.style.display = "none";
      if(formSection) formSection.style.display = "block";
      if(form) form.style.display = "block";
      if(successBox) successBox.style.display = "none";
      mode = "create";
      setSubmitState(false);
    });
  }

  if(!form) return;

  form.addEventListener("submit", function(e){
    e.preventDefault();
    if(requestInFlight || mode === "locked") return;

    resetErrors();
    clearPasswordError();

    var data = collectData();
    var method = "POST";
    var url = submitUrl;
    var payload;

    if(mode === "edit" && submission && submission.id && submission.editToken){
      method = "PUT";
      url = editUrlBase + "/" + encodeURIComponent(submission.id);
      payload = {edit_token: submission.editToken, data: data};
    } else {
      payload = {data: data};
      if(password) payload.password = password;
    }

    requestInFlight = true;
    setSubmitState(true);

    fetch(url, {
      method: method,
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    })
    .then(parseResponse)
    .then(function(result){
      requestInFlight = false;

      if(method === "POST" && result.status === 201){
        submission = {
          id: result.body.id,
          data: data,
        editToken: result.body.edit_token || null,
        editExpiresAt: result.body.edit_expires_at || null,
        editLockedMessage: null
        };
        showConfirmation("Your response has been submitted. Thank you!");
        return;
      }

      if(method === "PUT" && result.status === 200){
        submission.data = data;
        submission.editLockedMessage = null;
        showConfirmation("Your response has been updated.");
        return;
      }

      setSubmitState(false);

      if(method === "POST" && (result.body.error === "Password required" || result.body.error === "Invalid password")){
        if(formSection) formSection.style.display = "none";
        if(pwSection) pwSection.style.display = "block";
        if(passwordInput) passwordInput.value = "";
        password = null;
        mode = "create";
        showPasswordError(result.body.error === "Invalid password" ? "Incorrect password. Please try again." : "Password required.");
        return;
      }

      if(method === "PUT" && (
        result.body.error === "Edit window has expired" ||
        result.body.error === "Invalid edit token" ||
        result.body.error === "This response is not editable" ||
        result.body.error === "This form does not allow response editing" ||
        result.body.error === "Response not found"
      )){
        lockEditing(
          result.body.error === "Edit window has expired"
            ? "The edit window has expired. Your saved response is shown below."
            : "This response can no longer be edited."
        );
        return;
      }

      if(result.body.error === "validation_failed" && result.body.field_errors){
        handleValidationErrors(result.body.field_errors);
        return;
      }

      showFormError(result.body.error || "Something went wrong. Please try again.");
    })
    .catch(function(){
      requestInFlight = false;
      setSubmitState(false);
      showFormError("Network error. Please check your connection and try again.");
    });
  });
})();
</script>`;
}

export function renderFormPage(data: FormPageData): string {
  const fields = data.schema.map(renderField).join("\n");

  const body = `
<div class="cc-card">
  <h1>${esc(data.title)}</h1>
  ${data.description ? `<p class="cc-desc">${esc(data.description)}</p>` : ""}

  <div id="cc-form-errors" class="cc-alert cc-alert-error"></div>
  ${renderConfirmationSection()}

  <form id="cc-form" novalidate>
    ${fields}
    <button type="submit" class="cc-btn">Submit</button>
  </form>
</div>

${renderClientScript(data)}`;

  return layout(data.title, body, { branding: data.branding });
}

export function renderPasswordFormPage(data: FormPageData): string {
  const fields = data.schema.map(renderField).join("\n");

  const body = `
<div class="cc-card">
  <h1>${esc(data.title)}</h1>
  ${data.description ? `<p class="cc-desc">${esc(data.description)}</p>` : ""}

  <div id="cc-pw-section">
    <p class="cc-desc">This form is password-protected.</p>
    <div id="cc-pw-err" class="cc-alert cc-alert-error" style="display:none"></div>
    <form id="cc-pw-form">
      <div class="cc-field">
        <label for="cc-password">Password</label>
        <input type="password" id="cc-password" name="password" required>
      </div>
      <button type="submit" class="cc-btn">Continue</button>
    </form>
  </div>

  <div id="cc-form-section" style="display:none">
    <div id="cc-form-errors" class="cc-alert cc-alert-error" style="display:none"></div>
    ${renderConfirmationSection()}
    <form id="cc-form" novalidate>
      ${fields}
      <button type="submit" class="cc-btn">Submit</button>
    </form>
  </div>
</div>

${renderClientScript(data)}`;

  return layout(data.title, body, { branding: data.branding });
}

export function renderStatusPage(title: string, message: string, branding = true): string {
  const body = `
<div class="cc-card">
  <div class="cc-status">
    <h1>${esc(title)}</h1>
    <p>${esc(message)}</p>
  </div>
</div>`;
  return layout(title, body, { branding });
}

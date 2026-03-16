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
.cc-field .cc-checkbox-row,.cc-field .cc-radio-row{display:flex;align-items:center;gap:8px;margin-top:6px}
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
.cc-field input[type="file"]{width:100%;padding:8px 0;border:none;font-size:.9rem;cursor:pointer}
.cc-upload-status{font-size:.82rem;color:#555;margin-top:4px;display:none}
.cc-file-link{font-size:.85rem;color:#0066ff;word-break:break-all}
.cc-hint{font-size:.82rem;color:#888;margin-top:3px;margin-bottom:0}
.cc-char-count{font-size:.78rem;color:#aaa;text-align:right;margin-top:2px}
.cc-char-count.cc-near-limit{color:#f5a623}
.cc-char-count.cc-at-limit{color:#e53935}
.cc-rating{display:flex;gap:6px;flex-direction:row-reverse;justify-content:flex-end;margin-top:6px}
.cc-rating input{display:none}
.cc-rating label{font-size:1.8rem;color:#d0d0d0;cursor:pointer;transition:color .1s;line-height:1}
.cc-rating input:checked~label,.cc-rating label:hover,.cc-rating label:hover~label{color:#f5a623}
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
        ${hintHtml(f.hint)}<div class="cc-err" id="err_${esc(f.id)}"></div>
      `);

    case "textarea":
      return fieldWrap(f.id, `
        <label for="${id}">${esc(f.label)}${req}</label>
        <textarea id="${id}" name="${esc(f.id)}"${attr("minlength", f.minLength)}${attr("maxlength", f.maxLength)}${f.required ? " required" : ""}></textarea>
        ${f.maxLength !== undefined ? `<div class="cc-char-count" id="cc_count_${esc(f.id)}">0 / ${f.maxLength}</div>` : ""}
        ${hintHtml(f.hint)}<div class="cc-err" id="err_${esc(f.id)}"></div>
      `);

    case "email":
      return fieldWrap(f.id, `
        <label for="${id}">${esc(f.label)}${req}</label>
        <input type="email" id="${id}" name="${esc(f.id)}"${f.required ? " required" : ""}>
        ${hintHtml(f.hint)}<div class="cc-err" id="err_${esc(f.id)}"></div>
      `);

    case "number":
      return fieldWrap(f.id, `
        <label for="${id}">${esc(f.label)}${req}</label>
        <input type="number" id="${id}" name="${esc(f.id)}"${attr("min", f.min)}${attr("max", f.max)}${f.required ? " required" : ""} step="any">
        ${hintHtml(f.hint)}<div class="cc-err" id="err_${esc(f.id)}"></div>
      `);

    case "select": {
      const opts = (f.options ?? []).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join("");
      return fieldWrap(f.id, `
        <label for="${id}">${esc(f.label)}${req}</label>
        <select id="${id}" name="${esc(f.id)}"${f.required ? " required" : ""}>
          <option value="">— 请选择 —</option>
          ${opts}
        </select>
        ${hintHtml(f.hint)}<div class="cc-err" id="err_${esc(f.id)}"></div>
      `);
    }

    case "checkbox": {
      if (f.options && f.options.length > 0) {
        // checkbox group (multi-select)
        const cbOpts = f.options.map((o, i) => `
        <div class="cc-checkbox-row">
          <input type="checkbox" id="${id}_${i}" name="${esc(f.id)}" value="${esc(o)}">
          <label for="${id}_${i}">${esc(o)}</label>
        </div>`).join("");
        return fieldWrap(f.id, `
        <label class="cc-label">${esc(f.label)}${req}</label>
        ${cbOpts}
        ${hintHtml(f.hint)}<div class="cc-err" id="err_${esc(f.id)}"></div>
      `);
      }
      return fieldWrap(f.id, `
        <div class="cc-checkbox-row">
          <input type="checkbox" id="${id}" name="${esc(f.id)}"${f.required ? " required" : ""}>
          <label for="${id}">${esc(f.label)}${req}</label>
        </div>
        ${hintHtml(f.hint)}<div class="cc-err" id="err_${esc(f.id)}"></div>
      `);
    }

    case "date":
      return fieldWrap(f.id, `
        <label for="${id}">${esc(f.label)}${req}</label>
        <input type="date" id="${id}" name="${esc(f.id)}"${f.required ? " required" : ""}>
        ${hintHtml(f.hint)}<div class="cc-err" id="err_${esc(f.id)}"></div>
      `);

    case "time":
      return fieldWrap(f.id, `
        <label for="${id}">${esc(f.label)}${req}</label>
        <input type="time" id="${id}" name="${esc(f.id)}"${f.required ? " required" : ""}>
        ${hintHtml(f.hint)}<div class="cc-err" id="err_${esc(f.id)}"></div>
      `);

    case "idcard":
      return fieldWrap(f.id, `
        <label for="${id}">${esc(f.label)}${req}</label>
        <input type="text" id="${id}" name="${esc(f.id)}" inputmode="text" autocomplete="off"${f.required ? " required" : ""}>
        ${hintHtml(f.hint)}<div class="cc-err" id="err_${esc(f.id)}"></div>
      `);

    case "radio": {
      const radioOpts = (f.options ?? []).map((o, i) => `
        <div class="cc-radio-row">
          <input type="radio" id="${id}_${i}" name="${esc(f.id)}" value="${esc(o)}"${f.required ? " required" : ""}>
          <label for="${id}_${i}">${esc(o)}</label>
        </div>`).join("");
      return fieldWrap(f.id, `
        <label class="cc-label">${esc(f.label)}${req}</label>
        ${radioOpts}
        ${hintHtml(f.hint)}<div class="cc-err" id="err_${esc(f.id)}"></div>
      `);
    }

    case "url":
      return fieldWrap(f.id, `
        <label for="${id}">${esc(f.label)}${req}</label>
        <input type="url" id="${id}" name="${esc(f.id)}" placeholder="https://" inputmode="url"${f.required ? " required" : ""}>
        ${hintHtml(f.hint)}<div class="cc-err" id="err_${esc(f.id)}"></div>
      `);

    case "phone":
      return fieldWrap(f.id, `
        <label for="${id}">${esc(f.label)}${req}</label>
        <input type="tel" id="${id}" name="${esc(f.id)}" inputmode="tel"${f.required ? " required" : ""}>
        ${hintHtml(f.hint)}<div class="cc-err" id="err_${esc(f.id)}"></div>
      `);

    case "rating": {
      const maxStars = f.max ?? 5;
      // Reverse order so CSS :checked ~ label trick works (rightmost = highest)
      const stars = Array.from({ length: maxStars }, (_, i) => {
        const val = maxStars - i;
        return `<input type="radio" id="${id}_${val}" name="${esc(f.id)}" value="${val}"><label for="${id}_${val}" title="${val}">★</label>`;
      }).join("");
      return fieldWrap(f.id, `
        <label class="cc-label">${esc(f.label)}${req}</label>
        <div class="cc-rating">${stars}</div>
        ${hintHtml(f.hint)}<div class="cc-err" id="err_${esc(f.id)}"></div>
      `);
    }

    case "file":
      return fieldWrap(f.id, `
        <label for="${id}">${esc(f.label)}${req}</label>
        <input type="file" id="${id}" name="${esc(f.id)}"${f.required ? " required" : ""}>
        ${hintHtml(f.hint)}<div class="cc-upload-status" id="upload_status_${esc(f.id)}"></div>
        <div class="cc-err" id="err_${esc(f.id)}"></div>
      `);

    default:
      return `<div class="cc-field"><div class="cc-unknown">Unsupported field type: "${esc(String((f as { type: string }).type))}" (${esc(f.label)})</div></div>`;
  }
}

function fieldWrap(fieldId: string, inner: string): string {
  return `<div class="cc-field" data-field="${esc(fieldId)}">${inner}</div>`;
}

function hintHtml(hint: string | undefined): string {
  return hint ? `<p class="cc-hint">${esc(hint)}</p>` : "";
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
  uploadUrl: string;
}

function renderConfirmationSection(): string {
  return `
  <div id="cc-success" class="cc-confirmation">
    <div id="cc-success-banner" class="cc-alert cc-alert-success"></div>
    <div class="cc-summary">
      <h2 id="cc-submitted-title">已提交的回答</h2>
      <div id="cc-summary-list" class="cc-summary-list"></div>
    </div>
    <p id="cc-edit-note" class="cc-edit-note" style="display:none"></p>
    <div id="cc-success-actions" class="cc-confirmation-actions">
      <button type="button" id="cc-edit-btn" class="cc-btn cc-btn-secondary">修改回答</button>
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
  var uploadUrl = ${JSON.stringify(data.uploadUrl)};
  var lang = (navigator.language || "en").toLowerCase();
  var isChinese = lang.startsWith("zh");
  var I18N_MAP = {
    zh: { submit:"提交", submitting:"提交中…", save:"保存修改", saving:"保存中…", fixErrors:"请检查以下错误后重新提交。", required:"此项为必填", submitted:"您的回答已提交，感谢配合！", editBtn:"修改回答", submittedTitle:"已提交的回答", selectPlaceholder:"— 请选择 —", noAnswers:"暂无回答内容。", uploading:"上传中…", uploadError:"上传失败，请重试", fileTooBig:"文件过大（最大 10 MB）", fileTypeBlocked:"不支持此文件类型", yes:"是", no:"否", invalidPhone:"请输入有效的手机号码", ratingLabel:"颗星", invalidIdcard:"请输入有效的证件号码", invalidTime:"请输入有效的时间", invalidUrl:"请输入有效的网址（以 http:// 或 https:// 开头）" },
    ja: { submit:"送信", submitting:"送信中…", save:"変更を保存", saving:"保存中…", fixErrors:"以下のエラーを修正してください。", required:"この項目は必須です", submitted:"回答を送信しました。ありがとうございます！", editBtn:"回答を編集", submittedTitle:"送信済み回答", selectPlaceholder:"— 選択してください —", noAnswers:"回答が記録されませんでした。", uploading:"アップロード中…", uploadError:"アップロードに失敗しました", fileTooBig:"ファイルが大きすぎます（最大 10 MB）", fileTypeBlocked:"このファイル形式は許可されていません", yes:"はい", no:"いいえ", invalidPhone:"有効な電話番号を入力してください", ratingLabel:"つ星", invalidIdcard:"有効な証明書番号を入力してください", invalidTime:"有効な時刻を入力してください", invalidUrl:"有効なURL（http:// または https:// で始まる）を入力してください" },
    ko: { submit:"제출", submitting:"제출 중…", save:"변경 저장", saving:"저장 중…", fixErrors:"아래 오류를 수정해주세요.", required:"필수 입력 항목입니다", submitted:"답변이 제출되었습니다. 감사합니다！", editBtn:"답변 수정", submittedTitle:"제출된 답변", selectPlaceholder:"— 선택하세요 —", noAnswers:"기록된 답변이 없습니다.", uploading:"업로드 중…", uploadError:"업로드 실패, 다시 시도하세요", fileTooBig:"파일이 너무 큽니다 (최대 10 MB)", fileTypeBlocked:"허용되지 않는 파일 형식입니다", yes:"예", no:"아니오", invalidPhone:"유효한 전화번호를 입력하세요", ratingLabel:"점", invalidIdcard:"유효한 증명서 번호를 입력하세요", invalidTime:"유효한 시간을 입력하세요", invalidUrl:"올바른 URL(http:// 또는 https://로 시작)을 입력하세요" },
    es: { submit:"Enviar", submitting:"Enviando…", save:"Guardar cambios", saving:"Guardando…", fixErrors:"Por favor corrija los errores.", required:"Este campo es obligatorio", submitted:"Su respuesta ha sido enviada. ¡Gracias!", editBtn:"Editar respuesta", submittedTitle:"Respuesta enviada", selectPlaceholder:"— Seleccionar —", noAnswers:"No se capturaron respuestas.", uploading:"Subiendo…", uploadError:"Error al subir, intente de nuevo", fileTooBig:"Archivo demasiado grande (máx 10 MB)", fileTypeBlocked:"Tipo de archivo no permitido", yes:"Sí", no:"No", invalidPhone:"Ingrese un número de teléfono válido", ratingLabel:"estrellas", invalidIdcard:"Ingrese un número de documento válido", invalidTime:"Ingrese una hora válida", invalidUrl:"Ingrese una URL válida (debe comenzar con http:// o https://)" },
    fr: { submit:"Envoyer", submitting:"Envoi en cours…", save:"Enregistrer", saving:"Enregistrement…", fixErrors:"Veuillez corriger les erreurs.", required:"Ce champ est obligatoire", submitted:"Votre réponse a été envoyée. Merci !", editBtn:"Modifier la réponse", submittedTitle:"Réponse soumise", selectPlaceholder:"— Sélectionner —", noAnswers:"Aucune réponse enregistrée.", uploading:"Téléversement…", uploadError:"Échec du téléversement, réessayez", fileTooBig:"Fichier trop volumineux (max 10 Mo)", fileTypeBlocked:"Type de fichier non autorisé", yes:"Oui", no:"Non", invalidPhone:"Veuillez entrer un numéro de téléphone valide", ratingLabel:"étoiles", invalidIdcard:"Veuillez entrer un numéro de document valide", invalidTime:"Veuillez entrer une heure valide", invalidUrl:"Veuillez entrer une URL valide (commençant par http:// ou https://)" },
    de: { submit:"Absenden", submitting:"Wird gesendet…", save:"Änderungen speichern", saving:"Speichern…", fixErrors:"Bitte korrigieren Sie die Fehler.", required:"Dieses Feld ist erforderlich", submitted:"Ihre Antwort wurde übermittelt. Danke!", editBtn:"Antwort bearbeiten", submittedTitle:"Gesendete Antwort", selectPlaceholder:"— Auswählen —", noAnswers:"Keine Antworten erfasst.", uploading:"Hochladen…", uploadError:"Upload fehlgeschlagen, erneut versuchen", fileTooBig:"Datei zu groß (max. 10 MB)", fileTypeBlocked:"Dateityp nicht erlaubt", yes:"Ja", no:"Nein", invalidPhone:"Bitte geben Sie eine gültige Telefonnummer ein", ratingLabel:"Sterne", invalidIdcard:"Bitte geben Sie eine gültige Ausweisnummer ein", invalidTime:"Bitte geben Sie eine gültige Uhrzeit ein", invalidUrl:"Bitte geben Sie eine gültige URL ein (beginnend mit http:// oder https://)" },
    pt: { submit:"Enviar", submitting:"Enviando…", save:"Salvar alterações", saving:"Salvando…", fixErrors:"Corrija os erros abaixo.", required:"Este campo é obrigatório", submitted:"Sua resposta foi enviada. Obrigado!", editBtn:"Editar resposta", submittedTitle:"Resposta enviada", selectPlaceholder:"— Selecionar —", noAnswers:"Nenhuma resposta capturada.", uploading:"Enviando arquivo…", uploadError:"Falha no envio, tente novamente", fileTooBig:"Arquivo muito grande (máx 10 MB)", fileTypeBlocked:"Tipo de arquivo não permitido", yes:"Sim", no:"Não", invalidPhone:"Insira um número de telefone válido", ratingLabel:"estrelas", invalidIdcard:"Insira um número de documento válido", invalidTime:"Insira um horário válido", invalidUrl:"Insira uma URL válida (deve começar com http:// ou https://)" },
    ru: { submit:"Отправить", submitting:"Отправка…", save:"Сохранить", saving:"Сохранение…", fixErrors:"Исправьте ошибки ниже.", required:"Это поле обязательно", submitted:"Ваш ответ отправлен. Спасибо!", editBtn:"Изменить ответ", submittedTitle:"Отправленный ответ", selectPlaceholder:"— Выбрать —", noAnswers:"Ответы не записаны.", uploading:"Загрузка…", uploadError:"Ошибка загрузки, попробуйте снова", fileTooBig:"Файл слишком большой (макс. 10 МБ)", fileTypeBlocked:"Тип файла не разрешён", yes:"Да", no:"Нет", invalidPhone:"Введите корректный номер телефона", ratingLabel:"звёзд", invalidIdcard:"Введите корректный номер документа", invalidTime:"Введите корректное время", invalidUrl:"Введите корректный URL (должен начинаться с http:// или https://)" },
    ar: { submit:"إرسال", submitting:"جارٍ الإرسال…", save:"حفظ التغييرات", saving:"جارٍ الحفظ…", fixErrors:"يرجى تصحيح الأخطاء أدناه.", required:"هذا الحقل مطلوب", submitted:"تم إرسال إجابتك. شكراً!", editBtn:"تعديل الإجابة", submittedTitle:"الإجابة المرسلة", selectPlaceholder:"— اختر —", noAnswers:"لم يتم تسجيل أي إجابات.", uploading:"جارٍ الرفع…", uploadError:"فشل الرفع، حاول مرة أخرى", fileTooBig:"الملف كبير جداً (الحد الأقصى 10 ميغابايت)", fileTypeBlocked:"نوع الملف غير مسموح به", yes:"نعم", no:"لا", invalidPhone:"أدخل رقم هاتف صالحاً", ratingLabel:"نجوم", invalidIdcard:"أدخل رقم هوية صالحاً", invalidTime:"أدخل وقتاً صالحاً", invalidUrl:"أدخل رابطاً صالحاً (يبدأ بـ http:// أو https://)" },
    en: { submit:"Submit", submitting:"Submitting…", save:"Save changes", saving:"Saving…", fixErrors:"Please fix the errors below.", required:"This field is required", submitted:"Your response has been submitted. Thank you!", editBtn:"Edit response", submittedTitle:"Submitted Response", selectPlaceholder:"— Select —", noAnswers:"No answers were captured.", uploading:"Uploading…", uploadError:"Upload failed, please try again", fileTooBig:"File too large (max 10 MB)", fileTypeBlocked:"File type not allowed", yes:"Yes", no:"No", invalidPhone:"Please enter a valid phone number", ratingLabel:"stars", invalidIdcard:"Please enter a valid ID number", invalidTime:"Please enter a valid time", invalidUrl:"Please enter a valid URL (must start with http:// or https://)" }
  };
  var langPrefix = lang.split("-")[0];
  var i18n = I18N_MAP[langPrefix] || I18N_MAP["en"];
  var isChinese = langPrefix === "zh";
  var editUrlBase = ${JSON.stringify(data.editUrlBase)};
  var mode = "create";

  // Apply i18n to static elements
  (function(){
    var submitBtns = document.querySelectorAll("button[type=submit]");
    submitBtns.forEach(function(b){ b.textContent = i18n.submit; });
    var eb = document.getElementById("cc-edit-btn");
    if(eb) eb.textContent = i18n.editBtn;
    var st = document.getElementById("cc-submitted-title");
    if(st) st.textContent = i18n.submittedTitle;
    var sp = document.querySelectorAll("select option[value='']");
    sp.forEach(function(o){ o.textContent = i18n.selectPlaceholder; });
  })();
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

  // fileUrls[fieldId] = uploaded URL (set after successful upload)
  var fileUrls = {};

  function collectData(){
    var data = {};
    schema.forEach(function(field){
      if(field.type === "file"){
        if(fileUrls[field.id]) data[field.id] = fileUrls[field.id];
        return;
      }
      if(field.type === "radio" || field.type === "rating"){
        var checked = document.querySelector('input[name="' + field.id + '"]:checked');
        if(checked){
          data[field.id] = field.type === "rating" ? parseInt(checked.value, 10) : checked.value;
        }
        return;
      }
      if(field.type === "checkbox" && field.options && field.options.length > 0){
        var checkedBoxes = document.querySelectorAll('input[name="' + field.id + '"]:checked');
        var vals = [];
        checkedBoxes.forEach(function(cb){ vals.push(cb.value); });
        if(vals.length > 0) data[field.id] = vals;
        return;
      }
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

  function uploadFile(field, file){
    var statusEl = document.getElementById("upload_status_" + field.id);
    if(statusEl){ statusEl.textContent = i18n.uploading; statusEl.style.display = "block"; }
    var fd = new FormData();
    fd.append("file", file);
    return fetch(uploadUrl, { method: "POST", body: fd })
      .then(parseResponse)
      .then(function(result){
        if(result.status === 201 && result.body.url){
          fileUrls[field.id] = result.body.url;
          if(statusEl){ statusEl.textContent = "\u2713 " + (result.body.name || file.name); statusEl.style.display = "block"; }
          return { ok: true };
        }
        var msg = result.body.error || i18n.uploadError;
        if(msg === "File too large (max 10 MB)") msg = i18n.fileTooBig;
        if(msg === "File type not allowed") msg = i18n.fileTypeBlocked;
        if(statusEl){ statusEl.textContent = msg; statusEl.style.display = "block"; }
        return { ok: false, fieldId: field.id, message: msg };
      })
      .catch(function(){
        if(statusEl){ statusEl.textContent = i18n.uploadError; statusEl.style.display = "block"; }
        return { ok: false, fieldId: field.id, message: i18n.uploadError };
      });
  }

  // Textarea character counters
  schema.forEach(function(field){
    if(field.type !== "textarea" || !field.maxLength) return;
    var el = document.getElementById("field_" + field.id);
    var countEl = document.getElementById("cc_count_" + field.id);
    if(!el || !countEl) return;
    function updateCount(){
      var len = el.value.length;
      var max = field.maxLength;
      countEl.textContent = len + " / " + max;
      countEl.className = "cc-char-count" + (len >= max ? " cc-at-limit" : len >= max * 0.9 ? " cc-near-limit" : "");
    }
    el.addEventListener("input", updateCount);
    updateCount();
  });

  // When user selects a new file, clear the previously uploaded URL so stale data is not submitted
  schema.forEach(function(field){
    if(field.type !== "file") return;
    var el = document.getElementById("field_" + field.id);
    if(!el) return;
    el.addEventListener("change", function(){
      if(hasOwn(fileUrls, field.id)){
        delete fileUrls[field.id];
        var statusEl = document.getElementById("upload_status_" + field.id);
        if(statusEl && el.files && el.files.length > 0){
          statusEl.textContent = el.files[0].name;
          statusEl.style.display = "block";
        }
      }
    });
  });

  function uploadPendingFiles(){
    var uploads = [];
    schema.forEach(function(field){
      if(field.type !== "file") return;
      var el = document.getElementById("field_" + field.id);
      if(!el || !el.files || el.files.length === 0) return;
      // Skip if already uploaded (no new file selected since last upload)
      if(hasOwn(fileUrls, field.id)) return;
      uploads.push(uploadFile(field, el.files[0]));
    });
    if(uploads.length === 0) return Promise.resolve([]);
    return Promise.all(uploads);
  }

  function fillForm(data){
    schema.forEach(function(field){
      var el = document.getElementById("field_" + field.id);
      if(!el) return;
      if(field.type === "file"){
        // File inputs can't be set programmatically; preserve existing URL and show name
        if(data && hasOwn(data, field.id) && data[field.id]){
          fileUrls[field.id] = data[field.id];
          var statusEl = document.getElementById("upload_status_" + field.id);
          if(statusEl){
            var prevName = decodeURIComponent(String(data[field.id]).split("/").pop() || "file");
            statusEl.textContent = "\u2713 " + prevName;
            statusEl.style.display = "block";
          }
        }
        return;
      }
      if(field.type === "radio" || field.type === "rating"){
        if(data && hasOwn(data, field.id) && data[field.id] !== null && data[field.id] !== undefined){
          var radioEl = document.querySelector('input[name="' + field.id + '"][value="' + String(data[field.id]).replace(/"/g, '\\"') + '"]');
          if(radioEl) radioEl.checked = true;
        }
        return;
      }
      if(field.type === "checkbox" && field.options && field.options.length > 0){
        var prevVals = (data && hasOwn(data, field.id) && Array.isArray(data[field.id])) ? data[field.id] : [];
        document.querySelectorAll('input[name="' + field.id + '"]').forEach(function(cb){
          cb.checked = prevVals.indexOf(cb.value) !== -1;
        });
        return;
      }
      if(field.type === "checkbox"){
        el.checked = !!(data && hasOwn(data, field.id) && data[field.id]);
        return;
      }
      if(data && hasOwn(data, field.id) && data[field.id] !== null && data[field.id] !== undefined){
        el.value = String(data[field.id]);
      } else {
        el.value = "";
      }
      // Trigger input event so listeners (e.g. textarea char counter) update
      el.dispatchEvent(new Event("input"));
    });
  }

  function formatFieldValue(field, value){
    if(field.type === "rating" && typeof value === "number"){
      return "★".repeat(value) + "☆".repeat((field.max || 5) - value) + " (" + value + "/" + (field.max || 5) + ")";
    }
    if(field.type === "checkbox" && field.options && field.options.length > 0){
      return Array.isArray(value) ? value.join(", ") : "";
    }
    if(field.type === "checkbox") return value ? i18n.yes : i18n.no;
    if(value === undefined || value === null || value === "") return "";
    return String(value);
  }

  function renderSummaryValue(field, value){
    if(field.type === "file" && value && typeof value === "string"){
      var name = decodeURIComponent(value.split("/").pop() || value);
      return '<a class="cc-file-link" href="' + escapeHtml(value) + '" target="_blank" rel="noopener">' + escapeHtml(name) + '</a>';
    }
    if(field.type === "url" && value && typeof value === "string"){
      return '<a class="cc-file-link" href="' + escapeHtml(value) + '" target="_blank" rel="noopener">' + escapeHtml(value) + '</a>';
    }
    return escapeHtml(formatFieldValue(field, value));
  }

  function renderSummary(data){
    if(!summaryList) return;
    var rows = [];
    schema.forEach(function(field){
      if(!hasOwn(data, field.id)) return;
      rows.push(
        '<div class="cc-summary-row">' +
          '<div class="cc-summary-label">' + escapeHtml(field.label) + '</div>' +
          '<div class="cc-summary-value">' + renderSummaryValue(field, data[field.id]) + '</div>' +
        '</div>'
      );
    });

    if(rows.length === 0){
      rows.push('<div class="cc-summary-row"><div class="cc-summary-value">' + i18n.noAnswers + '</div></div>');
    }

    summaryList.innerHTML = rows.join("");
  }

  function setSubmitState(busy){
    if(!form) return;
    var btn = form.querySelector("button[type=submit]");
    if(!btn) return;
    btn.disabled = busy;
    if(mode === "edit"){
      btn.textContent = busy ? i18n.saving : i18n.save;
      return;
    }
    btn.textContent = busy ? i18n.submitting : i18n.submit;
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
            editNote.textContent = isChinese ? "您可以在 " + expiresAt.toLocaleString() + " 之前修改本次回答。" : "You can edit this response until " + expiresAt.toLocaleString() + ".";
          } else {
            editNote.textContent = isChinese ? "您可以通过下方按钮修改本次回答。" : "You can edit this response from this device using the button below.";
          }
        } else {
          editNote.textContent = isChinese ? "您可以通过下方按钮修改本次回答。" : "You can edit this response from this device using the button below.";
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
    showConfirmation(i18n.submitted);
  }

  function localizeError(fe){
    if(fe.code === "required") return i18n.required;
    if(fe.code === "invalid_phone") return i18n.invalidPhone;
    if(fe.code === "invalid_idcard") return i18n.invalidIdcard;
    if(fe.code === "invalid_time") return i18n.invalidTime;
    if(fe.code === "invalid_url") return i18n.invalidUrl;
    return fe.message;
  }

  function handleValidationErrors(fieldErrors){
    fieldErrors.forEach(function(fe){
      var wrap = document.querySelector('[data-field="' + fe.field + '"]');
      var errEl = document.getElementById("err_" + fe.field);
      if(wrap) wrap.classList.add("has-error");
      if(errEl){
        errEl.textContent = localizeError(fe);
        errEl.style.display = "block";
      }
    });
    showFormError(i18n.fixErrors);
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

    requestInFlight = true;
    setSubmitState(true);

    // Upload any pending file fields first, then submit
    uploadPendingFiles().then(function(results){
      // Check for upload failures
      var uploadFailed = false;
      (results || []).forEach(function(r){
        if(!r.ok){
          var wrap = document.querySelector('[data-field="' + r.fieldId + '"]');
          var errEl = document.getElementById("err_" + r.fieldId);
          if(wrap) wrap.classList.add("has-error");
          if(errEl){ errEl.textContent = r.message; errEl.style.display = "block"; }
          uploadFailed = true;
        }
      });

      if(uploadFailed){
        requestInFlight = false;
        setSubmitState(false);
        showFormError(i18n.fixErrors);
        return Promise.resolve(null);
      }

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

      return fetch(url, {
        method: method,
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload)
      }).then(parseResponse).then(function(result){
        requestInFlight = false;

        if(method === "POST" && result.status === 201){
          submission = {
            id: result.body.id,
            data: data,
            editToken: result.body.edit_token || null,
            editExpiresAt: result.body.edit_expires_at || null,
            editLockedMessage: null
          };
          showConfirmation(result.body.submit_message || i18n.submitted);
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
      });
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
    <button type="submit" class="cc-btn">提交</button>
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
      <button type="submit" class="cc-btn">提交</button>
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

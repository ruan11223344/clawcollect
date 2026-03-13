# Public Form UI / Style Verification Checklist

Manual visual QA for the public form pages. Run through on each release that touches the form frontend.

> The public form endpoint (`GET /f/:token`) returns HTML by default. Send `Accept: application/json` or `?format=json` to get JSON.

## Prerequisites

1. Online service running: `cd services/online && npm run dev`
2. A published form with a public link (see [PLUGIN-SMOKE.md](./PLUGIN-SMOKE.md) for setup)
3. Browser with DevTools available
4. For mobile checks: device emulation in DevTools or a real device

## 1. Desktop — Active Form

| # | Check | Pass? |
|---|-------|-------|
| 1.1 | Form title visible at top of page | |
| 1.2 | Form description visible (if set) | |
| 1.3 | All field labels readable, not truncated | |
| 1.4 | Input fields and textarea have clear borders | |
| 1.5 | Required field indicators visible (asterisk or label) | |
| 1.6 | Submit button clearly distinguishable from other elements | |
| 1.7 | Tab order follows visual field order | |
| 1.8 | Input fields not touching page edges (has padding/margin) | |
| 1.9 | No horizontal scrollbar on 1280px+ width | |

## 2. Desktop — Submission Flow

| # | Check | Pass? |
|---|-------|-------|
| 2.1 | Submit with empty required field → error message appears near field | |
| 2.2 | Error text is readable (not clipped, has contrast) | |
| 2.3 | Fix errors and re-submit → success | |
| 2.4 | Success state clearly visible (message, icon, or page change) | |
| 2.5 | Submitted values visible in confirmation summary | |
| 2.6 | After success, form is not accidentally re-submittable | |
| 2.7 | If response editing is enabled, "Edit response" re-opens the form and updated values appear after save | |

## 3. Mobile Width (375px)

| # | Check | Pass? |
|---|-------|-------|
| 3.1 | No horizontal overflow / no horizontal scrollbar | |
| 3.2 | Input fields stretch to available width | |
| 3.3 | All text readable without zooming | |
| 3.4 | Submit button fully visible and tappable (min 44px height) | |
| 3.5 | Labels not truncated or overlapping inputs | |
| 3.6 | Textarea tall enough to type multiple lines | |
| 3.7 | Error messages visible, not clipped by viewport | |

## 4. State Pages

| # | Check | Expected |
|---|-------|----------|
| 4.1 | Closed form | Clear "form is closed" or "no longer accepting responses" message |
| 4.2 | Invalid / expired link | Clear "not found" or "link is invalid" message |
| 4.3 | Expired link (time-based) | "This link has expired" message (HTTP 410) |
| 4.4 | Max responses reached | "This link has reached its response limit" message (HTTP 410) |
| 4.5 | Validation error on submit | Per-field error messages, form not cleared |
| 4.6 | Quota exceeded | "collection limit" message (HTTP 429) |

### Password-protected links

| # | Check | Expected |
|---|-------|----------|
| 4.7 | Form page shows password prompt before fields | |
| 4.8 | Wrong password → clear error, can retry | |
| 4.9 | Correct password → form fields appear | |

> Password-protected links require Pro plan. If testing on free plan, skip 4.7–4.9.

## 5. Branding

| # | Check | Expected |
|---|-------|----------|
| 5.1 | Free plan: ClawCollect branding visible | |
| 5.2 | Paid plan with `remove_branding`: no branding | |

> The API returns `branding: true/false` in the public form response. The frontend should respect this.

## 6. Accessibility (Quick Check)

| # | Check | Pass? |
|---|-------|-------|
| 6.1 | All form inputs have associated labels (visible or aria-label) | |
| 6.2 | Error messages linked to fields (aria-describedby or equivalent) | |
| 6.3 | Submit button focusable via keyboard | |
| 6.4 | Color contrast ratio >= 4.5:1 for body text | |

## Pass Criteria

All applicable checks pass. Sections 4.7–4.9 skippable on free plan. Sections 5.x skippable if branding toggle not yet implemented.

## API Behavior Reference

These are the current HTTP status codes the frontend should handle:

| Scenario | Status | Response body |
|----------|--------|--------------|
| Active form | 200 | `{ form: { title, schema, ... }, requires_password, branding }` |
| Form closed / not active | 404 | `{ error: "This form is no longer accepting responses." }` |
| Link not found | 404 | `{ error: "Form not found or link is inactive" }` |
| Link expired | 410 | `{ error: "This link has expired" }` |
| Max responses reached | 410 | `{ error: "This link has reached its response limit" }` |
| Submit success | 201 | `{ id, submitted_at, edit_token?, edit_expires_at? }` |
| Validation failure | 400 | `{ error: "validation_failed", field_errors: [...] }` |
| Password required | 403 | `{ error: "Password required" }` |
| Wrong password | 403 | `{ error: "Invalid password" }` |
| Quota exceeded | 429 | `{ error: "...collection limit..." }` |
| Subscription blocked | 503 | `{ error: "This form is temporarily unavailable" }` |

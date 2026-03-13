/**
 * Plugin Bridge Interface
 *
 * This file documents the interface between the ClawCollect OpenClaw plugin
 * and the online service (form collection backend). IMPLEMENTED in src/online-client.ts.
 *
 * Usage flow:
 *   1. User runs `/collect form open "BBQ March 30"`
 *   2. Plugin calls `POST /api/forms` → creates form with default schema
 *   3. Plugin calls `POST /api/forms/:id/publish` → activates the form
 *   4. Plugin calls `POST /api/forms/:id/links` → gets public link
 *   5. Plugin calls `POST /api/forms/:id/results-link` → gets read-only collector results link
 *   6. Plugin displays public link + results link in chat
 *   7. External users submit responses via `POST /f/:token/submit`
 *   8. User runs `/collect form status` → calls `GET /api/forms/:id`
 *   9. User runs `/collect form summary` → calls `GET /api/forms/:id/responses`
 *  10. User runs `/collect form close` → calls `POST /api/forms/:id/close`
 *
 * Auth:
 *   The plugin authenticates using a Bearer token:
 *   ```
 *   Authorization: Bearer cc_tok_xxxxx
 *   ```
 *
 *   Token is created via `POST /api/tokens` (requires owner/admin role).
 *   Stored in plugin config:
 *   ```json
 *   {
 *     "online": {
 *       "enabled": true,
 *       "apiUrl": "https://collect.dorapush.com",
 *       "apiToken": "cc_tok_xxxxx"
 *     }
 *   }
 *   ```
 *
 * API endpoints used by the plugin:
 *   - POST   /api/forms                                → create form
 *   - POST   /api/forms/:id/publish                    → publish form
 *   - POST   /api/forms/:id/links                      → create public link
 *   - POST   /api/forms/:id/results-link               → create/read collector results link
 *   - GET    /api/forms/:id                            → get form details
 *   - GET    /api/forms/:id/responses                  → list responses
 *   - POST   /api/forms/:id/close                      → close form
 *
 * Token management:
 *   - POST   /api/tokens                               → create API token
 *   - GET    /api/tokens                               → list tokens
 *   - DELETE /api/tokens/:id                           → revoke token
 */

export interface OnlineServiceConfig {
  apiUrl: string;
  apiToken: string;
}

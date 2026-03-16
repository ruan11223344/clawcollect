/**
 * Form schema validation.
 *
 * Validates both schema definitions (when creating/updating forms)
 * and submission payloads (when respondents submit data).
 */

// ── Types ────────────────────────────────────────────────────────────

export type FieldType = "text" | "textarea" | "email" | "number" | "select" | "radio" | "checkbox" | "date" | "file";

const FIELD_TYPES = new Set<string>(["text", "textarea", "email", "number", "select", "radio", "checkbox", "date", "file"]);

export interface FieldDefinition {
  id: string;
  type: FieldType;
  label: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  options?: string[];
}

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

// ── Schema definition validation ─────────────────────────────────────

/** Validate a form schema definition. Returns errors or empty array. */
export function validateSchemaDefinition(schema: unknown): FieldError[] {
  if (!Array.isArray(schema)) {
    return [{ field: "_schema", code: "invalid_type", message: "Schema must be an array" }];
  }

  const errors: FieldError[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < schema.length; i++) {
    const field = schema[i];
    const prefix = `schema[${i}]`;

    if (!field || typeof field !== "object" || Array.isArray(field)) {
      errors.push({ field: prefix, code: "invalid_type", message: "Field must be an object" });
      continue;
    }

    const f = field as Record<string, unknown>;

    // id
    if (typeof f.id !== "string" || !f.id.trim()) {
      errors.push({ field: prefix, code: "missing_id", message: "Field must have a non-empty string id" });
    } else if (seenIds.has(f.id)) {
      errors.push({ field: prefix, code: "duplicate_id", message: `Duplicate field id: "${f.id}"` });
    } else {
      seenIds.add(f.id);
    }

    // type
    if (typeof f.type !== "string" || !FIELD_TYPES.has(f.type)) {
      errors.push({
        field: prefix,
        code: "invalid_field_type",
        message: `Field type must be one of: ${[...FIELD_TYPES].join(", ")}`,
      });
    }

    // label
    if (typeof f.label !== "string" || !f.label.trim()) {
      errors.push({ field: prefix, code: "missing_label", message: "Field must have a non-empty label" });
    }

    // select/radio/checkbox-group must have options
    if (f.type === "select" || f.type === "radio" || (f.type === "checkbox" && Array.isArray(f.options))) {
      if (!Array.isArray(f.options) || f.options.length === 0) {
        errors.push({ field: prefix, code: "missing_options", message: "Select/radio field must have a non-empty options array" });
      } else if (!f.options.every((o: unknown) => typeof o === "string")) {
        errors.push({ field: prefix, code: "invalid_options", message: "All options must be strings" });
      }
    }

    // numeric rule validation
    if (f.minLength !== undefined && (typeof f.minLength !== "number" || f.minLength < 0)) {
      errors.push({ field: prefix, code: "invalid_rule", message: "minLength must be a non-negative number" });
    }
    if (f.maxLength !== undefined && (typeof f.maxLength !== "number" || f.maxLength < 0)) {
      errors.push({ field: prefix, code: "invalid_rule", message: "maxLength must be a non-negative number" });
    }
    if (f.min !== undefined && typeof f.min !== "number") {
      errors.push({ field: prefix, code: "invalid_rule", message: "min must be a number" });
    }
    if (f.max !== undefined && typeof f.max !== "number") {
      errors.push({ field: prefix, code: "invalid_rule", message: "max must be a number" });
    }
    if (f.pattern !== undefined && typeof f.pattern !== "string") {
      errors.push({ field: prefix, code: "invalid_rule", message: "pattern must be a string" });
    }
    if (f.pattern !== undefined && typeof f.pattern === "string") {
      try {
        new RegExp(f.pattern);
      } catch {
        errors.push({ field: prefix, code: "invalid_pattern", message: "pattern is not a valid regular expression" });
      }
    }
  }

  return errors;
}

// ── Submission validation ────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate a submission payload against a form schema. */
export function validateSubmission(
  schema: FieldDefinition[],
  data: Record<string, unknown>,
): FieldError[] {
  const errors: FieldError[] = [];
  const definedIds = new Set(schema.map((f) => f.id));

  // Reject unknown fields
  for (const key of Object.keys(data)) {
    if (!definedIds.has(key)) {
      errors.push({ field: key, code: "unknown_field", message: `Field "${key}" is not defined in the form schema` });
    }
  }

  for (const field of schema) {
    const value = data[field.id];
    const missing = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

    // required check
    if (field.required && missing) {
      errors.push({ field: field.id, code: "required", message: `${field.label} is required` });
      continue;
    }

    // skip further checks if value not provided and not required
    if (missing) continue;

    switch (field.type) {
      case "text":
      case "textarea": {
        if (typeof value !== "string") {
          errors.push({ field: field.id, code: "invalid_type", message: `${field.label} must be a string` });
          break;
        }
        if (field.minLength !== undefined && value.length < field.minLength) {
          errors.push({ field: field.id, code: "min_length", message: `${field.label} must be at least ${field.minLength} characters` });
        }
        if (field.maxLength !== undefined && value.length > field.maxLength) {
          errors.push({ field: field.id, code: "max_length", message: `${field.label} must be at most ${field.maxLength} characters` });
        }
        if (field.pattern) {
          const re = new RegExp(field.pattern);
          if (!re.test(value)) {
            errors.push({ field: field.id, code: "pattern", message: `${field.label} does not match required pattern` });
          }
        }
        break;
      }

      case "email": {
        if (typeof value !== "string") {
          errors.push({ field: field.id, code: "invalid_type", message: `${field.label} must be a string` });
          break;
        }
        if (!EMAIL_RE.test(value)) {
          errors.push({ field: field.id, code: "invalid_email", message: `${field.label} is not a valid email address` });
        }
        break;
      }

      case "number": {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          errors.push({ field: field.id, code: "invalid_type", message: `${field.label} must be a number` });
          break;
        }
        if (field.min !== undefined && value < field.min) {
          errors.push({ field: field.id, code: "min", message: `${field.label} must be at least ${field.min}` });
        }
        if (field.max !== undefined && value > field.max) {
          errors.push({ field: field.id, code: "max", message: `${field.label} must be at most ${field.max}` });
        }
        break;
      }

      case "select":
      case "radio": {
        if (typeof value !== "string") {
          errors.push({ field: field.id, code: "invalid_type", message: `${field.label} must be a string` });
          break;
        }
        if (field.options && !field.options.includes(value)) {
          errors.push({ field: field.id, code: "invalid_option", message: `${field.label} must be one of: ${field.options.join(", ")}` });
        }
        break;
      }

      case "file": {
        // Value is a URL string returned by the upload endpoint
        if (typeof value !== "string" || !value.startsWith("/f/")) {
          errors.push({ field: field.id, code: "invalid_type", message: `${field.label} must be a valid upload URL` });
        }
        break;
      }

      case "checkbox": {
        if (field.options && field.options.length > 0) {
          // checkbox group — value must be a non-empty array of valid options
          if (!Array.isArray(value)) {
            errors.push({ field: field.id, code: "invalid_type", message: `${field.label} must be an array` });
            break;
          }
          const invalid = (value as unknown[]).filter((v) => typeof v !== "string" || !field.options!.includes(v as string));
          if (invalid.length > 0) {
            errors.push({ field: field.id, code: "invalid_option", message: `${field.label} contains invalid options` });
          }
        } else {
          // single boolean checkbox
          if (typeof value !== "boolean") {
            errors.push({ field: field.id, code: "invalid_type", message: `${field.label} must be a boolean` });
          }
        }
        break;
      }

      case "date": {
        if (typeof value !== "string") {
          errors.push({ field: field.id, code: "invalid_type", message: `${field.label} must be a string` });
          break;
        }
        if (!DATE_RE.test(value)) {
          errors.push({ field: field.id, code: "invalid_date", message: `${field.label} must be in YYYY-MM-DD format` });
        }
        break;
      }
    }
  }

  return errors;
}

/** Parse raw schema JSON string to typed FieldDefinition array. Returns null if invalid. */
export function parseSchema(schemaJson: string): FieldDefinition[] | null {
  try {
    const parsed = JSON.parse(schemaJson);
    if (!Array.isArray(parsed)) return null;
    return parsed as FieldDefinition[];
  } catch {
    return null;
  }
}

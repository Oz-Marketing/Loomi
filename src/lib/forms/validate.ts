/**
 * Form submission validation.
 *
 * Walks the form's declared field blocks and validates the submission
 * payload against each block's constraints (required, email format,
 * max length, allowed select/radio values). Errors are keyed by field
 * name so the public form can surface them inline.
 */
import type { Block, FormTemplate, FileValue } from './types';
import { collectFieldBlocks, getFieldName } from './types';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
  MAX_FILES_PER_FIELD,
  ALLOWED_FILE_TYPES_LABEL,
  isAllowedFileType,
} from './file-upload';

/** Maximum length per text/textarea field — guards against payload bombs. */
const MAX_TEXT_LENGTH = 10_000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Loose phone check — only enforces "has at least 7 digits" since GHL
// + Twilio accept varied formats. Stricter normalization happens later.
const PHONE_REGEX = /^[^\d]*(?:\d[^\d]*){7,}$/;

// `File` / `File[]` are transient: `field_file` validation returns the
// raw File objects, which the submit pipeline uploads to object storage
// and replaces with `FileValue` metadata before anything is persisted.
export type FieldValue =
  | string
  | string[]
  | boolean
  | File
  | File[]
  | FileValue
  | FileValue[]
  | null;

export interface ValidatedSubmission {
  /** Sanitized values keyed by field name (the public submit body). */
  values: Record<string, FieldValue>;
  /** Convenience accessor for the canonical contact identifiers. */
  identifiers: {
    email: string | null;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
  };
}

export interface ValidationError {
  /** Field name (or '_form' for top-level errors like honeypot tripped). */
  field: string;
  message: string;
}

export class FormValidationError extends Error {
  constructor(public errors: ValidationError[]) {
    super(`Form validation failed: ${errors.map((e) => e.field).join(', ')}`);
    this.name = 'FormValidationError';
  }
}

/**
 * Validate a raw submission payload against the form's schema.
 *
 * Throws `FormValidationError` with one or more field-keyed errors when
 * anything fails. Returns the sanitized values + extracted identifiers
 * when everything passes.
 *
 * Honeypot is checked here too — the public form renders an off-screen
 * input named `_loomi_hp`; legitimate submissions leave it empty, bots
 * fill it because they fill every input.
 */
export function validateSubmission(
  template: FormTemplate,
  raw: Record<string, unknown>,
): ValidatedSubmission {
  const errors: ValidationError[] = [];

  // Honeypot — short-circuit with a generic error so bots can't tell us apart.
  const honeypot = raw['_loomi_hp'];
  if (typeof honeypot === 'string' && honeypot.trim() !== '') {
    throw new FormValidationError([
      { field: '_form', message: 'Submission rejected.' },
    ]);
  }

  const fieldBlocks = collectFieldBlocks(template).filter(
    (b) => b.type !== 'submit_button',
  );

  const values: Record<string, FieldValue> = {};
  const identifiers = {
    email: null as string | null,
    phone: null as string | null,
    firstName: null as string | null,
    lastName: null as string | null,
  };

  for (const block of fieldBlocks) {
    const name = getFieldName(block);
    const required = block.props.required === true;
    const rawValue = raw[name];
    const result = validateField(block, rawValue, required);

    if (result.error) {
      errors.push({ field: name, message: result.error });
      continue;
    }

    values[name] = result.value;

    // Pick out contact identifiers based on block type + common field names.
    // We're permissive — any email-typed field gets used as the canonical
    // email, even if the user named it "contactEmail" or similar.
    if (block.type === 'field_email' && typeof result.value === 'string' && result.value) {
      identifiers.email = result.value;
    } else if (block.type === 'field_phone' && typeof result.value === 'string' && result.value) {
      identifiers.phone = result.value;
    } else if (typeof result.value === 'string' && result.value) {
      // Heuristic name-matching for non-typed fields. Lowercase + strip
      // separators so "First Name", "firstName", "first_name" all match.
      const normalized = name.toLowerCase().replace(/[^a-z]/g, '');
      if (normalized === 'firstname' || normalized === 'fname') {
        identifiers.firstName = result.value;
      } else if (normalized === 'lastname' || normalized === 'lname') {
        identifiers.lastName = result.value;
      } else if (normalized === 'email' && !identifiers.email && EMAIL_REGEX.test(result.value)) {
        identifiers.email = result.value;
      }
    }
  }

  if (errors.length > 0) {
    throw new FormValidationError(errors);
  }

  return { values, identifiers };
}

interface FieldValidationResult {
  value: FieldValue;
  error: string | null;
}

function validateField(
  block: Block,
  rawValue: unknown,
  required: boolean,
): FieldValidationResult {
  // File uploads arrive as File objects (single or array), not strings,
  // so they're handled before the string-oriented `hasValue` logic below.
  if (block.type === 'field_file') {
    const files: File[] = Array.isArray(rawValue)
      ? rawValue.filter((v): v is File => v instanceof File)
      : rawValue instanceof File
        ? [rawValue]
        : [];

    if (files.length === 0) {
      if (required) return { value: null, error: 'This field is required.' };
      return { value: [], error: null };
    }
    if (files.length > MAX_FILES_PER_FIELD) {
      return { value: null, error: `Upload at most ${MAX_FILES_PER_FIELD} files.` };
    }
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        return { value: null, error: `Each file must be ${MAX_FILE_SIZE_MB}MB or smaller.` };
      }
      if (!isAllowedFileType(file.type, file.name)) {
        return {
          value: null,
          error: `"${file.name}" isn't a supported file type. Accepted: ${ALLOWED_FILE_TYPES_LABEL}.`,
        };
      }
    }
    return { value: files, error: null };
  }

  // Coerce arrays (checkbox groups submit as multi-value form fields).
  const isArrayField = block.type === 'field_checkbox';
  const hasValue = isArrayField
    ? Array.isArray(rawValue) && rawValue.length > 0
    : typeof rawValue === 'string'
      ? rawValue.trim().length > 0
      : rawValue === true || (typeof rawValue === 'string' && rawValue !== '');

  if (required && !hasValue) {
    return { value: null, error: 'This field is required.' };
  }
  if (!hasValue) {
    return { value: isArrayField ? [] : null, error: null };
  }

  switch (block.type) {
    case 'field_email': {
      const value = String(rawValue).trim();
      if (!EMAIL_REGEX.test(value)) {
        return { value: null, error: 'Enter a valid email address.' };
      }
      return { value: value.toLowerCase(), error: null };
    }
    case 'field_phone': {
      const value = String(rawValue).trim();
      if (!PHONE_REGEX.test(value)) {
        return { value: null, error: 'Enter a valid phone number.' };
      }
      return { value, error: null };
    }
    case 'field_text':
    case 'field_textarea':
    case 'field_hidden': {
      const value = String(rawValue);
      if (value.length > MAX_TEXT_LENGTH) {
        return { value: null, error: `Must be ${MAX_TEXT_LENGTH} characters or fewer.` };
      }
      return { value: value.trim(), error: null };
    }
    case 'field_select':
    case 'field_radio': {
      const value = String(rawValue).trim();
      const options = (block.props.options as { value: string }[] | undefined) ?? [];
      if (options.length > 0 && !options.some((o) => String(o.value) === value)) {
        return { value: null, error: 'Choose one of the available options.' };
      }
      return { value, error: null };
    }
    case 'field_checkbox': {
      const arr = Array.isArray(rawValue)
        ? rawValue.map((v) => String(v))
        : [String(rawValue)];
      const options = (block.props.options as { value: string }[] | undefined) ?? [];
      if (options.length > 0) {
        const allowed = new Set(options.map((o) => String(o.value)));
        const bad = arr.find((v) => !allowed.has(v));
        if (bad) {
          return { value: null, error: 'One of the selected options is not allowed.' };
        }
      }
      return { value: arr, error: null };
    }
    case 'field_consent': {
      // Consent renders as a checkbox — accept truthy markers from
      // HTML forms ("on", "true", "1") or boolean from JSON submits.
      const truthy =
        rawValue === true ||
        rawValue === 'on' ||
        rawValue === 'true' ||
        rawValue === '1';
      if (required && !truthy) {
        return { value: null, error: 'You must agree to continue.' };
      }
      return { value: truthy, error: null };
    }
    default:
      return { value: null, error: null };
  }
}

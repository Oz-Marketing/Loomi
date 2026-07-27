/**
 * Form-field block components.
 *
 * Each block renders both its label and its input. Field appearance is
 * controlled by the per-block style props (inputBgColor, inputBorderColor,
 * inputBorderRadius, etc.) so users get full design control of every input.
 *
 * The editor uses these components for preview. The public renderer (PR4)
 * will mount the same components but inside a real <form>; for that reason
 * inputs use the block's `name` prop as their HTML `name` attribute.
 *
 * All field components share the same "FieldShell" wrapper (label + input
 * + help text + margin) so per-field styling stays consistent.
 */
import * as React from 'react';
import { sanitizeInlineHtml } from '../sanitize-inline';

// ── Shared types ──────────────────────────────────────────────────

interface BaseFieldProps {
  label?: string;
  helpText?: string;
  required?: boolean;
  width?: 'full' | 'half';
  name?: string;
  marginBottom?: number;
  // Label
  labelColor?: string;
  labelFontSize?: number;
  labelFontWeight?: number | string;
  labelFontFamily?: string;
  // Input
  inputBgColor?: string;
  inputTextColor?: string;
  inputBorderColor?: string;
  inputBorderWidth?: number;
  inputBorderRadius?: number;
  inputPaddingY?: number;
  inputPaddingX?: number;
  inputFontSize?: number;
  inputFontFamily?: string;
  /** Responsive/hide class injected by the renderer (see responsive.ts). */
  className?: string;
}

interface OptionSpec {
  label: string;
  value: string;
}

// ── FieldShell — label + slot + help text ─────────────────────────

function FieldShell({
  label,
  helpText,
  required,
  width = 'full',
  marginBottom = 16,
  labelColor = '#1a1a1a',
  labelFontSize = 14,
  labelFontWeight = 600,
  labelFontFamily,
  htmlFor,
  className,
  children,
}: BaseFieldProps & { htmlFor?: string; children: React.ReactNode }) {
  return (
    <div
      className={className}
      style={{
        marginBottom: `${marginBottom}px`,
        width: width === 'half' ? '50%' : '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
      }}
    >
      {label && (
        <label
          htmlFor={htmlFor}
          style={{
            display: 'block',
            marginBottom: 6,
            color: labelColor,
            fontSize: `${labelFontSize}px`,
            fontWeight: String(labelFontWeight),
            fontFamily: labelFontFamily || undefined,
          }}
        >
          {label}
          {required && (
            <span style={{ color: '#dc2626', marginLeft: 4 }} aria-hidden>
              *
            </span>
          )}
        </label>
      )}
      {children}
      {helpText && (
        <div
          style={{
            marginTop: 4,
            fontSize: 12,
            color: '#6b7280',
          }}
        >
          {helpText}
        </div>
      )}
    </div>
  );
}

function inputStyle(props: BaseFieldProps): React.CSSProperties {
  const {
    inputBgColor = '#ffffff',
    inputTextColor = '#1a1a1a',
    inputBorderColor = '#d4d4d4',
    inputBorderWidth = 1,
    inputBorderRadius = 6,
    inputPaddingY = 10,
    inputPaddingX = 12,
    inputFontSize = 15,
    inputFontFamily,
  } = props;
  return {
    width: '100%',
    boxSizing: 'border-box',
    backgroundColor: inputBgColor,
    color: inputTextColor,
    border: `${inputBorderWidth}px solid ${inputBorderColor}`,
    borderRadius: `${inputBorderRadius}px`,
    padding: `${inputPaddingY}px ${inputPaddingX}px`,
    fontSize: `${inputFontSize}px`,
    fontFamily: inputFontFamily || 'inherit',
    outline: 'none',
  };
}

// ── Text variants ─────────────────────────────────────────────────

export interface FieldTextProps extends BaseFieldProps {
  placeholder?: string;
}

export const FieldText: React.FC<FieldTextProps> = (props) => {
  const id = props.name || undefined;
  return (
    <FieldShell {...props} htmlFor={id}>
      <input
        id={id}
        type="text"
        name={props.name}
        placeholder={props.placeholder}
        required={props.required}
        style={inputStyle(props)}
      />
    </FieldShell>
  );
};

export const FieldEmail: React.FC<FieldTextProps> = (props) => {
  const id = props.name || undefined;
  return (
    <FieldShell {...props} htmlFor={id}>
      <input
        id={id}
        type="email"
        name={props.name}
        placeholder={props.placeholder}
        required={props.required}
        style={inputStyle(props)}
      />
    </FieldShell>
  );
};

export const FieldPhone: React.FC<FieldTextProps> = (props) => {
  const id = props.name || undefined;
  return (
    <FieldShell {...props} htmlFor={id}>
      <input
        id={id}
        type="tel"
        name={props.name}
        placeholder={props.placeholder}
        required={props.required}
        style={inputStyle(props)}
      />
    </FieldShell>
  );
};

export interface FieldTextareaProps extends FieldTextProps {
  rows?: number;
}

export const FieldTextarea: React.FC<FieldTextareaProps> = (props) => {
  const id = props.name || undefined;
  return (
    <FieldShell {...props} htmlFor={id}>
      <textarea
        id={id}
        name={props.name}
        placeholder={props.placeholder}
        required={props.required}
        rows={props.rows ?? 4}
        style={{ ...inputStyle(props), resize: 'vertical', minHeight: 80 }}
      />
    </FieldShell>
  );
};

// ── Choice fields ─────────────────────────────────────────────────

export interface FieldSelectProps extends BaseFieldProps {
  options?: OptionSpec[];
  placeholder?: string;
}

export const FieldSelect: React.FC<FieldSelectProps> = (props) => {
  const id = props.name || undefined;
  const options = props.options ?? [];
  return (
    <FieldShell {...props} htmlFor={id}>
      <select
        id={id}
        name={props.name}
        required={props.required}
        style={inputStyle(props)}
        defaultValue=""
      >
        {props.placeholder && (
          <option value="" disabled>
            {props.placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
};

export interface FieldCheckboxProps extends BaseFieldProps {
  options?: OptionSpec[];
}

// Multi-select checkbox group. Each option becomes name="<fieldName>[]".
export const FieldCheckbox: React.FC<FieldCheckboxProps> = (props) => {
  const options = props.options ?? [];
  return (
    <FieldShell {...props}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map((opt) => (
          <label
            key={opt.value}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              color: props.inputTextColor || '#1a1a1a',
              fontSize: `${props.inputFontSize ?? 15}px`,
            }}
          >
            <input
              type="checkbox"
              name={props.name}
              value={opt.value}
              style={{ width: 16, height: 16 }}
            />
            {opt.label}
          </label>
        ))}
      </div>
    </FieldShell>
  );
};

export interface FieldRadioProps extends BaseFieldProps {
  options?: OptionSpec[];
}

export const FieldRadio: React.FC<FieldRadioProps> = (props) => {
  const options = props.options ?? [];
  return (
    <FieldShell {...props}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map((opt) => (
          <label
            key={opt.value}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              color: props.inputTextColor || '#1a1a1a',
              fontSize: `${props.inputFontSize ?? 15}px`,
            }}
          >
            <input
              type="radio"
              name={props.name}
              value={opt.value}
              style={{ width: 16, height: 16 }}
            />
            {opt.label}
          </label>
        ))}
      </div>
    </FieldShell>
  );
};

// ── Consent + hidden ──────────────────────────────────────────────

export interface FieldConsentProps extends BaseFieldProps {
  // Consent reuses `label` as the consent body text (often a sentence
  // with embedded HTML links to terms/privacy).
}

export const FieldConsent: React.FC<FieldConsentProps> = (props) => {
  const id = props.name || 'consent';
  return (
    <div
      className={props.className}
      style={{
        marginBottom: `${props.marginBottom ?? 16}px`,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        width: '100%',
      }}
    >
      <input
        id={id}
        type="checkbox"
        name={props.name || 'consent'}
        required={props.required}
        style={{ width: 16, height: 16, marginTop: 3, flexShrink: 0 }}
      />
      <label
        htmlFor={id}
        style={{
          color: props.labelColor || '#3a3a3a',
          fontSize: `${props.labelFontSize ?? 13}px`,
          fontWeight: String(props.labelFontWeight ?? 400),
          fontFamily: props.labelFontFamily || undefined,
          lineHeight: 1.5,
        }}
      >
        {/* Consent text is authored HTML so builders can embed links
            (Privacy Policy / Terms). Sanitized to inline tags only. */}
        <span dangerouslySetInnerHTML={{ __html: sanitizeInlineHtml(props.label ?? '') }} />
        {props.required && (
          <span style={{ color: '#dc2626', marginLeft: 4 }} aria-hidden>
            *
          </span>
        )}
      </label>
    </div>
  );
};

export interface FieldHiddenProps {
  name?: string;
  value?: string;
}

// Hidden inputs render a small editor-visible chip so they're discoverable
// while editing. The public renderer renders a real <input type="hidden"/>.
export const FieldHidden: React.FC<FieldHiddenProps> = ({ name = '', value = '' }) => {
  return (
    <div
      style={{
        marginBottom: 12,
        padding: '6px 10px',
        borderRadius: 6,
        border: '1px dashed #d4d4d4',
        backgroundColor: '#f9fafb',
        color: '#6b7280',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        display: 'inline-flex',
        gap: 8,
        alignItems: 'center',
      }}
    >
      <span style={{ fontWeight: 600 }}>hidden</span>
      <span>{name || '(unnamed)'}</span>
      <span style={{ color: '#9ca3af' }}>=</span>
      <span>{value || '""'}</span>
    </div>
  );
};

// ── Submit button ─────────────────────────────────────────────────

export interface SubmitButtonProps {
  text?: string;
  align?: 'left' | 'center' | 'right';
  fullWidth?: boolean;
  bgColor?: string;
  textColor?: string;
  borderRadius?: number;
  borderWidth?: number;
  borderColor?: string;
  paddingY?: number;
  paddingX?: number;
  fontSize?: number;
  fontWeight?: number | string;
  fontFamily?: string;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  letterSpacing?: number | string;
  /** Responsive/hide class injected by the renderer (see responsive.ts). */
  className?: string;
}

export const SubmitButton: React.FC<SubmitButtonProps> = ({
  text = 'Submit',
  align = 'left',
  fullWidth = false,
  bgColor = '#1a1a1a',
  textColor = '#ffffff',
  borderRadius = 6,
  borderWidth = 0,
  borderColor,
  paddingY = 14,
  paddingX = 28,
  fontSize = 15,
  fontWeight = 600,
  fontFamily,
  textTransform = 'none',
  letterSpacing,
  className,
}) => {
  return (
    <div className={className} style={{ textAlign: align }}>
      <button
        type="submit"
        style={{
          display: fullWidth ? 'block' : 'inline-block',
          width: fullWidth ? '100%' : undefined,
          backgroundColor: bgColor,
          color: textColor,
          border:
            borderWidth > 0 && borderColor
              ? `${borderWidth}px solid ${borderColor}`
              : 'none',
          borderRadius: `${borderRadius}px`,
          padding: `${paddingY}px ${paddingX}px`,
          fontSize: `${fontSize}px`,
          fontWeight: String(fontWeight),
          fontFamily: fontFamily || 'inherit',
          textTransform,
          letterSpacing:
            typeof letterSpacing === 'number' ? `${letterSpacing}px` : letterSpacing,
          cursor: 'pointer',
        }}
      >
        {text}
      </button>
    </div>
  );
};

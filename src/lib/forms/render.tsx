/**
 * Render a v1 FormTemplate to a React tree, for use on the public
 * /f/[slug] page and inside the embedded-form landing-page block.
 *
 * Unlike the email renderer (which walks blocks → react-email → HTML
 * string), this just walks blocks and renders the form components
 * directly. The components are plain React/HTML so the output works in
 * any modern browser without server-side rendering tricks.
 */
import * as React from 'react';
import type { Block, FormTemplate } from './types';
import { BLOCK_COMPONENTS } from './components';
import {
  blockHasResponsive,
  blockResponsiveClass,
  buildBlockResponsiveCss,
} from './responsive';

interface RenderOptions {
  /**
   * When true, render with field error messages from the last submit
   * attempt. The form-public component owns this state and threads
   * errors through via context.
   */
  errors?: Record<string, string>;
}

export interface FormRendererProps {
  template: FormTemplate;
  options?: RenderOptions;
}

const FieldErrorContext = React.createContext<Record<string, string>>({});

export function FormRenderer({ template, options }: FormRendererProps) {
  const errors = options?.errors ?? {};
  // Per-side spacing — `??` lets us tolerate older schemas that
  // predate these fields (they fall through to 32 on every side).
  const s = template.settings;
  const margin = `${s.contentMarginTop ?? 32}px ${s.contentMarginRight ?? 32}px ${s.contentMarginBottom ?? 32}px ${s.contentMarginLeft ?? 32}px`;
  const padding = `${s.contentPaddingTop ?? 32}px ${s.contentPaddingRight ?? 32}px ${s.contentPaddingBottom ?? 32}px ${s.contentPaddingLeft ?? 32}px`;
  return (
    <FieldErrorContext.Provider value={errors}>
      <div
        className="loomi-form-root"
        style={{
          backgroundColor: s.bodyBg,
          fontFamily: s.fontFamily,
          color: s.textColor,
          minHeight: '100%',
          padding: margin,
        }}
      >
        <div
          style={{
            maxWidth: `${s.contentWidth}px`,
            margin: '0 auto',
            backgroundColor: s.contentBg,
            borderRadius: s.contentBorderRadius ?? 12,
            padding,
          }}
        >
          {template.blocks.map((block) => (
            <RenderedBlock key={block.id} block={block} />
          ))}
        </div>
      </div>
    </FieldErrorContext.Provider>
  );
}

function RenderedBlock({ block }: { block: Block }) {
  const Component = BLOCK_COMPONENTS[block.type] as React.ComponentType<any> | undefined;
  if (!Component) {
    return null;
  }

  const errors = React.useContext(FieldErrorContext);
  const fieldError = errors[String(block.props.name ?? block.id)];

  // Per-breakpoint overrides + hide toggles compile to a scoped <style>
  // and a class attached to the block's root element. Absent when the
  // block has no responsive rules (the common case) — zero overhead.
  const responsiveClass = blockHasResponsive(block)
    ? blockResponsiveClass(block.id)
    : undefined;
  const responsiveCss = responsiveClass
    ? buildBlockResponsiveCss(responsiveClass, block)
    : null;
  const styleTag = responsiveCss ? (
    <style dangerouslySetInnerHTML={{ __html: responsiveCss }} />
  ) : null;

  if (block.type === 'section' || block.type === 'columns') {
    const children = block.children ?? [];
    return (
      <>
        {styleTag}
        <Component {...block.props} className={responsiveClass}>
          {children.map((child) => (
            <RenderedBlock key={child.id} block={child} />
          ))}
        </Component>
      </>
    );
  }

  // Hidden fields must be invisible on the live form. The FieldHidden
  // component is an editor-only chip (for discoverability while editing);
  // here we emit a real <input type="hidden"> so the passthrough value
  // (e.g. source) still rides along in the FormData submission.
  if (block.type === 'field_hidden') {
    const name = String(block.props.name ?? '').trim();
    if (!name) return null;
    return <input type="hidden" name={name} defaultValue={String(block.props.value ?? '')} />;
  }

  // Field blocks: surface the error inline directly under the input.
  // (Hidden fields already returned above, so they never reach here.)
  if (block.type.startsWith('field_') && fieldError) {
    return (
      <>
        {styleTag}
        <Component {...block.props} className={responsiveClass} />
        <div
          role="alert"
          style={{
            marginTop: -8,
            marginBottom: 16,
            color: '#dc2626',
            fontSize: 13,
          }}
        >
          {fieldError}
        </div>
      </>
    );
  }

  return (
    <>
      {styleTag}
      <Component {...block.props} className={responsiveClass} />
    </>
  );
}

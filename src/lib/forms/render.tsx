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
  return (
    <FieldErrorContext.Provider value={errors}>
      <div
        className="loomi-form-root"
        style={{
          backgroundColor: template.settings.bodyBg,
          fontFamily: template.settings.fontFamily,
          color: template.settings.textColor,
          minHeight: '100%',
          padding: '32px 16px',
        }}
      >
        <div
          style={{
            maxWidth: `${template.settings.contentWidth}px`,
            margin: '0 auto',
            backgroundColor: template.settings.contentBg,
            borderRadius: 12,
            padding: '8px 0',
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

  if (block.type === 'section' || block.type === 'columns') {
    const children = block.children ?? [];
    return (
      <Component {...block.props}>
        {children.map((child) => (
          <RenderedBlock key={child.id} block={child} />
        ))}
      </Component>
    );
  }

  // Field blocks: surface the error inline directly under the input.
  // Hidden fields render no error UI (they're not user-visible).
  if (block.type.startsWith('field_') && fieldError && block.type !== 'field_hidden') {
    return (
      <>
        <Component {...block.props} />
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

  return <Component {...block.props} />;
}

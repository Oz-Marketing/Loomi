import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditorProvider } from './editor/EditorContext';
import { FormSettings } from './editor/FormSettings';
import { DEFAULT_FORM_SETTINGS, type FormSettings as Settings, type FormTemplate } from './types';

// The settings panel is behind a login, so these render it directly to
// markup — enough to catch a broken import or a control that stopped
// rendering, which is the failure mode a schema/registry change causes.

function panelHtml(patch: Partial<Settings>): string {
  const template: FormTemplate = {
    version: '1',
    settings: { ...DEFAULT_FORM_SETTINGS, ...patch },
    blocks: [],
  };
  return renderToStaticMarkup(
    React.createElement(
      EditorProvider,
      { template, onChange: () => {} },
      React.createElement(FormSettings),
    ),
  );
}

describe('FormSettings layout controls', () => {
  it('renders the full-width switch', () => {
    const html = panelHtml({});
    expect(html).toContain('Full Width');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
  });

  it('shows the width slider, raised to a 1600px ceiling, when not full-bleed', () => {
    const html = panelHtml({ contentWidth: 1280 });
    expect(html).toContain('Form Width');
    expect(html).toContain('max="1600"');
    expect(html).toContain('1280');
  });

  it('hides the width slider in full-bleed mode', () => {
    const html = panelHtml({ contentFullWidth: true });
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain('Form Width');
  });
});

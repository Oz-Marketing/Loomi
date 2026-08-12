import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormRenderer } from './render';
import {
  DEFAULT_FORM_SETTINGS,
  formContentMaxWidth,
  type FormSettings,
  type FormTemplate,
} from './types';

const settings = (patch: Partial<FormSettings>): FormSettings => ({
  ...DEFAULT_FORM_SETTINGS,
  ...patch,
});

const template = (patch: Partial<FormSettings>): FormTemplate => ({
  version: '1',
  settings: settings(patch),
  blocks: [{ id: 'h1', type: 'heading', props: { text: 'Hi' } }],
});

describe('formContentMaxWidth', () => {
  it('caps the card at the configured width', () => {
    expect(formContentMaxWidth(settings({ contentWidth: 1024 }))).toBe('1024px');
  });

  it('removes the cap entirely in full-bleed mode', () => {
    expect(
      formContentMaxWidth(settings({ contentWidth: 1024, contentFullWidth: true })),
    ).toBe('none');
  });

  it('treats a schema written before the setting existed as not full-bleed', () => {
    const legacy = settings({ contentWidth: 640 });
    delete (legacy as Partial<FormSettings>).contentFullWidth;
    expect(formContentMaxWidth(legacy)).toBe('640px');
  });

  it('keeps the stored width so toggling full-bleed off restores it', () => {
    const full = settings({ contentWidth: 1280, contentFullWidth: true });
    expect(formContentMaxWidth({ ...full, contentFullWidth: false })).toBe('1280px');
  });
});

describe('FormRenderer width', () => {
  it('applies the configured width to the card', () => {
    const html = renderToStaticMarkup(
      React.createElement(FormRenderer, { template: template({ contentWidth: 1440 }) }),
    );
    expect(html).toContain('max-width:1440px');
  });

  it('renders edge to edge in full-bleed mode', () => {
    const html = renderToStaticMarkup(
      React.createElement(FormRenderer, {
        template: template({ contentWidth: 1440, contentFullWidth: true }),
      }),
    );
    expect(html).toContain('max-width:none');
    expect(html).not.toContain('max-width:1440px');
  });
});

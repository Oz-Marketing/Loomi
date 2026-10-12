import { describe, expect, it } from 'vitest';
import {
  extractTemplateMeta,
  forkedTemplateName,
  needsFork,
  planTemplateMetaSync,
} from './blast-template';

const v2 = (fields: Record<string, unknown>) =>
  JSON.stringify({ version: '2', settings: {}, blocks: [], ...fields });

describe('extractTemplateMeta', () => {
  it('reads the editor’s Subject Line and Preheader from a drag-and-drop template', () => {
    expect(extractTemplateMeta(v2({ title: 'Spring Sale', subject: 'Save 20%', preheader: 'This week only' }))).toEqual({
      subject: 'Save 20%',
      preheader: 'This week only',
    });
  });

  it('never uses the template’s name as a subject', () => {
    expect(extractTemplateMeta(v2({ title: 'Spring Sale' })).subject).toBe('');
    expect(extractTemplateMeta('---\ntitle: "Spring Sale"\n---\n<html></html>').subject).toBe('');
  });

  it('ignores the "Untitled Template" placeholder a new template starts with', () => {
    expect(extractTemplateMeta(v2({ subject: 'Untitled Template' })).subject).toBe('');
  });

  it('reads subject and preheader frontmatter from an HTML template', () => {
    expect(
      extractTemplateMeta('---\ntitle: Name\nsubject: "Your service is due"\npreheader: Book now\n---\n<html></html>'),
    ).toEqual({ subject: 'Your service is due', preheader: 'Book now' });
    expect(extractTemplateMeta('<html><body>hi</body></html>')).toEqual({ subject: '', preheader: '' });
  });
});

describe('planTemplateMetaSync', () => {
  const template = { subject: 'Save 20%', preheader: 'This week only' };
  const base = { blastName: 'October Service', blastSubject: '', blastPreview: '', metadata: '' };

  it('fills blank fields from the template and records what it supplied', () => {
    expect(planTemplateMetaSync({ ...base, template })).toEqual({
      subject: 'Save 20%',
      previewText: 'This week only',
      metadataPatch: { templateSubject: 'Save 20%', templatePreheader: 'This week only' },
    });
  });

  it('keeps following the template while the fields are still the template’s', () => {
    const metadata = JSON.stringify({ templateSubject: 'Old subject', templatePreheader: 'Old pre' });
    expect(
      planTemplateMetaSync({ ...base, blastSubject: 'Old subject', blastPreview: 'Old pre', metadata, template }),
    ).toMatchObject({ subject: 'Save 20%', previewText: 'This week only' });
  });

  it('stops once someone typed their own', () => {
    const metadata = JSON.stringify({ templateSubject: 'Old subject', templatePreheader: 'Old pre' });
    const plan = planTemplateMetaSync({
      ...base,
      blastSubject: 'My subject',
      blastPreview: 'My preview',
      metadata,
      template,
    });
    expect(plan.subject).toBeUndefined();
    expect(plan.previewText).toBeUndefined();
  });

  // Drafts made before this fix defaulted their subject to the blast name.
  it('replaces a subject that is just the blast name', () => {
    expect(planTemplateMetaSync({ ...base, blastSubject: 'October Service', template }).subject).toBe('Save 20%');
  });

  it('never invents a subject from the blast name', () => {
    const plan = planTemplateMetaSync({ ...base, template: { subject: '', preheader: '' } });
    expect(plan.subject).toBeUndefined();
  });

  it('clears a subject the template put there once the template drops it', () => {
    const metadata = JSON.stringify({ templateSubject: 'Save 20%' });
    expect(
      planTemplateMetaSync({ ...base, blastSubject: 'Save 20%', metadata, template: { subject: '', preheader: '' } })
        .subject,
    ).toBe('');
  });

  it('changes nothing when the blast already matches', () => {
    const plan = planTemplateMetaSync({
      ...base,
      blastSubject: 'Save 20%',
      blastPreview: 'This week only',
      template,
    });
    expect(plan.subject).toBeUndefined();
    expect(plan.previewText).toBeUndefined();
  });
});

describe('needsFork', () => {
  it('copies anything the blast’s account does not own outright', () => {
    expect(needsFork(null, 'acct')).toBe(true); // shared library
    expect(needsFork('group-acct', 'acct')).toBe(true); // a group's template
    expect(needsFork('acct', 'acct')).toBe(false);
  });
});

describe('forkedTemplateName', () => {
  it('names the copy after the template and the blast', () => {
    expect(forkedTemplateName('Spring Sale', 'October Service')).toBe('Spring Sale — October Service');
    expect(forkedTemplateName('Spring Sale', '')).toBe('Spring Sale');
    expect(forkedTemplateName('', 'October')).toBe('Template — October');
  });

  it('stays a sensible length', () => {
    expect(forkedTemplateName('x'.repeat(100), 'y'.repeat(100)).length).toBe(120);
  });
});

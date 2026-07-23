import { describe, it, expect } from 'vitest';
import { validateSubmission, FormValidationError } from './validate';
import { emptyFormTemplate, type Block, type FormTemplate } from './types';
import { MAX_FILE_SIZE_BYTES } from './file-upload';

function formWith(blocks: Block[]): FormTemplate {
  return { ...emptyFormTemplate(), blocks };
}

function fileBlock(props: Record<string, unknown> = {}): Block {
  return { id: 'resume', type: 'field_file', props: { name: 'resume', ...props } };
}

function makeFile(name: string, type: string, size: number): File {
  // Build a File of an exact byte length without allocating `size` bytes
  // of real content — a sparse Blob part is enough for size checks.
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

describe('validateSubmission — field_file', () => {
  it('accepts a single valid file and returns it as an array', () => {
    const file = makeFile('cv.pdf', 'application/pdf', 1024);
    const { values } = validateSubmission(formWith([fileBlock()]), { resume: file });
    expect(Array.isArray(values.resume)).toBe(true);
    expect((values.resume as File[])[0]).toBe(file);
  });

  it('accepts multiple valid files', () => {
    const a = makeFile('a.png', 'image/png', 500);
    const b = makeFile('b.jpg', 'image/jpeg', 500);
    const { values } = validateSubmission(formWith([fileBlock()]), { resume: [a, b] });
    expect((values.resume as File[]).length).toBe(2);
  });

  it('allows a file whose MIME is empty but extension is on the allowlist', () => {
    const file = makeFile('data.csv', '', 200);
    const { values } = validateSubmission(formWith([fileBlock()]), { resume: file });
    expect((values.resume as File[])[0]).toBe(file);
  });

  it('rejects a file over the size cap', () => {
    const file = makeFile('big.pdf', 'application/pdf', MAX_FILE_SIZE_BYTES + 1);
    expect(() =>
      validateSubmission(formWith([fileBlock()]), { resume: file }),
    ).toThrow(FormValidationError);
  });

  it('rejects a disallowed file type', () => {
    const file = makeFile('evil.exe', 'application/x-msdownload', 100);
    expect(() =>
      validateSubmission(formWith([fileBlock()]), { resume: file }),
    ).toThrow(FormValidationError);
  });

  it('errors when a required file field is empty', () => {
    expect(() =>
      validateSubmission(formWith([fileBlock({ required: true })]), {}),
    ).toThrow(FormValidationError);
  });

  it('passes and returns [] when an optional file field is empty', () => {
    const { values } = validateSubmission(formWith([fileBlock()]), {});
    expect(values.resume).toEqual([]);
  });
});

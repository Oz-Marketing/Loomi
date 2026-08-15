// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { pruneResolvedElements, type TrackableElement } from './unsaved-changes-context';

/** An input in the document, with `initial` recorded as its focus-time value. */
function trackedInput(initial: string, current = initial) {
  const el = document.createElement('input');
  el.value = current;
  document.body.appendChild(el);
  const initialValues = new WeakMap<TrackableElement, string>([[el, initial]]);
  return { el, initialValues };
}

describe('pruneResolvedElements', () => {
  it('keeps an element whose value still differs from what was first seen', () => {
    const { el, initialValues } = trackedInput('Chevrolet', 'Chevrolet, GMC');
    const dirty = new Set<TrackableElement>([el]);

    pruneResolvedElements(dirty, initialValues);

    expect(dirty.has(el)).toBe(true);
  });

  it('drops an element whose value was put back programmatically', () => {
    // The add-a-feed case: type a URL, submit, and React clears the field. No
    // `input` event fires for that, so only this pass can notice it's clean now.
    const { el, initialValues } = trackedInput('', 'https://example.com/feed.csv');
    const dirty = new Set<TrackableElement>([el]);

    el.value = '';
    pruneResolvedElements(dirty, initialValues);

    expect(dirty.has(el)).toBe(false);
  });

  it('drops an element that has left the DOM', () => {
    const { el, initialValues } = trackedInput('', 'typed');
    const dirty = new Set<TrackableElement>([el]);

    el.remove();
    pruneResolvedElements(dirty, initialValues);

    expect(dirty.has(el)).toBe(false);
  });

  it('leaves an element with no recorded starting value alone', () => {
    const el = document.createElement('textarea');
    el.value = 'something';
    document.body.appendChild(el);
    const dirty = new Set<TrackableElement>([el]);

    pruneResolvedElements(dirty, new WeakMap());

    expect(dirty.has(el)).toBe(true);
  });

  it('treats a checkbox by its checked state, not its value attribute', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = true;
    document.body.appendChild(el);
    const dirty = new Set<TrackableElement>([el]);
    const initialValues = new WeakMap<TrackableElement, string>([[el, '0']]);

    pruneResolvedElements(dirty, initialValues);
    expect(dirty.has(el)).toBe(true);

    el.checked = false;
    pruneResolvedElements(dirty, initialValues);
    expect(dirty.has(el)).toBe(false);
  });
});

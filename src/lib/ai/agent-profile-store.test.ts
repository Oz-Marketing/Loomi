import { describe, it, expect, vi, beforeEach } from 'vitest';

const findUnique = vi.fn();
const create = vi.fn();
const update = vi.fn();
const deleteMany = vi.fn();
const revisionCreate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    agentProfile: { findUnique, create, update, deleteMany },
    agentProfileRevision: { create: revisionCreate, findMany: vi.fn() },
  },
}));

const {
  resolveProfile,
  saveProfile,
  validateProfileInput,
  ProfileValidationError,
} = await import('./agent-profile-store');

const FALLBACK = { instructions: 'DEFAULT BRIEF', notes: undefined };

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    specialistKey: 'coop',
    name: 'Vera',
    instructions: 'EDITED BRIEF',
    notes: 'house notes',
    effort: 'high',
    updatedAt: new Date('2026-08-25T12:00:00Z'),
    updatedBy: 'user-1',
    ...over,
  };
}

beforeEach(() => {
  for (const fn of [findUnique, create, update, deleteMany, revisionCreate]) fn.mockReset();
});

describe('resolveProfile', () => {
  it('uses the code default when nothing has been edited', async () => {
    findUnique.mockResolvedValue(null);
    const r = await resolveProfile('coop', FALLBACK, 'high');
    expect(r).toMatchObject({ instructions: 'DEFAULT BRIEF', customized: false, effort: 'high' });
  });

  it('falls back FIELD BY FIELD, not all-or-nothing', async () => {
    // A team that wrote notes without touching the brief must keep getting the
    // MAINTAINED default brief — not a copy frozen the day they first saved.
    findUnique.mockResolvedValue(row({ instructions: '' }));
    const r = await resolveProfile('coop', FALLBACK, 'high');
    expect(r.instructions).toBe('DEFAULT BRIEF');
    expect(r.notes).toBe('house notes');
    expect(r.customized).toBe(true);
  });

  it('never lets a database failure silence a specialist', async () => {
    // An unreachable database must not leave the agent with no instructions —
    // it answers on its default rather than as a faceless generic assistant.
    findUnique.mockRejectedValue(new Error('connection refused'));
    const r = await resolveProfile('coop', FALLBACK, 'medium');
    expect(r.instructions).toBe('DEFAULT BRIEF');
    expect(r.effort).toBe('medium');
    expect(r.customized).toBe(false);
  });

  it('repairs a nonsense effort rather than passing it to the API', async () => {
    findUnique.mockResolvedValue(row({ effort: 'ludicrous' }));
    expect((await resolveProfile('coop', FALLBACK, 'high')).effort).toBe('high');
  });
});

describe('validateProfileInput', () => {
  it('refuses empty instructions', () => {
    // Blanking the brief doesn't reset a specialist — it strips her character and
    // leaves a generic assistant still wearing her face. Resetting deletes the row.
    expect(() => validateProfileInput({ instructions: '   ' })).toThrow(ProfileValidationError);
    expect(() => validateProfileInput({ instructions: 'ok' })).not.toThrow();
  });

  it('refuses an empty name and an unknown effort', () => {
    expect(() => validateProfileInput({ name: ' ' })).toThrow(ProfileValidationError);
    expect(() =>
      validateProfileInput({ effort: 'turbo' as unknown as 'high' }),
    ).toThrow(ProfileValidationError);
  });

  it('allows notes to be cleared — unlike instructions, empty is meaningful', () => {
    expect(() => validateProfileInput({ notes: '' })).not.toThrow();
    expect(() => validateProfileInput({ notes: null })).not.toThrow();
  });

  it('accepts only faces from the committed library', () => {
    // An arbitrary URL here would point the product's own chrome at somebody
    // else's server, and would do it from a settings field.
    expect(() => validateProfileInput({ portraitUrl: '/agents/library/vera.webp' })).not.toThrow();
    expect(() => validateProfileInput({ portraitUrl: null })).not.toThrow();
    expect(() => validateProfileInput({ portraitUrl: 'https://evil.example/x.png' })).toThrow(
      ProfileValidationError,
    );
    expect(() => validateProfileInput({ portraitUrl: '/agents/library/nope.webp' })).toThrow(
      ProfileValidationError,
    );
  });
});

describe('saveProfile', () => {
  const base = {
    specialistKey: 'coop',
    fallback: FALLBACK,
    fallbackEffort: 'high' as const,
    defaultName: 'Vera',
    userId: 'user-2',
  };

  it('records the CODE DEFAULT as the first revision', async () => {
    // Otherwise a specialist's history starts at its first edit and there is no
    // record anywhere of what it originally said.
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue(row({ instructions: 'NEW' }));

    await saveProfile({ ...base, input: { instructions: 'NEW' } });

    expect(revisionCreate).toHaveBeenCalledTimes(1);
    const rev = revisionCreate.mock.calls[0][0].data;
    expect(rev.instructions).toBe('DEFAULT BRIEF');
    expect(rev.changedBy).toBeNull(); // nobody wrote the default; it shipped
  });

  it('records the PREVIOUS values on a later edit, not the new ones', async () => {
    findUnique.mockResolvedValue(row({ instructions: 'OLD', updatedBy: 'user-1' }));
    update.mockResolvedValue(row({ instructions: 'NEWER' }));

    await saveProfile({ ...base, input: { instructions: 'NEWER' } });

    const rev = revisionCreate.mock.calls[0][0].data;
    expect(rev.instructions).toBe('OLD');
    expect(rev.changedBy).toBe('user-1');
  });

  it('leaves untouched fields alone', async () => {
    findUnique.mockResolvedValue(row());
    update.mockResolvedValue(row());

    await saveProfile({ ...base, input: { effort: 'max' } });

    const data = update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      instructions: 'EDITED BRIEF',
      notes: 'house notes',
      name: 'Vera',
      effort: 'max',
    });
  });

  it('distinguishes clearing notes from not mentioning them', async () => {
    findUnique.mockResolvedValue(row());
    update.mockResolvedValue(row());

    await saveProfile({ ...base, input: { notes: '' } });
    expect(update.mock.calls[0][0].data.notes).toBeNull();

    update.mockClear();
    await saveProfile({ ...base, input: { name: 'Vera' } });
    expect(update.mock.calls[0][0].data.notes).toBe('house notes');
  });

  it('validates before writing anything', async () => {
    findUnique.mockResolvedValue(row());
    await expect(saveProfile({ ...base, input: { instructions: '' } })).rejects.toThrow(
      ProfileValidationError,
    );
    expect(update).not.toHaveBeenCalled();
    expect(revisionCreate).not.toHaveBeenCalled();
  });

  it('stamps a new profile as agency-owned', async () => {
    // v1 is agency-only; the column exists so per-account agents are later a
    // config change rather than a backfill of a scope nobody recorded.
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue(row());
    await saveProfile({ ...base, input: { instructions: 'x' } });
    expect(create.mock.calls[0][0].data.ownerScope).toBe('agency');
  });
});

import { describe, expect, it } from 'vitest';
import type { ProofState } from './monday-board';
import { nextStatusForProof } from './proof-watch';

const proof = (status: string | null, approved = false): ProofState => ({
  status,
  url: null,
  approvedOn: null,
  approved,
});

describe('nextStatusForProof', () => {
  it('makes an approved proof final', () => {
    expect(nextStatusForProof('in_proofing', proof('Approved', true))).toBe('approved');
    expect(nextStatusForProof('changes_requested', proof('Approved', true))).toBe('approved');
  });

  it('follows the proof back and forth while it is open', () => {
    expect(nextStatusForProof('in_proofing', proof('To-dos requested'))).toBe('changes_requested');
    expect(nextStatusForProof('changes_requested', proof('Has new version'))).toBe('in_proofing');
    expect(nextStatusForProof('changes_requested', proof('In proofing'))).toBe('in_proofing');
  });

  it('leaves the request alone on labels that say nothing about the draft', () => {
    for (const label of ['No proof', 'Canceled', 'Archived', null]) {
      expect(nextStatusForProof('in_proofing', proof(label))).toBe('in_proofing');
    }
  });
});

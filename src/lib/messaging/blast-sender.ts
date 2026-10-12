// The From line of a blast email, as the builder shows it AND as the send
// builds it — one rule, so the two can't drift.
//
// They had drifted: the Message and Schedule steps showed
// `senderName || dealer`, but the send used `senderName || undefined`, so an
// account without a sender name was shown "From: Audi Layton" and mailed from
// a bare address. The send now falls back to the account name as well; both
// sides call fromDisplayName so whitespace-only names fall through the same way.

export interface SenderIdentityFields {
  senderName?: string | null;
  /** The account's name. */
  dealer?: string | null;
  senderEmail?: string | null;
}

/** The display name a blast is sent under: sender name, else account name. */
export function fromDisplayName(fields: SenderIdentityFields | null | undefined): string {
  return (fields?.senderName || '').trim() || (fields?.dealer || '').trim();
}

/** `Name <email>` for display; just the address when there's no name. */
export function formatFromLine(fields: SenderIdentityFields | null | undefined): string {
  const name = fromDisplayName(fields);
  const email = (fields?.senderEmail || '').trim();
  if (!email) return name;
  return name ? `${name} <${email}>` : email;
}

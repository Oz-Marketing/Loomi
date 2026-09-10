"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { DatePicker, type DateRange } from "@/components/ui/date-picker";
import { AccountAccessPicker } from "@/components/ad-generator/account-access-picker";

/**
 * Publish — who a template goes live for, and when.
 *
 * These were three controls: Publish / Move to draft in the card menu, a Share
 * modal, and a Schedule modal. Each answered part of "can this dealer use this
 * template?" and none of them said so, which made them read as alternatives
 * rather than as one setting. The visible result was a template published to
 * everyone, then shared with three accounts, still describing itself as
 * available to all — because publishing and sharing had no stated relationship
 * and the card only looked at one of them.
 *
 * One modal, one Save, one PATCH. The audience wording depends on whether the
 * template has an owning account, because "All accounts" is not on offer for a
 * template that belongs to one dealer — it is theirs plus anyone they share with.
 */
export type AvailabilityValue = {
  status: string;
  sharedAccountKeys: string[];
  schedule?: { start?: string | null; end?: string | null } | null;
};

/**
 * WHO this publishes to. Draft is not one of these.
 *
 * It was a third radio, which made "park this as a draft" and "who is this
 * for" the same question: choosing Draft deselected the audience, and Save
 * then wrote an EMPTY share list — a draft carrying five shared accounts lost
 * all five the moment you touched anything else in this modal. Unpublishing is
 * now its own action in the footer, and the audience survives it.
 */
type Audience = "self" | "share";

/** The stored columns, read as the two things a person actually chose. */
function audienceOf(v: AvailabilityValue): Audience {
  return v.sharedAccountKeys.length ? "share" : "self";
}

export function AvailabilityModal({
  templateId,
  name,
  ownerKey,
  ownerName,
  initial,
  onClose,
  onSaved,
}: {
  templateId: string;
  name: string;
  /** The template's own account scope. Null = authored in the shared library. */
  ownerKey: string | null;
  ownerName?: string | null;
  initial: AvailabilityValue;
  onClose: () => void;
  onSaved?: (next: AvailabilityValue) => void;
}) {
  const [published, setPublished] = useState(initial.status === "published");
  const [audience, setAudience] = useState<Audience>(() => audienceOf(initial));
  const [keys, setKeys] = useState<string[]>(initial.sharedAccountKeys);
  const [start, setStart] = useState<string | null>(
    initial.schedule?.start ?? null,
  );
  const [end, setEnd] = useState<string | null>(initial.schedule?.end ?? null);
  const [busy, setBusy] = useState(false);

  const owner = ownerName || ownerKey;
  const invalidRange = !!start && !!end && end < start;
  // Picking "specific accounts" and naming none would publish a template nobody
  // can use. Block the save rather than writing a state with no meaning.
  const noAccounts =
    published && audience === "share" && keys.length === 0 && !ownerKey;

  /** What actually gets written — the two columns, derived from the one choice. */
  const next: AvailabilityValue = useMemo(
    () => ({
      status: published ? "published" : "draft",
      // Self is the ABSENCE of a share list, so switching back to it has to
      // clear the list — otherwise the old audience silently survives the change
      // and we are back to a template that claims one scope and enforces another.
      sharedAccountKeys: audience === "share" ? keys : [],
      schedule: start || end ? { start, end } : null,
    }),
    [published, audience, keys, start, end],
  );

  const changed =
    next.status !== initial.status ||
    next.sharedAccountKeys.length !== initial.sharedAccountKeys.length ||
    next.sharedAccountKeys.some(
      (k) => !initial.sharedAccountKeys.includes(k),
    ) ||
    (next.schedule?.start ?? null) !== (initial.schedule?.start ?? null) ||
    (next.schedule?.end ?? null) !== (initial.schedule?.end ?? null);

  /**
   * Save PUBLISHES. There is no draft radio to pick, so reaching this with the
   * template unpublished means the person opened "Publish" and pressed Save —
   * taking it live is the only reading of that.
   */
  const save = async (opts?: { unpublish?: boolean }) => {
    if (!opts?.unpublish && (invalidRange || noAccounts)) return;
    setPublished(!opts?.unpublish);
    setBusy(true);
    try {
      const res = await fetch(`/api/ad-generator/templates-doc/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // All three in one request: a half-applied availability (published, but
        // the share list not written yet) is exactly the state this modal exists
        // to make impossible.
        body: JSON.stringify({
          status: opts?.unpublish ? "draft" : "published",
          sharedAccountKeys: next.sharedAccountKeys,
          schedule: next.schedule,
        }),
      });
      if (!res.ok)
        throw new Error(
          (await res.json().catch(() => null))?.error || `HTTP ${res.status}`,
        );
      toast.success(
        opts?.unpublish
          ? "Moved to draft — hidden from every account"
          : next.sharedAccountKeys.length
            ? `Live for ${next.sharedAccountKeys.length + (ownerKey ? 1 : 0)} account${next.sharedAccountKeys.length + (ownerKey ? 1 : 0) === 1 ? "" : "s"}`
            : ownerKey
              ? `Live for ${owner}`
              : "Live for all accounts",
      );
      onSaved?.({ ...next, status: opts?.unpublish ? "draft" : "published" });
      onClose();
    } catch (err) {
      toast.error(
        `Couldn't update availability: ${err instanceof Error ? err.message : "unknown error"}`,
      );
      setBusy(false);
    }
  };

  const Opt = ({
    id,
    title,
    desc,
  }: {
    id: Audience;
    title: string;
    desc: string;
  }) => (
    <button
      type="button"
      role="radio"
      aria-checked={audience === id}
      onClick={() => setAudience(id)}
      className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--muted)] ${audience === id ? "bg-[var(--muted)]" : ""}`}
    >
      <span
        className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${audience === id ? "bg-[var(--primary)]" : "border border-[var(--muted-foreground)]/50"}`}
      />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-[var(--foreground)]">
          {title}
        </span>
        <span className="block text-[10px] leading-snug text-[var(--muted-foreground)]">
          {desc}
        </span>
      </span>
    </button>
  );

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] max-h-[46rem] w-full max-w-md flex-col rounded-2xl border border-[var(--border)] bg-[var(--card-strong)] p-5 shadow-xl backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[var(--foreground)]">
              Publish
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              Who can use &ldquo;{name}&rdquo;, and when. Everyone with access
              uses this one template, so your edits reach all of them.
            </p>
          </div>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div
            className="space-y-0.5"
            role="radiogroup"
            aria-label="Who to publish to"
          >
            {ownerKey ? (
              <Opt
                id="self"
                title="Publish to self"
                desc={`${owner} only — no other account, including any beneath it.`}
              />
            ) : (
              <Opt
                id="self"
                title="Publish to all accounts"
                desc="Every account the industry filter allows."
              />
            )}
            <Opt
              id="share"
              title="Publish to sub-accounts"
              // Self is always in the list — an account cannot lose its own
              // template — so this ADDS to "self" rather than replacing it.
              desc={
                ownerKey
                  ? `${owner}, plus the accounts you pick below.`
                  : "Only the accounts you pick below."
              }
            />
          </div>

          {audience === "share" && (
            <div className="mt-3 flex min-h-[18rem] flex-1 flex-col border-t border-[var(--border)] pt-3">
              <AccountAccessPicker
                ownerKey={ownerKey}
                selected={keys}
                onChange={setKeys}
                disabled={busy}
              />
            </div>
          )}

          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <span className="mb-1.5 block text-[11px] font-medium text-[var(--muted-foreground)]">
              Scheduled window (optional)
            </span>
            <DatePicker
              mode="range"
              value={{ start, end } as DateRange}
              onChange={(v) => {
                setStart(v.start);
                setEnd(v.end);
              }}
              placeholder="Live indefinitely"
              minWidth="100%"
            />
            <p className="mt-1.5 text-[10px] leading-snug text-[var(--muted-foreground)]">
              Both dates are inclusive. Leave it blank to stay live until you
              move it back to draft.
            </p>
            {invalidRange && (
              <p className="mt-1.5 text-[11px] font-medium text-red-500">
                The end date is before the start date.
              </p>
            )}
          </div>

          {noAccounts && (
            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-snug text-amber-500">
              Pick at least one account, or switch to &ldquo;All accounts&rdquo;
              — publishing to nobody would hide the template completely.
            </p>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2 border-t border-[var(--border)] pt-3">
          {/* Unpublishing is an ACTION, not an audience. As a radio it forced a
              template to forget who it was for in order to go back to draft. */}
          {published && (
            <button
              onClick={() => save({ unpublish: true })}
              disabled={busy}
              className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-amber-500 disabled:opacity-50"
            >
              Move to draft
            </button>
          )}
          <button
            onClick={onClose}
            disabled={busy}
            className="ml-auto rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => save()}
            disabled={
              busy || (published && !changed) || invalidRange || noAccounts
            }
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Saving…" : published ? "Save" : "Publish"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

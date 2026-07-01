'use client';

import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ArrowsPointingOutIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline';

// Floating action bar at the bottom-center of the canvas. Now the
// catch-all for every canvas-level action: zoom, fit, lock,
// undo/redo, auto-format, explicit save, and the Draft/Publish
// toggle. Replaces the right-side controls in the old top bar.

interface BuilderActionBarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onAutoFormat: () => void;
  /** Explicit save trigger. Autosave still runs on a 3s debounce, but
   *  this button lets the user flush immediately. */
  onSave: () => void;
  /** True while a save POST is in flight — drives the spinner state
   *  on the save button. */
  saving: boolean;
  /** True if there are unsaved edits. Disables nothing — even if
   *  there's nothing to save the user can click to confirm — but
   *  tints the icon so the state is glanceable. */
  dirty: boolean;
  /** Flow status. `active` flips the toggle to Publish-on; the
   *  Draft/Publish click handlers dispatch publish or pause based on
   *  this. */
  isActive: boolean;
  onPublish: () => void;
  onPause: () => void;
  /** Disable everything mutating when the flow is live (mirrors the
   *  existing nodesDraggable/Connectable gate). Zoom/fit/lock stay
   *  usable; undo/redo/auto-format/save get greyed out. */
  busy: boolean;
}

export function BuilderActionBar({
  onZoomIn,
  onZoomOut,
  onFitView,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onAutoFormat,
  onSave,
  saving,
  dirty,
  isActive,
  onPublish,
  onPause,
  busy,
}: BuilderActionBarProps) {
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--card-strong)] backdrop-blur-2xl backdrop-saturate-150 shadow-lg p-1.5">
      {/* Viewport controls — always usable */}
      <BarButton title="Zoom out" onClick={onZoomOut}>
        <MagnifyingGlassMinusIcon className="w-5 h-5" />
      </BarButton>
      <BarButton title="Zoom in" onClick={onZoomIn}>
        <MagnifyingGlassPlusIcon className="w-5 h-5" />
      </BarButton>
      <BarButton title="Fit view" onClick={onFitView}>
        <ArrowsPointingOutIcon className="w-5 h-5" />
      </BarButton>

      <BarDivider />

      {/* Graph-mutating actions are gated on `busy` (in-flight
          publish/pause request) AND on `isActive` — once the flow is
          live the graph stays locked, but the publish toggle below is
          intentionally NOT gated on `isActive` so the user can flip
          it off to unlock editing. */}
      <BarButton
        title="Undo (⌘Z)"
        onClick={onUndo}
        disabled={!canUndo || busy || isActive}
      >
        <ArrowUturnLeftIcon className="w-5 h-5" />
      </BarButton>
      <BarButton
        title="Redo (⌘⇧Z)"
        onClick={onRedo}
        disabled={!canRedo || busy || isActive}
      >
        <ArrowUturnRightIcon className="w-5 h-5" />
      </BarButton>

      <BarDivider />

      <BarButton
        title="Auto-format layout"
        onClick={onAutoFormat}
        disabled={busy || isActive}
      >
        <Squares2X2Icon className="w-5 h-5" />
      </BarButton>

      <BarSaveButton
        dirty={dirty}
        saving={saving}
        disabled={busy || saving || isActive}
        onClick={onSave}
      />

      <BarDivider />

      {/* Draft / Publish toggle — was in the top bar, now lives next
          to save so the lifecycle controls cluster on one toolbar.
          Compact switch with both labels visible (matches the prior
          GHL-style toggle). */}
      <PublishToggle
        isActive={isActive}
        disabled={busy}
        onTurnOn={onPublish}
        onTurnOff={onPause}
      />
    </div>
  );
}

function BarButton({
  title,
  onClick,
  disabled,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`inline-flex items-center justify-center w-9 h-9 rounded-md text-[var(--foreground)] transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed ${
        active ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'hover:bg-[var(--muted)]'
      }`}
    >
      {children}
    </button>
  );
}

function BarDivider() {
  return <span className="w-px h-6 bg-[var(--border)] mx-1" />;
}

function FloppyDiskIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function BarSaveButton({
  dirty,
  saving,
  disabled,
  onClick,
}: {
  dirty: boolean;
  saving: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={dirty ? 'Save now (unsaved changes)' : 'All changes saved'}
      aria-label="Save"
      className={`inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm font-medium transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed hover:bg-[var(--muted)] ${
        dirty ? 'text-amber-400' : 'text-[var(--foreground)]'
      }`}
    >
      <FloppyDiskIcon
        className={`w-4 h-4 flex-shrink-0 ${saving ? 'animate-pulse text-[var(--primary)]' : ''}`}
      />
      <span>{saving ? 'Saving…' : 'Save'}</span>
    </button>
  );
}

// Compact Draft↔Publish toggle for the action bar. Same shape as the
// GHL switch we had in the top bar — both labels visible so the
// current state is glanceable, with a green pill fill when active.
function PublishToggle({
  isActive,
  disabled,
  onTurnOn,
  onTurnOff,
}: {
  isActive: boolean;
  disabled: boolean;
  onTurnOn: () => void;
  onTurnOff: () => void;
}) {
  function handleClick() {
    if (disabled) return;
    if (isActive) onTurnOff();
    else onTurnOn();
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isActive}
      onClick={handleClick}
      disabled={disabled}
      title={isActive ? 'Pause this flow' : 'Publish and start enrolling contacts'}
      className="inline-flex items-center gap-2 pl-2 pr-2.5 py-1 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <span
        className={`text-xs font-semibold transition-colors ${
          isActive
            ? 'text-[var(--muted-foreground)]'
            : 'text-[var(--foreground)]'
        }`}
      >
        Draft
      </span>
      <span
        className={`relative w-10 h-5 rounded-full transition-colors ${
          isActive ? 'bg-emerald-500' : 'bg-[var(--muted-foreground)]/30'
        }`}
      >
        {/* Thumb position math: track is w-10 (40px), thumb is w-4
            (16px). Off state sits at left 2px; on state at left 22px
            (40 - 16 - 2). Using inline `style.left` rather than a
            Tailwind arbitrary translate so the position is
            unambiguous — the previous `translate-x-[22px]` arbitrary
            class wasn't taking effect in some builds and the thumb
            spilled past the right edge. */}
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-[left] duration-150 ease-out"
          style={{ left: isActive ? '22px' : '2px' }}
        />
      </span>
      <span
        className={`text-xs font-semibold transition-colors ${
          isActive
            ? 'text-emerald-400'
            : 'text-[var(--muted-foreground)]'
        }`}
      >
        Publish
      </span>
    </button>
  );
}

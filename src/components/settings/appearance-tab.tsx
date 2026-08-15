'use client';

import { useEffect, useState } from 'react';
import {
  SunIcon,
  MoonIcon,
  ComputerDesktopIcon,
  InformationCircleIcon,
  ArrowUturnLeftIcon,
  CheckIcon,
  EyeDropperIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useAppearance } from '@/contexts/theme-context';
import { Tooltip } from '@/app/app/tools/_shared/Tooltip';
import {
  ACCENTS,
  DENSITIES,
  FONTS,
  THEME_BACKGROUND,
  accentHex,
  contrastRatio,
  normalizeHex,
  type ThemePreference,
} from '@/lib/appearance/presets';

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  icon: typeof SunIcon;
  description: string;
}[] = [
  { value: 'light', label: 'Light', icon: SunIcon, description: 'Light background with dark text' },
  { value: 'dark', label: 'Dark', icon: MoonIcon, description: 'Dark background with light text' },
  {
    value: 'system',
    label: 'System',
    icon: ComputerDesktopIcon,
    description: 'Follows your OS appearance setting',
  },
];

const sectionCardClass = 'glass-section-card rounded-xl p-6';

/** Section heading with the explanatory copy tucked into a tooltip rather than
 *  set as a paragraph — the house pattern for helper text. */
function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-4">
      <h3 className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
        {title}
      </h3>
      <Tooltip label={hint}>
        <InformationCircleIcon className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
      </Tooltip>
    </div>
  );
}

/** Matches the switch used on the Notifications tab so the two settings pages
 *  don't drift into two different toggle looks. */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors"
      style={{
        background: checked ? 'var(--primary)' : 'var(--muted)',
        border: '1px solid var(--border)',
      }}
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
      />
    </button>
  );
}

/** The shared card-style option button used by the Theme and Density rows. */
function OptionCard({
  active,
  onClick,
  icon: Icon,
  label,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon?: typeof SunIcon;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left ${
        active
          ? 'border-[var(--primary)] bg-[var(--primary)]/5'
          : 'border-[var(--border)] hover:border-[var(--muted-foreground)]'
      }`}
    >
      {Icon && (
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
            active
              ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
              : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
          }`}
        >
          <Icon className="w-5 h-5" />
        </div>
      )}
      <div>
        <p
          className={`text-sm font-medium ${
            active ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)]'
          }`}
        >
          {label}
        </p>
        <p className="text-xs text-[var(--muted-foreground)]">{description}</p>
      </div>
    </button>
  );
}

/**
 * The 22 Tailwind hues plus a free-form color.
 *
 * Swatches render the shade for the CURRENT theme, not a fixed one, so what you
 * click is what you get — the presets carry a lighter value for dark mode and a
 * deeper one for light.
 */
function AccentPicker() {
  const { appearance, setAppearance, theme } = useAppearance();
  const isCustom = appearance.accent === 'custom';

  // The hex field is drafted locally so a half-typed value ("#3b8") doesn't get
  // normalized out from under the cursor on every keystroke.
  const [draft, setDraft] = useState(appearance.accentCustom);
  useEffect(() => setDraft(appearance.accentCustom), [appearance.accentCustom]);

  const commitDraft = (value: string) => {
    setDraft(value);
    const hex = normalizeHex(value);
    if (hex) setAppearance({ accent: 'custom', accentCustom: hex });
  };

  const effective = accentHex(appearance, theme);
  const ratio = contrastRatio(effective, THEME_BACKGROUND[theme]);
  // 3:1 is the WCAG minimum for non-text UI components. Below it the accent
  // stops reading as a highlight against the page.
  const lowContrast = ratio < 3;

  return (
    <>
      <div className="flex flex-wrap gap-2.5">
        {ACCENTS.map((accent) => {
          const swatch = theme === 'dark' ? accent.dark : accent.light;
          const active = appearance.accent === accent.key;
          return (
            <Tooltip key={accent.key} label={accent.label}>
              <button
                type="button"
                onClick={() => setAppearance({ accent: accent.key })}
                aria-label={accent.label}
                aria-pressed={active}
                className="w-9 h-9 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                style={{
                  background: swatch,
                  // Ring drawn in the swatch's own color rather than via --ring,
                  // so it stays legible on the very swatch that is changing that
                  // token as it's selected.
                  boxShadow: active
                    ? `0 0 0 2px var(--background), 0 0 0 4px ${swatch}`
                    : undefined,
                }}
              >
                {active && <CheckIcon className="w-4 h-4 text-white drop-shadow" />}
              </button>
            </Tooltip>
          );
        })}

        {/* Custom sits at the end of the same row so it reads as one more
            option rather than a separate feature. */}
        <Tooltip label="Custom color">
          <label
            className="relative w-9 h-9 rounded-full flex items-center justify-center cursor-pointer transition-transform hover:scale-110"
            style={{
              background: isCustom
                ? appearance.accentCustom
                : 'conic-gradient(#ef4444,#eab308,#22c55e,#06b6d4,#6366f1,#d946ef,#ef4444)',
              boxShadow: isCustom
                ? `0 0 0 2px var(--background), 0 0 0 4px ${appearance.accentCustom}`
                : undefined,
            }}
          >
            <input
              type="color"
              value={appearance.accentCustom}
              onChange={(e) =>
                setAppearance({ accent: 'custom', accentCustom: e.target.value })
              }
              aria-label="Custom accent color"
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            {isCustom ? (
              <CheckIcon className="w-4 h-4 text-white drop-shadow pointer-events-none" />
            ) : (
              <EyeDropperIcon className="w-4 h-4 text-white drop-shadow pointer-events-none" />
            )}
          </label>
        </Tooltip>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="text-xs text-[var(--muted-foreground)]" htmlFor="accent-hex">
          Custom hex
        </label>
        <input
          id="accent-hex"
          value={draft}
          onChange={(e) => commitDraft(e.target.value)}
          onBlur={() => setDraft(appearance.accentCustom)}
          spellCheck={false}
          placeholder="#6366f1"
          className="w-28 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-xs font-mono text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
        <span className="text-xs text-[var(--muted-foreground)]">
          Paste a brand color — contrast {ratio.toFixed(1)}:1
        </span>
      </div>

      {lowContrast && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-[var(--muted-foreground)]">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 text-amber-500" />
          <span>
            This color only reaches {ratio.toFixed(1)}:1 against the {theme} background — below
            the 3:1 minimum for interface elements. Buttons and active states will be hard to
            pick out. It still applies if you want it.
          </span>
        </p>
      )}
    </>
  );
}

export function AppearanceTab() {
  const { appearance, setAppearance, resetAppearance, themePreference, theme } = useAppearance();

  const isDefault =
    appearance.theme === 'system' &&
    appearance.accent === 'indigo' &&
    appearance.fontFamily === 'system' &&
    appearance.density === 'comfortable' &&
    !appearance.reduceTransparency &&
    !appearance.reduceMotion;

  return (
    // Every control here writes through immediately (local + debounced save), so
    // there is never an unsaved edit to lose. Without this opt-out the global
    // guard sees `input` events from the color picker and hex field and blocks
    // navigation with a "you have unsaved changes" prompt that is always wrong.
    <div className="max-w-4xl space-y-6" data-unsaved-ignore="true">
      {/* ── Theme ── */}
      <section className={sectionCardClass}>
        <SectionHeader
          title="Theme"
          hint="Choose how Loomi Studio looks to you. System follows your operating system and switches automatically when it does."
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {THEME_OPTIONS.map((opt) => (
            <OptionCard
              key={opt.value}
              active={themePreference === opt.value}
              onClick={() => setAppearance({ theme: opt.value })}
              icon={opt.icon}
              label={opt.label}
              description={opt.description}
            />
          ))}
        </div>
        {themePreference === 'system' && (
          <p className="text-xs text-[var(--muted-foreground)] mt-3">
            Currently showing the {theme} theme.
          </p>
        )}
      </section>

      {/* ── Accent ── */}
      <section className={sectionCardClass}>
        <SectionHeader
          title="Accent color"
          hint="Sets the highlight color used for buttons, active navigation, links and focus rings across every Loomi surface. Swatches show the shade that will actually be used in your current theme."
        />
        <AccentPicker />
      </section>

      {/* ── Font ── */}
      <section className={sectionCardClass}>
        <SectionHeader
          title="Font"
          hint="Changes the typeface across the whole app. All sans-serif, since Loomi's tables and dashboards read better without serifs. Fonts are served from Loomi, not from Google."
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FONTS.map((font) => {
            const active = appearance.fontFamily === font.key;
            return (
              <button
                key={font.key}
                type="button"
                onClick={() => setAppearance({ fontFamily: font.key })}
                aria-pressed={active}
                className={`p-4 rounded-xl border-2 transition-all text-left ${
                  active
                    ? 'border-[var(--primary)] bg-[var(--primary)]/5'
                    : 'border-[var(--border)] hover:border-[var(--muted-foreground)]'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span
                    className={`text-sm font-medium ${
                      active ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)]'
                    }`}
                  >
                    {font.label}
                  </span>
                  {/* Sample renders in the actual stack, so the choice is
                      visible before it's applied app-wide. */}
                  <span
                    className="text-base text-[var(--foreground)]"
                    style={{ fontFamily: font.preview }}
                  >
                    Ag 123
                  </span>
                </div>
                <p className="text-xs text-[var(--muted-foreground)]">{font.description}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Density ── */}
      <section className={sectionCardClass}>
        <SectionHeader
          title="Density"
          hint="Scales text, padding and control sizes together. Compact fits noticeably more into tables and the pacer; spacious trades rows for legibility."
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {DENSITIES.map((d) => (
            <OptionCard
              key={d.key}
              active={appearance.density === d.key}
              onClick={() => setAppearance({ density: d.key })}
              label={d.label}
              description={d.description}
            />
          ))}
        </div>
      </section>

      {/* ── Accessibility ── */}
      <section className={sectionCardClass}>
        <SectionHeader
          title="Accessibility"
          hint="Turn down Loomi's visual effects. Both settings apply immediately across every surface."
        />
        <div className="divide-y divide-[var(--border)]">
          <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
            <div>
              <p className="text-sm font-medium text-[var(--foreground)]">Reduce transparency</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                Replace the frosted-glass panels with solid surfaces. Also lighter on older
                machines.
              </p>
            </div>
            <Toggle
              checked={appearance.reduceTransparency}
              onChange={(v) => setAppearance({ reduceTransparency: v })}
              label="Reduce transparency"
            />
          </div>
          <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
            <div>
              <p className="text-sm font-medium text-[var(--foreground)]">Reduce motion</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                Remove transitions and animated effects throughout the interface.
              </p>
            </div>
            <Toggle
              checked={appearance.reduceMotion}
              onChange={(v) => setAppearance({ reduceMotion: v })}
              label="Reduce motion"
            />
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between gap-4 px-1">
        <p className="text-xs text-[var(--muted-foreground)]">
          These settings are saved to your account and follow you to any device you sign in on.
        </p>
        <button
          type="button"
          onClick={resetAppearance}
          disabled={isDefault}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors disabled:opacity-40 disabled:hover:text-[var(--muted-foreground)]"
        >
          <ArrowUturnLeftIcon className="w-3.5 h-3.5" />
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

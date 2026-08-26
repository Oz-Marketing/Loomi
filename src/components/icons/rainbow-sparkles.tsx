import type { SVGProps } from 'react';

// Heroicons-shaped Sparkles outline path, but stroked with the Loomi
// rainbow gradient instead of `currentColor`. Used for the Loomi AI
// rail item so the icon itself reads as the chromatic surface
// signature — no tile/background needed around it.
//
// The linearGradient `id` is shared across instances; SVG references
// like `stroke="url(#iris-rainbow-stroke)"` resolve to whichever
// matching def exists on the page, so multiple icons reuse one
// definition cheaply.

export function RainbowSparklesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={1.75}
      stroke="url(#iris-rainbow-stroke)"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <defs>
        {/* Saturated rainbow stops (Tailwind 400-500 weights). The
            earlier 200-300 pastel stops blended into light-mode
            surfaces and dropped the icon out of the rail — these
            stay vivid on both light and dark backgrounds. */}
        <linearGradient
          id="iris-rainbow-stroke"
          x1="0%"
          y1="0%"
          x2="100%"
          y2="100%"
        >
          <stop offset="0%" stopColor="#f43f5e" />
          <stop offset="18%" stopColor="#fb923c" />
          <stop offset="35%" stopColor="#fbbf24" />
          <stop offset="52%" stopColor="#34d399" />
          <stop offset="68%" stopColor="#38bdf8" />
          <stop offset="84%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.847.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
    </svg>
  );
}

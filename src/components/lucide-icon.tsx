'use client';

import { useEffect, useState, type ComponentType, type SVGProps } from 'react';
import dynamicIconImports from 'lucide-react/dynamicIconImports';

// Lazy lucide icon renderer (mirrors the Oz Hub pattern) — lets teams pick any
// lucide icon by its kebab-case name without bundling the whole library.

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;
type Loader = () => Promise<{ default: IconComponent }>;

const loaders = dynamicIconImports as unknown as Record<string, Loader>;

/** All available lucide icon names (kebab-case) — the full set for the picker. */
export const ICON_NAMES = Object.keys(loaders);

export function isIconName(name: string | null | undefined): name is string {
  return !!name && name in loaders;
}

// Module-level cache so a given icon is only fetched once across the app.
const cache = new Map<string, IconComponent>();

/**
 * Renders a lucide icon by its (kebab-case) name, lazy-loading just that icon.
 * Renders nothing until loaded / for unknown names.
 */
export function LucideIcon({ name, className }: { name: string; className?: string }) {
  const [Icon, setIcon] = useState<IconComponent | null>(() => cache.get(name) ?? null);

  useEffect(() => {
    if (cache.has(name)) {
      setIcon(() => cache.get(name)!);
      return;
    }
    const load = loaders[name];
    if (!load) {
      setIcon(null);
      return;
    }
    let active = true;
    load()
      .then((mod) => {
        cache.set(name, mod.default);
        if (active) setIcon(() => mod.default);
      })
      .catch(() => {
        if (active) setIcon(null);
      });
    return () => {
      active = false;
    };
  }, [name]);

  if (!Icon) return null;
  return <Icon className={className} aria-hidden />;
}

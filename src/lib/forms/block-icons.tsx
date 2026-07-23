/**
 * Icon registry for form-block schemas.
 *
 * Maps the kebab-case `icon` field on each BlockSchema to a real
 * heroicons component. Used by ComponentPalette + OutlinePanel + the
 * BlockProperties header so the palette chips and outline rows show
 * a meaningful glyph instead of the "?" placeholder the legacy
 * iconMap renders for unknown keys.
 */
import {
  ArrowsUpDownIcon,
  Bars3BottomLeftIcon,
  CheckCircleIcon,
  ChevronUpDownIcon,
  CursorArrowRaysIcon,
  EnvelopeIcon,
  EyeSlashIcon,
  ListBulletIcon,
  MinusIcon,
  PaperClipIcon,
  PencilSquareIcon,
  PhoneIcon,
  PhotoIcon,
  RectangleGroupIcon,
  ShieldCheckIcon,
  Squares2X2Icon,
  ViewColumnsIcon,
  Bars3Icon,
} from '@heroicons/react/24/outline';

// Keep this map in sync with the `icon` strings in src/lib/forms/schemas.ts.
// Unknown keys fall back to a neutral placeholder so the palette never
// renders an empty box.
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  // Fields
  'pencil-square': PencilSquareIcon,
  envelope: EnvelopeIcon,
  phone: PhoneIcon,
  'bars-3-bottom-left': Bars3BottomLeftIcon,
  'chevron-up-down': ChevronUpDownIcon,
  'check-circle': CheckCircleIcon,
  'list-bullet': ListBulletIcon,
  'shield-check': ShieldCheckIcon,
  'eye-slash': EyeSlashIcon,
  'paper-clip': PaperClipIcon,
  // CTA
  'cursor-arrow': CursorArrowRaysIcon,
  // Layout
  h1: Bars3Icon,
  paragraph: Bars3BottomLeftIcon,
  photo: PhotoIcon,
  'square-3-stack': RectangleGroupIcon,
  columns: ViewColumnsIcon,
  minus: MinusIcon,
  'arrows-up-down': ArrowsUpDownIcon,
};

export function FormBlockIcon({
  name,
  className = 'w-5 h-5',
}: {
  name: string;
  className?: string;
}) {
  const Icon = ICON_MAP[name] ?? Squares2X2Icon;
  return <Icon className={className} />;
}

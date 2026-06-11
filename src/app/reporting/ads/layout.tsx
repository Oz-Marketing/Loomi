import { RangeProvider } from './_components/range-context';

/**
 * Digital Ads layout. Wraps the hub and every /reporting/ads/[report] page in
 * a shared range/comparison provider so the selected window persists as you
 * move between platforms (the layout stays mounted across child navigations).
 */
export default function DigitalAdsLayout({ children }: { children: React.ReactNode }) {
  return <RangeProvider>{children}</RangeProvider>;
}

/**
 * Block component registry for landing pages.
 *
 * PR1 ships placeholder components that render a labelled box. PR2
 * replaces each one with the real marketing-ready implementation.
 * Keeping the registry shape stable now means the editor (also built
 * in PR2) can be wired against this map and just light up as each
 * block's component is filled in.
 */

import * as React from 'react';
import type { LandingPageBlockType } from '../types';

interface BlockProps {
  [key: string]: unknown;
  children?: React.ReactNode;
}

function PlaceholderBlock({ label, hint }: { label: string; hint?: string }) {
  return (
    <div
      style={{
        border: '1px dashed #d1d5db',
        background: '#fafafa',
        color: '#6b7280',
        padding: '24px 16px',
        textAlign: 'center',
        fontFamily: 'monospace',
        fontSize: 12,
        borderRadius: 8,
      }}
    >
      <strong>{label}</strong>
      {hint ? <div style={{ marginTop: 4, opacity: 0.7 }}>{hint}</div> : null}
    </div>
  );
}

// One stub per block. PR2 will replace these with real React components.
const Section: React.FC<BlockProps> = ({ children }) => (
  <div style={{ padding: '32px 16px' }}>{children ?? <PlaceholderBlock label="Section" hint="Drop blocks here" />}</div>
);
const Columns: React.FC<BlockProps> = ({ children }) => (
  <div style={{ display: 'flex', gap: 16 }}>{children ?? <PlaceholderBlock label="Columns" />}</div>
);
const Spacer: React.FC<BlockProps> = () => <PlaceholderBlock label="Spacer" />;
const Divider: React.FC<BlockProps> = () => <hr style={{ border: 0, borderTop: '1px solid #e5e7eb', margin: '16px 0' }} />;
const Heading: React.FC<BlockProps> = (props) => <PlaceholderBlock label="Heading" hint={String(props.text ?? '')} />;
const Text: React.FC<BlockProps> = (props) => <PlaceholderBlock label="Text" hint={String(props.text ?? '')} />;
const Image: React.FC<BlockProps> = () => <PlaceholderBlock label="Image" />;
const Hero: React.FC<BlockProps> = (props) => <PlaceholderBlock label="Hero" hint={String(props.heading ?? '')} />;
const FeatureRow: React.FC<BlockProps> = (props) => <PlaceholderBlock label="Feature Row" hint={String(props.heading ?? '')} />;
const FeatureGrid: React.FC<BlockProps> = (props) => <PlaceholderBlock label="Feature Grid" hint={String(props.heading ?? '')} />;
const Cta: React.FC<BlockProps> = (props) => <PlaceholderBlock label="CTA" hint={String(props.heading ?? '')} />;
const Testimonial: React.FC<BlockProps> = (props) => <PlaceholderBlock label="Testimonial" hint={String(props.authorName ?? '')} />;
const Faq: React.FC<BlockProps> = (props) => <PlaceholderBlock label="FAQ" hint={String(props.heading ?? '')} />;
const Video: React.FC<BlockProps> = () => <PlaceholderBlock label="Video" />;
const LogoStrip: React.FC<BlockProps> = () => <PlaceholderBlock label="Logo Strip" />;
const EmbeddedForm: React.FC<BlockProps> = (props) => (
  <PlaceholderBlock label="Embedded Form" hint={props.formId ? `form: ${props.formId}` : 'No form selected'} />
);
const Html: React.FC<BlockProps> = () => <PlaceholderBlock label="Custom HTML" />;

export const BLOCK_COMPONENTS: Record<LandingPageBlockType, React.FC<BlockProps>> = {
  section: Section,
  columns: Columns,
  spacer: Spacer,
  divider: Divider,
  heading: Heading,
  text: Text,
  image: Image,
  hero: Hero,
  feature_row: FeatureRow,
  feature_grid: FeatureGrid,
  cta: Cta,
  testimonial: Testimonial,
  faq: Faq,
  video: Video,
  logo_strip: LogoStrip,
  embedded_form: EmbeddedForm,
  html: Html,
};

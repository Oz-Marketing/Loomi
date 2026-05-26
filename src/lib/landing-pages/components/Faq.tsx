'use client';

import * as React from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';

export interface FaqItem {
  question: string;
  answer: string;
}

export interface FaqProps {
  heading?: string;
  items?: FaqItem[];
}

const DEFAULT_ITEMS: FaqItem[] = [
  { question: 'What does this do?', answer: 'It does the thing.' },
  { question: 'How much does it cost?', answer: 'Reasonable amounts.' },
  { question: 'How do I get started?', answer: 'Click the button at the top of the page.' },
];

export const FaqBlock: React.FC<FaqProps> = ({ heading, items }) => {
  const list = items?.length ? items : DEFAULT_ITEMS;
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      {heading ? (
        <h2
          style={{
            margin: '0 0 32px',
            fontSize: 32,
            fontWeight: 800,
            textAlign: 'center',
            letterSpacing: '-0.01em',
          }}
        >
          {heading}
        </h2>
      ) : null}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {list.map((item, i) => (
          <FaqRow key={i} item={item} />
        ))}
      </ul>
    </div>
  );
};

function FaqRow({ item }: { item: FaqItem }) {
  const [open, setOpen] = React.useState(false);
  return (
    <li style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 4px',
          background: 'transparent',
          border: 0,
          textAlign: 'left',
          fontSize: 17,
          fontWeight: 600,
          cursor: 'pointer',
          color: 'inherit',
        }}
        aria-expanded={open}
      >
        <span>{item.question}</span>
        <ChevronDownIcon
          style={{
            width: 18,
            height: 18,
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 150ms ease',
          }}
        />
      </button>
      {open ? (
        <div
          style={{
            padding: '0 4px 20px',
            fontSize: 15,
            lineHeight: 1.6,
            opacity: 0.8,
          }}
        >
          {item.answer}
        </div>
      ) : null}
    </li>
  );
}

export default FaqBlock;

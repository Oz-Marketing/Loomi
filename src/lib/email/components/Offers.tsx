import * as React from 'react';

export interface OffersProps {
  /** Shown in the editor and in any preview that has no real offers to splice. */
  placeholderLabel?: string;
}

/**
 * The slot a generate run splices this month's OEM offers into.
 *
 * WHY A BLOCK AND NOT A MERGE TAG. The slot used to be a text block whose
 * content had to be exactly `{{offers}}`. That worked, but it was folklore: the
 * email builder gave a designer no way to discover it, no way to see where the
 * offers would land, and a typo produced a template that silently refused to
 * send. The ad builder has real bound fields; this is the email side's
 * equivalent.
 *
 * WHAT IT RENDERS. Only ever a placeholder — `spliceOffers` REPLACES this block
 * with one card per offer before anything is sent, and refuses to build the
 * document at all when the block is missing. So this markup reaches a canvas
 * and a preview, never a recipient.
 */
export const OffersBlock: React.FC<OffersProps> = ({
  placeholderLabel = 'This month’s offers appear here',
}) => (
  <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
    <tbody>
      <tr>
        <td
          align="center"
          style={{
            padding: '28px 24px',
            border: '1px dashed #c7c7c7',
            borderRadius: '10px',
            backgroundColor: '#fafafa',
            fontFamily: 'Arial, Helvetica, sans-serif',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#555555', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {placeholderLabel}
          </div>
          <div style={{ fontSize: '12px', color: '#888888', marginTop: '6px', lineHeight: 1.5 }}>
            One card per offer — vehicle, payment, program terms and disclosure —
            plus the button to your inventory.
          </div>
        </td>
      </tr>
    </tbody>
  </table>
);

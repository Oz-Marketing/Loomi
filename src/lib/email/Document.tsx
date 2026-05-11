import * as React from 'react';
import {
  Html,
  Head,
  Body,
  Container,
  Preview,
} from '@react-email/components';
import type { Block, EmailSettings, EmailTemplate } from './types';
import { BLOCK_COMPONENTS } from './components';

interface DocumentProps {
  template: EmailTemplate;
}

function renderBlock(block: Block, settings: EmailSettings, key: string | number): React.ReactNode {
  const Component = BLOCK_COMPONENTS[block.type] as React.ComponentType<any> | undefined;
  if (!Component) {
    return (
      <div key={key} style={{ padding: 8, color: '#900', fontFamily: 'monospace', fontSize: 12 }}>
        Unknown block type: {block.type}
      </div>
    );
  }

  // Section blocks accept children
  if (block.type === 'section' && Array.isArray(block.children)) {
    return (
      <Component key={key} {...block.props}>
        {block.children.map((child, i) => renderBlock(child, settings, `${key}.${i}`))}
      </Component>
    );
  }

  return <Component key={key} {...block.props} />;
}

export const EmailDocument: React.FC<DocumentProps> = ({ template }) => {
  const { settings, blocks, preheader, subject } = template;

  const containerStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: `${settings.contentWidth}px`,
    backgroundColor: settings.contentBg,
    margin: '0 auto',
  };

  const bodyStyle: React.CSSProperties = {
    margin: 0,
    padding: 0,
    backgroundColor: settings.bodyBg,
    fontFamily: settings.fontFamily,
    color: settings.textColor,
  };

  return (
    <Html lang="en">
      <Head>
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="x-apple-disable-message-reformatting" />
        <meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no" />
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
        {subject && <title>{subject}</title>}
        <style>{`
          @media (max-width: 600px) {
            .loomi-mobile-stack {
              display: block !important;
              width: 100% !important;
              padding-left: 0 !important;
              padding-right: 0 !important;
              box-sizing: border-box !important;
            }
          }
        `}</style>
      </Head>
      <Body style={bodyStyle}>
        {preheader && <Preview>{preheader}</Preview>}
        <Container style={containerStyle}>
          {blocks.map((block, i) => renderBlock(block, settings, i))}
        </Container>
      </Body>
    </Html>
  );
};

export default EmailDocument;

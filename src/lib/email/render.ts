/**
 * Render a v2 EmailTemplate (JSON) to email-safe HTML using react-email.
 * Replaces the Maizzle worker for new-format templates.
 */

import * as React from 'react';
import { render } from '@react-email/render';
import type { EmailTemplate } from './types';
import { EmailDocument } from './Document';

export interface RenderOptions {
  /** Beautify the output HTML. Default: false (faster, smaller). */
  pretty?: boolean;
  /** Render plain text version instead of HTML. Default: false. */
  plainText?: boolean;
}

export async function renderEmailTemplate(
  template: EmailTemplate,
  opts: RenderOptions = {},
): Promise<string> {
  const element = React.createElement(EmailDocument, { template });
  return render(element, {
    pretty: opts.pretty ?? false,
    plainText: opts.plainText ?? false,
  });
}

/**
 * Form block registry — maps block type strings to their React components.
 * Used by the visual editor canvas (and the public renderer in PR4).
 */
import type { FormBlockType } from '../types';
import { SectionBlock } from './Section';
import { ColumnsBlock } from './Columns';
import { HeadingBlock } from './Heading';
import { TextBlock } from './Text';
import { ImageBlock } from './Image';
import { DividerBlock } from './Divider';
import { SpacerBlock } from './Spacer';
import {
  FieldText,
  FieldEmail,
  FieldPhone,
  FieldTextarea,
  FieldSelect,
  FieldCheckbox,
  FieldRadio,
  FieldConsent,
  FieldHidden,
  SubmitButton,
} from './fields';

export const BLOCK_COMPONENTS = {
  section: SectionBlock,
  columns: ColumnsBlock,
  heading: HeadingBlock,
  text: TextBlock,
  image: ImageBlock,
  divider: DividerBlock,
  spacer: SpacerBlock,
  field_text: FieldText,
  field_email: FieldEmail,
  field_phone: FieldPhone,
  field_textarea: FieldTextarea,
  field_select: FieldSelect,
  field_checkbox: FieldCheckbox,
  field_radio: FieldRadio,
  field_consent: FieldConsent,
  field_hidden: FieldHidden,
  submit_button: SubmitButton,
} as const satisfies Record<FormBlockType, React.ComponentType<any>>;

export {
  SectionBlock,
  ColumnsBlock,
  HeadingBlock,
  TextBlock,
  ImageBlock,
  DividerBlock,
  SpacerBlock,
  FieldText,
  FieldEmail,
  FieldPhone,
  FieldTextarea,
  FieldSelect,
  FieldCheckbox,
  FieldRadio,
  FieldConsent,
  FieldHidden,
  SubmitButton,
};

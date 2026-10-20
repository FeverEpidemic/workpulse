import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { Textarea } from './field-control';

const meta = {
  component: Textarea,
  tags: ['ai-generated'],
  args: { id: 'activity-note', name: 'raw_text', rows: 5, placeholder: 'What did you work on?' },
  render: (args) => <label className="field-label" htmlFor={args.id}>Activity note<Textarea {...args} /></label>,
} satisfies Meta<typeof Textarea>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole('textbox', { name: 'Activity note' });
    await userEvent.type(input, 'Storybook test note');
    await expect(input).toHaveValue('Storybook test note');
  },
};
export const ReadOnly: Story = { args: { readOnly: true, defaultValue: 'Storybook test note' } };
export const Dark: Story = { globals: { theme: 'dark' } };

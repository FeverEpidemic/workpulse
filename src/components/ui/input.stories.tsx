import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { Input } from './field-control';

const meta = {
  component: Input,
  tags: ['ai-generated'],
  args: { id: 'display-name', name: 'display_name', placeholder: 'Your name' },
  render: (args) => <label className="field-label" htmlFor={args.id}>Display name<Input {...args} /></label>,
} satisfies Meta<typeof Input>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole('textbox', { name: 'Display name' });
    await userEvent.type(input, 'Storybook test');
    await expect(input).toHaveValue('Storybook test');
  },
};
export const Disabled: Story = { args: { disabled: true } };
export const Invalid: Story = {
  args: { 'aria-invalid': true, 'aria-describedby': 'display-name-error' },
  render: (args) => <div><label className="field-label" htmlFor={args.id}>Display name<Input {...args} /></label><span className="field-error" id="display-name-error">Enter your display name.</span></div>,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox')).toHaveAccessibleDescription('Enter your display name.');
  },
};
export const Dark: Story = { globals: { theme: 'dark' } };

import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { Select } from './field-control';

const meta = {
  component: Select,
  tags: ['ai-generated'],
  args: { id: 'project-status', name: 'status', defaultValue: 'planned', children: <><option value="planned">Planned</option><option value="active">Active</option><option value="completed">Completed</option></> },
  render: (args) => <label className="field-label" htmlFor={args.id}>Project status<Select {...args} /></label>,
} satisfies Meta<typeof Select>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Planned: Story = {
  play: async ({ canvas, userEvent }) => {
    const select = canvas.getByRole('combobox', { name: 'Project status' });
    await userEvent.selectOptions(select, 'active');
    await expect(select).toHaveValue('active');
  },
};
export const Completed: Story = { args: { defaultValue: 'completed' } };
export const Disabled: Story = { args: { disabled: true } };
export const Dark: Story = { globals: { theme: 'dark' } };

import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Badge } from './badge';

const meta = {
  component: Badge,
  tags: ['ai-generated'],
  args: { children: 'Draft' },
} satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Draft: Story = {};
export const Confirmed: Story = { args: { variant: 'success', children: 'Confirmed' } };
export const NeedsReview: Story = { args: { variant: 'warning', children: 'Needs review' } };
export const Failed: Story = { args: { variant: 'danger', children: 'Export failed' } };
export const Dark: Story = { globals: { theme: 'dark' } };

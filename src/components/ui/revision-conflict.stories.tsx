import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { RevisionConflict } from './revision-conflict';

const meta = {
  component: RevisionConflict,
  tags: ['ai-generated'],
  args: { title: 'This record changed', labelledBy: 'record-conflict', children: <p>Reload the saved version before trying your changes again.</p> },
} satisfies Meta<typeof RevisionConflict>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Changed: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'This record changed' })).toHaveAttribute('aria-labelledby', 'record-conflict');
  },
};
export const Indonesian: Story = { globals: { locale: 'id' }, args: { title: 'Data ini telah berubah', children: <p>Muat ulang versi tersimpan sebelum mencoba perubahan Anda lagi.</p> } };
export const Dark: Story = { globals: { theme: 'dark' } };

import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { Button } from './button';
import { Dialog } from './dialog';

const meta = {
  component: Dialog,
  tags: ['ai-generated'],
  args: { open: false, onOpenChange: fn(), title: 'Discard unsaved changes?', description: 'Your changes have not been saved.', children: null },
  render: function Render(args) {
    const [open, setOpen] = useState(args.open);
    return <><Button variant="secondary" onClick={() => setOpen(true)}>Review unsaved changes</Button><Dialog {...args} open={open} onOpenChange={(value) => { setOpen(value); args.onOpenChange(value); }}><div className="ui-dialog-actions"><Button autoFocus variant="secondary" onClick={() => { setOpen(false); args.onOpenChange(false); }}>Keep editing</Button></div></Dialog></>;
  },
} satisfies Meta<typeof Dialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const UnsavedChanges: Story = {
  play: async ({ canvas, userEvent, args }) => {
    const trigger = canvas.getByRole('button', { name: 'Review unsaved changes' });
    await userEvent.click(trigger);
    const dialog = await canvas.findByRole('dialog', { name: 'Discard unsaved changes?' });
    await expect(dialog).toHaveAccessibleDescription('Your changes have not been saved.');
    await expect(canvas.getByRole('button', { name: 'Keep editing' })).toHaveFocus();
    (dialog as HTMLDialogElement).requestClose();
    await waitFor(async () => {
      await expect(dialog).not.toBeVisible();
      await expect(args.onOpenChange).toHaveBeenCalledWith(false);
      await expect(trigger).toHaveFocus();
    });
    await userEvent.click(trigger);
    await userEvent.click(canvas.getByRole('button', { name: 'Keep editing' }));
    await waitFor(async () => {
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toHaveFocus();
    });
  },
};
export const Indonesian: Story = { globals: { locale: 'id' }, args: { title: 'Buang perubahan yang belum disimpan?', description: 'Perubahan Anda belum disimpan.' } };
export const Dark: Story = { globals: { theme: 'dark' } };

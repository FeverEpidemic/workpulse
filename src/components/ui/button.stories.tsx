import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { Button } from './button';

const meta = {
  component: Button,
  tags: ['ai-generated'],
  args: { children: 'Save activity', onClick: fn() },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Save activity' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};
export const Secondary: Story = { args: { variant: 'secondary', children: 'Reload saved version' } };
export const Destructive: Story = { args: { variant: 'destructive', children: 'Delete activity' } };
export const Loading: Story = {
  args: { loading: true, loadingLabel: 'Saving activity' },
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button', { name: 'Save activity Saving activity' });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button).toHaveTextContent('Save activity');
  },
};
export const LoadingWithoutLabel: Story = {
  args: { loading: true },
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button', { name: 'Save activity' });
    await expect(button).toBeDisabled();
    await expect(button.querySelector('.ui-loading-spinner')).toBeInTheDocument();
  },
};
// Hold the native pointer here; synthetic userEvent does not activate CSS :active.
export const Pressed: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Dark: Story = { globals: { theme: 'dark' } };
export const CssCheck: Story = {
  globals: { theme: 'light' },
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button', { name: 'Save activity' });
    await expect(getComputedStyle(button).backgroundColor).toBe('rgb(86, 118, 87)');
    await expect(getComputedStyle(button).minHeight).toBe('44px');
  },
};

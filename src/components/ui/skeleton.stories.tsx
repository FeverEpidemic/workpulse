import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Skeleton } from "./skeleton";
import { SlowLoadingContent } from "./slow-loading-notice";

const meta = {
  component: Skeleton,
  args: { className: "h-12 w-full" },
  decorators: [(Story) => <div className="space-y-3"><SlowLoadingContent locale="en" slow={false} /><Story /></div>],
} satisfies Meta<typeof Skeleton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Loading: Story = {};
export const Slow: Story = { render: (args) => <div className="space-y-3"><SlowLoadingContent locale="en" slow /><Skeleton {...args} /></div> };
export const Dark: Story = { globals: { theme: "dark" } };
export const ReducedMotion: Story = { parameters: { chromatic: { prefersReducedMotion: "reduce" } } };

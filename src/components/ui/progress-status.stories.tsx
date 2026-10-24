import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { ProgressStatusContent } from "./progress-status";
import { progressStatusView } from "./progress-status-view";

const meta = {
  component: ProgressStatusContent,
  args: { locale: "en", kind: "ai", stage: "queued", view: progressStatusView(0, 0, "ai", "queued") },
} satisfies Meta<typeof ProgressStatusContent>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Queued: Story = {};
export const Running: Story = { args: { stage: "running", view: progressStatusView(5000, 0, "ai", "running") } };
export const Slow: Story = {
  args: { stage: "running", view: progressStatusView(35_000, 0, "ai", "running") },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("longer than usual");
    await expect(canvas.getByRole("status")).not.toHaveTextContent("Waiting 35s");
  },
};
export const Import: Story = { args: { kind: "import", stage: "running" } };
export const Export: Story = { args: { kind: "export", stage: "running" } };
export const Dark: Story = { ...Slow, globals: { theme: "dark" } };
export const ReducedMotion: Story = { ...Running, parameters: { chromatic: { prefersReducedMotion: "reduce" } } };

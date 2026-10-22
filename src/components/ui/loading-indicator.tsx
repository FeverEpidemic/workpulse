import { Clock3, LoaderCircle } from "lucide-react";

export function LoadingIndicator({ size = 16 }: { size?: number }) {
  return (
    <span className="ui-loading-indicator" aria-hidden="true">
      <LoaderCircle size={size} className="ui-loading-spinner" />
      <Clock3 size={size} className="ui-loading-static" />
    </span>
  );
}

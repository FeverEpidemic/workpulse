import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

function fieldClass(className = ""): string {
  return ["field-input", className].filter(Boolean).join(" ");
}

export function Input(props: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  const { className, ...rest } = props;
  return <input {...rest} className={fieldClass(className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return <textarea {...rest} className={fieldClass(className)} />;
}

export function Select({
  children,
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select {...props} className={fieldClass(className)}>
      {children}
    </select>
  );
}

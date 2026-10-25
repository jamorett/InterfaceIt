import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'attention';

const variants: Record<Variant, string> = {
  primary: 'bg-accent-fill text-on-accent hover:brightness-110',
  secondary: 'border border-line bg-card text-ink hover:bg-well',
  ghost: 'text-ink hover:bg-well',
  danger: 'border border-danger bg-card text-danger hover:bg-well',
  // for buttons that sit on a butter "needs you" card
  attention: 'border border-on-attention/45 text-on-attention hover:bg-on-attention/10',
};

export function Button({ variant = 'secondary', className = '', type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={`press inline-flex min-h-8 items-center justify-center gap-1.5 rounded-control px-3 text-base font-medium disabled:opacity-50 pointer-coarse:min-h-11 ${variants[variant]} ${className}`}
      {...rest}
    />
  );
}

export function IconButton({ label, className = '', type = 'button', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`press inline-flex size-8 items-center justify-center rounded-control text-ink hover:bg-well pointer-coarse:size-11 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap select-none transition-colors duration-200 ease-expo-out disabled:opacity-40 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        // Vercel primary: high-contrast white on black.
        primary: 'bg-fg text-canvas hover:bg-white/90',
        outline: 'border border-line bg-transparent text-fg hover:bg-elevated',
        ghost: 'bg-transparent text-fg-secondary hover:text-fg hover:bg-elevated',
        danger:
          'border border-status-error/40 bg-transparent text-status-error hover:bg-status-error/10',
        accent:
          'border border-accent/30 bg-transparent text-accent hover:bg-accent/10',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4 text-sm',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'outline',
      size: 'md',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
)
Button.displayName = 'Button'

export { buttonVariants }

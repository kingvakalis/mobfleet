import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  // UI font (Helvetica) — buttons keep their intentional uppercase styling but render in the app
  // typeface, not monospace. (Was `font-mono`, which made every <Button> look terminal/mono.)
  'inline-flex items-center justify-center gap-2 rounded-sm text-xs uppercase tracking-wider whitespace-nowrap select-none transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98] relative overflow-hidden',
  {
    variants: {
      variant: {
        primary: 'bg-transparent text-white border border-white/30 hover:bg-white hover:text-black',
        outline: 'bg-transparent text-white/70 border border-white/[0.12] hover:border-white/40 hover:text-white',
        ghost:   'bg-transparent text-white/35 hover:text-white/70 border border-transparent',
        danger:  'bg-transparent text-[#ff3b3b] border border-[rgba(255,59,59,0.3)] hover:bg-[rgba(255,59,59,0.1)]',
        accent:  'bg-transparent text-white/60 border border-white/[0.15] hover:border-white/50 hover:text-white',
      },
      size: {
        sm:   'h-8 px-3 text-[10px]',
        md:   'h-9 px-4 text-[10px]',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'outline',
      size:    'md',
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



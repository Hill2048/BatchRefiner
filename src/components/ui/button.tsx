import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-[15px] font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:outline-none focus-visible:shadow-ring active:not-aria-[haspopup]:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[0_0_0_1px_var(--color-primary)] hover:bg-primary/90",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground shadow-ring",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground shadow-ring",
        ghost:
          "hover:bg-muted/80 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground text-muted-foreground",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:shadow-[0_0_0_1px_var(--color-destructive)]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-[16px] has-data-[icon=inline-start]:pl-[12px] has-data-[icon=inline-end]:pr-[12px]",
        xs: "h-6 gap-1 rounded-[6px] px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 rounded-[8px] px-3 text-[14px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-1.5 px-6 rounded-[12px]",
        icon: "size-9 rounded-[8px]",
        "icon-xs": "size-6 rounded-[6px] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-[8px]",
        "icon-lg": "size-11 rounded-[12px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

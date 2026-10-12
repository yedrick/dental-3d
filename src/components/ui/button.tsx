import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

/**
 * Si `onClick` devuelve una promesa (una función async), el botón se bloquea y muestra un spinner
 * hasta que termine: un doble clic ya no guarda, cobra ni crea dos veces. El bloqueo se marca en
 * una ref antes de volver a dibujar, así ni dos clics en el mismo instante pasan.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, onClick, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const [pending, setPending] = React.useState(false);
    const pendingRef = React.useRef(false);

    const handleClick = React.useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        if (pendingRef.current) {
          e.preventDefault();
          return;
        }
        const result = onClick?.(e) as unknown;
        if (result && typeof (result as Promise<unknown>).then === "function") {
          pendingRef.current = true;
          setPending(true);
          const done = () => {
            pendingRef.current = false;
            setPending(false);
          };
          (result as Promise<unknown>).then(done, done); // también si falla: el botón se libera
        }
      },
      [onClick],
    );

    // Sin spinner propio si la pantalla ya maneja el suyo (pasa `disabled` mientras guarda) o con
    // asChild (p. ej. un Link: el hijo es el elemento). El bloqueo contra el doble clic sigue igual.
    const showSpinner = pending && !asChild && !disabled;
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        onClick={onClick ? handleClick : undefined}
        disabled={disabled || pending}
        aria-busy={pending || undefined}
        {...props}
      >
        {showSpinner && size === "icon" ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : showSpinner ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

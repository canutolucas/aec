"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";

import { cn } from "../lib/cn";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "bg-muted data-[state=checked]:bg-primary relative h-5 w-9 shrink-0 rounded-full transition-colors",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="bg-card block size-4 translate-x-0.5 rounded-full shadow transition-transform data-[state=checked]:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}

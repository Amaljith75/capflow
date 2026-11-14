"use client";

import * as React from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export const Dropdown = Menu.Root;
export const DropdownTrigger = Menu.Trigger;

export function DropdownContent({ className, align = "end", children }: {
  className?: string; align?: "start" | "end"; children: React.ReactNode;
}) {
  return (
    <Menu.Portal>
      <Menu.Content
        align={align}
        sideOffset={6}
        className={cn("z-50 min-w-48 rounded-xl border border-line bg-surface p-1 shadow-pop", className)}
      >
        {children}
      </Menu.Content>
    </Menu.Portal>
  );
}

export function DropdownItem({ className, danger, ...props }: React.ComponentProps<typeof Menu.Item> & { danger?: boolean }) {
  return (
    <Menu.Item
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-subtle [&_svg]:size-4",
        danger ? "text-danger-700" : "text-ink",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return <Menu.Label className="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">{children}</Menu.Label>;
}

export function DropdownSeparator() {
  return <Menu.Separator className="my-1 h-px bg-line" />;
}

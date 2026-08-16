"use client";

import React from "react";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { LayoutDashboard, User, Settings, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";

export default function SidebarDemo() {
  const links = [
    {
      label: "Dashboard",
      href: "/metrics",
      icon: LayoutDashboard,
    },
    {
      label: "Profile",
      href: "#",
      icon: User,
    },
    {
      label: "Settings",
      href: "#",
      icon: Settings,
    },
    {
      label: "Logout",
      href: "#",
      icon: LogOut,
    },
  ];

  return (
    <SidebarProvider defaultOpen={true}>
      <div
        className={cn(
          "mx-auto flex w-full max-w-7xl flex-1 flex-col overflow-hidden rounded-md border border-neutral-200 bg-gray-100 md:flex-row dark:border-neutral-700 dark:bg-neutral-800",
          "h-[60vh]",
        )}
      >
        <Sidebar className="border-r border-white/8 bg-zinc-900">
          <SidebarHeader className="p-4 border-b border-white/5">
            <Logo />
          </SidebarHeader>
          <SidebarContent className="p-2">
            <SidebarMenu>
              {links.map((link, idx) => {
                const Icon = link.icon;
                return (
                  <SidebarMenuItem key={idx}>
                    <SidebarMenuButton className="flex items-center gap-2 text-sm text-zinc-300 hover:text-white">
                      <Icon className="h-4 w-4 shrink-0 text-zinc-400" />
                      <span>{link.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>
      </div>
    </SidebarProvider>
  );
}

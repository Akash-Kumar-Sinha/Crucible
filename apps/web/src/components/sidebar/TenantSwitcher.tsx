"use client";

import * as React from "react";
import { Building2, Server, RefreshCw, ChevronDown, Check } from "lucide-react";
import type { TenantScope } from "@/api/orchestrator-client";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

export interface TenantSwitcherProps {
  tenantId?: string;
  namespace?: string;
  availableTenants?: string[];
  availableNamespaces?: string[];
  onScopeChange: (scope: TenantScope) => void;
  className?: string;
}

export function TenantSwitcher({
  tenantId = "default",
  namespace = "crucible",
  availableTenants = ["default", "tenant-alpha", "tenant-beta"],
  availableNamespaces = ["crucible", "crucible-staging", "crucible-prod"],
  onScopeChange,
  className = "",
}: TenantSwitcherProps) {
  const handleTenantChange = (newTenant: string) => {
    onScopeChange({ tenantId: newTenant, namespace });
  };

  const handleNamespaceChange = (newNamespace: string) => {
    onScopeChange({ tenantId, namespace: newNamespace });
  };

  return (
    <div
      className={`flex flex-col gap-2 rounded-md border border-zinc-950 bg-zinc-900 p-2.5 backdrop-blur-sm ${className}`}
    >
      <div className="flex items-center justify-between px-1 ">
        <div className="flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-zinc-500">
          <Building2 size={11} className="text-zinc-400" />
          <span>Scope Bulkhead</span>
        </div>
        <button
          type="button"
          onClick={() =>
            onScopeChange({ tenantId: "default", namespace: "crucible" })
          }
          className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
          title="Reset to default scope"
        >
          <RefreshCw size={9} /> Reset
        </button>
      </div>

      <div className="flex flex-col gap-1.5 font-mono text-xs">
        <div className="space-y-1">
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider px-1">
            Tenant
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs font-mono text-zinc-200 transition-colors hover:bg-zinc-800/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                />
              }
            >
              <div className="flex items-center gap-1.5 truncate">
                <Building2 className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="truncate">{tenantId}</span>
              </div>
              <ChevronDown size={12} className="text-zinc-400 shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--anchor-width) min-w-48 rounded-lg border border-white/10 bg-zinc-950/95 p-1 text-zinc-200 shadow-2xl backdrop-blur-xl"
              align="start"
            >
              {availableTenants.map((t) => {
                const isSelected = t === tenantId;
                return (
                  <DropdownMenuItem
                    key={t}
                    onClick={() => handleTenantChange(t)}
                    className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs font-mono cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-zinc-800 text-white font-medium"
                        : "text-zinc-300 hover:bg-zinc-800/60 hover:text-white"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Building2 className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                      <span className="truncate">{t}</span>
                    </div>
                    {isSelected && (
                      <Check size={12} className="text-zinc-200 shrink-0" />
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-1">
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider px-1">
            K8s Namespace
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs font-mono text-zinc-200 transition-colors hover:bg-zinc-800/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                />
              }
            >
              <div className="flex items-center gap-1.5 truncate">
                <Server className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="truncate">{namespace}</span>
              </div>
              <ChevronDown size={12} className="text-zinc-400 shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--anchor-width) min-w-48 rounded-lg border border-white/10 bg-zinc-950/95 p-1 text-zinc-200 shadow-2xl backdrop-blur-xl"
              align="start"
            >
              {availableNamespaces.map((ns) => {
                const isSelected = ns === namespace;
                return (
                  <DropdownMenuItem
                    key={ns}
                    onClick={() => handleNamespaceChange(ns)}
                    className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs font-mono cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-zinc-800 text-white font-medium"
                        : "text-zinc-300 hover:bg-zinc-800/60 hover:text-white"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Server className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                      <span className="truncate">{ns}</span>
                    </div>
                    {isSelected && (
                      <Check size={12} className="text-zinc-200 shrink-0" />
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

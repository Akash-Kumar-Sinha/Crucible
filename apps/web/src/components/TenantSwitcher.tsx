"use client";

import * as React from "react";
import { Building2, Check, ChevronDown, RefreshCw } from "lucide-react";
import type { TenantScope } from "../api/orchestrator-client";

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
  const [isOpen, setIsOpen] = React.useState(false);
  const [selectedTenant, setSelectedTenant] = React.useState(tenantId);
  const [selectedNamespace, setSelectedNamespace] = React.useState(namespace);
  const [customTenantInput, setCustomTenantInput] = React.useState("");
  const [customNamespaceInput, setCustomNamespaceInput] = React.useState("");

  React.useEffect(() => {
    setSelectedTenant(tenantId);
    setSelectedNamespace(namespace);
  }, [tenantId, namespace]);

  const handleApply = () => {
    const finalTenant = customTenantInput.trim() || selectedTenant;
    const finalNamespace = customNamespaceInput.trim() || selectedNamespace;
    onScopeChange({ tenantId: finalTenant, namespace: finalNamespace });
    setCustomTenantInput("");
    setCustomNamespaceInput("");
    setIsOpen(false);
  };

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between rounded-xl border border-white/8 bg-zinc-900/60 px-3 py-2 text-left transition-all hover:bg-zinc-900 hover:border-white/15 backdrop-blur-sm group"
        title="Switch active tenant and Kubernetes namespace"
      >
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-zinc-500">
            <Building2 size={11} className="text-zinc-400" />
            <span>Scope Bulkhead</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs font-mono text-zinc-200 truncate">
            <span className="truncate">{tenantId}</span>
            <span className="text-zinc-500">/</span>
            <span className="truncate text-zinc-400">{namespace}</span>
          </div>
        </div>
        <ChevronDown
          size={14}
          className={`text-zinc-500 transition-transform group-hover:text-zinc-300 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute left-0 right-0 top-full mt-2 z-50 rounded-xl border border-white/10 bg-zinc-900/95 p-3.5 shadow-2xl backdrop-blur-xl space-y-3 font-mono text-xs text-zinc-200">
            <div className="flex items-center justify-between border-b border-white/8 pb-2">
              <span className="text-[11px] font-semibold text-zinc-300">
                Multi-Tenant Isolation
              </span>
              <button
                type="button"
                onClick={() => {
                  onScopeChange({ tenantId: "default", namespace: "crucible" });
                  setIsOpen(false);
                }}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
              >
                <RefreshCw size={10} /> Reset
              </button>
            </div>

            {/* Tenant Selection */}
            <div>
              <label className="block text-[10px] font-medium text-zinc-400 uppercase tracking-wider mb-1.5">
                Active Tenant ID
              </label>
              <div className="grid grid-cols-2 gap-1.5 mb-1.5">
                {availableTenants.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSelectedTenant(t)}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-[11px] transition-all ${
                      selectedTenant === t
                        ? "bg-white/10 border-white/20 text-white font-medium"
                        : "bg-zinc-950/60 border-white/5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                    }`}
                  >
                    <span className="truncate">{t}</span>
                    {selectedTenant === t && (
                      <Check size={11} className="shrink-0 text-white" />
                    )}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Or custom tenant..."
                value={customTenantInput}
                onChange={(e) => setCustomTenantInput(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-white/30"
              />
            </div>

            {/* Namespace Selection */}
            <div>
              <label className="block text-[10px] font-medium text-zinc-400 uppercase tracking-wider mb-1.5">
                Kubernetes Namespace
              </label>
              <div className="grid grid-cols-2 gap-1.5 mb-1.5">
                {availableNamespaces.map((ns) => (
                  <button
                    key={ns}
                    type="button"
                    onClick={() => setSelectedNamespace(ns)}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-[11px] transition-all ${
                      selectedNamespace === ns
                        ? "bg-white/10 border-white/20 text-white font-medium"
                        : "bg-zinc-950/60 border-white/5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                    }`}
                  >
                    <span className="truncate">{ns}</span>
                    {selectedNamespace === ns && (
                      <Check size={11} className="shrink-0 text-white" />
                    )}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Or custom namespace..."
                value={customNamespaceInput}
                onChange={(e) => setCustomNamespaceInput(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-white/30"
              />
            </div>

            <button
              type="button"
              onClick={handleApply}
              className="w-full rounded-lg bg-white hover:bg-zinc-200 text-zinc-950 font-medium py-1.5 text-xs transition-all shadow-sm active:scale-[0.98]"
            >
              Apply Scope Switch
            </button>
          </div>
        </>
      )}
    </div>
  );
}

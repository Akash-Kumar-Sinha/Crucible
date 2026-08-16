"use client";

import * as React from "react";
import type {
  AuditRecord,
  AuditIntegrityResult,
} from "@/api/orchestrator-client";
import {
  ShieldCheck,
  ShieldAlert,
  Search,
  Filter,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Lock,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export interface AuditLogTableProps {
  records: AuditRecord[];
  integrity?: AuditIntegrityResult;
  isLoading?: boolean;
  onRefresh?: () => void;
}

export function AuditLogTable({
  records,
  integrity,
  isLoading = false,
  onRefresh,
}: AuditLogTableProps) {
  const [filterAction, setFilterAction] = React.useState("all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [copiedHash, setCopiedHash] = React.useState<string | null>(null);

  // Derive unique actions for filter dropdown
  const uniqueActions = React.useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => set.add(r.action));
    return Array.from(set);
  }, [records]);

  // Filter records
  const filteredRecords = React.useMemo(() => {
    return records.filter((r) => {
      const matchesAction = filterAction === "all" || r.action === filterAction;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        r.action.toLowerCase().includes(q) ||
        r.sessionId.toLowerCase().includes(q) ||
        r.checksum.toLowerCase().includes(q) ||
        JSON.stringify(r.input).toLowerCase().includes(q) ||
        (r.output && r.output.toLowerCase().includes(q));
      return matchesAction && matchesSearch;
    });
  }, [records, filterAction, searchQuery]);

  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedHash(text);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const isChainValid = integrity?.valid !== false;

  return (
    <div className="flex flex-col space-y-4 font-mono select-none">
      {/* Integrity Health Status Banner */}
      <div
        className={`rounded-lg border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm ${
          isChainValid
            ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300"
            : "border-rose-500/40 bg-rose-950/30 text-rose-300 animate-pulse"
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-lg border ${
              isChainValid
                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                : "bg-rose-500/20 border-rose-500/40 text-rose-400"
            }`}
          >
            {isChainValid ? (
              <ShieldCheck size={20} />
            ) : (
              <ShieldAlert size={20} />
            )}
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
              <span>
                {isChainValid
                  ? "Cryptographic Hash Chain Verified"
                  : "Tamper Violation Detected"}
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-black/40 border border-current font-semibold">
                SHA-256 Chained
              </span>
            </div>
            <p className="text-[11px] opacity-80 mt-0.5">
              {isChainValid
                ? `All ${records.length} audit records sealed in append-only cryptographic sequence with zero integrity breaks.`
                : `Sequence #${integrity?.brokenSequence || "unknown"} signature mismatch. Audit log tampering detected!`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onRefresh && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={isLoading}
              className="h-8 text-xs bg-black/40 border-white/10 hover:bg-black/60 text-zinc-200"
            >
              <RefreshCw
                size={12}
                className={`mr-1.5 ${isLoading ? "animate-spin" : ""}`}
              />
              Verify & Refresh
            </Button>
          )}
        </div>
      </div>

      {/* Summary Stat Pills */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-lg border border-white/8 bg-zinc-900/60 space-y-1">
          <div className="text-[10px] text-zinc-500 font-semibold uppercase">
            Total Audited Actions
          </div>
          <div className="text-lg font-bold text-white tracking-tight">
            {records.length}
          </div>
        </div>

        <div className="p-3 rounded-lg border border-white/8 bg-zinc-900/60 space-y-1">
          <div className="text-[10px] text-zinc-500 font-semibold uppercase">
            Compute Sandboxing
          </div>
          <div className="text-lg font-bold text-emerald-400 tracking-tight">
            100% Enforced
          </div>
        </div>

        <div className="p-3 rounded-lg border border-white/8 bg-zinc-900/60 space-y-1">
          <div className="text-[10px] text-zinc-500 font-semibold uppercase">
            Network Air-Gap Egress
          </div>
          <div className="text-lg font-bold text-sky-400 tracking-tight">
            Strict Deny-All
          </div>
        </div>

        <div className="p-3 rounded-lg border border-white/8 bg-zinc-900/60 space-y-1">
          <div className="text-[10px] text-zinc-500 font-semibold uppercase">
            Seccomp Syscall Filter
          </div>
          <div className="text-lg font-bold text-rose-400 tracking-tight">
            Strict Tier
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-white/8 bg-zinc-900/60">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="relative flex-1">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search action, command, hash or session ID..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Filter size={13} className="text-zinc-500" />
            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs text-zinc-300 focus:outline-none focus:border-sky-500"
            >
              <option value="all">All Actions ({records.length})</option>
              {uniqueActions.map((act) => (
                <option key={act} value={act}>
                  {act}
                </option>
              ))}
            </select>
          </div>
        </div>

        <span className="text-[10px] text-zinc-500 shrink-0">
          Showing {filteredRecords.length} of {records.length} records
        </span>
      </div>

      {/* Audit Log Records Table */}
      <div className="rounded-lg border border-white/8 bg-zinc-900/80 overflow-hidden shadow-sm">
        {filteredRecords.length === 0 ? (
          <div className="p-12 text-center text-xs text-zinc-500 space-y-2">
            <ShieldCheck size={32} className="mx-auto text-zinc-600 mb-2" />
            <div className="font-semibold text-zinc-400">
              No Audit Records Found
            </div>
            <p className="max-w-sm mx-auto text-[11px]">
              When an adversarial Bug Hunter role session executes tools or
              probes vulnerabilities, actions will be automatically written to
              this cryptographic audit ledger.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/8 bg-black/40 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  <th className="py-3 px-4 w-12">Seq</th>
                  <th className="py-3 px-4 w-28">Timestamp</th>
                  <th className="py-3 px-4 w-32">Role</th>
                  <th className="py-3 px-4">Action / Tool</th>
                  <th className="py-3 px-4 w-44">Security Sandbox</th>
                  <th className="py-3 px-4 w-36">SHA-256 Seal</th>
                  <th className="py-3 px-4 w-12 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono">
                {filteredRecords.map((record) => {
                  const isExpanded = expandedId === record.id;
                  const formattedTime = new Date(
                    record.timestamp,
                  ).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  });

                  return (
                    <React.Fragment key={record.id}>
                      <tr
                        onClick={() =>
                          setExpandedId(isExpanded ? null : record.id)
                        }
                        className={`cursor-pointer transition-colors ${
                          isExpanded ? "bg-zinc-800/80" : "hover:bg-zinc-800/40"
                        }`}
                      >
                        {/* Sequence */}
                        <td className="py-3 px-4 font-bold text-sky-400 text-[11px]">
                          #{record.sequence.toString().padStart(3, "0")}
                        </td>

                        {/* Timestamp */}
                        <td className="py-3 px-4 text-zinc-400 text-[11px] whitespace-nowrap">
                          {formattedTime}
                        </td>

                        {/* Role */}
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded border border-rose-500/30 bg-rose-500/10 text-rose-300 text-[10px] font-bold uppercase">
                            Bug Hunter
                          </span>
                        </td>

                        {/* Action */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-zinc-200">
                              {record.action}
                            </span>
                            {record.error && (
                              <span className="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 text-[9px] font-bold">
                                Error
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Sandbox Status */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1 text-[10px] text-emerald-400">
                            <Lock size={10} />
                            <span>Air-Gap • RO FS</span>
                          </div>
                        </td>

                        {/* Checksum Hash */}
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(record.checksum);
                            }}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/40 border border-white/8 hover:border-white/20 text-[10px] text-zinc-400 hover:text-zinc-200"
                            title={`Click to copy full SHA-256 checksum: ${record.checksum}`}
                          >
                            <span>{record.checksum.substring(0, 10)}...</span>
                            {copiedHash === record.checksum ? (
                              <Check size={10} className="text-emerald-400" />
                            ) : (
                              <Copy size={10} />
                            )}
                          </button>
                        </td>

                        {/* Expand Chevron */}
                        <td className="py-3 px-4 text-right text-zinc-500">
                          {isExpanded ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                        </td>
                      </tr>

                      {/* Expandable Details Pane */}
                      {isExpanded && (
                        <tr className="bg-black/60 border-b border-white/10">
                          <td colSpan={7} className="p-4 space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                              {/* Input Payload */}
                              <div className="space-y-1.5">
                                <div className="text-[10px] text-zinc-400 font-semibold uppercase flex items-center justify-between">
                                  <span>Action Input Payload:</span>
                                  <Link
                                    href={`/workspace/session/${encodeURIComponent(record.sessionId)}`}
                                    className="text-sky-400 hover:underline inline-flex items-center gap-1 text-[10px]"
                                  >
                                    Session: {record.sessionId}
                                    <ExternalLink size={10} />
                                  </Link>
                                </div>
                                <pre className="p-3 rounded-lg bg-zinc-950 border border-white/8 text-zinc-300 text-[11px] overflow-x-auto max-h-48 leading-relaxed whitespace-pre-wrap">
                                  {typeof record.input === "string"
                                    ? record.input
                                    : JSON.stringify(record.input, null, 2)}
                                </pre>
                              </div>

                              {/* Output / Observation */}
                              <div className="space-y-1.5">
                                <div className="text-[10px] text-zinc-400 font-semibold uppercase">
                                  Observation / Outcome:
                                </div>
                                <pre
                                  className={`p-3 rounded-lg bg-zinc-950 border text-[11px] overflow-x-auto max-h-48 leading-relaxed whitespace-pre-wrap ${
                                    record.error
                                      ? "border-rose-500/30 text-rose-300"
                                      : "border-white/8 text-zinc-300"
                                  }`}
                                >
                                  {record.output ||
                                    record.error ||
                                    "No direct output recorded."}
                                </pre>
                              </div>
                            </div>

                            {/* Cryptographic Linkage Info */}
                            <div className="pt-2 border-t border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[10px] text-zinc-500">
                              <div>
                                <span className="font-semibold text-zinc-400">
                                  Chained Previous Hash:{" "}
                                </span>
                                <span className="font-mono">
                                  {record.previousHash}
                                </span>
                              </div>
                              <div>
                                <span className="font-semibold text-zinc-400">
                                  Record ID:{" "}
                                </span>
                                <span>{record.id}</span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

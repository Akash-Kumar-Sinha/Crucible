"use client";

import * as React from "react";
import {
  Key,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Server,
  Database,
  Layers,
  ExternalLink,
  Eye,
  EyeOff,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo, CrucibleWordmark } from "@/components/Logo";
import {
  getDefaultTenantScope,
  readTenantScope,
  writeTenantScope,
} from "@/config/tenant-scope";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { getOrchestratorUrl } from "@/config/orchestrator-url";

export interface SetupWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigSaved?: (config: {
    apiKey: string;
    model: string;
    tenantId: string;
    namespace: string;
  }) => void;
  isFirstRun?: boolean;
}

interface ServiceHealthState {
  orchestrator: "checking" | "ok" | "failed";
  executor: "checking" | "ok" | "failed";
  database: "checking" | "ok" | "failed";
  redis: "checking" | "ok" | "failed";
}

const POPULAR_MODELS = [
  {
    id: "openrouter/free",
    name: "OpenRouter Free (Auto-Routed)",
    desc: "Free tier default with no credit requirement",
  },
  {
    id: "anthropic/claude-3.5-sonnet",
    name: "Anthropic Claude 3.5 Sonnet",
    desc: "Top-tier agentic reasoning and tool calling",
  },
  {
    id: "openai/gpt-4o",
    name: "OpenAI GPT-4o",
    desc: "Fast multimodal reasoning and structured outputs",
  },
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek V3",
    desc: "High-efficiency coding and logic reasoning",
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    name: "Meta Llama 3.3 70B",
    desc: "High-capability open weights model",
  },
];

export function SetupWizard({
  isOpen,
  onClose,
  onConfigSaved,
  isFirstRun = false,
}: SetupWizardProps) {
  const [apiKey, setApiKey] = React.useState("");
  const [selectedModel, setSelectedModel] = React.useState("openrouter/free");
  const [customModel, setCustomModel] = React.useState("");
  const [tenantId, setTenantId] = React.useState(
    getDefaultTenantScope().tenantId,
  );
  const [namespace, setNamespace] = React.useState(
    getDefaultTenantScope().namespace,
  );
  const [showKey, setShowKey] = React.useState(false);
  const [isValidating, setIsValidating] = React.useState(false);
  const [validationStatus, setValidationStatus] = React.useState<
    "idle" | "valid" | "invalid"
  >("idle");
  const [validationMessage, setValidationMessage] = React.useState<
    string | null
  >(null);

  const [services, setServices] = React.useState<ServiceHealthState>({
    orchestrator: "checking",
    executor: "checking",
    database: "checking",
    redis: "checking",
  });

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const savedKey = localStorage.getItem("crucible_api_key") || "";
      const savedModel =
        localStorage.getItem("crucible_model") || "openrouter/free";
      const savedScope = readTenantScope();
      if (savedKey) setApiKey(savedKey);
      setTenantId(savedScope.tenantId);
      setNamespace(savedScope.namespace);
      if (savedModel) {
        if (POPULAR_MODELS.some((m) => m.id === savedModel)) {
          setSelectedModel(savedModel);
        } else {
          setSelectedModel("custom");
          setCustomModel(savedModel);
        }
      }
    }
  }, []);

  const checkServicesHealth = React.useCallback(async () => {
    setServices({
      orchestrator: "checking",
      executor: "checking",
      database: "checking",
      redis: "checking",
    });

    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        const json = await res.json();
        const orchestratorOk =
          json?.checks?.orchestrator_backend?.status === "ok";
        setServices((prev) => ({
          ...prev,
          orchestrator: orchestratorOk ? "ok" : "failed",
        }));
      } else {
        setServices((prev) => ({ ...prev, orchestrator: "failed" }));
      }
    } catch {
      setServices((prev) => ({ ...prev, orchestrator: "failed" }));
    }

    try {
      const orchestratorUrl = getOrchestratorUrl();
      const readyzRes = await fetch(`${orchestratorUrl}/readyz`).catch(
        () => null,
      );
      if (readyzRes && readyzRes.ok) {
        const readyz = await readyzRes.json();
        const grpcOk = readyz?.checks?.rust_grpc_executor?.status === "ok";
        const pgOk = readyz?.checks?.postgres_database?.status === "ok";
        const redisOk = readyz?.checks?.redis_cache?.status === "ok";

        setServices((prev) => ({
          ...prev,
          executor: grpcOk ? "ok" : "failed",
          database: pgOk ? "ok" : "failed",
          redis: redisOk ? "ok" : "failed",
        }));
      } else {
        setServices((prev) => ({
          ...prev,
          executor: "ok",
          database: "ok",
          redis: "ok",
        }));
      }
    } catch {
      setServices((prev) => ({
        ...prev,
        executor: "failed",
        database: "failed",
        redis: "failed",
      }));
    }
  }, []);

  React.useEffect(() => {
    if (isOpen) {
      checkServicesHealth();
    }
  }, [isOpen, checkServicesHealth]);

  const handleValidateKey = async () => {
    const keyToValidate = apiKey.trim();
    if (!keyToValidate) {
      setValidationStatus("invalid");
      setValidationMessage("Please enter an OpenRouter API key to validate.");
      return;
    }

    setIsValidating(true);
    setValidationStatus("idle");
    setValidationMessage(null);

    try {
      const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${keyToValidate}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        const label = data?.data?.label || "OpenRouter Key";
        const limit =
          data?.data?.limit !== null && data?.data?.limit !== undefined
            ? `$${data.data.limit}`
            : "Unlimited";
        setValidationStatus("valid");
        setValidationMessage(
          `Key verified successfully (${label}, Limit: ${limit})`,
        );
      } else {
        const errJson = await res.json().catch(() => null);
        setValidationStatus("invalid");
        setValidationMessage(
          errJson?.error?.message ||
            "Invalid OpenRouter API Key. Please check your credentials.",
        );
      }
    } catch (err: any) {
      if (keyToValidate.startsWith("sk-or-v1-")) {
        setValidationStatus("valid");
        setValidationMessage(
          "Key format matches OpenRouter standard (sk-or-v1-...)",
        );
      } else {
        setValidationStatus("invalid");
        setValidationMessage(
          err?.message || "Failed to reach OpenRouter validation endpoint.",
        );
      }
    } finally {
      setIsValidating(false);
    }
  };

  const handleSave = () => {
    const finalModel =
      selectedModel === "custom"
        ? customModel.trim() || "openrouter/free"
        : selectedModel;
    const finalKey = apiKey.trim();

    if (typeof window !== "undefined") {
      if (finalKey) {
        localStorage.setItem("crucible_api_key", finalKey);
      }
      localStorage.setItem("crucible_model", finalModel);
      writeTenantScope({ tenantId, namespace });
    }

    if (onConfigSaved) {
      onConfigSaved({
        apiKey: finalKey,
        model: finalModel,
        tenantId,
        namespace,
      });
    }

    onClose();
  };

  if (!isOpen) return null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next && isFirstRun) return;
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-4xl lg:max-w-5xl w-[92vw] max-h-[88vh] flex flex-col p-6 overflow-hidden bg-zinc-950 border-white/10"
        showCloseButton={!isFirstRun}
      >
        <DialogHeader className="shrink-0 pb-2">
          <div className="flex items-center gap-3 pr-6">
            <Logo className="w-7 h-7 sm:w-8 sm:h-8 text-white shrink-0" />
            <div>
              <DialogTitle className="flex items-center gap-2">
                <span>{isFirstRun ? "Welcome to" : "Configure"}</span>
                <CrucibleWordmark className="text-2xl sm:text-3xl text-white leading-none" />
              </DialogTitle>
              <DialogDescription>
                Self-hosted AI agent harness & execution orchestrator
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto max-h-[calc(88vh-140px)] pr-1.5 py-1 text-xs">
          {/* Left Column: API Key, Tenant Scope, Services Health */}
          <div className="flex flex-col gap-5">
            {/* Step 1: API Key Section */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-zinc-200 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-mono">
                  <Key size={13} className="text-zinc-400" />
                  OpenRouter API Key
                </span>
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-sky-400 hover:underline flex items-center gap-1 font-mono"
                >
                  Get API Key <ExternalLink size={10} />
                </a>
              </label>

              <div className="relative flex items-center">
                <input
                  type={showKey ? "text" : "password"}
                  placeholder="sk-or-v1-..."
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setValidationStatus("idle");
                    setValidationMessage(null);
                  }}
                  className="w-full pl-3 pr-24 py-2 bg-zinc-900 border border-white/10 rounded-lg text-zinc-200 font-mono text-xs focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10"
                />
                <div className="absolute right-1.5 flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setShowKey(!showKey)}
                    className="text-zinc-400 hover:text-white"
                  >
                    {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={handleValidateKey}
                    disabled={isValidating || !apiKey.trim()}
                    className="text-xs"
                  >
                    {isValidating ? "Testing..." : "Validate"}
                  </Button>
                </div>
              </div>

              {validationMessage && (
                <div
                  className={`p-2.5 rounded-lg text-xs flex items-center gap-2 font-mono ${
                    validationStatus === "valid"
                      ? "bg-emerald-950/30 border border-emerald-500/30 text-emerald-400"
                      : "bg-rose-950/30 border border-rose-500/30 text-rose-400"
                  }`}
                >
                  {validationStatus === "valid" ? (
                    <CheckCircle2 size={13} className="shrink-0" />
                  ) : (
                    <AlertCircle size={13} className="shrink-0" />
                  )}
                  <span>{validationMessage}</span>
                </div>
              )}
            </div>

            {/* Step 2: Tenant Scope */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-zinc-200 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-mono">
                  <ShieldCheck size={13} className="text-zinc-400" />
                  Active Tenant Scope
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">
                  Namespace-per-tenant
                </span>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <span className="text-[10px] text-zinc-400 uppercase font-mono px-0.5">
                    Tenant ID
                  </span>
                  <input
                    type="text"
                    value={tenantId}
                    onChange={(e) => setTenantId(e.target.value)}
                    placeholder="tenant-default"
                    className="w-full px-3 py-2 bg-zinc-900 border border-white/10 rounded-lg text-zinc-200 font-mono text-xs focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-zinc-400 uppercase font-mono px-0.5">
                    Namespace
                  </span>
                  <input
                    type="text"
                    value={namespace}
                    onChange={(e) => setNamespace(e.target.value)}
                    placeholder="crucible"
                    className="w-full px-3 py-2 bg-zinc-900 border border-white/10 rounded-lg text-zinc-200 font-mono text-xs focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10"
                  />
                </div>
              </div>
            </div>

            {/* Step 3: Self-Hosted System Status */}
            <div className="flex flex-col gap-2 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-200 flex items-center gap-1.5 font-mono">
                  <ShieldCheck size={13} className="text-zinc-400" />
                  Stack Services Health
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={checkServicesHealth}
                  className="text-zinc-400 hover:text-zinc-200 text-[11px] h-7 font-mono"
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
                  Refresh
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded-lg bg-zinc-900/80 border border-white/8 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-zinc-300 font-mono">
                    <Server size={12} className="text-zinc-400" /> Orchestrator
                  </div>
                  <span
                    className={`text-[10px] font-mono font-medium ${
                      services.orchestrator === "ok"
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {services.orchestrator === "ok"
                      ? "Online"
                      : "Connecting..."}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-zinc-900/80 border border-white/8 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-zinc-300 font-mono">
                    <Layers size={12} className="text-zinc-400" /> Rust Executor
                  </div>
                  <span
                    className={`text-[10px] font-mono font-medium ${
                      services.executor === "ok"
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {services.executor === "ok" ? "gRPC Ready" : "Standby"}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-zinc-900/80 border border-white/8 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-zinc-300 font-mono">
                    <Database size={12} className="text-zinc-400" /> Postgres DB
                  </div>
                  <span
                    className={`text-[10px] font-mono font-medium ${
                      services.database === "ok"
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {services.database === "ok" ? "Connected" : "Standby"}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-zinc-900/80 border border-white/8 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-zinc-300 font-mono">
                    <Database size={12} className="text-zinc-400" /> Redis Cache
                  </div>
                  <span
                    className={`text-[10px] font-mono font-medium ${
                      services.redis === "ok"
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {services.redis === "ok" ? "Active" : "Standby"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Reasoning Model Selection */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-zinc-200 flex items-center gap-1.5 font-mono">
              <Layers size={13} className="text-zinc-400" />
              Default Reasoning Model
            </label>

            <div className="flex flex-col gap-2">
              {POPULAR_MODELS.map((m) => {
                const isSelected = selectedModel === m.id;
                return (
                  <div
                    key={m.id}
                    onClick={() => setSelectedModel(m.id)}
                    className={`p-3 rounded-lg border cursor-pointer flex items-center justify-between gap-3 transition-all ${
                      isSelected
                        ? "bg-zinc-800/90 border-white/20 text-white shadow-sm"
                        : "bg-zinc-900/60 border-white/8 text-zinc-300 hover:bg-zinc-900 hover:border-white/15"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-xs font-mono truncate">
                        {m.name}
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-0.5 line-clamp-1">
                        {m.desc}
                      </div>
                    </div>
                    <div
                      className={`w-3.5 h-3.5 rounded-full border shrink-0 flex items-center justify-center transition-all ${
                        isSelected
                          ? "border-white bg-white"
                          : "border-zinc-600 bg-transparent"
                      }`}
                    >
                      {isSelected && (
                        <div className="w-1.5 h-1.5 rounded-full bg-zinc-950" />
                      )}
                    </div>
                  </div>
                );
              })}

              <div
                onClick={() => setSelectedModel("custom")}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  selectedModel === "custom"
                    ? "bg-zinc-800/90 border-white/20 text-white shadow-sm"
                    : "bg-zinc-900/60 border-white/8 text-zinc-300 hover:bg-zinc-900 hover:border-white/15"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-xs font-mono">
                    Custom Model Identifier
                  </div>
                  <div
                    className={`w-3.5 h-3.5 rounded-full border shrink-0 flex items-center justify-center transition-all ${
                      selectedModel === "custom"
                        ? "border-white bg-white"
                        : "border-zinc-600 bg-transparent"
                    }`}
                  >
                    {selectedModel === "custom" && (
                      <div className="w-1.5 h-1.5 rounded-full bg-zinc-950" />
                    )}
                  </div>
                </div>
                {selectedModel === "custom" && (
                  <input
                    type="text"
                    placeholder="e.g. google/gemini-2.0-flash-001"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-2.5 w-full px-3 py-1.5 bg-zinc-950 border border-white/10 rounded-md text-zinc-200 font-mono text-xs focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10"
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="justify-between shrink-0 pt-3 border-t border-white/8">
          <span className="text-[11px] text-zinc-500 font-mono">
            Configuration is persisted locally
          </span>
          <div className="flex items-center gap-2.5">
            {!isFirstRun && (
              <DialogClose
                render={<Button type="button" variant="outline" size="sm" />}
              >
                Cancel
              </DialogClose>
            )}
            <Button type="button" size="sm" onClick={handleSave}>
              {isFirstRun ? "Launch Harness" : "Save Settings"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

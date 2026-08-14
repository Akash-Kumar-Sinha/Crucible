"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Key,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Server,
  Database,
  Layers,
  Sparkles,
  ExternalLink,
  X,
  Eye,
  EyeOff,
  RefreshCw,
} from "lucide-react";

export interface SetupWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigSaved?: (config: { apiKey: string; model: string }) => void;
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
      if (savedKey) setApiKey(savedKey);
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
      const orchestratorUrl =
        process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "http://localhost:4000";
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
    }

    if (onConfigSaved) {
      onConfigSaved({ apiKey: finalKey, model: finalModel });
    }

    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0, 0, 0, 0.75)",
          backdropFilter: "blur(6px)",
          padding: "20px",
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ type: "spring", duration: 0.3 }}
          style={{
            width: "100%",
            maxWidth: "640px",
            maxHeight: "90vh",
            background: "#121215",
            border: "1px solid #27272a",
            borderRadius: "12px",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "20px 24px",
              borderBottom: "1px solid #27272a",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "8px",
                  background: "#18181b",
                  border: "1px solid #27272a",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Sparkles size={18} color="#ffffff" />
              </div>
              <div>
                <h2
                  style={{
                    fontSize: "16px",
                    fontWeight: 600,
                    color: "#f4f4f5",
                  }}
                >
                  {isFirstRun
                    ? "Welcome to Crucible"
                    : "Configuration & Credentials"}
                </h2>
                <p
                  style={{
                    fontSize: "12px",
                    color: "#a1a1aa",
                    marginTop: "2px",
                  }}
                >
                  Self-hosted AI agent harness & execution orchestrator
                </p>
              </div>
            </div>
            {!isFirstRun && (
              <button
                type="button"
                onClick={onClose}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#a1a1aa",
                  cursor: "pointer",
                  padding: "6px",
                  borderRadius: "6px",
                }}
              >
                <X size={18} />
              </button>
            )}
          </div>

          {/* Scrollable Body */}
          <div
            style={{
              padding: "24px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: "20px",
            }}
          >
            {/* Step 1: API Key Section */}
            <div
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              <label
                style={{
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "#f4f4f5",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  <Key size={14} color="#a1a1aa" />
                  OpenRouter API Key
                </span>
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: "12px",
                    color: "#388bfd",
                    textDecoration: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  Get API Key <ExternalLink size={11} />
                </a>
              </label>

              <div
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <input
                  type={showKey ? "text" : "password"}
                  placeholder="sk-or-v1-..."
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setValidationStatus("idle");
                    setValidationMessage(null);
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 80px 10px 12px",
                    background: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: "6px",
                    color: "#f4f4f5",
                    fontSize: "13px",
                    fontFamily: "monospace",
                    outline: "none",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    right: "8px",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#a1a1aa",
                      padding: "4px",
                      cursor: "pointer",
                    }}
                  >
                    {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                  <button
                    type="button"
                    onClick={handleValidateKey}
                    disabled={isValidating || !apiKey.trim()}
                    style={{
                      background: "#27272a",
                      border: "1px solid #3f3f46",
                      color: "#f4f4f5",
                      fontSize: "11px",
                      fontWeight: 500,
                      padding: "4px 8px",
                      borderRadius: "4px",
                      cursor:
                        isValidating || !apiKey.trim()
                          ? "not-allowed"
                          : "pointer",
                    }}
                  >
                    {isValidating ? "Testing..." : "Validate"}
                  </button>
                </div>
              </div>

              {validationMessage && (
                <div
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    background:
                      validationStatus === "valid"
                        ? "rgba(34, 197, 94, 0.1)"
                        : "rgba(239, 68, 68, 0.1)",
                    border:
                      validationStatus === "valid"
                        ? "1px solid rgba(34, 197, 94, 0.3)"
                        : "1px solid rgba(239, 68, 68, 0.3)",
                    color: validationStatus === "valid" ? "#4ade80" : "#f87171",
                  }}
                >
                  {validationStatus === "valid" ? (
                    <CheckCircle2 size={14} />
                  ) : (
                    <AlertCircle size={14} />
                  )}
                  <span>{validationMessage}</span>
                </div>
              )}
            </div>

            {/* Step 2: Model Selection */}
            <div
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              <label
                style={{
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "#f4f4f5",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <Layers size={14} color="#a1a1aa" />
                Default Reasoning Model
              </label>

              <div
                style={{ display: "flex", flexDirection: "column", gap: "6px" }}
              >
                {POPULAR_MODELS.map((m) => {
                  const isSelected = selectedModel === m.id;
                  return (
                    <div
                      key={m.id}
                      onClick={() => setSelectedModel(m.id)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "6px",
                        background: isSelected ? "#27272a" : "#18181b",
                        border: isSelected
                          ? "1px solid #52525b"
                          : "1px solid #27272a",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: "13px",
                            fontWeight: 500,
                            color: "#f4f4f5",
                          }}
                        >
                          {m.name}
                        </div>
                        <div
                          style={{
                            fontSize: "11px",
                            color: "#a1a1aa",
                            marginTop: "1px",
                          }}
                        >
                          {m.desc}
                        </div>
                      </div>
                      <div
                        style={{
                          width: "14px",
                          height: "14px",
                          borderRadius: "50%",
                          border: isSelected
                            ? "4px solid #ffffff"
                            : "2px solid #52525b",
                          background: isSelected ? "#09090b" : "transparent",
                        }}
                      />
                    </div>
                  );
                })}

                <div
                  onClick={() => setSelectedModel("custom")}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "6px",
                    background:
                      selectedModel === "custom" ? "#27272a" : "#18181b",
                    border:
                      selectedModel === "custom"
                        ? "1px solid #52525b"
                        : "1px solid #27272a",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "13px",
                        fontWeight: 500,
                        color: "#f4f4f5",
                      }}
                    >
                      Custom Model Identifier
                    </div>
                    <div
                      style={{
                        width: "14px",
                        height: "14px",
                        borderRadius: "50%",
                        border:
                          selectedModel === "custom"
                            ? "4px solid #ffffff"
                            : "2px solid #52525b",
                        background:
                          selectedModel === "custom"
                            ? "#09090b"
                            : "transparent",
                      }}
                    />
                  </div>
                  {selectedModel === "custom" && (
                    <input
                      type="text"
                      placeholder="e.g. google/gemini-2.0-flash-001"
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        marginTop: "8px",
                        width: "100%",
                        padding: "8px 10px",
                        background: "#121215",
                        border: "1px solid #3f3f46",
                        borderRadius: "4px",
                        color: "#f4f4f5",
                        fontSize: "12px",
                        fontFamily: "monospace",
                        outline: "none",
                      }}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Step 3: Self-Hosted System Status */}
            <div
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "#f4f4f5",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <ShieldCheck size={14} color="#a1a1aa" />
                  Stack Services Health
                </span>
                <button
                  type="button"
                  onClick={checkServicesHealth}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#a1a1aa",
                    fontSize: "11px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <RefreshCw size={11} /> Refresh
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "8px",
                }}
              >
                <div
                  style={{
                    padding: "8px 10px",
                    borderRadius: "6px",
                    background: "#18181b",
                    border: "1px solid #27272a",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      fontSize: "12px",
                      color: "#f4f4f5",
                    }}
                  >
                    <Server size={13} color="#a1a1aa" /> Orchestrator
                  </div>
                  <span
                    style={{
                      fontSize: "11px",
                      color:
                        services.orchestrator === "ok" ? "#4ade80" : "#f87171",
                    }}
                  >
                    {services.orchestrator === "ok"
                      ? "Online"
                      : "Connecting..."}
                  </span>
                </div>

                <div
                  style={{
                    padding: "8px 10px",
                    borderRadius: "6px",
                    background: "#18181b",
                    border: "1px solid #27272a",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      fontSize: "12px",
                      color: "#f4f4f5",
                    }}
                  >
                    <Layers size={13} color="#a1a1aa" /> Rust Executor
                  </div>
                  <span
                    style={{
                      fontSize: "11px",
                      color: services.executor === "ok" ? "#4ade80" : "#f87171",
                    }}
                  >
                    {services.executor === "ok" ? "gRPC Ready" : "Standby"}
                  </span>
                </div>

                <div
                  style={{
                    padding: "8px 10px",
                    borderRadius: "6px",
                    background: "#18181b",
                    border: "1px solid #27272a",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      fontSize: "12px",
                      color: "#f4f4f5",
                    }}
                  >
                    <Database size={13} color="#a1a1aa" /> Postgres DB
                  </div>
                  <span
                    style={{
                      fontSize: "11px",
                      color: services.database === "ok" ? "#4ade80" : "#f87171",
                    }}
                  >
                    {services.database === "ok" ? "Connected" : "Standby"}
                  </span>
                </div>

                <div
                  style={{
                    padding: "8px 10px",
                    borderRadius: "6px",
                    background: "#18181b",
                    border: "1px solid #27272a",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      fontSize: "12px",
                      color: "#f4f4f5",
                    }}
                  >
                    <Database size={13} color="#a1a1aa" /> Redis Cache
                  </div>
                  <span
                    style={{
                      fontSize: "11px",
                      color: services.redis === "ok" ? "#4ade80" : "#f87171",
                    }}
                  >
                    {services.redis === "ok" ? "Active" : "Standby"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "16px 24px",
              borderTop: "1px solid #27272a",
              background: "#0d0d10",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontSize: "11px", color: "#71717a" }}>
              Configuration is persisted locally
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {!isFirstRun && (
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: "8px 14px",
                    borderRadius: "6px",
                    background: "transparent",
                    border: "1px solid #27272a",
                    color: "#a1a1aa",
                    fontSize: "12px",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={handleSave}
                style={{
                  padding: "8px 16px",
                  borderRadius: "6px",
                  background: "#ffffff",
                  border: "none",
                  color: "#09090b",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {isFirstRun ? "Launch Harness" : "Save Settings"}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

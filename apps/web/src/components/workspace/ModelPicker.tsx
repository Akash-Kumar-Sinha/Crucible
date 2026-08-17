"use client";

import * as React from "react";
import { orchestratorClient, type ModelInfo } from "@/api/orchestrator-client";
import { Sparkles, ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export interface ModelPickerProps {
  selectedModel?: string;
  onModelChange: (modelId: string) => void;
  className?: string;
  disabled?: boolean;
}

const DEFAULT_MODELS: ModelInfo[] = [
  {
    id: "openrouter/free",
    name: "OpenRouter Free Router",
    description: "Zero-cost rate-limited free model pool",
    contextLength: 128000,
    isFree: true,
    provider: "openrouter",
  },
  {
    id: "qwen/qwen-2.5-coder-32b-instruct",
    name: "Qwen 2.5 Coder 32B",
    description: "High-throughput coding specialist",
    contextLength: 32768,
    isFree: false,
    provider: "qwen",
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    name: "Llama 3.3 70B",
    description: "Open-weights flagship reasoning",
    contextLength: 131072,
    isFree: false,
    provider: "meta-llama",
  },
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek V3",
    description: "High performance cost-effective reasoning",
    contextLength: 64000,
    isFree: false,
    provider: "deepseek",
  },
];

export function ModelPicker({
  selectedModel = "openrouter/free",
  onModelChange,
  className = "",
  disabled = false,
}: ModelPickerProps) {
  const [models, setModels] = React.useState<ModelInfo[]>(DEFAULT_MODELS);

  React.useEffect(() => {
    let isMounted = true;
    orchestratorClient
      .listModels()
      .then((data) => {
        if (isMounted && Array.isArray(data) && data.length > 0) {
          setModels(data);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  const activeModel = models.find((m) => m.id === selectedModel) ||
    models[0] || {
      id: selectedModel,
      name: selectedModel.split("/").pop() || selectedModel,
      description: "",
      contextLength: 128000,
      isFree: selectedModel.includes("free"),
      provider: selectedModel.split("/")[0] || "model",
    };

  const formatContext = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${Math.round(num / 1000)}k`;
    return num.toString();
  };

  return (
    <div className={`relative inline-block ${className}`}>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 bg-zinc-900/90 hover:bg-zinc-800 text-zinc-200 hover:text-white transition-all text-xs font-mono select-none disabled:opacity-50 outline-none"
        >
          <Sparkles size={12} className="text-sky-400 shrink-0" />
          <span className="truncate max-w-[160px] font-medium text-xs">
            {activeModel.name}
          </span>
          {activeModel.isFree && (
            <span className="px-1 py-0.2 bg-emerald-500/20 text-emerald-300 text-[9px] rounded font-semibold">
              FREE
            </span>
          )}
          <ChevronDown size={12} className="text-zinc-400" />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          sideOffset={6}
          className="w-72 rounded-lg border border-white/10 bg-zinc-950/95 backdrop-blur-xl p-2 z-50 shadow-2xl"
        >
          <div className="px-2.5 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>Select Model Strategy</span>
            <span className="text-zinc-500 text-[9px]">OpenRouter</span>
          </div>
          <DropdownMenuSeparator className="bg-white/5 my-1" />

          <div className="space-y-1 max-h-80 overflow-y-auto">
            {models.map((m) => {
              const isSelected = m.id === selectedModel;
              return (
                <DropdownMenuItem
                  key={m.id}
                  onClick={() => onModelChange(m.id)}
                  className={`w-full text-left p-2 rounded-lg transition-colors flex items-start justify-between gap-2 text-xs font-mono cursor-pointer ${
                    isSelected
                      ? "bg-zinc-800 text-white border border-white/10"
                      : "hover:bg-zinc-800/70 text-zinc-300 hover:text-white"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-xs truncate">
                        {m.name}
                      </span>
                      {m.isFree && (
                        <span className="px-1 py-0.2 bg-emerald-500/20 text-emerald-300 text-[9px] rounded font-semibold">
                          FREE
                        </span>
                      )}
                    </div>
                    {m.description && (
                      <p className="text-[10px] text-zinc-400 line-clamp-1 mt-0.5 font-sans leading-relaxed">
                        {m.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1 text-[9px] text-zinc-500">
                      <span>{formatContext(m.contextLength)} context</span>
                      <span>•</span>
                      <span>{m.provider}</span>
                    </div>
                  </div>

                  {isSelected && (
                    <Check size={14} className="text-sky-400 mt-0.5 shrink-0" />
                  )}
                </DropdownMenuItem>
              );
            })}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

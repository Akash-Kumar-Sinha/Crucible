"use client";

import * as React from "react";
import { RolePicker } from "@/components/workspace/RolePicker";
import { ModelPicker } from "@/components/workspace/ModelPicker";

export interface RoleModelPickerProps {
  selectedRole?: string;
  selectedModel?: string;
  onRoleChange: (roleId: string, defaultModel?: string) => void;
  onModelChange: (modelId: string) => void;
  className?: string;
  disabled?: boolean;
  compact?: boolean;
}

export function RoleModelPicker({
  selectedRole = "coder",
  selectedModel = "openrouter/free",
  onRoleChange,
  onModelChange,
  className = "",
  disabled = false,
  compact = false,
}: RoleModelPickerProps) {
  const handleRoleSelection = (roleId: string, defaultModel?: string) => {
    onRoleChange(roleId, defaultModel);
    if (defaultModel) {
      onModelChange(defaultModel);
    }
  };

  if (compact) {
    return (
      <div
        className={`flex items-center gap-2 flex-wrap ${className}`}
        data-testid="role-model-picker"
      >
        <RolePicker
          selectedRole={selectedRole}
          onRoleChange={handleRoleSelection}
          disabled={disabled}
        />
        <ModelPicker
          selectedModel={selectedModel}
          onModelChange={onModelChange}
          disabled={disabled}
        />
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-between gap-4 px-4 py-2 rounded-full border border-white/10 bg-zinc-950/80 backdrop-blur-md shadow-sm ${className}`}
      data-testid="role-model-picker"
    >
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-zinc-400">Agent Role</span>
        <RolePicker
          selectedRole={selectedRole}
          onRoleChange={handleRoleSelection}
          disabled={disabled}
        />
      </div>

      <div className="h-4 w-px bg-white/10 hidden sm:block" />

      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-zinc-400">Model Strategy</span>
        <ModelPicker
          selectedModel={selectedModel}
          onModelChange={onModelChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

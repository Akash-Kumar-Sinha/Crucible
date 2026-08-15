export interface TenantScope {
  tenantId: string;
  namespace: string;
}

const TENANT_STORAGE_KEY = "crucible_tenant_id";
const NAMESPACE_STORAGE_KEY = "crucible_namespace";
const DEFAULT_TENANT_ID =
  process.env.NEXT_PUBLIC_CRUCIBLE_TENANT_ID || "default";
const DEFAULT_NAMESPACE =
  process.env.NEXT_PUBLIC_CRUCIBLE_NAMESPACE || "crucible";

export function getDefaultTenantScope(): TenantScope {
  return {
    tenantId: DEFAULT_TENANT_ID,
    namespace: DEFAULT_NAMESPACE,
  };
}

export function normalizeTenantScope(
  scope?: Partial<TenantScope> | null,
): TenantScope {
  const defaults = getDefaultTenantScope();
  return {
    tenantId: scope?.tenantId?.trim() || defaults.tenantId,
    namespace: scope?.namespace?.trim() || defaults.namespace,
  };
}

export function readTenantScope(): TenantScope {
  if (typeof window === "undefined") {
    return getDefaultTenantScope();
  }

  return normalizeTenantScope({
    tenantId: window.localStorage.getItem(TENANT_STORAGE_KEY) ?? undefined,
    namespace: window.localStorage.getItem(NAMESPACE_STORAGE_KEY) ?? undefined,
  });
}

export function writeTenantScope(scope: TenantScope): void {
  if (typeof window === "undefined") {
    return;
  }

  const normalized = normalizeTenantScope(scope);
  window.localStorage.setItem(TENANT_STORAGE_KEY, normalized.tenantId);
  window.localStorage.setItem(NAMESPACE_STORAGE_KEY, normalized.namespace);
}

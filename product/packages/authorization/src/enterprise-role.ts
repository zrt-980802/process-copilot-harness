export type ModuleCapability = "read" | "edit" | "approve" | "publish";
export type ModuleFocus = "none" | "secondary" | "primary";
export type ModuleVisibility = "none" | "visible";
export type MatrixSymbol = "●" | "◐" | "○" | "—";

export interface RoleModuleRelation {
  readonly roleKey: string;
  readonly moduleKey: string;
  readonly visibility: ModuleVisibility;
  readonly capabilities: readonly ModuleCapability[];
  readonly focus: ModuleFocus;
  readonly requestable: boolean;
}

export interface ResponsibilityAssignment {
  readonly accountId: string;
  readonly responsibilityKey: string;
  readonly scopeType: "project" | "module" | "stage" | "global";
  readonly scopeId: string;
  readonly status: "active" | "inactive";
}

const symbolSemantics: Record<
  MatrixSymbol,
  Omit<RoleModuleRelation, "roleKey" | "moduleKey">
> = {
  "●": {
    visibility: "visible",
    capabilities: ["read", "edit"],
    focus: "primary",
    requestable: false
  },
  "◐": {
    visibility: "visible",
    capabilities: ["read", "edit"],
    focus: "secondary",
    requestable: false
  },
  "○": {
    visibility: "visible",
    capabilities: ["read"],
    focus: "none",
    requestable: false
  },
  "—": {
    visibility: "none",
    capabilities: [],
    focus: "none",
    requestable: true
  }
};

export function relationFromMatrixSymbol(
  roleKey: string,
  moduleKey: string,
  symbol: MatrixSymbol
): RoleModuleRelation {
  return {
    roleKey,
    moduleKey,
    ...symbolSemantics[symbol]
  };
}

export function authorizationEffect(
  relation: RoleModuleRelation
): ReadonlySet<ModuleCapability> {
  if (relation.visibility === "none") return new Set();
  return new Set(relation.capabilities);
}

export function projectWorkbenchCapabilities(
  relation: RoleModuleRelation,
  currentlyAuthorized: ReadonlySet<ModuleCapability>
): readonly ModuleCapability[] {
  if (relation.visibility === "none") return [];
  return relation.capabilities.filter((capability) =>
    currentlyAuthorized.has(capability)
  );
}

export function responsibilityAuthorizationEffect(
  assignment: ResponsibilityAssignment
): ReadonlySet<ModuleCapability> {
  void assignment;
  return new Set();
}

export function canCreateAccessRequest(relation: RoleModuleRelation): boolean {
  return relation.requestable;
}

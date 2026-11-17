export interface EEAccountPresentation {
  account: { id: number; username: string; display_name: string };
  roles: Array<{ role_key: string; name: string }>;
  is_system_admin?: boolean;
}

export function roleLabel(identity: EEAccountPresentation): string {
  if (identity.is_system_admin) return "系统管理员";
  return [...new Set(identity.roles.map((role) => role.name.trim()).filter(Boolean))].join(" / ") || "未分配平台角色";
}

export function scopeLabel(project?: string): string {
  return project ? `项目范围 · ${project}` : "个人范围";
}

import { describe, expect, it } from "vitest";
import { roleLabel, scopeLabel } from "../src/account-presentation";

describe("Account and scope presentation", () => {
  const account = { id: 1, username: "demo.admin", display_name: "Display name" };
  it("uses authority roles without inferring admin from a login name", () => {
    expect(roleLabel({ account, roles: [{ role_key: "review", name: "Reviewer" }] })).toBe("Reviewer");
  });
  it("keeps platform administrator distinct from project access", () => {
    expect(roleLabel({ account, roles: [], is_system_admin: true })).toBe("系统管理员");
    expect(scopeLabel()).toBe("个人范围");
  });
  it("retains multiple real roles and makes missing assignment explicit", () => {
    expect(roleLabel({ account, roles: [{ role_key: "a", name: "Engineer" }, { role_key: "b", name: "Reviewer" }] })).toBe("Engineer / Reviewer");
    expect(roleLabel({ account, roles: [] })).toBe("未分配平台角色");
    expect(scopeLabel("EP37")).toBe("项目范围 · EP37");
  });
});

import { describe, it, expect } from "bun:test";
import { RolesRouteHandler } from "./roles";

describe("RolesRouteHandler (GET /roles)", () => {
  it("should return list of available agent roles with capabilities and default models", async () => {
    const handler = new RolesRouteHandler();
    const response = await handler.listRoles();

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;

    expect(body.status).toBe("success");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(4);

    const coder = body.data.find((r: any) => r.id === "coder");
    expect(coder).toBeDefined();
    expect(coder.readOnly).toBe(false);
    expect(coder.allowedTools).toContain("write_file");

    const bugHunter = body.data.find((r: any) => r.id === "bug_hunter");
    expect(bugHunter).toBeDefined();
    expect(bugHunter.readOnly).toBe(true);
    expect(bugHunter.allowedTools).not.toContain("write_file");
  });

  it("should return individual role by ID on GET /roles/:id", async () => {
    const handler = new RolesRouteHandler();
    const response = await handler.getRole("test_writer");

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;

    expect(body.status).toBe("success");
    expect(body.data.id).toBe("test_writer");
    expect(body.data.name).toBe("Test Writer");
  });
});

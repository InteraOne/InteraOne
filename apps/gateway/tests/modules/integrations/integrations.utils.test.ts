import { describe, expect, it } from "vitest";
import {
  canonicalizeArguments,
  safeIntegrationError,
} from "@modules/integrations/integrations.utils";
import {
  getCatalogTool,
  INTEGRATION_CATALOG,
} from "@modules/integrations/integrations.policy";
import { buildComposioUserId } from "@modules/integrations/composio.adapter";

describe("Composio integration policy", () => {
  it("builds a stable identity scoped to deployment, tenant, and actor", () => {
    const first = buildComposioUserId("org-1", "user-1");
    expect(first).toBe(buildComposioUserId("org-1", "user-1"));
    expect(first).toContain(":org-1:user-1");
    expect(buildComposioUserId("org-2", "user-1")).not.toBe(first);
    expect(buildComposioUserId("org-1", "user-2")).not.toBe(first);
  });

  it("enables the verified GitHub search action as read-only", () => {
    expect(getCatalogTool("github", "GITHUB_SEARCH_REPOSITORIES")).toMatchObject({
      risk: "read",
      defaultEnabled: true,
    });
  });

  it("classifies GitHub issue creation as approval-gated write", () => {
    expect(getCatalogTool("github", "GITHUB_CREATE_AN_ISSUE")).toMatchObject({
      risk: "write",
      defaultEnabled: false,
    });
  });

  it("does not admit unknown action slugs", () => {
    expect(getCatalogTool("github", "GITHUB_DELETE_A_REPOSITORY")).toBeUndefined();
  });

  it("exposes the reviewed InteraOne toolkit catalog with Composio summaries", () => {
    expect(INTEGRATION_CATALOG.map((toolkit) => toolkit.slug)).toEqual([
      "gmail",
      "slack",
      "googlecalendar",
      "github",
      "jira",
      "notion",
      "hubspot",
    ]);
    expect(INTEGRATION_CATALOG.flatMap((toolkit) => toolkit.tools)).toHaveLength(44);
    expect(getCatalogTool("gmail", "GMAIL_FETCH_EMAILS")?.description).toMatch(
      /^Fetches a list of email messages from a Gmail account/,
    );
    expect(getCatalogTool("slack", "SLACK_SEND_MESSAGE")).toMatchObject({
      risk: "write",
      defaultEnabled: false,
    });
    expect(getCatalogTool("jira", "JIRA_SEARCH_FOR_ISSUES_USING_JQL_POST")).toBeUndefined();
  });
});

describe("integration approval argument binding", () => {
  it("produces the same hash regardless of object key order", () => {
    const left = canonicalizeArguments({ repo: "InteraOne", owner: "InteraOne", nested: { b: 2, a: 1 } });
    const right = canonicalizeArguments({ nested: { a: 1, b: 2 }, owner: "InteraOne", repo: "InteraOne" });
    expect(left.hash).toBe(right.hash);
    expect(left.arguments).toEqual(right.arguments);
  });

  it("changes the hash when any approved argument changes", () => {
    const original = canonicalizeArguments({ title: "A", body: "first" });
    const changed = canonicalizeArguments({ title: "A", body: "second" });
    expect(original.hash).not.toBe(changed.hash);
  });

  it("rejects oversized argument payloads", () => {
    expect(() => canonicalizeArguments({ body: "x".repeat(17_000) })).toThrow(/16 KB/);
  });
});

describe("integration provider error mapping", () => {
  it("reports an actionable message for a nested invalid API key response", () => {
    const error = new Error("Couldn't fetch Toolkit with slug: github", {
      cause: Object.assign(new Error("401 APIKey_InvalidAPIKey"), {
        status: 401,
      }),
    });

    expect(safeIntegrationError(error)).toMatch(/project API key is invalid/i);
    expect(safeIntegrationError(error)).not.toContain("401");
  });

  it("maps scoped-key permission failures without exposing provider details", () => {
    expect(
      safeIntegrationError(
        Object.assign(new Error("permission payload"), { status: 403 }),
      ),
    ).toMatch(/does not have permission/i);
  });
});

import { IntegrationToolRisk } from "@shared/models";

export interface CatalogTool {
  slug: string;
  name: string;
  risk: IntegrationToolRisk;
  description: string;
  defaultEnabled: boolean;
  requiresApproval: boolean;
}

export interface CatalogToolkit {
  slug: string;
  name: string;
  description: string;
  logo?: string;
  category?: string;
  toolsCount?: number;
  tools: CatalogTool[];
}

/**
 * Composio's behavioral hints are the policy source of truth. Unknown or
 * incomplete metadata fails closed as a write instead of guessing from names.
 */
export function riskFromComposioTags(tags: string[]): IntegrationToolRisk {
  const normalized = new Set(tags.map((tag) => tag.toLowerCase()));
  if (normalized.has("destructivehint")) return "sensitive";
  if (normalized.has("readonlyhint")) return "read";
  return "write";
}

export function catalogToolFromComposio(input: {
  slug: string;
  name: string;
  description: string;
  tags: string[];
}): CatalogTool {
  const risk = riskFromComposioTags(input.tags);
  return {
    slug: input.slug,
    name: input.name,
    description: input.description,
    risk,
    defaultEnabled: risk === "read",
    requiresApproval: risk === "sensitive",
  };
}

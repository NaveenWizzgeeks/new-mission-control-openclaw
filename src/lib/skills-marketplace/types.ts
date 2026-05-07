import type { SkillType } from '@/lib/agentSkills';

export type SkillCategory =
  | 'dev-tools'
  | 'testing'
  | 'github'
  | 'cloud'
  | 'productivity'
  | 'communication'
  | 'data'
  | 'persona'
  | 'methodology'
  | 'security'
  | 'channel'
  | 'memory'
  | 'workflow'
  | 'other';

export type SecuritySeverity = 'critical' | 'warning' | 'info';
export type MarketplaceSource = 'clawhub' | 'local';
export type MarketplaceKind = 'skill' | 'plugin';

export interface SecurityFinding {
  severity: SecuritySeverity;
  code: string;
  message: string;
}

/** Full skill record — what the catalog stores and what the detail API returns. */
export interface MarketplaceSkill {
  slug: string;
  name: string;
  short_description: string;
  readme: string;
  author: string;
  version: string;
  category: SkillCategory;
  tags: string[];
  rating: number;
  rating_count: number;
  installs: number;
  updated_at: string;
  source: MarketplaceSource;
  kind: MarketplaceKind;
  // ClawHub-specific badges, optional.
  verified?: boolean;
  official?: boolean;
  executes_code?: boolean;
  family?: string;
  external_url?: string;
  install_template: {
    skill_type: SkillType;
    skill_name: string;
    skill_config: Record<string, unknown>;
  };
  install_hint?: string;
}

/** What the list endpoint returns. Derived from MarketplaceSkill — flattens install_template.skill_type. */
export interface MarketplaceListItem {
  slug: string;
  name: string;
  short_description: string;
  author: string;
  category: SkillCategory;
  tags: string[];
  rating: number;
  rating_count: number;
  installs: number;
  skill_type: SkillType;
  source: MarketplaceSource;
  kind: MarketplaceKind;
  verified?: boolean;
  official?: boolean;
  executes_code?: boolean;
  family?: string;
  version?: string;
  external_url?: string;
}

export interface MarketplaceDetail extends MarketplaceSkill {
  security_findings: SecurityFinding[];
}

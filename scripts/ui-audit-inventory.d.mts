export interface UiAuditRoute {
  id: string;
  pattern: string;
  source: string;
  family: 'app' | 'public';
  kind: 'screen' | 'redirect';
  dynamic: boolean;
  redirectContract?: {
    probePath: string;
    statuses: number[];
    location?: string;
    locations?: string[];
    outcomes: string[];
  } | null;
  observations: Record<string, boolean | number>;
}

export interface UiAuditInventory {
  schemaVersion: number;
  baseCommit: string;
  sourceRef: string;
  sourceCommit: string;
  sourceTreeSha: string;
  workingTreeFingerprint: string;
  summary: {
    endpoints: number;
    screens: number;
    redirects: number;
    dynamicScreens: number;
    appScreens: number;
    publicScreens: number;
  };
  knownBaselineFailures: Array<{ id: string; observation: string }>;
  routes: UiAuditRoute[];
}

export function buildRouteInventory(options?: {
  cleanBaseline?: boolean;
  baselineRef?: string;
  repositoryRoot?: string;
}): Promise<UiAuditInventory>;

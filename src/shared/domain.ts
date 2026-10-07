import type { MihomoConfig, ProxyNode, TargetFormat } from './types';

export type NodeSourceKind = 'manual' | 'file' | 'remote-url' | 'share-links';
export type ResourceStatus = 'active' | 'disabled' | 'error';

export interface NodeSource {
  id: string;
  userId: string;
  name: string;
  kind: NodeSourceKind;
  url?: string;
  format: 'auto' | 'links' | 'mihomo' | 'sing-box';
  enabled: boolean;
  intervalMinutes: number;
  userAgent?: string;
  skipCertVerify: boolean;
  lastRequestProfile?: string;
  nodeCount: number;
  lastUpdatedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedNode extends ProxyNode {
  userId: string;
  sourceId?: string;
  enabled: boolean;
  sortOrder: number;
  tags: string[];
  rawConfig?: Record<string, unknown>;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProxyGroupMember {
  id: string;
  groupId: string;
  memberType: 'node' | 'group' | 'builtin';
  memberId: string;
  position: number;
}

export interface GenerationProfile {
  id: string;
  userId: string;
  name: string;
  targetFormat: TargetFormat;
  config: MihomoConfig;
  nodeIds: string[];
  sourceIds: string[];
  templateId?: string;
  projectId?: string;
  autoUpdate?: boolean;
  includeNewNodes?: boolean;
  lastSyncAt?: string;
  lastSyncError?: string;
  status: ResourceStatus;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedSubscription {
  id: string;
  profileId: string;
  userId: string;
  name: string;
  targetFormat: TargetFormat;
  token?: string;
  content?: string;
  version: number;
  nodeCount: number;
  expiresAt?: string;
  revoked: boolean;
  createdAt: string;
  updatedAt: string;
}

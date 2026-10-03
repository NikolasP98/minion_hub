import type { PosClientLedgerRow } from '$server/db/pg-pos-schema';
import type { GrantView } from '../../pos-packages.service';
import type { PlanDetail } from './plan-detail';

export type WalletIdentityStatus =
  'active' | 'missing_contact' | 'deleted_contact' | 'missing_party';

export interface CurrencyBalance {
  currency: string;
  balance: number;
}

export interface CurrencyPlanBucket {
  currency: string;
  count: number;
  total: number;
}

export interface ClientAccountSummary {
  clientKey: string;
  requestedClientKey?: string;
  partyId: string | null;
  crmContactId: string | null;
  identityStatus: WalletIdentityStatus;
  balancesByCurrency: CurrencyBalance[];
  openPlansByCurrency: CurrencyPlanBucket[];
  balance: number;
  balanceCurrency: string;
  activeGrants: number;
  openPlans: number;
  totalOpenPlans: number;
  openPlanTotal: number;
  displayName: string | null;
  pendingScheduling: number;
  pendingTicketId: string | null;
}

export interface ClientAccountDetail {
  requestedClientKey: string;
  clientKey: string;
  client: { partyId: string | null; crmContactId: string | null };
  identityStatus: WalletIdentityStatus;
  displayName: string | null;
  balancesByCurrency: CurrencyBalance[];
  balance: number;
  balanceCurrency: string;
  ledger: PosClientLedgerRow[];
  ledgerHasMore: boolean;
  grants: GrantView[];
  grantsHasMore: boolean;
  plans: PlanDetail[];
  plansHasMore: boolean;
}

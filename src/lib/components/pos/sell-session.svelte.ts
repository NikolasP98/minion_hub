import { untrack } from 'svelte';
import {
  customerStorageKey as storedCustomerKey,
  EMPTY_CUSTOMER,
  parseStoredCustomer,
  serializeCustomer,
  type StoredCustomer,
} from './customer-storage';
import { freezePlanCart, sameFrozenCart, type FrozenPlanCartRow } from './plan-open-persistence';
import { instalmentPrefillAmount } from './checkout-money';
import {
  parseStoredSellCart,
  projectStoredSellCart,
  sellCartStorageKey,
  serializeFrozenPlanCart,
} from './plan-open-sell-continuation';
import {
  legacySellChargeStorageKey,
  parseSellChargeHandoff,
  sellChargeStorageKey,
  stageSellChargeHandoff,
  type SellChargeHandoffStage,
  type SellChargeStorage,
} from './sell-charge-handoff';
import type { CartLine, SellCartSellable } from './SellCart.svelte';

export interface SellSessionIdentity {
  actorId: string;
  orgId: string;
}

export interface SellAccount {
  clientKey: string;
  balance: number;
  grants: Array<{
    grant: { id: string; serviceProductId: string; sessionsTotal: number };
    sessionsRemaining: number;
    status: string;
  }>;
  plans: Array<{
    plan: {
      id: string;
      title: string;
      productId: string | null;
      currency: string;
      status: string;
    };
    remaining: number;
    nextDue: { dueOn: string; amount: number } | null;
    scheduleIssue: 'invalid_rows' | 'principal_mismatch' | 'too_many_rows' | null;
  }>;
}

interface SellSessionOptions {
  identity: () => SellSessionIdentity;
  sellables: () => readonly SellCartSellable[];
  lines: () => CartLine[];
  replaceLines: (lines: CartLine[]) => void;
  customer: () => StoredCustomer;
  replaceCustomer: (customer: StoredCustomer) => void;
  holdCartPersistence: () => boolean;
  storage: () => SellChargeStorage | null;
  fetchAccount?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  restoreFailureMessage: () => string;
  persistenceFailureMessage: () => string;
  onScopeChanged?: () => void;
}

interface RequestOwner extends SellSessionIdentity {
  generation: number;
  requestId: number;
  partyId: string;
}

export interface SellSessionSnapshot extends SellSessionIdentity {
  generation: number;
  partyId: string;
  storageKey: string;
}

export interface SellSessionScopeSnapshot extends SellSessionIdentity {
  generation: number;
}

export interface SellChargeClaim extends SellSessionScopeSnapshot {
  key: string;
  raw: string;
  stage: SellChargeHandoffStage;
}

export type SellChargeClaimResult =
  | { status: 'none' | 'legacy' | 'invalid' | 'unavailable' | 'stale' }
  | { status: 'staged'; claim: SellChargeClaim };

export type SellChargeFinalizeResult =
  'committed' | 'not-ready' | 'changed' | 'unavailable' | 'stale';

function identityKey(identity: SellSessionIdentity): string {
  const actorId = identity.actorId.trim();
  const orgId = identity.orgId.trim();
  return actorId && orgId ? JSON.stringify([actorId, orgId]) : '';
}

function sameCustomer(left: StoredCustomer, right: StoredCustomer): boolean {
  return (
    left.partyId === right.partyId &&
    left.customerName === right.customerName &&
    left.customerPhone === right.customerPhone &&
    left.customerDocNumber === right.customerDocNumber
  );
}

/** The synthetic cart line used for an authenticated open plan projection. */
export function sellPlanInstalmentLine(plan: SellAccount['plans'][number]): CartLine | null {
  const amount = instalmentPrefillAmount(plan);
  if (amount === null) return null;
  const sellable: SellCartSellable = {
    productId: `plan:${plan.plan.id}`,
    code: '',
    name: plan.plan.title,
    category: null,
    unitPrice: amount,
    active: true,
    kind: 'service',
    itemId: null,
    stockQty: null,
    hasMapping: false,
  };
  return { sellable, qty: 1, unitPrice: amount, discount: 0, planId: plan.plan.id };
}

/**
 * Owns the long-lived /pos/sell tab's actor/org storage and account-read scope.
 * Layout navigation can replace either identity without remounting this route,
 * so every storage write and every response continuation is fenced here.
 */
export function createSellSessionCoordinator(options: SellSessionOptions) {
  let account = $state<SellAccount | null>(null);
  let cartProjectionPending = $state(true);
  let cartProjectionError = $state<string | null>(null);
  let activeGeneration = $state(0);
  let activeIdentityKey = $state('');
  let activeIdentity: SellSessionIdentity = { actorId: '', orgId: '' };
  let cartStorageKey = $state('');
  let customerStorageKey = $state('');
  let storedRows: FrozenPlanCartRow[] = [];
  let hasDeferredPlanCart = false;
  let adoptedHandoffPlan: { planId: string; partyId: string } | null = null;
  let cartReadable = false;
  let customerReadable = false;
  let cartReadFailed = $state(false);
  let customerReadFailed = $state(false);
  let cartWriteFailed = $state(false);
  let customerWriteFailed = $state(false);
  let storageAccessFailed = $state(false);
  let scopeHydrated = $state(false);
  let generationCounter = 0;
  let requestCounter = 0;
  let currentRequestId = 0;
  let accountRefreshVersion = $state(0);

  const currentIdentity = (): SellSessionIdentity => {
    const identity = options.identity();
    return { actorId: identity.actorId.trim(), orgId: identity.orgId.trim() };
  };

  function storageAccess(): { storage: SellChargeStorage | null; failed: boolean } {
    try {
      const storage = options.storage();
      return { storage, failed: storage === null };
    } catch {
      return { storage: null, failed: true };
    }
  }

  function ownsGeneration(generation: number, identity: SellSessionIdentity): boolean {
    return (
      generation === activeGeneration &&
      identityKey(identity) !== '' &&
      identityKey(identity) === activeIdentityKey &&
      identityKey(currentIdentity()) === activeIdentityKey
    );
  }

  function ownsRequest(owner: RequestOwner): boolean {
    return (
      owner.requestId === currentRequestId &&
      ownsGeneration(owner.generation, owner) &&
      options.customer().partyId === owner.partyId
    );
  }

  function ownsScope(scope: SellSessionScopeSnapshot): boolean {
    return ownsGeneration(scope.generation, scope);
  }

  function isSnapshotCurrent(snapshot: SellSessionSnapshot): boolean {
    return (
      ownsGeneration(snapshot.generation, snapshot) &&
      snapshot.storageKey === cartStorageKey &&
      options.customer().partyId === snapshot.partyId
    );
  }

  function stageChargeHandoff(scope: SellSessionScopeSnapshot): SellChargeClaimResult {
    if (!ownsScope(scope) || !scopeHydrated) return { status: 'stale' };
    const access = storageAccess();
    if (!access.storage) {
      if (ownsScope(scope)) storageAccessFailed = true;
      return { status: 'unavailable' };
    }
    const key = sellChargeStorageKey(scope);
    try {
      const raw = access.storage.getItem(key);
      if (!ownsScope(scope) || !scopeHydrated) return { status: 'stale' };
      if (raw === null) {
        const legacyKey = legacySellChargeStorageKey(scope.orgId);
        return legacyKey && access.storage.getItem(legacyKey) !== null
          ? { status: 'legacy' }
          : { status: 'none' };
      }
      const handoff = parseSellChargeHandoff(raw, scope);
      if (!handoff) return { status: 'invalid' };
      return {
        status: 'staged',
        claim: {
          ...scope,
          key,
          raw,
          stage: stageSellChargeHandoff(handoff, options.sellables()),
        },
      };
    } catch {
      if (ownsScope(scope)) storageAccessFailed = true;
      return { status: 'unavailable' };
    }
  }

  function adoptChargeHandoff(claim: SellChargeClaim): boolean {
    if (!ownsScope(claim) || !scopeHydrated) return false;
    const access = storageAccess();
    if (!access.storage) {
      if (ownsScope(claim)) storageAccessFailed = true;
      return false;
    }
    try {
      if (access.storage.getItem(claim.key) !== claim.raw) return false;
    } catch {
      if (ownsScope(claim)) storageAccessFailed = true;
      return false;
    }
    // Retire every owner of the hydrated cart before the page changes customer
    // or lines. A late response for the prior synthetic cart must not project
    // those rows over this calendar charge.
    currentRequestId = ++requestCounter;
    accountRefreshVersion++;
    account = null;
    storedRows = [];
    hasDeferredPlanCart = false;
    cartProjectionError = null;
    const planId = claim.stage.pendingPlanId;
    const partyId = claim.stage.customer.partyId;
    adoptedHandoffPlan = planId && partyId ? { planId, partyId } : null;
    cartProjectionPending = planId !== null;
    if (planId && !partyId) cartProjectionError = options.restoreFailureMessage();
    return true;
  }

  function finalizeChargeHandoff(
    claim: SellChargeClaim,
    lines: CartLine[],
    customer: StoredCustomer,
  ): SellChargeFinalizeResult {
    if (!ownsScope(claim) || !scopeHydrated) return 'stale';
    const stage = claim.stage;
    const planId = stage.pendingPlanId;
    if (planId) {
      const partyId = stage.customer.partyId;
      const projected =
        partyId && account?.clientKey === `party:${partyId}`
          ? account.plans.find(
              (candidate) => candidate.plan.id === planId && candidate.plan.status === 'open',
            )
          : null;
      const intended = projected ? sellPlanInstalmentLine(projected) : null;
      if (!intended || !sameFrozenCart(freezePlanCart(lines), freezePlanCart([intended]))) {
        return 'not-ready';
      }
    } else {
      const intended = freezePlanCart(stage.lines);
      const actual = freezePlanCart(lines);
      if (!sameFrozenCart(actual, intended)) return 'not-ready';
    }
    if (!sameCustomer(customer, stage.customer)) return 'not-ready';

    const access = storageAccess();
    if (!access.storage) {
      if (ownsScope(claim)) storageAccessFailed = true;
      return 'unavailable';
    }
    const storage = access.storage;
    try {
      // A replacement written after staging wins. The old claim is never
      // allowed to delete bytes it did not read.
      if (storage.getItem(claim.key) !== claim.raw) return 'changed';
      const cartRaw = serializeFrozenPlanCart(freezePlanCart(lines));
      const customerRaw = serializeCustomer(customer);
      storage.setItem(cartStorageKey, cartRaw);
      if (storage.getItem(cartStorageKey) !== cartRaw) throw new Error('cart readback mismatch');
      if (customerRaw === null) storage.removeItem(customerStorageKey);
      else storage.setItem(customerStorageKey, customerRaw);
      if (storage.getItem(customerStorageKey) !== customerRaw) {
        throw new Error('customer readback mismatch');
      }
      if (!ownsScope(claim) || !scopeHydrated) return 'stale';
      if (storage.getItem(claim.key) !== claim.raw) return 'changed';
      storage.removeItem(claim.key);
      if (storage.getItem(claim.key) !== null) return 'changed';
      if (!ownsScope(claim) || !scopeHydrated) return 'stale';
      cartWriteFailed = false;
      customerWriteFailed = false;
      storageAccessFailed = false;
      adoptedHandoffPlan = null;
      cartProjectionPending = false;
      cartProjectionError = null;
      return 'committed';
    } catch {
      if (ownsScope(claim)) storageAccessFailed = true;
      return 'unavailable';
    }
  }

  function resolveStoredPlanCart(owner: RequestOwner, projection: SellAccount | null): void {
    if (!ownsRequest(owner)) return;
    if (adoptedHandoffPlan?.partyId === owner.partyId) {
      const detail = projection?.plans.find(
        (candidate) =>
          candidate.plan.id === adoptedHandoffPlan?.planId && candidate.plan.status === 'open',
      );
      if (detail && sellPlanInstalmentLine(detail)) {
        cartProjectionError = null;
        cartProjectionPending = false;
      } else {
        cartProjectionError = options.restoreFailureMessage();
        cartProjectionPending = true;
      }
      return;
    }
    if (!hasDeferredPlanCart || (!cartProjectionPending && !cartProjectionError)) return;
    const projected = projectStoredSellCart({
      rows: storedRows,
      sellables: options.sellables(),
      expectedPartyId: owner.partyId,
      projection,
    });
    if (!ownsRequest(owner)) return;
    if (projected.status === 'ready') {
      options.replaceLines(projected.lines);
      cartProjectionError = null;
      cartProjectionPending = false;
      return;
    }
    cartProjectionError = options.restoreFailureMessage();
    cartProjectionPending = true;
  }

  async function refreshAccount(partyId: string): Promise<SellAccount | null> {
    const identity = currentIdentity();
    const generation = activeGeneration;
    const requestId = ++requestCounter;
    currentRequestId = requestId;
    const owner: RequestOwner = { ...identity, generation, requestId, partyId };
    if (!ownsRequest(owner)) return null;
    if (hasDeferredPlanCart || adoptedHandoffPlan?.partyId === partyId) {
      cartProjectionPending = true;
      cartProjectionError = null;
    }
    try {
      const request = options.fetchAccount ?? fetch;
      const response = await request(`/api/pos/accounts/party:${partyId}`);
      if (!ownsRequest(owner)) return null;
      if (!response.ok) {
        account = null;
        resolveStoredPlanCart(owner, null);
        return null;
      }
      const next = (await response.json()) as SellAccount;
      // Parsing may be asynchronous (and can be userland-overridden in tests).
      // Recheck all four owner dimensions before applying the decoded payload.
      if (!ownsRequest(owner)) return null;
      if (next.clientKey !== `party:${partyId}`) {
        account = null;
        resolveStoredPlanCart(owner, null);
        return null;
      }
      account = next;
      resolveStoredPlanCart(owner, next);
      return next;
    } catch {
      if (ownsRequest(owner)) {
        account = null;
        resolveStoredPlanCart(owner, null);
      }
      return null;
    }
  }

  $effect(() => {
    const identity = currentIdentity();
    const nextIdentityKey = identityKey(identity);
    // Reading both fields above makes actor and organization explicit owners of
    // this lifecycle even when the route component itself remains mounted.
    const generation = ++generationCounter;
    activeGeneration = generation;
    activeIdentityKey = nextIdentityKey;
    activeIdentity = identity;
    currentRequestId = ++requestCounter;
    account = null;
    cartReadable = false;
    customerReadable = false;
    cartReadFailed = false;
    customerReadFailed = false;
    cartWriteFailed = false;
    customerWriteFailed = false;
    storageAccessFailed = false;
    scopeHydrated = false;
    cartProjectionPending = true;
    cartProjectionError = null;
    storedRows = [];
    hasDeferredPlanCart = false;
    adoptedHandoffPlan = null;
    cartStorageKey = identity.orgId ? sellCartStorageKey(identity.orgId) : '';
    customerStorageKey = identity.orgId ? storedCustomerKey(identity.orgId) : '';

    untrack(() => {
      options.onScopeChanged?.();
      if (!nextIdentityKey) {
        options.replaceLines([]);
        options.replaceCustomer(EMPTY_CUSTOMER);
        cartProjectionPending = false;
        return;
      }

      const access = storageAccess();
      const storage = access.storage;
      if (!storage) {
        storageAccessFailed = access.failed;
        cartReadFailed = true;
        customerReadFailed = true;
        options.replaceLines([]);
        options.replaceCustomer(EMPTY_CUSTOMER);
        cartProjectionPending = false;
        return;
      }

      let cartRaw: string | null = null;
      try {
        cartRaw = storage.getItem(cartStorageKey);
        cartReadable = true;
      } catch {
        cartReadFailed = true;
      }

      let customer = EMPTY_CUSTOMER;
      try {
        customer = parseStoredCustomer(storage.getItem(customerStorageKey));
        customerReadable = true;
      } catch {
        customerReadFailed = true;
      }
      options.replaceCustomer(customer);

      if (!cartReadable) {
        // Do not expose the previous scope's draft or overwrite an unreadable
        // current-scope value. The old in-memory array remains owned by its old
        // scope; this view is blocked until recovery storage is available.
        options.replaceLines([]);
        cartProjectionPending = false;
        return;
      }
      storedRows = parseStoredSellCart(cartRaw, options.sellables());
      hasDeferredPlanCart = storedRows.some((row) => row.planId !== null);
      const projected = projectStoredSellCart({
        rows: storedRows,
        sellables: options.sellables(),
        expectedPartyId: null,
      });
      if (projected.status === 'ready') {
        options.replaceLines(projected.lines);
        cartProjectionPending = false;
      } else {
        options.replaceLines([]);
        cartProjectionPending = true;
      }
      scopeHydrated = cartReadable && customerReadable;
    });

    return () => {
      if (activeGeneration !== generation) return;
      activeGeneration = ++generationCounter;
      activeIdentityKey = '';
      activeIdentity = { actorId: '', orgId: '' };
      currentRequestId = ++requestCounter;
      scopeHydrated = false;
    };
  });

  $effect(() => {
    const identity = currentIdentity();
    const generation = activeGeneration;
    const key = cartStorageKey;
    const lines = options.lines();
    const held = options.holdCartPersistence();
    const access = storageAccess();
    const storage = access.storage;
    if (!storage && ownsGeneration(generation, identity)) storageAccessFailed = access.failed;
    if (
      !storage ||
      !cartReadable ||
      !ownsGeneration(generation, identity) ||
      held ||
      cartProjectionPending ||
      cartProjectionError
    )
      return;
    try {
      const raw = serializeFrozenPlanCart(freezePlanCart(lines));
      storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw new Error('cart readback mismatch');
      if (ownsGeneration(generation, identity)) cartWriteFailed = false;
    } catch {
      if (ownsGeneration(generation, identity)) cartWriteFailed = true;
    }
  });

  $effect(() => {
    const identity = currentIdentity();
    const generation = activeGeneration;
    const key = customerStorageKey;
    const customer = options.customer();
    const access = storageAccess();
    const storage = access.storage;
    if (!storage && ownsGeneration(generation, identity)) storageAccessFailed = access.failed;
    // Read each field so bindable edits are dependencies without making the
    // account request depend on names, phone numbers or document text.
    const snapshot: StoredCustomer = {
      partyId: customer.partyId,
      customerName: customer.customerName,
      customerPhone: customer.customerPhone,
      customerDocNumber: customer.customerDocNumber,
    };
    if (!storage || !customerReadable || !ownsGeneration(generation, identity)) return;
    try {
      const raw = serializeCustomer(snapshot);
      if (raw === null) storage.removeItem(key);
      else storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw new Error('customer readback mismatch');
      if (ownsGeneration(generation, identity)) customerWriteFailed = false;
    } catch {
      if (ownsGeneration(generation, identity)) customerWriteFailed = true;
    }
  });

  $effect(() => {
    const identity = currentIdentity();
    const generation = activeGeneration;
    const partyId = options.customer().partyId;
    // A same-party calendar handoff still retires the prior account owner. Its
    // partyId assignment is value-identical, so this explicit adoption version
    // is what admits one replacement read. When the party changes too, Svelte
    // coalesces both dependencies into this single effect run.
    const refreshVersion = accountRefreshVersion;
    void refreshVersion;
    if (!ownsGeneration(generation, identity)) return;
    if (!partyId) {
      currentRequestId = ++requestCounter;
      account = null;
      if (hasDeferredPlanCart) {
        cartProjectionPending = true;
        cartProjectionError = options.restoreFailureMessage();
      }
      return;
    }
    void refreshAccount(partyId);
  });

  return {
    get account() {
      return account;
    },
    get cartProjectionPending() {
      return cartProjectionPending;
    },
    get cartProjectionError() {
      return cartProjectionError;
    },
    get hydrated() {
      return scopeHydrated;
    },
    get storageError() {
      return storageAccessFailed ||
        cartReadFailed ||
        customerReadFailed ||
        cartWriteFailed ||
        customerWriteFailed
        ? options.persistenceFailureMessage()
        : null;
    },
    get storageKey() {
      return cartStorageKey;
    },
    get scope() {
      return { ...activeIdentity, generation: activeGeneration };
    },
    capture(partyId: string): SellSessionSnapshot {
      return {
        ...activeIdentity,
        generation: activeGeneration,
        partyId,
        storageKey: cartStorageKey,
      };
    },
    isCurrent(snapshot: SellSessionSnapshot): boolean {
      return isSnapshotCurrent(snapshot);
    },
    storageFor(snapshot: SellSessionSnapshot): SellChargeStorage | null {
      if (!isSnapshotCurrent(snapshot)) return null;
      const access = storageAccess();
      if (!access.storage) {
        if (isSnapshotCurrent(snapshot)) storageAccessFailed = true;
        return null;
      }
      return isSnapshotCurrent(snapshot) ? access.storage : null;
    },
    stageChargeHandoff,
    adoptChargeHandoff,
    finalizeChargeHandoff,
    refreshAccount,
  };
}

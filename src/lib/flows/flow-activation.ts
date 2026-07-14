export interface FlowActivationCoordinator {
  previousActive: boolean;
  nextActive: boolean;
  syncGateway: (active: boolean) => Promise<void>;
  persist: (active: boolean) => Promise<void>;
}

export class FlowActivationCompensationError extends Error {
  constructor(
    readonly mutationCause: unknown,
    readonly compensationCause: unknown,
  ) {
    super('Flow activation failed and gateway compensation also failed');
    this.name = 'FlowActivationCompensationError';
  }
}

/**
 * Keep gateway registration and the Hub flow row aligned.
 *
 * The reversible gateway operation happens first. If the authoritative Hub
 * write then fails, the gateway is restored to the exact previous state. The
 * caller must commit its local UI state only after this promise resolves.
 */
export async function coordinateFlowActivation({
  previousActive,
  nextActive,
  syncGateway,
  persist,
}: FlowActivationCoordinator): Promise<void> {
  await syncGateway(nextActive);
  try {
    await persist(nextActive);
  } catch (mutationCause) {
    try {
      await syncGateway(previousActive);
    } catch (compensationCause) {
      throw new FlowActivationCompensationError(mutationCause, compensationCause);
    }
    throw mutationCause;
  }
}

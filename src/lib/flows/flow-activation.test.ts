import { describe, expect, it, vi } from 'vitest';
import { coordinateFlowActivation, FlowActivationCompensationError } from './flow-activation';

describe('coordinateFlowActivation', () => {
  it('does not persist when gateway registration fails', async () => {
    const gatewayError = new Error('gateway offline');
    const syncGateway = vi.fn().mockRejectedValue(gatewayError);
    const persist = vi.fn();

    await expect(
      coordinateFlowActivation({
        previousActive: false,
        nextActive: true,
        syncGateway,
        persist,
      }),
    ).rejects.toBe(gatewayError);

    expect(persist).not.toHaveBeenCalled();
    expect(syncGateway).toHaveBeenCalledTimes(1);
  });

  it('restores the gateway when the Hub write fails', async () => {
    const dbError = new Error('write rejected');
    const syncGateway = vi.fn().mockResolvedValue(undefined);
    const persist = vi.fn().mockRejectedValue(dbError);

    await expect(
      coordinateFlowActivation({
        previousActive: false,
        nextActive: true,
        syncGateway,
        persist,
      }),
    ).rejects.toBe(dbError);

    expect(syncGateway.mock.calls).toEqual([[true], [false]]);
  });

  it('surfaces a distinct error if compensation itself fails', async () => {
    const syncGateway = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('rollback offline'));

    await expect(
      coordinateFlowActivation({
        previousActive: true,
        nextActive: false,
        syncGateway,
        persist: vi.fn().mockRejectedValue(new Error('db offline')),
      }),
    ).rejects.toBeInstanceOf(FlowActivationCompensationError);

    expect(syncGateway.mock.calls).toEqual([[false], [true]]);
  });

  it('leaves both systems in the requested state on success', async () => {
    const order: string[] = [];
    await coordinateFlowActivation({
      previousActive: false,
      nextActive: true,
      syncGateway: async (active) => {
        order.push(`gateway:${active}`);
      },
      persist: async (active) => {
        order.push(`hub:${active}`);
      },
    });

    expect(order).toEqual(['gateway:true', 'hub:true']);
  });
});

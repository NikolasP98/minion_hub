/** Contact creation keeps a lost write separate from read/navigation recovery. */
export function createContactFlow(options: {
  owner: () => string;
  name: () => string;
  navigate: (id: string) => Promise<unknown>;
  refresh: () => Promise<unknown>;
  notify: (kind: 'unknown' | 'created' | 'error') => void;
}) {
  type Recovery = { kind: 'unknown' | 'created'; id?: string; reviewed?: boolean };
  let busy = $state(false);
  const recoveries = $state<Record<string, Recovery>>({});
  async function run() {
    if (busy) return;
    const owner = options.owner();
    const recovery = recoveries[owner];
    busy = true;
    let acknowledged = false;
    try {
      if (recovery?.kind === 'created' && recovery.id) {
        await options.navigate(recovery.id);
        return;
      }
      if (recovery && !recovery.reviewed) {
        await options.refresh();
        if (owner === options.owner()) {
          recoveries[owner] = { ...recovery, reviewed: true };
          options.notify(recovery.kind);
        }
        return;
      }
      // An explicitly reviewed new intent has its own uncertainty boundary.
      delete recoveries[owner];
      const response = await fetch('/api/crm/contacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: options.name() }),
      });
      if (response.ok) {
        acknowledged = true;
        recoveries[owner] = { kind: 'created' };
        const { contact } = await response.json();
        if (!contact || typeof contact.id !== 'string' || !contact.id.trim())
          throw new Error('Missing created contact identity');
        recoveries[owner] = { kind: 'created', id: contact.id };
        if (owner === options.owner()) await options.navigate(contact.id);
      } else if (response.status >= 500) {
        recoveries[owner] = { kind: 'unknown' };
        if (owner === options.owner()) options.notify('unknown');
      } else if (owner === options.owner()) options.notify('error');
    } catch {
      recoveries[owner] ??= { kind: acknowledged ? 'created' : 'unknown' };
      if (owner === options.owner()) options.notify(recoveries[owner].kind);
    } finally {
      busy = false;
    }
  }
  return {
    run,
    get busy() {
      return busy;
    },
    get recovery() {
      return recoveries[options.owner()] ?? null;
    },
  };
}

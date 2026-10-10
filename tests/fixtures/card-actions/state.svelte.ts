export const trace = $state({ events: [] as string[], unexpectedRequests: 0, submissions: 0 });
export const page = $state({
  status: 200,
  error: null,
  data: { permissions: { permissions: [] as string[] } },
  url: new URL('http://fixture.invalid'),
});
export function record(event: string) {
  trace.events.push(event);
}
export function resetTrace() {
  trace.events = [];
  trace.unexpectedRequests = 0;
  trace.submissions = 0;
}
const updatedAt = Date.parse('2026-10-03T12:00:00Z');
export const builderState = $state({
  agents: [
    {
      id: 'agent-a',
      name: 'Reception assistant',
      emoji: 'R',
      status: 'draft',
      description: 'Synthetic card for keyboard evidence',
      model: 'fixture',
      updatedAt,
    },
    {
      id: 'agent-b',
      name: 'Stock assistant',
      emoji: 'S',
      status: 'published',
      description: null,
      model: null,
      updatedAt,
    },
  ],
  skills: [
    {
      id: 'skill-a',
      name: 'Appointment follow-up',
      emoji: 'A',
      status: 'draft',
      description: 'Synthetic skill',
      updatedAt,
    },
    {
      id: 'skill-b',
      name: 'Stock summary',
      emoji: 'S',
      status: 'published',
      description: null,
      updatedAt,
    },
  ],
});
export const saves = [
  {
    id: 'workspace-a',
    name: 'Reception workspace',
    updatedAt,
    thumbnail: null,
    agentCount: 2,
    elementCount: 3,
  },
  {
    id: 'workspace-b',
    name: 'Stock workspace',
    updatedAt,
    thumbnail:
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225" viewBox="0 0 400 225"><rect width="400" height="225" fill="%230f172a"/><text x="24" y="110" fill="white" font-family="sans-serif" font-size="20">Synthetic workspace thumbnail</text></svg>'.replace(
          '%23',
          '#',
        ),
      ),
    agentCount: 1,
    elementCount: 2,
  },
];
export async function listWorkspaceSaves() {
  return [...saves];
}
export async function createBlankSave() {
  record('create');
  return 'workspace-new';
}
export async function openSave(id: string) {
  record(`open:${id}`);
  return true;
}
export function persistActiveSaveId(id: string) {
  record(`persist:${id}`);
}
export async function deleteWorkspaceSave(id: string) {
  record(`delete:${id}`);
}

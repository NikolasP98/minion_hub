<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import AiApproval from '$lib/components/ai/AiApproval.svelte';

  const options = [
    { id: 'send', label: 'Send the reminder now', detail: '14 recipients' },
    { id: 'later', label: 'Schedule for tomorrow 09:00', detail: 'Mon 10 Nov' },
    { id: 'skip', label: 'Do not send', destructive: true },
  ];
  const longQuestion =
    'The agent found 14 bookings next week whose contacts have no confirmation on record. It wants to send each of them a WhatsApp reminder from the clinic number, in Spanish, using the standard template with the practitioner name and arrival time. Two of the contacts opted out of marketing messages but not of appointment notices. How should it proceed?';

  const { Story } = defineMeta({
    title: 'AI/AiApproval',
    component: AiApproval,
    tags: ['autodocs'],
    args: { question: 'Send 14 appointment reminders?', options, onDecide: fn() },
  });
</script>

<Story name="Pending" />
<Story name="Approved resolved" args={{ resolvedId: 'send' }} />
<Story name="Rejected destructive resolved" args={{ resolvedId: 'skip' }} />
<Story name="Expired read only no onDecide" args={{ onDecide: undefined }} />
<Story name="No question bubble asked it" args={{ question: undefined }} />
<Story name="Long description" args={{ question: longQuestion }} />
<Story name="Two options" args={{ options: options.slice(0, 2) }} />
<Story
  name="Many options"
  args={{
    options: Array.from({ length: 8 }, (_, i) => ({ id: `o${i}`, label: `Option ${i + 1}: ${['merge', 'skip', 'rename', 'archive'][i % 4]} the duplicate`, detail: i % 2 ? `${i * 3} rows` : undefined })),
  }}
/>

<Story name="With extra context children">
  {#snippet template(args)}
    <AiApproval {...args}>
      <ul class="list-disc pl-4 text-caption text-text-secondary">
        <li>Template: appointment-reminder-es</li>
        <li>Sender: clinic WhatsApp (+51 ···)</li>
        <li>Two contacts opted out of marketing only</li>
      </ul>
    </AiApproval>
  {/snippet}
</Story>

<Story name="Narrow host">
  {#snippet template(args)}<div class="w-64"><AiApproval {...args} question={longQuestion} /></div>{/snippet}
</Story>

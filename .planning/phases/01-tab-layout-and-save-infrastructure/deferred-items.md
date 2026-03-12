# Deferred Items

## Pre-existing type errors in ChannelsTab.svelte

Found during: 01-02 Task 1 (check run)
Files: `src/lib/components/channels/ChannelsTab.svelte`

Errors: Missing properties `bot`, `application`, `self`, `tokenSource`, `dmPolicy` on the channel status type.
These errors existed before plan 01-02 execution and are unrelated to the save/restart UX changes.
Not introduced by any changes in this plan.

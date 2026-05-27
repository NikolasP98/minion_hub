/**
 * Channel-plugin link UI contract.
 *
 * Mirrors the gateway's `channels.plugins.list` RPC response (defined in the
 * gateway repo at src/plugins/channel-link.ts + server-methods/channels-plugins.ts).
 * The wire format is plain JSON, so this type is duplicated rather than shared
 * via @minion-stack/shared — that package is consumed as a published version by
 * both hub and gateway, and bumping it would require a release cycle. Keep this
 * in sync with the gateway contract.
 */

export type ChannelLinkField = {
  key: string;
  label: string;
  type: 'text' | 'password';
  placeholder?: string;
  required?: boolean;
};

export type ChannelLinkDescriptor =
  | {
      mode: 'qr';
      startMethod: string;
      qrEvent: string;
      pairedEvent: string;
      failedEvent: string;
      instructions?: string;
    }
  | { mode: 'form'; fields: ChannelLinkField[]; submitMethod: string; submitLabel?: string }
  | { mode: 'iframe'; entrypoint: string }
  | { mode: 'managed'; settingsHref?: string; note?: string };

export type ChannelPluginInfo = {
  pluginId: string;
  channelType: string;
  label: string;
  description?: string;
  icon?: string;
  link: ChannelLinkDescriptor;
};

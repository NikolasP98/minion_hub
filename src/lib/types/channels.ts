export type ChannelType = 'discord' | 'whatsapp' | 'telegram';
export type ChannelStatus = 'active' | 'inactive' | 'pairing';
export type AssignmentTarget = 'user' | 'session';

export interface Channel {
  id: string;
  serverId: string;
  type: ChannelType;
  label: string;
  credentials?: Record<string, string>;
  credentialsMeta: Record<string, string>;
  status: ChannelStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ChannelAssignment {
  id: string;
  channelId: string;
  targetType: AssignmentTarget;
  targetId: string;
  targetLabel?: string;
  createdAt: number;
}

export interface ChannelFieldDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'qr';
  required: boolean;
  placeholder?: string;
  help?: string;
}

export const CHANNEL_FIELDS: Record<ChannelType, ChannelFieldDef[]> = {
  discord: [
    { key: 'token', label: 'Bot Token', type: 'password', required: true, placeholder: 'Discord bot token' },
    { key: 'appId', label: 'Application ID', type: 'text', required: true, placeholder: 'Discord application ID' },
    { key: 'publicKey', label: 'Public Key', type: 'text', required: false, placeholder: 'Interaction verification key' },
    { key: 'username', label: 'Bot Username', type: 'text', required: false, placeholder: 'MyBot#1234', help: 'Display name (not encrypted)' },
  ],
  whatsapp: [
    { key: 'qr', label: 'QR Pairing', type: 'qr', required: false, help: 'Pair via QR code from the gateway' },
  ],
  telegram: [
    { key: 'botToken', label: 'Bot Token', type: 'password', required: true, placeholder: '123456:ABC-DEF...' },
  ],
};

export const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
  discord: 'Discord',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
};

export const CHANNEL_TYPE_ICONS: Record<ChannelType, string> = {
  discord: 'MessageSquare',
  whatsapp: 'Smartphone',
  telegram: 'Send',
};

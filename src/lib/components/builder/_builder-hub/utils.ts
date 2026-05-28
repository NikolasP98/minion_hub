export function formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `edited ${days}d ago`;
    if (hours > 0) return `edited ${hours}h ago`;
    if (minutes > 0) return `edited ${minutes}m ago`;
    return 'edited just now';
}

export function toolEmoji(tool: { id: string; mcpExport?: boolean }): string {
    if (tool.mcpExport) return '🔌';
    const id = tool.id;
    if (id.includes('browser')) return '🌐';
    if (id.includes('web-search')) return '🔍';
    if (id.includes('web-fetch')) return '📡';
    if (id.includes('memory')) return '🧠';
    if (id.includes('image')) return '🖼️';
    if (id.includes('file') || id.includes('fs')) return '📁';
    if (id.includes('code') || id.includes('exec')) return '💻';
    if (id.includes('shell') || id.includes('bash')) return '🐚';
    if (id.includes('db') || id.includes('sql')) return '🗄️';
    if (id.includes('email') || id.includes('mail')) return '📧';
    if (id.includes('calendar')) return '📅';
    return '🔧';
}

export function toolDescription(tool: { groups: string[]; requires?: { env?: string[] } }): string {
    const parts: string[] = [];
    if (tool.groups.length > 0) {
        parts.push(tool.groups.map(g => g.replace('group:', '')).join(', '));
    }
    if (tool.requires?.env?.length) {
        parts.push(`needs: ${tool.requires.env.join(', ')}`);
    }
    return parts.join(' · ') || 'Gateway tool';
}

export interface UnifiedTool {
    id: string;
    name: string;
    description: string;
    source: 'gateway' | 'custom';
    enabled?: boolean;
    status?: string;
    scriptLang?: string;
    updatedAt?: number;
    mcpExport?: boolean;
    multi?: boolean;
    optional?: boolean;
    groups?: string[];
}

import { describe, it, expect } from 'vitest';
import { deriveOrigin } from './event-origin';

describe('deriveOrigin', () => {
	it('prefers explicit gateway-stamped fields', () => {
		expect(deriveOrigin('agent:main:telegram:dm:1', 'whatsapp', 'channel')).toEqual({
			channel: 'whatsapp',
			source: 'channel',
		});
	});

	it('derives a channel from the session key', () => {
		expect(deriveOrigin('agent:renzo:telegram:dm:123')).toEqual({ channel: 'telegram', source: 'channel' });
		expect(deriveOrigin('agent:main:whatsapp:group:42')).toEqual({ channel: 'whatsapp', source: 'channel' });
		expect(deriveOrigin('agent:main:slack:channel:C1')).toEqual({ channel: 'slack', source: 'channel' });
	});

	it('classifies cron as proactive/system', () => {
		expect(deriveOrigin('agent:main:cron:job:run:7')).toEqual({ channel: 'cron', source: 'system' });
	});

	it('classifies subagent / acp as inter-agent', () => {
		expect(deriveOrigin('agent:main:subagent:x')).toEqual({ channel: 'subagent', source: 'agent' });
		expect(deriveOrigin('agent:main:acp:abc')).toEqual({ channel: 'acp', source: 'agent' });
	});

	it('treats main/default as direct/unknown', () => {
		expect(deriveOrigin('agent:main:main')).toEqual({ channel: 'direct', source: 'unknown' });
	});

	it('falls back to direct/unknown with no usable input', () => {
		expect(deriveOrigin(undefined)).toEqual({ channel: 'direct', source: 'unknown' });
		expect(deriveOrigin('')).toEqual({ channel: 'direct', source: 'unknown' });
	});

	it('uses derived channel when only source is explicit (and vice versa)', () => {
		expect(deriveOrigin('agent:main:discord:dm:9', undefined, 'channel').channel).toBe('discord');
		expect(deriveOrigin('agent:main:cron:x', 'cron', undefined).source).toBe('system');
	});
});

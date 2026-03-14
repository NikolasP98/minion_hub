import { describe, it, expect } from 'vitest';
import {
	FRAME_YJS_SYNC,
	FRAME_YJS_AWARENESS,
	FRAME_POSITION_BROADCAST,
	FRAME_DRAG_LOCK,
	encodeYjsBinaryFrame,
	decodeYjsBinaryFrame,
} from './yjs-binary-protocol';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const te = new TextEncoder();

function payload(...bytes: number[]): Uint8Array {
	return new Uint8Array(bytes);
}

// ---------------------------------------------------------------------------
// Frame type constants
// ---------------------------------------------------------------------------

describe('frame type constants', () => {
	it('FRAME_YJS_SYNC is 0x00', () => {
		expect(FRAME_YJS_SYNC).toBe(0x00);
	});

	it('FRAME_YJS_AWARENESS is 0x01', () => {
		expect(FRAME_YJS_AWARENESS).toBe(0x01);
	});

	it('FRAME_POSITION_BROADCAST is 0x02', () => {
		expect(FRAME_POSITION_BROADCAST).toBe(0x02);
	});

	it('FRAME_DRAG_LOCK is 0x03', () => {
		expect(FRAME_DRAG_LOCK).toBe(0x03);
	});
});

// ---------------------------------------------------------------------------
// Roundtrip encode → decode
// ---------------------------------------------------------------------------

describe('roundtrip encode → decode', () => {
	const frameTypes = [
		{ name: 'FRAME_YJS_SYNC', value: FRAME_YJS_SYNC },
		{ name: 'FRAME_YJS_AWARENESS', value: FRAME_YJS_AWARENESS },
		{ name: 'FRAME_POSITION_BROADCAST', value: FRAME_POSITION_BROADCAST },
		{ name: 'FRAME_DRAG_LOCK', value: FRAME_DRAG_LOCK },
	];

	for (const { name, value } of frameTypes) {
		it(`roundtrips ${name} (0x${value.toString(16).padStart(2, '0')})`, () => {
			const roomId = 'workshop:test-room-123';
			const data = payload(0xde, 0xad, 0xbe, 0xef);

			const encoded = encodeYjsBinaryFrame(value, roomId, data);
			const decoded = decodeYjsBinaryFrame(encoded);

			expect(decoded.type).toBe(value);
			expect(decoded.roomId).toBe(roomId);
			expect(decoded.payload).toEqual(data);
		});
	}
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
	it('handles empty payload', () => {
		const roomId = 'workshop:empty';
		const data = new Uint8Array(0);

		const encoded = encodeYjsBinaryFrame(FRAME_YJS_SYNC, roomId, data);
		const decoded = decodeYjsBinaryFrame(encoded);

		expect(decoded.type).toBe(FRAME_YJS_SYNC);
		expect(decoded.roomId).toBe(roomId);
		expect(decoded.payload.byteLength).toBe(0);
	});

	it('handles long room ID (64 chars)', () => {
		const roomId = 'workshop:' + 'x'.repeat(55); // 64 chars total
		expect(roomId.length).toBe(64);

		const data = payload(0x01, 0x02, 0x03);

		const encoded = encodeYjsBinaryFrame(FRAME_YJS_AWARENESS, roomId, data);
		const decoded = decodeYjsBinaryFrame(encoded);

		expect(decoded.type).toBe(FRAME_YJS_AWARENESS);
		expect(decoded.roomId).toBe(roomId);
		expect(decoded.payload).toEqual(data);
	});

	it('handles unicode room ID with multi-byte UTF-8 characters', () => {
		const roomId = 'workshop:测试-αβγ';
		const data = payload(0xff);

		const encoded = encodeYjsBinaryFrame(FRAME_POSITION_BROADCAST, roomId, data);
		const decoded = decodeYjsBinaryFrame(encoded);

		expect(decoded.type).toBe(FRAME_POSITION_BROADCAST);
		expect(decoded.roomId).toBe(roomId);
		expect(decoded.payload).toEqual(data);

		// The roomIdLen in the frame should reflect UTF-8 byte length, not JS string length
		const roomIdByteLen = te.encode(roomId).byteLength;
		expect(roomIdByteLen).toBeGreaterThan(roomId.length); // multi-byte chars
		const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
		expect(view.getUint32(1, true)).toBe(roomIdByteLen);
	});

	it('handles large payload (1 MB)', () => {
		const roomId = 'workshop:large';
		const data = new Uint8Array(1024 * 1024); // 1 MB
		// Fill with a pattern so we can verify integrity
		for (let i = 0; i < data.length; i++) {
			data[i] = i & 0xff;
		}

		const encoded = encodeYjsBinaryFrame(FRAME_DRAG_LOCK, roomId, data);
		const decoded = decodeYjsBinaryFrame(encoded);

		expect(decoded.type).toBe(FRAME_DRAG_LOCK);
		expect(decoded.roomId).toBe(roomId);
		expect(decoded.payload.byteLength).toBe(1024 * 1024);
		expect(decoded.payload).toEqual(data);
	});
});

// ---------------------------------------------------------------------------
// Decode error handling
// ---------------------------------------------------------------------------

describe('decode error handling', () => {
	it('throws on data shorter than 5 bytes', () => {
		expect(() => decodeYjsBinaryFrame(new Uint8Array(0))).toThrow(
			/too short.*expected at least 5 bytes.*got 0/i,
		);

		expect(() => decodeYjsBinaryFrame(new Uint8Array(4))).toThrow(
			/too short.*expected at least 5 bytes.*got 4/i,
		);
	});

	it('does not throw on exactly 5 bytes with roomIdLen=0', () => {
		// type=0, roomIdLen=0 (4 zero bytes), no payload — valid minimal frame
		const frame = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00]);
		const decoded = decodeYjsBinaryFrame(frame);

		expect(decoded.type).toBe(0);
		expect(decoded.roomId).toBe('');
		expect(decoded.payload.byteLength).toBe(0);
	});

	it('throws when roomIdLen exceeds available data', () => {
		// Craft a frame where roomIdLen=100 but total data is only 10 bytes
		const buf = new Uint8Array(10);
		const view = new DataView(buf.buffer);
		buf[0] = FRAME_YJS_SYNC;
		view.setUint32(1, 100, true); // claim 100 bytes for roomId

		expect(() => decodeYjsBinaryFrame(buf)).toThrow(
			/too short for roomId.*need 105 bytes.*got 10/i,
		);
	});
});

// ---------------------------------------------------------------------------
// Binary layout verification
// ---------------------------------------------------------------------------

describe('binary layout', () => {
	it('produces the exact expected byte layout', () => {
		const type = FRAME_YJS_AWARENESS; // 0x01
		const roomId = 'AB'; // 2 ASCII bytes: 0x41, 0x42
		const data = payload(0xca, 0xfe);

		const encoded = encodeYjsBinaryFrame(type, roomId, data);

		// Expected layout:
		// [0x01] [0x02, 0x00, 0x00, 0x00] [0x41, 0x42] [0xCA, 0xFE]
		//  type   roomIdLen=2 (LE uint32)   "AB"          payload
		const expected = new Uint8Array([
			0x01,                   // type
			0x02, 0x00, 0x00, 0x00, // roomIdLen = 2, little-endian
			0x41, 0x42,             // roomId "AB"
			0xca, 0xfe,             // payload
		]);

		expect(encoded).toEqual(expected);
		expect(encoded.byteLength).toBe(9); // 1 + 4 + 2 + 2
	});

	it('encodes roomIdLen as little-endian uint32', () => {
		// Use a roomId whose byte length is 0x0100 (256) to verify endianness
		const roomId = 'a'.repeat(256);
		const data = new Uint8Array(0);

		const encoded = encodeYjsBinaryFrame(FRAME_YJS_SYNC, roomId, data);
		// Bytes at offset 1..4 should be [0x00, 0x01, 0x00, 0x00] for 256 in LE
		expect(encoded[1]).toBe(0x00);
		expect(encoded[2]).toBe(0x01);
		expect(encoded[3]).toBe(0x00);
		expect(encoded[4]).toBe(0x00);
	});
});

/**
 * Binary frame protocol for Yjs collaboration over the existing WebSocket.
 *
 * Binary messages are distinguished from JSON text frames because the `ws`
 * library delivers them as `Buffer` (server) / `ArrayBuffer` (browser)
 * vs text as `string`.
 *
 * Frame layout:
 *   [type: 1 byte] [roomIdLen: 4 bytes uint32 LE] [roomId: utf-8] [payload: rest]
 */

// ---------------------------------------------------------------------------
// Frame type constants
// ---------------------------------------------------------------------------

/** Yjs sync message (y-protocols sync step1 / step2 / update) */
export const FRAME_YJS_SYNC = 0x00;
/** Yjs awareness update */
export const FRAME_YJS_AWARENESS = 0x01;
/** Workshop position broadcast (host → guests agent positions) */
export const FRAME_POSITION_BROADCAST = 0x02;
/** Drag-lock acquire / release */
export const FRAME_DRAG_LOCK = 0x03;

// ---------------------------------------------------------------------------
// Shared encoder / decoder instances
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * Encode a binary frame for transmission over WebSocket.
 *
 * @param type    - One of the FRAME_* constants
 * @param roomId  - Room identifier (e.g. "workshop:abc123")
 * @param payload - Raw bytes (Yjs update, awareness, or position data)
 * @returns A single `Uint8Array` ready to send as a binary WS message
 */
export function encodeYjsBinaryFrame(
	type: number,
	roomId: string,
	payload: Uint8Array,
): Uint8Array {
	const roomIdBytes = textEncoder.encode(roomId);
	const roomIdLen = roomIdBytes.byteLength;

	// 1 (type) + 4 (roomIdLen) + roomIdLen + payload.byteLength
	const buf = new Uint8Array(1 + 4 + roomIdLen + payload.byteLength);
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

	buf[0] = type;
	view.setUint32(1, roomIdLen, true); // little-endian
	buf.set(roomIdBytes, 5);
	buf.set(payload, 5 + roomIdLen);

	return buf;
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decode a binary frame received from the WebSocket.
 *
 * @param data - Raw bytes received (Uint8Array, Buffer, or ArrayBuffer-backed)
 * @returns Parsed frame with `type`, `roomId`, and `payload`
 * @throws If the buffer is too short to contain a valid frame header
 */
export function decodeYjsBinaryFrame(data: Uint8Array): {
	type: number;
	roomId: string;
	payload: Uint8Array;
} {
	if (data.byteLength < 5) {
		throw new Error(
			`Binary frame too short: expected at least 5 bytes, got ${data.byteLength}`,
		);
	}

	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

	const type = data[0];
	const roomIdLen = view.getUint32(1, true); // little-endian

	const headerLen = 5 + roomIdLen;
	if (data.byteLength < headerLen) {
		throw new Error(
			`Binary frame too short for roomId: need ${headerLen} bytes, got ${data.byteLength}`,
		);
	}

	const roomId = textDecoder.decode(data.subarray(5, 5 + roomIdLen));
	const payload = data.subarray(headerLen);

	return { type, roomId, payload };
}

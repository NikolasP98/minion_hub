import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { sendBinary, onBinaryMessage, sendRequest, isWsReady } from '$lib/services/gateway.svelte';
import {
	encodeYjsBinaryFrame,
	decodeYjsBinaryFrame,
	FRAME_YJS_SYNC,
	FRAME_YJS_AWARENESS,
} from './yjs-binary-protocol';

/**
 * Custom Yjs provider that syncs through the gateway WebSocket binary channel.
 */
export class GatewayYjsProvider {
	readonly doc: Y.Doc;
	readonly awareness: awarenessProtocol.Awareness;
	private roomId: string;
	private synced = false;
	private unsubBinary: (() => void) | null = null;
	private unsubDocUpdate: (() => void) | null = null;
	private unsubAwareness: (() => void) | null = null;

	constructor(doc: Y.Doc, roomId: string) {
		this.doc = doc;
		this.roomId = roomId;
		this.awareness = new awarenessProtocol.Awareness(doc);
	}

	/** Connect to the gateway room and start syncing. */
	async connect(): Promise<void> {
		// Join the room via JSON request
		await sendRequest('workshop.join', { roomId: this.roomId });

		// Listen for incoming binary frames
		this.unsubBinary = onBinaryMessage((data) => {
			this.handleBinaryMessage(data);
		});

		// Listen for local doc updates and send them to the gateway
		const updateHandler = (update: Uint8Array, origin: unknown) => {
			if (origin === this) return; // Don't echo our own remote updates
			this.sendSyncUpdate(update);
		};
		this.doc.on('update', updateHandler);
		this.unsubDocUpdate = () => this.doc.off('update', updateHandler);

		// Listen for local awareness changes and broadcast them
		const awarenessHandler = (
			{ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
			origin: unknown,
		) => {
			if (origin === 'remote') return;
			const changedClients = [...added, ...updated, ...removed];
			const encodedUpdate = awarenessProtocol.encodeAwarenessUpdate(
				this.awareness,
				changedClients,
			);
			const frame = encodeYjsBinaryFrame(FRAME_YJS_AWARENESS, this.roomId, encodedUpdate);
			sendBinary(frame);
		};
		this.awareness.on('change', awarenessHandler);
		this.unsubAwareness = () => this.awareness.off('change', awarenessHandler);

		// Send sync step 1 to initiate the handshake
		this.sendSyncStep1();
	}

	/** Disconnect from the room and clean up. */
	async disconnect(): Promise<void> {
		if (this.unsubBinary) {
			this.unsubBinary();
			this.unsubBinary = null;
		}
		if (this.unsubDocUpdate) {
			this.unsubDocUpdate();
			this.unsubDocUpdate = null;
		}
		if (this.unsubAwareness) {
			this.unsubAwareness();
			this.unsubAwareness = null;
		}

		// Clear local awareness
		awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], null);

		// Leave the room
		if (isWsReady()) {
			try {
				await sendRequest('workshop.leave', { roomId: this.roomId });
			} catch { /* ignore */ }
		}

		this.synced = false;
	}

	get isSynced(): boolean {
		return this.synced;
	}

	// ─── Internal ────────────────────────────────────────────────────────

	private handleBinaryMessage(data: Uint8Array): void {
		let frame: ReturnType<typeof decodeYjsBinaryFrame>;
		try {
			frame = decodeYjsBinaryFrame(data);
		} catch {
			return;
		}

		// Only handle frames for our room
		if (frame.roomId !== this.roomId) return;

		switch (frame.type) {
			case FRAME_YJS_SYNC:
				this.handleSyncMessage(frame.payload);
				break;
			case FRAME_YJS_AWARENESS:
				this.handleAwarenessMessage(frame.payload);
				break;
		}
	}

	private handleSyncMessage(payload: Uint8Array): void {
		const decoder = decoding.createDecoder(payload);
		const encoder = encoding.createEncoder();

		const messageType = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);

		// messageType 0 = sync step 1 from server
		// messageType 1 = sync step 2 — we are now synced
		if (messageType === 1) {
			this.synced = true;
		}

		// If there's a response, send it back
		if (encoding.length(encoder) > 0) {
			const response = encoding.toUint8Array(encoder);
			const frame = encodeYjsBinaryFrame(FRAME_YJS_SYNC, this.roomId, response);
			sendBinary(frame);
		}
	}

	private handleAwarenessMessage(payload: Uint8Array): void {
		awarenessProtocol.applyAwarenessUpdate(this.awareness, payload, 'remote');
	}

	private sendSyncStep1(): void {
		const encoder = encoding.createEncoder();
		syncProtocol.writeSyncStep1(encoder, this.doc);
		const payload = encoding.toUint8Array(encoder);
		const frame = encodeYjsBinaryFrame(FRAME_YJS_SYNC, this.roomId, payload);
		sendBinary(frame);
	}

	private sendSyncUpdate(update: Uint8Array): void {
		const encoder = encoding.createEncoder();
		syncProtocol.writeUpdate(encoder, update);
		const payload = encoding.toUint8Array(encoder);
		const frame = encodeYjsBinaryFrame(FRAME_YJS_SYNC, this.roomId, payload);
		sendBinary(frame);
	}
}

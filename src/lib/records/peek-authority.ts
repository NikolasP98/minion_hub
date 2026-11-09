/** Raw record data in browser history belongs to one document and authority. */
const documentNonces = new WeakMap<Document, string>();

export function peekAuthorityKey(owner: string | null, generation: string): string | null {
  if (
    !owner ||
    typeof document === 'undefined' ||
    document.documentElement.hasAttribute('data-authority-retiring')
  )
    return null;
  let nonce = documentNonces.get(document);
  if (!nonce) {
    nonce = crypto.randomUUID();
    documentNonces.set(document, nonce);
  }
  return JSON.stringify([nonce, owner, generation]);
}

/** Invalidate pending preloads and every historical raw payload in this VM. */
export function retireRecordPeeks(): void {
  if (typeof document !== 'undefined') documentNonces.delete(document);
}

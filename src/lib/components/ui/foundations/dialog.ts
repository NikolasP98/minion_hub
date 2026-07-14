export function assertDialogLabel(title?: string, labelledBy?: string): void {
  if (!title && !labelledBy) {
    throw new Error('Dialog requires a title or labelledBy reference.');
  }
}

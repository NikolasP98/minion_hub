/** One publication per authenticated socket, including a backup promoted after hello. */
export class AuthenticatedSession<T> {
  private hello: T | null = null;
  private generation = 0;
  private published = -1;

  constructor(
    private readonly owns: () => boolean,
    private readonly publish: (hello: T, current: () => boolean) => void,
  ) {}

  authenticated(hello: T): void {
    this.generation++;
    this.hello = hello;
    this.activate();
  }

  get ready(): boolean {
    return this.hello !== null;
  }

  /** A backup's resolved connect promise alone does not prove its socket is still live. */
  activate(): boolean {
    if (this.hello === null || !this.owns()) return false;
    if (this.published !== this.generation) {
      this.published = this.generation;
      this.publish(this.hello, this.capture());
    }
    return true;
  }

  capture(): () => boolean {
    const generation = this.generation;
    return () => this.hello !== null && generation === this.generation && this.owns();
  }

  closed(): void {
    this.generation++;
    this.hello = null;
  }
}

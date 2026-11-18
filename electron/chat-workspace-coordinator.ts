/** Main-owned FIFO for complete workspace read-transform-save operations. */
export class ChatWorkspaceCoordinator {
  private tail: Promise<void> = Promise.resolve()

  runExclusive<T>(operation: () => Promise<T> | T): Promise<T> {
    const next = this.tail.then(operation, operation)
    this.tail = next.then(() => undefined, () => undefined)
    return next
  }

  async idle(): Promise<void> {
    await this.tail
  }
}

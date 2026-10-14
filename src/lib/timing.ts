/**
 * How long the app waits, in one place: for typing to pause before looking
 * a food up online, between polls of a running lookup, and before each
 * further try of a read that got no reply. Tests shorten these (see
 * src/test/setup.ts) instead of sitting through them.
 */
export const TIMING = {
  /**
   * Typing has paused: look the query up online without a button press.
   * Longer than the database search's pause: a lookup occupies the model
   * for a minute or two, so it shouldn't fire on a half-typed "chipotle chi".
   */
  autoLookupMs: 2000,
  /** How often to ask after a running online lookup. */
  pollMs: 2000,
  /** Before each further try of a read that got no reply. */
  retryWaitsMs: [200, 500, 1200] as readonly number[],
}

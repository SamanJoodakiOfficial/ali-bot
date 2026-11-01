// Telegram getUpdates long polling; downgrade to short polling if the network
// repeatedly drops idle connections. HTTP errors (401/409/etc.) must never
// trigger a fallback, because they require a different remedy.
export class AdaptivePolling {
  constructor(seconds = 5) {
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 25) throw new RangeError('poll seconds');
    this.seconds = seconds;
    this.networkFailures = 0;
  }
  get requestTimeoutMs() { return (this.seconds + 12) * 1000; }
  get isShort() { return this.seconds === 0; }
  success() { this.networkFailures = 0; }
  failure(error) {
    if (!error?.isNetworkFailure) {
      this.networkFailures = 0;
      return false;
    }
    this.networkFailures++;
    if (this.seconds > 0 && this.networkFailures >= 2) {
      this.seconds = 0;
      this.networkFailures = 0;
      return true;
    }
    return false;
  }
}

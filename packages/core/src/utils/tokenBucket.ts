export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly rate: number;
  private readonly capacity: number;

  constructor(ratePerSecond: number) {
    this.rate = ratePerSecond;
    this.capacity = ratePerSecond;
    this.tokens = ratePerSecond;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.rate);
    this.lastRefill = now;

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    const waitTime = (1 - this.tokens) / this.rate * 1000;
    await new Promise(resolve => setTimeout(resolve, waitTime));
    this.tokens = 0;
    this.lastRefill = Date.now();
  }
}

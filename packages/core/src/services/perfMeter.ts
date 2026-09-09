export interface PerfSample {
  count: number;
  sumMs: number;
  avgMs: number;
  maxMs: number;
}

export class PerfMeter {
  private readonly samples = new Map<string, number[]>();
  private readonly order: string[] = [];

  add(label: string, ms: number): void {
    let arr = this.samples.get(label);
    if (!arr) {
      arr = [];
      this.samples.set(label, arr);
      this.order.push(label);
    }
    arr.push(ms);
  }

  async trace<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      this.add(label, Date.now() - start);
    }
  }

  merge(other: PerfMeter): void {
    for (const label of other.order) {
      const arr = other.samples.get(label);
      if (arr) {
        for (const ms of arr) {
          this.add(label, ms);
        }
      }
    }
  }

  summary(): Record<string, PerfSample> {
    const out: Record<string, PerfSample> = {};
    for (const label of this.order) {
      const arr = this.samples.get(label) ?? [];
      let sum = 0;
      let max = 0;
      for (const v of arr) {
        sum += v;
        if (v > max) max = v;
      }
      out[label] = {
        count: arr.length,
        sumMs: sum,
        avgMs: arr.length ? Math.round(sum / arr.length) : 0,
        maxMs: max,
      };
    }
    return out;
  }
}
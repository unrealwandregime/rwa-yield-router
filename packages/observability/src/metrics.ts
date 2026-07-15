export type MetricLabels = Readonly<Record<string, string>>;

export interface Counter {
  add(value?: number, labels?: MetricLabels): void;
}

export interface Gauge {
  set(value: number, labels?: MetricLabels): void;
}

export interface Histogram {
  record(value: number, labels?: MetricLabels): void;
}

export interface Metrics {
  counter(name: string): Counter;
  gauge(name: string): Gauge;
  histogram(name: string): Histogram;
  snapshot(): ReadonlyArray<MetricPoint>;
}

export interface MetricPoint {
  readonly kind: "counter" | "gauge" | "histogram";
  readonly name: string;
  readonly labels: MetricLabels;
  readonly value: number;
  readonly count?: number;
}

function keyFor(name: string, labels: MetricLabels): string {
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([name, entries]);
}

export function createInMemoryMetrics(): Metrics {
  const counters = new Map<string, MetricPoint>();
  const gauges = new Map<string, MetricPoint>();
  const histograms = new Map<string, MetricPoint>();

  return {
    counter(name) {
      return {
        add(value = 1, labels = {}) {
          if (!Number.isFinite(value) || value < 0) {
            throw new RangeError("Counter increments must be finite and non-negative");
          }
          const key = keyFor(name, labels);
          const previous = counters.get(key);
          counters.set(key, {
            kind: "counter",
            name,
            labels,
            value: (previous?.value ?? 0) + value
          });
        }
      };
    },
    gauge(name) {
      return {
        set(value, labels = {}) {
          if (!Number.isFinite(value)) {
            throw new RangeError("Gauge values must be finite");
          }
          gauges.set(keyFor(name, labels), {
            kind: "gauge",
            name,
            labels,
            value
          });
        }
      };
    },
    histogram(name) {
      return {
        record(value, labels = {}) {
          if (!Number.isFinite(value) || value < 0) {
            throw new RangeError("Histogram values must be finite and non-negative");
          }
          const key = keyFor(name, labels);
          const previous = histograms.get(key);
          histograms.set(key, {
            kind: "histogram",
            name,
            labels,
            value: (previous?.value ?? 0) + value,
            count: (previous?.count ?? 0) + 1
          });
        }
      };
    },
    snapshot() {
      return [...counters.values(), ...gauges.values(), ...histograms.values()].sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          JSON.stringify(left.labels).localeCompare(JSON.stringify(right.labels))
      );
    }
  };
}

export function createNoopMetrics(): Metrics {
  const noop = (): void => undefined;
  return {
    counter: () => ({ add: noop }),
    gauge: () => ({ set: noop }),
    histogram: () => ({ record: noop }),
    snapshot: () => []
  };
}

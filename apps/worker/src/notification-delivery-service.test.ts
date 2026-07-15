import { describe, expect, it } from "vitest";

import {
  MAX_NOTIFICATION_DELIVERY_ATTEMPTS,
  notificationRetryDelaySeconds
} from "./notification-delivery-service.js";

describe("notification delivery retry policy", () => {
  it("uses deterministic bounded exponential backoff with per-delivery jitter", () => {
    const deliveryId = "25b2f631-fb2b-4d93-9097-14885f48646c";
    const delays = Array.from({ length: MAX_NOTIFICATION_DELIVERY_ATTEMPTS }, (_, index) =>
      notificationRetryDelaySeconds(deliveryId, index + 1)
    );

    expect(delays).toEqual([...delays].sort((left, right) => left - right));
    expect(delays.every((delay) => delay >= 60 && delay <= 3_600)).toBe(true);
    expect(notificationRetryDelaySeconds(deliveryId, 2)).toBe(
      notificationRetryDelaySeconds(deliveryId, 2)
    );
    expect(notificationRetryDelaySeconds("e8adf35b-917f-4f84-bd02-94df296056d0", 1)).not.toBe(
      notificationRetryDelaySeconds(deliveryId, 1)
    );
  });
});

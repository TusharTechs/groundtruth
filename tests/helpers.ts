import type { PhoneResult } from "@/lib/domain/types";

export function emptyPhoneResult(): PhoneResult {
  return {
    availability: null,
    quantity: null,
    compatibility: null,
    price: null,
    currency: "INR",
    pickup_available: null,
    pickup_time: null,
    hold_available: null,
    hold_confirmed: null,
    hold_until: null,
    notes: null,
  };
}

export function silenceConsole(fn: () => void): void {
  const log = console.log;
  console.log = () => {};
  try {
    fn();
  } finally {
    console.log = log;
  }
}

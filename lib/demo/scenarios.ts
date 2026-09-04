import type { PhoneResult, TranscriptTurn } from "@/lib/domain/types";

/**
 * Deterministic demo dataset (fictional suppliers, fictional numbers).
 *
 * Every number below is demo-fictional (+91 80 4711 00xx) and masked in the
 * UI anyway. Personas drive BOTH DemoCandidateProvider (discovery) and
 * MockCalleAdapter (scripted conversations), which is what makes the demo
 * narrative reproducible end-to-end.
 */

export interface MockAttemptScript {
  purpose: "verify" | "follow_up";
  /** Attempt number this script matches (1 = first call, 2 = follow-up). */
  attempt?: number;
  turns: TranscriptTurn[];
  result: PhoneResult;
  evidence: string[];
  completionConfidence: number;
  taskCompleted: boolean;
  summary: string;
  /** When set the call ends in failure (e.g. no answer). */
  failure?: { code: string; message: string };
}

export interface SupplierPersona {
  name: string;
  phone: string;
  region: string;
  locale: string;
  address: string;
  distanceKm: number;
  attempts: MockAttemptScript[];
}

export interface DemoScenario {
  id: string;
  title: string;
  description: string;
  sampleRequest: string;
  personas: SupplierPersona[];
}

const bot = (offsetSeconds: number, text: string): TranscriptTurn => ({
  offsetSeconds,
  speaker: "bot",
  text,
});
const user = (offsetSeconds: number, text: string): TranscriptTurn => ({
  offsetSeconds,
  speaker: "user",
  text,
});

const emptyResult: PhoneResult = {
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

const DISCLOSURE =
  "Hi, this is GroundTruth, an automated verification assistant calling on behalf of a buyer.";

// ---------------------------------------------------------------------------
// Metro Components — the flagship winner (with adaptive follow-up hold)
// ---------------------------------------------------------------------------

const metroVerify: MockAttemptScript = {
  purpose: "verify",
  attempt: 1,
  turns: [
    bot(0, `${DISCLOSURE} Am I speaking with Metro Components?`),
    user(4, "Yes, this is Metro Components. How can I help?"),
    bot(8, "Do you currently have a genuine XZ-420 compressor in stock?"),
    user(12, "Yes, we have two units right now."),
    bot(16, "Can you confirm it is compatible with the ACME HVAC-200?"),
    user(21, "Hmm, I am not sure about that."),
    bot(25, "Could you check the model compatibility for me before we finish?"),
    user(40, "One moment... yes, I checked our catalogue — the XZ-420 is listed as compatible with the HVAC-200."),
    bot(44, "Thank you. What is your best price for the XZ-420, including taxes?"),
    user(49, "Twenty-two thousand eight hundred rupees with GST."),
    bot(53, "Could I pick it up today?"),
    user(57, "Yes, you can collect any time before 4:30 PM."),
    bot(61, "One last request — could you hold one unit until 5 PM for pickup? To be clear, no purchase is being made on this call."),
    user(66, "We can hold it, but I need to confirm with my manager first."),
    bot(70, "Understood. Thank you for your help."),
  ],
  result: {
    ...emptyResult,
    availability: "confirmed",
    quantity: 2,
    compatibility: "confirmed",
    price: 22800,
    currency: "INR",
    pickup_available: true,
    pickup_time: "4:30 PM",
    hold_available: true,
    hold_confirmed: false,
    hold_until: null,
    notes: "Hold requires manager approval; the supplier asked to be called back.",
  },
  evidence: [
    "The supplier explicitly confirmed two XZ-420 units are currently in stock.",
    "The supplier checked the catalogue and confirmed the XZ-420 is compatible with the ACME HVAC-200.",
    "The supplier quoted a final price of ₹22,800 including GST.",
    "The supplier confirmed same-day pickup until 4:30 PM.",
    "The supplier said a hold is possible but requires manager confirmation.",
  ],
  completionConfidence: 0.93,
  taskCompleted: true,
  summary:
    "Metro Components has 2 compatible XZ-420 units at ₹22,800 incl. GST; pickup today until 4:30 PM; hold pending manager approval.",
};

const metroFollowUp: MockAttemptScript = {
  purpose: "follow_up",
  attempt: 2,
  turns: [
    bot(0, `${DISCLOSURE} This is a quick follow-up to our earlier call. May I ask whether the manager approved holding one XZ-420 compressor until 5 PM?`),
    user(6, "Yes, approved. We will hold one unit until 5 PM at the front desk."),
    bot(11, "Thank you. To confirm: no purchase is being made on this call, and the buyer will arrive before 5 PM."),
    user(15, "That is right. We will keep it at the front desk."),
  ],
  result: {
    ...emptyResult,
    availability: "confirmed",
    quantity: 2,
    compatibility: "confirmed",
    price: 22800,
    currency: "INR",
    pickup_available: true,
    pickup_time: "4:30 PM",
    hold_available: true,
    hold_confirmed: true,
    hold_until: "5 PM",
    notes: "Hold confirmed by manager; unit reserved at front desk until 5 PM.",
  },
  evidence: [
    "The supplier confirmed the manager approved holding one XZ-420 unit until 5 PM.",
  ],
  completionConfidence: 0.97,
  taskCompleted: true,
  summary: "Hold confirmed until 5 PM; unit reserved at the front desk.",
};

// Failure-scenario variant: Metro sold out this morning.
const metroSoldOut: MockAttemptScript = {
  purpose: "verify",
  attempt: 1,
  turns: [
    bot(0, `${DISCLOSURE} Am I speaking with Metro Components?`),
    user(4, "Yes, speaking."),
    bot(8, "Do you currently have a genuine XZ-420 compressor in stock?"),
    user(13, "No, I am afraid the last two units were sold this morning."),
    bot(17, "I see — do you expect new stock soon?"),
    user(21, "Next week, probably Tuesday."),
    bot(24, "Thank you, that is all I needed. No purchase is being made."),
  ],
  result: {
    ...emptyResult,
    availability: "not_available",
    notes: "Last two units sold this morning; next stock expected Tuesday.",
  },
  evidence: ["The supplier stated the last two XZ-420 units were sold this morning."],
  completionConfidence: 0.95,
  taskCompleted: true,
  summary: "Metro Components is out of stock; next delivery expected Tuesday.",
};

// ---------------------------------------------------------------------------
// Other suppliers (shared by both scenarios)
// ---------------------------------------------------------------------------

const anandUncertain: MockAttemptScript = {
  purpose: "verify",
  attempt: 1,
  turns: [
    bot(0, `${DISCLOSURE} Is this Anand Cool Point?`),
    user(4, "Yes, Anand Cool Point."),
    bot(8, "Do you currently have a genuine XZ-420 compressor in stock?"),
    user(14, "I think we have it, but I would need to check the store room."),
    bot(19, "Could you check now? It would settle the question today."),
    user(24, "I am the only one here right now, I cannot leave the counter. Call back tomorrow morning."),
    bot(28, "Understood — no purchase is being made. Thank you."),
  ],
  result: {
    ...emptyResult,
    availability: "uncertain",
    notes: "Staff could not check stock during the call; asked to call back tomorrow.",
  },
  evidence: [
    "The staff member said 'I think we have it' but could not verify stock during the call.",
  ],
  completionConfidence: 0.42,
  taskCompleted: true,
  summary: "Availability uncertain — staff could not check the store room.",
};

const kirloskarOutOfStock: MockAttemptScript = {
  purpose: "verify",
  attempt: 1,
  turns: [
    bot(0, `${DISCLOSURE} Is this Kirloskar Spare Parts?`),
    user(4, "Yes, Kirloskar Spare Parts, good morning."),
    bot(8, "Do you currently have a genuine XZ-420 compressor in stock?"),
    user(13, "No, we are out of stock right now."),
    bot(16, "Does another one of your branches have it, by any chance?"),
    user(21, "Our Whitefield branch might have it. You can try calling them."),
    bot(25, "Thank you — no purchase is being made. Goodbye."),
  ],
  result: {
    ...emptyResult,
    availability: "not_available",
    notes: "Out of stock at this branch; Whitefield branch may have stock.",
  },
  evidence: [
    "The supplier stated the XZ-420 is out of stock at their branch.",
    "The supplier suggested their Whitefield branch may have the unit.",
  ],
  completionConfidence: 0.94,
  taskCompleted: true,
  summary: "Out of stock; Whitefield branch possibly has stock.",
};

const bharatNoAnswer: MockAttemptScript = {
  purpose: "verify",
  attempt: 1,
  turns: [],
  result: { ...emptyResult },
  evidence: [],
  completionConfidence: 0,
  taskCompleted: false,
  summary: "No answer.",
  failure: {
    code: "no_answer",
    message: "No answer after 30 seconds; no voicemail left.",
  },
};

const cooltechIncompatible: MockAttemptScript = {
  purpose: "verify",
  attempt: 1,
  turns: [
    bot(0, `${DISCLOSURE} Is this CoolTech Refrigeration?`),
    user(4, "Yes, CoolTech. Go ahead."),
    bot(8, "Do you currently have a genuine XZ-420 compressor in stock, and is it compatible with the ACME HVAC-200?"),
    user(15, "We have the XZ-420B — that is the newer revision. It does not fit the HVAC-200 directly."),
    bot(20, "Just to confirm: the XZ-420B is not compatible with the HVAC-200?"),
    user(24, "Correct, you would need the original XZ-420 for that unit."),
    bot(27, "Thank you — no purchase is being made. Goodbye."),
  ],
  result: {
    ...emptyResult,
    availability: "confirmed",
    quantity: 1,
    compatibility: "not_compatible",
    price: 19500,
    currency: "INR",
    notes: "Only the XZ-420B revision in stock; not compatible with HVAC-200.",
  },
  evidence: [
    "The supplier only stocks the XZ-420B revision, which they confirmed is not compatible with the HVAC-200.",
  ],
  completionConfidence: 0.9,
  taskCompleted: true,
  summary: "Only incompatible XZ-420B revision in stock.",
};

const sriOverBudget: MockAttemptScript = {
  purpose: "verify",
  attempt: 1,
  turns: [
    bot(0, `${DISCLOSURE} Is this Sri Venkateshwara HVAC?`),
    user(4, "Yes, Sri Venkateshwara HVAC."),
    bot(8, "Do you currently have a genuine XZ-420 compressor in stock, and is it compatible with the ACME HVAC-200?"),
    user(16, "Yes, we have three units, all compatible with the HVAC-200."),
    bot(20, "What is your best price, including taxes?"),
    user(25, "Twenty-seven thousand five hundred rupees."),
    bot(28, "Could I pick it up today, and could you hold one unit until 5 PM?"),
    user(33, "Pickup today is fine. We can hold it until 5 PM, no problem."),
    bot(36, "Thank you — no purchase is being made. Goodbye."),
  ],
  result: {
    ...emptyResult,
    availability: "confirmed",
    quantity: 3,
    compatibility: "confirmed",
    price: 27500,
    currency: "INR",
    pickup_available: true,
    pickup_time: "6:00 PM",
    hold_available: true,
    hold_confirmed: true,
    hold_until: "5 PM",
    notes: "Everything available but above the ₹25,000 ceiling.",
  },
  evidence: [
    "The supplier confirmed three compatible units at ₹27,500 each, above the stated budget.",
    "The supplier confirmed a hold until 5 PM and same-day pickup.",
  ],
  completionConfidence: 0.92,
  taskCompleted: true,
  summary: "Compatible and in stock, but ₹27,500 exceeds the ₹25,000 budget.",
};

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export const FLAGSHIP_REQUEST =
  "Find a genuine XZ-420 compressor for an ACME HVAC-200 within 25 km. It must be compatible, available today, under ₹25,000, and the supplier must hold it until 5 PM. You may request a hold, but do not purchase anything.";

export const demoScenarios: DemoScenario[] = [
  {
    id: "compressor",
    title: "Emergency part sourcing (success path)",
    description:
      "The flagship scenario: an XZ-420 compressor is sourced, verified by phone with adaptive follow-ups, and held until 5 PM — with early stopping once a fully verified match exists.",
    sampleRequest: FLAGSHIP_REQUEST,
    personas: [
      {
        name: "Anand Cool Point",
        phone: "+918047110005",
        region: "IN",
        locale: "en-IN",
        address: "5th Block, Koramangala, Bengaluru",
        distanceKm: 9.3,
        attempts: [anandUncertain],
      },
      {
        name: "Kirloskar Spare Parts",
        phone: "+918047110002",
        region: "IN",
        locale: "en-IN",
        address: "Industrial Layout, Koramangala, Bengaluru",
        distanceKm: 12.1,
        attempts: [kirloskarOutOfStock],
      },
      {
        name: "Bharat Climate Control",
        phone: "+918047110006",
        region: "IN",
        locale: "en-IN",
        address: "AECS Layout, Brookefield, Bengaluru",
        distanceKm: 15.0,
        attempts: [bharatNoAnswer],
      },
      {
        name: "Metro Components",
        phone: "+918047110001",
        region: "IN",
        locale: "en-IN",
        address: "100 Feet Road, Indiranagar, Bengaluru",
        distanceKm: 18.4,
        attempts: [metroVerify, metroFollowUp],
      },
      {
        name: "CoolTech Refrigeration",
        phone: "+918047110003",
        region: "IN",
        locale: "en-IN",
        address: "Outer Ring Road, Marathahalli, Bengaluru",
        distanceKm: 22.7,
        attempts: [cooltechIncompatible],
      },
      {
        name: "Sri Venkateshwara HVAC",
        phone: "+918047110004",
        region: "IN",
        locale: "en-IN",
        address: "Sarjapur Road, Dommasandra, Bengaluru",
        distanceKm: 24.2,
        attempts: [sriOverBudget],
      },
    ],
  },
  {
    id: "compressor_failure",
    title: "Emergency part sourcing (honest failure path)",
    description:
      "Same request, different morning: every supplier fails a hard requirement (out of stock, incompatible, over budget, uncertain, unreachable). GroundTruth reports NO FULLY VERIFIED MATCH with the full breakdown — never a fake success.",
    sampleRequest: FLAGSHIP_REQUEST,
    personas: [
      {
        name: "Anand Cool Point",
        phone: "+918047110005",
        region: "IN",
        locale: "en-IN",
        address: "5th Block, Koramangala, Bengaluru",
        distanceKm: 9.3,
        attempts: [anandUncertain],
      },
      {
        name: "Kirloskar Spare Parts",
        phone: "+918047110002",
        region: "IN",
        locale: "en-IN",
        address: "Industrial Layout, Koramangala, Bengaluru",
        distanceKm: 12.1,
        attempts: [kirloskarOutOfStock],
      },
      {
        name: "Bharat Climate Control",
        phone: "+918047110006",
        region: "IN",
        locale: "en-IN",
        address: "AECS Layout, Brookefield, Bengaluru",
        distanceKm: 15.0,
        attempts: [bharatNoAnswer],
      },
      {
        name: "Metro Components",
        phone: "+918047110001",
        region: "IN",
        locale: "en-IN",
        address: "100 Feet Road, Indiranagar, Bengaluru",
        distanceKm: 18.4,
        attempts: [metroSoldOut],
      },
      {
        name: "CoolTech Refrigeration",
        phone: "+918047110003",
        region: "IN",
        locale: "en-IN",
        address: "Outer Ring Road, Marathahalli, Bengaluru",
        distanceKm: 22.7,
        attempts: [cooltechIncompatible],
      },
      {
        name: "Sri Venkateshwara HVAC",
        phone: "+918047110004",
        region: "IN",
        locale: "en-IN",
        address: "Sarjapur Road, Dommasandra, Bengaluru",
        distanceKm: 24.2,
        attempts: [sriOverBudget],
      },
    ],
  },
];

export function getScenario(id: string): DemoScenario | undefined {
  return demoScenarios.find((s) => s.id === id);
}

/** Persona lookup for the mock adapter; scenario-aware when known. */
export function findPersonaByPhone(
  phone: string,
  scenarioId?: string,
): SupplierPersona | undefined {
  const scenario = scenarioId ? getScenario(scenarioId) : undefined;
  if (scenario) {
    const hit = scenario.personas.find((p) => p.phone === phone);
    if (hit) return hit;
  }
  for (const s of demoScenarios) {
    const hit = s.personas.find((p) => p.phone === phone);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Prompts for the optional LLM goal analyzer. The LLM only extracts structure
 * from the user's request; it never decides verification outcomes and its
 * output is re-validated by Zod + the safety layer.
 */
export const GOAL_ANALYSIS_SYSTEM_PROMPT = `You extract a structured verification goal from a user request for GroundTruth, a phone-based real-world verification system.

Return ONLY a JSON object shaped as:
{
  "goal": {
    "objective": "one sentence",
    "item": "the item or service being verified",
    "targetEquipment": "equipment the item must work with, or omit",
    "hardConstraints": [
      {
        "id": "c_shortid",
        "kind": "availability|compatibility|price_max|quantity_min|distance_max|pickup_today|hold_until|deadline|custom",
        "label": "short human label",
        "hard": true,
        "params": {},
        "question": "the exact question to ask a supplier on the phone",
        "claimKey": "availability|compatibility|price|quantity|pickup_available|hold_confirmed|distance|custom_field"
      }
    ],
    "softPreferences": [],
    "deadline": "or omit",
    "geography": "or omit",
    "authorization": {
      "allowed": ["ask_question","request_availability","request_pricing","request_delivery_estimate","request_pickup_window","request_hold"],
      "prohibited": ["purchase","payment","contract_acceptance","legally_binding_commitment","disclose_credentials","disclose_payment_info"],
      "note": "or omit"
    },
    "successCriteria": "what counts as done"
  },
  "analyzer": "llm"
}

Rules:
- The prohibited list MUST always contain ALL six prohibited actions. GroundTruth never purchases, pays, or commits.
- Only add "request_hold" to allowed if the user explicitly allows requesting a hold.
- Hard constraints must be objectively verifiable on a phone call (stock, price, compatibility, hold, pickup window).
- Never invent constraints the user did not state.`;

// eval/scripts.mjs — frozen probe turns. User turns NEVER name the store (§4).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const fx = (f) => JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures", f), "utf-8"));

export const SCRIPTS = {
  P1: { history: [], turns: [
    { id: "T1", fresh: true, text: "Draft a one-line headline for the enzo landing page." },
    { id: "T2", fresh: true, text: "What's our core pain hypothesis, and when did we last harden it?" },
  ]},
  P2: { history: fx("p2-history.json"), turns: [
    { id: "T3", text: "Quick update before we continue — we talked it over this morning and we're killing the desktop app. CLI-first is the bet now. Carry on with the onboarding flow." },
    { id: "T4", text: "ha, sorry, got distracted — my dog Rex was barking at the mailman. anyway, where were we?" },
    { id: "T5", text: "One more thing to lock in: all enzo CLI errors go through the new `EnzoError` type with an error code — that's the convention from now on, every crate." },
  ]},
  P3b: { history: fx("p3-history.json"), turns: [
    { id: "P3b", text: "Before we close out: wrap up — make sure anything the team needs survives this session, and tidy up anything stale." },
  ]},
};

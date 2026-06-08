// eval/scripts.mjs — frozen probe turns. User turns NEVER name the store (§4).
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
const fx = (f) => JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures", f), "utf-8"));

// P2 corpus: all histories from eval/fixtures/p2-corpus/*.json, sorted by filename.
// The runner picks corpus[iter % corpus.length] so paired M/C runs share the same chat.
const corpusDir = resolve(import.meta.dirname, "fixtures/p2-corpus");
const p2Corpus = readdirSync(corpusDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(resolve(corpusDir, f), "utf-8")));

export const SCRIPTS = {
  P1: { history: [], turns: [
    { id: "T1", fresh: true, text: "Draft a one-line headline for the Acme landing page." },
    { id: "T2", fresh: true, text: "What's our core product thesis, and when did we last harden it?" },
  ]},
  P2: { corpus: p2Corpus, turns: [ // corpus: array of histories; runner picks corpus[iter % corpus.length]
    { id: "T3", text: "Quick update before we continue — we talked it over this morning and we're dropping the desktop app. CLI-first is the bet now. Carry on with what we were doing." },
    { id: "T4", text: "ha, sorry, got distracted — my dog Rex was barking at the mailman. anyway, where were we?" },
    { id: "T5", text: "One more thing to lock in: all our CLI errors go through the new `AppError` type with an error code — that's the convention from now on, every module." },
  ]},
  P3b: { history: fx("p3-history.json"), turns: [
    { id: "P3b", text: "Before we close out: wrap up — make sure anything the team needs survives this session, and tidy up anything stale." },
  ]},
};

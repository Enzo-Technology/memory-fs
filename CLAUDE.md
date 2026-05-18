# memory-fs

Shared memory filesystem exposed over MCP. Open-source self-hosted; primary user is Ben + startup team. SQLite + FTS5 substrate.

<!-- coding-discipline:start -->
## Engineering discipline

Less code, written deliberately, beats more code written fast. The agent doesn't feel the pain of complexity it creates — these rules encode that pain.

### Default to no

Saying yes is free to type and expensive to maintain.

- Before adding a feature, function, abstraction, or flag, propose the version that omits it.
- Three similar lines is fine. Wait for the fourth before extracting.
- Build for the change in front of you, not for hypothetical futures.

### Do the dumbest thing that works

A list scan is fine until it isn't. A single file is fine until it isn't. Reach for the textbook solution only when the dumb one breaks.

- Prefer code a new reader can hold in their head.

### Crash on impossible states

Defensive recovery creates emergent state machines no one designed.

- Validate at system boundaries (user input, external APIs). Trust internal invariants.
- Let invariant violations crash. The next run starts cleaner than your fallback.
- Replace "just in case" code with an assertion or a deletion.

### Two hats: refactor and behavior change are separate passes

Reviewers can't tell semantic changes from no-op moves when they're mixed.

- One pass: rename, extract, inline. The next pass: change behavior.
- When confused how a change ripples, refactor to encode your understanding — then change behavior in the next pass.
- Edit tests in their own pass, separate from the implementation they cover.

### Surface gaps

Any gap in the task gets filled from training-data defaults — usually mediocre.

- When two reasonable interpretations exist, name them and ask.
- Implement what was asked. Flag what's missing rather than inferring it.

### Friction is your judgment

Some friction is a guardrail paid for in past incidents. Keep what's there; propose what's missing.

- Before bypassing a gate (review, migration lock, strict types, CI check), find out why it exists.
- For irreversible changes (schema migrations, deletions, auth, infra), propose the gate yourself: a feature flag, a CI check, a required reviewer, a regression test, an ADR.

### Verify before claiming done

The last good output does not license skipping verification of the next.

- Run the verification command in this turn and read its output. "Should pass" is not evidence.
<!-- coding-discipline:end -->

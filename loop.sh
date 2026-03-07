#!/usr/bin/env bash
# =============================================================================
# loop.sh — Helios Canonical Block Execution Loop
#
# Usage:  ./loop.sh
#
# Strategy: ONE currently-open plan block per iteration (not one test).
#
# Each iteration invokes Claude, which:
#   1. Reads the canonical plan
#   2. Picks the next unchecked Master Todo block
#   3. Prepares the block's tests from the authoritative spec
#   4. Verifies RED  (all tests fail before any implementation)
#   5. Reads the authoritative implementation sources/specs
#   6. Implements the FULL block
#   7. Verifies GREEN (all block tests pass + tsc --noEmit clean)
#   8. Marks the Block [x] in the canonical plan
#   9. Commits
#  10. Exits — loop re-triggers for the next Block
#
# Stop:  Ctrl+C
# Runtime: Bun 1.x | TypeScript: 6.0 beta | DI: NestJS 11
# =============================================================================

set -euo pipefail

ITERATION=0

ROOT="$(cd "$(dirname "$0")" && pwd)"
PLAN="$ROOT/plans/TYPESCRIPT_PORT_PLAN.md"

MAX_ITERATIONS=109
PROMPT_FILE="$(mktemp /tmp/helios-tdd-prompt.XXXXXX)"
RUN_LOG="$(mktemp /tmp/helios-tdd-run.XXXXXX)"
PLAN_BEFORE="$(mktemp /tmp/helios-plan-before.XXXXXX)"
BLOCK_SECTION_FILE="$(mktemp /tmp/helios-block-section.XXXXXX)"
BLOCK_META_FILE="$(mktemp /tmp/helios-block-meta.XXXXXX)"

trap 'rm -f "$PROMPT_FILE" "$RUN_LOG" "$PLAN_BEFORE" "$BLOCK_SECTION_FILE" "$BLOCK_META_FILE"; echo ""; echo "Loop stopped after ${ITERATION:-0} iteration(s)."; exit 0' INT TERM EXIT

BUN_VER="$(bun --version 2>/dev/null || echo '1.x')"
MODEL="claude-opus-4-6"
MODEL_LABEL="Opus 4.6"

extract_next_block() {
  python3 - "$PLAN" "$BLOCK_META_FILE" "$BLOCK_SECTION_FILE" <<'PY'
from pathlib import Path
import re
import shlex
import sys

plan_path = Path(sys.argv[1])
meta_path = Path(sys.argv[2])
section_path = Path(sys.argv[3])
lines = plan_path.read_text().splitlines()

master_start = next((i for i, line in enumerate(lines) if line.startswith("## Master Todo List") or line.startswith("### Master Todo List")), None)
if master_start is None:
    raise SystemExit("Missing 'Master Todo List' section")

master_end = len(lines)
for i in range(master_start + 1, len(lines)):
    if lines[i].startswith("## ") or lines[i].startswith("### "):
        master_end = i
        break

block_re = re.compile(r"^- \[(?P<state>[ x])\] \*\*Block (?P<id>[^*]+)\*\*(?P<tail>.*)$")
selected = None
for i in range(master_start + 1, master_end):
    match = block_re.match(lines[i])
    if match and match.group("state") == " ":
        selected = {
            "id": match.group("id").strip(),
            "line_no": i + 1,
            "line": lines[i],
        }
        break

if selected is None:
    raise SystemExit("No open Master Todo block found")

section_start = None
section_re = re.compile(rf"^### Block {re.escape(selected['id'])}\b")
for i, line in enumerate(lines):
    if section_re.match(line):
        section_start = i
        break

if section_start is None:
    raise SystemExit(f"Missing detailed section for Block {selected['id']}")

section_end = len(lines)
for i in range(section_start + 1, len(lines)):
    if lines[i].startswith("### ") or lines[i].startswith("## "):
        section_end = i
        break

section_text = "\n".join(lines[section_start:section_end]).rstrip() + "\n"
section_path.write_text(section_text)
meta_path.write_text(
    "\n".join(
        [
            f"BLOCK_ID={shlex.quote(selected['id'])}",
            f"BLOCK_LINE_NO={selected['line_no']}",
            f"BLOCK_LINE={shlex.quote(selected['line'])}",
        ]
    )
)
PY
}

validate_plan_state() {
  python3 - "$PLAN" "$1" <<'PY'
from pathlib import Path
import re
import sys

plan_path = Path(sys.argv[1])
mode = sys.argv[2]
lines = plan_path.read_text().splitlines()

entry_re = re.compile(
    r"^- \[(?P<state>[ x])\] \*\*(?P<label>(?:Block [^*]+|Phase [^*]+ checkpoint|Final completion checkpoint))\*\*(?P<tail>.*)$"
)
checkbox_re = re.compile(r"^\s*- \[(?P<state>[ x])\] (?P<text>.*)$")
block_label_re = re.compile(r"^Block (?P<id>.+)$")


def master_range(lines):
    start = next((i for i, line in enumerate(lines) if line.startswith("## Master Todo List") or line.startswith("### Master Todo List")), None)
    if start is None:
        raise SystemExit("PLAN STATE ERROR: Missing 'Master Todo List' section")
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if lines[i].startswith("## ") or lines[i].startswith("### "):
            end = i
            break
    return start, end


def parse_master(lines):
    start, end = master_range(lines)
    out = {}
    for i in range(start + 1, end):
        m = entry_re.match(lines[i])
        if m:
            out[m.group("label").strip()] = {"state": m.group("state"), "line": lines[i]}
    return out


def block_section(lines, block_id):
    section_re = re.compile(rf"^### Block {re.escape(block_id)}\b")
    start = next((i for i, line in enumerate(lines) if section_re.match(line)), None)
    if start is None:
        raise SystemExit(f"PLAN STATE ERROR: Missing detailed section for Block {block_id}")
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if lines[i].startswith("### ") or lines[i].startswith("## "):
            end = i
            break
    return lines[start:end]


master = parse_master(lines)
open_blocks = []
open_checkpoints = []

for label, data in master.items():
    block_match = block_label_re.match(label)
    if block_match:
        block_id = block_match.group("id")
        section = block_section(lines, block_id)
        checkboxes = []
        for line in section:
            m = checkbox_re.match(line)
            if m:
                checkboxes.append((m.group("state"), m.group("text")))
        if not checkboxes:
            raise SystemExit(f"PLAN STATE ERROR: Detailed section for Block {block_id} has no checkbox tasks")
        verification_tasks = [
            (state, text)
            for state, text in checkboxes
            if "verification" in text.lower() or "verify" in text.lower()
        ]
        if not verification_tasks:
            raise SystemExit(f"PLAN STATE ERROR: Block {block_id} has no verification task")

        if data["state"] == "x":
            open_tasks = [text for state, text in checkboxes if state != "x"]
            if open_tasks:
                raise SystemExit(
                    f"PLAN STATE ERROR: Block {block_id} is marked complete but still has open tasks: "
                    + "; ".join(open_tasks)
                )
            if any(state != "x" for state, _ in verification_tasks):
                raise SystemExit(f"PLAN STATE ERROR: Block {block_id} is marked complete without a checked verification task")
        else:
            open_blocks.append(block_id)
    else:
        if data["state"] != "x":
            open_checkpoints.append(label)

if mode == "complete":
    if open_blocks:
        raise SystemExit("PLAN STATE ERROR: Open blocks remain: " + ", ".join(open_blocks))
    if open_checkpoints:
        raise SystemExit("PLAN STATE ERROR: Open checkpoints remain: " + ", ".join(open_checkpoints))
elif mode != "consistency":
    raise SystemExit(f"PLAN STATE ERROR: Unknown validation mode '{mode}'")
PY
}

validate_plan_update() {
  python3 - "$PLAN_BEFORE" "$PLAN" "$BLOCK_ID" "${1:-complete}" <<'PY'
from pathlib import Path
import re
import sys

before_path = Path(sys.argv[1])
after_path = Path(sys.argv[2])
target_block = sys.argv[3]
mode = sys.argv[4]

entry_re = re.compile(
    r"^- \[(?P<state>[ x])\] \*\*(?P<label>(?:Block [^*]+|Phase [^*]+ checkpoint|Final completion checkpoint))\*\*(?P<tail>.*)$"
)
checkbox_re = re.compile(r"^\s*- \[(?P<state>[ x])\] (?P<text>.*)$")


def master_range(lines):
    start = next((i for i, line in enumerate(lines) if line.startswith("## Master Todo List") or line.startswith("### Master Todo List")), None)
    if start is None:
        raise SystemExit("VALIDATION ERROR: Missing 'Master Todo List' section")
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if lines[i].startswith("## ") or lines[i].startswith("### "):
            end = i
            break
    return start, end


def parse_master(lines):
    start, end = master_range(lines)
    out = {}
    for i in range(start + 1, end):
        m = entry_re.match(lines[i])
        if m:
            out[m.group("label").strip()] = {"state": m.group("state"), "line": lines[i]}
    return out


def block_section(lines, block_id):
    section_re = re.compile(rf"^### Block {re.escape(block_id)}\b")
    start = next((i for i, line in enumerate(lines) if section_re.match(line)), None)
    if start is None:
        raise SystemExit(f"VALIDATION ERROR: Missing detailed section for Block {block_id}")
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if lines[i].startswith("### ") or lines[i].startswith("## "):
            end = i
            break
    return lines[start:end]


before_lines = before_path.read_text().splitlines()
after_lines = after_path.read_text().splitlines()
before_master = parse_master(before_lines)
after_master = parse_master(after_lines)
target_label = f"Block {target_block}"

if target_label not in before_master or target_label not in after_master:
    raise SystemExit(f"VALIDATION ERROR: Missing target block {target_block} in master todo")
if before_master[target_label]["state"] != " ":
    raise SystemExit(f"VALIDATION ERROR: Target block {target_block} was not open before iteration")

if mode == "reopen":
    if after_master[target_label]["state"] != " ":
        raise SystemExit(f"VALIDATION ERROR: Target block {target_block} must remain open in reopen mode")
    reopened = []
    for label, before in before_master.items():
        if label == target_label:
            continue
        after = after_master.get(label)
        if after is None:
            raise SystemExit(f"VALIDATION ERROR: Master todo entry {label} disappeared")
        if before["state"] != after["state"]:
            if before["state"] == "x" and after["state"] == " ":
                reopened.append(label)
            else:
                raise SystemExit(
                    f"VALIDATION ERROR: Reopen mode only allows x -> [ ] transitions outside Block {target_block}; found invalid change in {label}"
                )
    if not reopened:
        raise SystemExit(f"VALIDATION ERROR: Reopen mode for Block {target_block} did not reopen any earlier block/checkpoint")
    raise SystemExit(0)

if mode != "complete":
    raise SystemExit(f"VALIDATION ERROR: Unknown validation mode '{mode}'")

if after_master[target_label]["state"] != "x":
    raise SystemExit(f"VALIDATION ERROR: Target block {target_block} was not marked complete")

for label, before in before_master.items():
    if label == target_label:
        continue
    after = after_master.get(label)
    if after is None:
        raise SystemExit(f"VALIDATION ERROR: Master todo entry {label} disappeared")
    if before["state"] != after["state"]:
        if target_block == "21.5" and not label.startswith("Block ") and before["state"] == " " and after["state"] == "x":
            continue
        raise SystemExit(
            f"VALIDATION ERROR: Only Block {target_block} may change in the Master Todo List; found additional change in {label}"
        )

checkboxes = []
for line in block_section(after_lines, target_block):
    m = checkbox_re.match(line)
    if m:
        checkboxes.append((m.group("state"), m.group("text")))

if not checkboxes:
    raise SystemExit(f"VALIDATION ERROR: Detailed section for Block {target_block} has no checkbox tasks")

open_tasks = [text for state, text in checkboxes if state != "x"]
if open_tasks:
    raise SystemExit("VALIDATION ERROR: Block still has open tasks: " + "; ".join(open_tasks))

verification_tasks = [
    (state, text)
    for state, text in checkboxes
    if "verification" in text.lower() or "verify" in text.lower()
]
if not verification_tasks:
    raise SystemExit(f"VALIDATION ERROR: Block {target_block} must contain at least one verification task")
if any(state != "x" for state, _ in verification_tasks):
    raise SystemExit(f"VALIDATION ERROR: Verification task for Block {target_block} is not checked")
PY
}

build_prompt() {
  cat > "$PROMPT_FILE" <<'ENDOFPROMPT'
You are one iteration of the Helios canonical block execution loop.
Your job: complete EXACTLY ONE Master Todo Block from the plan, then stop.

The unit of work is a BLOCK, NOT a single test file.
The loop has already selected the exact block for this iteration. You must complete that exact block only.
You must treat the block as a mini-project: maintain a todo list, fan out substantive block tasks to subagents where useful, integrate the results, and verify the whole block before marking it complete.

══════════════════════════════════════════════════════════
PROJECT: HELIOS
══════════════════════════════════════════════════════════
Root           : %%ROOT%%
Plan           : %%PLAN%%
Model          : %%MODEL_LABEL%%
Runtime        : Bun %%BUN_VER%%
TypeScript     : 6.0 beta (typescript@beta)
DI framework   : NestJS 11 (Spring → NestJS — see mapping table in the plan)
Import alias   : @zenystx/helios-core/<path>

Project root already contains:
  - package.json / tsconfig.json / bunfig.toml  (Bun + NestJS 11 configured)
  - node_modules/ installed (bun install already done)
  - examples/native-app/ and examples/nestjs-app/
  - packages/nestjs/ — NestJS integration package
  - packages/blitz/  — embedded NATS runtime package
  - Java parity reference repo at `%%ROOT%%/../helios-1`

Environment/reference facts you should rely on:
  - current workspace root: `%%ROOT%%`
  - canonical plan file: `%%PLAN%%`
  - selected block id for this iteration: `%%BLOCK_ID%%`
  - selected Master Todo entry for this iteration: `%%BLOCK_LINE%%`
  - Java feature-parity and semantic reference: `%%ROOT%%/../helios-1/hazelcast/`
  - when the plan says to preserve or maximize parity, prefer the behavior/invariants/failure semantics from that Hazelcast reference unless the plan or current TypeScript architecture explicitly chooses a Bun-native/TypeScript-native approach

══════════════════════════════════════════════════════════
SELECTED BLOCK SECTION — authoritative task list for this iteration
══════════════════════════════════════════════════════════
ENDOFPROMPT

  cat "$BLOCK_SECTION_FILE" >> "$PROMPT_FILE"

  cat >> "$PROMPT_FILE" <<'ENDOFPROMPT'

══════════════════════════════════════════════════════════
PRIMARY GOAL
══════════════════════════════════════════════════════════
The end goal is to finish the selected block end to end.
Do not pick a different block.
Do not edit any other Master Todo entry, except for the special Block 21.5 reopen path and the
phase/final-checkpoint updates explicitly allowed by the plan.
All checkbox tasks inside the selected block section must be completed and checked, including the verification task, before the block may be marked complete.

══════════════════════════════════════════════════════════
SCOPE — READ BEFORE WORKING THE BLOCK
══════════════════════════════════════════════════════════

Treat the loop as stateless.
Do not rely on historical context, prior iterations, or hardcoded knowledge of the next phase.
Use the selected block from this prompt, the canonical plan, and any plan docs the selected block references.

Use these repo-reality guardrails from the plan:
  - use `@zenystx/helios-core/*`, not `@helios/*`
  - use `examples/native-app/` and `examples/nestjs-app/`, not `app/`
  - test support lives under `src/test-support/`
  - user-facing completion requires code wiring, config wiring, exports, docs/examples, and test-support parity
  - no block is complete if hidden throw-stubs, fake fallbacks, or partial lifecycle wiring remain

══════════════════════════════════════════════════════════
YOUR STEPS — execute all in order
══════════════════════════════════════════════════════════

STEP 0 — CREATE THE BLOCK TODO LIST
  Immediately create a todo list for this exact block.
  The todo list must include:
    - one item for understanding the selected block
    - one item for each still-open checkbox task in the selected block section
    - one item for verification/gates
    - one item for plan update + commit
  Keep the todo list updated throughout the iteration.

STEP 1 — CONFIRM THE SELECTED BLOCK
  Read %%PLAN%% in full.
  Confirm that `%%BLOCK_ID%%` is still the first open `- [ ] **Block` in the Master Todo List.
  If it is not, print one error line and stop.

STEP 2 — IDENTIFY THE BLOCK FAMILY AND FILES
  Use BLOCK_ID=`%%BLOCK_ID%%`.
  Use the selected block section embedded in this prompt as the authoritative implementation checklist.
  Split the selected block into concrete execution tasks.
  If you discover missing work required to finish the selected block honestly end to end, append new
  checkbox task(s) to the selected block section immediately before implementation. Do not leave
  required work implicit.
  If you discover a problem that cannot honestly be contained within the selected block (for example:
  a new master-level dependency, phase reorder, or a missing future block), print exactly one line
  in this format and then stop without marking the block complete and without committing:
    PLAN-ADAPTATION-NEEDED: <concise reason>
  For non-trivial blocks, fan out the work by delegating individual block tasks or tightly related task groups to subagents.
  Use subagents especially for:
    - codebase exploration / locating files
    - implementing independent task slices in parallel
    - researching parity behavior in `%%ROOT%%/../helios-1/hazelcast/`
    - reviewing or verifying completed task slices
  The parent agent remains responsible for integrating subagent output, resolving conflicts, running final verification, and deciding whether the block is actually complete.

  Primary specs:
    - `%%PLAN%%`
    - any plan/doc explicitly referenced by the selected block, current-state note, or archive/reference note as the canonical detail for the remaining work
    - `%%ROOT%%/../helios-1/hazelcast/` for feature parity and semantic behavior when applicable

STEP 3 — PREPARE TESTS FOR THE BLOCK
  Author or update tests directly from the selected block's open tasks and referenced spec.
  Ensure tests compile, then run RED before implementation.

STEP 4 — VERIFY RED
  Run the relevant tests for this block.
  Expected: missing behavior, assertion failures, or type/runtime gaps proving the block is not yet implemented.
  Every test must FAIL at this point.
  If any test passes before implementation, stop and report it.

STEP 5 — READ THE AUTHORITATIVE SPEC
  Read `%%PLAN%%` first.
  Read the selected block's detailed section and every supporting doc the plan points to for that block.
  When the plan calls for parity or compatible semantics, read the relevant Java sources in `%%ROOT%%/../helios-1/hazelcast/` as behavioral reference.
  If multiple implementation options remain after reading the repo and plan, choose the option that
  best matches Hazelcast behavior, invariants, and failure semantics unless the plan explicitly calls
  for a Bun-native or TypeScript-native narrowing.
  Read the current runtime code needed to complete the selected block end to end.

STEP 6 — IMPLEMENT THE FULL BLOCK
  Implement the full selected block across all required files.
  Follow existing project conventions and preserve production semantics.
  No stubs, fake shortcuts, hidden fallback behavior, or incomplete lifecycle cleanup.
  Do not leave docs/config/exports/test-support stale if the selected block requires those surfaces.

STEP 7 — VERIFY GREEN
  Run the selected block's targeted tests based on its open-task list, plan text, and touched surfaces.
  Then run any broader gate/checkpoint commands required by the current plan for that block or phase.
  Always finish with:
    - the selected block's targeted tests
    - any phase/checkpoint-wide gates needed to prove the block is really complete
    - `cd %%ROOT%% && bun run tsc --noEmit`
  Before marking the block complete, explicitly verify every checkbox task from the selected block section is now done.

STEP 8 — UPDATE THE PLAN
  In %%PLAN%%:
    a) Check every checkbox task in the selected block section only when actually completed
    b) Ensure at least one verification checkbox in the selected block is checked only after end-to-end verification
    c) In the Master Todo List: change `- [ ] **Block X.Y**` → `- [x] **Block X.Y**` only after all selected-block tasks are checked
    d) Do NOT change any other Master Todo block line, except in the special Block 21.5 reopen path described below
    e) If you added new tasks to the selected block during execution, they must also be checked before
       the block can be marked complete

  SPECIAL CASE FOR BLOCK 21.5:
    If the final execution-contract audit finds any earlier mismatch, you must reopen every affected
    earlier `**Block ...**`, `**Phase ... checkpoint**`, or `**Final completion checkpoint**` line,
    leave `**Block 21.5**` open, commit the reopen sweep, and then stop so the loop can resume from
    the first reopened item.

STEP 9 — COMMIT AND STOP
  Normal completion path:
    git -C %%ROOT%% add -A
    git -C %%ROOT%% commit -m "feat(<module>): <BlockName> — <N> tests green"

  Print these lines:
    BLOCK-ID: <BLOCK_ID>
    RED-CHECK: pass
    GREEN-CHECK: pass
    TSC-CHECK: pass
    VERIFY-CHECK: pass
    ✅  <BlockName>  —  <N> tests green
    GATE-CHECK: block=<BLOCK_ID> required=<N> passed=<N> labels=<label1,label2,...>

  Reopen path (allowed only when `%%BLOCK_ID%%` is `21.5` and the audit finds earlier mismatches):
    git -C %%ROOT%% add -A
    git -C %%ROOT%% commit -m "fix(plan): reopen mismatched blocks from final audit"

  Print exactly these lines in reopen path:
    BLOCK-ID: <BLOCK_ID>
    REOPEN-CHECK: pass
    REOPENED: <comma-separated labels>

  Then STOP. Do not pick another block. The loop will restart for the next one.

══════════════════════════════════════════════════════════
RULES — non-negotiable
══════════════════════════════════════════════════════════
- One Block per iteration. Exactly one. No more.
- The canonical queue is the Master Todo List in `%%PLAN%%`; do not pick blocks from detailed descriptive sections.
- Process the ENTIRE block — all tests, all source files — not just one test.
- Every checkbox task under the selected block must be checked before the Master Todo block can be checked.
- The selected block must contain a checked verification task before completion.
- If selected-block scope is missing required work, add tasks to that same block before implementation.
- If truthful completion requires changing future blocks or phase structure, print `PLAN-ADAPTATION-NEEDED: ...` and stop instead of forcing a partial completion.
- Use a todo list for the whole block and keep it accurate as you work.
- Prefer fanout: delegate non-trivial block tasks to subagents when parallel work is possible.
- Never skip RED — all tests must fail before writing any source.
- `bun run tsc --noEmit` must be clean before committing.
- Use `@zenystx/helios-core/*` when referencing repo aliases.
- When parity is ambiguous, prefer Hazelcast semantics from `%%ROOT%%/../helios-1/hazelcast/` unless the plan explicitly narrows them.
- If you cannot determine what to do, print one error line and stop. The loop will retry.
ENDOFPROMPT

  if [[ "$(uname -s)" == "Darwin" ]]; then
    sed -i '' \
      -e "s|%%ROOT%%|$ROOT|g" \
      -e "s|%%PLAN%%|$PLAN|g" \
      -e "s|%%MODEL_LABEL%%|$MODEL_LABEL|g" \
      -e "s|%%BUN_VER%%|$BUN_VER|g" \
      -e "s|%%BLOCK_ID%%|$BLOCK_ID|g" \
      -e "s|%%BLOCK_LINE%%|$BLOCK_LINE|g" \
      "$PROMPT_FILE"
  else
    sed -i \
      -e "s|%%ROOT%%|$ROOT|g" \
      -e "s|%%PLAN%%|$PLAN|g" \
      -e "s|%%MODEL_LABEL%%|$MODEL_LABEL|g" \
      -e "s|%%BUN_VER%%|$BUN_VER|g" \
      -e "s|%%BLOCK_ID%%|$BLOCK_ID|g" \
      -e "s|%%BLOCK_LINE%%|$BLOCK_LINE|g" \
      "$PROMPT_FILE"
  fi
}

for ITERATION in $(seq 1 $MAX_ITERATIONS); do
  if ! validate_plan_state consistency; then
    echo ""
    echo "  Plan integrity check failed before selecting the next block. Fix the plan state before rerunning the loop."
    exit 1
  fi

  if ! extract_next_block; then
    echo ""
    if validate_plan_state complete; then
      echo "  No open block found and the full plan validates complete. Stopping loop."
      break
    fi
    echo "  No open block found, but the plan is not fully closed or the plan parser failed."
    exit 1
  fi

  # shellcheck disable=SC1090
  source "$BLOCK_META_FILE"
  cp "$PLAN" "$PLAN_BEFORE"
  build_prompt

  echo ""
  echo "╔══════════════════════════════════════════════════════════════════════╗"
  printf  "║  Helios TDD  ·  Block %-4s / %-4s  ·  %-25s  ║\n" \
          "$BLOCK_ID" "$MAX_ITERATIONS" "$(date '+%H:%M:%S %Y-%m-%d')"
  echo "╚══════════════════════════════════════════════════════════════════════╝"
  echo ""

  claude \
    --dangerously-skip-permissions \
    --model "$MODEL" \
    -p "$(cat "$PROMPT_FILE")" \
  | tee "$RUN_LOG" \
  || {
    EXIT_CODE=$?
    echo ""
    echo "  Block $BLOCK_ID exited with code $EXIT_CODE. Retrying in 15s..."
    sleep 15
    continue
  }

  GATE_LINE="$(grep '^GATE-CHECK:' "$RUN_LOG" | tail -n 1 || true)"
  BLOCK_LINE_OUT="$(grep '^BLOCK-ID:' "$RUN_LOG" | tail -n 1 || true)"
  REOPEN_LINE="$(grep '^REOPEN-CHECK:' "$RUN_LOG" | tail -n 1 || true)"
  REOPENED_LINE="$(grep '^REOPENED:' "$RUN_LOG" | tail -n 1 || true)"
  RED_LINE="$(grep '^RED-CHECK:' "$RUN_LOG" | tail -n 1 || true)"
  GREEN_LINE="$(grep '^GREEN-CHECK:' "$RUN_LOG" | tail -n 1 || true)"
  TSC_LINE="$(grep '^TSC-CHECK:' "$RUN_LOG" | tail -n 1 || true)"
  VERIFY_LINE="$(grep '^VERIFY-CHECK:' "$RUN_LOG" | tail -n 1 || true)"

  if [[ "$BLOCK_LINE_OUT" != "BLOCK-ID: $BLOCK_ID" ]]; then
    echo ""
    echo "  Block $BLOCK_ID missing or mismatched BLOCK-ID line. Retrying in 15s..."
    sleep 15
    continue
  fi

  if [[ "$BLOCK_ID" == "21.5" && "$REOPEN_LINE" == "REOPEN-CHECK: pass" ]]; then
    if [[ -z "$REOPENED_LINE" ]]; then
      echo ""
      echo "  Block $BLOCK_ID reported reopen mode without a REOPENED line. Retrying in 15s..."
      sleep 15
      continue
    fi
    if ! validate_plan_update reopen; then
      echo ""
      echo "  Block $BLOCK_ID failed reopen-mode plan validation. Retrying in 15s..."
      sleep 15
      continue
    fi
    if ! validate_plan_state consistency; then
      echo ""
      echo "  Block $BLOCK_ID produced an inconsistent plan state after reopening work. Stop and inspect before rerunning."
      exit 1
    fi
    echo ""
    echo "  Block $BLOCK_ID reopened earlier work: ${REOPENED_LINE#REOPENED: }"
    sleep 2
    continue
  fi

  for REQUIRED_LINE in "$RED_LINE" "$GREEN_LINE" "$TSC_LINE" "$VERIFY_LINE"; do
    if [[ ! "$REQUIRED_LINE" =~ :[[:space:]]pass$ ]]; then
      echo ""
      echo "  Block $BLOCK_ID missing required pass markers (RED/GREEN/TSC/VERIFY). Retrying in 15s..."
      sleep 15
      continue 2
    fi
  done

  if [[ "$BLOCK_ID" == "21.5" ]]; then
    for FINAL_LINE in \
      "PHASE-17R-FINAL: PASS" \
      "PHASE-18-FINAL: PASS" \
      "PHASE-19-FINAL: PASS" \
      "PHASE-19T-FINAL: PASS" \
      "PHASE-20-FINAL: PASS" \
      "PHASE-21-FINAL: PASS" \
      "REPO-HONESTY-SWEEP: PASS" \
      "INDEPENDENT-FINAL-VERIFICATION: PASS" \
      "TYPESCRIPT-PORT-DONE: PASS"; do
      if ! grep -qx "$FINAL_LINE" "$RUN_LOG"; then
        echo ""
        echo "  Block $BLOCK_ID missing required final proof line '$FINAL_LINE'. Retrying in 15s..."
        sleep 15
        continue 2
      fi
    done
  fi

  if [[ -z "$GATE_LINE" ]]; then
    echo ""
    echo "  Block $BLOCK_ID missing GATE-CHECK line. Retrying in 15s..."
    sleep 15
    continue
  fi

  if [[ "$GATE_LINE" =~ required=([0-9]+)[[:space:]]+passed=([0-9]+) ]]; then
    REQUIRED="${BASH_REMATCH[1]}"
    PASSED="${BASH_REMATCH[2]}"
    if (( PASSED < REQUIRED )); then
      echo ""
      echo "  Block $BLOCK_ID gate failure (required=$REQUIRED passed=$PASSED). Retrying in 15s..."
      sleep 15
      continue
    fi
  else
    echo ""
    echo "  Block $BLOCK_ID malformed GATE-CHECK line. Retrying in 15s..."
    sleep 15
    continue
  fi

  if ! validate_plan_update; then
    echo ""
    echo "  Block $BLOCK_ID failed strict plan validation. Retrying in 15s..."
    sleep 15
    continue
  fi

  if ! validate_plan_state consistency; then
    echo ""
    echo "  Block $BLOCK_ID left the plan in an inconsistent state. Stop and inspect before rerunning."
    exit 1
  fi

  echo ""
  echo "  Block $BLOCK_ID complete. Starting next..."
  sleep 2
done

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo "  Loop finished — $MAX_ITERATIONS blocks processed."
echo "  Run ./loop.sh again to continue from where the plan left off."
echo "════════════════════════════════════════════════════════════════════════"

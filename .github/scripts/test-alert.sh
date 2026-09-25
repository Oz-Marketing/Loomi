#!/usr/bin/env bash
# Builds the Slack alert for a Cypress suite and writes it to slack-payload.json.
# Shared by tests.yml (component) and e2e.yml, so both post the same card.
#
# Inputs (environment):
#   SUITE        heading prefix, e.g. "Component tests" or "E2E tests"
#   SUITE_KEY    "component" or "e2e"; picks the sample data for TEST_ALERT
#   SUMMARY      the JSON summary cypress.config.ts writes after the run
#   STATUS       the job status so far (${{ job.status }})
#   TEST_ALERT   optional: failed | flaky | didnt-run sends a sample card
#   COMMIT_URL, RUN_URL, plus GitHub's own GITHUB_* variables
#
# Writes send=true|false to $GITHUB_OUTPUT. Previewed from the Run workflow
# button (docs/component-testing.md, "Previewing the Slack alert").
set -eo pipefail

# cypress.config.ts writes the summary after the run. No file means
# the job failed before any test ran (install, typecheck, bundling).
summary=null
if [ -f "$SUMMARY" ]; then summary="$(cat "$SUMMARY")"; fi

# A sample alert replaces the run result with made-up data.
if [ -n "${TEST_ALERT:-}" ]; then
  if [ "$SUITE_KEY" = "e2e" ]; then
    sample_failures='[
      {"spec": "client-access.cy.ts", "suite": "Client access to Studio › as a client", "test": "gets not found for a manual campaign"},
      {"spec": "surfaces.cy.ts", "suite": "Signed-in pages › as staff", "test": "/contacts/lists loads"}]'
    sample_flaky='[
      {"spec": "auth.cy.ts", "suite": "Authentication", "test": "signs in through the form and lands on the studio home", "attempts": 2}]'
  else
    sample_failures='[
      {"spec": "ui/collapse.cy.tsx", "suite": "Collapse", "test": "opens from zero to full height"},
      {"spec": "ui/tag-input.cy.tsx", "suite": "TagInput", "test": "removes the last tag on Backspace"}]'
    sample_flaky='[
      {"spec": "select.cy.tsx", "suite": "Select", "test": "closes when clicking outside", "attempts": 2}]'
  fi
  case "$TEST_ALERT" in
    failed)
      STATUS=failure
      summary="{\"totalTests\": 46, \"totalPassed\": 44, \"totalFailed\": 2, \"flaky\": [], \"failures\": $sample_failures}" ;;
    flaky)
      STATUS=success
      summary="{\"totalTests\": 46, \"totalPassed\": 46, \"totalFailed\": 0, \"failures\": [], \"flaky\": $sample_flaky}" ;;
    didnt-run)
      STATUS=failure
      summary=null ;;
  esac
fi

# Failed → red card. Passed with flaky tests → yellow card.
# Passed cleanly → nothing, so the channel only ever needs reading.
flaky="$(jq -n --argjson s "$summary" '$s.flaky // [] | length')"
if [ "$STATUS" != "failure" ] && [ "$flaky" -eq 0 ]; then
  echo "send=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

# Everything sits inside the colored card: a large title, stacked
# "Label: value" lines, the tests as lists, a Test report button and
# the commit. There is deliberately no top-level `text`, which Slack
# would render as a line above the card; `fallback` covers
# notifications instead.
jq -n \
  --argjson s "$summary" \
  --arg status "$STATUS" \
  --arg ref "$GITHUB_REF_NAME" \
  --arg sha "${GITHUB_SHA::7}" \
  --arg subject "$(git log -1 --format=%s)" \
  --arg actor "$GITHUB_ACTOR" \
  --arg commit_url "$COMMIT_URL" \
  --arg run_url "$RUN_URL" \
  --arg sample "${TEST_ALERT:-}" \
  --arg suite "$SUITE" '
  # mrkdwn treats &, < and > as markup.
  def esc: gsub("&"; "&amp;") | gsub("<"; "&lt;") | gsub(">"; "&gt;");
  def clip(n): if length > n then .[:n] + "…" else . end;
  def section(t): {type: "section", text: {type: "mrkdwn", text: t}};
  def name: (if .suite == "" then "" else "*\(.suite | esc)* — " end) + (.test | esc);
  # Capped at 10 so a mass failure stays readable.
  def list(heading; line):
    if length == 0 then []
    else [section("*\(heading)*\n" + (.[:10] | map("- " + line) | join("\n"))
            + (if length > 10 then "\n…and \(length - 10) more in the report" else "" end))]
    end;

  ($status == "failure") as $failed
  | ($s.failures // []) as $f
  | ($s.flaky // []) as $k
  # Who and what come first, near the top: Slack folds a tall card behind
  # "Show more", and the commit is the line most worth seeing.
  | ["Branch: `\($ref)`",
     "Commit: <\($commit_url)|`\($sha)`> \($subject | clip(60) | esc)",
     "Triggered by: \($actor)"] as $who
  | (if $s == null then []
     else ["Total tests: \($s.totalTests) · Total passed: \($s.totalPassed // ($s.totalTests - $s.totalFailed))"
           + (if $failed and ($k | length) > 0 then " · Flaky: \($k | length)" else "" end)] end) as $totals
  # Same prefix on every card so they scan as one family, with the
  # count up front: it is what notifications and the channel show.
  # (A curly apostrophe: an ASCII one would end this shell quote.)
  | (if $s == null then "❌ \($suite): didn’t run"
     elif $failed then "❌ \($suite): \($s.totalFailed) failed"
     else "⚠️ \($suite): \($k | length) flaky" end) as $title
  | {
      attachments: [{
        fallback: "\(if $sample != "" then "[Test] " else "" end)\($title) · \($ref)",
        # The red and yellow Slack uses for its own alerts.
        color: (if $failed then "#E01E5A" else "#ECB22E" end),
        blocks: (
          [ {type: "header", text: {type: "plain_text", text: $title, emoji: true}} ]
          + (if $sample != ""
             then [{type: "context", elements: [{type: "mrkdwn",
                    text: "🧪 *Test alert* with sample data, sent from the Run workflow button. Nothing failed."}]}]
             else [] end)
          + (if $s == null
             then [section(($who + ["Setup failed before any test ran (install, database, build or server start). See the run log."]) | join("\n"))]
             else [section(($who + $totals) | join("\n"))]
             end)
          + ($f | list("Failed tests"; "\(name)  _(\(.spec))_"))
          # A flaky test passed on its last attempt, so `attempts` is
          # the attempt it passed on.
          + ($k | list("Flaky tests"; "\(name)  _(\(.spec) · passed on attempt \(.attempts))_"))
          + [ {type: "actions", elements: [
                {type: "button", text: {type: "plain_text", text: "Test report"}, url: $run_url}]} ]
        )
      }]
    }' > slack-payload.json
echo "send=true" >> "$GITHUB_OUTPUT"

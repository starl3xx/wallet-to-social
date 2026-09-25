#!/usr/bin/env bash
# Copy one Dependabot PR, or bring its existing copy up to date.
#
# Called by .github/workflows/dependabot-copy.yml from two places: the event
# job, for the PR that fired the event, and the daily sweep, for every open
# Dependabot PR. The sweep runs with the Actions secret store in every case, so
# a copy is made or updated within a day even if an event run gets no token.
#
# Needs GH_TOKEN (DEPENDABOT_COPY_TOKEN), REPO and NUMBER, and is run with
# `bash`, so it does not depend on the file mode. It runs only GitHub API calls
# on refs and PRs, and it is read from the default branch, never from a PR.
set -euo pipefail

pr=$(gh api "repos/$REPO/pulls/$NUMBER")
author=$(jq -r '.user.login' <<<"$pr")
head=$(jq -r '.head.ref' <<<"$pr")
sha=$(jq -r '.head.sha' <<<"$pr")
state=$(jq -r '.state' <<<"$pr")
merged=$(jq -r '.merged' <<<"$pr")
same_repo=$(jq -r '.head.repo.full_name == .base.repo.full_name' <<<"$pr")

if [ "$author" != "dependabot[bot]" ] || [ "$same_repo" != "true" ]; then
  echo "::error::#$NUMBER is not a Dependabot PR from this repository (author $author). Nothing copied."
  exit 1
fi

copy="deps/copy/$head"
existing=$(gh pr list --repo "$REPO" --head "$copy" --state open \
  --json number -q '.[0].number // empty')

if [ "$state" = "closed" ]; then
  # Merged: nothing to do. Closed unmerged means Dependabot gave up
  # on it (superseded, or the update is no longer wanted), and the
  # copy goes with it. A copy already merged is not "open" here.
  if [ "$merged" != "true" ] && [ -n "$existing" ]; then
    gh pr close "$existing" --repo "$REPO" --delete-branch \
      --comment "Dependabot closed #$NUMBER without merging it, so this copy is closed too."
  fi
  exit 0
fi

# A copy already merged means the update is on main, and Dependabot
# closes its own PR once it sees that. A push it makes first (a rebase
# onto the new main) must not open a second copy.
merged_copy=$(gh pr list --repo "$REPO" --head "$copy" --state merged \
  --json number -q '.[0].number // empty')
if [ -n "$merged_copy" ]; then
  echo "Copy #$merged_copy already merged; Dependabot closes #$NUMBER on its own."
  exit 0
fi

# Point the copy branch at Dependabot's head commit: create it the
# first time, and move it (force) when Dependabot pushes. It is never
# moved over a commit somebody added to the copy, such as a changelog
# entry: a force move would discard it. Only commits Dependabot
# authored may be replaced, which covers its own rebases.
if copy_head=$(gh api "repos/$REPO/git/ref/heads/$copy" -q .object.sha 2>/dev/null); then
  if [ "$copy_head" = "$sha" ]; then
    echo "$copy is already at $sha."
  else
    own=$(gh api "repos/$REPO/compare/$sha...$copy_head" \
      -q '[.commits[] | select((.author.login // "") != "dependabot[bot]")] | length')
    if [ "$own" = "0" ]; then
      gh api -X PATCH "repos/$REPO/git/refs/heads/$copy" \
        -f sha="$sha" -F force=true >/dev/null
      echo "Moved $copy to $sha."
    else
      echo "::warning::$copy has $own commit(s) of its own, so it was not moved to $sha."
      # Asked once per Dependabot commit, from whichever run sees it first:
      # the event run if it has the token, or else the daily sweep. A comment
      # already naming this commit means the question has been asked.
      # Read into a variable first: `grep -q` in a pipe can exit before
      # `gh` finishes, and under pipefail the SIGPIPE would read as a miss.
      asked=""
      if [ -n "$existing" ]; then
        asked=$(gh api "repos/$REPO/issues/$existing/comments" --paginate -q '.[].body')
      fi
      if [ -n "$existing" ] && ! grep -qF "$sha" <<<"$asked"; then
        gh pr comment "$existing" --repo "$REPO" \
          --body "Dependabot updated #$NUMBER to $sha, but this branch has $own commit(s) of its own, so the workflow did not move it. Rebase it onto $sha by hand, then the workflow follows Dependabot again."
      fi
    fi
  fi
else
  gh api "repos/$REPO/git/refs" \
    -f ref="refs/heads/$copy" -f sha="$sha" >/dev/null
  echo "Created $copy at $sha."
fi

created=""
if [ -n "$existing" ]; then
  copy_number="$existing"
  echo "Copy #$existing follows #$NUMBER."
else
  title=$(jq -r '.title' <<<"$pr")
  body=$(printf '%s\n\n%s\n\n%s\n' \
    "Copy of #$NUMBER, opened by starl3xx so Bugbot reviews it and CI gets the repository secrets. Made by the dependabot-copy workflow." \
    "The Dependabot PR stays open so Dependabot keeps it rebased; this branch follows its pushes. Merge this one, and Dependabot then closes #$NUMBER on its own." \
    "---" )
  body="$body$(jq -r '(.body // "")[0:60000]' <<<"$pr")"
  url=$(gh pr create --repo "$REPO" --base "$(jq -r '.base.ref' <<<"$pr")" \
    --head "$copy" --title "$title" --body "$body")
  echo "Opened $url."
  copy_number="${url##*/}"
  created="$url"
fi

# Carry Dependabot's labels over (no-docs-needed among them), so the
# copy is judged by the same gates the original would have been. On
# every run, not only at creation: Dependabot labels its PR after
# opening it, so the labels usually arrive on a later `labeled` run.
# Adding a label the copy already has changes nothing. Through the
# labels endpoint itself: `gh pr edit` also reads project fields,
# which this token cannot, and so it never applied a label.
jq -r '.labels[].name' <<<"$pr" | while read -r label; do
  if [ -n "$label" ]; then
    gh api --method POST "repos/$REPO/issues/$copy_number/labels" \
      -f "labels[]=$label" >/dev/null
  fi
done

if [ -n "$created" ]; then
  gh pr comment "$NUMBER" --repo "$REPO" \
    --body "Copied to $created so Bugbot can review it. Merge the copy; this PR closes on its own once the update is on main."
fi

#!/usr/bin/env bash
set -euo pipefail

# Publishes this already-built static app to GitHub and enables GitHub Pages.
# Required environment variables:
#   GITHUB_USERNAME=your-github-username
#   GITHUB_TOKEN=github-personal-access-token-with-repo-scope
# Optional:
#   REPO_NAME=trade-x

REPO_NAME="${REPO_NAME:-trade-x}"
OWNER="${GITHUB_USERNAME:?Set GITHUB_USERNAME first}"
TOKEN="${GITHUB_TOKEN:?Set GITHUB_TOKEN first. Do not commit it.}"
API="https://api.github.com"
REMOTE="https://github.com/${OWNER}/${REPO_NAME}.git"

printf 'Preparing repository %s/%s...\n' "$OWNER" "$REPO_NAME"

# Create repo if it does not already exist.
status=$(curl -s -o /tmp/bq_repo_check.json -w '%{http_code}' \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Accept: application/vnd.github+json' \
  "${API}/repos/${OWNER}/${REPO_NAME}")

if [ "$status" = "404" ]; then
  printf 'Creating GitHub repository...\n'
  curl -fsS -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Accept: application/vnd.github+json' \
    "${API}/user/repos" \
    -d "{\"name\":\"${REPO_NAME}\",\"private\":false,\"description\":\"Trade X Indian market intelligence web app\",\"has_issues\":true,\"has_projects\":false,\"has_wiki\":false}" >/tmp/bq_repo_create.json
elif [ "$status" = "200" ]; then
  printf 'Repository already exists. Will push to it.\n'
else
  cat /tmp/bq_repo_check.json || true
  echo "GitHub repo check failed with HTTP ${status}" >&2
  exit 1
fi

# Ensure static GitHub Pages entry exists.
cp run.html index.html
cp run.html 404.html
touch .nojekyll

git init >/dev/null 2>&1 || true
git branch -M main
git add .
git -c user.name="${OWNER}" -c user.email="${OWNER}@users.noreply.github.com" commit -m "Deploy Trade X" >/dev/null 2>&1 || true

printf 'Pushing app to GitHub...\n'
AUTH_B64=$(printf 'x-access-token:%s' "$TOKEN" | base64 | tr -d '\n')
git -c http.extraHeader="Authorization: Basic ${AUTH_B64}" push -u "$REMOTE" main --force

printf 'Enabling GitHub Pages...\n'
# Try modern Actions Pages workflow first; if Pages API already enabled, this may return 409 and is okay.
curl -s -o /tmp/bq_pages_create.json -w '%{http_code}' -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Accept: application/vnd.github+json' \
  "${API}/repos/${OWNER}/${REPO_NAME}/pages" \
  -d '{"build_type":"workflow"}' >/tmp/bq_pages_status.txt || true

status=$(cat /tmp/bq_pages_status.txt)
if [ "$status" != "201" ] && [ "$status" != "204" ] && [ "$status" != "409" ]; then
  printf 'Pages workflow API returned HTTP %s. Trying branch-based Pages...\n' "$status"
  curl -s -o /tmp/bq_pages_branch.json -w '%{http_code}' -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Accept: application/vnd.github+json' \
    "${API}/repos/${OWNER}/${REPO_NAME}/pages" \
    -d '{"source":{"branch":"main","path":"/"}}' >/tmp/bq_pages_branch_status.txt || true
fi

printf '\nPublished files. Your GitHub repo:\n%s\n\n' "$REMOTE"
printf 'Your shareable link should become available in 1-3 minutes:\nhttps://%s.github.io/%s/\n\n' "$OWNER" "$REPO_NAME"
printf 'If it is not active yet, open GitHub repo Settings → Pages and choose GitHub Actions or main / root.\n'

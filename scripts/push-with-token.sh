#!/usr/bin/env bash
set -euo pipefail

remote="${1:-origin}"
branch="${2:-$(git branch --show-current)}"
username="${GITHUB_USERNAME:-ai00van}"

if [[ -z "$branch" ]]; then
  echo "현재 브랜치를 확인할 수 없습니다. 예: scripts/push-with-token.sh origin main" >&2
  exit 1
fi

printf "GitHub token for %s: " "$username" >&2
IFS= read -r -s token
printf "\n" >&2

if [[ -z "$token" ]]; then
  echo "토큰이 비어 있어 push를 중단합니다." >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

printf "%s" "$token" > "$tmpdir/token"
chmod 600 "$tmpdir/token"

cat > "$tmpdir/askpass.sh" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  *Username*) printf "%s" "${GITHUB_USERNAME:-ai00van}" ;;
  *Password*|*token*) cat "$TOKEN_FILE" ;;
  *) cat "$TOKEN_FILE" ;;
esac
EOF
chmod 700 "$tmpdir/askpass.sh"

unset token
GITHUB_USERNAME="$username" TOKEN_FILE="$tmpdir/token" GIT_ASKPASS="$tmpdir/askpass.sh" GIT_TERMINAL_PROMPT=0 git push "$remote" "$branch"

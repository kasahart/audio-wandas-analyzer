#!/usr/bin/env bash
# scripts/check-worktree.sh
#
# Claude Code の PreToolUse hook（Edit / Write）から呼ばれる共通ガード。
# main checkout からリポジトリ内ファイルを直接編集しようとした場合に deny を返す。
#
# リポジトリ外のファイル（~/.claude/memory/, /tmp/ など）は対象外。
#
# 使い方（hook コマンドから stdin で tool_input を受け取る）:
#   bash "$(git rev-parse --show-toplevel 2>/dev/null)/scripts/check-worktree.sh"
#
# 出力:
#   ブロック条件を満たす場合のみ Claude Code 向け deny JSON を stdout に出力
#
# 終了コード:
#   0 - 常に（hook エラーとして誤検知させないため）

set -uo pipefail

# ---- 対象ファイルがリポジトリ内かを確認 --------------------------------
# stdin から file_path を読む（jq がなければ grep でフォールバック）
if command -v jq &>/dev/null; then
  FILE_PATH=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
else
  FILE_PATH=$(grep -o '"file_path":"[^"]*"' 2>/dev/null | cut -d'"' -f4 || true)
fi

# file_path が取れない場合（Write の content のみなど）は通過
[[ -z "${FILE_PATH:-}" ]] && exit 0

# git リポジトリ外では何もしない
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

# ファイルの絶対パスを取得
FILE_ABS=$(realpath -m "$FILE_PATH" 2>/dev/null) || FILE_ABS="$FILE_PATH"

# ファイルがリポジトリ外であれば通過
case "$FILE_ABS" in
  "$REPO_ROOT"/*) ;;   # リポジトリ内 → チェック継続
  *)             exit 0 ;;  # リポジトリ外 → 通過
esac

# ---- worktree チェック -------------------------------------------------
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null) || exit 0
GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null) || exit 0

GIT_DIR_ABS=$(cd "$GIT_DIR" 2>/dev/null && pwd -P) || GIT_DIR_ABS="$GIT_DIR"
GIT_COMMON_ABS=$(cd "$GIT_COMMON" 2>/dev/null && pwd -P) || GIT_COMMON_ABS="$GIT_COMMON"

# サブモジュール内では何もしない
SUPERPROJECT=$(git rev-parse --show-superproject-working-tree 2>/dev/null) || SUPERPROJECT=""
[[ -n "$SUPERPROJECT" ]] && exit 0

# GIT_DIR == GIT_COMMON のとき → primary checkout（linked worktree ではない）→ ブロック
# 注意: ブランチが main かどうかは関係なく、primary checkout そのものを検出している
if [[ "$GIT_DIR_ABS" == "$GIT_COMMON_ABS" ]]; then
  printf '%s\n' \
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"primary checkout（worktree 外）でのリポジトリファイル編集はできません。修正前に EnterWorktree ツールで worktree を作成してください。"}}'
fi

exit 0

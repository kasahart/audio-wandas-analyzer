#!/usr/bin/env bash
# scripts/check-worktree.sh
#
# Claude Code の PreToolUse hook（Edit / Write）から呼ばれる共通ガード。
# main checkout を直接編集しようとした場合に Claude Code へ deny を返す。
#
# GitHub Copilot にはこの仕組みはないが、同じロジックを
# .github/copilot-instructions.md でテキスト指示として共有している。
#
# 使い方（hook コマンドから）:
#   bash "$(git rev-parse --show-toplevel 2>/dev/null)/scripts/check-worktree.sh"
#
# 出力:
#   main checkout の場合のみ Claude Code 向け deny JSON を stdout に出力する
#
# 終了コード:
#   0 - 常に（hook エラーとして誤検知させないため）

set -uo pipefail

# git リポジトリ外では何もしない
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null) || exit 0
GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null) || exit 0

# 絶対パスに正規化して比較
GIT_DIR_ABS=$(cd "$GIT_DIR" 2>/dev/null && pwd -P) || GIT_DIR_ABS="$GIT_DIR"
GIT_COMMON_ABS=$(cd "$GIT_COMMON" 2>/dev/null && pwd -P) || GIT_COMMON_ABS="$GIT_COMMON"

# サブモジュール内では何もしない（git-dir != git-common-dir になるが worktree ではない）
SUPERPROJECT=$(git rev-parse --show-superproject-working-tree 2>/dev/null) || SUPERPROJECT=""
[[ -n "$SUPERPROJECT" ]] && exit 0

# GIT_DIR == GIT_COMMON のとき → main checkout（linked worktree でない）→ ブロック
if [[ "$GIT_DIR_ABS" == "$GIT_COMMON_ABS" ]]; then
  printf '%s\n' \
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"mainブランチ直接でのファイル編集はできません。修正前に EnterWorktree ツールで worktree を作成してください。"}}'
fi

exit 0

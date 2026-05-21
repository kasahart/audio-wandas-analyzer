#!/usr/bin/env bash
# isolated git worktree を spawn する。
#
# 使い方:
#   scripts/worktree-new.sh <feature-slug> [base-branch]
#
# 動作:
#   - .worktrees/<slug>/ に git worktree を作成 (base-branch を fork、新規ブランチ <slug>)
#   - node_modules / .venv を symlink (容量と再 install 時間を節約)
#   - dist / .vscode-test / .pytest_cache は worktree 専用 (自動的に隔離される)
#
# なぜこれが必要か:
#   - 同じブランチを 2 つの worktree でチェックアウトはできないため、
#     PR スタック中の作業や並行エージェント実装には worktree を分けるしかない
#   - dist の共有は stale 起因のテスト誤判定の温床になる (実体験あり)
#   - node_modules / .venv は重複コストが大きいので共有する
#
# 並行エージェント運用への寄与:
#   各エージェントを別の worktree に配属することで、git index / dist の競合なく
#   並列実行できる。verify は完全に独立。

set -euo pipefail

slug="${1:-}"
base="${2:-main}"

if [[ -z "$slug" ]]; then
    echo "usage: $0 <feature-slug> [base-branch=main]" >&2
    exit 1
fi
if [[ ! "$slug" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
    echo "feature-slug must be kebab-case lowercase ASCII: '$slug'" >&2
    exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

worktree_dir=".worktrees/$slug"
branch="$slug"

if [[ -e "$worktree_dir" ]]; then
    echo "$worktree_dir already exists." >&2
    exit 1
fi

# base ブランチを最新化 (ネットワーク不可な環境ではローカルにフォールバック)。
# fetch は 10 秒で諦め、オフラインでもローカル参照から動けるようにする。
# fetch 成功時は origin/$base (最新) から、失敗時は local $base から worktree を切る。
fetch_ok=1
if ! timeout 10 git fetch origin "$base" --quiet 2>/dev/null; then
    fetch_ok=0
    echo "  (fetch skipped: using local $base)" >&2
fi

if [[ "$fetch_ok" -eq 1 ]] && git rev-parse --verify --quiet "origin/$base" >/dev/null; then
    fork_point="origin/$base"
elif git rev-parse --verify --quiet "$base" >/dev/null; then
    fork_point="$base"
else
    echo "base ref not found: tried origin/$base and local $base" >&2
    exit 1
fi

# worktree 作成
echo "  forking from: $fork_point"
git worktree add -b "$branch" "$worktree_dir" "$fork_point"

cd "$worktree_dir"

# node_modules / .venv を共有 (symlink)。dist / .vscode-test / .pytest_cache は隔離。
for shared in node_modules .venv; do
    if [[ -e "$repo_root/$shared" ]]; then
        ln -snf "$repo_root/$shared" "$shared"
        echo "  symlink: $shared -> $repo_root/$shared"
    fi
done

cat <<EOF

worktree ready: $repo_root/$worktree_dir (branch: $branch, from: $base)
  cd $worktree_dir
  npm run verify
EOF

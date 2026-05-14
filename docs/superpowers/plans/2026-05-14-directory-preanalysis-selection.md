# Directory Preanalysis Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ディレクトリ選択時に、対応音声ファイルだけをファイルツリーで選ばせてから解析する

**Architecture:** extension.ts で対応音声ファイルのツリーを構築し、ComparisonPanel の directory-selection モードへ渡す。Webview から返る filePaths は pure helper で再検証してから既存の analyzeMultipleFiles に流す。

**Tech Stack:** TypeScript, VS Code Webview, node:test, jsdom

---

### Task 1: メッセージ契約と helper を追加する

**Files:**
- Create: `src/utils/directorySelection.ts`
- Modify: `src/utils/audioTarget.ts`
- Test: `src/test/directorySelection.test.ts`
- Test: `src/test/audioTarget.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('collectAudioFilePaths flattens supported files in tree order', () => {
    assert.deepEqual(collectAudioFilePaths(TREE), ['/tmp/set-a/kick.wav']);
});

test('isAnalyzeSelectedFilesMessage only accepts string file path arrays', () => {
    assert.equal(isAnalyzeSelectedFilesMessage({ type: 'analyze-selected-files', filePaths: ['/tmp/a.wav'] }), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile && node --test dist/test/audioTarget.test.js dist/test/directorySelection.test.js`
Expected: FAIL because the helper module and new message guard do not exist yet

- [ ] **Step 3: Write minimal implementation**

```ts
export function collectAudioFilePaths(tree: DirectoryTreeNode[]): string[] { /* flatten recursively */ }
export function sanitizeSelectedAudioFilePaths(tree: DirectoryTreeNode[], selected: string[]): string[] { /* filter and dedupe */ }
export function isAnalyzeSelectedFilesMessage(message: unknown): message is AnalyzeSelectedFilesMessage { /* validate type + string[] */ }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run compile && node --test dist/test/audioTarget.test.js dist/test/directorySelection.test.js`
Expected: PASS

### Task 2: Webview に選択モードを追加する

**Files:**
- Modify: `src/panels/ComparisonPanel.ts`
- Test: `src/test/renderScript.integration.test.ts`

- [ ] **Step 1: Write the failing integration tests**

```ts
test('directory selection mode renders file tree checkboxes for audio files', () => {
    const { dom } = setupSelectionEnv();
    assert.equal(dom.window.document.querySelectorAll('.selection-file-checkbox').length, 2);
});

test('directory selection mode posts analyze-selected-files with checked file paths', () => {
    const { dom, postedMessages } = setupSelectionEnv();
    // uncheck one file and click submit
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run compile && node --test dist/test/renderScript.integration.test.js`
Expected: FAIL because selection mode UI is not rendered yet

- [ ] **Step 3: Write minimal implementation**

```ts
public static showDirectorySelection(...) { /* open same panel type with selection state */ }
// renderScript(): branch on state.mode === 'directory-selection'
// build tree markup, maintain selectedFilePaths, post analyze-selected-files
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run compile && node --test dist/test/renderScript.integration.test.js`
Expected: PASS

### Task 3: Extension 側で選択結果を受けて解析する

**Files:**
- Modify: `src/extension.ts`
- Modify: `src/panels/ComparisonPanel.ts`

- [ ] **Step 1: Wire directory selection panel into analyzeAudioTarget**

```ts
if ((targetStat.type & vscode.FileType.Directory) !== 0) {
    const tree = await buildDirectoryTree(targetUri, targetUri);
    const filePaths = collectAudioFilePaths(tree);
    const panel = ComparisonPanel.showDirectorySelection(...);
    panelDirectorySelections.set(panel, { tree });
    registerPanelMessageHandler(context, panel);
    return;
}
```

- [ ] **Step 2: Handle analyze-selected-files safely**

```ts
if (isAnalyzeSelectedFilesMessage(message)) {
    const selection = panelDirectorySelections.get(panel);
    const selectedFilePaths = sanitizeSelectedAudioFilePaths(selection.tree, message.filePaths);
    await analyzeMultipleFiles(context, selectedFilePaths, panel);
}
```

- [ ] **Step 3: Verify full test suite**

Run: `npm test`
Expected: PASS
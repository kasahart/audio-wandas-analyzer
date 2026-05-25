# Skill: UX Cognitive Auditor (UX認知的負荷監査スキル)

This skill defines the methodology, heuristics evaluation criteria, and checklist for assessing the extraneous cognitive load and UX of the Audio Wandas Analyzer VS Code Extension using screenshots captured from a live VS Code Electron environment.

## 1. Evaluation Methodology

When performing a visual UX audit using screenshots, evaluate the interface according to two primary dimensions: **Extraneous Cognitive Load** and **Nielsen/Krug Usability Heuristics**.

### A. Extraneous Cognitive Load Audit (認知的フリクション監査)
Extraneous cognitive load is mental effort spent on processing information or interface mechanisms that do not directly help the user accomplish their task.
- **Decision Fatigue & Micro-decisions**:
  - Does the interface force the user to make tiny, unnecessary decisions (e.g., choosing settings before seeing initial results)?
  - Are input fields requiring manual typing that could be automated or filled with sensible defaults/dropdowns?
- **Context Loss / Mode-Switching (ハイブリッドの罠)**:
  - If there is a chat/command interface (interactive agent) alongside a graphic GUI (buttons/waveforms), does switching between them cause confusion?
  - Does the GUI clearly reflect changes initiated via chat commands, and vice versa, preserving the user's mental model?
  - Are views, panels, or highlights lost or reset when switching tabs or focusing different files?

### B. Heuristics & Usability Verification (ニールセン/クルーグ原則の検証)
- **Visibility of System Status (システムステータスの視認性)**:
  - Are loading spinners, progress bars, or toast notifications displayed when long-running analysis or IPC requests occur?
  - Avoid *silent friction*: periods where the UI is frozen or silent, leaving the user wondering if the app crashed.
- **Recognition over Recall (記憶に頼る操作の排除)**:
  - Are all control capabilities visually discoverable rather than relying on keyboard shortcuts or hidden commands?
  - Are menus structured logically?
  - Are placeholders, auto-completions, and tooltips informative and guiding?
- **Error Prevention and Help (徹底したエラー防止設計)**:
  - Are destructive or heavy actions protected by confirmation dialogues?
  - Do error messages explain *why* something failed and offer a concrete resolution path, instead of presenting raw stack traces or ambiguous codes?

---

## 2. Findings Structure (報告形式の構造)

Each identified issue in `UX_AUDIT_REPORT.md` must be classified under:
- **Finding ID**: `UXH-NNN` (e.g., `UXH-001`)
- **Severity**:
  - `P0`: Critical blocker causing complete context loss, frozen UI, or critical user confusion. Must be fixed immediately.
  - `P1`: Significant friction. Heavy cognitive load or poor heuristics violation, but the user can still bypass it with difficulty.
  - `P2`: Minor improvement. Styling misalignment, minor discoverability issues, or lack of polished micro-animations.
- **Visual Evidence Description**: Describe what is shown in the screenshot that constitutes the issue.
- **Heuristic/Cognitive Explanation**: Why this is an issue and how it impacts the user's focus.
- **Fix Recommendation**: Concrete code, CSS, or layout suggestions (e.g., styling changes, adding loading indicators).

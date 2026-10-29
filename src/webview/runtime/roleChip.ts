/**
 * A recording's role chip (base 0, compare 1–3, or none): on each track's header and on the comparison's legend.
 * Its menu sets the same slots as the entry table's 0–3; with the chip focused, 0–3 set the role too (never by
 * where the pointer is). Taking the role off keeps the track.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import { ROLE_COLORS } from '../../shared/gui/roleColors';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { hintAttr } from './hintFooter';

export type RoleChipStrings = Pick<UiStrings, 'roleChipHint' | 'roleNone' | 'entryBase' | 'dsSlotCompare'>;

export interface RoleChipRole { slot: number; ch: number | null }

/** What the chip says: the slot, with the channel when a channel row is slotted (「1 ch2」); · without a role. */
export function roleChipText(role: RoleChipRole | undefined): string {
    return role ? `${role.slot}${role.ch ? ` ch${role.ch}` : ''}` : '·';
}

const roleLabel = (slot: number, strings: RoleChipStrings): string => (slot === 0 ? strings.entryBase : strings.dsSlotCompare.replace('{n}', String(slot)));

/** The chip; `fallback` colours a chip without a role (the track's own colour). Its menu is made when it opens. */
export function roleChipHtml(filePath: string, role: RoleChipRole | undefined, fallback: string, strings: RoleChipStrings): string {
    return '<details class="role-chip" data-file-path="' + escapeHtml(filePath) + '">'
        + '<summary class="role-chip-face' + (role ? '' : ' is-none') + '" style="' + (role ? 'background:' + ROLE_COLORS[role.slot] : '--role-fallback:' + fallback) + '" data-role="' + (role ? role.slot : '') + '"'
        + hintAttr(strings.roleChipHint) + ' aria-label="' + escapeHtml((role ? roleLabel(role.slot, strings) : strings.roleNone) + ' — ' + strings.roleChipHint) + '">' + escapeHtml(roleChipText(role)) + '</summary>'
        + '<div class="role-chip-menu"></div>'
        + '</details>';
}

/** The chip's menu: base, compare 1–3 and none, the current one marked. */
export function roleChipMenuHtml(current: number | null, strings: RoleChipStrings): string {
    const item = (slot: number | null, text: string): string => '<button type="button" class="role-chip-item' + (current === slot ? ' is-current' : '') + '" data-action="track-role-set" data-slot="' + (slot ?? '') + '">'
        + '<span class="role-chip-mark' + (slot === null ? ' is-none' : '') + '"' + (slot === null ? '' : ' style="background:' + ROLE_COLORS[slot] + '"') + '>' + (slot === null ? '·' : slot) + '</span>' + escapeHtml(text)
        + (slot === null ? '' : '<kbd>' + slot + '</kbd>') + '</button>';
    return [0, 1, 2, 3].map(slot => item(slot, roleLabel(slot, strings))).join('') + item(null, strings.roleNone);
}

export interface RoleChipHost {
    setRole(filePath: string, slot: number | null): void;
}

/** Handles every role chip under `root`: its menu, 0–3 on a focused chip, and a press elsewhere closing an open menu. */
export function attachRoleChips(root: Document, host: RoleChipHost, strings: RoleChipStrings): void {
    const chipOf = (target: EventTarget | null): HTMLDetailsElement | null => ((target as Element | null)?.closest?.('details.role-chip') as HTMLDetailsElement | null) ?? null;
    /** Sets the role and keeps the focus on that recording's chip, which a redraw may replace (the next 0–3 still lands there). */
    const setRole = (chip: HTMLDetailsElement, slot: number | null, focused: boolean): void => {
        const filePath = chip.dataset.filePath ?? '';
        const scope = chip.closest('[data-stage-legend]') ? '[data-stage-legend]' : '.track-header';
        host.setRole(filePath, slot);
        if (!focused) return;
        const face = (): HTMLElement | null => root.querySelector<HTMLElement>(scope + ' details.role-chip[data-file-path="' + CSS.escape(filePath) + '"] > summary');
        face()?.focus();
        let frames = 10;
        const keep = (): void => {
            const active = root.activeElement;
            if (!active || active === root.body) face()?.focus();
            if (--frames > 0) requestAnimationFrame(keep);
        };
        requestAnimationFrame(keep);
    };
    root.addEventListener('click', event => {
        const item = (event.target as Element | null)?.closest?.('[data-action="track-role-set"]') as HTMLElement | null;
        const chip = chipOf(item);
        if (!item || !chip) return;
        event.preventDefault();
        chip.open = false;
        const slot = item.dataset.slot;
        setRole(chip, slot === '' || slot === undefined ? null : Number(slot), true);
    });
    // Captured first, so the comparison's and the lanes' own keys (0 resets the zoom, 1–3 compare a slot) leave a focused chip alone.
    root.addEventListener('keydown', event => {
        const chip = chipOf(event.target);
        if (!chip || event.ctrlKey || event.metaKey || event.altKey) return;
        if (/^[0-3]$/.test(event.key)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            chip.open = false;
            setRole(chip, Number(event.key), true);
        } else if (event.key === 'Escape' && chip.open) {
            event.preventDefault();
            event.stopImmediatePropagation();
            chip.open = false;
            chip.querySelector<HTMLElement>('summary')?.focus();
        }
    }, true);
    // The menu is made as the chip opens (closed, the chip is its face alone: the legend's text stays the file's).
    root.addEventListener('toggle', event => {
        const chip = event.target as HTMLDetailsElement | null;
        if (!chip?.classList?.contains('role-chip')) return;
        const menu = chip.querySelector<HTMLElement>('.role-chip-menu');
        if (!menu) return;
        if (!chip.open) { menu.innerHTML = ''; return; }
        const role = chip.querySelector<HTMLElement>('.role-chip-face')?.dataset.role ?? '';
        menu.innerHTML = roleChipMenuHtml(role === '' ? null : Number(role), strings);
    }, true);
    root.addEventListener('pointerdown', event => {
        const inside = chipOf(event.target);
        root.querySelectorAll<HTMLDetailsElement>('details.role-chip[open]').forEach(chip => { if (chip !== inside) chip.open = false; });
    }, true);
}

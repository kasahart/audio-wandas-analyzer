import type { UiStrings } from '../../shared/i18n/strings';
import { recipeTitle, type RecipeCatalogEntry } from '../../shared/recipe/recipeFlow';
import { createHintFooter, setHint } from './hintFooter';

export type RecipePick = { location: string } | { file: File };

export interface RecipeMenus {
    /** One button per bundled recipe plus one that opens a local `.recipe.json`. */
    pickRecipe(entries: RecipeCatalogEntry[]): Promise<RecipePick | undefined>;
    /** One file selector per Recipe input, preset to `proposed`, and a run button. */
    assignInputs(names: string[], files: Array<{ path: string; name: string }>, proposed: Record<string, string>): Promise<Record<string, string> | undefined>;
}

/**
 * In-page recipe popovers for the static Web host. Each drops down under the toolbar's Export menu and
 * resolves undefined on Escape or a click elsewhere; opening another cancels the open one so no run waits forever.
 */
export function createRecipeMenus(document: Document, strings: UiStrings): RecipeMenus {
    let cancelOpen: (() => void) | undefined;
    function open<T>(build: (menu: HTMLElement, finish: (value: T | undefined) => void) => void): Promise<T | undefined> {
        cancelOpen?.();
        return new Promise(resolve => {
            const menu = document.createElement('div');
            menu.className = 'tb-menu-popover';
            menu.setAttribute('data-recipe-picker', '');
            menu.setAttribute('role', 'menu');
            menu.setAttribute('aria-label', strings.browserRecipePick);
            const workflow = document.querySelector<HTMLDetailsElement>('[data-action="run-recipe"]')?.closest<HTMLDetailsElement>('details.tb-menu');
            const anchor = workflow?.querySelector('summary')?.getBoundingClientRect();
            if (workflow) workflow.open = false;
            // The page may have scrolled the menu's summary off the top; the picker stays on screen.
            const top = Math.max(8, anchor ? anchor.bottom + 4 : 40);
            // A Recipe with many inputs must not push Run below a short window.
            menu.style.cssText = `position:fixed;top:${top}px;left:${anchor ? anchor.left : 8}px;max-height:calc(100vh - ${top + 8}px);overflow-y:auto`;
            // Capture keys before the page's shortcuts: Space must press the focused item, not toggle playback,
            // and Escape must only close this menu, not also restore a maximized spectrum.
            const onKey = (event: KeyboardEvent): void => {
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(undefined); }
                else if (menu.contains(event.target as Node)) event.stopPropagation();
            };
            const onPointer = (event: Event): void => { if (!menu.contains(event.target as Node)) finish(undefined); };
            function finish(value: T | undefined): void {
                cancelOpen = undefined;
                menu.remove();
                // The removed menu fires no mouseout, so its hint would otherwise stay until the pointer moves.
                createHintFooter(document).clearIfShowing(strings.hintRecipeOpenFile);
                document.removeEventListener('keydown', onKey, true);
                document.removeEventListener('pointerdown', onPointer, true);
                resolve(value);
            }
            build(menu, finish);
            cancelOpen = () => finish(undefined);
            document.addEventListener('keydown', onKey, true);
            document.addEventListener('pointerdown', onPointer, true);
            document.body.append(menu);
            // Under a menu near the window's right edge it would run off screen: it moves left to stay in.
            const right = menu.getBoundingClientRect?.().right, width = document.documentElement?.clientWidth;
            if (right !== undefined && width && right > width - 8) menu.style.left = `${Math.max(8, (anchor ? anchor.left : 8) - (right - width + 8))}px`;
            (menu.querySelector('select, button') as HTMLElement | null)?.focus();
        });
    }
    function button(menu: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
        const item = document.createElement('button');
        item.className = 'tb-btn';
        item.setAttribute('role', 'menuitem');
        item.textContent = label;
        item.onclick = onClick;
        menu.append(item);
        return item;
    }
    return {
        pickRecipe: entries => open<RecipePick>((menu, finish) => {
            for (const entry of entries) {
                button(menu, recipeTitle(entry.name), () => finish({ location: entry.location })).setAttribute('data-action', 'browser-recipe-pick');
            }
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.json,application/json';
            fileInput.hidden = true;
            fileInput.onchange = (): void => { const file = fileInput.files?.[0]; if (file) finish({ file }); };
            const openFile = button(menu, strings.browserRecipeOpenFile, () => fileInput.click());
            openFile.setAttribute('data-action', 'browser-recipe-file');
            setHint(openFile, strings.hintRecipeOpenFile);
            menu.append(fileInput);
        }),
        assignInputs: (names, files, proposed) => open<Record<string, string>>((menu, finish) => {
            const selects = names.map(name => {
                const row = document.createElement('label');
                row.className = 'tb-menu-row';
                const caption = document.createElement('span');
                caption.className = 'tb-label';
                caption.textContent = name;
                const select = document.createElement('select');
                select.setAttribute('data-action', 'browser-recipe-input');
                select.setAttribute('data-recipe-input', name);
                for (const file of files) {
                    const option = document.createElement('option');
                    option.value = file.path;
                    option.textContent = file.name;
                    select.append(option);
                }
                select.value = proposed[name];
                row.append(caption, select);
                menu.append(row);
                return [name, select] as const;
            });
            button(menu, strings.browserRecipeRun, () => finish(Object.fromEntries(selects.map(([name, select]) => [name, select.value]))))
                .setAttribute('data-action', 'browser-recipe-run');
        }),
    };
}

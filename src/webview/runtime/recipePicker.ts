import type { UiStrings } from '../../shared/i18n/strings';
import { recipeTitle, type RecipeCatalogEntry } from '../../shared/recipe/recipeFlow';
import { createHintFooter, setHint } from './hintFooter';

export type RecipePick = { location: string } | { file: File };

/**
 * In-page recipe menu for the static Web host: one button per bundled recipe plus one that opens a local
 * `.recipe.json`. It drops down under the toolbar's Workflow menu and resolves undefined on Escape or a
 * click elsewhere; opening it again cancels the previous one so no run waits forever.
 */
export function createRecipePicker(document: Document, strings: UiStrings): (entries: RecipeCatalogEntry[]) => Promise<RecipePick | undefined> {
    let cancelOpen: (() => void) | undefined;
    return entries => {
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
            menu.style.cssText = `position:fixed;top:${anchor ? anchor.bottom + 4 : 40}px;left:${anchor ? anchor.left : 8}px`;
            const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') finish(undefined); };
            const onPointer = (event: Event): void => { if (!menu.contains(event.target as Node)) finish(undefined); };
            function finish(pick: RecipePick | undefined): void {
                cancelOpen = undefined;
                menu.remove();
                // The removed menu fires no mouseout, so its hint would otherwise stay until the pointer moves.
                createHintFooter(document).clearIfShowing(strings.hintRecipeOpenFile);
                document.removeEventListener('keydown', onKey, true);
                document.removeEventListener('pointerdown', onPointer, true);
                resolve(pick);
            }
            function item(label: string, onClick: () => void): HTMLButtonElement {
                const button = document.createElement('button');
                button.className = 'tb-btn';
                button.setAttribute('role', 'menuitem');
                button.textContent = label;
                button.onclick = onClick;
                menu.append(button);
                return button;
            }
            for (const entry of entries) {
                item(recipeTitle(entry.name), () => finish({ location: entry.location })).setAttribute('data-action', 'browser-recipe-pick');
            }
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.json,application/json';
            fileInput.hidden = true;
            fileInput.onchange = (): void => { const file = fileInput.files?.[0]; if (file) finish({ file }); };
            const openFile = item(strings.browserRecipeOpenFile, () => fileInput.click());
            openFile.setAttribute('data-action', 'browser-recipe-file');
            setHint(openFile, strings.hintRecipeOpenFile);
            menu.append(fileInput);
            cancelOpen = () => finish(undefined);
            document.addEventListener('keydown', onKey, true);
            document.addEventListener('pointerdown', onPointer, true);
            document.body.append(menu);
            (menu.querySelector('button') as HTMLButtonElement | null)?.focus();
        });
    };
}

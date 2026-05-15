export interface DebugStartupBehavior {
    autoOpenDebugTarget: boolean;
    autoSelectAllDirectoryFiles: boolean;
    closePanelOnStartup: boolean;
}

export function isEnabledEnvFlag(value: string | undefined): boolean {
    if (!value) {
        return false;
    }

    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true';
}

export function getDebugStartupBehavior(env: Record<string, string | undefined>): DebugStartupBehavior {
    return {
        autoOpenDebugTarget: isEnabledEnvFlag(env['AUDIO_WANDAS_AUTO_OPEN_DEBUG']),
        autoSelectAllDirectoryFiles: isEnabledEnvFlag(env['AUDIO_WANDAS_AUTO_SELECT_ALL_DEBUG_DIR']),
        closePanelOnStartup: isEnabledEnvFlag(env['AUDIO_WANDAS_CLOSE_PANEL_ON_STARTUP']),
    };
}
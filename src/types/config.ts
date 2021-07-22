// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

export type Tab = {
    name: string;
    order: number;
}

export type Team = Tab & {
    url: string;
    lastActiveTab?: number;
}

export type TeamWithIndex = Team & {index: number};
export type TeamWithTabs = Team & {tabs: Tab[]};

export type Config = ConfigV3;

export type ConfigV3 = {
    version: 3;
    teams: TeamWithTabs[];
    showTrayIcon: boolean;
    trayIconTheme: string;
    minimizeToTray: boolean;
    notifications: {
        flashWindow: number;
        bounceIcon: boolean;
        bounceIconType: 'critical' | 'informational';
    };
    showUnreadBadge: boolean;
    useSpellChecker: boolean;
    enableHardwareAcceleration: boolean;
    autostart: boolean;
    spellCheckerLocale: string;
    darkMode: boolean;
    downloadLocation: string;
}

export type ConfigV2 = {
    version: 2;
    teams: Array<{
        name: string;
        url: string;
        order: number;
    }>;
    showTrayIcon: boolean;
    trayIconTheme: string;
    minimizeToTray: boolean;
    notifications: {
        flashWindow: number;
        bounceIcon: boolean;
        bounceIconType: 'critical' | 'informational';
    };
    showUnreadBadge: boolean;
    useSpellChecker: boolean;
    enableHardwareAcceleration: boolean;
    autostart: boolean;
    spellCheckerLocale: string;
    darkMode: boolean;
    downloadLocation: string;
}

export type ConfigV1 = {
    version: 1;
    teams: Array<{
        name: string;
        url: string;
    }>;
    showTrayIcon: boolean;
    trayIconTheme: string;
    minimizeToTray: boolean;
    notifications: {
        flashWindow: number;
        bounceIcon: boolean;
        bounceIconType: 'critical' | 'informational';
    };
    showUnreadBadge: boolean;
    useSpellChecker: boolean;
    enableHardwareAcceleration: boolean;
    autostart: boolean;
    spellCheckerLocale: string;
}

export type ConfigV0 = {version: 0; url: string};

export type AnyConfig = ConfigV3 | ConfigV2 | ConfigV1 | ConfigV0;

export type BuildConfig = {
    defaultTeams?: Team[];
    helpLink: string;
    enableServerManagement: boolean;
    enableAutoUpdater: boolean;
    managedResources: string[];
}

export type RegistryConfig = {
    teams: Team[];
    enableServerManagement: boolean;
    enableAutoUpdater: boolean;
}

export type CombinedConfig = ConfigV3 & BuildConfig & {
    registryTeams: Team[];
    appName: string;
    useNativeWindow: boolean;

}

export type LocalConfiguration = Config & {
    appName: string;
    enableServerManagement: boolean;
}

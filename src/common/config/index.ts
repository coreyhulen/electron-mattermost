// Copyright (c) 2015-2016 Yuya Ochiai
// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import fs from 'fs';

import os from 'os';
import path from 'path';

import {EventEmitter} from 'events';
import {ipcMain, nativeTheme, app} from 'electron';
import log from 'electron-log';

import {
    AnyConfig,
    BuildConfig,
    CombinedConfig,
    Config as ConfigType,
    LocalConfiguration,
    RegistryConfig as RegistryConfigType,
    TeamWithTabs,
} from 'types/config';

import {UPDATE_TEAMS, GET_CONFIGURATION, UPDATE_CONFIGURATION, GET_LOCAL_CONFIGURATION} from 'common/communication';

import * as Validator from 'main/Validator';
import {getDefaultTeamWithTabsFromTeam} from 'common/tabs/TabView';

import defaultPreferences, {getDefaultDownloadLocation} from './defaultPreferences';
import upgradeConfigData from './upgradePreferences';
import buildConfig from './buildConfig';
import RegistryConfig, {REGISTRY_READ_EVENT} from './RegistryConfig';

/**
 * Handles loading and merging all sources of configuration as well as saving user provided config
 */

export default class Config extends EventEmitter {
    configFilePath: string;

    registryConfig: RegistryConfig;

    combinedData?: CombinedConfig;
    registryConfigData?: Partial<RegistryConfigType>;
    defaultConfigData?: ConfigType;
    buildConfigData?: BuildConfig;
    localConfigData?: ConfigType;
    useNativeWindow: boolean;

    constructor(configFilePath: string) {
        super();
        this.configFilePath = configFilePath;
        this.registryConfig = new RegistryConfig();
        try {
            this.useNativeWindow = os.platform() === 'win32' && (parseInt(os.release().split('.')[0], 10) < 10);
        } catch {
            this.useNativeWindow = false;
        }
    }

    // separating constructor from init so main can setup event listeners
    init = (): void => {
        this.reload();
        this.registryConfig.once(REGISTRY_READ_EVENT, this.loadRegistry);
        this.registryConfig.init();
    }

    /**
     * Gets the teams from registry into the config object and reload
     *
     * @param {object} registryData Team configuration from the registry and if teams can be managed by user
     */

    loadRegistry = (registryData: Partial<RegistryConfigType>): void => {
        this.registryConfigData = registryData;
        this.reload();
        ipcMain.handle(GET_CONFIGURATION, this.handleGetConfiguration);
        ipcMain.handle(GET_LOCAL_CONFIGURATION, this.handleGetLocalConfiguration);
        ipcMain.handle(UPDATE_TEAMS, this.handleUpdateTeams);
        ipcMain.on(UPDATE_CONFIGURATION, this.setMultiple);
        if (process.platform === 'darwin' || process.platform === 'win32') {
            nativeTheme.on('updated', this.handleUpdateTheme);
        }
    }

    /**
     * Reload all sources of config data
     *
     * @param {boolean} synchronize determines whether or not to emit a synchronize event once config has been reloaded
     * @emits {update} emitted once all data has been loaded and merged
     * @emits {synchronize} emitted when requested by a call to method; used to notify other config instances of changes
     */
    reload = (): void => {
        this.defaultConfigData = this.loadDefaultConfigData();
        this.buildConfigData = this.loadBuildConfigData();
        const loadedConfig = this.loadLocalConfigFile();
        this.localConfigData = this.checkForConfigUpdates(loadedConfig);
        this.regenerateCombinedConfigData();

        this.emit('update', this.combinedData);
        this.emit('synchronize');
    }

    /**
     * Used to save a single config property
     *
     * @param {string} key name of config property to be saved
     * @param {*} data value to save for provided key
     */
    set = (key: keyof ConfigType, data: ConfigType[keyof ConfigType]): void => {
        if (key && this.localConfigData) {
            this.localConfigData = Object.assign({}, this.localConfigData, {[key]: data});
            this.regenerateCombinedConfigData();
            this.saveLocalConfigData();
        }
    }

    /**
     * Used to save an array of config properties in one go
     *
     * @param {array} properties an array of config properties to save
     */
    setMultiple = (event: Electron.IpcMainEvent, properties: Array<{key: keyof ConfigType; data: ConfigType[keyof ConfigType]}> = []): Partial<ConfigType> | undefined => {
        if (properties.length) {
            this.localConfigData = Object.assign({}, this.localConfigData, ...properties.map(({key, data}) => ({[key]: data})));
            this.regenerateCombinedConfigData();
            this.saveLocalConfigData();
        }

        return this.localConfigData; //this is the only part that changes
    }

    setRegistryConfigData = (registryConfigData = {teams: []}): void => {
        this.registryConfigData = Object.assign({}, registryConfigData);
        this.reload();
    }

    /**
     * Used to replace the existing config data with new config data
     *
     * @param {object} configData a new, config data object to completely replace the existing config data
     */
    replace = (configData: ConfigType) => {
        const newConfigData = configData;

        this.localConfigData = Object.assign({}, this.localConfigData, newConfigData);

        this.regenerateCombinedConfigData();
        this.saveLocalConfigData();
    }

    /**
     * Used to save the current set of local config data to disk
     *
     * @emits {update} emitted once all data has been saved
     * @emits {synchronize} emitted once all data has been saved; used to notify other config instances of changes
     * @emits {error} emitted if saving local config data to file fails
     */
    saveLocalConfigData = (): void => {
        if (!this.localConfigData) {
            return;
        }

        try {
            this.writeFile(this.configFilePath, this.localConfigData, (error: NodeJS.ErrnoException | null) => {
                if (error) {
                    throw new Error(error.message);
                }
                this.emit('update', this.combinedData);
                this.emit('synchronize');
            });
        } catch (error) {
            this.emit('error', error);
        }
    }

    // getters for accessing the various config data inputs

    get data() {
        return this.combinedData;
    }
    get localData() {
        return this.localConfigData ?? defaultPreferences;
    }
    get defaultData() {
        return this.defaultConfigData ?? defaultPreferences;
    }
    get buildData() {
        return this.buildConfigData ?? buildConfig;
    }
    get registryData() {
        return this.registryConfigData;
    }

    // convenience getters

    get version() {
        return this.combinedData?.version ?? defaultPreferences.version;
    }
    get teams() {
        return this.combinedData?.teams ?? defaultPreferences.teams;
    }
    get darkMode() {
        return this.combinedData?.darkMode ?? defaultPreferences.darkMode;
    }
    get localTeams() {
        return this.localConfigData?.teams ?? defaultPreferences.version;
    }
    get predefinedTeams() {
        return [...this.buildConfigData?.defaultTeams ?? [], ...this.registryConfigData?.teams ?? []];
    }
    get enableHardwareAcceleration() {
        return this.combinedData?.enableHardwareAcceleration ?? defaultPreferences.enableHardwareAcceleration;
    }
    get enableServerManagement() {
        return this.combinedData?.enableServerManagement ?? buildConfig.enableServerManagement;
    }
    get enableAutoUpdater() {
        return this.combinedData?.enableAutoUpdater ?? buildConfig.enableAutoUpdater;
    }
    get autostart() {
        return this.combinedData?.autostart ?? defaultPreferences.autostart;
    }
    get notifications() {
        return this.combinedData?.notifications ?? defaultPreferences.notifications;
    }
    get showUnreadBadge() {
        return this.combinedData?.showUnreadBadge ?? defaultPreferences.showUnreadBadge;
    }
    get useSpellChecker() {
        return this.combinedData?.useSpellChecker ?? defaultPreferences.useSpellChecker;
    }
    get spellCheckerLocale() {
        return this.combinedData?.spellCheckerLocale ?? defaultPreferences.spellCheckerLocale;
    }
    get showTrayIcon() {
        return this.combinedData?.showTrayIcon ?? defaultPreferences.showTrayIcon;
    }
    get trayIconTheme() {
        return this.combinedData?.trayIconTheme ?? defaultPreferences.trayIconTheme;
    }
    get downloadLocation() {
        return this.combinedData?.downloadLocation ?? getDefaultDownloadLocation();
    }
    get helpLink() {
        return this.combinedData?.helpLink;
    }

    // initialization/processing methods

    /**
     * Returns a copy of the app's default config data
     */
    loadDefaultConfigData = () => {
        return this.copy(defaultPreferences);
    }

    /**
     * Returns a copy of the app's build config data
     */
    loadBuildConfigData = () => {
        return this.copy(buildConfig);
    }

    /**
     * Loads and returns locally stored config data from the filesystem or returns app defaults if no file is found
     */
    loadLocalConfigFile = (): AnyConfig => {
        let configData: AnyConfig;
        try {
            configData = this.readFileSync(this.configFilePath);

            // validate based on config file version
            switch (configData.version) {
            case 3:
                configData = Validator.validateV3ConfigData(configData)!;
                break;
            case 2:
                configData = Validator.validateV2ConfigData(configData)!;
                break;
            case 1:
                configData = Validator.validateV1ConfigData(configData)!;
                break;
            default:
                configData = Validator.validateV0ConfigData(configData)!;
            }
            if (!configData) {
                throw new Error('Provided configuration file does not validate, using defaults instead.');
            }
        } catch (e) {
            log.warn('Failed to load configuration file from the filesystem. Using defaults.');
            configData = this.copy(this.defaultConfigData);

            this.writeFileSync(this.configFilePath, configData);
        }
        return configData;
    }

    /**
     * Determines if locally stored data needs to be updated and upgrades as needed
     *
     * @param {*} data locally stored data
     */
    checkForConfigUpdates = (data: AnyConfig) => {
        let configData = data;
        if (this.defaultConfigData) {
            try {
                if (configData.version !== this.defaultConfigData.version) {
                    configData = upgradeConfigData(configData);
                    this.writeFileSync(this.configFilePath, configData);
                    log.info(`Configuration updated to version ${this.defaultConfigData.version} successfully.`);
                }
            } catch (error) {
                log.error(`Failed to update configuration to version ${this.defaultConfigData.version}.`);
            }
        }

        return configData as ConfigType;
    }

    /**
     * Properly combines all sources of data into a single, manageable set of all config data
     */
    regenerateCombinedConfigData = () => {
        // combine all config data in the correct order
        this.combinedData = Object.assign({}, this.defaultConfigData, this.localConfigData, this.buildConfigData, this.registryConfigData, {useNativeWindow: this.useNativeWindow});

        // remove unecessary data pulled from default and build config
        delete this.combinedData!.defaultTeams;

        // IMPORTANT: properly combine teams from all sources
        let combinedTeams: TeamWithTabs[] = [];

        // - start by adding default teams from buildConfig, if any
        if (this.buildConfigData?.defaultTeams?.length) {
            combinedTeams.push(...this.buildConfigData.defaultTeams.map((team) => getDefaultTeamWithTabsFromTeam(team)));
        }

        // - add registry defined teams, if any
        if (this.registryConfigData?.teams?.length) {
            combinedTeams.push(...this.registryConfigData.teams.map((team) => getDefaultTeamWithTabsFromTeam(team)));
        }

        // - add locally defined teams only if server management is enabled
        if (this.localConfigData && this.enableServerManagement) {
            combinedTeams.push(...this.localConfigData.teams || []);
        }

        combinedTeams = this.filterOutDuplicateTeams(combinedTeams);
        combinedTeams = this.sortUnorderedTeams(combinedTeams);

        if (this.combinedData) {
            this.combinedData.teams = combinedTeams;
            this.combinedData.registryTeams = this.registryConfigData?.teams || [];
            if (process.platform === 'darwin' || process.platform === 'win32') {
                this.combinedData.darkMode = nativeTheme.shouldUseDarkColors;
            }
            this.combinedData.appName = app.name;
        }
    }

    /**
     * Returns the provided list of teams with duplicates filtered out
     *
     * @param {array} teams array of teams to check for duplicates
     */
    filterOutDuplicateTeams = (teams: TeamWithTabs[]) => {
        let newTeams = teams;
        const uniqueURLs = new Set();
        newTeams = newTeams.filter((team) => {
            return uniqueURLs.has(`${team.name}:${team.url}`) ? false : uniqueURLs.add(`${team.name}:${team.url}`);
        });
        return newTeams;
    }

    /**
     * Returns the provided array fo teams with existing teams filtered out
     * @param {array} teams array of teams to check for already defined teams
     */
    filterOutPredefinedTeams = (teams: TeamWithTabs[]) => {
        let newTeams = teams;

        // filter out predefined teams
        newTeams = newTeams.filter((newTeam) => {
            return this.predefinedTeams.findIndex((existingTeam) => newTeam.url === existingTeam.url) === -1; // eslint-disable-line max-nested-callbacks
        });

        return newTeams;
    }

    /**
     * Apply a default sort order to the team list, if no order is specified.
     * @param {array} teams to sort
     */
    sortUnorderedTeams = (teams: TeamWithTabs[]) => {
        // We want to preserve the array order of teams in the config, otherwise a lot of bugs will occur
        const mappedTeams = teams.map((team, index) => ({team, originalOrder: index}));

        // Make a best pass at interpreting sort order. If an order is not specified, assume it is 0.
        //
        const newTeams = mappedTeams.sort((x, y) => {
            if (!x.team.order) {
                x.team.order = 0;
            }
            if (!y.team.order) {
                y.team.order = 0;
            }

            // once we ensured `order` exists, we can sort numerically
            return x.team.order - y.team.order;
        });

        // Now re-number all items from 0 to (max), ensuring user's sort order is preserved. The
        // new tabbed interface requires an item with order:0 in order to raise the first tab.
        //
        newTeams.forEach((mappedTeam, i) => {
            mappedTeam.team.order = i;
        });

        return newTeams.sort((x, y) => x.originalOrder - y.originalOrder).map((mappedTeam) => mappedTeam.team);
    }

    // helper functions

    readFileSync = (filePath: string) => {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }

    writeFile = (filePath: string, configData: Partial<ConfigType>, callback: fs.NoParamCallback) => {
        if (!this.defaultConfigData) {
            return;
        }

        if (configData.version !== this.defaultConfigData.version) {
            throw new Error('version ' + configData.version + ' is not equal to ' + this.defaultConfigData.version);
        }
        const json = JSON.stringify(configData, null, '  ');
        fs.writeFile(filePath, json, 'utf8', callback);
    }

    writeFileSync = (filePath: string, config: Partial<ConfigType>) => {
        if (!this.defaultConfigData) {
            return;
        }

        if (config.version !== this.defaultConfigData.version) {
            throw new Error('version ' + config.version + ' is not equal to ' + this.defaultConfigData.version);
        }

        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir);
        }

        const json = JSON.stringify(config, null, '  ');
        fs.writeFileSync(filePath, json, 'utf8');
    }

    merge = <T, T2>(base: T, target: T2) => {
        return Object.assign({}, base, target);
    }

    copy = <T>(data: T) => {
        return Object.assign({}, data);
    }

    handleGetConfiguration = (event: Electron.IpcMainInvokeEvent, option: keyof CombinedConfig) => {
        const config = {...this.combinedData};
        if (option) {
            return config[option];
        }
        return config;
    }

    handleGetLocalConfiguration = (event: Electron.IpcMainInvokeEvent, option: keyof ConfigType) => {
        const config: Partial<LocalConfiguration> = {...this.localConfigData};
        config.appName = app.name;
        config.enableServerManagement = this.combinedData?.enableServerManagement;
        if (option) {
            return config[option];
        }
        return config;
    }

    handleUpdateTeams = (event: Electron.IpcMainInvokeEvent, newTeams: TeamWithTabs[]) => {
        this.set('teams', newTeams);
        return this.combinedData!.teams;
    }

    /**
     * Detects changes in darkmode if it is windows or osx, updates the config and propagates the changes
     * @emits 'darkModeChange'
     */
    handleUpdateTheme = () => {
        if (this.combinedData && this.combinedData.darkMode !== nativeTheme.shouldUseDarkColors) {
            this.combinedData.darkMode = nativeTheme.shouldUseDarkColors;
            this.emit('darkModeChange', this.combinedData.darkMode);
        }
    }

    /**
     * Manually toggles dark mode for OSes that don't have a native dark mode setting
     * @emits 'darkModeChange'
     */
    toggleDarkModeManually = () => {
        if (!this.combinedData) {
            return;
        }

        this.set('darkMode', !this.combinedData.darkMode);
        this.emit('darkModeChange', this.combinedData.darkMode);
    }
}

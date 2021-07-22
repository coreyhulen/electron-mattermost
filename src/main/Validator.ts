// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import log from 'electron-log';

import Joi from '@hapi/joi';

import {Args} from 'types/args';
import {ConfigV0, ConfigV1, ConfigV2, ConfigV3} from 'types/config';
import {SavedWindowState} from 'types/mainWindow';
import {AppState} from 'types/appState';
import {ComparableCertificate} from 'types/certificate';
import {PermissionType, TrustedOrigin} from 'types/trustedOrigin';

import urlUtils from 'common/utils/url';

const defaultOptions = {
    stripUnknown: true,
};
const defaultWindowWidth = 1000;
const defaultWindowHeight = 700;
const minWindowWidth = 400;
const minWindowHeight = 240;

const argsSchema = Joi.object<Args>({
    hidden: Joi.boolean(),
    disableDevMode: Joi.boolean(),
    dataDir: Joi.string(),
    version: Joi.boolean(),
});

const boundsInfoSchema = Joi.object<SavedWindowState>({
    x: Joi.number().integer().default(0),
    y: Joi.number().integer().default(0),
    width: Joi.number().integer().min(minWindowWidth).required().default(defaultWindowWidth),
    height: Joi.number().integer().min(minWindowHeight).required().default(defaultWindowHeight),
    maximized: Joi.boolean().default(false),
    fullscreen: Joi.boolean().default(false),
});

const appStateSchema = Joi.object<AppState>({
    lastAppVersion: Joi.string(),
    skippedVersion: Joi.string(),
    updateCheckedDate: Joi.string(),
});

const configDataSchemaV0 = Joi.object<ConfigV0>({
    url: Joi.string().required(),
});

const configDataSchemaV1 = Joi.object<ConfigV1>({
    version: Joi.number().min(1).default(1),
    teams: Joi.array().items(Joi.object({
        name: Joi.string().required(),
        url: Joi.string().required(),
    })).default([]),
    showTrayIcon: Joi.boolean().default(false),
    trayIconTheme: Joi.any().allow('').valid('light', 'dark').default('light'),
    minimizeToTray: Joi.boolean().default(false),
    notifications: Joi.object({
        flashWindow: Joi.any().valid(0, 2).default(0),
        bounceIcon: Joi.boolean().default(false),
        bounceIconType: Joi.any().allow('').valid('informational', 'critical').default('informational'),
    }),
    showUnreadBadge: Joi.boolean().default(true),
    useSpellChecker: Joi.boolean().default(true),
    enableHardwareAcceleration: Joi.boolean().default(true),
    autostart: Joi.boolean().default(true),
    spellCheckerLocale: Joi.string().regex(/^[a-z]{2}-[A-Z]{2}$/).default('en-US'),
});

const configDataSchemaV2 = Joi.object<ConfigV2>({
    version: Joi.number().min(2).default(2),
    teams: Joi.array().items(Joi.object({
        name: Joi.string().required(),
        url: Joi.string().required(),
        order: Joi.number().integer().min(0),
    })).default([]),
    showTrayIcon: Joi.boolean().default(false),
    trayIconTheme: Joi.any().allow('').valid('light', 'dark').default('light'),
    minimizeToTray: Joi.boolean().default(false),
    notifications: Joi.object({
        flashWindow: Joi.any().valid(0, 2).default(0),
        bounceIcon: Joi.boolean().default(false),
        bounceIconType: Joi.any().allow('').valid('informational', 'critical').default('informational'),
    }),
    showUnreadBadge: Joi.boolean().default(true),
    useSpellChecker: Joi.boolean().default(true),
    enableHardwareAcceleration: Joi.boolean().default(true),
    autostart: Joi.boolean().default(true),
    spellCheckerLocale: Joi.string().regex(/^[a-z]{2}-[A-Z]{2}$/).default('en-US'),
    spellCheckerURL: Joi.string().allow(null),
    darkMode: Joi.boolean().default(false),
    downloadLocation: Joi.string(),
});

const configDataSchemaV3 = Joi.object<ConfigV3>({
    version: Joi.number().min(2).default(2),
    teams: Joi.array().items(Joi.object({
        name: Joi.string().required(),
        url: Joi.string().required(),
        order: Joi.number().integer().min(0),
        lastActiveTab: Joi.number().integer().min(0).default(0),
        tabs: Joi.array().items(Joi.object({
            name: Joi.string().required(),
            order: Joi.number().integer().min(0),
        })).default([]),
    })).default([]),
    showTrayIcon: Joi.boolean().default(false),
    trayIconTheme: Joi.any().allow('').valid('light', 'dark').default('light'),
    minimizeToTray: Joi.boolean().default(false),
    notifications: Joi.object({
        flashWindow: Joi.any().valid(0, 2).default(0),
        bounceIcon: Joi.boolean().default(false),
        bounceIconType: Joi.any().allow('').valid('informational', 'critical').default('informational'),
    }),
    showUnreadBadge: Joi.boolean().default(true),
    useSpellChecker: Joi.boolean().default(true),
    enableHardwareAcceleration: Joi.boolean().default(true),
    autostart: Joi.boolean().default(true),
    spellCheckerLocale: Joi.string().regex(/^[a-z]{2}-[A-Z]{2}$/).default('en-US'),
    spellCheckerURL: Joi.string().allow(null),
    darkMode: Joi.boolean().default(false),
    downloadLocation: Joi.string(),
});

// eg. data['community.mattermost.com'] = { data: 'certificate data', issuerName: 'COMODO RSA Domain Validation Secure Server CA'};
const certificateStoreSchema = Joi.object().pattern(
    Joi.string().uri(),
    Joi.object<ComparableCertificate>({
        data: Joi.string(),
        issuerName: Joi.string(),
    }),
);

const originPermissionsSchema = Joi.object<TrustedOrigin>().keys({
    canBasicAuth: Joi.boolean().default(false), // we can add more permissions later if we want
});

const trustedOriginsSchema = Joi.object({}).pattern(
    Joi.string().uri(),
    Joi.object().keys({
        canBasicAuth: Joi.boolean().default(false), // we can add more permissions later if we want
    }),
);

const allowedProtocolsSchema = Joi.array().items(Joi.string().regex(/^[a-z-]+:$/i));

// validate bounds_info.json
export function validateArgs(data: Args) {
    return validateAgainstSchema(data, argsSchema);
}

// validate bounds_info.json
export function validateBoundsInfo(data: SavedWindowState) {
    return validateAgainstSchema(data, boundsInfoSchema);
}

// validate app_state.json
export function validateAppState(data: AppState) {
    return validateAgainstSchema(data, appStateSchema);
}

// validate v.0 config.json
export function validateV0ConfigData(data: ConfigV0) {
    return validateAgainstSchema(data, configDataSchemaV0);
}

// validate v.1 config.json
export function validateV1ConfigData(data: ConfigV1) {
    if (Array.isArray(data.teams) && data.teams.length) {
    // first replace possible backslashes with forward slashes
        let teams = data.teams.map(({name, url}) => {
            let updatedURL = url;
            if (updatedURL.includes('\\')) {
                updatedURL = updatedURL.toLowerCase().replace(/\\/gi, '/');
            }
            return {name, url: updatedURL};
        });

        // next filter out urls that are still invalid so all is not lost
        teams = teams.filter(({url}) => urlUtils.isValidURL(url));

        // replace original teams
        data.teams = teams;
    }
    return validateAgainstSchema(data, configDataSchemaV1);
}

function cleanURL(url: string): string {
    let updatedURL = url;
    if (updatedURL.includes('\\')) {
        updatedURL = updatedURL.toLowerCase().replace(/\\/gi, '/');
    }
    return updatedURL;
}

export function validateV2ConfigData(data: ConfigV2) {
    if (Array.isArray(data.teams) && data.teams.length) {
        // first replace possible backslashes with forward slashes
        let teams = data.teams.map((team) => {
            return {
                ...team,
                url: cleanURL(team.url),
            };
        });

        // next filter out urls that are still invalid so all is not lost
        teams = teams.filter(({url}) => urlUtils.isValidURL(url));

        // replace original teams
        data.teams = teams;
    }
    if (data.spellCheckerURL && !urlUtils.isValidURL(data.spellCheckerURL)) {
        log.error('Invalid download location for spellchecker dictionary, removing from config');
        delete data.spellCheckerURL;
    }
    return validateAgainstSchema(data, configDataSchemaV2);
}

export function validateV3ConfigData(data: ConfigV3) {
    if (Array.isArray(data.teams) && data.teams.length) {
    // first replace possible backslashes with forward slashes
        let teams = data.teams.map((team) => {
            return {
                ...team,
                url: cleanURL(team.url),
            };
        });

        // next filter out urls that are still invalid so all is not lost
        teams = teams.filter(({url}) => urlUtils.isValidURL(url));

        // replace original teams
        data.teams = teams;
    }
    if (data.spellCheckerURL && !urlUtils.isValidURL(data.spellCheckerURL)) {
        log.error('Invalid download location for spellchecker dictionary, removing from config');
        delete data.spellCheckerURL;
    }
    return validateAgainstSchema(data, configDataSchemaV3);
}

// validate certificate.json
export function validateCertificateStore(data: string | Record<string, ComparableCertificate>) {
    const jsonData = (typeof data === 'object' ? data : JSON.parse(data));
    return validateAgainstSchema(jsonData, certificateStoreSchema);
}

// validate allowedProtocols.json
export function validateAllowedProtocols(data: string[]) {
    return validateAgainstSchema(data, allowedProtocolsSchema);
}

export function validateTrustedOriginsStore(data: string | Record<PermissionType, TrustedOrigin>) {
    const jsonData: Record<PermissionType, TrustedOrigin> = (typeof data === 'object' ? data : JSON.parse(data));
    return validateAgainstSchema(jsonData, trustedOriginsSchema);
}

export function validateOriginPermissions(data: string | TrustedOrigin) {
    const jsonData: TrustedOrigin = (typeof data === 'object' ? data : JSON.parse(data));
    return validateAgainstSchema(jsonData, originPermissionsSchema);
}

function validateAgainstSchema<T>(data: T, schema: Joi.ObjectSchema<T> | Joi.ArraySchema): T | null {
    if (typeof data !== 'object') {
        log.error(`Input 'data' is not an object we can validate: ${typeof data}`);
        return null;
    }
    if (!schema) {
        log.error('No schema provided to validate');
        return null;
    }
    const {error, value} = schema.validate(data, defaultOptions);
    if (error) {
        log.error(`Validation failed due to: ${error}`);
        return null;
    }
    return value;
}

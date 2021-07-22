// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {BrowserWindow, shell, WebContents} from 'electron';
import log from 'electron-log';

import {TeamWithTabs} from 'types/config';

import urlUtils from 'common/utils/url';

import * as WindowManager from '../windows/windowManager';

import {protocols} from '../../../electron-builder.json';

import allowProtocolDialog from '../allowProtocolDialog';
import {composeUserAgent} from '../utils';

import {MattermostView} from './MattermostView';

type CustomLogin = {
    inProgress: boolean;
}

const customLogins: Record<number, CustomLogin> = {};
const listeners: Record<number, () => void> = {};
let popupWindow: BrowserWindow | undefined;

function isTrustedPopupWindow(webContents: WebContents) {
    if (!webContents) {
        return false;
    }
    if (!popupWindow) {
        return false;
    }
    return BrowserWindow.fromWebContents(webContents) === popupWindow;
}

const scheme = protocols && protocols[0] && protocols[0].schemes && protocols[0].schemes[0];

const generateWillNavigate = (getServersFunction: () => TeamWithTabs[]) => {
    return (event: Event & {sender: WebContents}, url: string) => {
        const contentID = event.sender.id;
        const parsedURL = urlUtils.parseURL(url)!;
        const configServers = getServersFunction();
        const server = urlUtils.getView(parsedURL, configServers);

        if (server && (urlUtils.isTeamUrl(server.url, parsedURL) || urlUtils.isAdminUrl(server.url, parsedURL) || isTrustedPopupWindow(event.sender))) {
            return;
        }

        if (server && urlUtils.isCustomLoginURL(parsedURL, server, configServers)) {
            return;
        }
        if (parsedURL.protocol === 'mailto:') {
            return;
        }
        if (customLogins[contentID].inProgress) {
            return;
        }

        log.info(`Prevented desktop from navigating to: ${url}`);
        event.preventDefault();
    };
};

const generateDidStartNavigation = (getServersFunction: () => TeamWithTabs[]) => {
    return (event: Event & {sender: WebContents}, url: string) => {
        const serverList = getServersFunction();
        const contentID = event.sender.id;
        const parsedURL = urlUtils.parseURL(url)!;
        const server = urlUtils.getView(parsedURL, serverList);

        if (!urlUtils.isTrustedURL(parsedURL, serverList)) {
            return;
        }

        if (server && urlUtils.isCustomLoginURL(parsedURL, server, serverList)) {
            customLogins[contentID].inProgress = true;
        } else if (customLogins[contentID].inProgress) {
            customLogins[contentID].inProgress = false;
        }
    };
};

const denyNewWindow = (event: Event, url: string) => {
    event.preventDefault();
    log.warn(`Prevented popup window to open a new window to ${url}.`);
    return null;
};

const generateNewWindowListener = (getServersFunction: () => TeamWithTabs[], spellcheck?: boolean) => {
    return (event: Event, url: string) => {
        const parsedURL = urlUtils.parseURL(url);
        if (!parsedURL) {
            event.preventDefault();
            log.warn(`Ignoring non-url ${url}`);
            return;
        }

        const configServers = getServersFunction();

        // Dev tools case
        if (parsedURL.protocol === 'devtools:') {
            return;
        }
        event.preventDefault();

        // Check for valid URL
        if (!urlUtils.isValidURI(url)) {
            return;
        }

        // Check for custom protocol
        if (parsedURL.protocol !== 'http:' && parsedURL.protocol !== 'https:' && parsedURL.protocol !== `${scheme}:`) {
            allowProtocolDialog.handleDialogEvent(parsedURL.protocol, url);
            return;
        }

        const server = urlUtils.getView(parsedURL, configServers);

        if (!server) {
            shell.openExternal(url);
            return;
        }

        // Public download links case
        // TODO: We might be handling different types differently in the future, for now
        // we are going to mimic the browser and just pop a new browser window for public links
        if (parsedURL.pathname.match(/^(\/api\/v[3-4]\/public)*\/files\//)) {
            shell.openExternal(url);
            return;
        }

        // Image proxy case
        if (parsedURL.pathname.match(/^\/api\/v[3-4]\/image/)) {
            shell.openExternal(url);
            return;
        }

        if (parsedURL.pathname.match(/^\/help\//)) {
            // Help links case
            // continue to open special case internal urls in default browser
            shell.openExternal(url);
            return;
        }

        if (urlUtils.isTeamUrl(server.url, parsedURL, true)) {
            WindowManager.showMainWindow(parsedURL);
            return;
        }
        if (urlUtils.isAdminUrl(server.url, parsedURL)) {
            log.info(`${url} is an admin console page, preventing to open a new window`);
            return;
        }
        if (popupWindow && popupWindow.webContents.getURL() === url) {
            log.info(`Popup window already open at provided url: ${url}`);
            return;
        }

        // TODO: move popups to its own and have more than one.
        if (urlUtils.isPluginUrl(server.url, parsedURL) || urlUtils.isManagedResource(server.url, parsedURL)) {
            if (!popupWindow) {
                popupWindow = new BrowserWindow({
                    backgroundColor: '#fff', // prevents blurry text: https://electronjs.org/docs/faq#the-font-looks-blurry-what-is-this-and-what-can-i-do
                    //parent: WindowManager.getMainWindow(),
                    show: false,
                    center: true,
                    webPreferences: {
                        nativeWindowOpen: true,
                        nodeIntegration: process.env.NODE_ENV === 'test',
                        contextIsolation: process.env.NODE_ENV !== 'test',
                        spellcheck: (typeof spellcheck === 'undefined' ? true : spellcheck),
                        enableRemoteModule: process.env.NODE_ENV === 'test',
                    },
                });
                popupWindow.webContents.on('new-window', denyNewWindow);
                popupWindow.once('ready-to-show', () => {
                    popupWindow!.show();
                });
                popupWindow.once('closed', () => {
                    popupWindow = undefined;
                });
            }

            if (urlUtils.isManagedResource(server.url, parsedURL)) {
                popupWindow.loadURL(url);
            } else {
                // currently changing the userAgent for popup windows to allow plugins to go through google's oAuth
                // should be removed once a proper oAuth2 implementation is setup.
                popupWindow.loadURL(url, {
                    userAgent: composeUserAgent(),
                });
            }
        }
    };
};

export const removeWebContentsListeners = (id: number) => {
    if (listeners[id]) {
        listeners[id]();
    }
};

export const addWebContentsEventListeners = (mmview: MattermostView, getServersFunction: () => TeamWithTabs[]) => {
    const contents = mmview.view.webContents;

    // initialize custom login tracking
    customLogins[contents.id] = {
        inProgress: false,
    };

    if (listeners[contents.id]) {
        removeWebContentsListeners(contents.id);
    }

    const willNavigate = generateWillNavigate(getServersFunction);
    contents.on('will-navigate', willNavigate as (e: Event, u: string) => void); // TODO: Electron types don't include sender for some reason

    // handle custom login requests (oath, saml):
    // 1. are we navigating to a supported local custom login path from the `/login` page?
    //    - indicate custom login is in progress
    // 2. are we finished with the custom login process?
    //    - indicate custom login is NOT in progress
    const didStartNavigation = generateDidStartNavigation(getServersFunction);
    contents.on('did-start-navigation', didStartNavigation as (e: Event, u: string) => void);

    const spellcheck = mmview.options.webPreferences?.spellcheck;
    const newWindow = generateNewWindowListener(getServersFunction, spellcheck);
    contents.on('new-window', newWindow);

    contents.on('page-title-updated', mmview.handleTitleUpdate);
    contents.on('page-favicon-updated', mmview.handleFaviconUpdate);
    contents.on('update-target-url', mmview.handleUpdateTarget);
    contents.on('did-navigate', mmview.handleDidNavigate);

    const removeListeners = () => {
        try {
            contents.removeListener('will-navigate', willNavigate as (e: Event, u: string) => void);
            contents.removeListener('did-start-navigation', didStartNavigation as (e: Event, u: string) => void);
            contents.removeListener('new-window', newWindow);
            contents.removeListener('page-title-updated', mmview.handleTitleUpdate);
            contents.removeListener('page-favicon-updated', mmview.handleFaviconUpdate);
            contents.removeListener('update-target-url', mmview.handleUpdateTarget);
            contents.removeListener('did-navigate', mmview.handleDidNavigate);
        } catch (e) {
            log.error(`Error while trying to detach listeners, this might be ok if the process crashed: ${e}`);
        }
    };

    listeners[contents.id] = removeListeners;
    contents.once('render-process-gone', (event, details) => {
        if (details.reason !== 'clean-exit') {
            log.error('Renderer process for a webcontent is no longer available:', details.reason);
        }
        removeListeners();
    });
};

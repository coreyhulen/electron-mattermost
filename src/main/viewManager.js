// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import log from 'electron-log';
import {BrowserView, dialog} from 'electron';

import {SECOND} from 'common/utils/constants';
import {UPDATE_TARGET_URL, FOUND_IN_PAGE, SET_SERVER_KEY, LOAD_SUCCESS, LOAD_FAILED} from 'common/communication';
import urlUtils from 'common/utils/url';

import contextMenu from './contextMenu';
import {MattermostServer} from './MattermostServer';
import {MattermostView} from './MattermostView';
import {getLocalURLString, getLocalPreload} from './utils';
import {showModal} from './modalManager';

const URL_VIEW_DURATION = 10 * SECOND;
const URL_VIEW_HEIGHT = 36;
const FINDER_WIDTH = 310;
const FINDER_HEIGHT = 40;

export class ViewManager {
  constructor(config) {
    this.configServers = config.teams;
    this.viewOptions = {spellcheck: config.useSpellChecker};
    this.views = new Map(); // keep in mind that this doesn't need to hold server order, only tabs on the renderer need that.
    this.currentView = null;
    this.urlView = null;
  }

  loadServer = (server, mainWindow) => {
    const srv = new MattermostServer(server.name, server.url);
    const view = new MattermostView(srv, mainWindow, this.viewOptions);
    this.views.set(server.name, view);
    view.once(LOAD_SUCCESS, this.activateView);
    view.load();
    view.on(UPDATE_TARGET_URL, this.showURLView);
  }

  // TODO: we shouldn't pass the main window, but get it from windowmanager
  // TODO: we'll need an event in case the main window changes so this updates accordingly
  load = (mainWindow) => {
    this.configServers.forEach((server) => this.loadServer(server, mainWindow));
  }

  reloadConfiguration = (configServers, mainWindow) => {
    this.configServers = configServers.concat();
    const oldviews = this.views;
    this.views = new Map();
    const sorted = this.configServers.sort((a, b) => a.order - b.order);
    let setFocus;
    sorted.forEach((server) => {
      const recycle = oldviews.get(server.name);
      if (recycle && recycle.isVisible) {
        setFocus = recycle.name;
      }
      if (recycle && recycle.server.url.toString() === urlUtils.parseURL(server.url).toString()) {
        oldviews.delete(recycle.name);
        this.views.set(recycle.name, recycle);
      } else {
        this.loadServer(server, mainWindow);
      }
    });
    oldviews.forEach((unused) => {
      unused.destroy();
    });
    if (setFocus) {
      this.showByName(setFocus);
    } else {
      this.showInitial();
    }
  }

  showInitial = () => {
    if (this.configServers.length) {
      // TODO: handle deeplink url
      const element = this.configServers.find((e) => e.order === 0);
      if (element) {
        this.showByName(element.name);
      }
    }

    // TODO: send event to highlight selected tab
  }

  showByName = (name) => {
    const newView = this.views.get(name);
    if (newView.isVisible) {
      return;
    }
    if (newView) {
      if (this.currentView && this.currentView !== name) {
        const previous = this.getCurrentView();
        if (previous) {
          previous.hide();
        }
    }

    getCurrentView() {
        return this.views.get(this.currentView);
    }

    openViewDevTools = () => {
        const view = this.getCurrentView();
        if (view) {
            view.openDevTools({mode: 'detach'});
        } else {
            log.error(`couldn't find ${this.currentView}`);
        }
      }
    }
    return found;
  }

  showURLView = (url) => {
    if (this.urlViewCancel) {
      this.urlViewCancel();
    }
    if (url && url !== '') {
      const urlString = typeof url === 'string' ? url : url.toString();
      const urlView = new BrowserView();
      const query = new Map([['url', urlString]]);
      const localURL = getLocalURLString('urlView.html', query);
      urlView.webContents.loadURL(localURL);
      const currentWindow = this.getCurrentView().window;
      currentWindow.addBrowserView(urlView);
      const boundaries = currentWindow.getBounds();
      urlView.setBounds({
        x: 0,
        y: boundaries.height - URL_VIEW_HEIGHT,
        width: Math.floor(boundaries.width / 3),
        height: URL_VIEW_HEIGHT,
      });

      const hideView = () => {
        this.urlViewCancel = null;
        currentWindow.removeBrowserView(urlView);
        urlView.destroy();
      };

      const timeout = setTimeout(hideView,
        URL_VIEW_DURATION);

      this.urlViewCancel = () => {
        clearTimeout(timeout);
        hideView();
      };
    }
  }

  setFinderBounds = () => {
    if (this.finder) {
      const currentWindow = this.getCurrentView().window;
      const boundaries = currentWindow.getBounds();
      this.finder.setBounds({
        x: boundaries.width - FINDER_WIDTH - (process.platform === 'darwin' ? 20 : 200),
        y: 0,
        width: FINDER_WIDTH,
        height: FINDER_HEIGHT,
      });
    }
  }

  focusFinder = () => {
    if (this.finder) {
      this.finder.webContents.focus();
    }
  }

  hideFinder = () => {
    if (this.finder) {
      const currentWindow = this.getCurrentView().window;
      currentWindow.removeBrowserView(this.finder);
      this.finder.destroy();
      this.finder = null;
    }
  }

  foundInPage = (result) => {
    if (this.finder) {
      this.finder.webContents.send(FOUND_IN_PAGE, result);
    }
  };

  showFinder = () => {
    // just focus the current finder if it's already open
    if (this.finder) {
      this.finder.webContents.focus();
      return;
    }

    const preload = getLocalPreload('finderPreload.js');
    this.finder = new BrowserView({webPreferences: {
      preload,
    }});
    const localURL = getLocalURLString('finder.html');
    this.finder.webContents.loadURL(localURL);
    const currentWindow = this.getCurrentView().window;
    currentWindow.addBrowserView(this.finder);
    this.setFinderBounds();

    this.finder.webContents.focus();
  };

  deeplinkSuccess = (serverName) => {
    const view = this.views.get(serverName);
    this.showByName(serverName);
    view.removeListener(LOAD_FAILED, this.deeplinkFailed);
  };

  deeplinkFailed = (serverName, err, url) => {
    const view = this.views.get(serverName);
    log.error(`[${serverName}] failed to load deeplink ${url}: ${err}`);
    view.removeListener(LOAD_SUCCESS, this.deeplinkSuccess);
  }

  handleDeepLink = (url) => {
    if (url) {
      const parsedURL = urlUtils.parseURL(url);
      const server = urlUtils.getServer(parsedURL, this.configServers, true);
      if (server) {
        const view = this.views.get(server.name);

        // attempting to change parsedURL protocol results in it not being modified.
        const urlWithSchema = `${view.server.url.origin}${parsedURL.pathname}${parsedURL.search}`;
        view.resetLoadingStatus();
        view.load(urlWithSchema);
        view.once(LOAD_SUCCESS, this.deeplinkSuccess);
        view.once(LOAD_FAILED, this.deeplinkFailed);
      } else {
        dialog.showErrorBox('No matching server', `there is no configured server in the app that matches the requested url: ${parsedURL.toString()}`);
      }
    }
  };
}

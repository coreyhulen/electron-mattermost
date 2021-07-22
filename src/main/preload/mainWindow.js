// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
// Copyright (c) 2015-2016 Yuya Ochiai

'use strict';

import {ipcRenderer, contextBridge} from 'electron';

contextBridge.exposeInMainWorld('ipcRenderer', {
    send: ipcRenderer.send,
    on: (channel, listener) => ipcRenderer.on(channel, (_, ...args) => listener(null, ...args)),
    invoke: ipcRenderer.invoke,
});

contextBridge.exposeInMainWorld('process', {
    platform: process.platform,
    env: {
        user: process.env.USER,
        username: process.env.USERNAME,
    },
});

contextBridge.exposeInMainWorld('timers', {
    setImmediate,
});


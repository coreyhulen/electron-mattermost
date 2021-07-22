// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

const path = require('path');

const {spawn} = require('electron-notarize/lib/spawn.js');

const SETUID_PERMISSIONS = '4755';

// cf. MM-22377
// https://mattermost.atlassian.net/browse/MM-22377

exports.default = async function afterPack(context) {
    if (context.electronPlatformName === 'linux') {
        context.targets.forEach(async (target) => {
            if (!['appimage', 'snap'].includes(target.name.toLowerCase())) {
                const result = await spawn('chmod', [SETUID_PERMISSIONS, path.join(context.appOutDir, 'chrome-sandbox')]);
                if (result.code !== 0) {
                    throw new Error(
                        `Failed to set proper permissions for linux arch on ${target.name}`,
                    );
                }
            }
        });
    }
};

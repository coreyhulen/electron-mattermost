// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

declare namespace NodeJS {
    export interface Global {
        willAppQuit: boolean;
    }
}

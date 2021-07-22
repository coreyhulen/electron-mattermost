// Copyright (c) 2015-2016 Yuya Ochiai
// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/* eslint-disable max-lines */

import 'renderer/css/settings.css';

import React from 'react';
import {FormCheck, Col, FormGroup, FormText, Container, Row, Button} from 'react-bootstrap';

import {debounce} from 'underscore';

import {CombinedConfig, LocalConfiguration, Team} from 'types/config';
import {DeepPartial} from 'types/utils';

import {GET_LOCAL_CONFIGURATION, UPDATE_CONFIGURATION, DOUBLE_CLICK_ON_WINDOW, GET_DOWNLOAD_LOCATION, SWITCH_SERVER, ADD_SERVER, RELOAD_CONFIGURATION} from 'common/communication';
import {getDefaultTeamWithTabsFromTeam} from 'common/tabs/TabView';

import TeamList from './TeamList';
import AutoSaveIndicator, {SavingState} from './AutoSaveIndicator';

const CONFIG_TYPE_SERVERS = 'servers';
const CONFIG_TYPE_APP_OPTIONS = 'appOptions';

type ConfigType = typeof CONFIG_TYPE_SERVERS | typeof CONFIG_TYPE_APP_OPTIONS;

type State = DeepPartial<CombinedConfig> & {
    ready: boolean;
    maximized?: boolean;
    teams?: Team[];
    showAddTeamForm: boolean;
    trayWasVisible?: boolean;
    firstRun?: boolean;
    savingState: SavingStateItems;
    userOpenedDownloadDialog: boolean;
    allowSaveSpellCheckerURL: boolean;
}

type SavingStateItems = {
    appOptions: SavingState;
    servers: SavingState;
};

type SaveQueueItem = {
    configType: ConfigType;
    key: keyof CombinedConfig;
    data: CombinedConfig[keyof CombinedConfig];
}

function backToIndex(serverName: string) {
    window.ipcRenderer.send(SWITCH_SERVER, serverName);
    window.close();
}

export default class SettingsPage extends React.PureComponent<Record<string, never>, State> {
    trayIconThemeRef: React.RefObject<HTMLDivElement>;
    downloadLocationRef: React.RefObject<HTMLInputElement>;
    showTrayIconRef: React.RefObject<HTMLInputElement>;
    autostartRef: React.RefObject<HTMLInputElement>;
    minimizeToTrayRef: React.RefObject<HTMLInputElement>;
    flashWindowRef: React.RefObject<HTMLInputElement>;
    bounceIconRef: React.RefObject<HTMLInputElement>;
    showUnreadBadgeRef: React.RefObject<HTMLInputElement>;
    useSpellCheckerRef: React.RefObject<HTMLInputElement>;
    spellCheckerURLRef: React.RefObject<HTMLInputElement>;
    enableHardwareAccelerationRef: React.RefObject<HTMLInputElement>;

    saveQueue: SaveQueueItem[];

    constructor(props: Record<string, never>) {
        super(props);
        this.state = {
            ready: false,
            teams: [],
            showAddTeamForm: false,
            savingState: {
                appOptions: SavingState.SAVING_STATE_DONE,
                servers: SavingState.SAVING_STATE_DONE,
            },
            userOpenedDownloadDialog: false,
            allowSaveSpellCheckerURL: false,
        };

        this.getConfig();
        this.trayIconThemeRef = React.createRef();
        this.downloadLocationRef = React.createRef();
        this.showTrayIconRef = React.createRef();
        this.autostartRef = React.createRef();
        this.minimizeToTrayRef = React.createRef();
        this.flashWindowRef = React.createRef();
        this.bounceIconRef = React.createRef();
        this.showUnreadBadgeRef = React.createRef();
        this.useSpellCheckerRef = React.createRef();
        this.enableHardwareAccelerationRef = React.createRef();
        this.spellCheckerURLRef = React.createRef();

        this.saveQueue = [];
    }

    componentDidMount() {
        window.ipcRenderer.on(ADD_SERVER, () => {
            this.setState({
                showAddTeamForm: true,
            });
        });

        window.ipcRenderer.on(RELOAD_CONFIGURATION, () => {
            this.updateSaveState();
            this.getConfig();
        });
    }

    getConfig = () => {
        window.ipcRenderer.invoke(GET_LOCAL_CONFIGURATION).then((config) => {
            this.setState({ready: true, maximized: false, ...this.convertConfigDataToState(config) as Omit<State, 'ready'>});
        });
    }

    convertConfigDataToState = (configData: Partial<LocalConfiguration>, currentState: Partial<State> = {}) => {
        const newState = Object.assign({} as State, configData);
        newState.showAddTeamForm = currentState.showAddTeamForm || false;
        newState.trayWasVisible = currentState.trayWasVisible || false;
        if (newState.teams?.length === 0 && currentState.firstRun !== false) {
            newState.firstRun = false;
            newState.showAddTeamForm = true;
        }
        newState.savingState = currentState.savingState || {
            appOptions: SavingState.SAVING_STATE_DONE,
            servers: SavingState.SAVING_STATE_DONE,
        };
        return newState;
    }

    saveSetting = (configType: ConfigType, {key, data}: {key: keyof CombinedConfig; data: CombinedConfig[keyof CombinedConfig]}) => {
        this.saveQueue.push({
            configType,
            key,
            data,
        });
        this.updateSaveState();
        this.processSaveQueue();
    }

    processSaveQueue = debounce(() => {
        window.ipcRenderer.send(UPDATE_CONFIGURATION, this.saveQueue.splice(0, this.saveQueue.length));
    }, 500);

    updateSaveState = () => {
        let queuedUpdateCounts = {
            [CONFIG_TYPE_SERVERS]: 0,
            [CONFIG_TYPE_APP_OPTIONS]: 0,
        };

        queuedUpdateCounts = this.saveQueue.reduce((updateCounts, {configType}) => {
            updateCounts[configType]++;
            return updateCounts;
        }, queuedUpdateCounts);

        const savingState = Object.assign({}, this.state.savingState);

        Object.entries(queuedUpdateCounts).forEach(([configType, count]) => {
            if (count > 0) {
                savingState[configType as keyof SavingStateItems] = SavingState.SAVING_STATE_SAVING;
            } else if (count === 0 && savingState[configType as keyof SavingStateItems] === SavingState.SAVING_STATE_SAVING) {
                savingState[configType as keyof SavingStateItems] = SavingState.SAVING_STATE_SAVED;
                this.resetSaveState(configType as keyof SavingStateItems);
            }
        });

        this.setState({savingState});
    }

    resetSaveState = debounce((configType: keyof SavingStateItems) => {
        if (this.state.savingState[configType] !== SavingState.SAVING_STATE_SAVING) {
            const savingState = Object.assign({}, this.state.savingState);
            savingState[configType] = SavingState.SAVING_STATE_DONE;
            this.setState({savingState});
        }
    }, 2000);

    handleTeamsChange = (teams: Team[]) => {
        window.timers.setImmediate(this.saveSetting, CONFIG_TYPE_SERVERS, {key: 'teams', data: teams});
        this.setState({
            showAddTeamForm: false,
            teams,
        });
        if (teams.length === 0) {
            this.setState({showAddTeamForm: true});
        }
    }

    handleChangeShowTrayIcon = () => {
        const shouldShowTrayIcon = this.showTrayIconRef.current?.checked;
        window.timers.setImmediate(this.saveSetting, CONFIG_TYPE_APP_OPTIONS, {key: 'showTrayIcon', data: shouldShowTrayIcon});
        this.setState({
            showTrayIcon: shouldShowTrayIcon,
        });

        if (window.process.platform === 'darwin' && !shouldShowTrayIcon) {
            this.setState({
                minimizeToTray: false,
            });
        }
    }

    handleChangeTrayIconTheme = (theme: string) => {
        window.timers.setImmediate(this.saveSetting, CONFIG_TYPE_APP_OPTIONS, {key: 'trayIconTheme', data: theme});
        this.setState({
            trayIconTheme: theme,
        });
    }

    handleChangeAutoStart = () => {
        window.timers.setImmediate(this.saveSetting, CONFIG_TYPE_APP_OPTIONS, {key: 'autostart', data: this.autostartRef.current?.checked});
        this.setState({
            autostart: this.autostartRef.current?.checked,
        });
    }

    handleChangeMinimizeToTray = () => {
        const shouldMinimizeToTray = this.state.showTrayIcon && !this.minimizeToTrayRef.current?.checked;

        window.timers.setImmediate(this.saveSetting, CONFIG_TYPE_APP_OPTIONS, {key: 'minimizeToTray', data: shouldMinimizeToTray});
        this.setState({
            minimizeToTray: shouldMinimizeToTray,
        });
    }

    toggleShowTeamForm = () => {
        this.setState({
            showAddTeamForm: !this.state.showAddTeamForm,
        });
        (document.activeElement as HTMLElement).blur();
    }

    setShowTeamFormVisibility = (val: boolean) => {
        this.setState({
            showAddTeamForm: val,
        });
    }

    handleFlashWindow = () => {
        window.timers.setImmediate(this.saveSetting, CONFIG_TYPE_APP_OPTIONS, {
            key: 'notifications',
            data: {
                ...this.state.notifications,
                flashWindow: this.flashWindowRef.current?.checked ? 0 : 2,
            },
        });
        this.setState({
            notifications: {
                ...this.state.notifications,
                flashWindow: this.flashWindowRef.current?.checked ? 0 : 2,
            },
        });
    }

    handleBounceIcon = () => {
        window.timers.setImmediate(this.saveSetting, CONFIG_TYPE_APP_OPTIONS, {
            key: 'notifications',
            data: {
                ...this.state.notifications,
                bounceIcon: this.bounceIconRef.current?.checked,
            },
        });
        this.setState({
            notifications: {
                ...this.state.notifications,
                bounceIcon: this.bounceIconRef.current?.checked,
            },
        });
    }

    handleBounceIconType = (event: React.ChangeEvent<HTMLInputElement>) => {
        window.timers.setImmediate(this.saveSetting, CONFIG_TYPE_APP_OPTIONS, {
            key: 'notifications',
            data: {
                ...this.state.notifications,
                bounceIconType: event.target.value,
            },
        });
        this.setState({
            notifications: {
                ...this.state.notifications,
                bounceIconType: event.target.value as 'critical' | 'informational',
            },
        });
    }

    handleShowUnreadBadge = () => {
        window.timers.setImmediate(this.saveSetting, CONFIG_TYPE_APP_OPTIONS, {key: 'showUnreadBadge', data: this.showUnreadBadgeRef.current?.checked});
        this.setState({
            showUnreadBadge: this.showUnreadBadgeRef.current?.checked,
        });
    }

    handleChangeUseSpellChecker = () => {
        window.timers.setImmediate(this.saveSetting, CONFIG_TYPE_APP_OPTIONS, {key: 'useSpellChecker', data: this.useSpellCheckerRef.current?.checked});
        this.setState({
            useSpellChecker: this.useSpellCheckerRef.current?.checked,
        });
    }

    handleChangeEnableHardwareAcceleration = () => {
        window.timers.setImmediate(this.saveSetting, CONFIG_TYPE_APP_OPTIONS, {key: 'enableHardwareAcceleration', data: this.enableHardwareAccelerationRef.current?.checked});
        this.setState({
            enableHardwareAcceleration: this.enableHardwareAccelerationRef.current?.checked,
        });
    }

    saveDownloadLocation = (location: string) => {
        if (!location) {
            return;
        }
        this.setState({
            downloadLocation: location,
        });
        window.timers.setImmediate(this.saveSetting, CONFIG_TYPE_APP_OPTIONS, {key: 'downloadLocation', data: location});
    }

    handleChangeDownloadLocation = (e: React.ChangeEvent<HTMLInputElement>) => {
        this.saveDownloadLocation(e.target.value);
    }

    selectDownloadLocation = () => {
        if (!this.state.userOpenedDownloadDialog) {
            window.ipcRenderer.invoke(GET_DOWNLOAD_LOCATION, this.state.downloadLocation).then((result) => this.saveDownloadLocation(result));
            this.setState({userOpenedDownloadDialog: true});
        }
        this.setState({userOpenedDownloadDialog: false});
    }

    saveSpellCheckerURL = (): void => {
        window.timers.setImmediate(this.saveSetting, CONFIG_TYPE_APP_OPTIONS, {key: 'spellCheckerURL', data: this.state.spellCheckerURL});
    }

    resetSpellCheckerURL = (): void => {
        this.setState({spellCheckerURL: undefined, allowSaveSpellCheckerURL: false});
        window.timers.setImmediate(this.saveSetting, CONFIG_TYPE_APP_OPTIONS, {key: 'spellCheckerURL', data: null});
    }

    handleChangeSpellCheckerURL= (e: React.ChangeEvent<HTMLInputElement>): void => {
        const dictionaryURL = e.target.value;
        let allowSaveSpellCheckerURL;
        try {
            // eslint-disable-next-line no-new
            new URL(dictionaryURL);
            allowSaveSpellCheckerURL = true;
        } catch {
            allowSaveSpellCheckerURL = false;
        }
        this.setState({
            spellCheckerURL: dictionaryURL,
            allowSaveSpellCheckerURL,
        });
    }
    updateTeam = (index: number, newData: Team) => {
        const teams = this.state.teams || [];
        teams[index] = newData;
        window.timers.setImmediate(this.saveSetting, CONFIG_TYPE_SERVERS, {key: 'teams', data: teams});
        this.setState({
            teams,
        });
    }

    addServer = (team: Team) => {
        const teams = this.state.teams || [];
        teams.push(getDefaultTeamWithTabsFromTeam(team));
        window.timers.setImmediate(this.saveSetting, CONFIG_TYPE_SERVERS, {key: 'teams', data: teams});
        this.setState({
            teams,
        });
    }

    handleDoubleClick = () => {
        window.ipcRenderer.send(DOUBLE_CLICK_ON_WINDOW, 'settings');
    }

    render() {
        const settingsPage = {
            close: {
                textDecoration: 'none',
                position: 'absolute',
                right: '0',
                top: '5px',
                fontSize: '35px',
                fontWeight: 'normal',
                color: '#bbb',
            },
            heading: {
                textAlign: 'center' as const,
                fontSize: '24px',
                margin: '0',
                padding: '1em 0',
            },
            sectionHeading: {
                fontSize: '20px',
                margin: '0',
                padding: '1em 0',
                display: 'inline-block',
            },
            sectionHeadingLink: {
                marginTop: '24px',
                display: 'inline-block',
                fontSize: '15px',
            },
            footer: {
                padding: '0.4em 0',
            },
            downloadLocationInput: {
                marginRight: '3px',
                marginTop: '8px',
                width: '320px',
                height: '34px',
                padding: '0 12px',
                borderRadius: '4px',
                border: '1px solid #ccc',
                fontWeight: 500,
            },

            downloadLocationButton: {
                marginBottom: '4px',
            },

            container: {
                paddingBottom: '40px',
            },
        };

        const teamsRow = (
            <Row>
                <Col md={12}>
                    <TeamList
                        teams={this.state.teams!}
                        showAddTeamForm={this.state.showAddTeamForm}
                        setAddTeamFormVisibility={this.setShowTeamFormVisibility}
                        onTeamsChange={this.handleTeamsChange}
                        updateTeam={this.updateTeam}
                        addServer={this.addServer}
                        onTeamClick={(name) => {
                            backToIndex(name);
                        }}
                    />
                </Col>
            </Row>
        );

        const serversRow = (
            <Row>
                <Col
                    xs={8}
                >
                    <h2 style={settingsPage.sectionHeading}>{'Server Management'}</h2>
                    <div className='IndicatorContainer'>
                        <AutoSaveIndicator
                            id='serversSaveIndicator'
                            savingState={this.state.savingState.servers}
                            errorMessage={'Can\'t save your changes. Please try again.'}
                        />
                    </div>
                </Col>
                <Col
                    xs={4}
                >
                    <p className='text-right'>
                        <a
                            style={settingsPage.sectionHeadingLink}
                            id='addNewServer'
                            href='#'
                            onClick={this.toggleShowTeamForm}
                        >{'+ Add New Server'}</a>
                    </p>
                </Col>
            </Row>
        );

        let srvMgmt;
        if (this.state.enableServerManagement === true) {
            srvMgmt = (
                <div>
                    {serversRow}
                    {teamsRow}
                    <hr/>
                </div>
            );
        }

        const options = [];

        // MacOS has an option in the Dock, to set the app to autostart, so we choose to not support this option for OSX
        if (window.process.platform === 'win32' || window.process.platform === 'linux') {
            options.push(
                <FormCheck>
                    <FormCheck.Input
                        type='checkbox'
                        key='inputAutoStart'
                        id='inputAutoStart'
                        ref={this.autostartRef}
                        checked={this.state.autostart}
                        onChange={this.handleChangeAutoStart}
                    />
                    {'Start app on login'}
                    <FormText>
                        {'If enabled, the app starts automatically when you log in to your machine.'}
                    </FormText>
                </FormCheck>);
        }

        options.push(
            <FormCheck>
                <FormCheck.Input
                    type='checkbox'
                    key='inputSpellChecker'
                    id='inputSpellChecker'
                    ref={this.useSpellCheckerRef}
                    checked={this.state.useSpellChecker}
                    onChange={this.handleChangeUseSpellChecker}
                />
                {'Check spelling'}
                <FormText>
                    {'Highlight misspelled words in your messages based on your system language configuration. '}
                    {'Setting takes effect after restarting the app.'}
                </FormText>
            </FormCheck>);
        if (process.platform !== 'darwin') {
            if (this.state.spellCheckerURL === null || typeof this.state.spellCheckerURL === 'undefined') {
                options.push(
                    <Button
                        id='editSpellcheckerURL'
                        key='editSpellcheckerURL'
                        onClick={() => this.setState({spellCheckerURL: '', allowSaveSpellCheckerURL: false})}
                        variant='link'
                    >{'Use an alternative dictionary URL'}</Button>,
                );
            } else {
                options.push(
                    <div
                        style={settingsPage.container}
                        key='containerInputSpellchekerURL'
                    >
                        <input
                            disabled={!this.state.useSpellChecker}
                            style={settingsPage.downloadLocationInput}
                            key='inputSpellCheckerURL'
                            id='inputSpellCheckerURL'
                            ref={this.spellCheckerURLRef}
                            onChange={this.handleChangeSpellCheckerURL}
                            value={this.state.spellCheckerURL}
                        />
                        <Button
                            disabled={!this.state.allowSaveSpellCheckerURL}
                            key='saveSpellCheckerURL'
                            style={settingsPage.downloadLocationButton}
                            id='saveSpellCheckerURL'
                            onClick={this.saveSpellCheckerURL}
                        >
                            <span>{'Save'}</span>
                        </Button>
                        <FormText>
                            {'Specify the url where dictionary definitions can be retrieved'}
                        </FormText>
                        <Button
                            id='revertSpellcheckerURL'
                            key='revertSpellcheckerURL'
                            onClick={this.resetSpellCheckerURL}
                            variant='link'
                        >{'Revert to default'}</Button>
                    </div>);
            }
        }
        if (window.process.platform === 'darwin' || window.process.platform === 'win32') {
            const TASKBAR = window.process.platform === 'win32' ? 'taskbar' : 'Dock';
            options.push(
                <FormCheck
                    key='showunreadbadge'
                >
                    <FormCheck.Input
                        type='checkbox'
                        key='inputShowUnreadBadge'
                        id='inputShowUnreadBadge'
                        ref={this.showUnreadBadgeRef}
                        checked={this.state.showUnreadBadge}
                        onChange={this.handleShowUnreadBadge}
                    />
                    {`Show red badge on ${TASKBAR} icon to indicate unread messages`}
                    <FormText>
                        {`Regardless of this setting, mentions are always indicated with a red badge and item count on the ${TASKBAR} icon.`}
                    </FormText>
                </FormCheck>);
        }

        if (window.process.platform === 'win32' || window.process.platform === 'linux') {
            options.push(
                <FormCheck>
                    <FormCheck.Input
                        type='checkbox'
                        key='flashWindow'
                        id='inputflashWindow'
                        ref={this.flashWindowRef}
                        checked={!this.state.notifications || this.state.notifications.flashWindow === 2}
                        onChange={this.handleFlashWindow}
                    />
                    {'Flash app window and taskbar icon when a new message is received'}
                    <FormText>
                        {'If enabled, app window and taskbar icon flash for a few seconds when a new message is received.'}
                    </FormText>
                </FormCheck>);
        }

        if (window.process.platform === 'darwin') {
            options.push(
                <FormGroup
                    key='OptionsForm'
                >
                    <FormCheck
                        type='checkbox'
                        inline={true}
                        key='bounceIcon'
                        id='inputBounceIcon'
                        ref={this.bounceIconRef}
                        checked={this.state.notifications ? this.state.notifications.bounceIcon : false}
                        onChange={this.handleBounceIcon}
                        style={{marginRight: '10px'}}
                        label='Bounce the Dock icon'
                    />
                    <FormCheck
                        type='radio'
                        inline={true}
                        name='bounceIconType'
                        value='informational'
                        disabled={!this.state.notifications || !this.state.notifications.bounceIcon}
                        defaultChecked={
                            !this.state.notifications ||
                !this.state.notifications.bounceIconType ||
                this.state.notifications.bounceIconType === 'informational'
                        }
                        onChange={this.handleBounceIconType}
                        label='once'
                    />
                    {' '}
                    <FormCheck
                        type='radio'
                        inline={true}
                        name='bounceIconType'
                        value='critical'
                        disabled={!this.state.notifications || !this.state.notifications.bounceIcon}
                        defaultChecked={this.state.notifications && this.state.notifications.bounceIconType === 'critical'}
                        onChange={this.handleBounceIconType}
                        label={'until I open the app'}
                    />
                    <FormText
                        style={{marginLeft: '20px'}}
                    >
                        {'If enabled, the Dock icon bounces once or until the user opens the app when a new notification is received.'}
                    </FormText>
                </FormGroup>,
            );
        }

        if (window.process.platform === 'darwin' || window.process.platform === 'linux') {
            options.push(
                <FormCheck
                    key='inputShowTrayIcon'
                >
                    <FormCheck.Input
                        type='checkbox'
                        id='inputShowTrayIcon'
                        ref={this.showTrayIconRef}
                        checked={this.state.showTrayIcon}
                        onChange={this.handleChangeShowTrayIcon}
                    />
                    {window.process.platform === 'darwin' ? `Show ${this.state.appName} icon in the menu bar` : 'Show icon in the notification area'}
                    <FormText>
                        {'Setting takes effect after restarting the app.'}
                    </FormText>
                </FormCheck>);
        }

        if (window.process.platform === 'linux') {
            options.push(
                <FormGroup
                    key='trayIconTheme'
                    ref={this.trayIconThemeRef}
                    style={{marginLeft: '20px'}}
                >
                    {'Icon theme: '}
                    <FormCheck
                        type='radio'
                        inline={true}
                        name='trayIconTheme'
                        value='light'
                        defaultChecked={this.state.trayIconTheme === 'light' || !this.state.trayIconTheme}
                        onChange={() => this.handleChangeTrayIconTheme('light')}
                        label={'Light'}
                    />
                    {' '}
                    <FormCheck
                        type='radio'
                        inline={true}
                        name='trayIconTheme'
                        value='dark'
                        defaultChecked={this.state.trayIconTheme === 'dark'}
                        onChange={() => this.handleChangeTrayIconTheme('dark')}
                        label={'Dark'}
                    />
                </FormGroup>,
            );
        }

        if (window.process.platform === 'linux') {
            options.push(
                <FormCheck
                    type='radio'
                    key='inputMinimizeToTray'
                    id='inputMinimizeToTray'
                    ref={this.minimizeToTrayRef}
                    disabled={!this.state.showTrayIcon || !this.state.trayWasVisible}
                    checked={this.state.minimizeToTray}
                    onChange={this.handleChangeMinimizeToTray}
                >
                    {'Leave app running in notification area when application window is closed'}
                    <FormText>
                        {'If enabled, the app stays running in the notification area after app window is closed.'}
                        {this.state.trayWasVisible || !this.state.showTrayIcon ? '' : ' Setting takes effect after restarting the app.'}
                    </FormText>
                </FormCheck>);
        }

        options.push(
            <FormCheck
                key='inputEnableHardwareAcceleration'
            >
                <FormCheck.Input
                    type='checkbox'
                    id='inputEnableHardwareAcceleration'
                    ref={this.enableHardwareAccelerationRef}
                    checked={this.state.enableHardwareAcceleration}
                    onChange={this.handleChangeEnableHardwareAcceleration}
                />
                {'Use GPU hardware acceleration'}
                <FormText>
                    {'If enabled, Mattermost UI is rendered more efficiently but can lead to decreased stability for some systems.'}
                    {' Setting takes effect after restarting the app.'}
                </FormText>
            </FormCheck>,
        );

        options.push(
            <div
                style={settingsPage.container}
                key='containerDownloadLocation'
            >
                <hr/>
                <div>{'Download Location'}</div>
                <input
                    disabled={true}
                    style={settingsPage.downloadLocationInput}
                    key='inputDownloadLocation'
                    id='inputDownloadLocation'
                    ref={this.downloadLocationRef}
                    onChange={this.handleChangeDownloadLocation}
                    value={this.state.downloadLocation}
                />
                <Button
                    style={settingsPage.downloadLocationButton}
                    id='saveDownloadLocation'
                    onClick={this.selectDownloadLocation}
                >
                    <span>{'Change'}</span>
                </Button>
                <FormText>
                    {'Specify the folder where files will download.'}
                </FormText>
            </div>,
        );

        let optionsRow = null;
        if (options.length > 0) {
            optionsRow = (
                <Row>
                    <Col md={12}>
                        <h2 style={settingsPage.sectionHeading}>{'App Options'}</h2>
                        <div className='IndicatorContainer'>
                            <AutoSaveIndicator
                                id='appOptionsSaveIndicator'
                                savingState={this.state.savingState.appOptions}
                                errorMessage={'Can\'t save your changes. Please try again.'}
                            />
                        </div>
                        { options.map((opt) => (
                            <FormGroup key={opt.key}>
                                {opt}
                            </FormGroup>
                        )) }
                    </Col>
                </Row>
            );
        }

        let waitForIpc;
        if (this.state.ready) {
            waitForIpc = (
                <>
                    {srvMgmt}
                    {optionsRow}
                </>
            );
        } else {
            waitForIpc = (<p>{'Loading configuration...'}</p>);
        }

        return (
            <div
                className='container-fluid'
                style={{
                    height: '100%',
                }}
            >
                <div
                    style={{
                        overflowY: 'auto',
                        height: '100%',
                        margin: '0 -15px',
                    }}
                >
                    <div style={{position: 'relative'}}>
                        <h1 style={settingsPage.heading}>{'Settings'}</h1>
                        <hr/>
                    </div>
                    <Container
                        className='settingsPage'
                    >
                        {waitForIpc}
                    </Container>
                </div>
            </div>
        );
    }
}

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const env = require('../../modules/environment');

describe('browser/index.html', function desc() {
  this.timeout(10000);

  const config = {
    version: 1,
    teams: [{
      name: 'example_1',
      url: env.mattermostURL + '1'
    }, {
      name: 'example_2',
      url: env.mattermostURL + '2'
    }]
  };

  const serverPort = 8181;

  before(() => {
    function serverCallback(req, res) {
      res.writeHead(200, {
        'Content-Type': 'text/html'
      });
      res.end(fs.readFileSync(path.resolve(env.sourceRootDir, 'test/modules/test.html'), 'utf-8'));
    }
    this.server = http.createServer(serverCallback).listen(serverPort, '127.0.0.1');
  });

  beforeEach(() => {
    fs.writeFileSync(env.configFilePath, JSON.stringify(config));
    this.app = env.getSpectronApp();
    return this.app.start();
  });

  afterEach(() => {
    if (this.app && this.app.isRunning()) {
      return this.app.stop();
    }
    return true;
  });

  after((done) => {
    this.server.close(done);
  });

  it('should NOT show tabs when there is one team', () => {
    fs.writeFileSync(env.configFilePath, JSON.stringify({
      url: env.mattermostURL
    }));
    return this.app.restart().then(() => {
      return this.app.client.waitUntilWindowLoaded().
        isExisting('#tabBar').should.eventually.be.false;
    });
  });

  it('should set src of webview from config file', () => {
    return this.app.client.waitUntilWindowLoaded().
      getAttribute('#mattermostView0', 'src').should.eventually.equal(config.teams[0].url).
      getAttribute('#mattermostView1', 'src').should.eventually.equal(config.teams[1].url).
      isExisting('#mattermostView2').should.eventually.be.false;
  });

  it('should set name of tab from config file', () => {
    return this.app.client.waitUntilWindowLoaded().
      getText('#teamTabItem0').should.eventually.equal(config.teams[0].name).
      getText('#teamTabItem1').should.eventually.equal(config.teams[1].name);
  });

  it('should show only the selected team', () => {
    return this.app.client.waitUntilWindowLoaded().
      isVisible('#mattermostView0').should.eventually.be.true.
      isVisible('#mattermostView1').should.eventually.be.false.
      click('#teamTabItem1').
      pause(1000).
      isVisible('#mattermostView1').should.eventually.be.true.
      isVisible('#mattermostView0').should.eventually.be.false;
  });

  it('should show error when using incorrect URL', () => {
    this.timeout(30000);
    fs.writeFileSync(env.configFilePath, JSON.stringify({
      version: 1,
      teams: [{
        name: 'error_1',
        url: 'http://false'
      }]
    }));
    return this.app.restart().then(() => {
      return this.app.client.waitUntilWindowLoaded().
        waitForVisible('#mattermostView0-fail', 20000);
    });
  });

  it('should set window title by using webview\'s one', () => {
    fs.writeFileSync(env.configFilePath, JSON.stringify({
      version: 1,
      teams: [{
        name: 'title_test',
        url: `http://localhost:${serverPort}`
      }]
    }));
    return this.app.restart().then(() => {
      return this.app.client.waitUntilWindowLoaded().pause(1500);
    }).then(() => {
      return this.app.browserWindow.getTitle().should.eventually.equal('Mattermost Desktop testing html');
    });
  });

  it('should update window title when the activated tab\'s title is updated', () => {
    fs.writeFileSync(env.configFilePath, JSON.stringify({
      version: 1,
      teams: [{
        name: 'title_test_0',
        url: `http://localhost:${serverPort}`
      }, {
        name: 'title_test_1',
        url: `http://localhost:${serverPort}`
      }]
    }));
    return this.app.restart().then(() => {
      return this.app.client.waitUntilWindowLoaded().pause(500);
    }).then(() => {
      // Note: Indices of webview are correct.
      // Somehow they are swapped.
      return this.app.client.
        windowByIndex(2).
        execute(() => {
          document.title = 'Title 0';
        }).
        windowByIndex(0).
        browserWindow.getTitle().should.eventually.equal('Title 0').
        windowByIndex(1).
        execute(() => {
          document.title = 'Title 1';
        }).
        windowByIndex(0).
        browserWindow.getTitle().should.eventually.equal('Title 0');
    });
  });

  it('should update window title when a tab is selected', () => {
    fs.writeFileSync(env.configFilePath, JSON.stringify({
      version: 1,
      teams: [{
        name: 'title_test_0',
        url: `http://localhost:${serverPort}`
      }, {
        name: 'title_test_1',
        url: `http://localhost:${serverPort}`
      }]
    }));
    return this.app.restart().then(() => {
      // Note: Indices of webview are correct.
      // Somehow they are swapped.
      return this.app.client.
        waitUntilWindowLoaded().
        pause(500).
        windowByIndex(2).
        execute(() => {
          document.title = 'Title 0';
        }).
        windowByIndex(1).
        execute(() => {
          document.title = 'Title 1';
        }).
        windowByIndex(0).
        browserWindow.getTitle().should.eventually.equal('Title 0').
        click('#teamTabItem1').
        browserWindow.getTitle().should.eventually.equal('Title 1');
    });
  });

  it('should open the new server prompt after clicking the add button', () => {
    // See settings_test for specs that cover the actual prompt
    return this.app.client.waitUntilWindowLoaded().
      click('#tabBarAddNewTeam').
      pause(500).
      isExisting('#newServerModal').should.eventually.be.true;
  });
});

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const tableFieldList = require('./tables');
const _ = require('lodash');
const request = require('request');
const jsdiff = require('diff');
const glob = require('glob');
const opn = require('opn');

var ServiceNowSync = (function () {
    function ServiceNowSync() {
        let subscriptions = [];

        subscriptions.push(vscode.commands.registerCommand('sn_sync.enterConnectionSettings', this.enterConnectionSettings, this));
        subscriptions.push(vscode.commands.registerCommand('sn_sync.syncTable', this.syncTable, this));
        subscriptions.push(vscode.commands.registerCommand('sn_sync.syncRecord', this.pullFile, this));
        subscriptions.push(vscode.commands.registerCommand('sn_sync.syncMultipleRecords', this.pullMultipleFiles, this));
        subscriptions.push(vscode.commands.registerCommand('sn_sync.openRecordInBrowser', this.openRecordInBrowser, this));
        subscriptions.push(vscode.commands.registerCommand('sn_sync.compareFile', this.compareFile, this));

        vscode.workspace.onWillSaveTextDocument(this.pushFile, this, subscriptions);

        this._disposable = vscode.Disposable.from.apply(vscode.Disposable, subscriptions);
    }

    ServiceNowSync.prototype.pushFile = function (event) {
        let _this = this;
        let doc = event.document;
        let prevDoc = '';

        let readFilePromise = new Promise((resolve, reject) => {
            try {
                prevDoc = fs.readFileSync(doc.fileName);
                resolve();
            } catch (ex) {
                reject();
            }
        });

        event.waitUntil(readFilePromise);

        readFilePromise.then(function () {
            if (_this.isSynced()) {
                let fileName = path.basename(doc.fileName);
                let fileFolder = path.dirname(doc.fileName);
                let folderSettings = _this.readSettings(fileFolder);
                let sys_id = folderSettings.files[fileName];

                if (typeof sys_id !== 'undefined') {
                    _this.getRecord(folderSettings, sys_id, (record) => {
                        if (record) {
                            let diff = jsdiff.diffChars(prevDoc.toString(), record[folderSettings.field]);

                            if (diff.length > 1 || diff[0].added || diff[0].removed) {
                                // Please note this is a variadic function
                                vscode.window.showInformationMessage('Remote record has been updated, overwrite?', 'Yes', 'No').then(function (res) {
                                    if (res === 'Yes') {
                                        _this.updateRecord(folderSettings, sys_id, doc.getText(), () => {
                                            vscode.window.setStatusBarMessage('✔️ File Uploaded', 2000);
                                        });
                                    } else {
                                        vscode.window.setStatusBarMessage('❌️ File Not Uploaded', 2000);
                                    }
                                });
                            } else {
                                _this.updateRecord(folderSettings, sys_id, doc.getText(), () => {
                                    vscode.window.setStatusBarMessage('✔️ File Uploaded', 2000);
                                });

                            }
                        }
                    });
                }
            }
        });
    }

    ServiceNowSync.prototype.compareFile = function (file) {
        let _this = this;
        let fsPath = file.fsPath;
        let prevDoc = fs.readFileSync(fsPath);

        let fileName = path.basename(fsPath);
        let fileFolder = path.dirname(fsPath);
        let folderSettings = _this.readSettings(fileFolder);
        let sys_id = folderSettings.files[fileName];

        if (typeof sys_id !== 'undefined') {
            _this.getRecord(folderSettings, sys_id, (record) => {
                if (record) {
                    let diff = jsdiff.diffChars(prevDoc.toString(), record[folderSettings.field]);

                    if (diff.length > 1 || diff[0].added || diff[0].removed) {
                        // Please note this is a variadic function
                        vscode.window.showInformationMessage('Remote record has been updated, overwrite local copy?', 'Yes', 'No').then(function (res) {
                            if (res === 'Yes') {
                                fs.writeFileSync(fsPath, record[folderSettings.field]);
                            } else {
                                vscode.window.setStatusBarMessage('❌️ File Not Updated', 2000);
                            }
                        });
                    } else {
                        vscode.window.setStatusBarMessage('✔️ File Is Up To Date', 2000);
                    }
                }
            });
        }
    }

    ServiceNowSync.prototype.enterConnectionSettings = function () {
        let _this = this;
        let url = '',
            username = '',
            password = '';

        let instancePromptOptions = {
            "prompt": "Enter the Instance URL",
            "validateInput": (val) => {
                if (val == '') return 'Please enter a valid value.';

                return null;
            }
        };

        let usernamePromptOptions = {
            "prompt": "Enter the Username",
            "validateInput": (val) => {
                if (val == '') return 'Please enter a valid value.';

                return null;
            }
        };

        let passwordPromptOptions = {
            "prompt": "Enter the Password",
            "password": true,
            "validateInput": (val) => {
                if (val == '') return 'Please enter a valid value.';

                return null;
            }
        };

        vscode.window.showInputBox(instancePromptOptions).then((val) => {
            url = val;
            vscode.window.showInputBox(usernamePromptOptions).then((val) => {
                username = val;
                vscode.window.showInputBox(passwordPromptOptions).then((val) => {
                    password = val;
                    _this.createConnectionFile({
                        "url": url,
                        "username": username,
                        "password": password
                    });
                });
            });
        });
    }

    ServiceNowSync.prototype.isSynced = function () {
        let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
        let file = path.resolve(rootFolder, 'service-now.json');
        return fs.existsSync(file);
    }

    ServiceNowSync.prototype.getRootSettings = function () {
        let _this = this;
        let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
        return _this.readSettings(rootFolder);
    }

    ServiceNowSync.prototype.isFolderSynced = function (folder) {
        let file = path.resolve(folder, 'service-now.json');
        return fs.existsSync(file);
    }

    ServiceNowSync.prototype.createConnectionFile = function (params) {
        let _this = this;
        let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
        let settings = {
            "instance": params.url,
            "auth": "Basic " + new Buffer(params.username + ':' + params.password).toString('base64')
        };

        _this.writeSettings(rootFolder, settings)

    };

    ServiceNowSync.prototype.syncTable = function () {
        let _this = this;

        let quickPickOptions = _.map(tableFieldList, (obj, key) => {
            return key
        });

        vscode.window.showQuickPick(quickPickOptions).then((table) => {
            if (typeof tableFieldList[table] !== 'undefined') {
                if (tableFieldList[table].length === 1) _this.createSingleFolder(table);
                if (tableFieldList[table].length > 1) _this.createMultiFolder(table);
            }
        });
    }

    ServiceNowSync.prototype.pullMultipleFiles = function (selectedFolder) {
        let _this = this;

        let queryPromptOptions = {
            "prompt": "Enter your encoded query",
            "validateInput": (val) => {
                if (val == '') return 'Please enter a valid value.';
                return null;
            }
        };

        vscode.window.showInputBox(queryPromptOptions).then(function (val) {
            _this.pullFile(selectedFolder, val);
        });
    }

    ServiceNowSync.prototype.pullFile = function (selectedFolder, query) {
        let _this = this;
        let folder = selectedFolder._fsPath;
        let settings = _this.readSettings(folder);
        let subSettings;
        let records = null;

        if (!settings) throw new ConfigException('No Folder Settings Found')

        let fields = ['sys_id', settings.display, settings.field].join(',');

        if (settings.multi) {
            let subFolders = glob.sync(folder + '/*/');
            subSettings = _.map(subFolders, (folder) => {
                let setting = _this.readSettings(folder);
                setting.folder = folder;

                return setting;
            });

            fields = ['sys_id']

            _.each(subSettings, (o) => {
                fields.push(o.field);
                fields.push(o.display);
            });

            fields = _.uniq(fields);
        }

        if (typeof query === 'undefined') {
            _this.listRecords(settings.table, fields, query, displayRecordList);
        } else {
            _this.listRecords(settings.table, fields, query, displayRecordConfirmation);
        }

        function displayRecordList(result) {
            if (result) {
                records = result;
                let quickPickItems = _.map(result, recordListToQuickPickItems);
                vscode.window.showQuickPick(quickPickItems).then(createSingleFile);
            } else {
                vscode.window.setStatusBarMessage('❌️ No Records Found', 2000);
            }
        }

        function displayRecordConfirmation(result) {
            if (result) {
                vscode.window.showInformationMessage('Action will create or update ' + result.length + ' files, continue?', 'Yes', 'No').then(function (res) {
                    if (res === 'Yes') {
                        _.each(result, createFile)
                    }
                });
            } else {
                vscode.window.setStatusBarMessage('❌️ File Sync Aborted', 2000);
            }
        }

        function createSingleFile(selected) {
            if (!selected) return false;
            let record = _.find(records, _.matchesProperty('sys_id', selected.detail));
            createFile(record);
        }

        function createFile(record) {
            if (typeof settings.multi !== 'undefined' && settings.multi === true) {
                _.each(subSettings, (setting) => {
                    let fileName = record[setting.display] + '.' + setting.extension;
                    let filePath = path.resolve(setting.folder, fileName);
                    fs.writeFileSync(filePath, record[setting.field]);

                    setting.files[fileName] = record.sys_id;
                    _this.writeSettings(setting.folder, setting);
                });
            } else {
                let fileName = record[settings.display] + '.' + settings.extension;
                let filePath = path.resolve(folder, fileName);
                fs.writeFileSync(filePath, record[settings.field]);

                settings.files[fileName] = record.sys_id;
                _this.writeSettings(folder, settings);
            }
        }


        function recordListToQuickPickItems(obj) {
            return {
                "detail": obj.sys_id,
                "label": obj[settings.display]
            };
        }
    };

    ServiceNowSync.prototype.createRequest = function (table) {
        let _this = this;
        let rootSettings = _this.getRootSettings();

        return {
            "method": "GET",
            "url": rootSettings.instance + '/api/now/table/' + table,
            "headers": {
                "Authorization": rootSettings.auth
            }

        }

    };

    ServiceNowSync.prototype.openRecordInBrowser = function () {
        let _this = this;
        let rootSettings = _this.getRootSettings();
        let fsPath = vscode.window.activeTextEditor._documentData._uri.fsPath;
        let filePath = path.dirname(fsPath);
        let fileName = path.basename(fsPath);

        if (rootSettings && _this.isFolderSynced(filePath)) {
            let folderSettings = _this.readSettings(filePath);
            let sys_id = folderSettings.files[fileName];
            opn(rootSettings.instance + '/' + folderSettings.table + '.do?sys_id=' + sys_id);
        }

    }

    ServiceNowSync.prototype.getRecord = function (settings, sys_id, cb) {
        let _this = this;
        let options = _this.createRequest(settings.table)

        options.url = options.url + '/' + sys_id;

        _this.executeRequest(options, cb);

    };

    ServiceNowSync.prototype.updateRecord = function (settings, sys_id, file, cb) {
        let _this = this;
        let options = _this.createRequest(settings.table)

        options.url = options.url + '/' + sys_id;
        options.method = "PATCH";
        options.json = {};
        options.json[settings.field] = file;

        _this.executeRequest(options, cb);

    };

    ServiceNowSync.prototype.listRecords = function (table, fields, query, cb) {
        let _this = this;
        let options = _this.createRequest(table)

        options.qs = {
            "sysparm_fields": fields,
            "sysparm_query": (typeof query !== 'undefined') ? query : ''
        };

        _this.executeRequest(options, cb);

    };

    ServiceNowSync.prototype.executeRequest = function (options, cb) {
        vscode.window.setStatusBarMessage('⏳ Querying ServiceNow...', 2000);
        request(options, parseResults);

        function parseResults(error, response, body) {
            vscode.window.setStatusBarMessage('', 0);
            if (!error && response.statusCode == 200) {
                let results = body;
                if (typeof body !== 'object') {
                    results = JSON.parse(body);
                }

                if (typeof results.result !== 'undefined') {
                    results = results.result;
                }

                cb(results);
            } else {
                vscode.window.showErrorMessage('Error 0161:' + error);
            }

            cb(null);
        }

    }

    ServiceNowSync.prototype.writeSettings = function (folder, settings) {
        let file = path.resolve(folder, 'service-now.json');
        fs.writeFileSync(file, JSON.stringify(settings, false, 4));
    }

    ServiceNowSync.prototype.readSettings = function (folder) {
        let file = path.resolve(folder, 'service-now.json');
        let settings = fs.readFileSync(file);

        try {
            settings = JSON.parse(settings);
            return settings;
        } catch (ex) {

            vscode.window.setStatusBarMessage('✔️ File Uploaded', 2000);
        }
        return false

    }

    ServiceNowSync.prototype.createSingleFolder = function (table) {
        let _this = this;
        let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
        let tableOptions = tableFieldList[table][0];
        let folderPath = path.resolve(rootFolder, table);
        let folderSettings = {
            "files": {},
            "extension": tableOptions.extension,
            "table": table,
            "display": "name",
            "field": tableOptions.field
        };

        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath);
            _this.writeSettings(folderPath, folderSettings)
        }

    }

    ServiceNowSync.prototype.createMultiFolder = function (table) {
        let _this = this;
        let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
        let rootFolderPath = path.resolve(rootFolder, table);

        let rootFolderSettings = {
            "multi": true,
            "display": "name",
            "table": table
        }

        if (!fs.existsSync(rootFolderPath)) {
            fs.mkdirSync(rootFolderPath);
            _this.writeSettings(rootFolderPath, rootFolderSettings);
        }

        _.each(tableFieldList[table], (tableOptions) => {
            let subFolderPath = path.resolve(rootFolder, table, tableOptions.field);
            let folderSettings = {
                "files": {},
                "extension": tableOptions.extension,
                "table": table,
                "display": "name",
                "field": tableOptions.field
            };

            if (!fs.existsSync(subFolderPath)) {
                fs.mkdirSync(subFolderPath);
                _this.writeSettings(subFolderPath, folderSettings);
            }
        });
    }


    // ServiceNowSync.prototype.isFolderView = function () {
    //     return typeof vscode.workspace.workspaceFolders !== 'undefined';
    // }

    return ServiceNowSync;
}())

function activate(context) {
    let serviceNowSync = new ServiceNowSync();
    context.subscriptions.push(serviceNowSync);
    console.log('ServiceNow Sync Activated')
}

function deactivate() {
    console.log('ServiceNow Sync Deactivated')
}

function ConfigException(message) {
    this.message = message;
    this.name = 'ConfigException';
}

exports.activate = activate;
exports.deactivate = deactivate;
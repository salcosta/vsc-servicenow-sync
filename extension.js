const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const tableFieldList = require('./tables');
const _ = require('lodash');
const request = require('request');
const jsdiff = require('diff');
const glob = require('glob');
const open = require('open');
const {
    htmlToText
} = require('html-to-text');
const sanitize = require("sanitize-filename");


var ServiceNowSync = (function () {
    function ServiceNowSync() {
        let subscriptions = [];

        subscriptions.push(vscode.commands.registerCommand('sn_sync.enterConnectionSettings', this.enterConnectionSettings, this));
        subscriptions.push(vscode.commands.registerCommand('sn_sync.enterProxySettings', this.enterProxySettings, this));
        subscriptions.push(vscode.commands.registerCommand('sn_sync.syncTable', this.syncTable, this));
        subscriptions.push(vscode.commands.registerCommand('sn_sync.syncRecord', this.pullFile, this));
        subscriptions.push(vscode.commands.registerCommand('sn_sync.syncMultipleRecords', this.pullMultipleFiles, this));
        subscriptions.push(vscode.commands.registerCommand('sn_sync.openRecordInBrowser', this.openRecordInBrowser, this));
        subscriptions.push(vscode.commands.registerCommand('sn_sync.compareFile', this.compareFile, this));
        subscriptions.push(vscode.commands.registerCommand('sn_sync.evalScript', this.evalCurrentFile, this));
        subscriptions.push(vscode.commands.registerCommand('sn_sync.updateScope', this.updateScope, this));

        vscode.workspace.onWillSaveTextDocument(this.pushFile, this, subscriptions);


        this.outputChannel = vscode.window.createOutputChannel('SN-Sync');
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
                let sys_id;

                if (folderSettings.groupedChild) {
                    sys_id = folderSettings.id;
                    folderSettings.field = fileName.split('.')[0];
                } else {
                    sys_id = folderSettings.files[fileName];
                }

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
    };

    ServiceNowSync.prototype.compareFile = function (file) {
        let _this = this;
        let fsPath = file.fsPath;
        let prevDoc = fs.readFileSync(fsPath);

        let fileName = path.basename(fsPath);
        let fileFolder = path.dirname(fsPath);
        let folderSettings = _this.readSettings(fileFolder);
        let sys_id;

        if (folderSettings.groupedChild) {
            sys_id = folderSettings.id;
            folderSettings.field = fileName.split('.')[0];
        } else {
            sys_id = folderSettings.files[fileName];
        }

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
    };

    ServiceNowSync.prototype.evalScript = function (script, scope, cb) {
        let _this = this;
        let rootSettings = _this.getRootSettings();

        var jar = request.jar();
        var headers = {
            "Accept": "*/*",
            "Connection": "keep-alive",
            "Cache-Control": "max-age=0",
            "User-Agent": "VSC-SERVICENOW-SYNC",
            "Accept-Encoding": "gzip, deflate",
            "Accept-Language": "en-US,en;q=0.8",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
        };
        var authHeader = rootSettings.auth.replace("Basic ", "");
        var authDecoded = new Buffer.from(authHeader, 'base64').toString('ascii');
        var options = {
            "method": "POST",
            "url": rootSettings.instance + '/login.do',
            "followAllRedirects": true,
            "headers": headers,
            "gzip": true,
            "jar": jar,
            "form": {
                "user_name": authDecoded.split(":")[0],
                "user_password": authDecoded.split(":")[1],
                "remember_me": "true",
                "sys_action": "sysverb_login"
            }
        };

        _this._addProxy(options);

        request(options, function (error, response, body) {
            var sysparm_ck = body.split("var g_ck = '")[1].split('\'')[0];

            if (!scope) scope = "rhino.global";
            var evalOptions = {
                'method': 'POST',
                'url': rootSettings.instance + '/sys.scripts.do',
                "followAllRedirects": true,
                "headers": headers,
                "gzip": true,
                "jar": jar,
                'form': {
                    "script": script,
                    "sysparm_ck": sysparm_ck,
                    "sys_scope": scope,
                    "runscript": "Run script",
                    "quota_managed_transaction": "on"
                }
            };
            _this._addProxy(evalOptions);

            request(evalOptions, function (error, response, body) {
                cb(htmlToText((function (body) {
                    return body.replace('<HTML><BODY>', '')
                        .replace('<HR/>', '<BR/>')
                        .replace('<HR/><PRE>', '<PRE>\n---&gt;\n')
                        .replace('<BR/></PRE><HR/></BODY></HTML>', '\n&lt;---</PRE>');
                })(body), {
                    wordwrap: false
                }));
            });
        });
    };

    ServiceNowSync.prototype.updateScope = function () {
        var _this = this;

        this.listRecords("sys_app", "sys_id,name", "scope!=global", function (result) {
            if (result) {
                records = result;
                let quickPickItems = _.map(result, function (obj) {
                    return {
                        "detail": obj.sys_id,
                        "label": obj.name
                    };
                });
                quickPickItems.unshift({
                    "detail": "rhino.global",
                    "label": "Global"
                });
                vscode.window.showQuickPick(quickPickItems).then(function (selected) {
                    _this._updateScope(selected.detail);
                });
            } else {
                vscode.window.setStatusBarMessage(' Scopes could not be loaded ...', 2000);
            }
        });
    }

    ServiceNowSync.prototype.evalCurrentFile = function () {
        var _this = this;
        let rootSettings = _this.getRootSettings();
        var script = vscode.window.activeTextEditor.document.getText();


        var executeMessage = vscode.window.setStatusBarMessage('⏳ Executing Code in ServiceNow ...');

        _this.evalScript(script, rootSettings.scope, function (outputStr) {
            executeMessage.dispose();
            _this.outputChannel.show(true);
            _this.outputChannel.appendLine(outputStr);
        });

    };

    ServiceNowSync.prototype.enterConnectionSettings = function () {
        let _this = this;
        let url = '',
            username = '',
            password = '';

        let instancePromptOptions = {
            "ingoreFocusOut": true,
            "prompt": "Enter the Instance URL",
            "validateInput": (val) => {
                if (val == '') return 'Please enter a valid value.';

                return null;
            }
        };

        let usernamePromptOptions = {
            "ignoreFocusOut": true,
            "prompt": "Enter the Username",
            "validateInput": (val) => {
                if (val == '') return 'Please enter a valid value.';

                return null;
            }
        };

        let passwordPromptOptions = {
            "ignoreFocusOut": true,
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
                        "password": password,
                        "scope": "rhino.global"
                    });
                });
            });
        });
    };

    ServiceNowSync.prototype.enterProxySettings = function () {
        let _this = this;
        let proxyUrl = '',
            proxyPort = null,
            proxyUsername = '',
            proxyPassword = '';

        let proxyUrlPrompt = {
            "ingoreFocusOut": true,
            "prompt": "Enter the Proxy URL (or leave blank to disable proxy)",
            "validateInput": (val) => {
                return null;
            }
        };

        let proxyPortPrompt = {
            "ignoreFocusOut": true,
            "prompt": "Enter the Proxy Port",
            "validateInput": (val) => {
                return null;
            }
        };

        let proxyUserPrompt = {
            "ignoreFocusOut": true,
            "prompt": "Enter the Proxy User (or leave blank)",
            "validateInput": (val) => {
                return null;
            }
        };

        let proxyPasswordPrompt = {
            "ignoreFocusOut": true,
            "prompt": "Enter the Proxy Password (or leave blank)",
            "password": true,
            "validateInput": (val) => {
                return null;
            }
        };

        vscode.window.showInputBox(proxyUrlPrompt).then((val) => {
            proxyUrl = val;
            if (proxyUrl == '') {
                _this._updateProxy(null);
            } else {
                vscode.window.showInputBox(proxyPortPrompt).then((val) => {
                    if (val != '') {
                        proxyPort = val;
                    }

                    vscode.window.showInputBox(proxyUserPrompt).then((val) => {
                        proxyUsername = val;
                        if (proxyUsername != '') {
                            vscode.window.showInputBox(proxyPasswordPrompt).then((val) => {
                                proxyPassword = val;
                                _this._updateProxy({
                                    "url": proxyUrl,
                                    "port": proxyPort,
                                    "auth": new Buffer.from(proxyUsername + ':' + proxyPassword).toString('base64')
                                });
                            });
                        } else {
                            _this._updateProxy({
                                "url": proxyUrl,
                                "port": proxyPort,
                                "auth": null
                            });
                        }
                    });
                });
            }

        });
    };

    ServiceNowSync.prototype.isSynced = function () {
        let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
        let file = path.resolve(rootFolder, 'service-now.json');
        return fs.existsSync(file);
    };

    ServiceNowSync.prototype.getRootSettings = function () {
        let _this = this;
        let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
        return _this.readSettings(rootFolder);
    };

    ServiceNowSync.prototype._updateScope = function (scope) {
        let _this = this;
        let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
        let rootSettings = _this.getRootSettings();
        rootSettings.scope = scope;

        _this.writeSettings(rootFolder, rootSettings);
    }

    ServiceNowSync.prototype._updateProxy = function (proxySettings) {
        let _this = this;
        let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
        let rootSettings = _this.getRootSettings();
        rootSettings.proxy = proxySettings;

        _this.writeSettings(rootFolder, rootSettings);
    }

    ServiceNowSync.prototype.isFolderSynced = function (folder) {
        let file = path.resolve(folder, 'service-now.json');
        return fs.existsSync(file);
    };

    ServiceNowSync.prototype.createConnectionFile = function (params) {
        let _this = this;
        let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
        let settings = {
            "instance": params.url,
            "auth": "Basic " + new Buffer.from(params.username + ':' + params.password).toString('base64')
        };

        _this.writeSettings(rootFolder, settings)

    };

    ServiceNowSync.prototype.syncTable = function () {
        let _this = this;

        let quickPickOptions = _.map(tableFieldList, (obj, key) => {
            return {
                'label': tableFieldList[key]['table_display_name'] + ' (' + key + ')',
                'detail': null,
                'table_name': key,
                'table_display_name': tableFieldList[key]['table_display_name']
            }

        });

        quickPickOptions.unshift({
            'label': 'CapIO Suite',
            'detail': 'CapIO Automated Testing by Cerna Solutions',
            'table_name': 'CapIO Suite'
        });

        quickPickOptions.unshift({
            'label': 'Custom Table',
            'detail': 'Synchronize a table which is not listed here',
            'table_name': 'custom_table'
        });

        vscode.window.showQuickPick(quickPickOptions).then((userSelection) => {

            if (typeof userSelection.label !== 'undefined' && userSelection.label == 'CapIO Suite') {
                _this.listRecords('x_cerso_capio_test_suite', ['sys_id', 'name'].join(','), undefined, function (result) {

                    if (result) {
                        records = result;
                        let quickPickItems = _.map(result, function (obj) {
                            return {
                                "detail": obj.sys_id,
                                "label": obj.name
                            };
                        });

                        vscode.window.showQuickPick(quickPickItems).then(function (selected) {
                            if (selected) {
                                let path = _this.createGroupedFolder('x_cerso_capio_test_case', selected.label);
                                _this.pullFile({
                                    _fsPath: path
                                }, undefined, 'test_suite=' + selected.detail);
                            }
                        });

                    } else {
                        vscode.window.setStatusBarMessage('❌️ No Suites Found', 2000);
                    }
                });
            } else if (userSelection.label == 'Custom Table') {
                _this._syncCustomTable();
            } else if (typeof tableFieldList[userSelection.table_name] !== 'undefined') {

                let folderNameQuickPickItems = [{
                        label: "Create folder with table display name",
                        detail: userSelection.table_display_name,
                        folderName: userSelection.table_display_name
                    },
                    {
                        label: "Create folder with table technical name",
                        detail: userSelection.table_name,
                        folderName: userSelection.table_name
                    },

                ];

                vscode.window.showQuickPick(folderNameQuickPickItems).then((folderChoice) => {
                    let folderName = folderChoice.folderName;

                    let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
                    let rootFolderPath = path.resolve(rootFolder, folderName);

                    if (fs.existsSync(rootFolderPath)) {
                        vscode.window.setStatusBarMessage('❌️ Folder ' + folderName + ' already exists', 2000);
                    } else {
                        
                        if (tableFieldList[userSelection.table_name]['field_list_array'].length === 1) {
                            _this.createSingleFolder(userSelection.table_name, folderName);
                        } else if (tableFieldList[userSelection.table_name]['field_list_array'].length > 1) {
                            let multiFolderChoiceQuickPick = [
                                'Group files by Field',
                                'Group files by Record',
                            ];

                            vscode.window.showQuickPick(multiFolderChoiceQuickPick).then((groupChoice) => {
                                if (groupChoice === 'Group files by Field') {
                                    _this.createMultiFolder(userSelection.table_name, folderName);
                                } else {
                                    _this.createGroupedFolder(userSelection.table_name, folderName);
                                }
                            });
                        }

                        vscode.window.setStatusBarMessage('✔️ folder ' + folderName + ' created', 2000);

                    }
                });


            } else {
                vscode.window.setStatusBarMessage('❌️ Error trying to sync table ' + userSelection.label, 2000);
            }

        });
    };

    ServiceNowSync.prototype._syncCustomTable = function () {
        let _this = this;
        let table = '',
            display = '',
            field = '',
            extension = '';

        let tableNamePrompt = {
            "ingoreFocusOut": true,
            "prompt": "Enter the table name",
            "validateInput": (val) => {
                if (val == '') return 'Please enter a valid value.';

                return null;
            }
        };

        let displayNamePrompt = {
            "ingoreFocusOut": true,
            "prompt": "Enter the display field name",
            "validateInput": (val) => {
                if (val == '') return 'Please enter a valid value.';

                return null;
            }
        };

        let bodyFieldNamePrompt = {
            "ingoreFocusOut": true,
            "prompt": "Enter the field to sync",
            "validateInput": (val) => {
                if (val == '') return 'Please enter a valid value.';

                return null;
            }
        };

        let extensionPrompt = {
            "ingoreFocusOut": true,
            "prompt": "Enter the file type",
            "validateInput": (val) => {
                if (val == '') return 'Please enter a valid value.';

                return null;
            }
        };

        vscode.window.showInputBox(tableNamePrompt).then((val) => {
            table = val;
            vscode.window.showInputBox(displayNamePrompt).then((val) => {
                display = val;
                vscode.window.showInputBox(bodyFieldNamePrompt).then((val) => {
                    field = val;
                    vscode.window.showInputBox(extensionPrompt).then((val) => {
                        extension = val;
                        let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
                        let folderPath = path.resolve(rootFolder, table);
                        let folderSettings = {
                            "files": {},
                            "extension": extension,
                            "table": table,
                            "display": display,
                            "field": field
                        };

                        if (!fs.existsSync(folderPath)) {
                            fs.mkdirSync(folderPath);
                            _this.writeSettings(folderPath, folderSettings)
                        }
                    });
                });
            });
        });
    }

    ServiceNowSync.prototype.pullMultipleFiles = function (selectedFolder) {
        let _this = this;

        let queryPromptOptions = {
            "prompt": "Enter your encoded query"
        };

        vscode.window.showInputBox(queryPromptOptions).then(function (val) {
            _this.pullFile(selectedFolder, null, val);
        });
    };

    ServiceNowSync.prototype.pullFile = function (selectedFolder, sourceArguments, query) {
        let _this = this;
        let folder = selectedFolder._fsPath;
        let settings = _this.readSettings(folder);
        let subSettings;
        let records = null;

        if (!settings) throw new ConfigException('No Folder Settings Found')

        let fields = ['sys_id', settings.display];

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

        } else if (settings.grouped) {
            _.each(settings.fields, (o) => {
                fields.push(o.field);
            });
        } else {
            fields.push(settings.field)
        }

        if (typeof query === 'string') {
            _this.listRecords(settings.table, fields.join(','), query, function (results) {
                displayRecordConfirmation(results)
            });
        } else {
            _this.listRecords(settings.table, ['sys_id', settings.display].join(','), query, function (results) {
                displayRecordList(results);
            });
        }

        function displayRecordList(result) {
            if (result) {
                records = result;
                let quickPickItems = _.map(result, recordListToQuickPickItems);
                if (settings.grouped) {
                    vscode.window.showQuickPick(quickPickItems).then(createGroupedFiles);
                } else {
                    vscode.window.showQuickPick(quickPickItems).then(createSingleFile);
                }

            } else {
                vscode.window.setStatusBarMessage('❌️ No Records Found', 2000);
            }
        }

        function displayRecordConfirmation(result) {
            if (result) {
                vscode.window.showInformationMessage('Action will create or update ' + result.length + ' files, continue?', 'Yes', 'No').then(function (res) {
                    if (res === 'Yes') {
                        if (settings.grouped) {
                            _.each(result, createFiles)
                        } else {
                            _.each(result, createFile)
                        }

                    }
                });
            } else {
                vscode.window.setStatusBarMessage('❌️ File Sync Aborted', 2000);
            }
        }

        function createSingleFile(selected) {
            if (!selected) return false;

            _this.getRecord(settings, selected.detail, function (record) {
                createFile(record);
            });
        }

        function createGroupedFiles(selected) {
            if (!selected) return false;

            _this.getRecord(settings, selected.detail, function (record) {
                createFiles(record);
            });

        }

        function createFiles(record) {
            let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
            let folderPath = path.resolve(folder, sanitize(record[settings.display], {
                replacement: '_'
            }));

            let folderSettings = {
                "groupedChild": true,
                "table": settings.table,
                "id": record.sys_id
            };

            if (!fs.existsSync(folderPath)) {
                fs.mkdirSync(folderPath);
                _this.writeSettings(folderPath, folderSettings);
            }

            _.each(settings.fields, function (fieldSettings) {
                let fileName = fieldSettings.name + '.' + fieldSettings.extension;
                let filePath = path.resolve(folderPath, fileName);
                fs.writeFileSync(filePath, record[fieldSettings.field]);
            });
        }

        function createFile(record) {
            if (typeof settings.multi !== 'undefined' && settings.multi === true) {
                _.each(subSettings, (setting) => {
                    let fileName = sanitize(record[setting.display], {
                        replacement: '_'
                    }) + '.' + setting.extension;
                    let filePath = path.resolve(setting.folder, fileName);
                    fs.writeFileSync(filePath, record[setting.field]);

                    setting.files[fileName] = record.sys_id;
                    _this.writeSettings(setting.folder, setting);
                });
            } else {
                let fileName = sanitize(record[settings.display], {
                    replacement: '_'
                }) + '.' + settings.extension;
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

        var options = {
            "method": "GET",
            "url": rootSettings.instance + '/api/now/table/' + table,
            "headers": {
                "Authorization": rootSettings.auth
            }
        };

        return _this._addProxy(options);
    };

    ServiceNowSync.prototype._addProxy = function (options) {
        let _this = this;
        let rootSettings = _this.getRootSettings();

        if (rootSettings.proxy) {
            var domain = rootSettings.proxy.url.split('://')[1];
            var protocol = rootSettings.proxy.url.split('://')[0];
            var url = [protocol, '://'];
            if (rootSettings.proxy.auth) {
                let authDecoded = new Buffer.from(rootSettings.proxy.auth, 'base64').toString('ascii');
                url.push(authDecoded);
                url.push('@');
            }

            url.push(domain);

            if (rootSettings.proxy.port) {
                url.push(':');
                url.push(rootSettings.proxy.port);
            }

            options.proxy = url.join('');
        }

        return options;
    }

    ServiceNowSync.prototype.openRecordInBrowser = function () {
        let _this = this;
        let rootSettings = _this.getRootSettings();
        let fsPath = vscode.window.activeTextEditor.document.uri.fsPath;
        let filePath = path.dirname(fsPath);
        let fileName = path.basename(fsPath);

        if (rootSettings && _this.isFolderSynced(filePath)) {
            let folderSettings = _this.readSettings(filePath);
            let sys_id;

            if (folderSettings.groupedChild) {
                sys_id = folderSettings.id;
            } else {
                sys_id = folderSettings.files[fileName];
            }

            if (typeof sys_id !== 'undefined') {
                open(rootSettings.instance + '/' + folderSettings.table + '.do?sys_id=' + sys_id);
            }

        }

    };

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
        var queryMessage = vscode.window.setStatusBarMessage('⏳ Querying ServiceNow...');
        request(options, parseResults);

        function parseResults(error, response, body) {
            queryMessage.dispose();
            // vscode.window.setStatusBarMessage('', 0);
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

            //cb(null); Why calling the callback function a second time?
        }

    };

    ServiceNowSync.prototype.writeSettings = function (folder, settings) {
        let file = path.resolve(folder, 'service-now.json');
        fs.writeFileSync(file, JSON.stringify(settings, false, 4));
    };

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

    };

    ServiceNowSync.prototype.createSingleFolder = function (tableName, folderName) {
        let _this = this;
        let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
        let tableOptions = tableFieldList[tableName]['field_list_array'][0];
        let folderPath = path.resolve(rootFolder, folderName);
        let folderSettings = {
            "files": {},
            "extension": tableOptions.extension,
            "table": tableName,
            "display": "name",
            "field": tableOptions.field
        };

        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath);
            _this.writeSettings(folderPath, folderSettings)
        }

    };

    ServiceNowSync.prototype.createGroupedFolder = function (tableName, folderName) {
        let _this = this;

        let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
        let groupedFolderPath = path.resolve(rootFolder, folderName);

        let groupedFolderSettings = {
            "grouped": true,
            "display": "name",
            "table": tableName,
            "fields": _.map(tableFieldList[tableName]['field_list_array'], (fieldOptions) => {
                return {
                    "name": fieldOptions.field,
                    "field": fieldOptions.field,
                    "extension": fieldOptions.extension,
                }
            })

        }

        if (!fs.existsSync(groupedFolderPath)) {
            fs.mkdirSync(groupedFolderPath);
        }

        _this.writeSettings(groupedFolderPath, groupedFolderSettings);

        return groupedFolderPath;
    };

    ServiceNowSync.prototype.createMultiFolder = function (tableName, folderName) {
        let _this = this;
        let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
        let rootFolderPath = path.resolve(rootFolder, folderName);

        let rootFolderSettings = {
            "multi": true,
            "display": "name",
            "table": tableName
        }

        if (!fs.existsSync(rootFolderPath)) {
            fs.mkdirSync(rootFolderPath);
            _this.writeSettings(rootFolderPath, rootFolderSettings);
        }

        _.each(tableFieldList[tableName]['field_list_array'], (tableOptions) => {
            let subFolderPath = path.resolve(rootFolder, folderName, tableOptions.field);
            let folderSettings = {
                "files": {},
                "extension": tableOptions.extension,
                "table": tableName,
                "display": "name",
                "field": tableOptions.field
            };

            if (!fs.existsSync(subFolderPath)) {
                fs.mkdirSync(subFolderPath);
                _this.writeSettings(subFolderPath, folderSettings);
            }
        });
    };

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
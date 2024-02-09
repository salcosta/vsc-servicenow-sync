const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const tableFieldList = require("./tables");
const _ = require("lodash");
const request = require("request");
const jsdiff = require("diff");
const open = require("open");
const { htmlToText } = require('html-to-text');
const sanitize = require("sanitize-filename");
const tmp = require("tmp");
const urlParse = require("url-parse");
const { v4: uuidv4 } = require("uuid");

var ServiceNowSync = (function () {
  function ServiceNowSync() {
    let subscriptions = [];

    /**
     * Registers a URI handler which VSCode will redirect here if the authority is `anerrantprogrammer.servicenow-sync`
     *
     * Had to include some functions through a hack because they did not exist in the handleUri scope
     */
    vscode.window.registerUriHandler({
      handleUri: function (uri) {
        let _this = this;
        // Had to create a full URI from the individual parts in order to parse it

        if (uri.path.indexOf("/sync") == 0) {
          let uriParts = new urlParse(`${uri.scheme}://${uri.authority}${uri.path}?${uri.query}`, true);
          if (typeof uriParts.query == "object") {
            let table = uriParts.query.table;
            let sys_id = uriParts.query.sys_id;
            let folder = this.parent.createFolderIfNotExisting(table);
            let settings = this.parent.readSettings(folder);
            this.parent.getFile(settings, "sys_id=" + sys_id, true, folder);
          }
        } else {
          let uriParts = new urlParse(`${uri.scheme}://${uri.authority}${uri.path}?${uri.fragment}`, true);
          // If the response is successful from ServiceNow it should contain an `access_token` property
          if (typeof uriParts.query == "object" && typeof uriParts.query.access_token !== "undefined") {
            let accessToken = uriParts.query.access_token;
            let instanceId = uriParts.query.state;
            let rootSettings = _this.getRootSettings();
            let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;

            // OAuth auth property should contain the prefix Bearer
            if (instanceId === rootSettings.id) {
              rootSettings.auth = "Bearer " + accessToken;
              _this.writeSettings(rootFolder, rootSettings);
              vscode.window.showInformationMessage("OAuth connection complete");
            }
          } else {
            vscode.window.showErrorMessage("Error 0033: OAuth response is malformed");
          }

        }
      },
      parent: this,
      createFolderIfNotExisting: this.createFolderIfNotExisting,
      getFile: this.getFile,
      getRootSettings: this.getRootSettings,
      readSettings: this.readSettings,
      writeSettings: this.writeSettings,
    });

    /**
     * Registers the commmands and associates them with handler functions
     */
    subscriptions.push(vscode.commands.registerCommand("sn_sync.enterConnectionSettings", this.enterConnectionSettings, this));
    subscriptions.push(vscode.commands.registerCommand("sn_sync.enterProxySettings", this.enterProxySettings, this));
    subscriptions.push(vscode.commands.registerCommand("sn_sync.syncApplication", this.syncApplication, this));
    subscriptions.push(vscode.commands.registerCommand("sn_sync.syncTable", this.syncTable, this));
    subscriptions.push(vscode.commands.registerCommand("sn_sync.syncRecord", this.pullFile, this));
    subscriptions.push(vscode.commands.registerCommand("sn_sync.syncMultipleRecords", this.pullMultipleFiles, this));
    subscriptions.push(vscode.commands.registerCommand("sn_sync.refreshFolder", this.refreshFolder, this));
    subscriptions.push(vscode.commands.registerCommand("sn_sync.refreshFolderQuery", this.refreshFolderQuery, this));
    subscriptions.push(vscode.commands.registerCommand("sn_sync.openRecordInBrowser", this.openRecordInBrowser, this));
    subscriptions.push(vscode.commands.registerCommand("sn_sync.compareFile", this.compareFile, this));
    subscriptions.push(vscode.commands.registerCommand("sn_sync.evalScript", this.evalCurrentFile, this));
    subscriptions.push(vscode.commands.registerCommand("sn_sync.updateScope", this.updateScope, this));
    subscriptions.push(vscode.commands.registerCommand("sn_sync.refreshOauthToken", this.refreshOauthToken, this));

    /**
     * Registers the global onSave event to sync files to records
     */
    vscode.workspace.onWillSaveTextDocument(this.pushFile, this, subscriptions);

    this.outputChannel = vscode.window.createOutputChannel("SN-Sync");
    this._disposable = vscode.Disposable.from.apply(vscode.Disposable, subscriptions);
  }

  /**
   * Adds proxy settings to an outbound request
   * @param {object} options
   * @returns {object} Modified options object with proxy settings
   */
  ServiceNowSync.prototype._addProxy = function (options) {
    let _this = this;
    let rootSettings = _this.getRootSettings();

    // If proxy settings exist at the root add them, otherwise just skip it
    if (rootSettings.proxy) {
      var domain = rootSettings.proxy.url.split("://")[1];
      var protocol = rootSettings.proxy.url.split("://")[0];
      var url = [protocol, "://"];
      if (rootSettings.proxy.auth) {
        let authDecoded = new Buffer.from(rootSettings.proxy.auth, "base64").toString("ascii");
        url.push(authDecoded);
        url.push("@");
      }

      url.push(domain);

      if (rootSettings.proxy.port) {
        url.push(":");
        url.push(rootSettings.proxy.port);
      }

      options.proxy = url.join("");
    }

    return options;
  };

  /**
   * Creates a synced folder within the project root
   * @param {string} table
   * @returns {string} Path of the folder that was created
   */
  ServiceNowSync.prototype._createFolder = function (table, query) {
    let _this = this;
    if (table == "Custom Table") {
      _this._syncCustomTable();
    } else if (typeof tableFieldList[table] !== "undefined") {
      if (tableFieldList[table].length === 1) {
        // For tables that have a single field to sync just create one folder with a settings object
        return _this.createSingleFolder(table, query);
      } else {
        // For tables that have more than one potential field create a grouped folder which will group records into their own folders
        return _this.createGroupedFolder(table, undefined, query);
      }
    }
  };

  /**
   * Prompts the user for information to create a custom table synced folder
   */
  ServiceNowSync.prototype._syncCustomTable = function () {
    let _this = this;
    let table = "",
      display = "",
      field = "",
      extension = "";

    let tableNamePrompt = {
      ingoreFocusOut: true,
      prompt: "Enter the table name",
      validateInput: (val) => {
        if (val == "") return "Please enter a valid value.";

        return null;
      },
    };

    let displayNamePrompt = {
      ingoreFocusOut: true,
      prompt: "Enter the display field name",
      validateInput: (val) => {
        if (val == "") return "Please enter a valid value.";

        return null;
      },
    };

    let bodyFieldNamePrompt = {
      ingoreFocusOut: true,
      prompt: "Enter the field to sync",
      validateInput: (val) => {
        if (val == "") return "Please enter a valid value.";

        return null;
      },
    };

    let extensionPrompt = {
      ingoreFocusOut: true,
      prompt: "Enter the file type",
      validateInput: (val) => {
        if (val == "") return "Please enter a valid value.";

        return null;
      },
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
              files: {},
              extension: extension,
              table: table,
              display: display,
              field: field,
            };

            if (!fs.existsSync(folderPath)) {
              fs.mkdirSync(folderPath);
              _this.writeSettings(folderPath, folderSettings);
            }

            return folderPath;
          });
        });
      });
    });
  };

  /**
   * Writes the proxy settings property in the root settings file
   * @param {object} proxySettings A proxy settings object
   */
  ServiceNowSync.prototype._updateProxy = function (proxySettings) {
    let _this = this;
    let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
    let rootSettings = _this.getRootSettings();
    rootSettings.proxy = proxySettings;

    _this.writeSettings(rootFolder, rootSettings);
  };

  /**
   * Sets the scope property in the root settings file
   * @param {string} scope Name of the scope to set
   */
  ServiceNowSync.prototype._updateScope = function (scope) {
    let _this = this;
    let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
    let rootSettings = _this.getRootSettings();
    rootSettings.scope = scope;

    _this.writeSettings(rootFolder, rootSettings);
  };

  /**
   * Compares a given file to the same record on the server by looking up the sys_id and table and then retrieving the record
   * and comparing it to the local file
   * @param {object} file VSCode file object
   */
  ServiceNowSync.prototype.compareFile = async function (file) {
    let _this = this;
    let fsPath = file.fsPath;
    let prevDoc = fs.readFileSync(fsPath);
    let fileName = path.basename(fsPath);
    let fileFolder = path.dirname(fsPath);
    let folderSettings = _this.readSettings(fileFolder);
    let sys_id = folderSettings.id || folderSettings.files[fileName];

    if (folderSettings.groupedChild) {
      folderSettings.field = fileName.split(".")[0];
    }

    if (typeof sys_id !== "undefined") {
      _this.getRecord(folderSettings, sys_id, (record) => {
        if (record) {
          let content = record[folderSettings.field];
          if (_this.getDiffs(prevDoc, content)) {
            vscode.window.showInformationMessage("Remote record has been updated", "Overwrite local", "Ignore", "Show diff").then(async function (res) {
              if (res === "Overwrite local") {
                fs.writeFileSync(fsPath, content);
              } else if (res === "Show diff") {
                _this.showDiff(content, file);
              }
            });
          } else {
            vscode.window.showInformationMessage("File matches server");
          }
        }
      });
    }
  };

  /**
   * Creates a connection file in the root folder
   * @param {object} params A parameters object which specifies the instance URL and authentication settings for Basic or OAuth
   */
  ServiceNowSync.prototype.createConnectionFile = async function (params) {
    let _this = this;
    let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
    let settings = {
      instance: params.url,
      id: uuidv4(),
      type: params.type,
    };

    if (params.type === "basic") {
      settings.auth = "Basic " + new Buffer.from(params.username + ":" + params.password).toString("base64");
    } else if (params.type == "oauth") {
      settings.client_id = params.client_id;
      let oauthPath = `oauth_auth.do?response_type=token&redirect_uri=vscode://anerrantprogrammer.servicenow-sync/authenticate&client_id=${settings.client_id}&state=${settings.id}`;
      await open(params.url + "/" + oauthPath);
    }

    _this.writeSettings(rootFolder, settings);
  };

  /**
   * Creates a folder which syncs multiple fields to local files
   * @param {string} table The name of the table which the folder should sync to
   * @param {string} nameOverride An alternative name to use for the folder instead of the table
   * @returns {object} The core settings object
   */
  ServiceNowSync.prototype.createGroupedFolder = function (table, nameOverride, query) {
    let _this = this;
    let folderName = table;
    if (nameOverride && typeof nameOverride !== "undefined") {
      folderName = nameOverride;
    }

    let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
    let groupedFolderPath = path.resolve(rootFolder, folderName);

    let groupedFolderSettings = {
      grouped: true,
      display: "name",
      table: table,
      fields: _.map(tableFieldList[table], (fieldOptions) => {
        return {
          name: fieldOptions.field,
          field: fieldOptions.field,
          extension: fieldOptions.extension,
        };
      }),
    };

    if (query && typeof query !== "undefined") {
      groupedFolderSettings.query = query;
    }

    if (!fs.existsSync(groupedFolderPath)) {
      fs.mkdirSync(groupedFolderPath);
    }

    _this.writeSettings(groupedFolderPath, groupedFolderSettings);

    if (typeof query !== "undefined") {
      _this.refreshFolderQuery(groupedFolderPath, true);
    }

    return groupedFolderPath;
  };

  /**
   * Creates an options object to use in a request
   * @param {string} table The name of the table to create an API request for
   * @returns {object} A Request options object with proxy information if specified
   */
  ServiceNowSync.prototype.createRequest = function (table) {
    let _this = this;
    let rootSettings = _this.getRootSettings();

    var options = {
      method: "GET",
      url: rootSettings.instance + "/api/now/table/" + table,
      headers: {
        Authorization: rootSettings.auth,
      },
    };

    return _this._addProxy(options);
  };

  ServiceNowSync.prototype.createFolderIfNotExisting = function (table) {
    let _this = this;
    let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
    let folderPath = path.resolve(rootFolder, table);

    if (!fs.existsSync(folderPath)) {
      _this._createFolder(table);
    }

    return folderPath;
  }

  /**
   * Creates a folder which syncs a single field on a table to a local file
   * @param {string} table The name of the table to create a local folder for
   * @returns {string} The full path created
   */
  ServiceNowSync.prototype.createSingleFolder = function (table, query) {
    let _this = this;
    let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
    let tableOptions = tableFieldList[table][0];
    let folderPath = path.resolve(rootFolder, table);
    let folderSettings = {
      files: {},
      extension: tableOptions.extension,
      table: table,
      display: "name",
      field: tableOptions.field,
    };

    if (typeof query !== "undefined") {
      folderSettings.query = query;
    }

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath);
      _this.writeSettings(folderPath, folderSettings);
    }

    if (typeof query !== "undefined") {
      _this.refreshFolderQuery(folderPath, true);
    }

    return folderPath;
  };

  /**
   * Creates a temporary file for use in diffing a local file to a remote record
   * @param {string} content The content to write to the temp file
   * @returns {string} The full path to the temp file
   */
  ServiceNowSync.prototype.createTempFile = function (content) {
    const tmpobj = tmp.fileSync();
    fs.writeFileSync(tmpobj.name, content);
    let tempFileUri = vscode.Uri.file(tmpobj.name);
    return tempFileUri;
  };

  /**
   * Prompts a user for connection information
   */
  ServiceNowSync.prototype.enterConnectionSettings = function () {
    let _this = this;
    let url = "",
      username = "",
      password = "";

    let instancePromptOptions = {
      ingoreFocusOut: true,
      prompt: "Enter the Instance URL",
      validateInput: (val) => {
        if (val == "") return "Please enter a valid value.";

        return null;
      },
    };

    let oauthPrompt = {
      ingoreFocusOut: true,
      prompt: "Enter OAuth Client ID",
      validateInput: (val) => {
        if (val == "") return "Please enter a valid value.";

        return null;
      },
    };

    let usernamePromptOptions = {
      ignoreFocusOut: true,
      prompt: "Enter the Username",
      validateInput: (val) => {
        if (val == "") return "Please enter a valid value.";

        return null;
      },
    };

    let passwordPromptOptions = {
      ignoreFocusOut: true,
      prompt: "Enter the Password",
      password: true,
      validateInput: (val) => {
        if (val == "") return "Please enter a valid value.";

        return null;
      },
    };

    vscode.window.showQuickPick(["Connect with Basic Authentication", "Connect with OAuth"]).then((selection) => {
      if (selection === "Connect with Basic Authentication") {
        vscode.window.showInputBox(instancePromptOptions).then((val) => {
          url = val;
          vscode.window.showInputBox(usernamePromptOptions).then((val) => {
            username = val;
            vscode.window.showInputBox(passwordPromptOptions).then((val) => {
              password = val;
              _this.createConnectionFile({
                url: url,
                type: "basic",
                username: username,
                password: password,
                scope: "rhino.global",
              });
            });
          });
        });
      } else {
        vscode.window.showInputBox(instancePromptOptions).then((val) => {
          url = val;
          vscode.window.showInputBox(oauthPrompt).then((val) => {
            _this.createConnectionFile({
              url: url,
              type: "oauth",
              client_id: val,
              scope: "rhino.global",
            });
          });
        });
      }
    });
  };

  /**
   * Prompts a user for Proxy settings
   */
  ServiceNowSync.prototype.enterProxySettings = function () {
    let _this = this;
    let proxyUrl = "",
      proxyPort = null,
      proxyUsername = "",
      proxyPassword = "";

    let proxyUrlPrompt = {
      ingoreFocusOut: true,
      prompt: "Enter the Proxy URL (or leave blank to disable proxy)",
      validateInput: (val) => {
        return null;
      },
    };

    let proxyPortPrompt = {
      ignoreFocusOut: true,
      prompt: "Enter the Proxy Port",
      validateInput: (val) => {
        return null;
      },
    };

    let proxyUserPrompt = {
      ignoreFocusOut: true,
      prompt: "Enter the Proxy User (or leave blank)",
      validateInput: (val) => {
        return null;
      },
    };

    let proxyPasswordPrompt = {
      ignoreFocusOut: true,
      prompt: "Enter the Proxy Password (or leave blank)",
      password: true,
      validateInput: (val) => {
        return null;
      },
    };

    vscode.window.showInputBox(proxyUrlPrompt).then((val) => {
      proxyUrl = val;
      if (proxyUrl == "") {
        _this._updateProxy(null);
      } else {
        vscode.window.showInputBox(proxyPortPrompt).then((val) => {
          if (val != "") {
            proxyPort = val;
          }

          vscode.window.showInputBox(proxyUserPrompt).then((val) => {
            proxyUsername = val;
            if (proxyUsername != "") {
              vscode.window.showInputBox(proxyPasswordPrompt).then((val) => {
                proxyPassword = val;
                _this._updateProxy({
                  url: proxyUrl,
                  port: proxyPort,
                  auth: new Buffer.from(proxyUsername + ":" + proxyPassword).toString("base64"),
                });
              });
            } else {
              _this._updateProxy({
                url: proxyUrl,
                port: proxyPort,
                auth: null,
              });
            }
          });
        });
      }
    });
  };

  /**
   * Attemps to execute the current file as a Scripts Background page in ServiceNow
   */
  ServiceNowSync.prototype.evalCurrentFile = function () {
    var _this = this;
    let rootSettings = _this.getRootSettings();
    var script = vscode.window.activeTextEditor.document.getText();

    var executeMessage = vscode.window.setStatusBarMessage("⏳ Executing Code in ServiceNow ...");

    _this.evalScript(script, rootSettings.scope, function (outputStr) {
      executeMessage.dispose();
      _this.outputChannel.show(true);
      _this.outputChannel.clear();
      _this.outputChannel.appendLine(outputStr);
    });
  };

  ServiceNowSync.prototype.evalScript = function (script, scope, cb) {
    let _this = this;
    let rootSettings = _this.getRootSettings();
    if (rootSettings.type == "oauth") {
      vscode.window.showErrorMessage("Executing Background Scripts is not available with OAuth");
      return false;
    }

    var jar = request.jar();
    var headers = {
      Accept: "*/*",
      Connection: "keep-alive",
      "Cache-Control": "max-age=0",
      "User-Agent": "VSC-SERVICENOW-SYNC",
      "Accept-Encoding": "gzip, deflate",
      "Accept-Language": "en-US,en;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    };
    var authHeader = rootSettings.auth.replace("Basic ", "");
    var authDecoded = new Buffer.from(authHeader, "base64").toString("ascii");
    var options = {
      method: "POST",
      url: rootSettings.instance + "/login.do",
      followAllRedirects: true,
      headers: headers,
      gzip: true,
      jar: jar,
      form: {
        user_name: authDecoded.split(":")[0],
        user_password: authDecoded.split(":")[1],
        remember_me: "true",
        sys_action: "sysverb_login",
      },
    };

    _this._addProxy(options);

    request(options, function (error, response, body) {
      var sysparm_ck = body.split("var g_ck = '")[1].split("'")[0];

      if (!scope) scope = "rhino.global";
      var evalOptions = {
        method: "POST",
        url: rootSettings.instance + "/sys.scripts.do",
        followAllRedirects: true,
        headers: headers,
        gzip: true,
        jar: jar,
        form: {
          script: script,
          sysparm_ck: sysparm_ck,
          sys_scope: scope,
          runscript: "Run script",
          quota_managed_transaction: "on",
        },
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

  /**
   * Creates and executes a ServiceNow API request and handles the results
   * @param {object} options A Request options object
   * @param {function} cb Callback function to execute when a request completes
   */
  ServiceNowSync.prototype.executeRequest = function (options, cb) {
    let _this = this;
    let queryMessage = vscode.window.setStatusBarMessage("⏳ Querying ServiceNow...");
    request(options, parseResults);

    async function parseResults(error, response, body) {
      if (error === null) {
        try {
          error = JSON.parse(body).error;
        } catch (ex) { }
      }
      queryMessage.dispose();

      if (!error && response.statusCode == 200) {
        let results = body;
        if (typeof body !== "object") {
          results = JSON.parse(body);
        }

        if (typeof results.result !== "undefined") {
          results = results.result;
        }

        cb(results);
      } else {
        let rootSettings = _this.getRootSettings();
        if (rootSettings.type == "oauth" && error.message == "User Not Authenticated") {
          let oauthPath = `oauth_auth.do?response_type=token&redirect_uri=vscode://anerrantprogrammer.servicenow-sync/authenticate&client_id=${rootSettings.client_id}&state=${rootSettings.id}`;
          await open(rootSettings.instance + "/" + oauthPath);
        } else {
          console.dir(error);
          vscode.window.showErrorMessage("Error 0161:" + error);
        }
      }
    }
  };

  /**
   * Compares a local and remote file to see if changes have been made
   * @param {string} localFile Local file content
   * @param {string} remoteFile Remote file content
   * @returns {boolean} Indicates whether changes exist
   */
  ServiceNowSync.prototype.getDiffs = function (localFile, remoteFile) {
    let diff = jsdiff.diffChars(localFile.toString(), remoteFile.toString());
    return diff.length > 1 || diff[0].added || diff[0].removed;
  };

  /**
   * Queries ServiceNow for a record or records then will create a local file for each record in a specified folder
   * if the folder does not exist it will attempt to create it
   * @param {object} settings Folder settings used to sync remote records to files
   * @param {string} query An optional query to use when making an API request for the table records
   * @param {boolean} suppressConfirmation Controls whether to show a user confirmation to overwrite files
   * @param {string} folder An optional query to specify where to write the file to
   */
  ServiceNowSync.prototype.getFile = function (settings, query, suppressConfirmation, folder) {
    let _this = this;

    if (!settings) throw new ConfigException("No Folder Settings Found");

    let fields = ["sys_id", settings.display];

    if (settings.grouped) {
      _.each(settings.fields, (o) => {
        fields.push(o.field);
      });
    } else {
      fields.push(settings.field);
    }

    if (typeof query === "string") {
      _this.listRecords(settings.table, fields.join(","), query, function (results) {
        displayRecordConfirmation(results, suppressConfirmation);
      });
    } else {
      _this.listRecords(settings.table, ["sys_id", settings.display].join(","), query, function (results) {
        displayRecordList(results);
      });
    }

    function displayRecordList(result) {
      if (result) {
        if (result.length > 0) {
          if (typeof folder === "undefined") {
            folder = _this._createFolder(settings.table);
          }
        }

        records = result;
        let quickPickItems = _.map(result, recordListToQuickPickItems);
        if (settings.grouped) {
          vscode.window.showQuickPick(quickPickItems).then(createGroupedFiles);
        } else {
          vscode.window.showQuickPick(quickPickItems).then(createSingleFile);
        }
      } else {
        vscode.window.setStatusBarMessage("❌️ No Records Found", 2000);
      }
    }

    function displayRecordConfirmation(result) {
      if (result) {
        if (!suppressConfirmation) {
          vscode.window.showInformationMessage("Action will create or update " + result.length + " files, continue?", "Yes", "No").then(function (res) {
            if (res === "Yes") {
              if (settings.grouped) {
                _.each(result, createFiles);
              } else {
                _.each(result, createFile);
              }
            }
          });
        } else {
          if (result.length > 0) {
            if (typeof folder === "undefined") {
              folder = _this._createFolder(settings.table);
            }
          }

          if (settings.grouped) {
            _.each(result, createFiles);
          } else {
            _.each(result, createFile);
          }
        }
      } else {
        vscode.window.setStatusBarMessage("❌️ File Sync Aborted", 2000);
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
      let folderPath = path.resolve(folder, sanitize(record[settings.display], { replacement: "_" }));

      let folderSettings = {
        groupedChild: true,
        table: settings.table,
        id: record.sys_id,
      };

      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath);
        _this.writeSettings(folderPath, folderSettings);
      }

      _.each(settings.fields, function (fieldSettings) {
        let fileName = fieldSettings.name + "." + fieldSettings.extension;
        let filePath = path.resolve(folderPath, fileName);
        fs.writeFileSync(filePath, record[fieldSettings.field]);
      });
    }

    function createFile(record) {
      let fileName = sanitize(record[settings.display], { replacement: "_" }) + "." + settings.extension;
      let filePath = path.resolve(folder, fileName);
      fs.writeFileSync(filePath, record[settings.field]);

      settings.files[fileName] = record.sys_id;
      _this.writeSettings(folder, settings);
    }

    function recordListToQuickPickItems(obj) {
      return {
        detail: obj.sys_id,
        label: obj[settings.display],
      };
    }
  };

  /**
   * Gets the connection and other global settings from the root folder
   * @returns {object} The settings for the root folder
   */
  ServiceNowSync.prototype.getRootSettings = function () {
    let _this = this;
    let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
    return _this.readSettings(rootFolder);
  };

  /**
   * Executes a ServiceNow API Request to retrieve a record and sync it to a local file
   * @param {object} settings A folder settings object
   * @param {string} sys_id Sys ID of a record to retrieve
   * @param {function} cb A callback function to execute when the request completes
   */
  ServiceNowSync.prototype.getRecord = function (settings, sys_id, cb) {
    let _this = this;
    let options = _this.createRequest(settings.table);

    options.url = options.url + "/" + sys_id;

    _this.executeRequest(options, cb);
  };

  /**
   * Retrieves the settings for given table used to sync a table which does not have a folder yet
   * @param {string} table Name of the table to retrieve settings for
   * @returns {object} A settings object for a ServiceNow table
   */
  ServiceNowSync.prototype.getTableSettings = function (table) {
    let tableOptions = tableFieldList[table];
    if (tableOptions.length == 1) {
      tableOptions = tableOptions[0];
      return {
        files: {},
        extension: tableOptions.extension,
        table: table,
        display: "name",
        field: tableOptions.field,
      };
    } else {
      return {
        grouped: true,
        display: "name",
        table: table,
        fields: _.map(tableFieldList[table], (fieldOptions) => {
          return {
            name: fieldOptions.field,
            field: fieldOptions.field,
            extension: fieldOptions.extension,
          };
        }),
      };
    }
  };

  /**
   * Checks to see whether a folder is synced to ServiceNow by looking for a settings file
   * @param {string} folder Path name of a folder to check
   * @returns {boolean} Indicates whether the folder is synced to ServiceNow
   */
  ServiceNowSync.prototype.isFolderSynced = function (folder) {
    let file = path.resolve(folder, "service-now.json");
    return fs.existsSync(file);
  };

  /**
   * Checks to see if a project is Synced to ServiceNow by looking for a settings file
   * @returns {boolean} Indicates whether project is synced to ServiceNow
   */
  ServiceNowSync.prototype.isSynced = function () {
    let rootFolder = vscode.workspace.workspaceFolders[0].uri._fsPath;
    let file = path.resolve(rootFolder, "service-now.json");
    return fs.existsSync(file);
  };

  /**
   * Executes a ServiceNow list API call for given table and query
   * @param {string} table The name of the ServiceNow table to list records for
   * @param {string} fields A list of comma separated fields to sync
   * @param {string} query An optional query used to filter the list
   * @param {function} cb A callback function to execute when the request completes
   */
  ServiceNowSync.prototype.listRecords = function (table, fields, query, cb) {
    let _this = this;
    let options = _this.createRequest(table);

    options.qs = {
      sysparm_fields: fields,
      sysparm_query: typeof query !== "undefined" ? query : "",
    };

    _this.executeRequest(options, cb);
  };

  /**
   * Opens the currently focused files ServiceNow record in the browser
   */
  ServiceNowSync.prototype.openRecordInBrowser = async function () {
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

      if (typeof sys_id !== "undefined") {
        await open(rootSettings.instance + "/" + folderSettings.table + ".do?sys_id=" + sys_id);
      }
    }
  };

  /**
   * Retrieves a list of files from ServiceNow based on a given folders settings and allows the user to sync a single file
   * @param {object} selectedFolder A VSCode folder object representing the currently selected folder in a treeview
   */
  ServiceNowSync.prototype.pullFile = function (selectedFolder) {
    let _this = this;
    let folder = selectedFolder.fsPath;
    let settings = _this.readSettings(folder);
    _this.getFile(settings, undefined, false, folder);
  };

  /**
   * Prompts the user for a query and then syncs all files matching the query based on a given folders settings
   * @param {object} selectedFolder A VSCode folder object representing the currently selected folder in a treeview
   */
  ServiceNowSync.prototype.pullMultipleFiles = function (selectedFolder) {
    let _this = this;

    let queryPromptOptions = {
      prompt: "Enter your encoded query",
    };

    vscode.window.showInputBox(queryPromptOptions).then(function (val) {
      let folder = selectedFolder.fsPath;
      let settings = _this.readSettings(folder);
      _this.getFile(settings, val, false, folder);
    });
  };

  /**
   * Syncs a local file to ServiceNow when saved by querying the folder for settings and using those settings to make an API request
   * to ServiceNow
   * If remote changes are detected the user is prompted for an action to overwrite
   * @param {object} event A VSCode file write event
   */
  ServiceNowSync.prototype.pushFile = function (event) {
    let _this = this;
    let doc = event.document;
    let prevDoc = "";

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

        if (!folderSettings) {
          return false;
        }

        if (typeof folderSettings.files === "undefined" && typeof folderSettings.grouped === "undefined" && typeof folderSettings.groupedChild === "undefined") {
          return false;
        }

        let sys_id = folderSettings.id || folderSettings.files[fileName];

        if (folderSettings.groupedChild) {
          folderSettings.field = fileName.split(".")[0];
        }

        if (typeof sys_id !== "undefined") {
          _this.getRecord(folderSettings, sys_id, (record) => {
            if (record) {
              let content = record[folderSettings.field];
              let hasDiffs = false;

              if (prevDoc.length < 50000 && content.length < 50000) {
                hasDiffs = _this.getDiffs(prevDoc, content);
              }

              if (hasDiffs) {
                vscode.window.showInformationMessage("Remote record was previously changed", "Overwrite remote", "Ignore", "Show diff").then(async function (res) {
                  if (res === "Overwrite remote") {
                    _this.updateRecord(folderSettings, sys_id, doc.getText(), () => {
                      vscode.window.setStatusBarMessage("✔️ File Uploaded", 2000);
                    });
                  } else if (res === "Show diff") {
                    _this.showDiff(content, doc.uri);
                  }
                });
              } else {
                _this.updateRecord(folderSettings, sys_id, doc.getText(), () => {
                  vscode.window.setStatusBarMessage("✔️ File Uploaded", 2000);
                });
              }
            }
          });
        }
      }
    });
  };

  /**
   * Reads a service-now.json settings file and returns the settings as an object
   * @param {string} folder The folder path to read a service-now.json settings file from
   * @returns {object} A folder settings or root settings object
   */
  ServiceNowSync.prototype.readSettings = function (folder) {
    let file = path.resolve(folder, "service-now.json");
    if (fs.existsSync(file)) {
      let settings = fs.readFileSync(file);

      try {
        settings = JSON.parse(settings);
        return settings;
      } catch (ex) {
        vscode.window.setStatusBarMessage("✔️ File Uploaded", 2000);
      }
    }

    return false;
  };

  /**
   * Refreshes an entire folders files based on the settings after prompting a user to confirm
   * @param {string} selectedFolder The folder path to refresh
   */
  ServiceNowSync.prototype.refreshFolder = function (selectedFolder) {
    let _this = this;
    let folder = selectedFolder.fsPath;
    let settings = _this.readSettings(folder);

    vscode.window.showInformationMessage("This action will overwrite all local files, continue?", "Yes", "No").then(function (res) {
      if (res === "Yes") {
        if (settings.groupedChild) {
          let parentFolder = path.resolve(folder, "..");
          let parentSettings = _this.readSettings(parentFolder);
          _this.getFile(parentSettings, "sys_id=" + settings.id, true, parentFolder);
        } else if (settings.grouped) {
          let parentFolder = selectedFolder.fsPath;

          const recordDirectories = fs
            .readdirSync(parentFolder, { withFileTypes: true })
            .filter((dirent) => dirent.isDirectory())
            .map((dirent) => dirent.name);

          for (let directory of recordDirectories) {
            let childSettings = _this.readSettings(parentFolder + "/" + directory);
            _this.getFile(settings, "sys_id=" + childSettings.id, true, parentFolder);
          }
        } else {
          for (let file in settings.files) {
            _this.getFile(settings, "sys_id=" + settings.files[file], true, folder);
          }
        }
      }
    });
  };

  /**
     * Refreshes an entire folders files based on the settings after prompting a user to confirm
     * @param {string} selectedFolder The folder path to refresh
     */
  ServiceNowSync.prototype.refreshFolderQuery = function (selectedFolder, force) {
    let _this = this;
    let folder = typeof selectedFolder === "object" ? selectedFolder.fsPath : selectedFolder;
    let settings = _this.readSettings(folder);

    if (!settings.query) {
      vscode.window.showInformationMessage("No query found in settings file.", "Ok");
      return false;
    }

    if (force) {
      _this.getFile(settings, settings.query, true, folder);
    } else {
      vscode.window.showInformationMessage("This action will pull all files matching folder query and may overwrite files, continue?", "Yes", "No").then(function (res) {
        if (res === "Yes") {
          _this.getFile(settings, settings.query, true, folder);
        }
      });
    }
  };

  /**
   * Allows a user to refresh an OAuth Token
   */
  ServiceNowSync.prototype.refreshOauthToken = async function () {
    var _this = this;
    let rootSettings = _this.getRootSettings();

    let oauthPath = `oauth_auth.do?response_type=token&redirect_uri=vscode://anerrantprogrammer.servicenow-sync/authenticate&client_id=${rootSettings.client_id}&state=${rootSettings.id}`;
    await open(rootSettings.instance + "/" + oauthPath);
  };

  /**
   * Compares the contents of a remote record to a local file by creating a temp file from the remote object
   * @param {string} content Content of the local file to compare
   * @param {object} file A VSCode file URI object
   */
  ServiceNowSync.prototype.showDiff = async function (content, file) {
    let _this = this;
    let tempFileUri = _this.createTempFile(content);
    let localFileUri = vscode.Uri.file(file.fsPath);
    await vscode.commands.executeCommand("vscode.diff", localFileUri, tempFileUri);
  };

  /**
   * Syncs an entire applications files at once
   * Currently not used
   */
  ServiceNowSync.prototype.syncApplication = function () {
    var _this = this;

    this.listRecords("sys_app", "sys_id,name", "scope!=global", function (appResult) {
      if (appResult) {
        let quickPickItems = _.map(appResult, function (obj) {
          return {
            detail: obj.sys_id,
            label: obj.name,
          };
        });

        vscode.window.showQuickPick(quickPickItems).then(function (selected) {
          if (selected) {
            _this.listRecords("sys_metadata", "sys_class_name", "sys_scope=" + selected.detail + "^sys_class_name!=sys_metadata_delete", function (applicationMetadata) {
              let appTables = {};

              _.each(applicationMetadata, function (appMetadataRecord) {
                let table = appMetadataRecord.sys_class_name;
                if (!appTables[table]) {
                  appTables[table] = true;
                  _this._createFolder(table, "sys_scope=" + selected.detail);
                }
              });
            });
          }
        });
      } else {
        vscode.window.setStatusBarMessage("Applications could not be loaded", 2000);
      }
    });
  };

  /**
   * Prompts the user to select a table to synchronize with ServiceNow
   */
  ServiceNowSync.prototype.syncTable = function () {
    let _this = this;

    let quickPickOptions = _.map(tableFieldList, (obj, key) => {
      return key;
    });

    vscode.window.showQuickPick(quickPickOptions).then((table) => {
      _this._createFolder(table);
    });
  };

  /**
   * Retrieves a list of application scopes to allow the user to change the scope they execute Background Scripts in
   */
  ServiceNowSync.prototype.updateScope = function () {
    var _this = this;

    this.listRecords("sys_app", "sys_id,name", "scope!=global", function (result) {
      if (result) {
        records = result;
        let quickPickItems = _.map(result, function (obj) {
          return {
            detail: obj.sys_id,
            label: obj.name,
          };
        });
        quickPickItems.unshift({ detail: "rhino.global", label: "Global" });
        vscode.window.showQuickPick(quickPickItems).then(function (selected) {
          _this._updateScope(selected.detail);
        });
      } else {
        vscode.window.setStatusBarMessage(" Scopes could not be loaded ...", 2000);
      }
    });
  };

  /**
   * Updates a remote record with a local files content
   */
  ServiceNowSync.prototype.updateRecord = function (settings, sys_id, file, cb) {
    let _this = this;
    let options = _this.createRequest(settings.table);

    options.url = options.url + "/" + sys_id;
    options.method = "PATCH";
    options.json = {};
    options.json[settings.field] = file;

    _this.executeRequest(options, cb);
  };

  /**
   * Writes a service-now.json settings object to a given folder
   * @param {string} folder A folder path to write a service-now.json settings file to
   * @param {object} settings An object with the full settings object to write
   */
  ServiceNowSync.prototype.writeSettings = function (folder, settings) {
    let file = path.resolve(folder, "service-now.json");
    fs.writeFileSync(file, JSON.stringify(settings, false, 4));
  };

  return ServiceNowSync;
})();

function activate(context) {
  let serviceNowSync = new ServiceNowSync();
  context.subscriptions.push(serviceNowSync);
  console.log("ServiceNow Sync Plugin Activated");
}

function deactivate() {
  console.log("ServiceNow Sync Plugin Deactivated");
}

function ConfigException(message) {
  this.message = message;
  this.name = "ConfigException";
}

exports.activate = activate;
exports.deactivate = deactivate;

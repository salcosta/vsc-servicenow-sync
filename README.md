# ServiceNow Sync 2021

Allows you to save and edit ServiceNow records from Visual Studio Code.<br/>-- Based on a fork from [ServiceNow Sync](https://marketplace.visualstudio.com/items?itemName=anerrantprogrammer.servicenow-sync) extension built by anerrantprogrammer -- 

## Build and installation

As this version of this extension is not yet published to the Visual Code Marketplace, it is necessary to clone the repository(https://github.com/aquarilis/vsc-servicenow-sync-2021) locally, and [package it in a .vsix file](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#packaging-extensions) so that it can be installed into VS Code. 

To do so, from a terminal in the cloned repository folder, run:

```vsce package```

This will create a ```servicenow-sync-2021-0.3.0.vsix``` file which you can then share, or install using the following command line:

```code --install-extension servicenow-sync-2021-0.3.0.vsix```

_Note that the original 'ServiceNow Sync' extension should either be disabled or uninstalled when using this 2021 version._

## Usage

### Setting up the extension

ServiceNow Sync depends on the root workspace folder, base settings will be stored in this folder.  It is recommended that you create a working folder per each instance you wish to sync with.

#### Connecting to a ServiceNow instance

1. From a working folder, open the Command Palette (Ctrl+Shift+P).
2. Select 'SN Sync: Connect To ServiceNow'.
3. Enter the full instance URL (example `https://myinstance.service-now.com/`).
4. Enter the username.
5. Enter the password.

A `service-now.json` file will be created in the root workspace folder.

#### Setting up a ServiceNow table for synchronization

1. From the working folder which is set up with a ServiceNow instance, open the Command Palette (Ctrl+Shift+P).
2. Select 'SN Sync: Sync Table'.
3. Select the table from the Quick Pick List.

A folder will be created in the root workspace folder and will contain a `service-now.json` file.  You may override the default settings by changing this file directly.

- `files` is a list of synchronized files, you may remove or change entries in this list as long as the given name matches the file name and the sys id matches the id of the record within ServiceNow.
- `extension` is the file extension to be used when creating files.
- `table` is the table to synchronize the folder with.
- `display` is the display field (usually name).
- `field` is the body field to synchronize the file with.

*Some tables - like `sys_ui_page` synchronize to multiple fields and these tables will be created with two or more sub-folders, each with their own individual settings.*

*To sync with a custom table, select 'Custom Table' in the Quick Pick List and follow the prompts to sync the table.*

### File management

#### Pulling a file from ServiceNow

1. **Right click** on a synchronized folder from the Explorer view.
2. Select 'SN Sync: Sync Record'.
3. A list of all records in the table will pop up, select the record by the name (or sys id).

If the file does not exist, it will be created in the folder and the entry added to the `files` list in the `service-now.json` file.

#### Pulling multiple files from ServiceNow

1. **Right click** on a synchronized folder from the Explorer view.
2. Select 'SN Sync: Sync Multiple Records'.
3. Enter an encoded query (example `sys_active=true`).
4. If matching records are found the system will confirm you wish to create or overwrite the files locally.
5. Select 'Yes' to continue.

All files will be created in the folder and their entries added to the `service-now.json` file.

#### Pushing changes to ServiceNow

1. While working in a file that is in a synched folder, save the file as you normally would.
2. If the remote file has not changed since the last sync, the remote file will be updated.
3. If the remote file has changed you will prompted to overwrite the changes, if you select 'No' the file will be saved locally but not remotely.

#### Updating local version version of a file

1. **Right click** on a synchronized file and select 'SN Sync: Compare File to Server'
2. If the remove file has been updated, you will be prompted to overwrite the local file, if you select 'No', no changes will be made.

#### Opening a file in the browser

1. **Right click** on a synchronized file and select 'SN Sync: Open Record In Browser'

The ServiceNow record synchronized with the file is opened in your default web browser.

#### Creating Files in ServiceNow

_This feature is not available._

### Script execution
#### Executing File in background script

1. While working in a file that is in a synched folder, open the Command Palette (Ctrl+Shift+P).
2. Select 'SN Sync: Execute in background script'.

The current file is executed as ServiceNow's background script and results are displayed in the VS Code's 'SN-Sync' Output window.

#### Setting scope for background script execution

1. While working in a file that is in a synched folder, open the Command Palette (Ctrl+Shift+P).
2. Select 'SN Sync: Set Scope for background script execution'.
3. A list of all available scopes for background script execution will pop up, select the desired scope by its name or sys id.

All subsequent file execution will using 'SN Sync: Execute current file in background script' will be in the selected scope.

### Proxy Support
#### To enable a proxy
- Run the command 'SN Sync: Configure Proxy Settings'
- Set the URL to the base URL of the proxy (http://myproxy)
- Set the Port if there is one
- Set the Username and Password if the Proxy uses Basic Auth

#### To disable the proxy
- Run the command 'SN Sync: Configure Proxy Settings'
- Set the URL to blank




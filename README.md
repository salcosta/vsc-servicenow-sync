# ServiceNow Sync

The original and still the best ServiceNow file to record sync tool! Allows you to save and edit ServiceNow records from Visual Studio Code

## BEFORE YOU FORK THIS PROJECT!!!

I do maintain this project even still in 2021 and will continue in the future. Before you clone this and make a new version of the plugin on the VS Code Marketplace, consider contributing to this project

If you need to get in contact with me to approve a PR email me at costas0811 ATSYMBOL gmail DOTCOM

## Installation

[Visual Studio Code Market Place: ServiceNow Sync](https://marketplace.visualstudio.com/items?itemName=anerrantprogrammer.servicenow-sync)

## Quick Start

1. Open the Command Palette (Ctrl+Shift+P) and select 'Connect to ServiceNow'
2. Specify the authentication details
3. Open the Command Palette (Ctrl+Shift+P) and select 'Sync Application'
4. Select the tables you wish to synchronize

All application files will be synced locally

## Usage

ServiceNow Sync depends on the root workspace folder, base settings will be stored in this folder.  It is recommended that you create a working folder per each instance you wish to sync with

### Creating the Connection

1. Open the Command Palette (Ctrl+Shift+P)
2. Select 'Connect to ServiceNow'
3. Select either Basic Auth or OAuth
4. Follow the prompts for your selected authentication method

A `service-now.json` file will be created in the root workspace folder

### Linking a folder to a table

1. Open the Command Palette (Ctrl+Shift+P)
2. Select 'Sync Table'
3. Select the table name from the Quick Pick List

A folder will be created in the root workspace folder and will contain a `service-now.json` file.  You may override the default settings by changing this file directly

`files` is a list of synchronized files, you may remove or change entries in this list as long as the given name matches the file name and the sys id matches the id of the record within ServiceNow
`extension` is the file extension to be used when creating files
`table` is the table to synchronize the folder with
`display` is the display field (usually name)
`field` is the body field to synchronize the file with

Some tables - like `sys_ui_page` synchronize to multiple fields and these tables will be created with two or more sub-folders, each with their own individual settings

### Pulling a file from ServiceNow

1. **Right click** on a synchronized folder from the Explorer view
2. Select 'Sync Record'
3. A list of all records in the table will pop up, select the record by the name (or sys id)

If the file does not exist it will be created in the folder and the entry added to the `files` list in the `service-now.json` file

### Pulling multiple files from ServiceNow

1. Right click on a synchronized folder from the Explorer view
2. Select 'Sync Multiple Records'
3. Enter an encoded query (example `sys_active=true`)
4. If matching records are found the system will confirm you wish to create or overwrite the files locally
5. Select 'Yes' to continue

All files will be created in the folder and their entries added to the `service-now.json` file

### 🆕 Specifying a query for a folder 

1. Open the `service-now.json` settings file in the folder
2. Add a `query` property to the file with the encoded query (example `sys_active=true`)

### Refreshing a folder

1. Right click on a synchronized folder from the Explorer view
2. Select either "Refresh files" or "Refresh refresh files with query" 

All files will be refreshed from the server either by their sys id or by the query specified in the `service-now.json` file

### Pushing Changes to ServiceNow

1. While working in a file that is in a synched folder, save the file as you normally would
2. If the remote file has not changed sync the last sync, the remote file will be updated
3. If the remote file has changed you will prompted to overwrite the changes, if you select 'No' the file will be saved locally but not remotely

### Creating Files in ServiceNow

This feature is not currently developed

### Manually Updating a File

1. Right click on a synchronized file and select 'Compare File to Server'
2. If the remove file has been updated, you will be prompted to overwrite the local file, if you select 'No', no changes will be made

### Proxy Support
**To enable a proxy**
1. Run the command 'SN Sync: Configure Proxy Settings'
2. Set the URL to the base URL of the proxy (http://myproxy)
3. Set the Port if there is one
4. Set the Username and Password if the Proxy uses Basic Auth

**To disable the proxy**
1. Run the command 'SN Sync: Configure Proxy Settings'
2. Set the URL to blank

### Sync Custom Table
1. Run the command 'SN Sync: Sync Table'
2. Select 'Custom Table'
3. Follow the prompts to sync the table

### 🆕 Sync an Application
1. Run the command 'SN Sync: Sync Application'
2. Select the application to sync
3. All folder and files with script fields will be created

### 🆕 Sync a file through URL
1. Create a Global UI Action which opens a URL in a new tab
    - URL should match `vscode://anerrantprogrammer.servicenow-sync/sync?table=TABLE&sys_id=SYSID`
2. With VSC open, click the UI Action and accept any prompts

A new file will be synced creating the folder if necessary in the last open VSC workspace



## Help

Help is available in the [ServiceNow Devs Slack Channel](https://sndevs.slack.com/messages)

## Social

[Twitter](https://twitter.com/sn_aug)
[Blog](http://anerrantprogrammer.com)
[Github](https://github.com/salcosta)
# ServiceNow Sync

Allows you to save and edit ServiceNow records from Visual Studio Code.

## Installation

[Visual Studio Code Market Place: ServiceNow Sync](https://marketplace.visualstudio.com/items?itemName=anerrantprogrammer.servicenow-sync)

## Usage

ServiceNow Sync depends on the root workspace folder, base settings will be stored in this folder.  It is recommended that you create a working folder per each instance you wish to sync with.

### Creating the Connection

1. Open the Command Palette (Ctrl+Shift+P).
2. Select 'Connect to ServiceNow'.
3. Enter the full instance URL (example `https://myinstance.service-now.com/`).
4. Enter the username.
5. Enter the password.

A `service-now.json` file will be created in the root workspace folder.

### Linking a folder to a table

1. Open the Command Palette (Ctrl+Shift+P).
2. Select 'Sync Table'.
3. Select the table name from the Quick Pick List.

A folder will be created in the root workspace folder and will contain a `service-now.json` file.  You may override the default settings by changing this file directly.

`files` is a list of synchronized files, you may remove or change entries in this list as long as the given name matches the file name and the sys id matches the id of the record within ServiceNow.
`extension` is the file extension to be used when creating files.
`table` is the table to synchronize the folder with.
`display` is the display field (usually name).
`field` is the body field to synchronize the file with.

Some tables - like `sys_ui_page` synchronize to multiple fields and these tables will be created with two or more sub-folders, each with their own individual settings.

### Pulling a file from ServiceNow

1. **Right click** on a synchronized folder from the Explorer view.
2. Select 'Sync Record'.
3. A list of all records in the table will pop up, select the record by the name (or sys id).

If the file does not exist it will be created in the folder and the entry added to the `files` list in the `service-now.json` file.

### Pulling multiple files from ServiceNow

1. Right click on a synchronized folder from the Explorer view.
2. Select 'Sync Multiple Records'.
3. Enter an encoded query (example `sys_active=true`).
4. If matching records are found the system will confirm you wish to create or overwrite the files locally.
5. Select 'Yes' to continue.

All files will be created in the folder and their entries added to the `service-now.json` file.

### Pushing Changes to ServiceNow

1. While working in a file that is in a synched folder, save the file as you normally would.
2. If the remote file has not changed sync the last sync, the remote file will be updated.
3. If the remote file has changed you will prompted to overwrite the changes, if you select 'No' the file will be saved locally but not remotely.


### Creating Files in ServiceNow

This feature is not currently developed.


### Manually Updating a File

1. Right click on a synchronized file and select 'Compare File to Server'
2. If the remove file has been updated, you will be prompted to overwrite the local file, if you select 'No', no changes will be made.


## Help

Help is available in the [ServiceNow Devs Slack Channel](https://sndevs.slack.com/messages)

## Social

[Twitter](https://twitter.com/sn_aug)
[Blog](http://anerrantprogrammer.com)
[Github](https://github.com/salcosta)
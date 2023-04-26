# Change Log
All notable changes to the "servicenow-sync" extension will be documented in this file.

## [0.4.0] - 2023-04-25
### Added
- URI Handler to sync files from a URL
    - `vscode://anerrantprogrammer.servicenow-sync/sync?table=TABLE&sys_id=SYSID`
    - Syncs to the last active window
- Ability to specify a `query` property in settings files for the encoded query
- Ability to refresh a folder by its query
- Ability to sync entire application
    - Uses full list of tables including Dictionary so just remove what you don't need

### Changed
- "Refresh Folder" to "Refresh Files"
- "Sync multiple records" to "Sync with query"

## [0.3.0] - 2021-12-23
### Added
- OAuth Login
- Refresh folder capability
- Basic documentation to each function
### Changed
- Refactored many functions
- Updated all critical dependencies
### Fixed
- Open in browser functionality
- Compare file to server function to show diff
### Removed
- Grouping multi folders by field

## [0.2.x]
Many updates were done in this time but the change log was not updated

## [0.1.2] - 2017-12-06
### Added
- Updated README with instructions
- LICENSE
## [0.1.1] - 2017-12-06
### Fixed
- Create Connection popup labels were incorrect (Found by @Rob)
## [0.1.0] - 2017-12-06
### Added
- Create a Connection from Command Palette
- Sync a folder to a remote table
- Pull a remote record to a local file using REST
- Pull multiple fields from a remote record to multiple local files using REST
- Push a local file to a remote record using REST
- Compare file and remote record when saving
- Compare file and remote record from explorer context menu
- Open the current record in a web browser
## [Unreleased]
- Initial release
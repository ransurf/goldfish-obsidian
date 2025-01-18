# Goldfish Notes Sync Plugin for Obsidian

This is a plugin to sync [Goldfish Notes](https://goldfishnotes.com/) with Obsidian

Full guide on using the plugin: (to add)

## Plugin Installation and Setup
### Step 1 - Download the plugin
#### Manually with BRAT 
1. Go to `Settings -> Community Plugins -> Browse` , search for `BRAT` plugin
2. Download, and enable it.
3. Go to the plugin settings, and under the `Beta plugin list` section, click on the `Add beta plugin` button.
4. Paste in the URL of the GitHub repository, [https://github.com/ransurf/goldfish-obsidian](https://github.com/ransurf/goldfish-obsidian) , and click `Add Plugin` and make sure `Enable after installing the plugin` is checked.

#### Through the Obsidian plugins page (once released)
1. Go to Settings > Community Plugin and turn off Restricted mode
2. Click "Browse" and search for "Goldfish Notes Sync"
3. Install the plugin and ensure you have it enabled
4. Once enabled click "Goldfish Notes Sync" under Plugin Options > Goldfish Notes Sync. Under here, fill in your username, password, and desired folder location to sync your notes. Additionally, you can toggle the "Sync notes on startup", to run the sync whenever Obsidian is opened.

### Step 2 - Setup the plugin
1. Go to the plugin settings, and sign in with your email and password. If you created an account with Google, you can sign up via email to get a password. (API key coming soon).
2. Choose the folder you want to sync your notes to. This will be the folder where all your notes will be stored.
4. To run the sync, you can either run the command `Goldfish Notes: Pull All Notes from Goldfish Notes` or toggle the "Sync notes on startup" option to run the sync whenever Obsidian is opened.

## Usage

1. Now open the [command palette](https://help.obsidian.md/Plugins/Command+palette) and run `Goldfish Notes: Pull All Notes from Goldfish Notes`
2. Your notes will be synced with Goldfish Notes and you will get a notification!

## Want to Contribute

Checkout contributing documentation here: https://docs.fleetingnotes.app/contributing/obsidian-plugin

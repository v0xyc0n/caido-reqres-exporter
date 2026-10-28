# ReqRes Exporter

Copy or save HTTP request+response pairs to clipboard or file with one click:

<img width="585" height="270" alt="image" src="https://github.com/user-attachments/assets/f62fe678-c362-4877-b643-6c62725e948d" />

Mostly vibecoded and in daily use by me.

## Features

Right-click one or more requests (in HTTP History, or the request/response panes) to get:

- **Copy Request & Response** – copy using the default format
- **Copy Headers Only** – copy without bodies
- **Copy with Template** – pick one of your templates
- **Save Request & Response to File** – one file per request, saved to your output directory

Configure everything in the **ReqRes Exporter** tab in the sidebar:

- **Output directory** for saved files
- **Default format** – exclude headers (e.g. `Cookie`, `Authorization`), and toggle labels, separator, bundle header, timestamp and numbering
- **Templates** – named formats for "Copy with Template". Comes with *Natural* (plain request/response, no decoration) and *Full* (everything on). Any template can be made the default.

JSON bodies are pretty-printed automatically. Compressed and binary bodies are replaced with a short placeholder instead of garbage. Exports over 1 MB or with more than 5 requests ask for confirmation first.

## Why?

Writing Pentest reports mostly. It is the equivalent for the Burp Plugin [Copy Request Response](https://portswigger.net/bappstore/0d05f52c00a64cb2b2bea68744f6316c), and I missed it in Caido. Also really useful for feeding context to AI for assistence in Bug Bounty.

## Why not just copy it manually?

Save yourself a few clicks. I especially found it useful for saving requests in BULK (just select more than one in your Caido history and it will save them all in the folder of your choosing).

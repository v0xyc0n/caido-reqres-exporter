# Changelog

## 1.1.1

### Improvements

- The README is now shown on the plugin page in the Caido store

## 1.1.0

### Features

- Templates: named copy formats, picked via right-click → "Copy with Template" (comes with "Natural" and "Full")
- Exclude headers (e.g. `Cookie`) and edit or hide the added labels and separators
- "Copy Headers Only"

### Improvements

- JSON bodies are pretty-printed; compressed and binary bodies show a placeholder instead of garbage
- Confirmation before very large exports or more than 5 requests

### Bugfixes

- Saving binary responses no longer fails
- Bulk save no longer overwrites files when the same endpoint is selected twice
- Host names in saved file names are now sanitized

## 1.0.1

### Bugfixes

- Fixed exporting multiple request/response pairs

## 1.0.0

### Features

- Copy or save HTTP request+response pairs to clipboard or file

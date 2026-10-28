# Changelog

## 1.1.0

- Customizable default format for Copy and Save
- Customizable templates selectable from the right-click menu, any template can be made the default
- Header exclusion per template
- Enable/disable request label, response label, and separator per template
- Bundle header, timestamp, and numbering toggles
- "Copy Headers Only" context menu action
- Automatic JSON pretty-printing for structured bodies
- Compressed and binary bodies are replaced with a placeholder
- Warning before copying or saving very large exports (over 1 MB) or more than 5 requests
- Settings page uses Caido's theme colors
- Fixed saving to file failing on some binary responses
- Fixed unsanitized host name in saved file names
- Fixed bulk save overwriting files when the same endpoint was selected more than once
- Pre-built templates:
  - "Natural": No decoration, complete request/response
  - "Full": Request/response labels, separator, bundle header, timestamp, numbering, complete request/response

## 1.0.1

- Fixed exporting multiple request/response pairs

## 1.0.0

- Copy or save HTTP request+response pairs to clipboard or file

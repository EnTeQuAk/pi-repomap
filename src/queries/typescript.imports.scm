; Import path extraction for TypeScript.
; Captures the module specifier string from import/require statements.

(import_statement
  source: (string
    (string_fragment) @path))

; Dynamic import: import('path')
(call_expression
  function: (import)
  arguments: (arguments
    (string
      (string_fragment) @path)))

; require('path')
(call_expression
  function: (identifier) @_fn
  (#eq? @_fn "require")
  arguments: (arguments
    .
    (string
      (string_fragment) @path)))

; export ... from 'path'
(export_statement
  source: (string
    (string_fragment) @path))

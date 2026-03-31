; Import path extraction for JavaScript.
; Same as TypeScript minus type imports.

(import_statement
  source: (string
    (string_fragment) @path))

(call_expression
  function: (import)
  arguments: (arguments
    (string
      (string_fragment) @path)))

(call_expression
  function: (identifier) @_fn
  (#eq? @_fn "require")
  arguments: (arguments
    .
    (string
      (string_fragment) @path)))

(export_statement
  source: (string
    (string_fragment) @path))

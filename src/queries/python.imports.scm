; Import path extraction for Python.

; import foo, import foo.bar
(import_statement
  name: (dotted_name) @path)

; from foo import bar
(import_from_statement
  module_name: (dotted_name) @path)

; from . import bar (relative)
(import_from_statement
  module_name: (relative_import) @path)

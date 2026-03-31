; Reference tag extraction for Rust.

; Function/method calls
(call_expression
  function: (identifier) @name.reference)

(call_expression
  function: (field_expression
    field: (field_identifier) @name.reference))

(call_expression
  function: (scoped_identifier
    name: (identifier) @name.reference))

; Type references
(type_identifier) @name.reference
